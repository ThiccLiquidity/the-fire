/** What a recipe makes, as the owner sees it: each type's expected cards per pack and share of cards, the expected
 *  cards per type and look, how rare each exact card is, and the chance a pack holds at least one of a type.
 *
 *  Dealing (recipe.ts): every pack has the same slots, and each card rolls its type from its slot's odds, then holo,
 *  then character. A type's expected cards per pack = the sum over the slots of count x the slot's odds for it; its
 *  share of cards = that over cards per pack. So everything here is exact odds; card counts for a Series are
 *  expectations (the real counts vary around them, and nothing caps them). The one exception: a one-per-character type
 *  (the Standard's Full Art) has exactly one per character in a Series (when packs >= characters), each in place of a
 *  pack's first card, so the first card's types expect that many fewer.
 *
 *  Rarity is the site's one scale (web/art/factory/forge/core.js trueOdds, info.js lookP / TIERS): the chance of one
 *  exact card (character + type + holo look) per card dealt, read as "1 in N". Tiers: Rare from 1 in 100, Epic from
 *  1 in 400, Legendary from 1 in 1,000. */

import {
  cardsPerPack, characterOdds, firstCardSlot, holoLooksFor, holoOdds, onePerCharacterCount, onePerIndex, onePerPackChance, perPackCounts,
  slotOdds, typeOdds, type Recipe, type SeriesSize,
} from './recipe'
import type { HoloType } from './rules'

export type Tier = 'legendary' | 'epic' | 'rare'
/** info.js TIERS: "1 in N" at or above these is that tier. */
export const TIERS: [Tier, number][] = [['legendary', 1000], ['epic', 400], ['rare', 100]]
export const TIER_LABEL: Record<Tier, string> = { legendary: 'Legendary', epic: 'Epic', rare: 'Rare' }

export const tierOf = (n: number): Tier | null => TIERS.find(([, at]) => n >= at)?.[0] ?? null

/** info.js oneIn: "1 in N" rounded (to 10 from 100 up). p is the chance (0 to 1). */
export function oneIn(p: number): string {
  if (!(p > 0)) return '-'
  const n = 1 / p
  return (n >= 100 ? Math.round(n / 10) * 10 : Math.round(n)).toLocaleString('en-US')
}

/** A chance (0 to 1) as a percentage the owner reads: up to 2 decimals ("3.99%", "50%"); under 0.01%, two significant
 *  digits ("0.0042%"). */
export function percentText(p: number): string {
  if (!(p > 0)) return '0%'
  const v = p * 100
  if (v >= 100) return '100%'
  if (v < 0.01) return `${+v.toPrecision(2)}%`
  const r = +v.toFixed(2)
  return `${r >= 100 ? 99.99 : r}%`
}

/** "about 1 in N" for the studio: N to one decimal under 10 (68% = 1 in 1.5, 30% = 1 in 3.3), else as oneIn. */
export function aboutOneIn(p: number, unit = 'cards'): string {
  if (!(p > 0)) return 'never'
  if (p >= 1) return unit ? `every ${unit.replace(/s$/, '')}` : 'every one'
  const n = 1 / p
  // under 100% but "1 in 1" once rounded (above about 95.2%): say so in words, never "about 1 in 1"
  if (+n.toFixed(1) <= 1) return unit ? `almost every ${unit.replace(/s$/, '')}` : 'almost every one'
  return `about 1 in ${n < 10 ? +n.toFixed(1) : oneIn(p)}${unit ? ` ${unit}` : ''}`
}

/** Odds the way the studio shows them everywhere: "3.99% · about 1 in 25 cards". `unit` '' leaves the noun off. */
export function oddsText(p: number, unit = 'cards'): string {
  if (!(p > 0)) return '0%'
  if (p >= 1) return unit ? `100% · every ${unit.replace(/s$/, '')}` : '100%'
  return `${percentText(p)} · ${aboutOneIn(p, unit)}`
}

/** The holo look odds a type's cards get (RecipeDealer.holoOdds). */
export function lookOdds(r: Recipe, i: number): Record<HoloType, number> {
  const o = holoOdds(r.types[i])
  return { none: o[0], frame: o[1], picture: o[2], full: o[3] }
}

/** The chance of one exact card per card dealt (a card picked at random from the Series): the type's share of cards x
 *  holo odds x that character's odds (the one-per-character type: every character alike, 1 / characters). */
export function cardChance(r: Recipe, typeIndex: number, look: HoloType, characterP: number, size?: SeriesSize): number {
  const cp = typeIndex === onePerIndex(r) && size && size.chars > 0 ? 1 / size.chars : characterP
  return (typeOdds(r, size)[typeIndex] ?? 0) * lookOdds(r, typeIndex)[look] * cp
}

/** "1 per character · exactly 20 in the Series" (or, with fewer packs than characters, "1 per character · only 12 of
 *  20 can come out (12 packs, one each at most)"). */
export function onePerCharacterText(size: SeriesSize): string {
  const C = Math.max(0, Math.floor(size.chars) || 0)
  const n = onePerCharacterCount(size)
  const f = (x: number) => x.toLocaleString('en-US')
  if (C === 0) return '1 per character'
  if (n < C) return `1 per character · only ${f(n)} of ${f(C)} can come out (${f(n)} pack${n === 1 ? '' : 's'}, one each at most)`
  return `1 per character · exactly ${f(n)} in the Series`
}

/** "Full Art · 1 per character · exactly 20 in the Series". Null when the recipe has no one-per-character type. */
export function onePerCharacterLine(r: Recipe, size: SeriesSize): string | null {
  const i = onePerIndex(r)
  return i < 0 ? null : `${r.types[i].name || `Type ${i + 1}`} · ${onePerCharacterText(size)}`
}

/** The Series tab's warning when there are fewer packs than characters (not every one-per-character card can come
 *  out). Null when nothing to warn about. */
export function onePerCharacterWarning(r: Recipe, size: SeriesSize): string | null {
  const i = onePerIndex(r)
  if (i < 0 || !(size.chars > 0) || size.packs >= size.chars) return null
  const name = r.types[i].name || `Type ${i + 1}`
  return `${size.packs.toLocaleString('en-US')} packs for ${size.chars.toLocaleString('en-US')} characters: ${name} is one per character, at most one a pack, so only ${onePerCharacterCount(size).toLocaleString('en-US')} can come out. Add packs (at least ${size.chars.toLocaleString('en-US')}) or take characters out.`
}

export interface LookResult {
  look: HoloType
  /** Expected cards of this look in the Series, and per character (an average character). */
  total: number
  perCharacter: number
  /** Chance of this exact card (one average character, this type, this look) per card dealt. */
  p: number
  /** The same for the rarest character, when characters have their own odds (else equal to p). */
  pRarest: number
  tier: Tier | null
}

export interface TypeResult {
  /** The type's share of all cards (its expected cards per pack over cards per pack). */
  share: number
  /** Expected cards of the type in one pack (the sum over the slots of count x the slot's odds). */
  perPack: number
  /** Expected cards of the type in the Series (share x cards). */
  expected: number
  /** Expected cards per (average) character. */
  perCharacter: number
  looks: LookResult[]
  /** One per character (in no slot): exactly `expected` cards in the Series, one per character. */
  onePerCharacter?: boolean
}

export interface SeriesResult {
  packs: bigint
  chars: number
  cardsPerPack: number
  total: bigint
  types: TypeResult[]
  /** Whether characters have their own odds (not all equal). */
  weighted: boolean
  /** Every exact card the Series can make, in all (characters x looks). */
  distinct: number
}

/** The whole picture for `packs` packs and `chars` characters (at least 1), with the characters' weights (series.ts
 *  characterWeightsOf, from their percentages) if they have their own odds. */
export function seriesResult(r: Recipe, packs: bigint, chars: number, characterWeights?: readonly number[]): SeriesResult {
  const ch = Math.max(1, Math.floor(chars))
  const cOdds = characterOdds(characterWeights, ch)
  const weighted = cOdds.some((p) => Math.abs(p - cOdds[0]) > 1e-15)
  const rarest = Math.min(...cOdds)
  const total = packs * BigInt(Math.max(0, cardsPerPack(r)))
  const N = Number(total)
  const size = { packs: Number(packs), chars: ch }
  const tOdds = typeOdds(r, size)
  const one = onePerIndex(r)
  let distinct = 0
  const types = r.types.map((_, i): TypeResult => {
    const share = tOdds[i] ?? 0
    // the one-per-character type: exactly its count (no rounding drift)
    const expected = i === one ? onePerCharacterCount(size) : share * N
    const odds = lookOdds(r, i)
    // the one-per-character type goes to every character alike, whatever their odds
    const low = i === one ? 1 / ch : rarest
    const looks = holoLooksFor(r, i).map((look): LookResult => {
      const p = share * odds[look] / ch
      const pRarest = share * odds[look] * low
      return { look, total: expected * odds[look], perCharacter: (expected * odds[look]) / ch, p, pRarest, tier: p > 0 ? tierOf(1 / p) : null }
    })
    distinct += looks.filter((l) => l.p > 0).length * ch
    return { share, perPack: share * cardsPerPack(r), expected, perCharacter: expected / ch, looks, ...(i === one ? { onePerCharacter: true } : {}) }
  })
  return { packs, chars: ch, cardsPerPack: cardsPerPack(r), total, types, weighted, distinct }
}

// ---------------------------------------------------------------- per pack

export interface PackChances {
  /** Per type: chance a pack holds at least one. */
  atLeastOne: number[]
  /** Per type: chance a pack holds two or more. */
  twoOrMore: number[]
}

/** The chance a pack holds at least one (and two or more) of each type. Exact: every card is rolled on its own from
 *  its slot's odds q_s, so none = the product over the slots of (1 - q_s)^count, and exactly one = none x the sum of
 *  count x q_s / (1 - q_s) (a slot that always deals the type: handled on its own). The same for every pack, except
 *  with a one-per-character type and the Series' size: a pack's first card is that type with chance (its count /
 *  packs, a pack picked at random) and otherwise its slot's roll. */
export function packChances(r: Recipe, size?: SeriesSize): PackChances {
  const odds = slotOdds(r)
  const f = onePerPackChance(r, size)
  const one = onePerIndex(r)
  const s0 = firstCardSlot(r)
  const atLeastOne: number[] = []
  const twoOrMore: number[] = []
  r.types.forEach((_, t) => {
    // the count of this type in a pack, as a distribution over 0, 1 and "2 or more"
    let p0 = 1
    let p1 = 0
    r.slots.forEach((sl, s) => {
      for (let k = 0; k < Math.max(0, sl.count); k++) {
        let q = odds[s]?.[t] ?? 0
        if (s === s0 && k === 0 && f > 0) q = (1 - f) * q + (t === one ? f : 0)
        p1 = p1 * (1 - q) + p0 * q
        p0 *= 1 - q
      }
    })
    atLeastOne.push(1 - p0)
    twoOrMore.push(Math.max(0, 1 - p0 - p1))
  })
  return { atLeastOne, twoOrMore }
}

export interface SlotSummary {
  count: number
  /** Per type (recipe order): its chance for one card of this slot. */
  odds: number[]
}

/** Each slot's cards and odds (recipe.ts slotOdds), for the per-slot lines. */
export function slotSummaries(r: Recipe): SlotSummary[] {
  const odds = slotOdds(r)
  return r.slots.map((sl, s) => ({ count: Math.max(0, sl.count), odds: odds[s] }))
}

// ---------------------------------------------------------------- expected print counts

export interface ExpectedCounts {
  packs: number
  cardsPerPack: number
  /** packs x cards per pack. */
  totalCards: number
  /** Per type: its share of cards, its expected cards per pack, its expected cards, and those split by holo look
   *  (summing to `count`). */
  types: { share: number; perPack: number; count: number; looks: Record<HoloType, number> }[]
  /** Per character (image order): its chance per card and its expected cards over every type. */
  characters: { share: number; count: number }[]
  /** grid[type][character]: expected cards of that type and character. */
  grid: number[][]
}

/** How many of each card the Series prints if the odds land exactly: packs x (the sum over the slots of count x
 *  P_slot(type)) [x P(character)] [x P(holo look)]; the one-per-character type exactly one per character (packs
 *  allowing), in place of first cards. `characters` is the character count (every character equally
 *  likely) or their weights (from their percentages: series.ts characterWeightsOf). Real pulls vary around these. */
export function expectedCounts(r: Recipe, characters: number | readonly number[], packs: bigint | number): ExpectedCounts {
  const P = Math.max(0, Number(packs) || 0)
  const S = Math.max(0, cardsPerPack(r))
  const N = P * S
  const cOdds = typeof characters === 'number' ? characterOdds(undefined, characters) : characterOdds(characters, characters.length)
  const C = cOdds.length
  const size = { packs: P, chars: C }
  const one = onePerIndex(r)
  const per = perPackCounts(r, size)
  const types = typeOdds(r, size).map((share, i) => {
    const count = i === one ? onePerCharacterCount(size) : per[i] * P
    const o = lookOdds(r, i)
    return { share, perPack: per[i], count, looks: { none: count * o.none, frame: count * o.frame, picture: count * o.picture, full: count * o.full } }
  })
  // the one-per-character type: every character alike (one each), whatever their odds
  const grid = types.map((t, i) => cOdds.map((c) => (i === one ? (C > 0 ? t.count / C : 0) : t.count * c)))
  const charCounts = cOdds.map((_, c) => grid.reduce((a, row) => a + row[c], 0))
  return {
    packs: P,
    cardsPerPack: S,
    totalCards: N,
    types,
    characters: charCounts.map((count) => ({ share: N > 0 ? count / N : 0, count })),
    grid,
  }
}

/** An expected count as the owner reads it: "0", "< 1" (may not print), one decimal under 10, whole numbers above. */
export function printCount(x: number): string {
  if (!(x > 0)) return '0'
  if (x < 1) return '< 1'
  if (x < 10) return (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '')
  return Math.round(x).toLocaleString('en-US')
}

/** Expected below one card (but possible): it may not print at all. */
export const mayNotPrint = (x: number) => x > 0 && x < 1
