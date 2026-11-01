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

/** A card for sale. `changes`: the card's change count when listed (FireCards.changes); a buy passes it back, so the
 *  buyer gets exactly the card they looked at. `expiry`: when the listing ends (unix seconds). */
export type CardOffer = { serial: number; seller: Address; price: string; priceEth: string; card: Card; changes: string; expiry: number };
export type PackOffer = { id: number; seller: Address; series: number; amount: number; pricePer: string; pricePerEth: string; expiry: number };
/** What an "any matching card" offer asks for: each field 0 / "any" = any. holo: none / frame / picture / full / any.
 *  maxMoves: moved at most this many times (null = any); cased: cased only / uncased only / any. */
export type MatchRule = {
  fire: number; cardType: number | null; character: number | null; holo: "any" | "none" | "frame" | "picture" | "full" | "anyHolo"; minGrade: number;
  maxMoves?: number | null; cased?: "any" | "cased" | "uncased";
};
/** A buy offer that can be accepted now. kind: card (one card, `serial`, as it was: `grade`, `cased`), match (any card
 *  meeting `rule`), packs. */
export type BuyOffer = {
  id: number; buyer: Address; kind: "card" | "match" | "packs"; price: string; priceEth: string; qty: number; expiry: number;
  serial?: number; rule?: MatchRule; series?: number; grade?: number; cased?: boolean;
};
/** The longest a listing lasts, and the default. */
export const MAX_LIST_DAYS = 180;
export const LIST_DAYS = 30;
/** FireMarket.MIN_OFFER: the least an offer can be for one card or pack. */
export const MIN_OFFER_WEI = 10n ** 13n;
const KINDS = ["card", "match", "packs"] as const;
const HOLO_CODE = { any: 0, none: 1, frame: 2, picture: 3, full: 4, anyHolo: 5 } as const;
const HOLO_NAME = ["any", "none", "frame", "picture", "full", "anyHolo"] as const;
const CASED_CODE = { any: 0, cased: 1, uncased: 2 } as const;
const CASED_NAME = ["any", "cased", "uncased"] as const;
/** The contract's matchKey, packed here (the same bits). */
export function matchKey(r: MatchRule): bigint {
  const mv = r.maxMoves == null ? 0 : Math.max(0, Math.min(15, Math.floor(r.maxMoves))) + 1;
  return BigInt(r.fire) | (BigInt(r.cardType == null ? 0 : r.cardType + 1) << 32n) | (BigInt(r.character == null ? 0 : r.character + 1) << 48n)
    | (BigInt(HOLO_CODE[r.holo]) << 80n) | (BigInt(r.minGrade) << 88n) | (BigInt(mv) << 96n) | (BigInt(CASED_CODE[r.cased ?? "any"]) << 104n);
}
export function unpackMatch(k: bigint): MatchRule {
  const n = (s: bigint, bits: bigint) => Number((k >> s) & ((1n << bits) - 1n));
  const t = n(32n, 16n), c = n(48n, 32n), mv = n(96n, 8n);
  return { fire: n(0n, 32n), cardType: t ? t - 1 : null, character: c ? c - 1 : null, holo: HOLO_NAME[n(80n, 8n)] ?? "any", minGrade: n(88n, 8n),
    maxMoves: mv ? mv - 1 : null, cased: CASED_NAME[n(104n, 8n)] ?? "any" };
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
/** The chain's clock (the latest block), not this device's: a phone's clock can be off. */
const chainNow = async (): Promise<bigint> => (await pub().getBlock()).timestamp;

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
  const [seller, price, live, expiry, changes] = await read<[Address, bigint, boolean, bigint, bigint]>("FireMarket", marketAbi, "cardOffer", [BigInt(serial)]);
  if (!live) return null;
  return { serial, seller: getAddress(seller), price: price.toString(), priceEth: eth(price), card: await card(serial), changes: changes.toString(), expiry: Number(expiry) };
}
type PackRaw = { seller: Address; series: number; amount: number; pricePer: bigint; round: bigint; expiry: number };
async function packOffer(id: number): Promise<PackOffer | null> {
  const [l, live] = await read<[PackRaw, bigint]>("FireMarket", marketAbi, "packOffer", [BigInt(id)]);
  if (live === 0n) return null;
  return { id, seller: getAddress(l.seller), series: Number(l.series), amount: Number(live), pricePer: l.pricePer.toString(), pricePerEth: eth(l.pricePer), expiry: Number(l.expiry) };
}
async function inBatches<T, R>(xs: T[], fn: (x: T) => Promise<R | null>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += 20) {
    const got = await Promise.allSettled(xs.slice(i, i + 20).map(fn));
    for (const g of got) if (g.status === "fulfilled" && g.value) out.push(g.value);
  }
  return out;
}

type OfferRaw = { buyer: Address; price: bigint; kind: number; qty: number; expiry: number; round: bigint; grade: number; cased: boolean; target: bigint };
const toOffer = (id: number, o: OfferRaw): BuyOffer => {
  const kind = KINDS[Number(o.kind)] ?? "card";
  return {
    id, buyer: getAddress(o.buyer), kind, price: o.price.toString(), priceEth: eth(o.price), qty: Number(o.qty), expiry: Number(o.expiry),
    ...(kind === "card" ? { serial: Number(o.target), grade: Number(o.grade), cased: !!o.cased } : kind === "packs" ? { series: Number(o.target) } : { rule: unpackMatch(o.target) }),
  };
};
async function buyOffer(id: number): Promise<BuyOffer | null> {
  const [o, live] = await read<[OfferRaw, boolean]>("FireMarket", marketAbi, "offerOf", [BigInt(id)]);
  return live ? toOffer(id, o) : null;
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

/** How fresh the market's numbers are. `indexer`: seconds our indexer is behind the chain (null: no indexer, the site
 *  reads the chain itself); `chainPaused`: the chain's newest block is more than 2 minutes old (Robinhood Chain stopped
 *  making blocks; nothing sent goes through until it's back). */
export async function marketHealth(): Promise<{ indexer: number | null; chainPaused: boolean }> {
  const head = await pub().getBlock().catch(() => null);
  const chainAt = head ? Number(head.timestamp) : 0, now = Math.floor(Date.now() / 1000);
  const chainPaused = !!head && now - chainAt > 120 && now - chainAt < 30 * 86400; // a device clock days off isn't a pause
  let indexer: number | null = null;
  if (indexerUp) {
    try {
      const r = await fetch("/api/idx/status", { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = (await r.json()) as Record<string, { block?: { timestamp?: number } }>;
        const t = Object.values(j)[0]?.block?.timestamp;
        if (t) indexer = Math.max(0, (chainAt || now) - t);
      }
    } catch { /* no indexer: null */ }
  }
  return { indexer, chainPaused };
}

/** Price guide numbers from our indexer (prices only, null without it). `groups`: per Series, type and graded or not:
 *  how many are listed and the lowest price. `sold`: per Series, type, character, holo look and grade (0 = ungraded):
 *  the median of the clean sales in the last 60 days (wash trades left out) and how many it's based on; no median
 *  under 3 sales. */
export type GroupStat = { fire: number; cardType: number; graded: boolean; listed: number; floorEth: string };
export type SoldStat = { fire: number; cardType: number; character: number; holo: "none" | "frame" | "picture" | "full"; grade: number; sales: number; medianEth: string | null };
export async function marketStats(): Promise<{ groups: GroupStat[]; sold: SoldStat[] } | null> {
  if (!marketOn() || !indexerUp) return null;
  try {
    const r = await fetch("/api/idx/market/stats", { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    type G = { fire: number; cardType: number; graded: boolean; listed: number; floor: string };
    type Sx = { fire: number; cardType: number; character: number; holoFrame: boolean; holoPicture: boolean; grade: number; sales: number; median: string | null };
    const j = (await r.json()) as { groups: G[]; sold: Sx[] };
    return {
      groups: j.groups.map((g) => ({ fire: g.fire, cardType: g.cardType, graded: g.graded, listed: g.listed, floorEth: eth(BigInt(g.floor)) })),
      sold: j.sold.map((x) => ({ fire: x.fire, cardType: x.cardType, character: x.character, holo: x.holoFrame && x.holoPicture ? "full" : x.holoFrame ? "frame" : x.holoPicture ? "picture" : "none",
        grade: x.grade, sales: x.sales, medianEth: x.median ? eth(BigInt(x.median)) : null })),
    };
  } catch { return null; }
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

/** Every offer `owner` made that hasn't ended (not filled, cancelled, expired or ended by cancelAll), whether or not
 *  its WETH is there now. `live`: it can be accepted now. An offer that isn't live comes back to life the moment the
 *  wallet has the WETH again, so Mine lists them to cancel. */
export async function myOffers(owner: Address): Promise<(BuyOffer & { live: boolean })[]> {
  if (!marketOn()) return [];
  const who = getAddress(owner);
  const [{ offers }, r, t] = await Promise.all([candidates(), read<bigint>("FireMarket", marketAbi, "round", [who]), chainNow()]);
  const now = Number(t);
  const rows = await inBatches(offers, async (id) => {
    const [o, live] = await read<[OfferRaw, boolean]>("FireMarket", marketAbi, "offerOf", [BigInt(id)]);
    if (o.buyer === "0x0000000000000000000000000000000000000000" || getAddress(o.buyer) !== who || Number(o.expiry) <= now || o.round !== r) return null;
    return { ...toOffer(id, o), live };
  });
  return rows.sort((a, b) => a.id - b.id);
}

/** `owner`'s WETH: what it holds, what it has let the market take, how much all its open offers could take together
 *  (`committed`, counting the ones that aren't funded now too: one balance can back many offers), and how many open
 *  offers aren't funded (`unbacked`). */
export async function wethOf(owner: Address): Promise<{ balance: string; allowance: string; committed: string; unbacked: number }> {
  if (!marketOn() || !input("WETH")) return { balance: "0", allowance: "0", committed: "0", unbacked: 0 };
  const [b, a, mine] = await Promise.all([
    pub().readContract({ address: weth(), abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    pub().readContract({ address: weth(), abi: erc20Abi, functionName: "allowance", args: [owner, at()] }),
    myOffers(owner).catch(() => [] as (BuyOffer & { live: boolean })[]),
  ]);
  const committed = mine.reduce((s, o) => s + BigInt(o.price) * BigInt(o.qty), 0n);
  return { balance: b.toString(), allowance: a.toString(), committed: committed.toString(), unbacked: mine.filter((o) => !o.live).length };
}

/** `owner`'s card listings that are asleep only because the market can't move its cards now (the approval was taken
 *  back): letting the market sell cards again would wake them. The site asks to cancel them first. */
export async function sleepingListings(owner: Address): Promise<CardOffer[]> {
  if (!marketOn()) return [];
  const who = getAddress(owner);
  const [{ serials }, r, t] = await Promise.all([candidates(), read<bigint>("FireMarket", marketAbi, "round", [who]), chainNow()]);
  const now = Number(t);
  return inBatches(serials, async (serial) => {
    const [seller, price, round, expiry, changes] = await read<[Address, bigint, bigint, bigint, bigint]>("FireMarket", marketAbi, "cardListing", [BigInt(serial)]);
    if (seller === "0x0000000000000000000000000000000000000000" || getAddress(seller) !== who || round !== r || Number(expiry) <= now) return null;
    const [holder, ch] = await Promise.all([
      pub().readContract({ address: addr("FireCards"), abi: cardsAbi, functionName: "ownerOf", args: [BigInt(serial)] }) as Promise<Address>,
      read<bigint>("FireCards", cardsAbi, "changes", [BigInt(serial)]),
    ]);
    if (getAddress(holder) !== who || ch !== changes) return null;
    return { serial, seller: who, price: price.toString(), priceEth: eth(price), card: await card(serial), changes: changes.toString(), expiry: Number(expiry) };
  });
}

/** The collection's resale royalty in basis points (ERC-2981 on FireCards, as a sale pays it; capped at 10% by the
 *  market), for "You get about". */
export async function royaltyBps(): Promise<number> {
  const [, r] = await pub().readContract({ address: addr("FireCards"), abi: cardsAbi, functionName: "royaltyInfo", args: [1n, 10_000n] }) as readonly [Address, bigint];
  return Math.min(1000, Number(r));
}

/** ETH a sale couldn't send to `owner` (a wallet that refused it), waiting to be collected. */
export const owedTo = async (owner: Address): Promise<string> => (marketOn() ? eth(await read<bigint>("FireMarket", marketAbi, "owed", [owner])) : "0");

// ---------------------------------------------------------------- writes

/** wakeOk: the seller agreed that old listings may go back on sale (or cancelled them). */
type ListOpts = WriteOpts & { wakeOk?: boolean };
async function allow(what: "cards" | "packs", o: ListOpts): Promise<void> {
  const owner = me(), ok = await marketApproved(owner);
  if (ok[what]) return;
  // letting the market sell your cards again would wake listings that are asleep: the site asks first (market.js)
  if (what === "cards" && !o.wakeOk && (await sleepingListings(owner).catch(() => [])).length) {
    throw Object.assign(new Error("You have old listings that would go back on sale. Take them off sale first."), { code: "sleeping" });
  }
  const name = what === "cards" ? "FireCards" : "FirePacks";
  await send("setApprovalForAll", [at(), true], `Let the market sell your ${what}`, o, undefined, addr(name), what === "cards" ? cardsAbi : packsAbi);
}

const expiryIn = async (days?: number, max = MAX_LIST_DAYS): Promise<bigint> => {
  const d = days ?? LIST_DAYS;
  if (!(d > 0 && d <= max)) throw new Error(`Pick how long it lasts: up to ${max} days.`);
  return (await chainNow()) + BigInt(Math.round(d * 86400)) - (d === max ? 120n : 0n); // the full 180 days: a little under, so it isn't refused a block later
};
/** List (or re-price) a card you hold at `priceEth`, for `days` (default 30). Asks once to let the market move your cards. */
export async function listCard(p: { serial: number; priceEth: string; days?: number }, o: ListOpts = {}): Promise<TransactionReceipt> {
  const wei = toWei(p.priceEth), until = await expiryIn(p.days);
  await allow("cards", o);
  return send("listCard", [BigInt(p.serial), wei, until], `List for ${p.priceEth} ETH`, o);
}
/** List several cards at once, each at its own price, all for `days` (up to 20). */
export async function listCards(p: { items: { serial: number; priceEth: string }[]; days?: number }, o: ListOpts = {}): Promise<TransactionReceipt> {
  if (!p.items.length || p.items.length > 20) throw new Error("List 1 to 20 cards at a time.");
  const wei = p.items.map((x) => toWei(x.priceEth)), until = await expiryIn(p.days);
  await allow("cards", o);
  return send("listCards", [p.items.map((x) => BigInt(x.serial)), wei, until], `List ${plural(p.items.length, "card")}`, o);
}
export const cancelCard = (p: { serial: number }, o: WriteOpts = {}) => send("cancelCard", [BigInt(p.serial)], "Take off sale", o);
export const cancelCards = (p: { serials: number[] }, o: WriteOpts = {}) => send("cancelCards", [p.serials.map(BigInt)], `Take ${plural(p.serials.length, "card")} off sale`, o);
/** Buy a listed card at the price shown (`price`: wei, as listings() gives it) and as it was shown (`changes`). The
 *  listing is read again from the chain first: if the price or the card changed, it stops and says so (nothing sent). */
export async function buyCard(p: { serial: number; price: string; changes: string }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  const now = await cardOffer(p.serial).catch(() => null);
  if (!now) throw new Error("That's no longer for sale (sold, moved, changed or ended). Nothing was charged.");
  if (now.price !== p.price) throw new Error(`The price just changed to ${now.priceEth} ETH. Check it and try again. Nothing was charged.`);
  if (now.changes !== p.changes) throw new Error("That card changed since you looked (moved, cased or graded). Check it again. Nothing was charged.");
  return send("buyCard", [BigInt(p.serial), BigInt(p.price), BigInt(p.changes)], `Buy for ${eth(BigInt(p.price))} ETH`, o, BigInt(p.price));
}

/** List `amount` of your Series `series` packs at `pricePerEth` each, for `days` (default 30). */
export async function listPacks(p: { series: number; amount: number; pricePerEth: string; days?: number }, o: WriteOpts = {}): Promise<TransactionReceipt> {
  const wei = toWei(p.pricePerEth), until = await expiryIn(p.days);
  await allow("packs", o);
  return send("listPacks", [BigInt(p.series), BigInt(p.amount), wei, until], `List ${plural(p.amount, "pack")} at ${p.pricePerEth} ETH`, o);
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
  if (wei < MIN_OFFER_WEI) throw new Error("An offer is at least 0.00001 ETH.");
  const kind = p.serial != null ? 0 : p.rule ? 1 : 2;
  const target = kind === 0 ? BigInt(p.serial!) : kind === 1 ? matchKey(p.rule!) : BigInt(p.series ?? 0);
  const qty = kind === 0 ? 1 : Math.max(1, Math.floor(p.qty ?? 1));
  const expiry = await expiryIn(p.days, 180);
  const need = wei * BigInt(qty);
  const w = await wethOf(owner), free = BigInt(w.balance) - BigInt(w.committed);
  if (free < need) {
    const wrap = need - (free > 0n ? free : 0n);
    await send("deposit", [], `Turn ${eth(wrap)} ETH into WETH`, o, wrap, weth(), wethAbi);
  }
  const want = BigInt(w.committed) + need;
  if (BigInt(w.allowance) < want) await send("approve", [at(), want], "Let the market use your WETH for offers", o, undefined, weth(), erc20Abi);
  const what = kind === 0 ? "this card" : kind === 1 ? (qty > 1 ? `${qty} cards` : "a card") : plural(qty, "pack");
  return send("makeOffer", [kind, target, wei, BigInt(qty), expiry], `Offer ${p.priceEth} ETH for ${what}`, o);
}
export const cancelOffer = (p: { id: number }, o: WriteOpts = {}) => send("cancelOffer", [BigInt(p.id)], "Cancel the offer", o);
/** Accept an offer: sell it card `serial` (a card or match offer) or `amount` packs (a pack offer), at the offer's
 *  price (`price`: wei, as listings() gives it). Asks once to let the market move your cards / packs. */
export async function acceptOffer(p: { id: number; kind: BuyOffer["kind"]; serial?: number; amount?: number; price: string }, o: ListOpts = {}): Promise<TransactionReceipt> {
  const now = await buyOffer(p.id).catch(() => null); // read again right before: it may have been pulled or changed
  if (!now) throw new Error("That offer is gone or can't be paid any more. Nothing was sent.");
  if (now.price !== p.price) throw new Error("That offer changed. Check it again. Nothing was sent.");
  await allow(p.kind === "packs" ? "packs" : "cards", o);
  const n = p.kind === "packs" ? Math.max(1, p.amount ?? 1) : 1;
  return send("acceptOffer", [BigInt(p.id), BigInt(p.serial ?? 0), BigInt(n), BigInt(p.price)], `Sell for ${eth(BigInt(p.price) * BigInt(n))} ETH`, o);
}
/** Switch the market off for this wallet: it can no longer move your cards or packs (listings sleep) or take WETH for
 *  your offers (they can't be accepted). One wallet confirmation per thing that was on. Listing again asks again. */
export async function revokeMarket(o: WriteOpts = {}): Promise<number> {
  const owner = me(), ok = await marketApproved(owner);
  let n = 0;
  if (ok.cards) { await send("setApprovalForAll", [at(), false], "Stop the market moving your cards", o, undefined, addr("FireCards"), cardsAbi); n++; }
  if (ok.packs) { await send("setApprovalForAll", [at(), false], "Stop the market moving your packs", o, undefined, addr("FirePacks"), packsAbi); n++; }
  if (input("WETH")) {
    const a = await pub().readContract({ address: weth(), abi: erc20Abi, functionName: "allowance", args: [owner, at()] });
    if (a > 0n) { await send("approve", [at(), 0n], "Stop the market using your WETH", o, undefined, weth(), erc20Abi); n++; }
  }
  return n;
}

/** Turn WETH back into ETH (what open offers don't need). */
export const unwrapWeth = (p: { amount: string }, o: WriteOpts = {}) => send("withdraw", [BigInt(p.amount)], `Turn ${eth(BigInt(p.amount))} WETH into ETH`, o, undefined, weth(), wethAbi);
export const withdrawOwed = (o: WriteOpts = {}) => send("withdraw", [], "Collect your sale money", o);
