// The keeper's work, one pass at a time (tick). Every call it makes is permissionless; it has no special powers, it is
// just reliably awake. Order within a pass:
//   1. feeds:       PlankUsdTwap.checkpoint() and PaperUsdTwap.checkpoint() when due()
//   2. randomness:  for every open (FireCards) and grading (FirePsa) still waiting: if its source (an OpenVRFAdapter)
//                   already holds the word, adapter.settle(id); else, once drand has published the request's round,
//                   router.fulfillMany(ids, signatures) (the router verifies each signature; it skips ones already
//                   delivered, so racing another keeper or the site is harmless)
//   3. dealing:     FireCards.process(fire, maxCards) while a Series' queue head is ready
//   4. grading:     FirePsa.finish(index, ids) for ready gradings, ids from the grading's Protected event
//   5. burners:     PaperBurner.flush(pay) and PlankBurner.flush(pay) when they hold something and a flush would move it
//   6. health:      alerts (stale feeds, stuck opens/gradings, waiting fees, drand lag, low keeper ETH) and a heartbeat
import { encodeAbiParameters, keccak256, formatEther, formatUnits, zeroAddress } from "viem";
import {
  adapterAbi, burnerAbi, cardsAbi, erc20Abi, feedAbi, paperTwapAbi, protectedEvent, psaAbi, routerAbi, twapAbi,
} from "./abis.mjs";
import { drandClient, roundAt, roundTime } from "./drand.mjs";
import { createSender, errMsg } from "./tx.mjs";
import { createNotifier } from "./alerts.mjs";

const PAY = [["PLANK", 0], ["ETH", 1], ["USDG", 2]];
const idsHash = (ids) => keccak256(encodeAbiParameters([{ type: "uint256[]" }], [ids]));

export function createKeeper({ cfg, pub, wallet, account, log = console.log, fetchFn = globalThis.fetch, wallNow }) {
  const C = cfg.contracts;
  const drand = drandClient(cfg.drandUrls, fetchFn);
  const sender = createSender({ pub, wallet, account, log, maxFeeGwei: cfg.maxFeeGwei, receiptTimeoutMs: cfg.receiptTimeoutMs });
  const notifier = createNotifier({ cfg, log, fetchFn });
  const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
  const wall = wallNow ?? (() => BigInt(Math.floor(Date.now() / 1000)));

  // memory (lost on restart; a ONCE pass rebuilds what it needs)
  let series = cfg.series ? [...cfg.series] : [];
  let lastSeriesScan = 0;
  let gradingCursor;
  const sourceRouter = new Map(); // source -> router address | null (not a drand adapter)
  const idsOf = new Map(); // grading index -> ids (from its Protected event)
  const blockTs = new Map(); // block number -> timestamp
  const waitingSince = new Map(); // "burner:pay" -> first seen (ms)

  // ------------------------------------------------------------------ series and queues
  async function scanSeries() {
    // a new Series is noticed within a minute (at once while none is known)
    if (cfg.series || (series.length && Date.now() - lastSeriesScan < 60_000)) return series;
    const found = [];
    let top = BigInt(cfg.seriesScan);
    for (let f = 0n; f <= top; f++) {
      const [dealer] = await read(C.cards, cardsAbi, "fires", [f]);
      if (dealer !== zeroAddress) {
        found.push(f);
        if (f + 16n > top) top = f + 16n; // keep probing past the highest Series found
      }
    }
    series = found;
    lastSeriesScan = Date.now();
    return series;
  }

  async function opensWaiting() {
    const out = [];
    for (const fire of await scanSeries()) {
      const [queued] = await read(C.cards, cardsAbi, "pending", [fire]);
      if (queued === 0n) continue;
      const [head, count] = await Promise.all([read(C.cards, cardsAbi, "headOf", [fire]), read(C.cards, cardsAbi, "openCount", [fire])]);
      const end = count < head + 200n ? count : head + 200n;
      for (let i = head; i < end; i++) {
        const o = await read(C.cards, cardsAbi, "openOf", [fire, i]);
        out.push({ kind: "open", fire, index: i, head: i === head, source: o.source, requestId: o.requestId, requestedAt: o.requestedAt, ready: o.ready, readyAt: o.readyAt, count: o.count });
      }
    }
    return out;
  }

  async function gradingsWaiting() {
    const count = await read(C.psa, psaAbi, "gradingCount");
    const floor = count > BigInt(cfg.gradingLookback) ? count - BigInt(cfg.gradingLookback) : 0n;
    let i = cfg.once || gradingCursor === undefined || gradingCursor < floor ? floor : gradingCursor;
    const out = [];
    let advancing = true;
    for (; i < count; i++) {
      const g = await read(C.psa, psaAbi, "gradingOf", [i]);
      if (g.done) { if (advancing) gradingCursor = i + 1n; continue; }
      advancing = false;
      out.push({ kind: "grading", index: i, source: g.source, requestId: g.requestId, requestedAt: g.requestedAt, ready: g.ready, idsHash: g.idsHash });
    }
    if (advancing) gradingCursor = count;
    return out;
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
    for (const it of items) {
      if (it.ready) continue;
      const router = await routerOf(it.source);
      if (!router) { notes.push({ it, why: `source ${it.source} isn't a drand adapter` }); continue; }
      const req = await read(router, routerAbi, "requests", [it.requestId]);
      const [consumer, round, , fulfilled] = req;
      if (consumer.toLowerCase() !== it.source.toLowerCase()) { notes.push({ it, why: `router request ${it.requestId} belongs to ${consumer}` }); continue; }
      it.round = round;
      it.roundAt = roundTime(round);
      if (fulfilled) {
        // the router holds the word but the callback didn't land: deliver the same word
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
        const r = await sender.send(
          { address: router, abi: routerAbi, functionName: "fulfillMany", args: [ids, part.map((p) => p.sig)] },
          { job: `fulfillMany:${router}:${ids.join(",")}` },
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
        if (now < o.readyAt + cfg.actAfterSec) break;
        const r = await sender.send({ address: C.cards, abi: cardsAbi, functionName: "process", args: [fire, cfg.processMaxCards] }, { job: `process:${fire}` });
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
      const r = await sender.send({ address: C.psa, abi: psaAbi, functionName: "finish", args: [g.index, ids] }, { job: `finish:${g.index}` });
      if (r.status === "done") { finished++; idsOf.delete(g.index); }
      else if (r.status !== "waiting") notes.push({ it: g, why: `finish: ${r.reason ?? r.status}` });
    }
    return finished;
  }

  // ------------------------------------------------------------------ burners
  async function burners(waiting) {
    for (const [name, address] of [["PaperBurner", C.paperBurner], ["PlankBurner", C.plankBurner]]) {
      const [plank, usdg] = await Promise.all([read(address, burnerAbi, "PLANK"), read(address, burnerAbi, "USDG")]);
      for (const [pay, code] of PAY) {
        const token = pay === "PLANK" ? plank : pay === "USDG" ? usdg : undefined;
        if (pay === "USDG" && usdg === zeroAddress) continue;
        const held = pay === "ETH" ? await pub.getBalance({ address }) : await read(token, erc20Abi, "balanceOf", [address]);
        const key = `${name}:${pay}`;
        if (held === 0n) { waitingSince.delete(key); continue; }
        const r = await sender.send(
          { address, abi: burnerAbi, functionName: "flush", args: [code] },
          { job: `flush:${address}:${code}`, accept: (out) => out > 0n },
        );
        const left = pay === "ETH" ? await pub.getBalance({ address }) : await read(token, erc20Abi, "balanceOf", [address]);
        if (left === 0n) { waitingSince.delete(key); continue; }
        if (!waitingSince.has(key)) waitingSince.set(key, Date.now());
        waiting.push({ key, name, pay, amount: left, since: waitingSince.get(key), flushed: r.status === "done" });
      }
    }
  }

  // ------------------------------------------------------------------ feeds
  async function feeds(now) {
    for (const [name, address] of [["PlankUsdTwap", C.plankTwap], ["PaperUsdTwap", C.paperTwap]]) {
      if (!(await read(address, twapAbi, "due"))) continue;
      if (cfg.actAfterSec > 0n) {
        // the backup only steps in when the main keeper is late rolling a window (candidate pools are the main
        // keeper's job)
        const [, lastTs] = await read(address, twapAbi, "last");
        const minWindow = await read(address, twapAbi, "MIN_WINDOW");
        if (name === "PaperUsdTwap" && (await read(address, paperTwapAbi, "pair")) === zeroAddress) continue;
        if (now < BigInt(lastTs) + minWindow + cfg.actAfterSec) continue;
      }
      await sender.send({ address, abi: twapAbi, functionName: "checkpoint" }, { job: `checkpoint:${address}` });
    }
  }

  // ------------------------------------------------------------------ health
  async function health({ now, opens, gradings, notes, waiting, failed }) {
    const alerts = [];
    const ago = (t) => Number(now - BigInt(t));
    const min = (s) => `${Math.round(s / 60)} min`;
    // feeds
    const [plankLast, plankPx] = await Promise.all([read(C.plankTwap, twapAbi, "last"), read(C.plankTwap, twapAbi, "latestRoundData")]);
    const plankAge = ago(plankLast[1]);
    if (plankAge > cfg.plankStaleMin * 60) alerts.push({ key: "feed:plank", text: `PLANK price stale: last checkpoint ${min(plankAge)} ago (FireSale stops PLANK pricing at 2 h)` });
    else if (plankPx[1] <= 0n) alerts.push({ key: "feed:plank0", text: "PLANK price reads 0 (no full window yet, or the ETH/USD feed is stale)" });
    const paperPair = await read(C.paperTwap, paperTwapAbi, "pair");
    if (paperPair !== zeroAddress) {
      const paperLast = await read(C.paperTwap, twapAbi, "last");
      const paperAge = ago(paperLast[1]);
      if (paperAge > cfg.paperStaleHours * 3600) alerts.push({ key: "feed:paper", text: `PAPER price stale: last checkpoint ${(paperAge / 3600).toFixed(1)} h ago (PaperBurner waits at 2 days)` });
    }
    if (cfg.ethUsdFeed) {
      const [, ethPx, , updated] = await read(cfg.ethUsdFeed, feedAbi, "latestRoundData");
      const age = ago(updated);
      if (ethPx <= 0n || age > cfg.ethStaleHours * 3600) alerts.push({ key: "feed:eth", text: `ETH/USD feed stale: updated ${(age / 3600).toFixed(1)} h ago (prices stop at 25 h)` });
    }
    // opens and gradings
    const stuck = cfg.stuckMin * 60;
    for (const it of [...opens, ...gradings]) {
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
    for (const n of notes) {
      const name = n.it.kind === "open" ? `open ${n.it.fire}/${n.it.index}` : `grading ${n.it.index}`;
      alerts.push({ key: `note:${n.it.kind}:${n.it.fire ?? ""}:${n.it.index}`, text: `${name}: ${n.why}`, quiet: true });
    }
    // fees waiting in the burners
    for (const w of waiting) {
      const age = (Date.now() - w.since) / 60_000;
      if (cfg.once || age >= cfg.waitingAlertMin) {
        const amt = w.pay === "ETH" ? `${formatEther(w.amount)} ETH` : w.pay === "USDG" ? `${formatUnits(w.amount, 6)} USDG` : `${formatEther(w.amount)} PLANK`;
        alerts.push({ key: `waiting:${w.key}`, text: `${w.name} holds ${amt} it can't burn yet (Waiting: price guard or a missing price feed)` });
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
    let gradings = (await job("scan gradings", gradingsWaiting)) ?? [];
    await job("randomness", () => deliver([...opens, ...gradings], now, notes));
    const dealt = (await job("deal", () => dealReady(now))) ?? 0;
    // re-read the gradings: some just became ready
    if (gradings.some((g) => !g.ready)) gradings = (await job("rescan gradings", gradingsWaiting)) ?? gradings;
    const finished = (await job("finish", () => finishReady(gradings, now, block.number, notes))) ?? 0;
    await job("burners", () => burners(waiting));
    // what's still waiting after this pass's work, for the alerts
    const after = (await job("rescan opens", opensWaiting)) ?? opens;
    for (const o of after) {
      const before = opens.find((x) => x.fire === o.fire && x.index === o.index);
      if (before?.roundAt !== undefined) Object.assign(o, { round: before.round, roundAt: before.roundAt });
    }
    opens = after;
    const gradingsAfter = (await job("rescan gradings", gradingsWaiting)) ?? gradings;
    for (const g of gradingsAfter) {
      const before = gradings.find((x) => x.index === g.index);
      if (before?.roundAt !== undefined) Object.assign(g, { round: before.round, roundAt: before.roundAt });
    }
    const h = (await job("health", () => health({ now, opens, gradings: gradingsAfter, notes, waiting, failed }))) ?? { alerts: [{ key: "health", text: "health check failed" }] };
    const sent = sender.sent();
    if (cfg.once && cfg.actAfterSec > 0n && sent.length) {
      h.alerts.push({ key: "backup-acted", text: `the backup keeper had to step in (${sent.length} tx: ${sent.map((s) => s.split(" ")[0]).join(", ")}); is the main keeper down?` });
    }
    await notifier.report(h.alerts, { balance: h.balance, series, opens: opens.length, gradings: gradingsAfter.length, sent: sent.length, address: account.address, now: wallSec(wall) });
    return { now, sent, dealt, finished, alerts: h.alerts, opens, gradings: gradingsAfter, waiting, series };
  }

  return { tick, sender, notifier, drand };
}

const wallSec = (wall) => Number(wall());
