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
  /** The type's chance per card (its weight over the total). */
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
  /** Whether characters have their own odds (some weights differ). */
  weighted: boolean
  /** Every exact card the Series can make, in all (characters x looks). */
  distinct: number
}

/** The whole picture for `packs` packs and `chars` characters (at least 1), with the characters' weights if they
 *  have their own odds. */
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
