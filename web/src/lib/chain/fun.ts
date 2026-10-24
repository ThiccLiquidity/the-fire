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

// ---------------------------------------------------------------- the practice pack (forge/practice.js)

/** What a practice pack of a Series is made from: its image folder, its card types (each with its fixed odds per card
 *  and its holo odds), its cards per pack and its characters (with their odds). Read-only; nothing is ever dealt or
 *  saved. */
export type PracticeSet = {
  fire: number; imagesBase: string; characters: string[]; cardsPerPack: number;
  /** Each character's chance per card (equal unless the Series gives them their own odds). */
  characterOdds: number[];
  types: { name: string; slug: string; rank: number; share: number; holo: [number, number, number, number] }[];
};
type RecipeRaw = {
  types: readonly { name: string; slug: string; rank: number; weight: bigint; holoMode: number; holo: readonly bigint[] }[];
  cardsPerPack: number;
};
const practiceSets = new Map<number, Promise<PracticeSet | null>>();
/** A Series' practice set (cached), or null when it has no recipe, characters or image folder yet. */
export function practiceSet(fire: number): Promise<PracticeSet | null> {
  let p = practiceSets.get(fire);
  if (!p) {
    p = (async () => {
      const f = BigInt(fire);
      const [base, r, chars, codds] = await Promise.all([
        read<string>("FireCards", cardsAbi, "imagesBase", [f]),
        read<RecipeRaw>("RecipeDealer", dealerAbi, "recipeOf", [f]),
        seriesCharacters(fire),
        read<readonly [readonly bigint[], bigint]>("RecipeDealer", dealerAbi, "characterOddsOf", [f]).catch(() => null),
      ]);
      if (!base || !r.types.length || !Number(r.cardsPerPack) || !chars.length) return null;
      // each type's chance per card: its weight over the total (RecipeDealer.oddsOf), the same for every card
      const total = r.types.reduce((a, t) => a + BigInt(t.weight), 0n);
      const ONE = 1e18;
      const types = r.types.map((t) => {
        const h = t.holo.map(Number);
        const holo: [number, number, number, number] = t.holoMode === 0 // Independent: frame and picture rolls; else weights of none/frame/picture/full
          ? [(1 - h[0] / ONE) * (1 - h[1] / ONE), (h[0] / ONE) * (1 - h[1] / ONE), (1 - h[0] / ONE) * (h[1] / ONE), (h[0] / ONE) * (h[1] / ONE)]
          : ((s) => [h[0] / s, h[1] / s, h[2] / s, h[3] / s] as [number, number, number, number])(h[0] + h[1] + h[2] + h[3] || 1);
        return { name: t.name, slug: t.slug, rank: Number(t.rank), share: total > 0n ? Number((BigInt(t.weight) * 10n ** 12n) / total) / 1e12 : 0, holo };
      });
      const cw = codds && codds[0].length === chars.length && codds[1] > 0n ? codds[0].map((w) => Number(w) / Number(codds[1])) : chars.map(() => 1 / chars.length);
      return { fire, imagesBase: base, characters: chars, cardsPerPack: Number(r.cardsPerPack), characterOdds: cw, types } as PracticeSet;
    })().catch((e) => { practiceSets.delete(fire); throw e; });
    practiceSets.set(fire, p);
  }
  return p;
}

/** One practice card: its type, holo, character and the Series' own image for it (ungraded, uncased: the same file
 *  name CardsRenderer gives a real card). */
export type PracticeCard = { typeIndex: number; typeName: string; slug: string; rank: number; holo: "none" | "frame" | "picture" | "full"; character: string; characterIndex: number; image: string };
const HOLOS = ["none", "frame", "picture", "full"] as const;
/** One practice pack from a set, at the real recipe's odds, exactly as the dealer deals: every card on its own, its
 *  type by the type odds, then its holo by that type's holo odds, then its character by the character odds. */
export function practiceDeal(set: PracticeSet, rand: () => number = Math.random): PracticeCard[] {
  const pick = <T>(xs: readonly T[], w: (x: T, i: number) => number): number => {
    const total = xs.reduce((a, x, i) => a + Math.max(0, w(x, i)), 0);
    if (!(total > 0)) return Math.floor(rand() * xs.length);
    let u = rand() * total;
    for (let i = 0; i < xs.length; i++) { u -= Math.max(0, w(xs[i], i)); if (u < 0) return i; }
    return xs.length - 1;
  };
  const out: PracticeCard[] = [];
  for (let k = 0; k < set.cardsPerPack; k++) {
    const ti = pick(set.types, (t) => t.share);
    const t = set.types[ti];
    const holo = pick(HOLOS, (_, j) => t.holo[j]);
    const ci = pick(set.characters, (_, i) => set.characterOdds[i] ?? 0);
    out.push({ typeIndex: ti, typeName: t.name, slug: t.slug, rank: t.rank, holo: HOLOS[holo], character: set.characters[ci], characterIndex: ci,
      image: `${set.imagesBase}c${ci}-${t.slug}-${HOLOS[holo]}-u.webp` });
  }
  return out;
}
