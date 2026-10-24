// What the live site sends. Each action: check the wallet and network, approve exactly the call's cap when an ERC-20
// allowance is short (approve.ts), simulate, confirm in the wallet, wait (tx.ts sendTx). Failures come back as a
// TxError with a plain reason (errors.ts). `onStep` reports progress for a stepper: (step, label, hash).
//
// Prices: a buy takes the quote the buyer was shown (`quote`, raw units) and caps the charge at that plus the slippage
// (3%): "if the price moves over 3%, nothing is charged" is measured from what was on screen, not from the click.
//
// Randomness: opening packs and grading ask drand for a round about 90 seconds ahead. Once it's published anyone may
// deliver it (the router checks the signature on-chain) and then deal the cards / set the grades. The keeper does
// this. The site waits for it first; only if the keeper is late does it offer to do the buyer's own part, in as few
// transactions as it can (`deliverAndDeal`: one delivery for every open up to the buyer's, one deal; `deliverAndFinish`).

import { erc20Abi, parseAbi, type Address, type Hex, type TransactionReceipt } from "viem";
import { approveMax } from "../approve";
import { sendTx, type TxStep } from "../tx";
import { getAccount } from "../wallet";
import { NET } from "../net";
import {
  addr, argsOf, cardsAbi, chainNow, creditsAbi, dealerAbi, eventOf, hasFunction, input, psaAbi, pub, read, readGroups, saleAbi,
} from "./contracts";
import { gradingIds, payIndex, psaPayIndex, requestInfo, type PayCoin, type PsaCoin } from "./reads";

export type Step = (step: TxStep, label: string, hash?: Hex) => void;
export type WriteOpts = { onStep?: Step };

const me = (): Address => {
  const a = getAccount();
  if (a.status !== "connected" || !a.address) throw new Error("Connect your wallet first.");
  return a.address;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const send = (address: Address, abi: Parameters<typeof sendTx>[0]["abi"], functionName: string, args: readonly unknown[], label: string, kind: string, o: WriteOpts, value?: bigint) =>
  sendTx({ address, abi, functionName, args, value }, { label, kind, onStep: (s, h) => o.onStep?.(s, label, h) });
const approve = (token: Address, spender: Address, max: bigint, label: string, o: WriteOpts) =>
  approveMax({ token, spender, owner: me(), max, label, onStep: (s, h) => o.onStep?.(s, label, h) });

/** Some slack on a price that can move between the quote and the block (PLANK and ETH prices): 3% by default. */
export const withSlip = (v: bigint, bps = 300) => (v * BigInt(10_000 + bps) + 9_999n) / 10_000n;
/** A quote the page showed (raw units, decimal strings as reads.ts gives them), or a fresh one when there's none. */
const shown = async (raw: string | null | undefined, fresh: () => Promise<bigint>): Promise<bigint> => (raw != null && raw !== "" ? BigInt(raw) : fresh());

const coinAddr = (pay: PayCoin | PsaCoin): Address => {
  const t = input(pay === "PLANK" ? "PLANK" : "USDG");
  if (!t) throw new Error(`${pay} isn't set up on ${NET.label}.`);
  return t;
};

// ---------------------------------------------------------------- packs

/** How a buyer shows it may buy in a gated group (FireGroups.Access): NFT ids it holds (NFT gate, used in order), or
 *  its snapshot allowance and proof (snapshot gate: reads.snapshotEntry). Ignored by an open group. */
export type Access = { nftIds?: number[]; allowance?: number; proof?: Hex[] };
const accessArg = (a?: Access) => ({ nftIds: (a?.nftIds ?? []).map(BigInt), allowance: BigInt(a?.allowance ?? 0), proof: a?.proof ?? [] });

/** Buy `n` packs from group `group` of Series `fire`, paying its dollar price in `pay` (a coin the group takes; ignored
 *  when the group has no dollar price), and its PAPER per pack (burned). `access`: for a gated group (NFT ids, or the
 *  snapshot allowance and proof). PAPER is approved at the most it can be (the group's PAPER per pack x n); PLANK at
 *  the quote plus `slippageBps`, USDG at the quote (a dollar). `paperInEth`: ETH alone (buyWithEthAll: FireSale buys
 *  the PAPER on the market and burns it; one confirmation, no approval). `quote`: what the buyer was shown
 *  (reads.quoteGroup: the coin's cost.raw, and paperEth.raw for ETH alone): the cap is built from that + 3%, not from a
 *  new quote at the click, so a price that moved more (a taxed group's next pack after someone else bought) is
 *  refused with PriceMoved and nothing is charged. */
export async function buyPacks(p: { fire: number; group: number; n: number; pay?: PayCoin | null; access?: Access; slippageBps?: number; paperInEth?: boolean; quote?: { cost?: string | null; paperEth?: string | null } }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  const f = BigInt(p.fire), g = BigInt(p.group), n = BigInt(p.n), sale = addr("FireSale"), slip = p.slippageBps ?? 300, q = p.quote ?? {};
  const label = `Buy ${plural(p.n, "pack")}`, acc = accessArg(p.access);
  const cfg = await readGroups<{ priceUsd: bigint; paper: bigint }>("groupOf", [f, g]);
  const priced = cfg.priceUsd > 0n;
  const pay: PayCoin = priced ? (p.pay ?? "ETH") : "ETH";
  const fresh = () => read<readonly [bigint, bigint]>("FireSale", saleAbi, "quote", [f, g, n, payIndex(pay)]).then((x) => x[0]);
  if (p.paperInEth) {
    // ETH alone: FireSale buys the packs' PAPER on the market and burns it. One confirmation, no approval.
    const [price, paperEth] = await Promise.all([
      priced ? shown(q.cost, fresh) : Promise.resolve(0n),
      shown(q.paperEth, async () => {
        const paper = await read<bigint>("FireSale", saleAbi, "paperFor", [f, g, n]);
        return paper === 0n ? 0n : read<bigint>("FireSale", saleAbi, "quotePaperInEth", [paper]);
      }),
    ]);
    return send(sale, saleAbi, "buyWithEthAll", [f, g, n, acc], label, "buy", o, withSlip(price + paperEth, slip)); // extra ETH comes back
  }
  const maxPaper = cfg.paper * n; // the group's PAPER per pack: the drop's dollar ceiling only ever takes less
  if (maxPaper > 0n) await approve(input("PAPER")!, sale, maxPaper, "Approve PAPER", o);
  if (!priced) return send(sale, saleAbi, "buy", [f, g, n, payIndex(pay), 0n, maxPaper, acc], label, "buy", o);
  if (pay === "ETH") {
    const max = withSlip(await shown(q.cost, fresh), slip);
    return send(sale, saleAbi, "buy", [f, g, n, payIndex(pay), max, maxPaper, acc], label, "buy", o, max); // any extra ETH comes back
  }
  const cost = await shown(q.cost, fresh);
  const max = pay === "USDG" ? cost : withSlip(cost, slip); // USDG is a dollar: only a rising tax moves it
  await approve(coinAddr(pay), sale, max, `Approve ${pay}`, o);
  return send(sale, saleAbi, "buy", [f, g, n, payIndex(pay), max, maxPaper, acc], label, "buy", o);
}

/** Spend `n` free pack credits in Series `fire`: packs from the drop's credit group while it's open, for that group's
 *  PAPER per pack (burned). */
export async function spendCredits(p: { fire: number; n: number }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  const f = BigInt(p.fire), n = BigInt(p.n);
  const d = await read<{ creditGroup: number }>("FireSale", saleAbi, "dropOf", [f]);
  if (d.creditGroup === 255) throw new Error("This Series has no free packs.");
  const cfg = await readGroups<{ paper: bigint }>("groupOf", [f, BigInt(d.creditGroup)]);
  const maxPaper = cfg.paper * n;
  if (maxPaper > 0n) await approve(input("PAPER")!, addr("FireSale"), maxPaper, "Approve PAPER", o);
  return send(addr("FireCredits"), creditsAbi, "useCredits", [f, n, maxPaper], `Use ${plural(p.n, "free pack")}`, "credits", o);
}

// ---------------------------------------------------------------- opening and dealing

/** Open `n` sealed packs of Series `fire` (once its drop has sold out or ended). Returns the open's index. */
export async function openPacks(p: { fire: number; n: number }, o: WriteOpts = {}): Promise<{ receipt: TransactionReceipt; index: number }> {
  const receipt = await send(addr("FireCards"), cardsAbi, "open", [BigInt(p.fire), BigInt(p.n)], `Open ${plural(p.n, "pack")}`, "open", o);
  const ev = eventOf(cardsAbi, "PacksOpened");
  const log = (await pub().getLogs({ address: addr("FireCards"), event: ev, blockHash: receipt.blockHash } as Parameters<ReturnType<typeof pub>["getLogs"]>[0]))
    .find((l) => l.transactionHash === receipt.transactionHash);
  return { receipt, index: log ? Number(argsOf<{ openIndex: bigint }>(log).openIndex) : -1 };
}

const routerAbi = parseAbi(["function fulfill(uint256 id, bytes signature)", "function fulfillMany(uint256[] ids, bytes[] signatures)"]);
const settleAbi = parseAbi(["function settle(uint256 id)"]);

/** Where drand signatures come from (the public relays, or a test's stand-in). */
let signatureSource = async (round: number): Promise<Hex | undefined> => {
  for (const base of NET.drandUrls) {
    try {
      const r = await fetch(`${base}/04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3/public/${round}`, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) continue;
      const b = (await r.json()) as { round: number; signature: string };
      if (String(b.round) === String(round) && /^[0-9a-f]{128}$/i.test(b.signature)) return `0x${b.signature}`;
    } catch { /* next relay */ }
  }
  return undefined;
};
/** Tests only: where drand signatures come from. */
export function setSignatureSource(fn: (round: number) => Promise<Hex | undefined>): void { signatureSource = fn; }

/** Deliver one randomness request whose drand round is out: the router checks the signature on-chain. If the router
 *  already has the word but the callback didn't land, the adapter's settle() passes it on. Returns false when there's
 *  nothing to do yet (round not out, or the relays don't have it). */
export async function deliver(source: Address, requestId: bigint, what: string, o: WriteOpts = {}): Promise<boolean> {
  const r = await requestInfo(source, requestId);
  if (r.fulfilled) {
    if (!r.delivered) { await send(source, settleAbi, "settle", [requestId], `Draw ${what}`, "randomness", o); return true; }
    return false;
  }
  if ((await chainNow()) < r.roundAt) return false;
  const sig = await signatureSource(r.round);
  if (!sig) return false;
  await send(r.router, routerAbi, "fulfill", [requestId, sig], `Draw ${what}`, "randomness", o);
  return true;
}

type OpenRaw = { ready: boolean; count: bigint; packsDone: bigint; cardInPack: number; source: Address; requestId: bigint };

/** Most deliveries in one fulfillMany and most cards in one process: the keeper's own sizes (ops/keeper config). */
const MAX_DELIVER = 15, MAX_DEAL = 120;

/** Deal the buyer's open `index` of Series `fire` when the keeper is late: at most two transactions, never a loop.
 *  1. One router.fulfillMany for every open from the queue head up to and including this one whose round is out but
 *     not delivered (the queue deals oldest first, so the ones ahead must be ready too).
 *  2. One FireCards.process sized to reach this open (at most MAX_DEAL cards).
 *  Returns what it did; `reached`: the open is dealt now. `keeper`: there was more than this can do in one go (too many
 *  ahead, a delivery that needs the adapter's settle), so it's left to the keeper. */
export async function deliverAndDeal(p: { fire: number; index: number }, o: WriteOpts = {}): Promise<{ delivered: number; dealt: boolean; reached: boolean; keeper: boolean }> {
  const f = BigInt(p.fire), me_ = BigInt(p.index), cards = addr("FireCards");
  const head = await read<bigint>("FireCards", cardsAbi, "headOf", [f]);
  if (me_ < head) return { delivered: 0, dealt: false, reached: true, keeper: false };
  const opens = await Promise.all(Array.from({ length: Number(me_ - head) + 1 }, (_, i) => read<OpenRaw>("FireCards", cardsAbi, "openOf", [f, head + BigInt(i)])));
  // 1. the deliveries still needed up to this open, in one transaction
  const todo: { id: bigint; round: number; roundAt: number; router: Address }[] = [];
  let keeper = false;
  for (const op of opens) {
    if (op.ready || op.count === 0n) continue;
    const r = await requestInfo(op.source, op.requestId);
    if (r.fulfilled) { keeper = true; continue; } // the router has the word but the callback didn't land: the adapter's settle (the keeper)
    todo.push({ id: op.requestId, round: r.round, roundAt: r.roundAt, router: r.router });
  }
  let delivered = 0;
  if (todo.length) {
    if (todo.some((t) => t.router !== todo[0].router) || todo.length > MAX_DELIVER) return { delivered: 0, dealt: false, reached: false, keeper: true };
    const now = await chainNow();
    if (todo.some((t) => now < t.roundAt)) return { delivered: 0, dealt: false, reached: false, keeper }; // a round isn't out yet
    const sigs = new Map<number, Hex>();
    for (const round of new Set(todo.map((t) => t.round))) {
      const sig = await signatureSource(round);
      if (!sig) return { delivered: 0, dealt: false, reached: false, keeper }; // the relays don't have it (yet)
      sigs.set(round, sig);
    }
    await send(todo[0].router, routerAbi, "fulfillMany", [todo.map((t) => t.id), todo.map((t) => sigs.get(t.round)!)],
      todo.length === 1 ? "Draw your cards" : `Draw your cards (${todo.length} opens)`, "randomness", o);
    delivered = todo.length;
  }
  // 2. one deal, sized to reach this open (the cards left in every open from the head through it)
  const after = await Promise.all(opens.map((_, i) => read<OpenRaw>("FireCards", cardsAbi, "openOf", [f, head + BigInt(i)])));
  if (!after.every((x) => x.ready)) return { delivered, dealt: false, reached: false, keeper: true };
  const fi = await read<readonly [Address, boolean, boolean, number, bigint, bigint]>("FireCards", cardsAbi, "fires", [f]);
  const per = BigInt(fi[3] || Number(await read<bigint>("RecipeDealer", dealerAbi, "cardsPerPack", [f]).catch(() => 6n)) || 6);
  const need = after.reduce((a, x) => a + (x.count > x.packsDone ? (x.count - x.packsDone) * per - BigInt(x.cardInPack) : 0n), 0n);
  if (need > 0n) await send(cards, cardsAbi, "process", [f, need > BigInt(MAX_DEAL) ? BigInt(MAX_DEAL) : need], "Deal your cards", "deal", o);
  const reached = me_ < (await read<bigint>("FireCards", cardsAbi, "headOf", [f]));
  return { delivered, dealt: need > 0n, reached, keeper: keeper || !reached };
}

/** Last resort, once an open's randomness has had no answer for 24 hours (reads.opensOf / openStatus: canCancel):
 *  cancel it, and its packs go back to the holder, sealed. Anyone may send it (the packs always go to the holder). */
export const cancelOpen = (p: { fire: number; index: number; packs?: number }, o: WriteOpts = {}) =>
  send(addr("FireCards"), cardsAbi, "cancelOpen", [BigInt(p.fire), BigInt(p.index)], p.packs ? `Get ${plural(p.packs, "pack")} back` : "Get your packs back", "cancel", o);

/** Keeper / advanced only (the site doesn't show it): an open at the head of a Series' queue that has been ready for 7
 *  days but can't be dealt is skipped, so the queue moves on; its packs not yet started go back, sealed. */
export const skipStuck = (p: { fire: number }, o: WriteOpts = {}) =>
  send(addr("FireCards"), cardsAbi, "skipStuck", [BigInt(p.fire)], "Skip a stuck open", "cancel", o);

// ---------------------------------------------------------------- cases and grading

/** Case `caseIds` and send `gradeIds` for grading in one transaction, paid in `pay` (PLANK and ETH at the quote plus
 *  `slippageBps`). `quote`: what the buyer was shown (quoteProtect's raw): the cap is built from it. Returns the
 *  grading's index (-1 when nothing was sent for grading). */
/** Case `caseIds` and send `gradeIds` for grading, in one payment. The cap is the quote the page showed
 *  (FirePsa.quote: exactly what protect charges) + slippage (none for USDG). ETH is sent (the rest comes back);
 *  PLANK and USDG are approved to FirePsa first. */
export async function protect(p: { caseIds?: number[]; gradeIds?: number[]; pay: PsaCoin; slippageBps?: number; quote?: string | null }, o: WriteOpts = {}): Promise<{ receipt: TransactionReceipt; gradingIndex: number }> {
  const cases = (p.caseIds ?? []).map(BigInt), grades = (p.gradeIds ?? []).map(BigInt), psa = addr("FirePsa"), slip = p.slippageBps ?? 300;
  const cost = await shown(p.quote, () => read<bigint>("FirePsa", psaAbi, "quote", [BigInt(cases.length), BigInt(grades.length), psaPayIndex(p.pay)]));
  let maxCost: bigint, value = 0n;
  if (p.pay === "ETH") value = maxCost = withSlip(cost, slip);
  else { maxCost = p.pay === "USDG" ? cost : withSlip(cost, slip); await approve(coinAddr(p.pay), psa, maxCost, `Approve ${p.pay}`, o); }
  const what = [cases.length ? `case ${plural(cases.length, "card")}` : "", grades.length ? `grade ${plural(grades.length, "card")}` : ""].filter(Boolean).join(", ");
  const receipt = await send(psa, psaAbi, "protect", [cases, grades, psaPayIndex(p.pay), maxCost], what[0].toUpperCase() + what.slice(1), "protect", o, value);
  const log = (await pub().getLogs({ address: psa, event: eventOf(psaAbi, "Protected"), blockHash: receipt.blockHash } as Parameters<ReturnType<typeof pub>["getLogs"]>[0]))
    .find((l) => l.transactionHash === receipt.transactionHash);
  const idx = log ? argsOf<{ gradingIndex: bigint }>(log).gradingIndex : (1n << 256n) - 1n;
  return { receipt, gradingIndex: idx === (1n << 256n) - 1n ? -1 : Number(idx) };
}

type GradingRaw = { ready: boolean; done: boolean; source: Address; requestId: bigint };

/** After a grading's round is out (and the keeper is late): deliver its randomness, then set the grades (finish). Only
 *  this grading, nobody else's. `ids`: the cards it was sent with, in order (skips the log scan when they match).
 *  Returns true once graded. */
export async function deliverAndFinish(p: { index: number; ids?: number[] }, o: WriteOpts = {}): Promise<boolean> {
  const i = BigInt(p.index);
  let g = await read<GradingRaw>("FirePsa", psaAbi, "gradingOf", [i]);
  if (g.done) return true;
  if (!g.ready) {
    await deliver(g.source, g.requestId, "the grades", o);
    g = await read<GradingRaw>("FirePsa", psaAbi, "gradingOf", [i]);
    if (!g.ready) return false;
  }
  await send(addr("FirePsa"), psaAbi, "finish", [i, await gradingIds(p.index, p.ids)], "Reveal the grades", "grade", o);
  return true;
}

/** Last resort, once a grading's randomness has had no answer for 24 hours (reads.gradingsOf / gradingStatus:
 *  canCancel): its cards come back unlocked and ungraded. `ids`: the cards it was sent with (else read from its event). */
export async function cancelGrading(p: { index: number; ids?: number[] }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  const ids = await gradingIds(p.index, p.ids);
  return send(addr("FirePsa"), psaAbi, "cancelGrading", [BigInt(p.index), ids], `Return ${plural(ids.length, "card")} ungraded`, "cancel", o);
}

// ---------------------------------------------------------------- burning

/** Burn cards: every 42 burned earns a free pack credit (the count carries over). Never paused. */
export function burnCards(p: { ids: number[] }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  return send(addr("FireCredits"), creditsAbi, "burnCards", [p.ids.map(BigInt)], `Burn ${plural(p.ids.length, "card")}`, "burn", o);
}

// ---------------------------------------------------------------- suggestions

/** Suggest a theme and an art style together, or a character: each text is its own suggestion, paid in PAPER
 *  (`suggestionPaper` each, burned). With FireCredits.suggestMany they go in one transaction; on an older deploy
 *  without it (the first testnet deploy) each is sent on its own, and `oneByOne` says so. */
export async function suggest(p: { texts: string[] }, o: WriteOpts = {}): Promise<{ receipts: TransactionReceipt[]; oneByOne: boolean }> {
  const texts = p.texts.map((t) => t.trim()).filter(Boolean);
  if (!texts.length) throw new Error("Write an idea first.");
  const each = await read<bigint>("FireCredits", creditsAbi, "suggestionPaper");
  const credits = addr("FireCredits");
  const many = texts.length > 1 && (await hasFunction("FireCredits", "suggestMany(string[],uint256)"));
  if (each > 0n) await approve(input("PAPER")!, addr("FireSale"), each * BigInt(texts.length), "Approve PAPER", o);
  if (many || texts.length === 1) {
    const r = many
      ? await send(credits, creditsAbi, "suggestMany", [texts, each * BigInt(texts.length)], `Send ${plural(texts.length, "idea")}`, "suggest", o)
      : await send(credits, creditsAbi, "suggest", [texts[0], each], "Send your idea", "suggest", o);
    return { receipts: [r], oneByOne: false };
  }
  const receipts: TransactionReceipt[] = [];
  for (const [i, t] of texts.entries()) receipts.push(await send(credits, creditsAbi, "suggest", [t, each], `Send suggestion ${i + 1} of ${texts.length}`, "suggest", o));
  return { receipts, oneByOne: true };
}

// ---------------------------------------------------------------- odds and ends

/** Anyone: close a drop once nothing can still sell (normally the last purchase does it, else the keeper; the site
 *  never asks a buyer to). */
export const closeDrop = (p: { fire: number }, o: WriteOpts = {}) => send(addr("FireSale"), saleAbi, "close", [BigInt(p.fire)], "End the sale", "close", o);

/** The PAPER this wallet has approved to FireSale (packs, credits, suggestions) and FirePsa's coins: for a page that
 *  shows "approved" state. */
export async function allowances(owner: Address) {
  const sale = addr("FireSale"), psa = addr("FirePsa");
  const a = (t: Address | undefined, s: Address) => (t ? pub().readContract({ address: t, abi: erc20Abi, functionName: "allowance", args: [owner, s] }).then(String) : Promise.resolve(null));
  const [paper, plank, usdg, plankPsa, usdgPsa] = await Promise.all([a(input("PAPER"), sale), a(input("PLANK"), sale), a(input("USDG"), sale), a(input("PLANK"), psa), a(input("USDG"), psa)]);
  return { sale: { PAPER: paper, PLANK: plank, USDG: usdg }, psa: { PLANK: plankPsa, USDG: usdgPsa } };
}
