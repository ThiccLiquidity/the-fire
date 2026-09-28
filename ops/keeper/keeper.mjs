// The Fire keeper: the jobs nobody should have to press a button for.
//   - roll()             once the nightly roll time has passed
//   - router.fulfill()   fetch the drand signature for the roll's round and submit it (anyone may; the router
//                        verifies it, so the keeper can't change the number — it's just the fastest deliverer)
//   - adapter.settle(id) if the router has the number but the callback didn't land
//   - reroll()           if a roll has had no answer for 30 minutes (only if drand itself is unreachable)
//   - twap.checkpoint()  once the PLANK/USD window is 20h+ old; the PAPER/USD feed whenever it says it's due
//                        (adopting PAPER's pool once someone creates one)
//   - sweep the mill floor: buy the cheapest OpenSea listing at or under the fire's bid that the fund can pay
//     (only if OPENSEA_API_KEY is set; checks every SWEEP_EVERY_SEC, default 300, to respect API limits)
// Every call here is permissionless: the keeper has no special powers, it's just reliably awake.
// Optional: DRAND_URLS (comma-separated; default the three public api*.drand.sh relays).
// Env: RPC_URL, FIRE, KEEPER_KEY_FILE (or KEEPER_KEY), optional TWAP, INTERVAL_SEC (default 30), ONCE=1 for a single pass.
//      Sweeping: OPENSEA_API_KEY (or OPENSEA_API_KEY_FILE), COLLECTION (default the-plank-press), OPENSEA_API (default
//      https://api.opensea.io).
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = (k, d) => process.env[k] ?? d;
const RPC = env("RPC_URL");
const FIRE = env("FIRE");
const TWAP = env("TWAP");
if (!RPC || !FIRE) throw new Error("Set RPC_URL and FIRE");
const key = (env("KEEPER_KEY") ?? readFileSync(env("KEEPER_KEY_FILE", "/run/secrets/keeper-key"), "utf8")).trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);

const pub = createPublicClient({ transport: http(RPC) });
const chain = defineChain({ id: await pub.getChainId(), name: "chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const fireAbi = parseAbi([
  "function nextRollAt() view returns (uint256)",
  "function pendingRequest() view returns (uint256)",
  "function pendingSince() view returns (uint256)",
  "function randomness() view returns (address)",
  "function REROLL_AFTER() view returns (uint256)",
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

/** The drand evmnet signature for a round (64 bytes hex), from the first relay that has it. The router verifies it. */
async function drandSignature(chainHash, round) {
  for (const base of DRAND_URLS) {
    try {
      const r = await fetch(`${base}/${chainHash.slice(2)}/public/${round}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const b = await r.json();
      if (String(b.round) === String(round) && /^[0-9a-f]{128}$/i.test(b.signature)) return `0x${b.signature}`;
    } catch { /* next relay */ }
  }
  return undefined;
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

async function send(address, abi, functionName, args = [], value = 0n) {
  // Simulate first: if the contract says no (someone else already did it), skip quietly.
  try { await pub.simulateContract({ account, address, abi, functionName, args, value }); }
  catch (e) { log(`skip ${functionName}: ${e.shortMessage ?? e.message}`); return false; }
  const hash = await wallet.writeContract({ address, abi, functionName, args, value });
  const r = await pub.waitForTransactionReceipt({ hash });
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
  const best = priced.find((x) => x.usd <= bid && (x.inEth ? ethFund >= x.total + fee : usdgFund >= x.total));
  log(`sweep: bid $${Number(bid) / 1e8}, fund ${Number(ethFund) / 1e18} ETH + $${Number(usdgFund) / Number(usdgUnit)} USDG, ${priced.length} listings, cheapest $${priced[0] ? Number(priced[0].usd) / 1e8 : "-"}`);
  if (!best) return;
  // Fulfillment data for the fire as the fulfiller: the full signed order, plus zone data if the listing needs it.
  const fd = await os("/api/v2/listings/fulfillment_data", {
    listing: { hash: best.l.order_hash, chain: best.l.chain, protocol_address: best.l.protocol_address },
    fulfiller: { address: FIRE },
  });
  const signed = fd.fulfillment_data?.orders?.[0] ?? best.l.protocol_data;
  const extraData = fd.fulfillment_data?.transaction?.input_data?.advancedOrder?.extraData ?? "0x";
  const attach = best.inEth || ethFund >= fee ? 0n : fee; // USDG-only fund: we pay the 0.0003 ETH burn fee
  log(`sweep: buying ${best.l.order_hash} for $${Number(best.usd) / 1e8}`);
  await send(FIRE, millAbi, "eatMillFromSeaport", [toOrder(signed), extraData], attach);
}

async function tick() {
  const now = (await pub.getBlock()).timestamp; // the contracts judge time by the chain's clock, so do we
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
    const sig = now >= genesis + (round - 1n) * period ? await drandSignature(chainHash, round) : undefined;
    if (sig) await send(router, routerAbi, "fulfill", [pending, sig]);
    else if (now >= since + rerollAfter) {
      log(`request ${pending}: no drand signature for round ${round} after ${now - since}s — rerolling`);
      await send(FIRE, fireAbi, "reroll");
    } else log(`request ${pending}: waiting for drand round ${round}`);
  }
  try { await sweep(now); } catch (e) { log("sweep failed:", e.shortMessage ?? e.message); }
  // PAPER/USD feed (found through the Fire): adopts PAPER's pool once one exists, then rolls its window daily.
  const paperTwap = await read(FIRE, paperFeedAbi, "PAPER_USD").catch(() => undefined);
  if (paperTwap && paperTwap !== "0x0000000000000000000000000000000000000000" && (await read(paperTwap, paperTwapAbi, "due").catch(() => false))) {
    await send(paperTwap, paperTwapAbi, "checkpoint");
  }
  if (TWAP) {
    const [[, lastTs], minWindow] = await Promise.all([read(TWAP, twapAbi, "last"), read(TWAP, twapAbi, "MIN_WINDOW")]);
    if (now >= BigInt(lastTs) + minWindow) await send(TWAP, twapAbi, "checkpoint");
  }
}

log(`keeper ${account.address} watching Fire ${FIRE}${TWAP ? ` and TWAP ${TWAP}` : ""}`);
if (env("ONCE")) await tick();
else {
  const every = Number(env("INTERVAL_SEC", "30")) * 1000;
  for (;;) {
    try { await tick(); } catch (e) { log("tick failed:", e.shortMessage ?? e.message); }
    await new Promise((r) => setTimeout(r, every));
  }
}
