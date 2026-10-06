// KyberSwap aggregator (live site only): best price across every pool on Robinhood Chain, with the site's swap fee
// paid straight to SWAP_FEE_WALLET inside the same transaction. The API only suggests a transaction; before a wallet
// ever sees it, checkSwap() decodes it and refuses anything that isn't exactly the swap the buyer asked for.

import { decodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { SWAP_FEE_BPS, SWAP_FEE_WALLET } from "./config";

const API = "https://aggregator-api.kyberswap.com/robinhood/api/v1";
const CLIENT = "thefire";
export const NATIVE: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
/** KyberSwap's MetaAggregationRouterV2 (same address on every chain it's deployed to). The only contract a swap may call. */
export const KYBER_ROUTER: Address = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";

export type KyberRoute = { summary: unknown; amountIn: bigint; amountOut: bigint; router: Address };

const tokenArg = (t: Address | "ETH") => (t === "ETH" ? NATIVE : t);
const feeOn = () => !!SWAP_FEE_WALLET;

/** A quote: amountIn is what the buyer pays in total (the 0.5% fee comes out of it). */
export async function kyberRoute(from: Address | "ETH", to: Address | "ETH", amountIn: bigint, signal?: AbortSignal): Promise<KyberRoute | undefined> {
  const q = new URLSearchParams({ tokenIn: tokenArg(from), tokenOut: tokenArg(to), amountIn: amountIn.toString(), gasInclude: "true" });
  if (feeOn()) {
    q.set("feeAmount", String(SWAP_FEE_BPS)); q.set("isInBps", "true"); q.set("chargeFeeBy", "currency_in"); q.set("feeReceiver", SWAP_FEE_WALLET!);
  }
  const r = await fetch(`${API}/routes?${q}`, { headers: { "x-client-id": CLIENT }, signal });
  if (!r.ok) return undefined;
  const j = await r.json();
  const s = j?.data?.routeSummary;
  if (!s?.amountOut || BigInt(s.amountOut) === 0n) return undefined;
  return { summary: s, amountIn: BigInt(s.amountIn), amountOut: BigInt(s.amountOut), router: getAddress(j.data.routerAddress) };
}

/** Turn a quote into a transaction. Slippage is in basis points. */
export async function kyberBuild(route: KyberRoute, account: Address, slipBps: number): Promise<{ to: Address; data: Hex; value: bigint }> {
  const r = await fetch(`${API}/route/build`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-client-id": CLIENT },
    body: JSON.stringify({ routeSummary: route.summary, sender: account, recipient: account, slippageTolerance: slipBps, deadline: Math.floor(Date.now() / 1000) + 600, source: CLIENT }),
  });
  if (!r.ok) throw new Error("The swap service didn't answer. Try again in a moment.");
  const d = (await r.json())?.data;
  const data = (d?.data ?? d?.calldata) as Hex | undefined;
  if (!data || !d?.routerAddress) throw new Error("The swap service sent back an incomplete swap. Nothing was sent to your wallet.");
  return { to: getAddress(d.routerAddress), data, value: BigInt(d.transactionValue ?? d.value ?? 0) };
}

const desc = "(address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit)";
const routerAbi = parseAbi([
  `function swap((address callTarget, address approveTarget, bytes targetData, ${desc} desc, bytes clientData) execution) payable returns (uint256, uint256)`,
  `function swapGeneric((address callTarget, address approveTarget, bytes targetData, ${desc} desc, bytes clientData) execution) payable returns (uint256, uint256)`,
  `function swapSimpleMode(address caller, ${desc} desc, bytes executorData, bytes clientData) returns (uint256, uint256)`,
]);
type Desc = { srcToken: Address; dstToken: Address; feeReceivers: readonly Address[]; feeAmounts: readonly bigint[]; dstReceiver: Address; amount: bigint; minReturnAmount: bigint };

/**
 * The guard. Refuses the transaction unless: it goes to KyberSwap's router; it spends no more than `amountIn` of `from`;
 * it buys `to`; the coins go to the buyer's own wallet; it returns at least `minOut` or reverts; any fee goes only to
 * the site's fee wallet; and ETH sent matches (all of it for an ETH swap, none otherwise). A swap we can't read is refused.
 */
export function checkSwap(tx: { to: Address; data: Hex; value: bigint }, want: { from: Address | "ETH"; to: Address | "ETH"; amountIn: bigint; minOut: bigint; account: Address }) {
  const no = (why: string) => { throw new Error(`Swap blocked for your safety: ${why}. Nothing was sent to your wallet.`); };
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!eq(tx.to, KYBER_ROUTER)) no("it wasn't addressed to KyberSwap's router");
  let d: Desc | undefined;
  try {
    const f = decodeFunctionData({ abi: routerAbi, data: tx.data });
    d = (f.functionName === "swapSimpleMode" ? f.args[1] : (f.args[0] as { desc: Desc }).desc) as Desc;
  } catch { no("we couldn't read it"); }
  const x = d!;
  if (!eq(x.srcToken, tokenArg(want.from)) || !eq(x.dstToken, tokenArg(want.to))) no("it swaps different coins");
  if (x.amount > want.amountIn) no("it spends more than you asked");
  if (!eq(x.dstReceiver, want.account)) no("the coins would go to another wallet");
  if (x.minReturnAmount < want.minOut) no("its minimum return is below your slippage limit");
  if (x.feeReceivers.some((r) => !SWAP_FEE_WALLET || !eq(r, SWAP_FEE_WALLET))) no("it pays a fee to someone else");
  // the fee is SWAP_FEE_BPS, written either in basis points or as an amount of the coin paid: refuse anything above both
  const feeCap = BigInt(SWAP_FEE_BPS) > (want.amountIn * BigInt(SWAP_FEE_BPS)) / 10000n ? BigInt(SWAP_FEE_BPS) : (want.amountIn * BigInt(SWAP_FEE_BPS)) / 10000n;
  if ((x.feeAmounts ?? []).reduce((a, b) => a + b, 0n) > feeCap) no("its fee is bigger than the site's fee");
  if (tx.value !== (want.from === "ETH" ? want.amountIn : 0n)) no("it sends the wrong amount of ETH");
}
