// The market (FireMarket): cards and sealed packs for sale at a fixed price in ETH. It never holds them: a listing is a
// price, and the card stays in the seller's wallet until someone buys it (the seller approves the market once, per
// collection). A buy pays out in the same transaction (the royalty, then the seller). On a network without FireMarket
// (before its deploy) `marketOn()` is false and the site hides the market.
//
// Listings: our indexer's (/api/idx/market) when it's up, else a scan of the market's events since the deploy; either
// way each is checked against the chain (cardOffer / packOffer), so only listings that can be bought now are shown.

import { formatEther, getAddress, parseEther, type Address, type TransactionReceipt } from "viem";
import { marketAbi } from "../cards";
import { NET } from "../net";
import { sendTx } from "../tx";
import { getAccount } from "../wallet";
import { addr, argsOf, cardsAbi, eventOf, packsAbi, pub, read, scanLogs } from "./contracts";
import { card, type Card } from "./reads";
import type { WriteOpts } from "./writes";

export { marketAbi };

export type CardOffer = { serial: number; seller: Address; price: string; priceEth: string; card: Card };
export type PackOffer = { id: number; seller: Address; series: number; amount: number; pricePer: string; pricePerEth: string };

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

type IdxListings = { cards: { serial: string }[]; packs: { id: string }[] };
let indexerUp = typeof fetch === "function" && typeof location !== "undefined";

/** The serials and pack listing ids that may be listed: the indexer's, else the market's events since the deploy. */
async function candidates(): Promise<{ serials: number[]; ids: number[] }> {
  if (indexerUp) {
    try {
      const r = await fetch("/api/idx/market", { signal: AbortSignal.timeout(6000) });
      if (r.status === 503 || r.status === 404) indexerUp = false;
      else if (r.ok) {
        const j = (await r.json()) as IdxListings;
        return { serials: j.cards.map((c) => Number(c.serial)), ids: j.packs.map((p) => Number(p.id)) };
      }
    } catch { /* the chain below */ }
  }
  const [cl, pl] = await Promise.all([scanLogs(at(), eventOf(marketAbi, "CardListed")), scanLogs(at(), eventOf(marketAbi, "PacksListed"))]);
  return {
    serials: [...new Set(cl.map((l) => Number(argsOf<{ serial: bigint }>(l).serial)))],
    ids: [...new Set(pl.map((l) => Number(argsOf<{ id: bigint }>(l).id)))],
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

/** Everything for sale now (only listings that can be bought: the seller still holds it and approved the market). */
export async function listings(): Promise<{ cards: CardOffer[]; packs: PackOffer[] }> {
  if (!marketOn()) return { cards: [], packs: [] };
  const c = await candidates();
  const [cards, packs] = await Promise.all([inBatches(c.serials, cardOffer), inBatches(c.ids, packOffer)]);
  return { cards: cards.sort((a, b) => (BigInt(a.price) < BigInt(b.price) ? -1 : 1)), packs: packs.sort((a, b) => (BigInt(a.pricePer) < BigInt(b.pricePer) ? -1 : 1)) };
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
/** End every listing you have, cards and packs. */
export const cancelAllListings = (o: WriteOpts = {}) => send("cancelAll", [], "Take everything off sale", o);
export const withdrawOwed = (o: WriteOpts = {}) => send("withdraw", [], "Collect your sale money", o);
