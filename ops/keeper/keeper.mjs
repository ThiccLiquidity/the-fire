// The Fire keeper: the jobs nobody should have to press a button for.
//   - roll()             once the nightly roll time has passed
//   - router.fulfill()   fetch the drand signature for the roll's round and submit it (anyone may; the router
//                        verifies it, so the keeper can't change the number — it's just the fastest deliverer)
//   - adapter.settle(id) if the router has the number but the callback didn't land
//   - reroll()           if a roll has had no answer for REROLL_AFTER (2h) AND the drand relays say the round isn't out
//                        yet (drand stalled). If the keeper just can't reach drand it doesn't reroll: a published
//                        number must never be thrown away because of our network.
//   - checkpoint()       the Fire's PLANK/USD feed every 30 minutes (its window); the PAPER/USD feed when due()
//                        (adopting PAPER's pool once someone creates one)
//   - sweep the mill floor: buy the cheapest OpenSea listing at or under the fire's bid that the fund can pay
//     (only if OPENSEA_API_KEY is set; checks every SWEEP_EVERY_SEC, default 300, to respect API limits)
// Every call here is permissionless: the keeper has no special powers, it's just reliably awake.
// Optional: DRAND_URLS (comma-separated; default the three public api*.drand.sh relays).
// Env: RPC_URL (or RPC_URL_FILE), FIRE, KEEPER_KEY_FILE (default /run/secrets/keeper-key), EXPECTED_CHAIN_ID
//      (default 4663), FALLBACK_RPC_URL (default the public Robinhood Chain RPC on 4663; "none" to disable),
//      INTERVAL_SEC (default 30), ONCE=1 for a single pass, MAX_FEE_GWEI (optional cap), LOW_BALANCE_ETH (default 0.002),
//      HEALTHCHECK_URL: a healthchecks.io ping URL. Pinged only when the game is actually moving (no job failing, no
//      overdue roll, no unanswered request, no stuck transaction, balance OK); otherwise <url>/fail gets the reason.
//      The key comes from the file only. KEEPER_KEY in the environment is refused (it leaks into `docker inspect` and
//      shell history) unless ALLOW_KEY_ENV=1 is set, for local dev.
//      Sweeping: OPENSEA_API_KEY (or OPENSEA_API_KEY_FILE), COLLECTION (default the-plank-press), OPENSEA_API (default
//      https://api.opensea.io).
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, fallback, parseAbi, defineChain } from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";

const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const fileOr = (k, fileKey, def) => env(k) ?? (env(fileKey, def) && tryRead(env(fileKey, def)));
const tryRead = (f) => { try { return readFileSync(f, "utf8").trim(); } catch { return undefined; } };
const RPC = fileOr("RPC_URL", "RPC_URL_FILE");
const FIRE = env("FIRE");
const EXPECTED_CHAIN_ID = Number(env("EXPECTED_CHAIN_ID", "4663"));
if (!RPC || !FIRE) { console.error("Set RPC_URL (or RPC_URL_FILE) and FIRE"); process.exit(1); }
// The key comes from a file (written by keeper-setup.sh from a hidden tty prompt), never from the environment.
const ALLOW_KEY_ENV = env("ALLOW_KEY_ENV") === "1";
if (env("KEEPER_KEY") && !ALLOW_KEY_ENV) {
  console.error("KEEPER_KEY in the environment is refused: it ends up in `docker inspect` and shell history. Mount the key file (KEEPER_KEY_FILE) instead. (ALLOW_KEY_ENV=1 allows it for local dev only.)");
  process.exit(1);
}
const key = (ALLOW_KEY_ENV && env("KEEPER_KEY")) || tryRead(env("KEEPER_KEY_FILE", "/run/secrets/keeper-key"));
if (!key) { console.error("No keeper key: mount it and set KEEPER_KEY_FILE"); process.exit(1); }
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`, { nonceManager });
const errMsg = (e) => e?.shortMessage ?? String(e?.message ?? e).split("\n")[0]; // never the full error: it can carry the RPC URL

// RPC: the configured one first, then the public Robinhood Chain RPC if the first is down (mainnet only by default).
const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const FALLBACK_RPC = env("FALLBACK_RPC_URL", EXPECTED_CHAIN_ID === 4663 ? PUBLIC_RPC : "none");
const RPCS = [RPC, ...(FALLBACK_RPC !== "none" && FALLBACK_RPC !== RPC ? [FALLBACK_RPC] : [])];
const transport = RPCS.length > 1 ? fallback(RPCS.map((u) => http(u))) : http(RPC);

const pub = createPublicClient({ transport });
let chain;
try {
  const id = await createPublicClient({ transport: http(RPC) }).getChainId();
  if (id !== EXPECTED_CHAIN_ID) throw new Error(`RPC is on chain ${id}, expected ${EXPECTED_CHAIN_ID}`);
  if (RPCS.length > 1) {
    const fid = await createPublicClient({ transport: http(RPCS[1]) }).getChainId().catch((e) => { console.error("warning: fallback RPC unreachable at startup:", errMsg(e)); return id; });
    if (fid !== EXPECTED_CHAIN_ID) throw new Error(`fallback RPC is on chain ${fid}, expected ${EXPECTED_CHAIN_ID} (set FALLBACK_RPC_URL, or none)`);
  }
  if (!(await pub.getCode({ address: FIRE }))) throw new Error(`no contract at FIRE ${FIRE}`);
  chain = defineChain({ id, name: "chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: RPCS } } });
} catch (e) { console.error("startup failed:", errMsg(e)); process.exit(1); }
const wallet = createWalletClient({ account, chain, transport });
const MAX_FEE = env("MAX_FEE_GWEI") ? BigInt(Math.round(Number(env("MAX_FEE_GWEI")) * 1e9)) : undefined;

const fireAbi = parseAbi([
  "function nextRollAt() view returns (uint256)",
  "function pendingRequest() view returns (uint256)",
  "function pendingSince() view returns (uint256)",
  "function abandoned() view returns (bool)",
  "function randomness() view returns (address)",
  "function REROLL_AFTER() view returns (uint256)",
  "function PLANK_USD() view returns (address)",
  "function roll()",
  "function reroll()",
]);
const adapterAbi = parseAbi(["function answered(uint256) view returns (bool)", "function settle(uint256)", "function ROUTER() view returns (address)"]);
const routerAbi = parseAbi([
  "function requests(uint256) view returns (address consumer, uint64 round, uint32 callbackGasLimit, bool fulfilled, bool delivered, uint256 randomWord, uint256 fee)",
  "function fulfill(uint256 id, bytes signature)",
  "function GENESIS() view returns (uint256)",
  "function PERIOD() view returns (uint256)",
  "function CHAIN_HASH() view returns (bytes32)",
]);
const DRAND_URLS = env("DRAND_URLS", "https://api.drand.sh,https://api2.drand.sh,https://api3.drand.sh").split(",").map((u) => u.trim().replace(/\/$/, ""));

/** The drand evmnet signature for a round (64 bytes hex), from the first relay that has it. The router verifies it.
 *  Also reports what the relays said: `behind` = at least one relay answered and every answer's latest round is
 *  older than ours (drand really hasn't published it). Only that justifies a reroll. */
async function drandSignature(chainHash, round) {
  let answered = 0, ahead = 0;
  for (const base of DRAND_URLS) {
    try {
      const r = await fetch(`${base}/${chainHash.slice(2)}/public/${round}`, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const b = await r.json();
        if (String(b.round) === String(round) && /^[0-9a-f]{128}$/i.test(b.signature)) return { sig: `0x${b.signature}` };
      }
      const l = await fetch(`${base}/${chainHash.slice(2)}/public/latest`, { signal: AbortSignal.timeout(10_000) });
      if (!l.ok) continue;
      answered++;
      if (BigInt((await l.json()).round) >= round) ahead++;
    } catch { /* next relay */ }
  }
  return { behind: answered > 0 && ahead === 0 };
}
const millAbi = parseAbi([
  "function millBid() view returns (uint256)",
  "function USDG() view returns (address)",
  "function ETH_USD() view returns (address)",
  "function MILL() view returns (address)",
  "function millFundUsdg() view returns (uint256)",
  "function eatMillFromSeaport(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, bytes signature) order, bytes extraData) payable",
]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"]);
const burnFeeAbi = parseAbi(["function burnFee() view returns (uint256)"]);
const decimalsAbi = parseAbi(["function decimals() view returns (uint8)"]);
const paperTwapAbi = parseAbi(["function due() view returns (bool)", "function checkpoint()"]);
const paperFeedAbi = parseAbi(["function PAPER_USD() view returns (address)"]);
const twapAbi = parseAbi(["function last() view returns (uint256 cum, uint32 ts)", "function MIN_WINDOW() view returns (uint256)", "function checkpoint()"]);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

// One transaction in flight per job, tracked as { hashes, nonce, fee, firstSentAt, sentAt } plus the call itself.
// While it's in flight the job doesn't send again. reconcile() runs at the start of every pass and checks each one:
//   - a receipt (for any of its hashes): done;
//   - the node no longer knows it (dropped) after DROP_GRACE, or still unmined after STUCK: if its nonce is still open,
//     re-send at the SAME nonce with a higher fee (the original call if it would still succeed, else a 0-ETH transfer
//     to ourselves to fill the nonce). Same nonce means at most one of them can ever land, so nothing is done twice,
//     and later transactions aren't stuck behind a gap. If something else already used that nonce, forget it and
//     reset the nonce manager, so the job re-sends (if still needed) with a fresh nonce.
const inflight = new Map();
const STUCK_MS = 10 * 60_000, DROP_GRACE_MS = 60_000, HEALTH_TX_MS = 15 * 60_000;
const nonceKey = () => ({ address: account.address, chainId: chain.id });
const resetNonce = () => account.nonceManager.reset(nonceKey());
// Nonce allocation and broadcast happen one at a time (the jobs run in parallel).
let lock = Promise.resolve();
const serial = (fn) => { const p = lock.then(fn, fn); lock = p.catch(() => {}); return p; };
const notFound = (e) => e?.name === "TransactionNotFoundError" || e?.name === "TransactionReceiptNotFoundError";

/** Fees for a new send, or (with prev) for a same-nonce replacement: at least 25% above prev, as nodes require. */
async function fees(prev) {
  const est = await pub.estimateFeesPerGas();
  let prio = est.maxPriorityFeePerGas ?? 0n, max = est.maxFeePerGas;
  if (prev) {
    const bump = (x) => (x * 5n) / 4n + 1n;
    if (bump(prev.maxPriorityFeePerGas) > prio) prio = bump(prev.maxPriorityFeePerGas);
    if (bump(prev.maxFeePerGas) > max) max = bump(prev.maxFeePerGas);
  }
  if (max < prio) max = prio;
  if (MAX_FEE && max > MAX_FEE) {
    if (prev) return undefined; // can't outbid the stuck one under the cap
    max = MAX_FEE;
    if (prio > max) prio = max;
  }
  return { maxFeePerGas: max, maxPriorityFeePerGas: prio };
}
const write = (c, nonce, fee) => wallet.writeContract({ address: c.address, abi: c.abi, functionName: c.functionName, args: c.args, value: c.value, nonce, ...fee });

async function send(address, abi, functionName, args = [], value = 0n) {
  const job = `${address}:${functionName}`;
  const prev = inflight.get(job);
  if (prev) { log(`${functionName}: still waiting on ${prev.hashes.at(-1)} (nonce ${prev.nonce})`); return false; }
  // Simulate first: if the contract says no (someone else already did it), skip quietly.
  try { await pub.simulateContract({ account, address, abi, functionName, args, value }); }
  catch (e) { log(`skip ${functionName}: ${errMsg(e)}`); return false; }
  const call = { address, abi, functionName, args, value };
  const entry = await serial(async () => {
    const fee = await fees();
    const nonce = await account.nonceManager.consume({ ...nonceKey(), client: pub });
    let hash;
    try { hash = await write(call, nonce, fee); }
    catch (e) { resetNonce(); throw e; } // the nonce wasn't used: re-read it from the chain next time
    const t = Date.now();
    const en = { ...call, hashes: [hash], cancels: new Set(), nonce, fee, firstSentAt: t, sentAt: t };
    inflight.set(job, en);
    return en;
  });
  const hash = entry.hashes[0];
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 }).catch(() => undefined);
  if (!r) { log(`${functionName}: sent ${hash} (nonce ${entry.nonce}), no receipt yet`); return false; }
  inflight.delete(job);
  log(`${functionName} ${r.status} ${hash}`);
  return r.status === "success";
}

async function receiptOf(hashes) {
  for (const hash of hashes) {
    try { return await pub.getTransactionReceipt({ hash }); } catch (e) { if (!notFound(e)) throw e; }
  }
  return undefined;
}
async function knownAny(hashes) {
  for (const hash of hashes) {
    try { await pub.getTransaction({ hash }); return true; } catch (e) { if (!notFound(e)) throw e; }
  }
  return false;
}

async function reconcile() {
  for (const [job, e] of inflight) {
    const last = e.hashes.at(-1);
    try {
      const r = await receiptOf(e.hashes);
      if (r) {
        inflight.delete(job);
        log(e.cancels.has(r.transactionHash) ? `${e.functionName}: nonce ${e.nonce} filled by cancel ${r.transactionHash}` : `${e.functionName} ${r.status} ${r.transactionHash} (late receipt)`);
        continue;
      }
      const age = Date.now() - e.sentAt;
      const known = await knownAny(e.hashes);
      if (known ? age < STUCK_MS : age < DROP_GRACE_MS) { log(`${e.functionName}: still waiting on ${last} (nonce ${e.nonce})`); continue; }
      const why = known ? `stuck ${Math.round(age / 60_000)} min` : "dropped";
      const used = await pub.getTransactionCount({ address: account.address, blockTag: "latest" });
      if (used > e.nonce) {
        const r2 = await receiptOf(e.hashes); // it may have just landed
        inflight.delete(job);
        resetNonce();
        log(r2 ? `${e.functionName} ${r2.status} ${r2.transactionHash} (late receipt)` : `${e.functionName}: ${why}; nonce ${e.nonce} was used by another transaction. Dropped ${last}; will re-send if still needed`);
        continue;
      }
      // A lower nonce we aren't tracking (say, a send that errored but reached the node and was later dropped) would
      // hold this one back forever: fill it with a 0-ETH transfer to ourselves.
      const tracked = new Set([...inflight.values()].map((x) => x.nonce));
      for (let n = Number(used); n < e.nonce; n++) {
        if (tracked.has(n)) continue;
        const gapFee = await fees();
        const h = await serial(() => wallet.sendTransaction({ to: account.address, value: 0n, nonce: n, ...gapFee })).catch((err) => { log(`nonce gap ${n}: fill failed: ${errMsg(err)}`); });
        if (!h) continue;
        const t = Date.now(); // tracked like any other job, so it gets bumped or dropped the same way
        inflight.set(`gap:${n}`, { functionName: `nonce-gap ${n}`, cancelOnly: true, hashes: [h], cancels: new Set([h]), nonce: n, fee: gapFee, firstSentAt: t, sentAt: t });
        log(`nonce gap ${n} (below ${e.functionName}'s ${e.nonce}): filled with ${h}`);
      }
      const fee = await fees(e.fee);
      if (!fee) { log(`ALERT ${e.functionName}: ${why} tx ${last} needs a fee above MAX_FEE_GWEI to replace; still waiting`); continue; }
      let still = !e.cancelOnly;
      if (still) try { await pub.simulateContract({ account, address: e.address, abi: e.abi, functionName: e.functionName, args: e.args, value: e.value }); }
      catch { still = false; }
      const hash = await serial(() => (still ? write(e, e.nonce, fee) : wallet.sendTransaction({ to: account.address, value: 0n, nonce: e.nonce, ...fee })));
      e.hashes.push(hash); e.fee = fee; e.sentAt = Date.now();
      if (!still) e.cancels.add(hash);
      log(`${e.functionName}: ${why} tx ${last}; ${still ? "re-sent" : "no longer needed, cancelled"} at nonce ${e.nonce} as ${hash}`);
    } catch (err) { log(`${e.functionName}: couldn't check/replace ${last}: ${errMsg(err)}`); }
  }
}

// ---------------------------------------------------------------- mill floor sweep
const OS_KEY = env("OPENSEA_API_KEY") ?? (env("OPENSEA_API_KEY_FILE") ? readFileSync(env("OPENSEA_API_KEY_FILE"), "utf8").trim() : undefined);
const OS_API = env("OPENSEA_API", "https://api.opensea.io");
const COLLECTION = env("COLLECTION", "the-plank-press");
const SWEEP_EVERY = BigInt(env("SWEEP_EVERY_SEC", "300"));
let lastSweep = 0n;

async function os(path, body) {
  const r = await fetch(OS_API + path, {
    method: body ? "POST" : "GET",
    headers: { "x-api-key": OS_KEY, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`OpenSea ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** OpenSea's JSON order -> the tuple eatMillFromSeaport takes (numbers as bigint). */
function toOrder(o) {
  const p = o.parameters;
  const n = (x) => BigInt(x);
  return {
    parameters: {
      offerer: p.offerer, zone: p.zone,
      offer: p.offer.map((i) => ({ itemType: Number(i.itemType), token: i.token, identifierOrCriteria: n(i.identifierOrCriteria), startAmount: n(i.startAmount), endAmount: n(i.endAmount) })),
      consideration: p.consideration.map((i) => ({ itemType: Number(i.itemType), token: i.token, identifierOrCriteria: n(i.identifierOrCriteria), startAmount: n(i.startAmount), endAmount: n(i.endAmount), recipient: i.recipient })),
      orderType: Number(p.orderType), startTime: n(p.startTime), endTime: n(p.endTime), zoneHash: p.zoneHash, salt: n(p.salt),
      conduitKey: p.conduitKey, totalOriginalConsiderationItems: n(p.totalOriginalConsiderationItems ?? p.consideration.length),
    },
    signature: o.signature ?? "0x",
  };
}

async function sweep(now) {
  if (!OS_KEY || now < lastSweep + SWEEP_EVERY) return;
  lastSweep = now;
  const [bid, usdg, feed, mill] = await Promise.all([read(FIRE, millAbi, "millBid"), read(FIRE, millAbi, "USDG"), read(FIRE, millAbi, "ETH_USD"), read(FIRE, millAbi, "MILL")]);
  const [ethFund, usdgFund, [, ethUsd], fee] = await Promise.all([
    pub.getBalance({ address: FIRE }), read(FIRE, millAbi, "millFundUsdg"), read(feed, feedAbi, "latestRoundData"), read(mill, burnFeeAbi, "burnFee"),
  ]);
  const usdgUnit = usdg === "0x0000000000000000000000000000000000000000" ? 1n : 10n ** BigInt(await read(usdg, decimalsAbi, "decimals"));
  const { listings = [] } = await os(`/api/v2/listings/collection/${COLLECTION}/best?limit=20`);
  // Price every listing in USD (8 decimals), cheapest first.
  const priced = listings.map((l) => {
    const c = l.protocol_data?.parameters?.consideration ?? [];
    const inEth = c.length > 0 && c.every((i) => Number(i.itemType) === 0);
    const inUsdg = c.length > 0 && c.every((i) => Number(i.itemType) === 1 && i.token.toLowerCase() === usdg.toLowerCase());
    const total = c.reduce((a, i) => a + (BigInt(i.startAmount) > BigInt(i.endAmount) ? BigInt(i.startAmount) : BigInt(i.endAmount)), 0n);
    const usd = inEth ? (total * ethUsd) / 10n ** 18n : inUsdg ? (total * 10n ** 8n) / usdgUnit : undefined;
    return { l, inEth, total, usd };
  }).filter((x) => x.usd !== undefined).sort((a, b) => (a.usd < b.usd ? -1 : 1));
  const affordable = priced.filter((x) => x.usd <= bid && (x.inEth ? ethFund >= x.total + fee : usdgFund >= x.total));
  log(`sweep: bid $${Number(bid) / 1e8}, fund ${Number(ethFund) / 1e18} ETH + $${Number(usdgFund) / Number(usdgUnit)} USDG, ${priced.length} listings, cheapest $${priced[0] ? Number(priced[0].usd) / 1e8 : "-"}`);
  // Cheapest first; a listing that's cancelled or no longer approved fails its simulation and we try the next.
  // The contract re-checks the price, the currency and that it's a mill, so a bad API answer can't overpay.
  for (const best of affordable.slice(0, 5)) {
    try {
      const fd = await os("/api/v2/listings/fulfillment_data", {
        listing: { hash: best.l.order_hash, chain: best.l.chain, protocol_address: best.l.protocol_address },
        fulfiller: { address: FIRE },
      });
      const signed = fd.fulfillment_data?.orders?.[0] ?? best.l.protocol_data;
      const extraData = fd.fulfillment_data?.transaction?.input_data?.advancedOrder?.extraData ?? "0x";
      const attach = best.inEth || ethFund >= fee ? 0n : fee; // USDG-only fund: we pay the 0.0003 ETH burn fee
      log(`sweep: trying ${best.l.order_hash} for $${Number(best.usd) / 1e8}`);
      if (await send(FIRE, millAbi, "eatMillFromSeaport", [toOrder(signed), extraData], attach)) return;
    } catch (e) { log(`sweep: ${best.l.order_hash} failed: ${errMsg(e)}`); }
  }
}

const LOW_BALANCE = BigInt(Math.round(Number(env("LOW_BALANCE_ETH", "0.002")) * 1e18));
let plankTwap;
// Each job runs on its own, so one failing (say, a race on roll) never stops the others.
async function job(name, fn) { try { await fn(); return true; } catch (e) { log(`${name} failed: ${errMsg(e)}`); return false; } }

async function randomnessJob(now) {
  const [nextRollAt, pending, since, adapter, rerollAfter, abandoned] = await Promise.all([
    read(FIRE, fireAbi, "nextRollAt"), read(FIRE, fireAbi, "pendingRequest"), read(FIRE, fireAbi, "pendingSince"),
    read(FIRE, fireAbi, "randomness"), read(FIRE, fireAbi, "REROLL_AFTER"), read(FIRE, fireAbi, "abandoned"),
  ]);
  if (abandoned) return; // the game is over: nothing to roll (the mill sweep goes on)
  if (pending === 0n) {
    if (now >= nextRollAt) await send(FIRE, fireAbi, "roll");
  } else if (await read(adapter, adapterAbi, "answered", [pending])) {
    // The router has the number but the Fire doesn't: its callback failed. Deliver it.
    if (now >= since + 60n) await send(adapter, adapterAbi, "settle", [pending]);
  } else {
    // Waiting on drand. Once the round is out, submit its signature. A late number always beats a re-roll.
    const router = await read(adapter, adapterAbi, "ROUTER");
    const [[, round], genesis, period, chainHash] = await Promise.all([
      read(router, routerAbi, "requests", [pending]), read(router, routerAbi, "GENESIS"), read(router, routerAbi, "PERIOD"), read(router, routerAbi, "CHAIN_HASH"),
    ]);
    const d = now >= genesis + (round - 1n) * period ? await drandSignature(chainHash, round) : {};
    if (d.sig) await send(router, routerAbi, "fulfill", [pending, d.sig]);
    else if (now >= since + rerollAfter && d.behind) {
      log(`request ${pending}: drand hasn't published round ${round} after ${now - since}s — rerolling`);
      await send(FIRE, fireAbi, "reroll");
    } else if (now >= since + rerollAfter) log(`ALERT request ${pending}: can't reach drand for round ${round}; not rerolling (check this box's network)`);
    else log(`request ${pending}: waiting for drand round ${round}`);
  }
}

/** What's wrong with the game right now, judged from the chain after this pass's jobs ran ([] = healthy). */
async function problems(results) {
  const p = [];
  if (!results.every(Boolean)) p.push("a keeper job failed (docker logs)");
  const [now, nextRollAt, pending, since, abandoned] = await Promise.all([
    pub.getBlock().then((b) => b.timestamp), read(FIRE, fireAbi, "nextRollAt"), read(FIRE, fireAbi, "pendingRequest"),
    read(FIRE, fireAbi, "pendingSince"), read(FIRE, fireAbi, "abandoned"),
  ]);
  if (!abandoned) {
    if (pending === 0n && now > nextRollAt + 600n) p.push(`storm overdue: no roll ${(now - nextRollAt) / 60n} min after roll time`);
    // pendingSince restarts at each reroll, so a drand stall shows here until the 2h reroll, then again 15 min later.
    if (pending !== 0n && now > since + 900n) p.push(`roll request unanswered for ${(now - since) / 60n} min`);
  }
  for (const e of inflight.values()) {
    const age = Date.now() - e.firstSentAt;
    if (age > HEALTH_TX_MS) p.push(`${e.functionName} tx in flight ${Math.round(age / 60_000)} min (nonce ${e.nonce})`);
  }
  const bal = await pub.getBalance({ address: account.address });
  if (bal < LOW_BALANCE) p.push(`keeper balance low: ${Number(bal) / 1e18} ETH`);
  return p;
}

const HEALTH = env("HEALTHCHECK_URL")?.replace(/\/$/, "");
async function ping(p) {
  if (p.length) log(`ALERT unhealthy: ${p.join("; ")}`);
  if (!HEALTH) return;
  const signal = AbortSignal.timeout(10_000);
  await (p.length ? fetch(`${HEALTH}/fail`, { method: "POST", body: p.join("; ").slice(0, 2000), signal }) : fetch(HEALTH, { signal })).catch(() => {});
}

async function tick() {
  await reconcile(); // first: settle, re-send or cancel anything left in flight from earlier passes
  const now = (await pub.getBlock()).timestamp; // the contracts judge time by the chain's clock, so do we
  const results = await Promise.all([
    job("randomness", () => randomnessJob(now)),
    // PLANK/USD feed (found through the Fire): rolls its window every 30 minutes (MIN_WINDOW).
    job("plank feed", async () => {
      plankTwap ??= await read(FIRE, fireAbi, "PLANK_USD");
      const [[, lastTs], minWindow] = await Promise.all([read(plankTwap, twapAbi, "last"), read(plankTwap, twapAbi, "MIN_WINDOW")]);
      if (now >= BigInt(lastTs) + minWindow) await send(plankTwap, twapAbi, "checkpoint");
    }),
    // PAPER/USD feed (found through the Fire): adopts PAPER's pool once one exists, then rolls its window daily.
    job("paper feed", async () => {
      const paperTwap = await read(FIRE, paperFeedAbi, "PAPER_USD");
      if (paperTwap !== "0x0000000000000000000000000000000000000000" && (await read(paperTwap, paperTwapAbi, "due"))) {
        await send(paperTwap, paperTwapAbi, "checkpoint");
      }
    }),
  ]);
  await job("sweep", () => sweep(now));
  await ping(await problems(results).catch((e) => [`health check failed: ${errMsg(e)}`]));
}

log(`keeper ${account.address} watching Fire ${FIRE} on chain ${chain.id} (${RPCS.length > 1 ? "with fallback RPC" : "no fallback RPC"})`);
if (!HEALTH) log("WARNING HEALTHCHECK_URL is not set: nobody will hear about a stalled game. Set it in production.");
if (env("ONCE")) await tick().catch((e) => { log("tick failed:", errMsg(e)); process.exitCode = 1; });
else {
  const every = Number(env("INTERVAL_SEC", "30")) * 1000;
  for (;;) {
    try { await tick(); } catch (e) { log("tick failed:", errMsg(e)); await ping([`pass failed: ${errMsg(e)}`]); }
    await new Promise((r) => setTimeout(r, every));
  }
}
