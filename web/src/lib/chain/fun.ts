// Reads for the site's fun layer (forge/feed.js, share.js, binder.js): the rare-pulls feed, the per-Series board of
// who fed the fire, a sold-out Series' recap and a Series' cast. Read-only, built on the same cached incremental log
// scans as everything else (contracts.ts scanLogs), so polling them costs one getLogs over the new blocks.

import { type Address } from "viem";
import { addr, argsOf, cardsAbi, dealerAbi, eventOf, pub, psaAbi, read, saleAbi, scanLogs } from "./contracts";

/** One card dealt: who opened the pack it came from, and its kind (no image: card(serial) reads that when needed). */
export type DealtCard = {
  serial: number; fire: number; holder: string | null; material: string; character: string;
  holo: "none" | "frame" | "picture" | "full"; block: number; at: number | null;
};

type TextRaw = { typeName: string; typeSlug: string; characterName: string; category: string; extraAttributes: string };
const texts = new Map<string, Promise<TextRaw | null>>(); // fire|cardType|character -> its names (they never change)
function cardText(fire: bigint, cardType: bigint, character: bigint): Promise<TextRaw | null> {
  const k = `${fire}|${cardType}|${character}`;
  let p = texts.get(k);
  if (!p) {
    p = read<TextRaw>("RecipeDealer", dealerAbi, "cardText", [fire, cardType, character, 0n]).catch(() => { texts.delete(k); return null; });
    texts.set(k, p);
  }
  return p;
}

const blockTimes = new Map<bigint, Promise<number | null>>();
/** A block's time (unix seconds), cached. */
function blockTime(n: bigint): Promise<number | null> {
  let p = blockTimes.get(n);
  if (!p) { p = pub().getBlock({ blockNumber: n }).then((b) => Number(b.timestamp), () => { blockTimes.delete(n); return null; }); blockTimes.set(n, p); }
  return p;
}

/** The latest cards dealt in a Series (FireCards CardDealt), newest first, at most `limit`, each with the wallet that
 *  opened its pack (PacksOpened, joined on the open's index). The site keeps the rare ones (its own odds maths). */
export async function dealtCards(fire: number, limit = 120): Promise<DealtCard[]> {
  const f = BigInt(fire);
  const [dealt, opens] = await Promise.all([
    scanLogs(addr("FireCards"), eventOf(cardsAbi, "CardDealt"), { fire: f }),
    scanLogs(addr("FireCards"), eventOf(cardsAbi, "PacksOpened"), { fire: f }),
  ]);
  const holderOf = new Map<string, string>();
  for (const l of opens) { const a = argsOf<{ openIndex: bigint; holder: Address }>(l); holderOf.set(a.openIndex.toString(), a.holder); }
  const last = dealt.slice(-limit).reverse();
  return Promise.all(last.map(async (l) => {
    const a = argsOf<{ serial: bigint; openIndex: bigint; cardType: bigint; holoFrame: boolean; holoPicture: boolean; character: bigint }>(l);
    const t = await cardText(f, a.cardType, a.character);
    const holo = a.holoFrame && a.holoPicture ? "full" : a.holoFrame ? "frame" : a.holoPicture ? "picture" : "none";
    return {
      serial: Number(a.serial), fire, holder: holderOf.get(a.openIndex.toString()) ?? null, material: t?.typeName ?? "",
      character: t?.characterName ?? "", holo, block: Number(l.blockNumber ?? 0n), at: l.blockNumber != null ? await blockTime(l.blockNumber) : null,
    } as DealtCard;
  }));
}

/** One wallet on a Series' board: packs bought and claimed free (FireSale PacksBought + CreditsUsed for that Series),
 *  and cards cased and sent to the grader (FirePsa Protected) while that Series was the latest drop. No event links a
 *  wallet to the PAPER it burned (packs take PAPER, cases and grades are swapped and burned in bulk), so this counts
 *  what each wallet did, not PAPER. */
export type BoardRow = { wallet: string; packs: number; free: number; cased: number; graded: number };

/** The board for a Series, most packs first (then cases and grades). */
export async function fuelBoard(fire: number): Promise<BoardRow[]> {
  const f = BigInt(fire);
  const [bought, used, configured, protectedLogs] = await Promise.all([
    scanLogs(addr("FireSale"), eventOf(saleAbi, "PacksBought"), { fire: f }),
    scanLogs(addr("FireSale"), eventOf(saleAbi, "CreditsUsed"), { fire: f }),
    scanLogs(addr("FireSale"), eventOf(saleAbi, "DropConfigured")),
    scanLogs(addr("FirePsa"), eventOf(psaAbi, "Protected")),
  ]);
  // this Series' window: from its drop's setup to the next Series' setup
  const setups = configured.map((l) => ({ fire: argsOf<{ fire: bigint }>(l).fire, block: l.blockNumber ?? 0n })).sort((a, b) => (a.block < b.block ? -1 : 1));
  const mine = setups.find((s) => s.fire === f), next = mine ? setups.find((s) => s.block > mine.block) : undefined;
  const from = mine?.block ?? 0n, to = next?.block ?? (1n << 62n);
  const rows = new Map<string, BoardRow>();
  const row = (w: string) => { const k = w.toLowerCase(); let r = rows.get(k); if (!r) rows.set(k, (r = { wallet: w, packs: 0, free: 0, cased: 0, graded: 0 })); return r; };
  for (const l of bought) { const a = argsOf<{ buyer: Address; count: bigint }>(l); row(a.buyer).packs += Number(a.count); }
  for (const l of used) { const a = argsOf<{ buyer: Address; count: bigint }>(l); row(a.buyer).free += Number(a.count); }
  for (const l of protectedLogs) {
    const b = l.blockNumber ?? 0n; if (b < from || b >= to) continue;
    const a = argsOf<{ by: Address; cased: readonly bigint[]; graded: readonly bigint[] }>(l);
    const r = row(a.by); r.cased += a.cased.length; r.graded += a.graded.length;
  }
  return [...rows.values()].sort((x, y) => y.packs + y.free - (x.packs + x.free) || y.cased + y.graded - (x.cased + x.graded));
}

/** A sold-out Series' story: when its sale opened and closed (unix seconds; FireSale DropClosed's block), its packs
 *  (bought and free) and how many wallets bought. */
export async function seriesRecap(fire: number): Promise<{ fire: number; start: number; closedAt: number | null; packs: number; buyers: number }> {
  const f = BigInt(fire);
  const [d, closed, bought] = await Promise.all([
    read<{ start: bigint; sold: bigint; creditPacks: bigint }>("FireSale", saleAbi, "dropOf", [f]),
    scanLogs(addr("FireSale"), eventOf(saleAbi, "DropClosed"), { fire: f }),
    scanLogs(addr("FireSale"), eventOf(saleAbi, "PacksBought"), { fire: f }),
  ]);
  const end = closed.length ? closed[closed.length - 1] : bought[bought.length - 1];
  const closedAt = end?.blockNumber != null ? await blockTime(end.blockNumber) : null;
  const buyers = new Set(bought.map((l) => argsOf<{ buyer: Address }>(l).buyer.toLowerCase())).size;
  return { fire, start: Number(d.start), closedAt, packs: Number(d.sold) + Number(d.creditPacks), buyers }; // bought + free (as DropClosed counts them)
}

const casts = new Map<number, Promise<string[]>>();
/** A Series' characters, in recipe order (RecipeDealer), cached. */
export function seriesCharacters(fire: number): Promise<string[]> {
  let p = casts.get(fire);
  if (!p) {
    p = (async () => {
      const f = BigInt(fire), n = Number(await read<bigint>("RecipeDealer", dealerAbi, "characterCount", [f]));
      if (!n) return [];
      const [names] = await read<readonly [readonly string[], readonly string[]]>("RecipeDealer", dealerAbi, "charactersOf", [f, 0n, BigInt(n)]);
      return [...names];
    })().catch((e) => { casts.delete(fire); throw e; });
    casts.set(fire, p);
  }
  return p;
}
