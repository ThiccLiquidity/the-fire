// The Fire keeper: the jobs nobody should have to press a button for.
//   - roll()             once the nightly roll time has passed
//   - router.fulfill()   fetch the drand signature for the roll's round and submit it (anyone may; the router
//                        verifies it, so the keeper can't change the number — it's just the fastest deliverer)
//   - adapter.settle(id) if the router has the number but the callback didn't land
//   - reroll()           if a roll has had no answer for 30 minutes AND the drand relays say the round isn't out
//                        yet (drand stalled). If the keeper just can't reach drand it doesn't reroll: a published
//                        number must never be thrown away because of our network.
//   - checkpoint()       the Fire's PLANK/USD feed once its window is 20h+ old; the PAPER/USD feed when due()
//                        (adopting PAPER's pool once someone creates one)
//   - sweep the mill floor: buy the cheapest OpenSea listing at or under the fire's bid that the fund can pay
//     (only if OPENSEA_API_KEY is set; checks every SWEEP_EVERY_SEC, default 300, to respect API limits)
// Every call here is permissionless: the keeper has no special powers, it's just reliably awake.
// Optional: DRAND_URLS (comma-separated; default the three public api*.drand.sh relays).
// Env: RPC_URL (or RPC_URL_FILE), FIRE, KEEPER_KEY_FILE (or KEEPER_KEY), EXPECTED_CHAIN_ID (default 4663),
//      INTERVAL_SEC (default 30), ONCE=1 for a single pass, HEALTHCHECK_URL (pinged after every good pass; point a
//      dead-man's switch like healthchecks.io at it), MAX_FEE_GWEI (optional cap), LOW_BALANCE_ETH (default 0.002).
//      Sweeping: OPENSEA_API_KEY (or OPENSEA_API_KEY_FILE), COLLECTION (default the-plank-press), OPENSEA_API (default
//      https://api.opensea.io).
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, defineChain } from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";

const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const fileOr = (k, fileKey, def) => env(k) ?? (env(fileKey, def) && tryRead(env(fileKey, def)));
const tryRead = (f) => { try { return readFileSync(f, "utf8").trim(); } catch { return undefined; } };
const RPC = fileOr("RPC_URL", "RPC_URL_FILE");
const FIRE = env("FIRE");
const EXPECTED_CHAIN_ID = Number(env("EXPECTED_CHAIN_ID", "4663"));
if (!RPC || !FIRE) { console.error("Set RPC_URL (or RPC_URL_FILE) and FIRE"); process.exit(1); }
const key = fileOr("KEEPER_KEY", "KEEPER_KEY_FILE", "/run/secrets/keeper-key");
if (!key) { console.error("No keeper key: set KEEPER_KEY_FILE"); process.exit(1); }
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`, { nonceManager });
const errMsg = (e) => e?.shortMessage ?? String(e?.message ?? e).split("\n")[0]; // never the full error: it can carry the RPC URL

const pub = createPublicClient({ transport: http(RPC) });
let chain;
try {
  const id = await pub.getChainId();
  if (id !== EXPECTED_CHAIN_ID) throw new Error(`RPC is on chain ${id}, expected ${EXPECTED_CHAIN_ID}`);
  if (!(await pub.getCode({ address: FIRE }))) throw new Error(`no contract at FIRE ${FIRE}`);
  chain = defineChain({ id, name: "chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
} catch (e) { console.error("startup failed:", errMsg(e)); process.exit(1); }
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const MAX_FEE = env("MAX_FEE_GWEI") ? BigInt(Math.round(Number(env("MAX_FEE_GWEI")) * 1e9)) : undefined;

const fireAbi = parseAbi([
  "function nextRollAt() view returns (uint256)",
  "function pendingRequest() view returns (uint256)",
  "function pendingSince() view returns (uint256)",
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

// One transaction in flight per job. If a receipt doesn't come back in time, the next pass checks that hash
// instead of sending a duplicate.
const inflight = new Map();
async function send(address, abi, functionName, args = [], value = 0n) {
  const job = `${address}:${functionName}`;
  const prev = inflight.get(job);
  if (prev) {
    const r = await pub.getTransactionReceipt({ hash: prev }).catch(() => undefined);
    if (!r) { log(`${functionName}: still waiting on ${prev}`); return false; }
    inflight.delete(job);
    log(`${functionName} ${r.status} ${prev} (late receipt)`);
    return r.status === "success";
  }
  // Simulate first: if the contract says no (someone else already did it), skip quietly.
  try { await pub.simulateContract({ account, address, abi, functionName, args, value }); }
  catch (e) { log(`skip ${functionName}: ${errMsg(e)}`); return false; }
  const hash = await wallet.writeContract({ address, abi, functionName, args, value, ...(MAX_FEE ? { maxFeePerGas: MAX_FEE } : {}) });
  inflight.set(job, hash);
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 }).catch(() => undefined);
  if (!r) { log(`${functionName}: sent ${hash}, no receipt yet`); return false; }
  inflight.delete(job);
  log(`${functionName} ${r.status} ${hash}`);
  return r.status === "success";
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
  const [nextRollAt, pending, since, adapter, rerollAfter] = await Promise.all([
    read(FIRE, fireAbi, "nextRollAt"), read(FIRE, fireAbi, "pendingRequest"), read(FIRE, fireAbi, "pendingSince"),
    read(FIRE, fireAbi, "randomness"), read(FIRE, fireAbi, "REROLL_AFTER"),
  ]);
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

async function tick() {
  const now = (await pub.getBlock()).timestamp; // the contracts judge time by the chain's clock, so do we
  const results = await Promise.all([
    job("randomness", () => randomnessJob(now)),
    // PLANK/USD feed (found through the Fire): rolls its window once it's 20h+ old.
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
  const bal = await pub.getBalance({ address: account.address }).catch(() => undefined);
  if (bal !== undefined && bal < LOW_BALANCE) log(`ALERT keeper balance ${Number(bal) / 1e18} ETH — top it up`);
  if (results.every(Boolean) && env("HEALTHCHECK_URL")) await fetch(env("HEALTHCHECK_URL"), { signal: AbortSignal.timeout(10_000) }).catch(() => {});
}

log(`keeper ${account.address} watching Fire ${FIRE} on chain ${chain.id}`);
if (env("ONCE")) await tick().catch((e) => { log("tick failed:", errMsg(e)); process.exitCode = 1; });
else {
  const every = Number(env("INTERVAL_SEC", "30")) * 1000;
  for (;;) {
    try { await tick(); } catch (e) { log("tick failed:", errMsg(e)); }
    await new Promise((r) => setTimeout(r, every));
  }
}
