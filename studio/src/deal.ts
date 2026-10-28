/** The SAMPLE deal of a Series, on its recipe. Pure functions only: no I/O, no Date, no Math.random.
 *
 *  It follows RecipeDealer's dealing (contracts/src/cards/RecipeDealer.sol) with the studio's own seeded randomness:
 *  every pack has the recipe's shape (its slots, in order), and every card is rolled on its own, from its slot's fixed
 *  odds:
 *  1. Type: by its slot's weights (a type's chance = its weight / the slot's total).
 *  2. Holo: frame and picture rolled independently at the type's chances, or picked by its weights.
 *  3. Character: by the character weights (none: every character equally likely).
 *  No pool, caps or guarantees beyond the slots, so nothing depends on the packs before: the first and the last pack
 *  have the same odds. One per character (recipe.ts, RecipeDealer _onePerCharacter): as each pack starts, with chance
 *  (still owed) / (packs still to deal, this one included) its first card becomes the one-per-character type, for a
 *  character still owed one picked at random (the contract's sparse shuffle), holo by that type's odds; its own stream,
 *  so the other cards roll exactly as without it. Serials: a seeded permutation of the Series' block. Print number: within the Series, per exact card
 *  (character + type + holo look), #1, #2, ... in the order dealt (pack, then position), as FireCards numbers them.
 *  On-chain the drand words decide all this when each pack is opened; this is a preview of the same rules. PDA grades
 *  are not rolled here. */

import { Stream } from './prng'
import { cardsPerPack, characterOdds, holoOdds, onePerIndex, parseUint, slotWeights, type Recipe } from './recipe'
import { HOLO_TYPES, MAX_DEAL_CARDS, holoTypeOf, type HoloType } from './rules'

export const DEAL_METHOD = 'sample-slots-v2'

export interface DealInput {
  /** Series number (printed as "Series F"). */
  fire: number
  packs: number
  /** The Series' characters, in image order (c0, c1, ...). */
  characterIds: string[]
  /** Each character's odds weight (same order); missing = every character equally likely. */
  characterWeights?: number[]
  /** Stand-in for the drand randomness. */
  seed: string
  recipe: Recipe
  /** First global serial for this Series (last Series' nextSerial; 1 for the very first Series). */
  firstSerial: number
}

export interface DealtCard {
  serial: number
  fire: number
  /** 1-based pack number within this Series. */
  pack: number
  /** 1-based position in the pack, in dealing order. */
  slot: number
  /** Index into the Series' recipe types. */
  type: number
  characterId: string
  holoFrame: boolean
  holoPicture: boolean
  holo: HoloType
  /** Print number: #k of this exact card (character, type, holo look) in this Series, in the order dealt. */
  printNumber: number
  /** PDA grade 1-10 once revealed (slabbed); absent until then. */
  grade?: number | null
  /** In a case (ungraded). */
  cased?: boolean
}

export interface DealResult {
  method: string
  fire: number
  packs: number
  seed: string
  characterIds: string[]
  /** Cards dealt of each type, in recipe order (what the odds gave this time). */
  pool: number[]
  cardsPerPack: number
  firstSerial: number
  /** First serial for the next Series. */
  nextSerial: number
  /** All cards, sorted by serial. */
  cards: DealtCard[]
  /** Serials in each pack, in dealing order (packContents[p][s] = serial of pack p+1, position s+1). */
  packContents: number[][]
}

/** The first index whose cumulative weight is above u x total (u in [0, 1)). */
function pickCum(cum: number[], u: number): number {
  const x = u * cum[cum.length - 1]
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] > x) hi = mid
    else lo = mid + 1
  }
  return lo
}

const cumulative = (w: number[]) => { let s = 0; return w.map((x) => (s += x)) }

export function dealFire(input: DealInput): DealResult {
  const { fire, packs, characterIds, seed, recipe, firstSerial } = input
  if (!Number.isInteger(fire) || fire < 1) throw new Error('fire must be a whole number >= 1')
  if (!Number.isInteger(firstSerial) || firstSerial < 1) throw new Error('firstSerial must be a whole number >= 1')
  if (!Number.isInteger(packs) || packs < 0) throw new Error('packs must be a whole number >= 0')
  if (characterIds.length < 1) throw new Error('a Series needs at least one character')
  if (new Set(characterIds).size !== characterIds.length) throw new Error('duplicate character in the Series')
  if (!seed) throw new Error('seed is required')
  const S = cardsPerPack(recipe)
  if (!Number.isInteger(S) || S < 1) throw new Error('cards per pack must be at least 1')
  if (packs * S > MAX_DEAL_CARDS) {
    throw new Error(`The sample deal deals at most ${MAX_DEAL_CARDS.toLocaleString()} cards (${packs.toLocaleString()} packs x ${S} = ${(packs * S).toLocaleString()}).`)
  }
  const slots = slotWeights(recipe)
  if (slots.some((sl) => sl.total <= 0n)) throw new Error('a slot of the recipe has no odds (every type weight is 0)')
  // each slot's weights as numbers, scaled so the biggest fits a double exactly enough for a preview
  const slotCum = slots.map(({ weights, total }) => {
    const scale = total > BigInt(Number.MAX_SAFE_INTEGER) ? total / BigInt(Number.MAX_SAFE_INTEGER) + 1n : 1n
    return cumulative(weights.map((w) => Number(w / scale)))
  })
  // the slot of each position in the pack
  const slotAt = slots.flatMap((sl, k) => new Array<number>(sl.count).fill(k))
  const charCum = cumulative(characterOdds(input.characterWeights, characterIds.length))

  // holo odds per type: independent types roll two numbers, the others pick by weight
  const holo = recipe.types.map((t) => {
    if (t.holo.mode === 'independent') return { ind: true, a: Number(parseUint(t.holo.frame)) / 1e18, b: Number(parseUint(t.holo.picture)) / 1e18, w: holoOdds(t) }
    return { ind: false, a: 0, b: 0, w: holoOdds(t) }
  })

  const dealStream = new Stream(seed, 'deal')
  const holoStream = new Stream(seed, 'holo')
  const charStream = new Stream(seed, 'character')
  const oneStream = new Stream(seed, 'one-per-character')
  const one = onePerIndex(recipe)
  // the characters still owed their one-per-character card: entries [0, owed) of a sparse shuffle, as the contract keeps it
  const owedList = characterIds.map((_, i) => i)
  let owed = one >= 0 ? characterIds.length : 0

  /** Holo look for a card of type t from two uniforms. */
  const rollHolo = (t: number, u1: number, u2: number): [boolean, boolean] => {
    const h = holo[t]
    if (h.ind) return [u1 < h.a, u2 < h.b]
    let y = u1
    let k = 0
    while (k < 3 && y >= h.w[k]) { y -= h.w[k]; k++ }
    return [k === 1 || k === 3, k === 2 || k === 3]
  }

  type Pending = { pack: number; slot: number; type: number; holoFrame: boolean; holoPicture: boolean; character: number }
  const pending: Pending[] = []
  const pool = new Array<number>(recipe.types.length).fill(0)
  for (let p = 0; p < packs; p++) {
    const first = pending.length
    for (let pos = 0; pos < S; pos++) {
      const t = pickCum(slotCum[slotAt[pos]], dealStream.float())
      pool[t]++
      const u1 = holoStream.float()
      const u2 = holoStream.float() // always two draws per card
      const [f, pic] = rollHolo(t, u1, u2)
      pending.push({ pack: p + 1, slot: pos + 1, type: t, holoFrame: f, holoPicture: pic, character: pickCum(charCum, charStream.float()) })
    }
    if (owed > 0) {
      // chance owed / left: certain once the packs left are no more than the characters owed
      const left = packs - p
      const r = oneStream.int(left)
      if (left <= owed || r < owed) {
        const j = oneStream.int(owed)
        const ch = owedList[j]
        owedList[j] = owedList[owed - 1]
        owed--
        const [f, pic] = rollHolo(one, oneStream.float(), oneStream.float())
        const card = pending[first]
        pool[card.type]--
        pool[one]++
        pending[first] = { ...card, type: one, holoFrame: f, holoPicture: pic, character: ch }
      }
    }
  }

  // Serials: a seeded permutation of this Series' block [firstSerial, firstSerial + cards).
  const order = pending.map((_, i) => i)
  new Stream(seed, 'serial').shuffle(order)
  const serialOf = new Array<number>(pending.length)
  order.forEach((cardIdx, k) => { serialOf[cardIdx] = firstSerial + k })
  const cards: DealtCard[] = new Array(pending.length)
  pending.forEach((p, i) => {
    cards[serialOf[i] - firstSerial] = {
      serial: serialOf[i], fire, pack: p.pack, slot: p.slot, type: p.type, characterId: characterIds[p.character],
      holoFrame: p.holoFrame, holoPicture: p.holoPicture, holo: holoTypeOf(p.holoFrame, p.holoPicture), printNumber: 0,
    }
  })

  numberPrints(cards)

  const packContents: number[][] = Array.from({ length: packs }, () => new Array<number>(S))
  for (const card of cards) packContents[card.pack - 1][card.slot - 1] = card.serial

  return {
    method: DEAL_METHOD, fire, packs, seed, characterIds: [...characterIds], pool, cardsPerPack: S,
    firstSerial, nextSerial: firstSerial + cards.length, cards, packContents,
  }
}

/** Counts per type x holo look. */
export function holoCounts(cards: DealtCard[], types: number): Record<HoloType, number>[] {
  const out = Array.from({ length: types }, () => Object.fromEntries(HOLO_TYPES.map((h) => [h, 0])) as Record<HoloType, number>)
  for (const card of cards) if (out[card.type]) out[card.type][card.holo]++
  return out
}

/** Print numbers, as FireCards gives them: per exact card (character, type, holo look) within the Series, #1, #2, ...
 *  in the order dealt (pack, then position in the pack). Sets `printNumber` on each card, in place. */
export function numberPrints(cards: DealtCard[]): void {
  const seen = new Map<string, number>()
  const byDeal = [...cards].sort((a, b) => a.pack - b.pack || a.slot - b.slot)
  for (const card of byDeal) {
    const key = `${card.characterId}\u0000${card.type}\u0000${card.holoFrame ? 1 : 0}${card.holoPicture ? 1 : 0}`
    const k = (seen.get(key) ?? 0) + 1
    seen.set(key, k)
    card.printNumber = k
  }
}
