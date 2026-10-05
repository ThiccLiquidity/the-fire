/** The SAMPLE deal, on the real rules. Pure functions only: no I/O, no Date, no Math.random.
 *
 *  Interface: dealFire(DealInput) -> DealResult. When the pack contract exists, its on-chain result (pool sizes,
 *  per-pack contents, serials, characters, holo rolls) is mapped into the same DealResult shape and everything
 *  downstream (build, review, export, upload) keeps working unchanged.
 *
 *  Steps
 *  1. Pool sizes from this Series' pack count and Diamond setting (computePool). Each Series stands alone.
 *  2. Seeded deal into packs respecting the floor: slots 1-3 Paper, 4 Wood, 5 Wood-or-better, 6 Burning-or-better.
 *  3. Global serials: a seeded permutation of this Series' cards onto the next block of serials, so a serial says
 *     nothing about a card's pack slot or material.
 *  4. Character: uniform among the Series' characters, per card (seeded).
 *  5. Holo: two independent rolls per card (frame, picture), each p = 1 - sqrt(1 - rate); both = full holo.
 *     Diamond is always holo: 1/3 frame only, 1/3 picture only, 1/3 full (rollHolo).
 *  6. Edition: within this Series, per character + material, cards are numbered 1..N in serial order.
 *  PDA grades are NOT rolled here (they come from drand, committed on-chain, hidden until the paid reveal). */

import { Stream } from './prng'
import {
  CARDS_PER_PACK, HOLO_TYPES, MATERIALS, MAX_CHARACTERS, SHARE_SCALE, SHARE_UNITS, holoTypeOf, rollHolo, type HoloType, type Material,
} from './rules'

export const DEAL_METHOD = 'sample-sha256ctr-v1'

export interface DealInput {
  /** Series number (printed as "Series F"). */
  fire: number
  /** Packs sold in this Series. Pool size is exactly packs * 6. */
  packs: number
  /** The Series' characters (any number >= 1). Order matters for determinism. */
  characterIds: string[]
  /** Stand-in for the drand round's randomness. */
  seed: string
  /** Diamonds set for this Series (at least 1 is always made; capped at one per pack). */
  diamonds: number
  /** First global serial for this Series (last Series' nextSerial; 1 for the very first Series). */
  firstSerial: number
}

export interface DealtCard {
  serial: number
  fire: number
  /** 1-based pack number within this Series. */
  pack: number
  /** 1..6, the pack slot (1-3 Paper, 4 Wood, 5 Wood+, 6 Burning+). */
  slot: number
  material: Material
  characterId: string
  holoFrame: boolean
  holoPicture: boolean
  holo: HoloType
  /** k in "k of N · Series F". */
  edition: number
  /** N in "k of N · Series F". */
  editionOf: number
  /** PDA grade 1-10 once revealed (by the pack contract); absent until then. */
  grade?: number | null
}

export interface DealResult {
  method: string
  fire: number
  packs: number
  seed: string
  characterIds: string[]
  pool: Record<Material, number>
  /** The Series' Diamond setting the pool was worked out with. */
  diamonds: number
  firstSerial: number
  /** First serial for the next Series. */
  nextSerial: number
  /** All cards, sorted by serial. */
  cards: DealtCard[]
  /** Serials in each pack, in slot order (packContents[p][s] = serial of pack p+1, slot s+1). */
  packContents: number[][]
}

const BURNING_PLUS: Material[] = ['burning', 'charcoal', 'diamond']

/** The Diamond setting actually used: at least 1, whatever was saved. */
export function effectiveDiamonds(diamonds: number | undefined): number {
  return Math.max(1, diamonds ?? 1)
}

/** Pool sizes for one Series of `packs` packs (N = 6 x packs cards). Each Series stands alone: no carry-over.
 *  Integer arithmetic only, the same steps as the contract's CardRules.computePool:
 *  a. Paper = 3 x packs.
 *  b. Fire = N x 15% and Coal = N x 4.9%, each rounded half up.
 *  c. Diamond = the Series' setting (at least 1), but never more than one per pack; 0 when there are no packs.
 *  d. Wood = the rest of the non-Paper half.
 *  e. Pack floor: Fire-or-better must be between packs and 2 x packs (so Wood >= packs). Over: move Fire (then
 *     Coal) to Wood one at a time. Under: move Wood to Fire. (Only matters for tiny Series or many Diamonds.) */
export function computePool(packs: number, diamonds = 1): Record<Material, number> {
  if (!Number.isInteger(packs) || packs < 0) throw new Error(`packs must be a whole number >= 0 (got ${packs})`)
  if (packs > 0xffff_ffff) throw new Error(`packs must fit in 32 bits, like the contract (got ${packs})`)
  if (!Number.isInteger(diamonds)) throw new Error(`diamonds must be a whole number (got ${diamonds})`)
  const n = packs * CARDS_PER_PACK
  const half = SHARE_SCALE / 2
  let fire = Math.floor((SHARE_UNITS.burning * n + half) / SHARE_SCALE)
  let charcoal = Math.floor((SHARE_UNITS.charcoal * n + half) / SHARE_SCALE)
  const diamond = packs === 0 ? 0 : Math.min(effectiveDiamonds(diamonds), packs)
  // the floor, in one step each (same result as moving one card at a time; the contract does the same)
  const bp = fire + charcoal + diamond
  if (bp > 2 * packs) {
    const over = bp - 2 * packs
    const fromFire = Math.min(over, fire)
    fire -= fromFire
    charcoal -= over - fromFire
  } else if (bp < packs) {
    fire += packs - bp
  }
  const wood = 3 * packs - fire - charcoal - diamond
  return { paper: 3 * packs, wood, burning: fire, charcoal, diamond }
}

export function dealFire(input: DealInput): DealResult {
  const { fire, packs, characterIds, seed, diamonds, firstSerial } = input
  if (!Number.isInteger(fire) || fire < 1) throw new Error('fire must be a whole number >= 1')
  if (!Number.isInteger(firstSerial) || firstSerial < 1) throw new Error('firstSerial must be a whole number >= 1')
  if (characterIds.length < 1) throw new Error('a Series needs at least one character')
  if (characterIds.length > MAX_CHARACTERS) throw new Error(`a Series has at most ${MAX_CHARACTERS} characters (the contract's limit)`)
  if (new Set(characterIds).size !== characterIds.length) throw new Error('duplicate character in the Series')
  if (!seed) throw new Error('seed is required')

  const c = computePool(packs, diamonds)

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

  // Serials: a seeded permutation of this Series' block [firstSerial, firstSerial + cards).
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
    const u1 = holoStream.float()
    const u2 = holoStream.float() // always two draws per card, so one card's rule never shifts another's rolls
    const { frame: holoFrame, picture: holoPicture } = rollHolo(p.material, u1, u2)
    return {
      serial: p.serial, fire, pack: p.pack, slot: p.slot, material: p.material, characterId,
      holoFrame, holoPicture, holo: holoTypeOf(holoFrame, holoPicture), edition: 0, editionOf: 0,
    }
  })

  // Edition: k of N within this Series, per character + material, in serial order.
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
    diamonds: effectiveDiamonds(diamonds),
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
