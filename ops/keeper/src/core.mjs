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
//   5. liquidity:   LiquidityBurner.run() when it has work worth the gas (coins to spend, sides to pair or even out,
//                   a side over its cap) or work has waited long enough
//   6. drops:       a Series nothing can still sell in (FireSale.status(fire).left 0: its groups' time ran out or
//                   its unlimited group idled out, with no purchase to close it) -> FireSale.close(fire) (the backup
//                   ACT_AFTER_SEC after the last group ended); a drop that hasn't sold out once its schedule is over
//                   (status.endableAt): alert (the owner can end it); once anyone can, FireSale.endDrop(fire)
//   7. health:      alerts (stale feeds, stuck opens/gradings, waiting fees, drand lag, low keeper ETH, a pause, a
//                   randomness switch, an unsold drop, FireSale's wallets or feeds changed by the owner) and a heartbeat
// Before sending, each call is checked again against the pending state (still due, not yet delivered, something to
// deal or burn) so a keeper never sends a transaction that would do nothing. The backup (KEEPER_ROLE=backup) acts only
// on work left waiting ACT_AFTER_SEC, and yields to the main keeper on a tie (tx.mjs).
import { encodeAbiParameters, keccak256, formatEther, formatUnits, zeroAddress } from "viem";
import {
  adapterAbi, cardsAbi, erc20Abi, feedAbi, groupsAbi, liquidityAbi, paperTwapAbi, pausableAbi, protectedEvent, psaAbi, routerAbi, saleAbi, saleSettingsEvents, twapAbi,
} from "./abis.mjs";
import { drandClient, roundAt, roundTime } from "./drand.mjs";
import { createSender, errMsg } from "./tx.mjs";
import { createNotifier } from "./alerts.mjs";

/** FireCards.CANCEL_AFTER and FirePsa.CANCEL_AFTER (24 h): an open or grading with no word this long after its request
 *  can be cancelled by anyone. */
const CANCEL_HOURS = 24;
const idsHash = (ids) => keccak256(encodeAbiParameters([{ type: "uint256[]" }], [ids]));

/** Alerts for opens and gradings still waiting: a round published but not delivered, no randomness yet, a ready open
 *  not dealt, a ready grading not finished (after STUCK_MIN), and URGENT once one has had no word for
 *  CANCEL_WARN_HOURS (anyone may cancel it CANCEL_HOURS after the request; drand rounds are public, so a holder who saw
 *  the word could cancel for a re-roll: deliver it before then). */
export function waitAlerts(items, now, cfg) {
  const alerts = [];
  const ago = (t) => Number(BigInt(now) - BigInt(t));
  const min = (s) => `${Math.round(s / 60)} min`;
  const stuck = cfg.stuckMin * 60;
  const cancelWarn = (cfg.cancelWarnHours ?? 6) * 3600;
  for (const it of items) {
    const name = it.kind === "open" ? `open ${it.fire}/${it.index}` : `grading ${it.index}`;
    if (!it.ready && it.roundAt !== undefined && ago(it.roundAt) > stuck) {
      alerts.push({ key: `stuck:${it.kind}:${it.fire ?? ""}:${it.index}`, text: `${name}: drand round ${it.round} was published ${min(ago(it.roundAt))} ago and still isn't delivered` });
    }
    if (!it.ready && it.roundAt === undefined && ago(it.requestedAt) > stuck + 93) {
      alerts.push({ key: `stuck:${it.kind}:${it.fire ?? ""}:${it.index}`, text: `${name}: requested ${min(ago(it.requestedAt))} ago, no randomness yet (source ${it.source})` });
    }
    if (!it.ready && ago(it.requestedAt) >= cancelWarn) {
      const left = CANCEL_HOURS * 3600 - ago(it.requestedAt);
      alerts.push({ key: `cancel:${it.kind}:${it.fire ?? ""}:${it.index}`, text: `URGENT ${name}: no word ${(ago(it.requestedAt) / 3600).toFixed(1)} h after the request; ${left > 0 ? `anyone can cancel it in ${(left / 3600).toFixed(1)} h` : "anyone can cancel it now"} (${it.kind === "open" ? "FireCards.cancelOpen" : "FirePsa.cancelGrading"}). Deliver its drand round now` });
    }
    if (it.kind === "open" && it.ready && it.head && it.count > 0n && ago(it.readyAt) > stuck) {
      alerts.push({ key: `deal:${it.fire}:${it.index}`, text: `${name}: ready ${min(ago(it.readyAt))} ago and still not dealt (FireCards.process)` });
    }
    if (it.kind === "grading" && it.ready && ago(it.requestedAt) > stuck + 93) {
      alerts.push({ key: `finish:${it.index}`, text: `${name}: randomness arrived but grades aren't set (FirePsa.finish) ${min(ago(it.requestedAt))} after the request` });
    }
  }
  return alerts;
}

/** The work a LiquidityBurner run would do, in dollars, from held() (18 decimals each): ETH + USDG to spend, the
 *  matching amount of each side to pair (at least $1), a PLANK side heavier than the PAPER side to even out, and a
 *  side over the $100 cap. 0 = nothing (a side waiting alone for the other is normal). */
export function liquidityWork([paperSide, plankSide, toSpend]) {
  const d = (x) => Number(formatUnits(x, 18));
  const [p, k, sp] = [d(paperSide), d(plankSide), d(toSpend)];
  const pair = Math.min(p, k) >= 1 ? 2 * Math.min(p, k) : 0;
  const even = k > p + 1 ? (k - p) / 2 : 0;
  const over = Math.max(p - 100, 0) + Math.max(k - 100, 0);
  return sp + pair + even + over;
}

/** Whether to run LiquidityBurner now (flushPlan: named for the burner flushes it first paced). `usd`: what it's worth (undefined: no price to value it); `waitedMs`: since
 *  it was first seen; `sinceFlushMs`: since this keeper last sent a flush for it (undefined: never). */
export function flushPlan({ usd, waitedMs, sinceFlushMs }, cfg) {
  const min = cfg.minFlushUsd ?? 1;
  if (usd !== undefined && usd >= min * (cfg.flushNowX ?? 25)) return { go: true, why: "large" };
  if (sinceFlushMs !== undefined && sinceFlushMs < (cfg.flushEveryMin ?? 15) * 60_000) return { go: false, why: "flushed recently" };
  if (usd !== undefined && usd >= min) return { go: true, why: "worth it" };
  if (waitedMs >= (cfg.flushMaxWaitHours ?? 6) * 3_600_000 && (usd === undefined || usd >= (cfg.flushDustUsd ?? 0.05))) return { go: true, why: "waited" };
  return { go: false, why: usd === undefined ? "no price yet" : "below the minimum" };
}

/** When the owner may end a drop that hasn't sold out (FireSale.status(fire).endableAt: its schedule over, and
 *  MIN_DROP_TIME after the start at the earliest), and when anyone may (END_GRACE later). As FireSale.endDrop. */
export function dropEndTimes(status, endGrace) {
  const owner = BigInt(status.endableAt);
  return { owner, anyone: owner + BigInt(endGrace) };
}

/** When the last of a drop's groups ended (FireGroups.groupsOf): once status.left is 0, the moment nothing could
 *  sell any more. */
export function lastGroupEnd(views) {
  let t = 0n;
  for (const v of views) if (BigInt(v.endsAt) > t) t = BigInt(v.endsAt);
  return t;
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
  const waitingSince = new Map(); // "LiquidityBurner" -> first seen with work (ms)
  const lastFlush = new Map(); // "LiquidityBurner" -> when this keeper last sent a run (ms)
  const stuckSince = new Map(); // "LiquidityBurner" -> since a run first left work behind (ms)
  const sources = new Map(); // "FireCards" | "FirePsa" -> randomness source last seen
  let saleLogFrom; // the next block to read FireSale's WalletsSet / FeedsSet from (set at the first pass)

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
  function behindAlert(ago) {
    if (!gradingsBehind.size) return undefined;
    const oldest = [...gradingsBehind.keys()].reduce((a, b) => (b < a ? b : a));
    const age = ago ? ago(gradingsBehind.get(oldest)) : 0;
    const late = age >= (cfg.cancelWarnHours ?? 6) * 3600
      ? ` It was requested ${(age / 3600).toFixed(1)} h ago: anyone can cancel a grading with no word ${CANCEL_HOURS} h after its request.`
      : "";
    return { key: "gradings:behind", text: `${gradingsBehind.size} unfinished grading(s) are older than the newest ${cfg.gradingLookback} (oldest: grading ${oldest}): the keeper sweeps them ${cfg.gradingLookback} per pass; check why they aren't finished.${late}` };
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

  // ------------------------------------------------------------------ liquidity
  /** LiquidityBurner.run() when its work is worth the gas (flushPlan: MIN_FLUSH_USD, at most once per FLUSH_EVERY_MIN,
   *  at once when large, small work once it has waited). Work a run left behind (the price guards, the pool's price
   *  off, a missing price) goes on `waiting` for the alert. */
  async function liquidity(waiting) {
    const address = C.liquidity;
    if (!address) return;
    const key = "LiquidityBurner";
    const held = () => read(address, liquidityAbi, "held");
    const work = liquidityWork(await held());
    if (work === 0) { waitingSince.delete(key); stuckSince.delete(key); return; }
    if (!waitingSince.has(key)) waitingSince.set(key, Date.now());
    const since = waitingSince.get(key);
    // the backup runs it only for work that has waited its grace period (the main keeper runs it at once)
    if (backup && Date.now() - since < Number(cfg.actAfterSec) * 1000) return;
    const plan = flushPlan({ usd: work, waitedMs: Date.now() - since, sinceFlushMs: lastFlush.has(key) ? Date.now() - lastFlush.get(key) : undefined }, cfg);
    if (!plan.go) {
      // still the work the last run left: keep the alert open
      if (stuckSince.has(key)) waiting.push({ key, name: key, work, since: stuckSince.get(key) });
      return;
    }
    if (!(await read(address, liquidityAbi, "keeper", [account.address]))) {
      waiting.push({ key, name: key, work, since, notKeeper: true });
      return;
    }
    const r = await sender.send({ address, abi: liquidityAbi, functionName: "run", args: [] }, { job: `run:${address}`, accept: (moved) => moved === true });
    if (r.status !== "skipped") {
      // a transaction went out: the next waits FLUSH_EVERY_MIN, and what's left counts as new from now
      lastFlush.set(key, Date.now());
      waitingSince.set(key, Date.now());
    }
    const left = liquidityWork(await held());
    if (left === 0) { waitingSince.delete(key); stuckSince.delete(key); return; }
    if (!stuckSince.has(key)) stuckSince.set(key, since);
    waiting.push({ key, name: key, work: left, since: stuckSince.get(key) });
  }

  // ------------------------------------------------------------------ drops
  /** Per configured, open drop (FireSale.status): nothing left that can still sell -> close it (anyone may; the
   *  backup only ACT_AFTER_SEC after the last group ended). Else, once its schedule is over and it hasn't sold out:
   *  an alert once the owner may end it; once anyone may, the keeper ends it itself (the backup ACT_AFTER_SEC after
   *  that). Returns { alerts, events }. */
  async function drops(now) {
    const sale = cfg.optional?.sale;
    const alerts = [];
    const events = [];
    if (!sale || !series.length) return { alerts, events };
    const grace = await once(sale, saleAbi, "END_GRACE");
    const sts = await Promise.all(series.map((f) => read(sale, saleAbi, "status", [f])));
    for (const [k, fire] of series.entries()) {
      const st = sts[k];
      if (!st.configured || st.closed || !st.live) continue;
      if (st.left === 0n) {
        if (backup) {
          const views = await read(await once(sale, saleAbi, "GROUPS"), groupsAbi, "groupsOf", [fire]);
          if (now < lastGroupEnd(views) + cfg.actAfterSec) continue; // the main keeper's, for now
        }
        const still = async (tag) => { const x = await read(sale, saleAbi, "status", [fire], tag); return x.configured && !x.closed && x.left === 0n; };
        const r = await sender.send({ address: sale, abi: saleAbi, functionName: "close", args: [fire] }, { job: `close:${fire}`, precheck: still });
        if (r.status === "done") {
          events.push({ key: `close:${fire}`, text: `Series ${fire}: nothing can still sell (its last group ended): this keeper closed it (FireSale.close(${fire})); its packs can be opened` });
        } else if (r.status !== "waiting" && r.reason !== "already done") {
          alerts.push({ key: `close:${fire}`, text: `Series ${fire}: nothing can still sell, but this keeper's FireSale.close(${fire}) didn't go through (${r.reason ?? r.status}): its packs can't be opened until it's closed` });
        }
        continue;
      }
      const at = dropEndTimes(st, grace);
      if (now < at.owner) continue;
      let why;
      if (now >= at.anyone + cfg.actAfterSec) {
        const open = async (tag) => { const x = await read(sale, saleAbi, "status", [fire], tag); return x.configured && !x.closed; };
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
      if (paperAge > cfg.paperStaleHours * 3600) alerts.push({ key: "feed:paper", text: `PAPER price stale: last checkpoint ${(paperAge / 3600).toFixed(1)} h ago (LiquidityBurner waits)` });
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
    // opens and gradings (gradings older than the window are covered by one alert: the sweep reaches each only once
    // per lap)
    alerts.push(...waitAlerts([...opens, ...gradings.filter((g) => !g.behind)], now, cfg));
    const behind = behindAlert(ago);
    if (behind) alerts.push(behind);
    for (const n of notes) {
      const name = n.it.kind === "open" ? `open ${n.it.fire}/${n.it.index}` : `grading ${n.it.index}`;
      alerts.push({ key: `note:${n.it.kind}:${n.it.fire ?? ""}:${n.it.index}`, text: `${name}: ${n.why}`, quiet: true });
    }
    // work waiting in LiquidityBurner
    for (const w of waiting) {
      const age = (Date.now() - w.since) / 60_000;
      if (cfg.once || age >= cfg.waitingAlertMin) {
        const amt = `$${w.work.toFixed(2)} of work`;
        alerts.push({ key: `waiting:${w.key}`, text: w.notKeeper
          ? `${w.name} has ${amt} and this keeper (${account.address}) isn't allowed to run it: the owner calls LiquidityBurner.setKeeper(${account.address}, true)`
          : `${w.name} has ${amt} a run couldn't do yet (Waiting: a price guard, the pool's price off, or a missing price feed)` });
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
    if (salePaused) alerts.push({ key: "pause:sale", repeat: false, text: "FireSale is PAUSED by the owner: buying (every group) and credit spending are stopped" });
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
    await job("liquidity", () => liquidity(waiting));
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
    const events = [...drop.events, ...((await job("randomness sources", () => watchSources())) ?? []), ...((await job("sale settings", () => saleSettings(block.number))) ?? [])];
    const sent = sender.sent();
    if (backup && sent.length) {
      events.push({ key: "backup-acted", text: `the backup keeper had to step in (${sent.length} tx: ${sent.map((s) => s.split(" ")[0]).join(", ")}); is the main keeper down?` });
    }
    await notifier.report(h.alerts, { balance: h.balance, series, opens: opens.length, gradings: gradingsAfter.length, sent: sent.length, address: account.address, now: wallSec(wall) }, events);
    // seconds until the soonest drand round still to come is published (keeper.mjs wakes then rather than at the interval)
    const due = [...opens, ...gradingsAfter].filter((it) => !it.ready && it.roundAt !== undefined).map((it) => it.roundAt + cfg.actAfterSec - now).filter((s) => s >= 0n);
    const nextRoundIn = due.length ? Number(due.reduce((a, b) => (b < a ? b : a))) : undefined;
    return { now, sent, dealt, finished, alerts: h.alerts, opens, gradings: gradingsAfter, waiting, series, nextRoundIn };
  }

  // ------------------------------------------------------------------ FireSale's wallets and feeds
  /** Events for each WalletsSet / FeedsSet FireSale emitted since the last pass (once per event; the first pass only
   *  starts watching from the next block, so a restart doesn't replay the deploy's own). A failed read is retried
   *  from the same block next pass. One-pass runs (ONCE) don't watch: the always-on keepers do. */
  async function saleSettings(latest) {
    const sale = cfg.optional?.sale;
    if (!sale || cfg.once) return [];
    if (saleLogFrom === undefined) { saleLogFrom = BigInt(latest) + 1n; return []; }
    if (BigInt(latest) < saleLogFrom) return [];
    const to = BigInt(latest) - saleLogFrom > 5000n ? saleLogFrom + 5000n : BigInt(latest);
    const logs = await pub.getLogs({ address: sale, events: saleSettingsEvents, fromBlock: saleLogFrom, toBlock: to });
    saleLogFrom = to + 1n;
    const not = (got, want, name) => (want && got.toLowerCase() !== want.toLowerCase() ? ` (NOT the deployed ${name} ${want})` : "");
    return logs.map((l) => {
      const a = l.args;
      const where = `block ${l.blockNumber}, tx ${l.transactionHash}`;
      const text = l.eventName === "WalletsSet"
        ? `FireSale's wallets were CHANGED by the owner (WalletsSet): revenue ${a.revenue}, LiquidityBurner ${a.liquidity}${not(a.liquidity, C.liquidity, "LiquidityBurner")} (${where}). If that wasn't you, pause the sale.`
        : `FireSale's price feeds were CHANGED by the owner (FeedsSet): ETH/USD ${a.ethUsd}, PLANK/USD ${a.plankUsd}${not(a.plankUsd, C.plankTwap, "PlankUsdTwap")}, PAPER/USD ${a.paperUsd}${not(a.paperUsd, C.paperTwap, "PaperUsdTwap")}, router ${a.router} (${where}). If that wasn't you, pause the sale.`;
      return { key: `sale:${l.eventName}:${l.transactionHash}:${l.logIndex}`, text };
    });
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

  return { tick, startup, sender, notifier, drand, jobs: { gradingsWaiting, liquidity, drops, behindAlert, saleSettings } };
}

const wallSec = (wall) => Number(wall());
