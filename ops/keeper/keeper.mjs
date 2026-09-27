// The Fire keeper: the jobs nobody should have to press a button for. Runs next to the relayer.
//   - roll()             once the nightly roll time has passed
//   - adapter.settle(id) if OpenVRF has the number but the callback didn't land
//   - reroll()           if a roll has had no answer for 30 minutes (the contract enforces both rules)
//   - twap.checkpoint()  once the PLANK/USD window is 20h+ old
// Every call here is permissionless: the keeper has no special powers, it's just reliably awake.
// Env: RPC_URL, FIRE, KEEPER_KEY_FILE (or KEEPER_KEY), optional TWAP, INTERVAL_SEC (default 30), ONCE=1 for a single pass.
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
const adapterAbi = parseAbi(["function answered(uint256) view returns (bool)", "function settle(uint256)"]);
const twapAbi = parseAbi(["function last() view returns (uint256 cum, uint32 ts)", "function MIN_WINDOW() view returns (uint256)", "function checkpoint()"]);

const log = (...a) => console.log(new Date().toISOString(), ...a);
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

async function send(address, abi, functionName, args = []) {
  // Simulate first: if the contract says no (someone else already did it), skip quietly.
  try { await pub.simulateContract({ account, address, abi, functionName, args }); }
  catch (e) { log(`skip ${functionName}: ${e.shortMessage ?? e.message}`); return; }
  const hash = await wallet.writeContract({ address, abi, functionName, args });
  const r = await pub.waitForTransactionReceipt({ hash });
  log(`${functionName} ${r.status} ${hash}`);
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
    // The router has the number. Give its own callback a minute, then deliver it ourselves.
    if (now >= since + 60n) await send(adapter, adapterAbi, "settle", [pending]);
  } else if (now >= since + rerollAfter) {
    log(`request ${pending} unanswered for ${now - since}s — rerolling`);
    await send(FIRE, fireAbi, "reroll");
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
