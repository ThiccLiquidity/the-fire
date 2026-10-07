// drand evmnet: the chain OpenDrandRouter verifies. Card opens (FireCards) and PDA grading (FirePsa) ask the router
// for a round about 90 seconds ahead; once drand publishes it, anyone may deliver it. The router checks every signature
// on-chain, so whoever delivers can't change the number.

import { parseAbi, type Hex } from "viem";

export const DRAND_CHAIN = "04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3";
export const DRAND_GENESIS = 1727521075n;
export const DRAND_PERIOD = 3n;
export const DRAND_URLS = ["https://api.drand.sh", "https://api2.drand.sh", "https://api3.drand.sh"];

export const adapterAbi = parseAbi(["function answered(uint256) view returns (bool)", "function settle(uint256)", "function ROUTER() view returns (address)"]);
export const routerAbi = parseAbi([
  "function requests(uint256) view returns (address consumer, uint64 round, uint32 callbackGasLimit, bool fulfilled, bool delivered, uint256 randomWord, uint256 fee)",
  "function fulfill(uint256 id, bytes signature)",
  "function fulfillMany(uint256[] ids, bytes[] signatures)",
  "function roundRandomness(uint64) view returns (bytes32)",
]);

/** When drand publishes `round` (unix seconds). */
export const roundTime = (round: bigint) => DRAND_GENESIS + (round - 1n) * DRAND_PERIOD;

/** The signature for a round from the public relays, or undefined if none has it yet. */
export async function drandSignature(round: bigint): Promise<Hex | undefined> {
  for (const base of DRAND_URLS) {
    try {
      const r = await fetch(`${base}/${DRAND_CHAIN}/public/${round}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const b = (await r.json()) as { round: number; signature: string };
      if (String(b.round) === String(round) && /^[0-9a-f]{128}$/i.test(b.signature)) return `0x${b.signature}`;
    } catch { /* next relay */ }
  }
  return undefined;
}
