/** A Series' recipe: its card types and its pack (slots). This is the studio's copy of
 *  RecipeDealer.Recipe (contracts/src/cards/RecipeDealer.sol) plus what only the studio needs (each type's frame set).
 *
 *  - checkRecipe: every check RecipeDealer.check makes, in the same order (so the first problem is the contract's
 *    revert), plus the studio's own (number formats).
 *  - compileRecipe / previewPool: a port of the contract's nested sets and pool maths (_compile, _pool), exact for any
 *    pack count (BigInt). scripts/recipe-parity.test.ts checks it against the contract's previewPool.
 *  - recipeJson: the recipe.json that contracts/script/ConfigureSeries.s.sol reads.
 *
 *  Numbers the contract stores above 2^53 (shares, holo chances, weights) are kept as decimal strings. */

import { HOLO_TYPES, type HoloType } from './rules'
import type { SaleJson } from './sale'

export type Supply = 'filler' | 'share' | 'perPack' | 'count' | 'perCharacter'
export const SUPPLY_LABEL: Record<Supply, string> = {
  share: 'Percent of cards', perPack: 'Per pack', count: 'Exact number', perCharacter: 'Per character',
  filler: 'The rest',
}
/** RecipeDealer's per-character counts are 16-bit. */
export const MAX_PER_CHARACTER = 65_535n

/** Independent: frame and picture each rolled at a chance out of 1e18. Distribution: weights for none, frame,
 *  picture, full (any total above 0). */
export type HoloRule =
  | { mode: 'independent'; frame: string; picture: string }
  | { mode: 'distribution'; weights: [string, string, string, string] }

export interface CardTypeDef {
  /** Local id (slots refer to types by it, so reordering or deleting a type never breaks a slot). */
  id: string
  /** The "Material" trait and the first word of the card's name: 1-64 bytes, no `"`, `\` or control characters. */
  name: string
  /** Image file names: 1-32 bytes of [a-z0-9-], unique in the recipe. */
  slug: string
  /** Set once the slug is typed by hand; until then it follows the name. */
  slugEdited?: boolean
  rank: number
  supply: Supply
  /** share: parts per billion of the Series' cards; perPack: cards per pack; count: exact cards; perCharacter: cards of
   *  each character; filler: unused. */
  amount: string
  /** '0' = no cap; else at most maxPerPack x packs. */
  maxPerPack: string
  holo: HoloRule
  /** The frame set (src/assets/frames/<set>[-holo][-lN].webp) and character art this type uses. */
  frameSet: string
}

export interface SlotDef {
  count: number
  /** 'types': an explicit list (one type = a guaranteed type); 'rank': every type with minRank <= rank <= maxRank. */
  kind: 'types' | 'rank'
  typeIds: string[]
  minRank: number
  /** null = no top ("or better"). */
  maxRank: number | null
  mustHolo: boolean
}

export interface Recipe {
  types: CardTypeDef[]
  slots: SlotDef[]
}

export const SHARE_SCALE = 1_000_000_000n
export const HOLO_ONE = 1_000_000_000_000_000_000n
export const UINT32_MAX = 0xffff_ffff
const U64 = (1n << 64n) - 1n
const U128 = (1n << 128n) - 1n
export const MAX_TYPE_NAME_BYTES = 64
export const MAX_SLUG_BYTES = 32
/** FirePsa's fresh odds (out of 10,000), grade 1 first: fixed forever, the same for every Series (docs/grading.md).
 *  10 1%, 9 17%, 8 25%, 7 27%, 6 20%, 5 10%; 1-4 come only from wear. Shown, never set or exported. */
export const FRESH_PDA_ODDS = [0, 0, 0, 0, 1000, 2000, 2700, 2500, 1700, 100] as const
/** Gold cards in the classic (five-type) recipe. */
export const DEFAULT_GOLD = 15 // classicRecipe: a fixed count, as Diamond was
/** The Standard recipe's Gold per character (StandardRecipe.DEFAULT_GOLD_PER_CHARACTER). */
export const DEFAULT_GOLD_PER_CHARACTER = 2

// ---------------------------------------------------------------- presets

/** StandardRecipe.sol: holo roll chances 1 - sqrt(1 - rate) for 5 / 10 / 50 / 90%, at 1e18. */
export const STANDARD_ROLLS = {
  paper: '25320565519103609',
  wood: '51316701949486200',
  fire: '292893218813452475',
  coal: '683772233983162066',
} as const

const ind = (roll: string): HoloRule => ({ mode: 'independent', frame: roll, picture: roll })

const fullHolo = (): HoloRule => ({ mode: 'distribution', weights: ['0', '0', '0', '1'] })

/** Exactly StandardRecipe.build(goldPerCharacter): Paper 3 per pack, Wood the rest, Fire 15%, Coal 4.9%, Gold per
 *  character (2 by default, so it stays twice as common as Full Art whatever the cast size), Full Art one per
 *  character; both at most one per pack's worth and always full holo. Pack of 6: 3 Paper, Wood, Wood-or-better,
 *  Fire-or-better. */
export function standardRecipe(goldPerCharacter = DEFAULT_GOLD_PER_CHARACTER): Recipe {
  const r = classicRecipe()
  r.types[4] = { ...r.types[4], supply: 'perCharacter', amount: String(Math.max(1, Math.floor(goldPerCharacter))) }
  r.types.push({
    id: 'fullart', name: 'Full Art', slug: 'fullart', rank: 5, supply: 'perCharacter', amount: '1', maxPerPack: '1',
    holo: fullHolo(), frameSet: 'fullart',
  })
  return r
}

/** The recipe Series saved before Gold had: the old Standard with Diamond (frame / picture / full, a third each). Only
 *  migrate.ts uses it, so old saves keep their cards and images. */
export function legacyDiamondRecipe(diamonds = 1): Recipe {
  const r = classicRecipe(diamonds)
  r.types[4] = { ...r.types[4], id: 'diamond', name: 'Diamond', slug: 'diamond', holo: { mode: 'distribution', weights: ['0', '1', '1', '1'] }, frameSet: 'diamond' }
  return r
}

/** StandardRecipe.classic(gold): the first five types only (the original recipe, Gold in Diamond's place). */
export function classicRecipe(gold = DEFAULT_GOLD): Recipe {
  return {
    types: [
      { id: 'paper', name: 'Paper', slug: 'paper', rank: 0, supply: 'perPack', amount: '3', maxPerPack: '0', holo: ind(STANDARD_ROLLS.paper), frameSet: 'paper' },
      { id: 'wood', name: 'Wood', slug: 'wood', rank: 1, supply: 'filler', amount: '0', maxPerPack: '0', holo: ind(STANDARD_ROLLS.wood), frameSet: 'wood' },
      { id: 'fire', name: 'Fire', slug: 'fire', rank: 2, supply: 'share', amount: '150000000', maxPerPack: '0', holo: ind(STANDARD_ROLLS.fire), frameSet: 'burning' },
      { id: 'coal', name: 'Coal', slug: 'coal', rank: 3, supply: 'share', amount: '49000000', maxPerPack: '0', holo: ind(STANDARD_ROLLS.coal), frameSet: 'charcoal' },
      {
        id: 'gold', name: 'Gold', slug: 'gold', rank: 4, supply: 'count', amount: String(Math.max(1, Math.floor(gold))),
        maxPerPack: '1', holo: fullHolo(), frameSet: 'gold',
      },
    ],
    slots: [
      { count: 3, kind: 'types', typeIds: ['paper'], minRank: 0, maxRank: null, mustHolo: false },
      { count: 1, kind: 'types', typeIds: ['wood'], minRank: 0, maxRank: null, mustHolo: false },
      { count: 1, kind: 'rank', typeIds: [], minRank: 1, maxRank: null, mustHolo: false },
      { count: 1, kind: 'rank', typeIds: [], minRank: 2, maxRank: null, mustHolo: false },
    ],
  }
}

/** An example special Series: 3 cards per pack, every card holo. Fire fills the packs, Coal is 30% of the cards and
 *  Gold 2% (at most one per pack's worth); slots 1-2 are Fire-or-better, slot 3 Coal-or-better. Every slot is must-holo, so no
 *  card is ever plain (and no "none" images are built). */
export function specialAllHoloRecipe(): Recipe {
  const half = '500000000000000000'
  return {
    types: [
      { id: 'fire', name: 'Fire', slug: 'fire', rank: 2, supply: 'filler', amount: '0', maxPerPack: '0', holo: ind(half), frameSet: 'burning' },
      { id: 'coal', name: 'Coal', slug: 'coal', rank: 3, supply: 'share', amount: '300000000', maxPerPack: '0', holo: ind(half), frameSet: 'charcoal' },
      {
        id: 'gold', name: 'Gold', slug: 'gold', rank: 4, supply: 'share', amount: '20000000', maxPerPack: '1',
        holo: fullHolo(), frameSet: 'gold',
      },
    ],
    slots: [
      { count: 2, kind: 'rank', typeIds: [], minRank: 2, maxRank: null, mustHolo: true },
      { count: 1, kind: 'rank', typeIds: [], minRank: 3, maxRank: null, mustHolo: true },
    ],
  }
}

/** A fresh copy with new type ids (slots follow). */
export function cloneRecipe(r: Recipe, newId: () => string): Recipe {
  const map = new Map(r.types.map((t) => [t.id, newId()]))
  return {
    types: r.types.map((t) => ({ ...t, id: map.get(t.id)!, holo: t.holo.mode === 'independent' ? { ...t.holo } : { mode: 'distribution', weights: [...t.holo.weights] } })),
    slots: r.slots.map((s) => ({ ...s, typeIds: s.typeIds.map((id) => map.get(id) ?? id) })),
  }
}

// ---------------------------------------------------------------- text and numbers

const enc = new TextEncoder()
export const byteLength = (s: string) => enc.encode(s).length

/** The slug a name gives: lowercase, [a-z0-9-], spaces and other characters as single dashes, at most 32 bytes. */
export function slugify(name: string): string {
  const s = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s.slice(0, MAX_SLUG_BYTES).replace(/-+$/, '')
}

/** A whole number as a BigInt, or null if `s` isn't one. */
export function parseUint(s: string | number): bigint | null {
  const t = String(s).trim()
  if (!/^\d+$/.test(t)) return null
  return BigInt(t)
}

/** "15" or "4.9" (percent, up to `decimals` places) to an integer at `scale` (1 = 100%). null if not a number in
 *  range or with too many decimals. */
export function percentToScaled(text: string, scale: bigint): bigint | null {
  const t = text.trim()
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t)
  if (!t || !m || (m[1] === '' && (m[2] ?? '') === '')) return null
  const digits = scale.toString().length - 1 + 0 // scale is a power of ten
  const places = digits - 2 // percent
  const frac = m[2] ?? ''
  if (frac.length > places) return null
  const v = BigInt((m[1] || '0') + frac.padEnd(places, '0'))
  return v > scale ? null : v
}

/** The inverse: an integer at `scale` as a percent string with no trailing zeros. */
export function scaledToPercent(v: bigint, scale: bigint): string {
  const places = scale.toString().length - 3
  const s = v.toString().padStart(places + 1, '0')
  const int = s.slice(0, s.length - places)
  const frac = s.slice(s.length - places).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

/** For display only: the percent rounded to at most `digits` decimals (half up). A non-zero value that would round to 0
 *  is shown exactly. The stored value is never changed by this. */
export function roundedPercent(v: bigint, scale: bigint, digits = 2): string {
  const places = scale.toString().length - 3
  if (places <= digits) return scaledToPercent(v, scale)
  const unit = 10n ** BigInt(places - digits)
  const r = ((v + unit / 2n) / unit) * unit
  return r === 0n && v > 0n ? scaledToPercent(v, scale) : scaledToPercent(r, scale)
}

// ---------------------------------------------------------------- checks

export interface Problem {
  /** The contract's error ('BadType', 'BadSlot', 'NotNested', ...) or 'Studio' for the studio's own checks. */
  code: string
  where: 'recipe' | 'type' | 'slot'
  index?: number
  message: string
}

/** The type indexes a slot can hold (explicit list, or rank range), in recipe order. Unknown ids are skipped. */
export function slotTypeIndexes(r: Recipe, s: SlotDef): number[] {
  if (s.kind === 'types') {
    const out: number[] = []
    for (const id of s.typeIds) {
      const i = r.types.findIndex((t) => t.id === id)
      if (i >= 0) out.push(i)
    }
    return out
  }
  const max = s.maxRank ?? UINT32_MAX
  return r.types.flatMap((t, i) => (t.rank >= s.minRank && t.rank <= max ? [i] : []))
}

export function cardsPerPack(r: Recipe): number {
  return r.slots.reduce((n, s) => n + (Number.isFinite(s.count) ? s.count : 0), 0)
}

function badText(s: string): boolean {
  // JS strings are always valid UTF-8 once encoded, except lone surrogates: the contract refuses those too
  return /["\\\u0000-\u001f\u007f]/.test(s) || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s)
}

function canHolo(t: CardTypeDef): boolean {
  if (t.holo.mode === 'independent') return (parseUint(t.holo.frame) ?? 0n) > 0n || (parseUint(t.holo.picture) ?? 0n) > 0n
  const w = t.holo.weights.map((x) => parseUint(x) ?? 0n)
  return w[1] + w[2] + w[3] > 0n
}

const typeLabel = (r: Recipe, i: number) => `Type ${i + 1}${r.types[i]?.name ? ` (${r.types[i].name})` : ''}`
const slotLabel = (i: number) => `Slot group ${i + 1}`

/** Studio-side format checks: every number is a whole number in its on-chain range. */
function formatProblems(r: Recipe): Problem[] {
  const out: Problem[] = []
  const typeP = (i: number, message: string) => out.push({ code: 'Studio', where: 'type', index: i, message: `${typeLabel(r, i)}: ${message}` })
  r.types.forEach((t, i) => {
    if (!Number.isInteger(t.rank) || t.rank < 0 || t.rank > UINT32_MAX) typeP(i, 'rank must be a whole number from 0 to 4,294,967,295.')
    if (t.supply !== 'filler') {
      const a = parseUint(t.amount)
      if (a == null || a > U128) typeP(i, 'amount must be a whole number.')
    }
    const cap = parseUint(t.maxPerPack)
    if (cap == null || cap > U64) typeP(i, 'max per pack must be a whole number (0 = no cap).')
    if (t.holo.mode === 'independent') {
      for (const [k, v] of [['frame', t.holo.frame], ['picture', t.holo.picture]] as const) {
        const x = parseUint(v)
        if (x == null || x > U64) typeP(i, `holo ${k} chance is not a valid number.`)
      }
    } else {
      if (t.holo.weights.length !== 4 || t.holo.weights.some((w) => { const x = parseUint(w); return x == null || x > U64 })) typeP(i, 'holo weights must be 4 whole numbers.')
    }
  })
  r.slots.forEach((s, i) => {
    if (!Number.isInteger(s.count) || s.count < 0 || s.count > UINT32_MAX) out.push({ code: 'Studio', where: 'slot', index: i, message: `${slotLabel(i)}: count must be a whole number.` })
    if (s.kind === 'rank' && (!Number.isInteger(s.minRank) || s.minRank < 0 || s.minRank > UINT32_MAX || (s.maxRank != null && (!Number.isInteger(s.maxRank) || s.maxRank < 0 || s.maxRank > UINT32_MAX)))) {
      out.push({ code: 'Studio', where: 'slot', index: i, message: `${slotLabel(i)}: ranks must be whole numbers from 0 to 4,294,967,295.` })
    }
  })
  return out
}

/** Every problem with a recipe. The contract's checks come in the contract's order, so the first contract problem is
 *  the one RecipeDealer.check reverts with. Studio format problems come first (the contract couldn't even take the
 *  recipe). */
export function checkRecipe(r: Recipe): Problem[] {
  const out = formatProblems(r)
  if (out.length) return out
  const T = r.types.length
  const typeP = (i: number, why: string, message: string, code = 'BadType') => out.push({ code: code === 'BadType' ? `BadType(${i},${why})` : code, where: 'type', index: i, message: `${typeLabel(r, i)}: ${message}` })
  // _checkTypes
  if (T === 0 || T > UINT32_MAX) out.push({ code: 'BadFiller', where: 'recipe', message: 'Add at least one card type.' })
  let fillers = 0
  const slugs = new Map<string, number>()
  r.types.forEach((t, i) => {
    const n = byteLength(t.name)
    if (n === 0 || n > MAX_TYPE_NAME_BYTES) typeP(i, 'name length', n === 0 ? 'give it a name.' : `name is ${n} bytes, at most ${MAX_TYPE_NAME_BYTES}.`)
    else if (badText(t.name)) typeP(i, '', 'name: no double quotes, backslashes or control characters.', 'BadText')
    const sl = byteLength(t.slug)
    if (sl === 0 || sl > MAX_SLUG_BYTES) typeP(i, 'slug length', sl === 0 ? 'slug is empty.' : `slug is ${sl} bytes, at most ${MAX_SLUG_BYTES}.`)
    else if (!/^[a-z0-9-]+$/.test(t.slug)) typeP(i, 'slug characters', 'slug: only a-z, 0-9 and "-".')
    else if (slugs.has(t.slug)) typeP(i, 'slug repeated', `slug "${t.slug}" is already used by ${typeLabel(r, slugs.get(t.slug)!)}.`)
    if (!slugs.has(t.slug)) slugs.set(t.slug, i)
    if (t.supply === 'filler') fillers++
    else if (t.supply === 'share' && parseUint(t.amount)! > SHARE_SCALE) typeP(i, 'share above 100%', 'share is above 100%.')
    else if (t.supply === 'perCharacter' && (parseUint(t.amount)! === 0n || parseUint(t.amount)! > MAX_PER_CHARACTER)) {
      typeP(i, 'per character', `per character must be 1 to ${MAX_PER_CHARACTER.toLocaleString()}.`)
    }
    if (t.holo.mode === 'independent') {
      if (parseUint(t.holo.frame)! > HOLO_ONE || parseUint(t.holo.picture)! > HOLO_ONE) typeP(i, 'holo chances', 'a holo chance is above 100%.')
    } else if (t.holo.weights.reduce((a, w) => a + parseUint(w)!, 0n) === 0n) {
      typeP(i, 'holo weights', 'holo weights add up to 0 (give at least one a weight).')
    }
  })
  if (T > 0 && fillers !== 1) {
    out.push({ code: 'BadFiller', where: 'recipe', message: fillers === 0 ? 'One type must be the filler (it takes whatever is left).' : `Only one type can be the filler (${fillers} are).` })
  }
  // _buildSets
  const G = r.slots.length
  if (G === 0) out.push({ code: 'BadSlot(0,no slots)', where: 'recipe', message: 'Add at least one slot group.' })
  const slotP = (s: number, why: string, message: string) => out.push({ code: `BadSlot(${s},${why})`, where: 'slot', index: s, message: `${slotLabel(s)}: ${message}` })
  const sets: number[][] = []
  let rootUsed = false
  const covered = new Set<number>()
  let S = 0
  r.slots.forEach((sl, s) => {
    if (sl.count === 0) slotP(s, 'count', 'count must be at least 1.')
    S += sl.count
    let set: number[]
    if (sl.kind === 'types') {
      set = []
      const seen = new Set<string>()
      for (const id of sl.typeIds) {
        const i = r.types.findIndex((t) => t.id === id)
        if (i < 0) { slotP(s, 'type index', 'lists a type that no longer exists.'); continue }
        if (seen.has(id)) slotP(s, 'type repeated', `lists ${r.types[i].name} twice.`)
        seen.add(id)
        set.push(i)
      }
      set.sort((a, b) => a - b)
      if (!sl.typeIds.length) out.push({ code: 'Studio', where: 'slot', index: s, message: `${slotLabel(s)}: pick at least one type.` })
    } else {
      const max = sl.maxRank ?? UINT32_MAX
      if (sl.minRank > max) slotP(s, 'rank range', 'the lowest rank is above the highest.')
      set = slotTypeIndexes(r, sl)
      if (sl.minRank <= max && !set.length) slotP(s, 'no type in rank range', `no type has a rank from ${sl.minRank} to ${sl.maxRank ?? 'the top'}.`)
    }
    for (const t of set) covered.add(t)
    sets.push(set)
    if (set.length === T && T > 0) rootUsed = true
    if (sl.mustHolo) {
      for (const t of set) if (!canHolo(r.types[t])) out.push({ code: `NeverHolo(${s},${t})`, where: 'slot', index: s, message: `${slotLabel(s)} must be holo, but ${r.types[t].name || typeLabel(r, t)} is never holo.` })
    }
  })
  if (S > UINT32_MAX) slotP(G - 1, 'too many cards per pack', 'too many cards per pack.')
  if (!rootUsed && G > 0) {
    r.types.forEach((t, i) => {
      if (!covered.has(i)) out.push({ code: `TypeNeverDealt(${i})`, where: 'type', index: i, message: `${typeLabel(r, i)}: no slot can take ${t.name || 'it'}, so it would never be dealt.` })
    })
  }
  // _buildTree: nested or disjoint (sets compared as distinct nodes, first slot per node)
  const nodes: { key: string; set: number[]; slot: number }[] = []
  sets.forEach((set, s) => {
    const key = set.join(',')
    if (set.length !== T && !nodes.some((n) => n.key === key)) nodes.push({ key, set, slot: s })
  })
  const reported = new Set<string>()
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue
      const a = new Set(nodes[i].set)
      const common = nodes[j].set.filter((t) => a.has(t)).length
      const disjoint = common === 0
      const iInJ = common === nodes[i].set.length
      const jInI = common === nodes[j].set.length
      if (!disjoint && !iInJ && !jInI) {
        const pair = [nodes[i].slot, nodes[j].slot].sort((x, y) => x - y).join(':')
        if (reported.has(pair)) continue
        reported.add(pair)
        const names = (set: number[]) => set.map((t) => r.types[t].name).join(', ')
        out.push({
          code: `NotNested(${nodes[i].slot},${nodes[j].slot})`, where: 'slot', index: nodes[i].slot,
          message: `${slotLabel(nodes[i].slot)} (${names(nodes[i].set)}) and ${slotLabel(nodes[j].slot)} (${names(nodes[j].set)}) overlap without one holding the other. Make one set hold the other, or keep them apart.`,
        })
      }
    }
  }
  if (!out.length) {
    // the contract's dry runs (RecipeCompiler.compile): the floor holds for every size, and no per-character type is dealt twice
    try {
      const plan = compileRecipe(r)
      for (const [p, ch] of [[1n, 1n], [2n, 1n], [7n, 1n], [7n, 1_000n], [1_000_003n, 1n]]) poolOf(plan, p, ch)
    } catch (e) {
      out.push({ code: 'Infeasible', where: 'recipe', message: `The pool can't fill the packs (${(e as Error).message}).` })
    }
  }
  return out
}

/** Problems the contract itself would reject (RecipeDealer.check / setRecipe). */
export function contractProblems(problems: Problem[]): Problem[] {
  return problems.filter((p) => p.code !== 'Studio')
}

// ---------------------------------------------------------------- the compiled recipe (port of _compile)

export interface Plan {
  T: number
  S: number
  filler: number
  ranks: number[]
  supply: Supply[]
  amount: bigint[]
  cap: bigint[]
  /** Nested sets; node 0 = every type. */
  nodes: { types: number[]; parent: number; depth: number; k: number; holdsFiller: boolean; lowest: number; single: number; children: number[]; bare: number[] }[]
  /** Smallest node holding each type (0 if none). */
  inner: number[]
  /** Slot groups in dealing order: deepest set first, ties in recipe order. */
  steps: { node: number; count: number; mustHolo: boolean; slot: number }[]
  /** Types the floor takes back from, in order (share / per-pack first, then exact counts; lowest rank first). */
  trim: number[]
  /** Nodes, deepest first. */
  depthOrder: number[]
}

/** The compiled form of a valid recipe (throws on an invalid one: run checkRecipe first). */
export function compileRecipe(r: Recipe): Plan {
  const T = r.types.length
  const filler = r.types.findIndex((t) => t.supply === 'filler')
  if (T === 0 || filler < 0) throw new Error('no filler')
  const all = r.types.map((_, i) => i)
  const sets: number[][] = [all]
  const keys = [all.join(',')]
  const slotNode: number[] = []
  let S = 0
  for (const sl of r.slots) {
    S += sl.count
    const set = [...new Set(slotTypeIndexes(r, sl))].sort((a, b) => a - b)
    const key = set.join(',')
    let j = keys.indexOf(key)
    if (j < 0) { j = sets.length; sets.push(set); keys.push(key) }
    slotNode.push(j)
  }
  const nn = sets.length
  const has = sets.map((s) => new Set(s))
  const size = sets.map((s) => s.length)
  const parent = new Array<number>(nn).fill(0)
  for (let i = 1; i < nn; i++) {
    let best = 0
    for (let j = 1; j < nn; j++) {
      if (i === j) continue
      const iInJ = sets[i].every((t) => has[j].has(t))
      if (iInJ && size[j] < size[best]) best = j
    }
    parent[i] = best
  }
  const depth = new Array<number>(nn).fill(0)
  for (let i = 1; i < nn; i++) { let d = 0; for (let x = i; x !== 0; x = parent[x]) d++; depth[i] = d }
  const k = new Array<number>(nn).fill(0)
  r.slots.forEach((sl, s) => {
    let x = slotNode[s]
    for (;;) { k[x] += sl.count; if (x === 0) break; x = parent[x] }
  })
  const inner = all.map((t) => {
    let best = 0
    for (let i = 1; i < nn; i++) if (has[i].has(t) && size[i] < size[best]) best = i
    return best
  })
  const ranks = r.types.map((t) => t.rank)
  const nodes = sets.map((set, x) => {
    let lowest = -1
    for (const t of set) if (lowest < 0 || ranks[t] < ranks[lowest]) lowest = t
    const children: number[] = []
    for (let y = 1; y < nn; y++) if (parent[y] === x && y !== x) children.push(y)
    return {
      types: set, parent: parent[x], depth: depth[x], k: k[x], holdsFiller: has[x].has(filler), lowest,
      single: set.length === 1 ? set[0] : -1, children, bare: all.filter((t) => inner[t] === x),
    }
  })
  const maxDepth = Math.max(...depth)
  const steps: Plan['steps'] = []
  for (let d = maxDepth; d >= 0; d--) r.slots.forEach((sl, s) => { if (depth[slotNode[s]] === d) steps.push({ node: slotNode[s], count: sl.count, mustHolo: sl.mustHolo, slot: s }) })
  const trim: number[] = []
  for (const pass of [0, 1]) {
    const start = trim.length
    for (let t = 0; t < T; t++) {
      const exact = r.types[t].supply === 'count' || r.types[t].supply === 'perCharacter'
      if (t === filler || exact !== (pass === 1)) continue
      let i = trim.length
      trim.push(t)
      while (i > start && ranks[trim[i - 1]] > ranks[t]) { trim[i] = trim[i - 1]; i-- }
      trim[i] = t
    }
  }
  const depthOrder: number[] = []
  for (let d = maxDepth; d >= 0; d--) for (let x = 0; x < nn; x++) if (depth[x] === d) depthOrder.push(x)
  return {
    T, S, filler, ranks, supply: r.types.map((t) => t.supply), amount: r.types.map((t) => parseUint(t.amount) ?? 0n),
    cap: r.types.map((t) => parseUint(t.maxPerPack) ?? 0n), nodes, inner, steps, trim, depthOrder,
  }
}

// ---------------------------------------------------------------- the pool (port of _pool)

export class Infeasible extends Error {}

/** The pool for `packs` packs and `chars` characters: one count per type (recipe order), and per node. Exactly
 *  RecipeCompiler._pool. */
export function poolOf(p: Plan, packs: bigint, chars = 1n): { counts: bigint[]; sums: bigint[] } {
  const n = packs * BigInt(p.S)
  const c = new Array<bigint>(p.T).fill(0n)
  let used = 0n
  for (let t = 0; t < p.T; t++) {
    if (t === p.filler) continue
    let x: bigint
    if (p.supply[t] === 'share') x = (p.amount[t] * n + SHARE_SCALE / 2n) / SHARE_SCALE
    else if (p.supply[t] === 'perPack') x = p.amount[t] * packs
    else if (p.supply[t] === 'perCharacter') x = p.amount[t] * chars
    else x = p.amount[t]
    if (p.cap[t] !== 0n && x > p.cap[t] * packs) x = p.cap[t] * packs
    c[t] = x
    used += x
  }
  c[p.filler] = n - used
  const nn = p.nodes.length
  const sums = new Array<bigint>(nn).fill(0n)
  for (let t = 0; t < p.T; t++) for (let x = p.inner[t]; ; x = p.nodes[x].parent) { sums[x] += c[t]; if (x === 0) break }
  const need = (x: number) => packs * BigInt(p.nodes[x].k)

  const move = (from: number, to: number, amt: bigint) => {
    c[from] -= amt
    c[to] += amt
    const a = p.inner[from]
    const b = p.inner[to]
    let x = a
    let y = b
    while (p.nodes[x].depth > p.nodes[y].depth) x = p.nodes[x].parent
    while (p.nodes[y].depth > p.nodes[x].depth) y = p.nodes[y].parent
    while (x !== y) { x = p.nodes[x].parent; y = p.nodes[y].parent }
    for (let z = b; z !== x; z = p.nodes[z].parent) sums[z] += amt
    for (let z = a; z !== x; z = p.nodes[z].parent) sums[z] -= amt
  }
  const inNode = (t: number, a: number) => {
    let x = p.inner[t]
    while (x !== a) { if (x === 0) return false; x = p.nodes[x].parent }
    return true
  }
  const spare = (t: number) => {
    let amt = c[t]
    for (let x = p.inner[t]; !p.nodes[x].holdsFiller; x = p.nodes[x].parent) {
      const s = sums[x] - need(x)
      if (s < amt) amt = s
    }
    return amt
  }
  const pull = (a: number | null, deficit: bigint) => {
    for (const t of p.trim) {
      if (a !== null && inNode(t, a)) continue
      let amt = spare(t)
      if (amt <= 0n) continue
      if (amt > deficit) amt = deficit
      move(t, p.filler, amt)
      deficit -= amt
      if (deficit === 0n) return
    }
    throw new Infeasible('nothing left to take back')
  }
  // top up sets without the filler, deepest first
  for (const x of p.depthOrder) {
    if (p.nodes[x].holdsFiller) continue
    const short = need(x) - sums[x]
    if (short > 0n) move(p.filler, p.nodes[x].lowest, short)
  }
  // take back into sets holding the filler, from the filler up
  const fi = p.inner[p.filler]
  if (p.nodes[fi].single < 0 && c[p.filler] < 0n) pull(null, -c[p.filler])
  for (let x = fi; ; x = p.nodes[x].parent) {
    const short = need(x) - sums[x]
    if (short > 0n) pull(x, short)
    if (x === 0) break
  }
  for (const v of c) if (v < 0n) throw new Infeasible('a type went below 0')
  for (let x = 0; x < nn; x++) if (sums[x] < need(x)) throw new Infeasible('a slot set is short')
  // a per-character type is exact: a set topped up past amount x characters would deal some character twice
  for (let t = 0; t < c.length; t++) if (p.supply[t] === 'perCharacter' && c[t] > p.amount[t] * chars) throw new Infeasible('a per-character type would be dealt more than once per character')
  return { counts: c, sums }
}

/** RecipeDealer.previewPool: the pool a (valid) recipe gives for `packs` packs and `chars` characters. */
export function previewPool(r: Recipe, packs: number | bigint, chars: number | bigint = 1): bigint[] {
  return poolOf(compileRecipe(r), BigInt(packs), BigInt(chars)).counts
}

/** A warning when a Series has too many characters for its pack count: per-character types (Gold, Full Art) then
 *  crowd out the cheaper rare types and the rarity order breaks (e.g. more Gold than Coal), or a cheaper rare type
 *  disappears. The dealer caps `maxPerPack` over the whole Series, not per pack. Null when the order holds. */
export function castWarning(r: Recipe, counts: bigint[]): string | null {
  for (let i = 0; i < r.types.length; i++) {
    if (r.types[i].supply !== 'perCharacter') continue
    for (let j = 0; j < r.types.length; j++) {
      const lower = r.types[j]
      if (j === i || lower.supply === 'perCharacter' || lower.supply === 'filler' || lower.rank >= r.types[i].rank || lower.rank === 0) continue
      if (counts[j] === 0n || counts[i] > counts[j]) {
        return `Too many characters for this many packs: ${counts[i]} ${r.types[i].name} vs ${counts[j]} ${lower.name}. Use fewer characters or more packs.`
      }
    }
  }
  return null
}

/** What each type's rule alone gives (cap applied, filler the rest), before the floor: to show what the floor moved. */
export function rulePool(r: Recipe, packs: bigint, chars = 1n): bigint[] {
  const p = compileRecipe(r)
  const n = packs * BigInt(p.S)
  let used = 0n
  const c = p.amount.map((amt, t) => {
    if (t === p.filler) return 0n
    let x = p.supply[t] === 'share' ? (amt * n + SHARE_SCALE / 2n) / SHARE_SCALE : p.supply[t] === 'perPack' ? amt * packs
      : p.supply[t] === 'perCharacter' ? amt * chars : amt
    if (p.cap[t] !== 0n && x > p.cap[t] * packs) x = p.cap[t] * packs
    used += x
    return x
  })
  c[p.filler] = n - used
  return c
}

// ---------------------------------------------------------------- holo

/** Chance of none / frame / picture / full for a type in a slot that doesn't require holo (RecipeDealer.holoOdds), as
 *  fractions. */
export function holoOdds(t: CardTypeDef): [number, number, number, number] {
  if (t.holo.mode === 'independent') {
    const a = Number(parseUint(t.holo.frame) ?? 0n) / 1e18
    const b = Number(parseUint(t.holo.picture) ?? 0n) / 1e18
    return [(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b]
  }
  const w = t.holo.weights.map((x) => Number(parseUint(x) ?? 0n))
  const total = w.reduce((s, x) => s + x, 0) || 1
  return w.map((x) => x / total) as [number, number, number, number]
}

/** The same, given the card is holo (a must-holo slot). */
export function holoOddsGivenHolo(t: CardTypeDef): [number, number, number, number] {
  const o = holoOdds(t)
  const h = o[1] + o[2] + o[3]
  return h > 0 ? [0, o[1] / h, o[2] / h, o[3] / h] : [1, 0, 0, 0]
}

/** Which holo looks a type's cards can come out as in this recipe: 'none' only if some slot that can deal it doesn't
 *  require holo and its odds allow none. The image grid builds exactly these. */
export function holoLooksFor(r: Recipe, typeIndex: number): HoloType[] {
  const t = r.types[typeIndex]
  const exact = (() => {
    if (t.holo.mode === 'independent') {
      const a = parseUint(t.holo.frame) ?? 0n
      const b = parseUint(t.holo.picture) ?? 0n
      return { none: a < HOLO_ONE && b < HOLO_ONE, frame: a > 0n && b < HOLO_ONE, picture: a < HOLO_ONE && b > 0n, full: a > 0n && b > 0n }
    }
    const w = t.holo.weights.map((x) => (parseUint(x) ?? 0n) > 0n)
    return { none: w[0], frame: w[1], picture: w[2], full: w[3] }
  })()
  const plainSlot = r.slots.some((s) => !s.mustHolo && slotTypeIndexes(r, s).includes(typeIndex))
  return HOLO_TYPES.filter((h) => (h === 'none' ? exact.none && plainSlot : exact[h]))
}

// ---------------------------------------------------------------- recipe.json (ConfigureSeries.s.sol)

export interface RecipeJson {
  fire: number
  imagesBase?: string
  types: ({ name: string; slug: string; rank: number; supply: Supply; amount?: number | string; maxPerPack?: number | string; holo: { mode: 'independent'; frame: string; picture: string } | { mode: 'distribution'; weights: string[] } })[]
  slots: ({ count: number; types?: number[]; minRank?: number; maxRank?: number; mustHolo?: boolean })[]
  characters: { name: string; category: string }[]
  /** FireSale.configureDrop's settings (sale.ts saleJson). */
  sale?: SaleJson
}

const num = (v: bigint): number | string => (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString())

/** The recipe.json ConfigureSeries.s.sol reads (shape in docs/cards-contracts.md). Characters in image order. */
export function recipeJson(fire: number, r: Recipe, characters: { name: string; category: string }[], imagesBase?: string, sale?: SaleJson): RecipeJson {
  return {
    fire,
    ...(imagesBase ? { imagesBase } : {}),
    types: r.types.map((t) => {
      const cap = parseUint(t.maxPerPack) ?? 0n
      return {
        name: t.name, slug: t.slug, rank: t.rank, supply: t.supply,
        ...(t.supply !== 'filler' ? { amount: num(parseUint(t.amount) ?? 0n) } : {}),
        ...(cap > 0n ? { maxPerPack: num(cap) } : {}),
        holo: t.holo.mode === 'independent'
          ? { mode: 'independent' as const, frame: String(parseUint(t.holo.frame)), picture: String(parseUint(t.holo.picture)) }
          : { mode: 'distribution' as const, weights: t.holo.weights.map((w) => String(parseUint(w))) },
      }
    }),
    slots: r.slots.map((s) => {
      if (s.kind === 'types') return { count: s.count, types: slotTypeIndexes(r, s), ...(s.mustHolo ? { mustHolo: true } : {}) }
      return { count: s.count, minRank: s.minRank, ...(s.maxRank != null ? { maxRank: s.maxRank } : {}), ...(s.mustHolo ? { mustHolo: true } : {}) }
    }),
    characters,
    ...(sale ? { sale } : {}),
  }
}

/** Read a recipe.json back (for tests and for copying a recipe in). Frame sets default to the type's slug. */
export function recipeFromJson(j: RecipeJson, frameSetOf: (slug: string) => string = (s) => s): Recipe {
  const ids = j.types.map((_, i) => `t${i}`)
  return {
    types: j.types.map((t, i) => ({
      id: ids[i], name: t.name, slug: t.slug, slugEdited: t.slug !== slugify(t.name), rank: t.rank, supply: t.supply,
      amount: String(t.amount ?? 0), maxPerPack: String(t.maxPerPack ?? 0),
      holo: t.holo.mode === 'independent' ? { mode: 'independent', frame: String(t.holo.frame), picture: String(t.holo.picture) }
        : { mode: 'distribution', weights: t.holo.weights.map(String) as [string, string, string, string] },
      frameSet: frameSetOf(t.slug),
    })),
    slots: j.slots.map((s) => (s.types && s.types.length
      ? { count: s.count, kind: 'types' as const, typeIds: s.types.map((i) => ids[i]), minRank: 0, maxRank: null, mustHolo: !!s.mustHolo }
      : { count: s.count, kind: 'rank' as const, typeIds: [], minRank: s.minRank ?? 0, maxRank: s.maxRank ?? null, mustHolo: !!s.mustHolo })),
  }
}

/** The Standard frame sets by slug (Fire uses the 'burning' frames, Coal the 'charcoal' ones). */
export const STANDARD_FRAME_SET: Record<string, string> = {
  paper: 'paper', wood: 'wood', fire: 'burning', coal: 'charcoal', gold: 'gold', fullart: 'fullart', diamond: 'diamond',
}

/** A short fingerprint of everything in the recipe that changes which images exist or what they show. */
export function recipeGridKey(r: Recipe): string {
  return JSON.stringify(r.types.map((t, i) => [t.slug, t.name, t.frameSet, holoLooksFor(r, i)]))
}
