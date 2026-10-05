/** The SAMPLE deal of a Series, on its recipe. Pure functions only: no I/O, no Date, no Math.random.
 *
 *  It follows RecipeDealer's dealing (contracts/src/cards/RecipeDealer.sol) with the studio's own seeded randomness:
 *  1. The pool: previewPool (recipe.ts, the contract's maths) for the Series' pack count.
 *  2. Pack by pack, its slot groups most specific (deepest nested set) first. A card for a group walks down the nested
 *     sets: at each level a part is picked with weight = its cards not held back for later packs (a set) or its cards
 *     left (a type in no smaller set). So every pack keeps its slots and the totals come out exact.
 *  3. Holo: frame and picture rolled independently at the type's chances, or picked by its weights; a must-holo slot
 *     picks given holo.
 *  4. Character: uniform per card. Serials: a seeded permutation of the Series' block of serials.
 *  5. Edition: within the Series, per character + type, 1..N in serial order.
 *  On-chain the drand words decide all this when each pack is opened; this is a preview of the same rules. PDA grades
 *  are not rolled here. */

import { Stream } from './prng'
import { compileRecipe, holoOdds, parseUint, poolOf, type Recipe } from './recipe'
import {
  CARDS_PER_PACK, HOLO_TYPES, MAX_DEAL_CARDS, SHARE_SCALE, SHARE_UNITS, holoTypeOf, type HoloType, type Material,
} from './rules'

export const DEAL_METHOD = 'sample-recipe-v1'

export interface DealInput {
  /** Series number (printed as "Series F"). */
  fire: number
  packs: number
  /** The Series' characters, in image order (c0, c1, ...). */
  characterIds: string[]
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
  /** 1-based position in the pack, in dealing order (RecipeDealer.dealOrder). */
  slot: number
  /** The recipe slot group the position belongs to (0-based). */
  group: number
  /** Index into the Series' recipe types. */
  type: number
  characterId: string
  holoFrame: boolean
  holoPicture: boolean
  holo: HoloType
  /** k in "k of N · Series F". */
  edition: number
  /** N in "k of N · Series F". */
  editionOf: number
  /** PDA grade 1-10 once revealed; absent until then. */
  grade?: number | null
}

export interface DealResult {
  method: string
  fire: number
  packs: number
  seed: string
  characterIds: string[]
  /** Cards per type, in recipe order. */
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

export function dealFire(input: DealInput): DealResult {
  const { fire, packs, characterIds, seed, recipe, firstSerial } = input
  if (!Number.isInteger(fire) || fire < 1) throw new Error('fire must be a whole number >= 1')
  if (!Number.isInteger(firstSerial) || firstSerial < 1) throw new Error('firstSerial must be a whole number >= 1')
  if (!Number.isInteger(packs) || packs < 0) throw new Error('packs must be a whole number >= 0')
  if (characterIds.length < 1) throw new Error('a Series needs at least one character')
  if (new Set(characterIds).size !== characterIds.length) throw new Error('duplicate character in the Series')
  if (!seed) throw new Error('seed is required')
  const plan = compileRecipe(recipe)
  const S = plan.S
  if (packs * S > MAX_DEAL_CARDS) {
    throw new Error(`The sample deal deals at most ${MAX_DEAL_CARDS.toLocaleString()} cards (${packs.toLocaleString()} packs x ${S} = ${(packs * S).toLocaleString()}). The pool preview still covers any size.`)
  }
  const { counts, sums } = poolOf(plan, BigInt(packs))
  const pool = counts.map(Number)
  const typeLeft = [...pool]
  const nodeLeft = sums.map(Number)

  // holo odds per type: [none, frame, picture, full] as fractions; independent types roll two numbers
  const holo = recipe.types.map((t) => {
    if (t.holo.mode === 'independent') return { ind: true, a: Number(parseUint(t.holo.frame)) / 1e18, b: Number(parseUint(t.holo.picture)) / 1e18, w: holoOdds(t) }
    return { ind: false, a: 0, b: 0, w: holoOdds(t) }
  })

  const dealStream = new Stream(seed, 'deal')
  const holoStream = new Stream(seed, 'holo')
  const charStream = new Stream(seed, 'character')

  const pick = (weights: number[], u: Stream): number => {
    const total = weights.reduce((s, w) => s + w, 0)
    if (total <= 0) throw new Error('internal: nothing left to deal')
    let x = u.int(total)
    for (let j = 0; j < weights.length; j++) {
      if (x < weights[j]) return j
      x -= weights[j]
    }
    return weights.length - 1
  }

  type Pending = { pack: number; slot: number; group: number; type: number; holoFrame: boolean; holoPicture: boolean }
  const pending: Pending[] = []
  for (let p = 0; p < packs; p++) {
    const later = packs - p - 1 // packs still to come after this one
    let pos = 0
    for (const step of plan.steps) {
      for (let c = 0; c < step.count; c++) {
        // walk down from the group's set
        let x = step.node
        let t: number
        for (;;) {
          const n = plan.nodes[x]
          if (n.single >= 0) { t = n.single; break }
          const w = [...n.children.map((y) => nodeLeft[y] - later * plan.nodes[y].k), ...n.bare.map((b) => typeLeft[b])]
          const j = pick(w, dealStream)
          if (j < n.children.length) { x = n.children[j]; continue }
          t = n.bare[j - n.children.length]
          break
        }
        typeLeft[t]--
        for (let y = plan.inner[t]; ; y = plan.nodes[y].parent) { nodeLeft[y]--; if (y === 0) break }
        const h = holo[t]
        const u1 = holoStream.float()
        const u2 = holoStream.float() // always two draws per card
        let f: boolean
        let pic: boolean
        if (!step.mustHolo && h.ind) { f = u1 < h.a; pic = u2 < h.b }
        else {
          const w = step.mustHolo ? [0, h.w[1], h.w[2], h.w[3]] : h.w
          const total = w.reduce((s, v) => s + v, 0)
          let y = u1 * total
          let k = 0
          while (k < 3 && y >= w[k]) { y -= w[k]; k++ }
          f = k === 1 || k === 3
          pic = k === 2 || k === 3
        }
        pending.push({ pack: p + 1, slot: ++pos, group: step.slot, type: t, holoFrame: f, holoPicture: pic })
      }
    }
  }
  for (let t = 0; t < typeLeft.length; t++) if (typeLeft[t] !== 0) throw new Error('internal: the deal did not use the whole pool')

  // Serials: a seeded permutation of this Series' block [firstSerial, firstSerial + cards).
  const order = pending.map((_, i) => i)
  new Stream(seed, 'serial').shuffle(order)
  const serialOf = new Array<number>(pending.length)
  order.forEach((cardIdx, k) => { serialOf[cardIdx] = firstSerial + k })
  const cards: DealtCard[] = new Array(pending.length)
  pending.forEach((p, i) => {
    cards[serialOf[i] - firstSerial] = {
      serial: serialOf[i], fire, pack: p.pack, slot: p.slot, group: p.group, type: p.type, characterId: '',
      holoFrame: p.holoFrame, holoPicture: p.holoPicture, holo: holoTypeOf(p.holoFrame, p.holoPicture), edition: 0, editionOf: 0,
    }
  })
  for (const card of cards) card.characterId = characterIds[charStream.int(characterIds.length)]

  // Edition: k of N within this Series, per character + type, in serial order.
  const groups = new Map<string, DealtCard[]>()
  for (const card of cards) {
    const key = `${card.characterId}\u0000${card.type}`
    const g = groups.get(key)
    if (g) g.push(card)
    else groups.set(key, [card])
  }
  for (const g of groups.values()) g.forEach((card, i) => { card.edition = i + 1; card.editionOf = g.length })

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

// ---------------------------------------------------------------- the Standard pool, as before

/** The Diamond setting actually used: at least 1, whatever was saved. */
export function effectiveDiamonds(diamonds: number | undefined): number {
  return Math.max(1, diamonds ?? 1)
}

/** The Standard recipe's pool, written out the way the studio first did it (kept as the reference for
 *  contracts/test/cards/pool-fixture.json; recipe.ts previewPool gives the same numbers for the Standard recipe).
 *  a. Paper = 3 x packs. b. Fire = N x 15% and Coal = N x 4.9%, rounded half up. c. Diamond = the setting (at least
 *  1), at most one per pack; 0 with no packs. d. Wood = the rest. e. Floor: Fire-or-better between packs and 2 x packs
 *  (over: Fire, then Coal, to Wood; under: Wood to Fire). */
export function computePool(packs: number, diamonds = 1): Record<Material, number> {
  if (!Number.isInteger(packs) || packs < 0) throw new Error(`packs must be a whole number >= 0 (got ${packs})`)
  if (packs > 0xffff_ffff) throw new Error(`packs must fit in 32 bits, like the old contract (got ${packs})`)
  if (!Number.isInteger(diamonds)) throw new Error(`diamonds must be a whole number (got ${diamonds})`)
  const n = packs * CARDS_PER_PACK
  const half = SHARE_SCALE / 2
  let fire = Math.floor((SHARE_UNITS.burning * n + half) / SHARE_SCALE)
  let charcoal = Math.floor((SHARE_UNITS.charcoal * n + half) / SHARE_SCALE)
  const diamond = packs === 0 ? 0 : Math.min(effectiveDiamonds(diamonds), packs)
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

