/** What a recipe makes, as the owner sees it: each type's odds per card, the expected cards per type and look, how rare
 *  each exact card is, and the chance a pack holds at least one of a type.
 *
 *  Dealing is straight odds (recipe.ts): a card's chance = type odds x holo odds x character odds, the same for every
 *  card of every pack. So everything here is exact odds; card counts for a Series are expectations (the real counts
 *  vary around them, and nothing caps them).
 *
 *  Rarity is the site's one scale (web/art/factory/forge/core.js trueOdds, info.js lookP / TIERS): the chance of one
 *  exact card (character + type + holo look) per card dealt, read as "1 in N". Tiers: Rare from 1 in 100, Epic from
 *  1 in 400, Legendary from 1 in 1,000. */

import { characterOdds, holoLooksFor, holoOdds, typeOdds, type Recipe } from './recipe'
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

/** The chance of one exact card per card dealt: type odds x holo odds x that character's odds. */
export function cardChance(r: Recipe, typeIndex: number, look: HoloType, characterP: number): number {
  return (typeOdds(r)[typeIndex] ?? 0) * lookOdds(r, typeIndex)[look] * characterP
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
  /** The type's chance per card (its % of cards). */
  share: number
  /** Expected cards of the type in the Series (share x cards). */
  expected: number
  /** Expected cards per (average) character. */
  perCharacter: number
  looks: LookResult[]
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
  const total = packs * BigInt(Math.max(0, r.cardsPerPack))
  const N = Number(total)
  const tOdds = typeOdds(r)
  let distinct = 0
  const types = r.types.map((_, i): TypeResult => {
    const share = tOdds[i] ?? 0
    const expected = share * N
    const odds = lookOdds(r, i)
    const looks = holoLooksFor(r, i).map((look): LookResult => {
      const p = share * odds[look] / ch
      const pRarest = share * odds[look] * rarest
      return { look, total: expected * odds[look], perCharacter: (expected * odds[look]) / ch, p, pRarest, tier: p > 0 ? tierOf(1 / p) : null }
    })
    distinct += looks.filter((l) => l.p > 0).length * ch
    return { share, expected, perCharacter: expected / ch, looks }
  })
  return { packs, chars: ch, cardsPerPack: r.cardsPerPack, total, types, weighted, distinct }
}

// ---------------------------------------------------------------- per pack

export interface PackChances {
  /** Per type: chance a pack holds at least one. */
  atLeastOne: number[]
  /** Per type: chance a pack holds two or more. */
  twoOrMore: number[]
}

/** The chance a pack holds at least one (and two or more) of each type. Exact: every card is rolled on its own, so
 *  with q the type's odds and S cards a pack, at least one = 1 - (1 - q)^S. The same for every pack of the Series. */
export function packChances(r: Recipe): PackChances {
  const S = Math.max(0, r.cardsPerPack)
  const q = typeOdds(r)
  return {
    atLeastOne: q.map((x) => 1 - (1 - x) ** S),
    twoOrMore: q.map((x) => (S < 2 ? 0 : 1 - (1 - x) ** S - S * x * (1 - x) ** (S - 1))),
  }
}

// ---------------------------------------------------------------- expected print counts

export interface ExpectedCounts {
  packs: number
  cardsPerPack: number
  /** packs x cards per pack. */
  totalCards: number
  /** Per type: its chance per card, its expected cards, and those split by holo look (summing to `count`). */
  types: { share: number; count: number; looks: Record<HoloType, number> }[]
  /** Per character (image order): its chance per card and its expected cards over every type. */
  characters: { share: number; count: number }[]
  /** grid[type][character]: expected cards of that type and character. */
  grid: number[][]
}

/** How many of each card the Series prints if the odds land exactly: total cards x P(type) [x P(character)]
 *  [x P(holo look)]. `characters` is the character count (every character equally likely) or their weights (from
 *  their percentages: series.ts characterWeightsOf). Real pulls vary around these. */
export function expectedCounts(r: Recipe, characters: number | readonly number[], packs: bigint | number): ExpectedCounts {
  const P = Math.max(0, Number(packs) || 0)
  const S = Math.max(0, r.cardsPerPack || 0)
  const N = P * S
  const cOdds = typeof characters === 'number' ? characterOdds(undefined, characters) : characterOdds(characters, characters.length)
  const types = typeOdds(r).map((share, i) => {
    const count = share * N
    const o = lookOdds(r, i)
    return { share, count, looks: { none: count * o.none, frame: count * o.frame, picture: count * o.picture, full: count * o.full } }
  })
  return {
    packs: P,
    cardsPerPack: S,
    totalCards: N,
    types,
    characters: cOdds.map((share) => ({ share, count: share * N })),
    grid: types.map((t) => cOdds.map((c) => t.count * c)),
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
