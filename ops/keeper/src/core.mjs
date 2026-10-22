// The keeper's work, one pass at a time (tick). Every call it makes is permissionless; it has no special powers, it is
// just reliably awake. Order within a pass:
//   1. feeds:       PlankUsdTwap.checkpoint() and PaperUsdTwap.checkpoint() when due()
//   2. randomness:  for every open (FireCards) and grading (FirePsa) still waiting: if its source (an OpenVRFAdapter)
//                   already holds the word, adapter.settle(id); else, once drand has published the request's round,
//                   router.fulfillMany(ids, signatures) (the router verifies each signature; it skips ones already
//                   delivered, so racing another keeper or the site is harmless)
//   3. dealing:     FireCards.process(fire, maxCards) while a Series' queue head is ready
//   4. grading:     FirePsa.finish(index, ids) for ready gradings, ids from the grading's Protected event (the newest
//                   GRADING_LOOKBACK each pass, plus a sweep of older ones from the oldest not finished)
//   5. burners:     PaperBurner.flush(pay) and PlankBurner.flush(pay) when they hold enough to be worth the gas (or
//                   have waited long enough) and a flush would move it
//   6. drops:       an unsold drop whose phases are over: alert (the owner can end it); once anyone can,
//                   FireSale.endDrop(fire)
//   7. health:      alerts (stale feeds, stuck opens/gradings, waiting fees, drand lag, low keeper ETH, a pause, a
//                   randomness switch, an unsold drop) and a heartbeat
// Before sending, each call is checked again against the pending state (still due, not yet delivered, something to
// deal or burn) so a keeper never sends a transaction that would do nothing. The backup (KEEPER_ROLE=backup) acts only
// on work left waiting ACT_AFTER_SEC, and yields to the main keeper on a tie (tx.mjs).
import { encodeAbiParameters, keccak256, formatEther, formatUnits, zeroAddress } from "viem";
import {
  adapterAbi, burnerAbi, cardsAbi, erc20Abi, feedAbi, paperTwapAbi, pausableAbi, protectedEvent, psaAbi, routerAbi, saleAbi, twapAbi,
} from "./abis.mjs";
import { drandClient, roundAt, roundTime } from "./drand.mjs";
import { createSender, errMsg } from "./tx.mjs";
import { createNotifier } from "./alerts.mjs";

const PAY = [["PLANK", 0], ["ETH", 1], ["USDG", 2]];
const idsHash = (ids) => keccak256(encodeAbiParameters([{ type: "uint256[]" }], [ids]));

/** Whether to flush a burner balance now. `usd`: what it's worth (undefined: no price to value it); `waitedMs`: since
 *  it was first seen; `sinceFlushMs`: since this keeper last sent a flush for it (undefined: never). */
export function flushPlan({ usd, waitedMs, sinceFlushMs }, cfg) {
  const min = cfg.minFlushUsd ?? 1;
  if (usd !== undefined && usd >= min * (cfg.flushNowX ?? 25)) return { go: true, why: "large" };
  if (sinceFlushMs !== undefined && sinceFlushMs < (cfg.flushEveryMin ?? 15) * 60_000) return { go: false, why: "flushed recently" };
  if (usd !== undefined && usd >= min) return { go: true, why: "worth it" };
  if (waitedMs >= (cfg.flushMaxWaitHours ?? 6) * 3_600_000 && (usd === undefined || usd >= (cfg.flushDustUsd ?? 0.05))) return { go: true, why: "waited" };
  return { go: false, why: usd === undefined ? "no price yet" : "below the minimum" };
}

/** When the owner may end a drop that hasn't sold out (its phases over, and MIN_DROP_TIME after start at the
 *  earliest), and when anyone may (END_GRACE later). As FireSale.endDrop. */
export function dropEndTimes(d, minDropTime, endGrace) {
  const start = BigInt(d.start);
  let longest = 0n;
  for (const w of [d.starterWindow, d.liftAfter, d.holderWindow, d.plankOnlyFor, d.regularWalletsFor]) if (BigInt(w) > longest) longest = BigInt(w);
  let owner = start + longest;
  if (owner < start + BigInt(minDropTime)) owner = start + BigInt(minDropTime);
  return { owner, anyone: owner + BigInt(endGrace) };
}

const utc = (ts) => `${new Date(Number(ts) * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function createKeeper({ cfg, pub, wallet, account, log = console.log, fetchFn = globalThis.fetch, wallNow }) {
  const C = cfg.contracts;
  const drand = drandClient(cfg.drandUrls, fetchFn);
  const sender = createSender({
    pub, wallet, account, log, maxFeeGwei: cfg.maxFeeGwei, receiptTimeoutMs: cfg.receiptTimeoutMs,
    yieldMs: cfg.yieldMs ?? 0, mainKeeper: cfg.mainKeeper,
  });
  const notifier = createNotifier({ cfg, log, fetchFn });
  // reads in the same tick are batched into one Multicall3 call when the client has it (keeper.mjs)
  const read = (address, abi, functionName, args = [], blockTag) => pub.readContract({ address, abi, functionName, args, ...(blockTag ? { blockTag } : {}) });
  // values that never change (immutables, constants): read once
  const constants = new Map();
  const once = (address, abi, functionName) => {
    const k = `${address}:${functionName}`;
    if (!constants.has(k)) constants.set(k, read(address, abi, functionName).catch((e) => { constants.delete(k); throw e; }));
    return constants.get(k);
  };
  const wall = wallNow ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  const backup = cfg.actAfterSec > 0n;

  // memory (lost on restart; a ONCE pass rebuilds what it needs)
  let series = cfg.series ? [...cfg.series] : [];
  let lastSeriesScan = 0;
  let gradingFloor = 0n; // every grading below it is done (finished or cancelled)
  let gradingSweep = 0n; // where the next chunk of older gradings starts
  let gradingChunk = []; // this pass's chunk of gradings older than the window (rescans read the same one)
  const gradingsBehind = new Map(); // index -> not done and older than the window (seen in a sweep)
  const sourceRouter = new Map(); // source -> router address | null (not a drand adapter)
  const idsOf = new Map(); // grading index -> ids (from its Protected event)
  const blockTs = new Map(); // block number -> timestamp
  const waitingSince = new Map(); // "burner:pay" -> first seen holding something (ms)
  const lastFlush = new Map(); // "burner:pay" -> when this keeper last sent a flush for it (ms)
  const cantBurn = new Set(); // "burner:pay" whose last flush left something it couldn't burn
  const sources = new Map(); // "FireCards" | "FirePsa" -> randomness source last seen

  // ------------------------------------------------------------------ series and queues
  async function scanSeries() {
    // a new Series is noticed within a minute (at once while none is known)
    if (cfg.series || (series.length && Date.now() - lastSeriesScan < 60_000)) return series;
    const found = [];
    let top = BigInt(cfg.seriesScan);
    for (let from = 0n; from <= top; ) {
      const ids = [];
      for (let f = from; f <= top; f++) ids.push(f);
      const fires = await Promise.all(ids.map((f) => read(C.cards, cardsAbi, "fires", [f])));
      for (let k = 0; k < ids.length; k++) {
        if (fires[k][0] === zeroAddress) continue;
        found.push(ids[k]);
        if (ids[k] + 16n > top) top = ids[k] + 16n; // keep probing past the highest Series found
      }
      from = ids.at(-1) + 1n;
    }
    series = found;
    lastSeriesScan = Date.now();
    return series;
  }

  async function opensWaiting() {
    const out = [];
    const fires = await scanSeries();
    const pend = await Promise.all(fires.map((f) => read(C.cards, cardsAbi, "pending", [f])));
    for (const [k, fire] of fires.entries()) {
      if (pend[k][0] === 0n) continue;
      const [head, count] = await Promise.all([read(C.cards, cardsAbi, "headOf", [fire]), read(C.cards, cardsAbi, "openCount", [fire])]);
      const end = count < head + 200n ? count : head + 200n;
      const idx = [];
      for (let i = head; i < end; i++) idx.push(i);
      const os = await Promise.all(idx.map((i) => read(C.cards, cardsAbi, "openOf", [fire, i])));
      os.forEach((o, j) => out.push({ kind: "open", fire, index: idx[j], head: idx[j] === head, source: o.source, requestId: o.requestId, requestedAt: o.requestedAt, ready: o.ready, readyAt: o.readyAt, count: o.count }));
    }
    return out;
  }

  /** Gradings not done: the newest GRADING_LOOKBACK, the oldest not done, plus (`sweep`, once per pass) the next
   *  GRADING_LOOKBACK older ones from the oldest not done, wrapping around, so a backlog older than the window is still covered a chunk per
   *  pass. One-pass runs (ONCE) read the window only: the long-running keepers do the sweep. */
  async function gradingsWaiting(sweep = false) {
    const count = await read(C.psa, psaAbi, "gradingCount");
    const L = BigInt(cfg.gradingLookback);
    const front = count > L ? count - L : 0n;
    if (cfg.once) gradingFloor = front;
    if (sweep) {
      gradingChunk = [];
      if (gradingFloor < front) {
        const s = gradingSweep >= gradingFloor && gradingSweep < front ? gradingSweep : gradingFloor;
        const end = s + L < front ? s + L : front;
        for (let i = s; i < end; i++) gradingChunk.push(i);
        gradingSweep = end;
      }
    }
    // the oldest not done is read every pass too, so the floor moves on as soon as it's finished
    const idx = gradingFloor < front && !gradingChunk.includes(gradingFloor) ? [gradingFloor] : [];
    idx.push(...gradingChunk.filter((i) => i >= gradingFloor));
    for (let i = front > gradingFloor ? front : gradingFloor; i < count; i++) idx.push(i);
    const gs = await Promise.all(idx.map((k) => read(C.psa, psaAbi, "gradingOf", [k])));
    const done = new Map();
    const out = [];
    for (const [j, g] of gs.entries()) {
      const i = idx[j];
      done.set(i, g.done);
      if (i < front) { if (g.done) gradingsBehind.delete(i); else gradingsBehind.set(i, g.requestedAt); }
      if (g.done) continue;
      out.push({ kind: "grading", index: i, behind: i < front, source: g.source, requestId: g.requestId, requestedAt: g.requestedAt, ready: g.ready, idsHash: g.idsHash });
    }
    // the floor only moves past gradings read as done
    while (done.get(gradingFloor) === true) gradingFloor++;
    for (const i of gradingsBehind.keys()) if (i < gradingFloor || i >= front) gradingsBehind.delete(i);
    return out;
  }

  /** The alert for unfinished gradings older than the window (the sweep reaches each once per lap). */
  function behindAlert() {
    if (!gradingsBehind.size) return undefined;
    const oldest = [...gradingsBehind.keys()].reduce((a, b) => (b < a ? b : a));
    return { key: "gradings:behind", text: `${gradingsBehind.size} unfinished grading(s) are older than the newest ${cfg.gradingLookback} (oldest: grading ${oldest}): the keeper sweeps them ${cfg.gradingLookback} per pass; check why they aren't finished` };
  }

  // ------------------------------------------------------------------ randomness
  async function routerOf(source) {
    if (sourceRouter.has(source)) return sourceRouter.get(source);
    let r = null;
    try { r = await read(source, adapterAbi, "ROUTER"); } catch { /* not an OpenVRFAdapter: the keeper can't help it */ }
    sourceRouter.set(source, r);
    return r;
  }

  /** Delivers what it can for items that aren't ready. Returns per-item notes for the health check. */
  async function deliver(items, now, notes) {
    const byRouter = new Map(); // router -> [{id, round}]
    const waiting = items.filter((it) => !it.ready);
    const routers = await Promise.all(waiting.map((it) => routerOf(it.source)));
    // the pending state: a delivery another keeper (or the site) already sent counts as done
    const reqs = await Promise.all(waiting.map((it, k) => (routers[k] ? read(routers[k], routerAbi, "requests", [it.requestId], "pending") : undefined)));
    for (const [k, it] of waiting.entries()) {
      const router = routers[k];
      if (!router) { notes.push({ it, why: `source ${it.source} isn't a drand adapter` }); continue; }
      const [consumer, round, , fulfilled, delivered] = reqs[k];
      if (consumer.toLowerCase() !== it.source.toLowerCase()) { notes.push({ it, why: `router request ${it.requestId} belongs to ${consumer}` }); continue; }
      it.round = round;
      it.roundAt = roundTime(round);
      if (fulfilled) {
        // the router holds the word but the callback didn't land: deliver the same word
        if (delivered) continue; // the callback landed in the pending state: nothing to settle
        if (now < it.requestedAt + 60n + cfg.actAfterSec) continue;
        const r = await sender.send({ address: it.source, abi: adapterAbi, functionName: "settle", args: [it.requestId] }, { job: `settle:${it.source}:${it.requestId}` });
        if (r.status !== "done") notes.push({ it, why: `settle: ${r.reason ?? r.status}` });
        continue;
      }
      if (now < it.roundAt + cfg.actAfterSec) continue; // drand hasn't published it yet (or the main keeper's turn)
      if (!byRouter.has(router)) byRouter.set(router, []);
      byRouter.get(router).push(it);
    }
    for (const [router, list] of byRouter) {
      const ready = [];
      for (const it of list) {
        const sig = await drand.signature(it.round);
        if (sig) ready.push({ it, sig });
        else notes.push({ it, why: `drand round ${it.round} not available from ${drand.urls.join(", ")}` });
      }
      // a request id can appear once per router: opens and gradings share the router through different adapters
      const seen = new Set();
      const uniq = ready.filter(({ it }) => (seen.has(it.requestId) ? false : seen.add(it.requestId)));
      for (let k = 0; k < uniq.length; k += cfg.fulfillBatch) {
        const part = uniq.slice(k, k + cfg.fulfillBatch);
        const ids = part.map((p) => p.it.requestId);
        // still none of them delivered (else the next pass sends what's left, rather than a partly wasted call)
        const precheck = async (tag) => (await Promise.all(ids.map((id) => read(router, routerAbi, "requests", [id], tag)))).every((q) => !q[3]);
        const r = await sender.send(
          { address: router, abi: routerAbi, functionName: "fulfillMany", args: [ids, part.map((p) => p.sig)] },
          { job: `fulfillMany:${router}:${ids.join(",")}`, precheck },
        );
        if (r.status === "done") log(`delivered drand to ${part.map((p) => `${p.it.kind} ${p.it.kind === "open" ? `${p.it.fire}/` : ""}${p.it.index}`).join(", ")}`);
        else if (r.status !== "waiting") for (const p of part) notes.push({ it: p.it, why: `fulfillMany: ${r.reason ?? r.status}` });
      }
    }
  }

  // ------------------------------------------------------------------ dealing and grading
  async function dealReady(now) {
    let dealt = 0;
    for (const fire of series) {
      for (let k = 0; k < cfg.processCallsPerPass; k++) {
        const [, readyAtHead] = await read(C.cards, cardsAbi, "pending", [fire]);
        if (readyAtHead === 0n) break;
        const head = await read(C.cards, cardsAbi, "headOf", [fire]);
        const o = await read(C.cards, cardsAbi, "openOf", [fire, head]);
        // the main keeper deals at once (readyAt may be later than this pass's start: it just delivered); the backup
        // waits its grace from the pass's start, which only makes it more patient
        if (backup && now < o.readyAt + cfg.actAfterSec) break;
        const r = await sender.send(
          { address: C.cards, abi: cardsAbi, functionName: "process", args: [fire, cfg.processMaxCards] },
          { job: `process:${fire}`, precheck: async (tag) => (await read(C.cards, cardsAbi, "pending", [fire], tag))[1] > 0n, accept: (out) => out > 0n },
        );
        if (r.status !== "done") break;
        dealt++;
      }
    }
    return dealt;
  }

  async function timestampOf(n) {
    if (!blockTs.has(n)) blockTs.set(n, (await pub.getBlock({ blockNumber: n })).timestamp);
    if (blockTs.size > 5000) blockTs.clear();
    return blockTs.get(n);
  }

  /** First block with timestamp >= ts (binary search between the deploy's start block and the latest). */
  async function blockAt(ts, latest) {
    let lo = cfg.startBlock;
    let hi = latest;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if ((await timestampOf(mid)) < ts) lo = mid + 1n;
      else hi = mid;
    }
    return lo;
  }

  /** The cards a grading sent (its Protected event), checked against the hash FirePsa stored. */
  async function gradingIds(g, latest) {
    if (idsOf.has(g.index)) return idsOf.get(g.index);
    for (const pad of [0n, 30n, 600n]) {
      const from = await blockAt(g.requestedAt - pad, latest);
      let to = (await blockAt(g.requestedAt + 1n + pad, latest));
      to = to > from ? to - 1n : from;
      if (to > latest) to = latest;
      const logs = await pub.getLogs({ address: C.psa, event: protectedEvent, fromBlock: from, toBlock: to });
      for (const l of logs) {
        if (l.args.gradingIndex !== g.index) continue;
        if (idsHash(l.args.graded) !== g.idsHash) throw new Error(`grading ${g.index}: Protected ids don't match the stored hash`);
        idsOf.set(g.index, l.args.graded);
        return l.args.graded;
      }
    }
    throw new Error(`grading ${g.index}: no Protected event found near ${g.requestedAt}`);
  }

  async function finishReady(gradings, now, latestBlock, notes) {
    let finished = 0;
    for (const g of gradings) {
      if (!g.ready) continue;
      if (now < g.requestedAt + 93n + cfg.actAfterSec) continue;
      let ids;
      try { ids = await gradingIds(g, latestBlock); } catch (e) { notes.push({ it: g, why: errMsg(e) }); continue; }
      const r = await sender.send(
        { address: C.psa, abi: psaAbi, functionName: "finish", args: [g.index, ids] },
        { job: `finish:${g.index}`, precheck: async (tag) => !(await read(C.psa, psaAbi, "gradingOf", [g.index], tag)).done },
      );
      if (r.status === "done") { finished++; idsOf.delete(g.index); }
      else if (r.status !== "waiting") notes.push({ it: g, why: `finish: ${r.reason ?? r.status}` });
    }
    return finished;
  }

  // ------------------------------------------------------------------ burners
  /** Dollar prices for valuing burner balances (undefined: no price): ETH from Chainlink (8 decimals), PLANK from
   *  PlankUsdTwap (18 decimals), USDG at face value. */
  async function burnPrices() {
    const px = async (feed) => { try { const p = (await read(feed, feedAbi, "latestRoundData"))[1]; return p > 0n ? p : undefined; } catch { return undefined; } };
    const [eth, plank] = await Promise.all([cfg.ethUsdFeed ? px(cfg.ethUsdFeed) : undefined, px(C.plankTwap)]);
    return { eth, plank };
  }

  async function burners(waiting) {
    const prices = await burnPrices();
    for (const [name, address] of [["PaperBurner", C.paperBurner], ["PlankBurner", C.plankBurner]]) {
      const [plank, usdg] = await Promise.all([once(address, burnerAbi, "PLANK"), once(address, burnerAbi, "USDG")]);
      // only flushers the owner names may flush PaperBurner (PlankBurner is open to anyone)
      const allowed = name !== "PaperBurner" || (await read(address, burnerAbi, "flusher", [account.address]));
      for (const [pay, code] of PAY) {
        const token = pay === "PLANK" ? plank : pay === "USDG" ? usdg : undefined;
        if (pay === "USDG" && usdg === zeroAddress) continue;
        const balance = () => (pay === "ETH" ? pub.getBalance({ address }) : read(token, erc20Abi, "balanceOf", [address]));
        const held = await balance();
        const key = `${name}:${pay}`;
        if (held === 0n) { waitingSince.delete(key); cantBurn.delete(key); continue; }
        if (!waitingSince.has(key)) waitingSince.set(key, Date.now());
        const since = waitingSince.get(key);
        // the backup flushes only a balance that has waited its grace period (the main keeper flushes at once)
        if (backup && Date.now() - since < Number(cfg.actAfterSec) * 1000) continue;
        // worth the gas? (anyone can send dust to a burner; a flush costs the keeper 50-250k gas)
        let usd;
        if (pay === "ETH" && prices.eth) usd = Number(formatUnits(held * prices.eth, 26));
        else if (pay === "PLANK" && prices.plank) usd = Number(formatUnits(held * prices.plank, 36));
        else if (pay === "USDG") usd = Number(formatUnits(held, await once(usdg, erc20Abi, "decimals").catch(() => 6)));
        const plan = flushPlan({ usd, waitedMs: Date.now() - since, sinceFlushMs: lastFlush.has(key) ? Date.now() - lastFlush.get(key) : undefined }, cfg);
        if (!plan.go) {
          // still the same waiting fees as the last flush left: keep the alert open
          if (cantBurn.has(key)) waiting.push({ key, name, pay, amount: held, since, flushed: false });
          continue;
        }
        if (!allowed) {
          waiting.push({ key, name, pay, amount: held, since, flushed: false, notFlusher: true });
          continue;
        }
        const r = await sender.send(
          { address, abi: burnerAbi, functionName: "flush", args: [code] },
          { job: `flush:${address}:${code}`, accept: (out) => out > 0n },
        );
        if (r.status !== "skipped") lastFlush.set(key, Date.now()); // a transaction went out: the next one waits FLUSH_EVERY_MIN
        const left = await balance();
        if (left === 0n) { waitingSince.delete(key); cantBurn.delete(key); continue; }
        cantBurn.add(key);
        waiting.push({ key, name, pay, amount: left, since, flushed: r.status === "done" });
      }
    }
  }

  // ------------------------------------------------------------------ drops
  /** A drop that hasn't sold out: an alert once the owner may end it; once anyone may, the keeper ends it itself
   *  (the backup only ACT_AFTER_SEC after that). Returns { alerts, events }. */
  async function drops(now) {
    const sale = cfg.optional?.sale;
    const alerts = [];
    const events = [];
    if (!sale || !series.length) return { alerts, events };
    const [minTime, grace] = await Promise.all([once(sale, saleAbi, "MIN_DROP_TIME"), once(sale, saleAbi, "END_GRACE")]);
    const ds = await Promise.all(series.map((f) => read(sale, saleAbi, "dropOf", [f])));
    for (const [k, fire] of series.entries()) {
      const d = ds[k];
      if (d.start === 0n || d.closed) continue;
      const at = dropEndTimes(d, minTime, grace);
      if (now < at.owner) continue;
      let why;
      if (now >= at.anyone + cfg.actAfterSec) {
        const open = async (tag) => { const x = await read(sale, saleAbi, "dropOf", [fire], tag); return x.start !== 0n && !x.closed; };
        const r = await sender.send({ address: sale, abi: saleAbi, functionName: "endDrop", args: [fire] }, { job: `endDrop:${fire}`, precheck: open });
        if (r.status === "done") {
          events.push({ key: `endDrop:${fire}`, text: `Series ${fire} hadn't sold out and its end grace is over: this keeper ended the drop (FireSale.endDrop(${fire})); its packs can be opened` });
          continue;
        }
        if (r.status === "waiting") continue;
        if (r.reason === "already done") continue;
        why = r.reason ?? r.status;
      }
      alerts.push({ key: `drop:${fire}`, text: now < at.anyone
        ? `Series ${fire} hasn't sold out; the owner can end it now with FireSale.endDrop(${fire}), or anyone can after ${utc(at.anyone)} (packs can't be opened and no next drop can be set up until then)`
        : `Series ${fire} hasn't sold out and anyone can end it since ${utc(at.anyone)}: ${why ? `this keeper's FireSale.endDrop(${fire}) didn't go through (${why})` : "the main keeper ends it (FireSale.endDrop)"}` });
    }
    return { alerts, events };
  }

  // ------------------------------------------------------------------ feeds
  async function feeds(now) {
    for (const [name, address] of [["PlankUsdTwap", C.plankTwap], ["PaperUsdTwap", C.paperTwap]]) {
      if (!(await read(address, twapAbi, "due", [], "pending"))) continue;
      if (backup) {
        // the backup only steps in when the main keeper is late rolling a window or adopting a candidate pool
        // (recording a new candidate is the main keeper's job)
        const [[, lastTs], minWindow] = await Promise.all([read(address, twapAbi, "last"), once(address, twapAbi, "MIN_WINDOW")]);
        let late = now >= BigInt(lastTs) + minWindow + cfg.actAfterSec;
        if (name === "PaperUsdTwap") {
          const [pair, cand, since] = await Promise.all([read(address, paperTwapAbi, "pair"), read(address, paperTwapAbi, "candidate"), read(address, paperTwapAbi, "candidateSince")]);
          if (pair === zeroAddress) late = cand !== zeroAddress && now >= BigInt(since) + minWindow + cfg.actAfterSec;
        }
        if (!late) continue;
      }
      await sender.send({ address, abi: twapAbi, functionName: "checkpoint" }, { job: `checkpoint:${address}`, precheck: (tag) => read(address, twapAbi, "due", [], tag) });
    }
  }

  // ------------------------------------------------------------------ health
  async function health({ now, opens, gradings, notes, waiting, failed }) {
    const alerts = [];
    const ago = (t) => Number(now - BigInt(t));
    const min = (s) => `${Math.round(s / 60)} min`;
    // feeds
    const [plankLast, plankPrev, plankPx] = await Promise.all([read(C.plankTwap, twapAbi, "last"), read(C.plankTwap, twapAbi, "prev"), read(C.plankTwap, twapAbi, "latestRoundData")]);
    // FireSale takes a PLANK price up to 2 h old over a window up to 2 h long. A buy checkpoints the feed itself, but
    // after a gap over 2 h that new window is too long, so PLANK pricing stays off until the checkpoint after it
    const plankAge = ago(plankPx[3]);
    const plankWindow = Number(BigInt(plankLast[1]) - BigInt(plankPrev[1]));
    if (plankAge > cfg.plankStaleMin * 60) alerts.push({ key: "feed:plank", text: `PLANK price stale: ${min(plankAge)} old (FireSale stops PLANK pricing at 2 h, and a buy can't heal a longer gap): checkpoint PlankUsdTwap now` });
    else if (plankPx[1] <= 0n) alerts.push({ key: "feed:plank0", text: "PLANK price reads 0 (no full window yet, or the ETH/USD feed is stale)" });
    else if (plankWindow > 7200) alerts.push({ key: "feed:plankwin", text: `PLANK price window is ${min(plankWindow)} long (FireSale needs 2 h or less): PLANK pricing is off until the next checkpoint` });
    const [paperPair, paperCand, paperSince, paperMin] = await Promise.all([
      read(C.paperTwap, paperTwapAbi, "pair"), read(C.paperTwap, paperTwapAbi, "candidate"), read(C.paperTwap, paperTwapAbi, "candidateSince"), once(C.paperTwap, twapAbi, "MIN_WINDOW"),
    ]);
    if (paperPair !== zeroAddress) {
      const paperLast = await read(C.paperTwap, twapAbi, "last");
      const paperAge = ago(paperLast[1]);
      if (paperAge > cfg.paperStaleHours * 3600) alerts.push({ key: "feed:paper", text: `PAPER price stale: last checkpoint ${(paperAge / 3600).toFixed(1)} h ago (PaperBurner waits at 2 days)` });
    }
    if (paperCand !== zeroAddress) {
      // a candidate pool is adopted by the first checkpoint MIN_WINDOW (20 h) after it was recorded
      const late = ago(paperSince) - Number(paperMin);
      if (late > cfg.paperCandidateLateHours * 3600) alerts.push({ key: "feed:papercand", text: `PAPER feed candidate pool ${paperCand} was recorded ${(ago(paperSince) / 3600).toFixed(1)} h ago and is still not adopted (due at ${Number(paperMin) / 3600} h): checkpoint PaperUsdTwap` });
    }
    if (cfg.ethUsdFeed) {
      const [, ethPx, , updated] = await read(cfg.ethUsdFeed, feedAbi, "latestRoundData");
      const age = ago(updated);
      if (ethPx <= 0n || age > cfg.ethStaleHours * 3600) alerts.push({ key: "feed:eth", text: `ETH/USD feed stale: updated ${(age / 3600).toFixed(1)} h ago (prices stop at 25 h)` });
    }
    // opens and gradings
    const stuck = cfg.stuckMin * 60;
    // gradings older than the window are covered by one alert (the sweep reaches each only once per lap)
    for (const it of [...opens, ...gradings.filter((g) => !g.behind)]) {
      const name = it.kind === "open" ? `open ${it.fire}/${it.index}` : `grading ${it.index}`;
      if (!it.ready && it.roundAt !== undefined && ago(it.roundAt) > stuck) {
        alerts.push({ key: `stuck:${it.kind}:${it.fire ?? ""}:${it.index}`, text: `${name}: drand round ${it.round} was published ${min(ago(it.roundAt))} ago and still isn't delivered` });
      }
      if (!it.ready && it.roundAt === undefined && ago(it.requestedAt) > stuck + 93) {
        alerts.push({ key: `stuck:${it.kind}:${it.fire ?? ""}:${it.index}`, text: `${name}: requested ${min(ago(it.requestedAt))} ago, no randomness yet (source ${it.source})` });
      }
      if (it.kind === "open" && it.ready && it.head && it.count > 0n && ago(it.readyAt) > stuck) {
        alerts.push({ key: `deal:${it.fire}:${it.index}`, text: `${name}: ready ${min(ago(it.readyAt))} ago and still not dealt (FireCards.process)` });
      }
      if (it.kind === "grading" && it.ready && ago(it.requestedAt) > stuck + 93) {
        alerts.push({ key: `finish:${it.index}`, text: `${name}: randomness arrived but grades aren't set (FirePsa.finish) ${min(ago(it.requestedAt))} after the request` });
      }
    }
    const behind = behindAlert();
    if (behind) alerts.push(behind);
    for (const n of notes) {
      const name = n.it.kind === "open" ? `open ${n.it.fire}/${n.it.index}` : `grading ${n.it.index}`;
      alerts.push({ key: `note:${n.it.kind}:${n.it.fire ?? ""}:${n.it.index}`, text: `${name}: ${n.why}`, quiet: true });
    }
    // fees waiting in the burners
    for (const w of waiting) {
      const age = (Date.now() - w.since) / 60_000;
      if (cfg.once || age >= cfg.waitingAlertMin) {
        const amt = w.pay === "ETH" ? `${formatEther(w.amount)} ETH` : w.pay === "USDG" ? `${formatUnits(w.amount, 6)} USDG` : `${formatEther(w.amount)} PLANK`;
        alerts.push({ key: `waiting:${w.key}`, text: w.notFlusher
          ? `${w.name} holds ${amt} and this keeper (${account.address}) isn't allowed to flush it: the owner calls PaperBurner.setFlusher(${account.address}, true)`
          : `${w.name} holds ${amt} it can't burn yet (Waiting: price guard or a missing price feed)` });
      }
    }
    // drand and clocks
    const wallSec = wall();
    const latest = await drand.latest();
    if (latest === undefined) alerts.push({ key: "drand:down", text: `no drand relay answered (${drand.urls.join(", ")})` });
    else if (roundAt(wallSec) - latest > cfg.drandLagRounds) alerts.push({ key: "drand:lag", text: `drand is ${roundAt(wallSec) - latest} rounds behind the clock (latest ${latest})` });
    if (cfg.clockSkewSec > 0 && Math.abs(Number(now - wallSec)) > cfg.clockSkewSec) {
      alerts.push({ key: "clock", text: `the chain's clock is ${Number(now - wallSec)} s off real time` });
    }
    // the owner's switches: a pause (posted once, and again when it ends); a randomness switch is an event (tick)
    const [salePaused, psaPaused] = await Promise.all([
      cfg.optional?.sale ? read(cfg.optional.sale, pausableAbi, "paused").catch(() => false) : false,
      read(C.psa, pausableAbi, "paused").catch(() => false),
    ]);
    if (salePaused) alerts.push({ key: "pause:sale", repeat: false, text: "FireSale is PAUSED by the owner: buying, press packs and credit spending are stopped" });
    if (psaPaused) alerts.push({ key: "pause:psa", repeat: false, text: "FirePsa is PAUSED by the owner: case and grading payments are stopped" });
    // the keeper itself
    const bal = await pub.getBalance({ address: account.address });
    if (bal < BigInt(Math.round(cfg.lowBalanceEth * 1e18))) alerts.push({ key: "balance", text: `keeper ${account.address} is low on gas: ${formatEther(bal)} ETH (top it up)` });
    for (const f of failed) alerts.push({ key: `job:${f.job}`, text: `job ${f.job} failed: ${f.error}` });
    for (const e of sender.inflight.values()) {
      const age = Date.now() - e.firstSentAt;
      if (age > 15 * 60_000) alerts.push({ key: `tx:${e.functionName}:${e.nonce}`, text: `${e.functionName} transaction in flight ${Math.round(age / 60_000)} min (nonce ${e.nonce})` });
    }
    return { alerts, balance: bal };
  }

  // ------------------------------------------------------------------ one pass
  async function tick() {
    await sender.reconcile();
    const block = await pub.getBlock();
    const now = block.timestamp;
    const failed = [];
    const job = async (name, fn) => { try { return await fn(); } catch (e) { failed.push({ job: name, error: errMsg(e) }); log(`${name} failed: ${errMsg(e)}`); } };
    const notes = [];
    const waiting = [];
    await job("feeds", () => feeds(now));
    let opens = (await job("scan opens", opensWaiting)) ?? [];
    let gradings = (await job("scan gradings", () => gradingsWaiting(true))) ?? [];
    await job("randomness", () => deliver([...opens, ...gradings], now, notes));
    const dealt = (await job("deal", () => dealReady(now))) ?? 0;
    // re-read the gradings: some just became ready
    if (gradings.some((g) => !g.ready)) gradings = (await job("rescan gradings", () => gradingsWaiting())) ?? gradings;
    const finished = (await job("finish", () => finishReady(gradings, now, block.number, notes))) ?? 0;
    await job("burners", () => burners(waiting));
    const drop = (await job("drops", () => drops(now))) ?? { alerts: [], events: [] };
    // what's still waiting after this pass's work, for the alerts
    const after = (await job("rescan opens", opensWaiting)) ?? opens;
    for (const o of after) {
      const before = opens.find((x) => x.fire === o.fire && x.index === o.index);
      if (before?.roundAt !== undefined) Object.assign(o, { round: before.round, roundAt: before.roundAt });
    }
    opens = after;
    const gradingsAfter = (await job("rescan gradings", () => gradingsWaiting())) ?? gradings;
    for (const g of gradingsAfter) {
      const before = gradings.find((x) => x.index === g.index);
      if (before?.roundAt !== undefined) Object.assign(g, { round: before.round, roundAt: before.roundAt });
    }
    const h = (await job("health", () => health({ now, opens, gradings: gradingsAfter, notes, waiting, failed }))) ?? { alerts: [{ key: "health", text: "health check failed" }] };
    h.alerts.push(...drop.alerts);
    const events = [...drop.events, ...((await job("randomness sources", () => watchSources())) ?? [])];
    const sent = sender.sent();
    if (backup && sent.length) {
      events.push({ key: "backup-acted", text: `the backup keeper had to step in (${sent.length} tx: ${sent.map((s) => s.split(" ")[0]).join(", ")}); is the main keeper down?` });
    }
    await notifier.report(h.alerts, { balance: h.balance, series, opens: opens.length, gradings: gradingsAfter.length, sent: sent.length, address: account.address, now: wallSec(wall) }, events);
    return { now, sent, dealt, finished, alerts: h.alerts, opens, gradings: gradingsAfter, waiting, series };
  }

  // ------------------------------------------------------------------ randomness sources
  /** Events for a switch of FireCards' or FirePsa's randomness source since the last pass (the first look only
   *  records them, and logs a source that isn't the deployed adapter). */
  async function watchSources() {
    const events = [];
    const [cardsSrc, psaSrc] = await Promise.all([read(C.cards, cardsAbi, "randomness"), read(C.psa, psaAbi, "randomness")]);
    for (const [name, src, deployed] of [["FireCards", cardsSrc, cfg.optional?.cardsAdapter], ["FirePsa", psaSrc, cfg.optional?.psaAdapter]]) {
      const before = sources.get(name);
      sources.set(name, src);
      if (before === undefined) {
        if (deployed && src.toLowerCase() !== deployed.toLowerCase()) log(`${name}'s randomness source is ${src}, not the deployed adapter ${deployed} (switched by the owner)`);
        continue;
      }
      if (before.toLowerCase() !== src.toLowerCase()) {
        const router = await routerOf(src);
        events.push({ key: `source:${name}:${src}`, text: `${name}'s randomness source was SWITCHED from ${before} to ${src} (${router ? `a drand adapter on router ${router}` : "not a drand adapter: the keeper can't deliver for it"}); only new requests use it` });
      }
    }
    return events;
  }

  /** Start-up: replace transactions an earlier run left waiting, and record the randomness sources. */
  async function startup() {
    const filled = await sender.fillNonceGaps();
    await watchSources().catch(() => []);
    return { filled, sources: Object.fromEntries(sources) };
  }

  return { tick, startup, sender, notifier, drand, jobs: { gradingsWaiting, burners, drops, behindAlert } };
}

const wallSec = (wall) => Number(wall());
