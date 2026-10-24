// Getting PAPER on the site, by the cheapest route. On mainnet: KyberSwap's aggregator (every pool on Robinhood
// Chain, split across them when that pays better), checked by kyber.ts's checkSwap before the wallet ever sees it.
// Elsewhere (the testnet), or if KyberSwap doesn't answer: the chain's own V2 pools (the router the contracts use),
// the cheaper of straight to PAPER or through PLANK / WETH, for exactly the PAPER asked for.
//
// Paying in ETH is one confirmation; PLANK or USDG need an approval first (capped at the most the swap may spend,
// never unlimited).

import { decodeFunctionData, getAddress, parseAbi, type Address, type TransactionReceipt } from "viem";
import { approveMax } from "../approve";
import { sendTx } from "../tx";
import { getAccount } from "../wallet";
import { NET } from "../net";
import { inputAddress } from "../config";
import { checkSwap, kyberBuild, kyberRoute, kyberRouterAbi, KYBER_ROUTER, type KyberRoute } from "../kyber";
import { amount, decimalsOf, input, pub, type Amount } from "./contracts";
import type { PayCoin } from "./reads";
import type { WriteOpts } from "./writes";

const v2Abi = parseAbi([
  "function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)",
  "function swapETHForExactTokens(uint256 amountOut, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
]);

export type PaperBuy = {
  from: PayCoin;
  /** PAPER asked for (raw) and the most it may cost (raw units of `from`, slippage included). */
  paperOut: bigint;
  maxIn: bigint;
  /** What it should cost, for people. */
  cost: Amount;
  via: "kyber" | "pools";
  /** Wallet confirmations: 1 for ETH, 2 when an approval is needed first. */
  confirmations: number;
};

const me = (): Address => {
  const a = getAccount();
  if (a.status !== "connected" || !a.address) throw new Error("Connect your wallet first.");
  return a.address;
};
const tokenOf = (c: PayCoin): Address | "ETH" => (c === "ETH" ? "ETH" : input(c)!);
const decimalsFor = async (c: PayCoin) => (c === "USDG" ? decimalsOf(input("USDG")!) : 18);
const withSlip = (v: bigint, bps: number) => (v * BigInt(10_000 + bps) + 9_999n) / 10_000n;
const v2Router = () => { const r = inputAddress("V2_ROUTER"); return r ? getAddress(r) : undefined; };

/** The cheapest V2 path from `from` to exactly `out` PAPER: [cost, path], or undefined with no pool. */
async function bestPools(from: PayCoin, out: bigint): Promise<[bigint, Address[]] | undefined> {
  const router = v2Router(), paper = input("PAPER"), weth = input("WETH"), plank = input("PLANK");
  if (!router || !paper || !weth) return undefined;
  const start = from === "ETH" ? weth : input(from)!;
  const mids = [weth, plank, input("USDG")].filter((t): t is Address => !!t && t !== start && t !== paper);
  const paths: Address[][] = [[start, paper], ...mids.map((m) => [start, m, paper])];
  let best: [bigint, Address[]] | undefined;
  for (const path of paths) {
    try {
      const a = await pub().readContract({ address: router, abi: v2Abi, functionName: "getAmountsIn", args: [out, path] });
      if (!best || a[0] < best[0]) best = [a[0], path];
    } catch { /* no such pool */ }
  }
  return best;
}

/** KyberSwap's slippage tolerance (bps) that keeps the minimum return at `minOut` or above for a route expected to
 *  return `expectedOut`: the headroom between them, rounded down (Kyber's minReturn = expected x (1 - bps / 10000)). */
export const kyberSlipBps = (expectedOut: bigint, minOut: bigint): number =>
  expectedOut <= minOut ? 0 : Number(((expectedOut - minOut) * 10_000n) / expectedOut);

/** A KyberSwap route for at least `paperOut` PAPER: KyberSwap prices an amount in, so it's sized from the pools' price
 *  (or a first probe) to return about `paperOut` x (1 + slippage): the room for the price to move before it lands.
 *  The swap's minimum return is then `paperOut` itself (kyberSlipBps), so the buyer gets at least what they asked
 *  for, or nothing is spent. Undefined when KyberSwap has no route or it's dearer per PAPER than `poolsCost`. */
export async function quoteKyber(from: PayCoin, paperOut: bigint, slippageBps = 100, poolsCost?: bigint): Promise<PaperBuy | undefined> {
  const tIn = tokenOf(from), paper = input("PAPER")!, dec = await decimalsFor(from);
  const want = withSlip(paperOut, slippageBps);
  let amountIn = poolsCost ? withSlip(poolsCost, slippageBps) : 10n ** BigInt(Math.max(0, dec - 2));
  let r: KyberRoute | undefined;
  for (let i = 0; i < 3; i++) { // probe, then twice more to land on `want`
    r = await kyberRoute(tIn, paper, amountIn);
    if (!r || r.amountOut === 0n) return undefined;
    if (i === 2) break;
    amountIn = (r.amountIn * want + r.amountOut - 1n) / r.amountOut;
  }
  if (!r || r.amountOut < paperOut) return undefined;
  if (poolsCost && r.amountIn * paperOut > poolsCost * r.amountOut) return undefined; // dearer per PAPER than the pools
  return { from, paperOut, maxIn: r.amountIn, cost: amount(r.amountIn, dec, 8), via: "kyber", confirmations: from === "ETH" ? 1 : 2 };
}

/** What `paperOut` PAPER costs in `from`, by the best route available. Throws if PAPER can't be bought with it. */
export async function quotePaperBuy(from: PayCoin, paperOut: bigint, slippageBps = 100): Promise<PaperBuy> {
  const pools = await bestPools(from, paperOut);
  const confirmations = from === "ETH" ? 1 : 2, dec = await decimalsFor(from);
  if (NET.name === "mainnet") {
    try {
      const k = await quoteKyber(from, paperOut, slippageBps, pools?.[0]);
      if (k) return k;
    } catch { /* KyberSwap down: the pools */ }
  }
  if (!pools) throw new Error(`Can't swap ${from} for PAPER right now. Try ETH.`);
  return { from, paperOut, maxIn: withSlip(pools[0], slippageBps), cost: amount(pools[0], dec, 8), via: "pools", confirmations };
}

/** The KyberSwap transaction for a quote: routed again for `q.maxIn`, built with a minimum return of `q.paperOut`,
 *  and checked by checkSwap (refused unless it's exactly that swap). Throws "Price changed" when the route now
 *  returns less than asked. */
export async function kyberTx(q: PaperBuy, owner: Address): Promise<{ to: Address; data: `0x${string}`; value: bigint }> {
  const tIn = tokenOf(q.from), paper = input("PAPER")!;
  const r = await kyberRoute(tIn, paper, q.maxIn);
  if (!r || r.amountOut < q.paperOut) throw new Error("Price changed. Try again.");
  const tx = await kyberBuild(r, owner, kyberSlipBps(r.amountOut, q.paperOut));
  checkSwap(tx, { from: tIn, to: paper, amountIn: q.maxIn, minOut: q.paperOut, account: owner }); // refuses anything else
  return tx;
}

/** Buy at least `q.paperOut` PAPER into the buyer's own wallet, spending at most `q.maxIn`. */
export async function buyPaper(q: PaperBuy, o: WriteOpts = {}): Promise<TransactionReceipt> {
  const owner = me(), label = `Get ${amount(q.paperOut).text} PAPER`, step = (s: Parameters<NonNullable<WriteOpts["onStep"]>>[0], l: string, h?: `0x${string}`) => o.onStep?.(s, l, h);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  if (q.via === "kyber") {
    const tIn = tokenOf(q.from);
    const tx = await kyberTx(q, owner);
    if (tIn !== "ETH") await approveMax({ token: tIn, spender: KYBER_ROUTER, owner, max: q.maxIn, label: `Approve ${q.from}`, onStep: (s, h) => step(s, `Approve ${q.from}`, h) });
    const call = decodeFunctionData({ abi: kyberRouterAbi, data: tx.data });
    return sendTx({ address: KYBER_ROUTER, abi: kyberRouterAbi, functionName: call.functionName, args: call.args, value: tx.value } as Parameters<typeof sendTx>[0],
      { label, kind: "swap", onStep: (s, h) => step(s, label, h) });
  }
  const router = v2Router()!, best = await bestPools(q.from, q.paperOut);
  if (!best) throw new Error("No pool has PAPER right now.");
  const [, path] = best;
  if (q.from === "ETH") {
    return sendTx({ address: router, abi: v2Abi, functionName: "swapETHForExactTokens", args: [q.paperOut, path, owner, deadline], value: q.maxIn },
      { label, kind: "swap", onStep: (s, h) => step(s, label, h) }); // unused ETH comes straight back
  }
  await approveMax({ token: input(q.from)!, spender: router, owner, max: q.maxIn, label: `Approve ${q.from}`, onStep: (s, h) => step(s, `Approve ${q.from}`, h) });
  return sendTx({ address: router, abi: v2Abi, functionName: "swapTokensForExactTokens", args: [q.paperOut, q.maxIn, path, owner, deadline] },
    { label, kind: "swap", onStep: (s, h) => step(s, label, h) });
}
