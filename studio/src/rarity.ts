/** What a recipe makes, as the owner sees it: card counts per type and look, how rare each exact card is, and the
 *  chance a pack holds at least one of a type.
 *
 *  Rarity is the site's one scale (web/art/factory/forge/core.js trueOdds, info.js lookP / TIERS): the copies of one
 *  exact card (character + type + holo look) over the Series' cards, read as "1 in N". A type dealt to random
 *  characters splits its count evenly over the cast; holo looks are each type's odds. Tiers: Rare from 1 in 100,
 *  Epic from 1 in 400, Legendary from 1 in 1,000.
 *
 *  Card counts are exact (the contract's pool, recipe.ts). Holo counts and copies per character are averages: holo
 *  and character are random per card. The per-pack chances come from dealing the Series many times with the
 *  contract's dealing rules (deal.ts), so they are close estimates. */

import {
  SHARE_SCALE, compileRecipe, holoLooksFor, holoOdds, holoOddsGivenHolo, poolOf, rulePool, slotTypeIndexes, type Plan, type Recipe,
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

/** The holo look odds the cards of a type get in this recipe: the plain-slot odds, or given-holo when every slot that
 *  deals it is must-holo. (A type in both kinds of slot: the plain odds, a little under its real holo share.) */
export function lookOdds(r: Recipe, i: number): Record<HoloType, number> {
  const t = r.types[i]
  const inPlain = r.slots.some((s) => !s.mustHolo && slotTypeIndexes(r, s).includes(i))
  const o = inPlain ? holoOdds(t) : holoOddsGivenHolo(t)
  return { none: o[0], frame: o[1], picture: o[2], full: o[3] }
}

export interface LookResult {
  look: HoloType
  /** Average cards of this look in the Series, and per character. */
  total: number
  perCharacter: number
  /** Chance of this exact card (one character, this type, this look) per Series card. */
  p: number
  tier: Tier | null
}

export interface TypeResult {
  /** Exact cards of the type in the Series (the contract's pool). */
  count: bigint
  /** What the type's own rule gave before the floor moved cards (count - rule = the floor's change). */
  rule: bigint
  share: number
  /** Cards per character: exact for a per-character type, an average otherwise. */
  perCharacter: number
  looks: LookResult[]
}

export interface SeriesResult {
  packs: bigint
  chars: number
  cardsPerPack: number
  total: bigint
  types: TypeResult[]
  /** Every exact card the Series can make, in all (characters x looks). */
  distinct: number
}

/** The whole picture for `packs` packs and `chars` characters (at least 1). Throws on an invalid recipe or an
 *  impossible pool (run checkRecipe first). */
export function seriesResult(r: Recipe, packs: bigint, chars: number): SeriesResult {
  const ch = Math.max(1, Math.floor(chars))
  const plan = compileRecipe(r)
  const { counts } = poolOf(plan, packs, BigInt(ch))
  const rules = rulePool(r, packs, BigInt(ch))
  const total = packs * BigInt(plan.S)
  const N = Number(total)
  let distinct = 0
  const types = r.types.map((_, i): TypeResult => {
    const count = counts[i]
    const perCharacter = Number(count) / ch
    const odds = lookOdds(r, i)
    const looks = holoLooksFor(r, i).map((look): LookResult => {
      const per = perCharacter * odds[look]
      const p = N > 0 ? per / N : 0
      return { look, total: Number(count) * odds[look], perCharacter: per, p, tier: p > 0 ? tierOf(1 / p) : null }
    })
    distinct += looks.filter((l) => l.p > 0).length * ch
    return { count, rule: rules[i], share: N > 0 ? Number(count) / N : 0, perCharacter, looks }
  })
  return { packs, chars: ch, cardsPerPack: plan.S, total, types, distinct }
}

/** The share (parts per billion) that gives exactly `cards` cards out of `n` (round half up, like the contract), with
 *  the fewest decimals. Above a billion cards a share can't hit every count: then the nearest share (exact: false). */
export function shareForCount(cards: bigint, n: bigint): { share: bigint; exact: boolean } | null {
  if (cards < 0n || n <= 0n || cards > n) return null
  const half = SHARE_SCALE / 2n
  // (a * n + half) / SCALE == cards  <=>  cards * SCALE - half <= a * n < cards * SCALE + SCALE - half
  const loNum = cards * SHARE_SCALE - half
  const lo = loNum <= 0n ? 0n : (loNum + n - 1n) / n
  let hi = (cards * SHARE_SCALE + SHARE_SCALE - half - 1n) / n
  if (hi > SHARE_SCALE) hi = SHARE_SCALE
  if (lo > hi) {
    const near = (cards * SHARE_SCALE + n / 2n) / n
    return { share: near > SHARE_SCALE ? SHARE_SCALE : near, exact: false }
  }
  for (let step = SHARE_SCALE; step >= 1n; step /= 10n) {
    const a = ((lo + step - 1n) / step) * step
    if (a <= hi) return { share: a, exact: true }
  }
  return { share: lo, exact: true }
}

/** Cards a percent (as parts per billion) of `n` gives, rounded half up (the contract's share rounding). */
export const countForShare = (share: bigint, n: bigint): bigint => (share * n + SHARE_SCALE / 2n) / SHARE_SCALE

// ---------------------------------------------------------------- per pack

/** Most cards dealt in all for one estimate (several deals of a small Series, one of a big one). */
const SIM_CARDS = 240_000
/** Biggest Series the estimate deals (deal.ts MAX_DEAL_CARDS). */
const SIM_MAX = 600_000

/** A small fast generator (mulberry32): the estimate needs speed, not the sample deal's SHA-256 streams. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface PackChances {
  /** Per type: share of packs holding at least one. */
  atLeastOne: number[]
  /** Per type: share of packs holding two or more. */
  twoOrMore: number[]
  deals: number
}

/** The chance a pack holds at least one (and two or more) of each type: the Series dealt `deals` times with
 *  RecipeDealer's walk down the nested sets (as deal.ts). null when the Series is too big to deal here. */
export function packChances(r: Recipe, packs: number, chars: number, seed = 1): PackChances | null {
  const plan: Plan = compileRecipe(r)
  const cards = packs * plan.S
  if (packs < 1 || cards > SIM_MAX) return null
  const { counts, sums } = poolOf(plan, BigInt(packs), BigInt(Math.max(1, chars)))
  const deals = Math.max(1, Math.min(40, Math.floor(SIM_CARDS / cards)))
  const one = new Array<number>(plan.T).fill(0)
  const two = new Array<number>(plan.T).fill(0)
  const u = rng(seed)
  const inPack = new Array<number>(plan.T).fill(0)
  for (let d = 0; d < deals; d++) {
    const typeLeft = counts.map(Number)
    const nodeLeft = sums.map(Number)
    for (let p = 0; p < packs; p++) {
      const later = packs - p - 1
      inPack.fill(0)
      for (const step of plan.steps) {
        for (let c = 0; c < step.count; c++) {
          let x = step.node
          let t: number
          for (;;) {
            const n = plan.nodes[x]
            if (n.single >= 0) { t = n.single; break }
            let total = 0
            for (const y of n.children) total += nodeLeft[y] - later * plan.nodes[y].k
            for (const b of n.bare) total += typeLeft[b]
            let v = Math.floor(u() * total)
            let picked = -1
            for (const y of n.children) { const w = nodeLeft[y] - later * plan.nodes[y].k; if (v < w) { picked = y; break } v -= w }
            if (picked >= 0) { x = picked; continue }
            t = n.bare[n.bare.length - 1]
            for (const b of n.bare) { if (v < typeLeft[b]) { t = b; break } v -= typeLeft[b] }
            break
          }
          typeLeft[t]--
          for (let y = plan.inner[t]; ; y = plan.nodes[y].parent) { nodeLeft[y]--; if (y === 0) break }
          inPack[t]++
        }
      }
      for (let t = 0; t < plan.T; t++) { if (inPack[t] >= 1) one[t]++; if (inPack[t] >= 2) two[t]++ }
    }
  }
  const all = deals * packs
  return { atLeastOne: one.map((x) => x / all), twoOrMore: two.map((x) => x / all), deals }
}
