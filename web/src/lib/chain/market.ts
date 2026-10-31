// The market (FireMarket): cards and sealed packs for sale at a fixed price in ETH. It never holds them: a listing is a
// price, and the card stays in the seller's wallet until someone buys it (the seller approves the market once, per
// collection). A buy pays out in the same transaction (the royalty, then the seller). On a network without FireMarket
// (before its deploy) `marketOn()` is false and the site hides the market.
//
// Listings: our indexer's (/api/idx/market) when it's up, else a scan of the market's events since the deploy; either
// way each is checked against the chain (cardOffer / packOffer), so only listings that can be bought now are shown.

import { erc20Abi, formatEther, getAddress, parseAbi, parseEther, type Address, type TransactionReceipt } from "viem";
import { marketAbi } from "../cards";
import { NET } from "../net";
import { sendTx } from "../tx";
import { getAccount } from "../wallet";
import { addr, argsOf, cardsAbi, eventOf, input, packsAbi, pub, read, scanLogs } from "./contracts";
import { card, type Card } from "./reads";
import type { WriteOpts } from "./writes";

export { marketAbi };

export type CardOffer = { serial: number; seller: Address; price: string; priceEth: string; card: Card };
export type PackOffer = { id: number; seller: Address; series: number; amount: number; pricePer: string; pricePerEth: string };
/** What an "any matching card" offer asks for: each field 0 / "any" = any. holo: none / frame / picture / full / any. */
export type MatchRule = { fire: number; cardType: number | null; character: number | null; holo: "any" | "none" | "frame" | "picture" | "full" | "anyHolo"; minGrade: number };
/** A buy offer that can be accepted now. kind: card (one card, `serial`), match (any card meeting `rule`), packs. */
export type BuyOffer = {
  id: number; buyer: Address; kind: "card" | "match" | "packs"; price: string; priceEth: string; qty: number; expiry: number;
  serial?: number; rule?: MatchRule; series?: number;
};
const KINDS = ["card", "match", "packs"] as const;
const HOLO_CODE = { any: 0, none: 1, frame: 2, picture: 3, full: 4, anyHolo: 5 } as const;
const HOLO_NAME = ["any", "none", "frame", "picture", "full", "anyHolo"] as const;
/** The contract's matchKey, packed here (the same bits). */
export function matchKey(r: MatchRule): bigint {
  return BigInt(r.fire) | (BigInt(r.cardType == null ? 0 : r.cardType + 1) << 32n) | (BigInt(r.character == null ? 0 : r.character + 1) << 48n)
    | (BigInt(HOLO_CODE[r.holo]) << 80n) | (BigInt(r.minGrade) << 88n);
}
export function unpackMatch(k: bigint): MatchRule {
  const n = (s: bigint, bits: bigint) => Number((k >> s) & ((1n << bits) - 1n));
  const t = n(32n, 16n), c = n(48n, 32n);
  return { fire: n(0n, 32n), cardType: t ? t - 1 : null, character: c ? c - 1 : null, holo: HOLO_NAME[n(80n, 8n)] ?? "any", minGrade: n(88n, 8n) };
}
const wethAbi = parseAbi(["function deposit() payable", "function withdraw(uint256)"]);
const weth = (): Address => {
  const a = input("WETH");
  if (!a) throw new Error(`WETH isn't set up on ${NET.label}.`);
  return a;
};

/** Is FireMarket deployed on this network? */
export const marketOn = (): boolean => !!NET.deployment.contracts?.FireMarket;
const at = (): Address => addr("FireMarket");

const me = (): Address => {
  const a = getAccount();
  if (a.status !== "connected" || !a.address) throw new Error("Connect your wallet first.");
  return a.address;
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const send = (functionName: string, args: readonly unknown[], label: string, o: WriteOpts, value?: bigint, address = at(), abi = marketAbi) =>
  sendTx({ address, abi, functionName, args, value }, { label, kind: "market", onStep: (s, h) => o.onStep?.(s, label, h) });

/** "0.0123" ETH text -> wei; refuses 0, negatives and junk. */
export function toWei(eth: string): bigint {
  const t = String(eth).trim();
  if (!/^\d*\.?\d+$/.test(t)) throw new Error("Enter a price in ETH, like 0.01.");
  const w = parseEther(t);
  if (w <= 0n) throw new Error("The price must be more than 0.");
  if (w >= 2n ** 96n) throw new Error("That price is too high.");
  return w;
}
const eth = (wei: bigint) => formatEther(wei);

// ---------------------------------------------------------------- reads

type IdxListings = { cards: { serial: string }[]; packs: { id: string }[]; offers?: { id: string }[] };
let indexerUp = typeof fetch === "function" && typeof location !== "undefined";

/** The serials and pack listing ids that may be listed: the indexer's, else the market's events since the deploy. */
async function candidates(): Promise<{ serials: number[]; ids: number[]; offers: number[] }> {
  if (indexerUp) {
    try {
      const r = await fetch("/api/idx/market", { signal: AbortSignal.timeout(6000) });
      if (r.status === 503 || r.status === 404) indexerUp = false;
      else if (r.ok) {
        const j = (await r.json()) as IdxListings;
        return { serials: j.cards.map((c) => Number(c.serial)), ids: j.packs.map((p) => Number(p.id)), offers: (j.offers ?? []).map((o) => Number(o.id)) };
      }
    } catch { /* the chain below */ }
  }
  const [cl, pl, ol] = await Promise.all([scanLogs(at(), eventOf(marketAbi, "CardListed")), scanLogs(at(), eventOf(marketAbi, "PacksListed")), scanLogs(at(), eventOf(marketAbi, "OfferMade"))]);
  return {
    serials: [...new Set(cl.map((l) => Number(argsOf<{ serial: bigint }>(l).serial)))],
    ids: [...new Set(pl.map((l) => Number(argsOf<{ id: bigint }>(l).id)))],
    offers: [...new Set(ol.map((l) => Number(argsOf<{ id: bigint }>(l).id)))],
  };
}

async function cardOffer(serial: number): Promise<CardOffer | null> {
  const [seller, price, live] = await read<[Address, bigint, boolean]>("FireMarket", marketAbi, "cardOffer", [BigInt(serial)]);
  if (!live) return null;
  return { serial, seller: getAddress(seller), price: price.toString(), priceEth: eth(price), card: await card(serial) };
}
type PackRaw = { seller: Address; series: number; amount: number; pricePer: bigint; round: bigint };
async function packOffer(id: number): Promise<PackOffer | null> {
  const [l, live] = await read<[PackRaw, bigint]>("FireMarket", marketAbi, "packOffer", [BigInt(id)]);
  if (live === 0n) return null;
  return { id, seller: getAddress(l.seller), series: Number(l.series), amount: Number(live), pricePer: l.pricePer.toString(), pricePerEth: eth(l.pricePer) };
}
async function inBatches<T, R>(xs: T[], fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += 20) {
    const got = await Promise.allSettled(xs.slice(i, i + 20).map(fn));
    for (const g of got) if (g.status === "fulfilled" && g.value) out.push(g.value);
  }
  return out;
}

type OfferRaw = { buyer: Address; price: bigint; kind: number; qty: number; expiry: number; round: bigint; target: bigint };
async function buyOffer(id: number): Promise<BuyOffer | null> {
  const [o, live] = await read<[OfferRaw, boolean]>("FireMarket", marketAbi, "offerOf", [BigInt(id)]);
  if (!live) return null;
  const kind = KINDS[Number(o.kind)] ?? "card";
  return {
    id, buyer: getAddress(o.buyer), kind, price: o.price.toString(), priceEth: eth(o.price), qty: Number(o.qty), expiry: Number(o.expiry),
    ...(kind === "card" ? { serial: Number(o.target) } : kind === "packs" ? { series: Number(o.target) } : { rule: unpackMatch(o.target) }),
  };
}
const byPrice = <T extends { price?: string; pricePer?: string }>(desc = false) => (a: T, b: T) => {
  const x = BigInt(a.price ?? a.pricePer ?? 0), y = BigInt(b.price ?? b.pricePer ?? 0);
  return x === y ? 0 : (x < y) !== desc ? -1 : 1;
};

/** Everything for sale now (only listings that can be bought: the seller still holds it and approved the market), and
 *  every offer that can be accepted (the buyer still has the WETH), best first. */
export async function listings(): Promise<{ cards: CardOffer[]; packs: PackOffer[]; offers: BuyOffer[] }> {
  if (!marketOn()) return { cards: [], packs: [], offers: [] };
  const c = await candidates();
  const [cards, packs, offers] = await Promise.all([inBatches(c.serials, cardOffer), inBatches(c.ids, packOffer), inBatches(c.offers, buyOffer)]);
  return { cards: cards.sort(byPrice()), packs: packs.sort(byPrice()), offers: offers.sort(byPrice(true)) };
}

/** Does a card meet a match offer? (FireMarket.matches, read on the chain) */
export const matchesOffer = (o: BuyOffer, serial: number): Promise<boolean> =>
  o.kind === "card" ? Promise.resolve(o.serial === serial) : o.kind === "match" ? read<boolean>("FireMarket", marketAbi, "matches", [matchKey(o.rule!), BigInt(serial)]).catch(() => false) : Promise.resolve(false);

/** The newest sales (listings bought and offers accepted): the indexer's, else the market's events since the deploy. */
export type Sale = { kind: "card" | "packs"; serial?: number; series?: number; amount: number; seller: Address; buyer: Address; price: string; priceEth: string; at: number; block?: bigint };
export async function recentSales(limit = 30): Promise<Sale[]> {
  if (!marketOn()) return [];
  if (indexerUp) {
    try {
      const r = await fetch(`/api/idx/sales?limit=${limit}`, { signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const j = (await r.json()) as { sales: { kind: string; serial: string | null; fire: number | null; amount: number; seller: Address; buyer: Address; price: string; at: number }[] };
        return j.sales.map((x) => ({ kind: x.kind === "packs" ? "packs" : "card", serial: x.serial ? Number(x.serial) : undefined, series: x.fire ?? undefined, amount: x.amount,
          seller: getAddress(x.seller), buyer: getAddress(x.buyer), price: x.price, priceEth: eth(BigInt(x.price)), at: x.at }));
      }
    } catch { /* the chain below */ }
  }
  type A = { serial?: bigint; id?: bigint; seller: Address; buyer: Address; price?: bigint; pricePer?: bigint; amount?: bigint; series?: bigint; item?: bigint };
  const [cs, ps, oa] = await Promise.all(["CardSold", "PacksSold", "OfferAccepted"].map((e) => scanLogs(at(), eventOf(marketAbi, e))));
  const offerKinds = new Map<number, number>();
  if (oa.length) {
    const made = await scanLogs(at(), eventOf(marketAbi, "OfferMade"));
    for (const l of made) { const a = argsOf<{ id: bigint; kind: number }>(l); offerKinds.set(Number(a.id), Number(a.kind)); }
  }
  const rows: Sale[] = [];
  for (const l of cs) { const a = argsOf<A>(l); rows.push({ kind: "card", serial: Number(a.serial), amount: 1, seller: a.seller, buyer: a.buyer, price: a.price!.toString(), priceEth: eth(a.price!), at: 0, block: l.blockNumber ?? 0n }); }
  for (const l of ps) { const a = argsOf<A>(l); const t = a.amount! * a.pricePer!; rows.push({ kind: "packs", series: Number(a.series), amount: Number(a.amount), seller: a.seller, buyer: a.buyer, price: t.toString(), priceEth: eth(t), at: 0, block: l.blockNumber ?? 0n }); }
  for (const l of oa) {
    const a = argsOf<A>(l), packs = offerKinds.get(Number(a.id)) === 2, t = a.amount! * a.price!;
    rows.push({ kind: packs ? "packs" : "card", ...(packs ? { series: Number(a.item) } : { serial: Number(a.item) }), amount: Number(a.amount), seller: a.seller, buyer: a.buyer, price: t.toString(), priceEth: eth(t), at: 0, block: l.blockNumber ?? 0n });
  }
  rows.sort((x, y) => Number((y.block ?? 0n) - (x.block ?? 0n)));
  const top = rows.slice(0, limit);
  const blocks = [...new Set(top.map((r) => r.block!))];
  const times = new Map(await Promise.all(blocks.map(async (b) => [b, Number((await pub().getBlock({ blockNumber: b })).timestamp)] as const)));
  for (const r of top) r.at = times.get(r.block!) ?? 0;
  return top;
}

/** A card's live listing, or null. */
export const offerOf = (serial: number): Promise<CardOffer | null> => (marketOn() ? cardOffer(serial).catch(() => null) : Promise.resolve(null));

/** Has `owner` let the market move its cards / packs (needed to list)? */
export async function marketApproved(owner: Address): Promise<{ cards: boolean; packs: boolean }> {
  if (!marketOn()) return { cards: false, packs: false };
  const m = at();
  const [cards, packs] = await Promise.all([
    pub().readContract({ address: addr("FireCards"), abi: cardsAbi, functionName: "isApprovedForAll", args: [owner, m] }) as Promise<boolean>,
    pub().readContract({ address: addr("FirePacks"), abi: packsAbi, functionName: "isApprovedForAll", args: [owner, m] }) as Promise<boolean>,
  ]);
  return { cards, packs };
}

/** `owner`'s WETH: what it holds, what it has let the market take, and how much its open offers could take. */
export async function wethOf(owner: Address): Promise<{ balance: string; allowance: string; committed: string }> {
  if (!marketOn() || !input("WETH")) return { balance: "0", allowance: "0", committed: "0" };
  const [b, a, all] = await Promise.all([
    pub().readContract({ address: weth(), abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    pub().readContract({ address: weth(), abi: erc20Abi, functionName: "allowance", args: [owner, at()] }),
    listings().catch(() => ({ offers: [] as BuyOffer[] })),
  ]);
  const committed = all.offers.filter((o) => o.buyer === getAddress(owner)).reduce((s, o) => s + BigInt(o.price) * BigInt(o.qty), 0n);
  return { balance: b.toString(), allowance: a.toString(), committed: committed.toString() };
}

/** ETH a sale couldn't send to `owner` (a wallet that refused it), waiting to be collected. */
export const owedTo = async (owner: Address): Promise<string> => (marketOn() ? eth(await read<bigint>("FireMarket", marketAbi, "owed", [owner])) : "0");

// ---------------------------------------------------------------- writes

async function allow(what: "cards" | "packs", o: WriteOpts): Promise<void> {
  const owner = me(), ok = await marketApproved(owner);
  if (ok[what]) return;
  const name = what === "cards" ? "FireCards" : "FirePacks";
  await send("setApprovalForAll", [at(), true], `Let the market sell your ${what}`, o, undefined, addr(name), what === "cards" ? cardsAbi : packsAbi);
}

/** List (or re-price) a card you hold at `priceEth`. Asks once to let the market move your cards. */
export async function listCard(p: { serial: number; priceEth: string }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  const wei = toWei(p.priceEth);
  await allow("cards", o);
  return send("listCard", [BigInt(p.serial), wei], `List for ${p.priceEth} ETH`, o);
}
export const cancelCard = (p: { serial: number }, o: WriteOpts = {}) => send("cancelCard", [BigInt(p.serial)], "Take off sale", o);
/** Buy a listed card at the price shown (`price`: wei, as listings() gives it). */
export const buyCard = (p: { serial: number; price: string }, o: WriteOpts = {}) =>
  send("buyCard", [BigInt(p.serial), BigInt(p.price)], `Buy for ${eth(BigInt(p.price))} ETH`, o, BigInt(p.price));

/** List `amount` of your Series `series` packs at `pricePerEth` each. */
export async function listPacks(p: { series: number; amount: number; pricePerEth: string }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  const wei = toWei(p.pricePerEth);
  await allow("packs", o);
  return send("listPacks", [BigInt(p.series), BigInt(p.amount), wei], `List ${plural(p.amount, "pack")} at ${p.pricePerEth} ETH`, o);
}
export const cancelPacks = (p: { id: number }, o: WriteOpts = {}) => send("cancelPacks", [BigInt(p.id)], "Take packs off sale", o);
export const buyMarketPacks = (p: { id: number; amount: number; pricePer: string }, o: WriteOpts = {}) => {
  const per = BigInt(p.pricePer), total = per * BigInt(p.amount);
  return send("buyPacks", [BigInt(p.id), BigInt(p.amount), per], `Buy ${plural(p.amount, "pack")} for ${eth(total)} ETH`, o, total);
};
/** End every listing and offer you have, cards and packs. */
export const cancelAllListings = (o: WriteOpts = {}) => send("cancelAll", [], "Take everything off sale", o);

// ---------------------------------------------------------------- offers (paid in WETH, which stays in the wallet)

/** Offer `priceEth` each for `qty` of: one card (`serial`), any card meeting `rule`, or a Series' packs (`series`),
 *  for `days` days. Wraps the ETH it needs into WETH (only what the wallet's other open offers don't already cover)
 *  and approves the market for it, then makes the offer. Nothing leaves the wallet until a holder accepts. */
export async function makeOffer(p: { serial?: number; rule?: MatchRule; series?: number; priceEth: string; qty?: number; days: number }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  const wei = toWei(p.priceEth), owner = me();
  const kind = p.serial != null ? 0 : p.rule ? 1 : 2;
  const target = kind === 0 ? BigInt(p.serial!) : kind === 1 ? matchKey(p.rule!) : BigInt(p.series ?? 0);
  const qty = kind === 0 ? 1 : Math.max(1, Math.floor(p.qty ?? 1));
  if (!(p.days > 0 && p.days <= 180)) throw new Error("Pick how long it lasts: up to 180 days.");
  const need = wei * BigInt(qty);
  const w = await wethOf(owner), free = BigInt(w.balance) - BigInt(w.committed);
  if (free < need) {
    const wrap = need - (free > 0n ? free : 0n);
    await send("deposit", [], `Turn ${eth(wrap)} ETH into WETH`, o, wrap, weth(), wethAbi);
  }
  const want = BigInt(w.committed) + need;
  if (BigInt(w.allowance) < want) await send("approve", [at(), want], "Let the market use your WETH for offers", o, undefined, weth(), erc20Abi);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + Math.round(p.days * 86400));
  const what = kind === 0 ? "this card" : kind === 1 ? (qty > 1 ? `${qty} cards` : "a card") : plural(qty, "pack");
  return send("makeOffer", [kind, target, wei, BigInt(qty), expiry], `Offer ${p.priceEth} ETH for ${what}`, o);
}
export const cancelOffer = (p: { id: number }, o: WriteOpts = {}) => send("cancelOffer", [BigInt(p.id)], "Cancel the offer", o);
/** Accept an offer: sell it card `serial` (a card or match offer) or `amount` packs (a pack offer), at the offer's
 *  price (`price`: wei, as listings() gives it). Asks once to let the market move your cards / packs. */
export async function acceptOffer(p: { id: number; kind: BuyOffer["kind"]; serial?: number; amount?: number; price: string }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  await allow(p.kind === "packs" ? "packs" : "cards", o);
  const n = p.kind === "packs" ? Math.max(1, p.amount ?? 1) : 1;
  return send("acceptOffer", [BigInt(p.id), BigInt(p.serial ?? 0), BigInt(n), BigInt(p.price)], `Sell for ${eth(BigInt(p.price) * BigInt(n))} ETH`, o);
}
/** Turn WETH back into ETH (what open offers don't need). */
export const unwrapWeth = (p: { amount: string }, o: WriteOpts = {}) => send("withdraw", [BigInt(p.amount)], `Turn ${eth(BigInt(p.amount))} WETH into ETH`, o, undefined, weth(), wethAbi);
export const withdrawOwed = (o: WriteOpts = {}) => send("withdraw", [], "Collect your sale money", o);
