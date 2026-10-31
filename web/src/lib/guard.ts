// The wallet gate: every transaction the site asks a wallet to sign goes through sendTx, and sendTx checks it here
// first. A call is let through only if it is one of the things the site does:
//
//   - one of our own contracts (deployments/<chain>.json), and only the functions the site uses on it;
//   - an approve on one of the site's coins (PAPER, PLANK, USDG, WETH) for a contract that takes payments (FireSale,
//     FirePsa, FireGames) or a swap router, never "unlimited" (the site approves each call's own cap, approve.ts);
//   - "approve all" (setApprovalForAll) on the cards or the packs only for FireMarket, the site's own market (it can
//     move a listed card only when someone buys it at the seller's price);
//   - never more than MAX_ETH in one transaction (MARKET_MAX_ETH for a market buy, and exactly the listed price);
//   - a PAPER swap: Uniswap V2's router with the coins coming back to the buyer's own wallet, or KyberSwap's router
//     checked the same way checkSwap checks it (and never without a minimum return);
//   - FireSale.buyWithEthAll only with its PAPER purchase capped (maxPaperEth, at most the ETH sent).
//
// Everything else is refused before the wallet opens: transfers, any other "approve all", permits,
// unknown contracts, ETH sent anywhere else. The site never asks for signatures (signMessage / signTypedData) at all,
// so there is nothing to gate there. If a bug, a bad API answer or a changed deployments file ever tried more, the
// wallet would never see it.

import { getAddress, type Address } from "viem";
import { kyberRouterAbi, KYBER_ROUTER } from "./kyber";
import { SWAP_FEE_WALLET } from "./config";

/** The functions the site calls on each of its contracts (by deployment name). */
export const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  FireSale: ["buy", "buyWithEthAll", "close"],
  FireCards: ["open", "cancelOpen", "skipStuck", "process", "setApprovalForAll"],
  FirePacks: ["setApprovalForAll"],
  FireMarket: ["listCard", "cancelCard", "buyCard", "listPacks", "cancelPacks", "buyPacks", "cancelAll", "withdraw"],
  FireCredits: ["burnCards", "useCredits", "suggest", "suggestMany"],
  FirePsa: ["protect", "cancelGrading", "finish", "settle"],
  FireGames: ["payRun"],
  FireProfiles: ["setProfile", "clear"],
  OpenDrandRouter: ["fulfill", "fulfillMany"],
  CardsAdapter: ["settle"],
  PsaAdapter: ["settle"],
};
/** The coins a wallet may approve (by deployment input name), and the most an approval may ever be (no "unlimited"). */
export const COINS = ["PAPER", "PLANK", "USDG", "WETH"] as const;
export const MAX_APPROVAL = 2n ** 128n;
/** The only contracts the site ever approves coins for (plus the two swap routers): the ones that take payments. */
export const SPENDERS = ["FireSale", "FirePsa", "FireGames"] as const;
/** The most ETH any one transaction may send: a hard ceiling whatever a price read says (50 packs at today's prices
 *  are well under it). Raise it here if pack prices ever need more. */
export const MAX_ETH = 5n * 10n ** 17n; // 0.5 ETH
/** A market buy may send more (a rare card can sell for more than packs cost), but only exactly the listed price. */
export const MARKET_MAX_ETH = 10n * 10n ** 18n; // 10 ETH
const V2_SWAPS = ["swapETHForExactTokens", "swapTokensForExactTokens"];
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const kyberFns = kyberRouterAbi.map((f) => f.name) as string[];

export type GuardDeployment = { contracts?: Record<string, string | undefined>; inputs?: Record<string, string | undefined> };
export type GuardCall = { address: Address; functionName: string; args?: readonly unknown[]; value?: bigint };

export class Blocked extends Error {
  why: string;
  constructor(why: string) { super("Blocked for your safety. Nothing was sent."); this.name = "Blocked"; this.why = why; }
}

const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const nameOf = (book: Record<string, string | undefined> | undefined, a: string) =>
  Object.entries(book ?? {}).find(([, v]) => eq(v, a))?.[0];

/** Refuse (throw Blocked) unless `call`, sent from `from`, is one of the things the site does. */
export function checkCall(call: GuardCall, from: Address, dep: GuardDeployment): void {
  const no = (why: string): never => { console.warn("Transaction blocked:", why); throw new Blocked(why); };
  const fn = call.functionName, args = call.args ?? [], value = call.value ?? 0n;
  if (value < 0n) no("a negative amount of ETH");
  const ours = nameOf(dep.contracts, call.address);
  if (value > (ours === "FireMarket" ? MARKET_MAX_ETH : MAX_ETH)) no("more ETH than the site ever asks for in one go");
  const spenderOk = (s: unknown) => typeof s === "string" &&
    ((SPENDERS as readonly string[]).includes(nameOf(dep.contracts, s) ?? "") || eq(s, dep.inputs?.V2_ROUTER) || eq(s, KYBER_ROUTER));

  // 1. our own contracts: only the functions the site uses
  if (ours) {
    if (!(ALLOWED[ours] ?? []).includes(fn)) no(`${ours}.${fn} isn't something the site does`);
    // "approve all" only ever for the site's own market
    if (fn === "setApprovalForAll") {
      if (!eq(args[0] as string, dep.contracts?.FireMarket)) no(`${ours} "approve all" for something other than the market`);
      if (value !== 0n) no("ETH sent with an approval");
    }
    // a market buy sends exactly the listed price the buyer saw
    if (ours === "FireMarket") {
      const want = fn === "buyCard" ? args[1] : fn === "buyPacks" ? (typeof args[1] === "bigint" && typeof args[2] === "bigint" ? args[1] * args[2] : null) : 0n;
      if (typeof want !== "bigint" || value !== want) no("the ETH sent isn't the listed price");
    }
    // ETH alone: the PAPER bought with it is capped (maxPaperEth), and never above the ETH sent
    if (ours === "FireSale" && fn === "buyWithEthAll") {
      const cap = args[3];
      if (typeof cap !== "bigint" || cap < 0n || cap > value) no("the PAPER bought with ETH has no cap");
    }
    return;
  }
  // 2. a coin: only a capped approve, for our contracts or a swap router
  const coin = nameOf(dep.inputs, call.address);
  if (coin && (COINS as readonly string[]).includes(coin)) {
    if (fn !== "approve") no(`${coin}.${fn}: the site only ever approves a coin`);
    if (value !== 0n) no("ETH sent to a coin");
    const [spender, amount] = args as [unknown, unknown];
    if (!spenderOk(spender)) no(`${coin} approval for an unknown contract`);
    if (typeof amount !== "bigint" || amount >= MAX_APPROVAL) no(`an unlimited ${coin} approval`);
    return;
  }
  // 3. Uniswap V2's router: buy exact PAPER, into the buyer's own wallet
  if (eq(call.address, dep.inputs?.V2_ROUTER)) {
    if (!V2_SWAPS.includes(fn)) no(`router.${fn} isn't a PAPER buy`);
    const [, a1, a2, a3] = args as unknown[];
    const path = (fn === "swapETHForExactTokens" ? a1 : a2) as readonly string[] | undefined, to = (fn === "swapETHForExactTokens" ? a2 : a3) as string;
    if (!Array.isArray(path) || !eq(path[path.length - 1], dep.inputs?.PAPER)) no("the swap doesn't buy PAPER");
    if (!eq(to, from)) no("the coins would go to another wallet");
    if (fn === "swapTokensForExactTokens" && value !== 0n) no("ETH sent with a coin swap");
    return;
  }
  // 4. KyberSwap's router: a PAPER buy into the buyer's own wallet, fee only to the site's fee wallet
  if (eq(call.address, KYBER_ROUTER)) {
    type Desc = { srcToken: string; dstToken: string; dstReceiver: string; feeReceivers: readonly string[]; amount: bigint; minReturnAmount: bigint };
    if (!kyberFns.includes(fn)) no("a KyberSwap call we can't read");
    const d = (fn === "swapSimpleMode" ? args[1] : (args[0] as { desc?: Desc } | undefined)?.desc) as Desc | undefined;
    if (!d || typeof d.dstReceiver !== "string" || !Array.isArray(d.feeReceivers) || typeof d.amount !== "bigint") no("a KyberSwap call we can't read");
    const x = d!;
    // a swap with no minimum return could be filled at any price
    if (typeof x.minReturnAmount !== "bigint" || x.minReturnAmount <= 0n) no("the swap has no minimum return");
    if (!eq(x.dstToken, dep.inputs?.PAPER)) no("the swap doesn't buy PAPER");
    if (!eq(x.dstReceiver, from)) no("the coins would go to another wallet");
    if (x.feeReceivers.some((r) => !SWAP_FEE_WALLET || !eq(r, SWAP_FEE_WALLET))) no("it pays a fee to someone else");
    const ethIn = eq(x.srcToken, NATIVE);
    if (!ethIn && !nameOf(dep.inputs, x.srcToken)) no("it spends a coin the site doesn't use");
    if (value !== (ethIn ? x.amount : 0n)) no("it sends the wrong amount of ETH");
    return;
  }
  no(`${getAddress(call.address)} isn't one of the site's contracts`);
}
