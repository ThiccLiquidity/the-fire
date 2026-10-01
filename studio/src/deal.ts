/** The SAMPLE deal, on the real rules. Pure functions only: no I/O, no Date, no Math.random.
 *
 *  Interface: dealFire(DealInput) -> DealResult. When the pack contract exists, its on-chain result (pool sizes,
 *  per-pack contents, serials, characters, holo rolls) is mapped into the same DealResult shape and everything
 *  downstream (build, review, export, upload) keeps working unchanged.
 *
 *  Steps
 *  1. Pool sizes from the fractional accumulators (computePool).
 *  2. Seeded deal into packs respecting the floor: slots 1-3 Paper, 4 Wood, 5 Wood-or-better, 6 Burning-or-better.
 *  3. Global serials: a seeded permutation of this Fire's cards onto the next block of serials, so a serial says
 *     nothing about a card's pack slot or material.
 *  4. Character: uniform among the Fire's characters, per card (seeded).
 *  5. Holo: two independent rolls per card (frame, picture), each p = 1 - sqrt(1 - rate); both = full holo.
 *  6. Edition: within this Fire, per character + material, cards are numbered 1..N in serial order.
 *  PSA grades are NOT rolled here (they come from drand, committed on-chain, hidden until the paid reveal). */

import { Stream } from './prng'
import {
  CARDS_PER_PACK, HOLO_TYPES, MATERIALS, RARITY_UNITS, RATE_SCALE, holoRollChance, holoTypeOf, type HoloType, type Material,
} from './rules'

export const DEAL_METHOD = 'sample-sha256ctr-v1'

/** Carried accumulator state in integer units of 1/RATE_SCALE of a card. A value of 82_000 for diamond means
 *  "82% of the way to the next Diamond". It can be slightly negative after a tier was handed a rounding residual
 *  ("borrowed" a card); it then pays that back from the next Fire's accrual. */
export type Accumulators = Record<Material, number>

export function zeroAccumulators(): Accumulators {
  return { paper: 0, wood: 0, burning: 0, charcoal: 0, diamond: 0 }
}

export interface DealInput {
  /** Fire number (printed as "Fire #F"). */
  fire: number
  /** Packs sold in this Fire. Pool size is exactly packs * 6. */
  packs: number
  /** The Fire's characters (any number >= 1). Order matters for determinism. */
  characterIds: string[]
  /** Stand-in for the drand round's randomness. */
  seed: string
  /** Accumulator state carried from the previous Fire. */
  accumulators: Accumulators
  /** First global serial for this Fire (last Fire's nextSerial; 1 for the very first Fire). */
  firstSerial: number
}

export interface DealtCard {
  serial: number
  fire: number
  /** 1-based pack number within this Fire. */
  pack: number
  /** 1..6, the pack slot (1-3 Paper, 4 Wood, 5 Wood+, 6 Burning+). */
  slot: number
  material: Material
  characterId: string
  holoFrame: boolean
  holoPicture: boolean
  holo: HoloType
  /** k in "k of N · Fire #F". */
  edition: number
  /** N in "k of N · Fire #F". */
  editionOf: number
}

export interface PoolResult {
  counts: Record<Material, number>
  before: Accumulators
  after: Accumulators
}

export interface DealResult {
  method: string
  fire: number
  packs: number
  seed: string
  characterIds: string[]
  pool: Record<Material, number>
  accumulatorsBefore: Accumulators
  accumulatorsAfter: Accumulators
  firstSerial: number
  /** First serial for the next Fire. */
  nextSerial: number
  /** All cards, sorted by serial. */
  cards: DealtCard[]
  /** Serials in each pack, in slot order (packContents[p][s] = serial of pack p+1, slot s+1). */
  packContents: number[][]
}

const UPGRADE: Material[] = ['wood', 'burning', 'charcoal', 'diamond'] // the half of the pool that isn't Paper
const BURNING_PLUS: Material[] = ['burning', 'charcoal', 'diamond']

/** Pool sizes for a Fire of `packs` packs, from the carried accumulators.
 *
 *  Method (integer arithmetic throughout, units of 1/RATE_SCALE card):
 *  a. Every tier accrues rate * (packs * 6): acc[t] = before[t] + RARITY_UNITS[t] * cards.
 *  b. Paper is exactly 3 * packs: the floor demands it, and Paper's 50% rate accrues exactly that, so its carry never
 *     moves.
 *  c. The other four tiers take the integer part of their accumulator: floor(acc / SCALE).
 *  d. Those floors can sum to a little less (or, from an imported/odd state, more) than the 3 * packs non-Paper
 *     cards the pool needs. Residual cards go one at a time to the tier whose remaining fraction
 *     (acc - count * SCALE) is the LARGEST (ties: the more common tier); a surplus is taken one at a time from the
 *     tier whose remaining fraction is the SMALLEST among tiers that have a card.
 *  e. The pack floor needs Wood >= packs and packs <= Burning-or-better <= 2 * packs. If Burning-or-better is short,
 *     cards move from Wood to the Burning-or-better tier with the largest fraction; if it is over, cards move from the
 *     Burning-or-better tier with the smallest fraction back to Wood. (Only matters for very small Fires.)
 *  f. Carry = acc - count * SCALE. A tier that received a residual carries a negative fraction (it borrowed a card) and
 *     repays it from the next Fire's accrual; a tier that lost one carries > 1 card and gets it next time. Because
 *     the rates sum to exactly 100% and every Fire takes exactly packs * 6 cards, the carries always sum to the same
 *     total (0 from a fresh start), so nothing is ever created or lost across Fires. */
export function computePool(before: Accumulators, packs: number): PoolResult {
  if (!Number.isInteger(packs) || packs < 0) throw new Error(`packs must be a whole number >= 0 (got ${packs})`)
  for (const m of MATERIALS) {
    if (!Number.isInteger(before[m])) throw new Error(`accumulator ${m} must be an integer number of units`)
  }
  const cards = packs * CARDS_PER_PACK
  const acc = {} as Accumulators
  for (const m of MATERIALS) acc[m] = before[m] + RARITY_UNITS[m] * cards
  const counts: Record<Material, number> = { paper: 3 * packs, wood: 0, burning: 0, charcoal: 0, diamond: 0 }
  for (const m of UPGRADE) counts[m] = Math.max(0, Math.floor(acc[m] / RATE_SCALE))
  const frac = (m: Material) => acc[m] - counts[m] * RATE_SCALE

  const giveOne = (tiers: Material[]): Material => {
    let best = tiers[0]
    for (const t of tiers) if (frac(t) > frac(best)) best = t
    counts[best]++
    return best
  }
  const takeOne = (tiers: Material[]): Material => {
    let worst: Material | null = null
    for (const t of tiers) if (counts[t] > 0 && (worst === null || frac(t) < frac(worst))) worst = t
    if (worst === null) throw new Error('computePool: nothing to take')
    counts[worst]--
    return worst
  }

  const need = 3 * packs
  let have = UPGRADE.reduce((s, m) => s + counts[m], 0)
  while (have < need) { giveOne(UPGRADE); have++ }
  while (have > need) { takeOne(UPGRADE); have-- }

  let bp = BURNING_PLUS.reduce((s, m) => s + counts[m], 0)
  while (bp < packs) { counts.wood--; giveOne(BURNING_PLUS); bp++ }
  while (bp > 2 * packs) { takeOne(BURNING_PLUS); counts.wood++; bp-- }

  const after = {} as Accumulators
  for (const m of MATERIALS) after[m] = acc[m] - counts[m] * RATE_SCALE
  return { counts, before: { ...before }, after }
}

export function dealFire(input: DealInput): DealResult {
  const { fire, packs, characterIds, seed, accumulators, firstSerial } = input
  if (!Number.isInteger(fire) || fire < 1) throw new Error('fire must be a whole number >= 1')
  if (!Number.isInteger(firstSerial) || firstSerial < 1) throw new Error('firstSerial must be a whole number >= 1')
  if (characterIds.length < 1) throw new Error('a Fire needs at least one character')
  if (new Set(characterIds).size !== characterIds.length) throw new Error('duplicate character in the Fire')
  if (!seed) throw new Error('seed is required')

  const pool = computePool(accumulators, packs)
  const c = pool.counts

  // Deal into packs. Slots 1-3 and 4 are fixed materials, so only slots 5 and 6 need shuffling:
  // shuffle all Burning-or-better cards; the first `packs` of them fill slot 6 (one per pack), the rest join the
  // Wood beyond slot 4 in the flex pile, which is shuffled again for slot 5.
  const poolStream = new Stream(seed, 'pool')
  const burningPlus: Material[] = []
  for (const m of BURNING_PLUS) for (let i = 0; i < c[m]; i++) burningPlus.push(m)
  poolStream.shuffle(burningPlus)
  const slot6 = burningPlus.slice(0, packs)
  const flex: Material[] = burningPlus.slice(packs)
  for (let i = 0; i < c.wood - packs; i++) flex.push('wood')
  poolStream.shuffle(flex)
  if (slot6.length !== packs || flex.length !== packs) throw new Error('internal: pack floor violated')

  type Pending = { pack: number; slot: number; material: Material }
  const pending: Pending[] = []
  for (let p = 0; p < packs; p++) {
    const mats: Material[] = ['paper', 'paper', 'paper', 'wood', flex[p], slot6[p]]
    mats.forEach((material, s) => pending.push({ pack: p + 1, slot: s + 1, material }))
  }

  // Serials: a seeded permutation of this Fire's block [firstSerial, firstSerial + cards).
  const order = pending.map((_, i) => i)
  new Stream(seed, 'serial').shuffle(order)
  const serialOf = new Array<number>(pending.length)
  order.forEach((cardIdx, k) => { serialOf[cardIdx] = firstSerial + k })
  const bySerial = pending.map((p, i) => ({ ...p, serial: serialOf[i] })).sort((a, b) => a.serial - b.serial)

  // Character and holo, drawn in serial order from their own streams.
  const charStream = new Stream(seed, 'character')
  const holoStream = new Stream(seed, 'holo')
  const cards: DealtCard[] = bySerial.map((p) => {
    const characterId = characterIds[charStream.int(characterIds.length)]
    const pRoll = holoRollChance(p.material)
    const holoFrame = holoStream.float() < pRoll
    const holoPicture = holoStream.float() < pRoll
    return {
      serial: p.serial, fire, pack: p.pack, slot: p.slot, material: p.material, characterId,
      holoFrame, holoPicture, holo: holoTypeOf(holoFrame, holoPicture), edition: 0, editionOf: 0,
    }
  })

  // Edition: k of N within this Fire, per character + material, in serial order.
  const groups = new Map<string, DealtCard[]>()
  for (const card of cards) {
    const key = `${card.characterId}\u0000${card.material}`
    const g = groups.get(key)
    if (g) g.push(card)
    else groups.set(key, [card])
  }
  for (const g of groups.values()) g.forEach((card, i) => { card.edition = i + 1; card.editionOf = g.length })

  const packContents: number[][] = Array.from({ length: packs }, () => new Array<number>(CARDS_PER_PACK))
  for (const card of cards) packContents[card.pack - 1][card.slot - 1] = card.serial

  return {
    method: DEAL_METHOD,
    fire, packs, seed, characterIds: [...characterIds],
    pool: { ...c },
    accumulatorsBefore: { ...accumulators },
    accumulatorsAfter: pool.after,
    firstSerial,
    nextSerial: firstSerial + cards.length,
    cards,
    packContents,
  }
}

/** Counts per material x holo type (for the Deal screen and tests). */
export function holoCounts(cards: DealtCard[]): Record<Material, Record<HoloType, number>> {
  const out = {} as Record<Material, Record<HoloType, number>>
  for (const m of MATERIALS) {
    out[m] = {} as Record<HoloType, number>
    for (const h of HOLO_TYPES) out[m][h] = 0
  }
  for (const card of cards) out[card.material][card.holo]++
  return out
}

/** Check a pack against the floor: slots 1-3 Paper, 4 Wood, 5 Wood-or-better, 6 Burning-or-better. */
export function packRespectsFloor(mats: Material[]): boolean {
  if (mats.length !== CARDS_PER_PACK) return false
  const rank = (m: Material) => MATERIALS.indexOf(m)
  return mats[0] === 'paper' && mats[1] === 'paper' && mats[2] === 'paper' && mats[3] === 'wood' &&
    rank(mats[4]) >= rank('wood') && rank(mats[5]) >= rank('burning')
}

/** Accumulator progress toward the next card, as a fraction (can be < 0 after borrowing a residual card). */
export function progress(acc: Accumulators, m: Material): number {
  return acc[m] / RATE_SCALE
}
