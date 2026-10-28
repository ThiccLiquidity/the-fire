/** A Series' recipe: its card types and its pack's shape (slots, each with its own odds). This is the studio's copy of
 *  RecipeDealer.Recipe (contracts/src/cards/RecipeDealer.sol) plus what only the studio needs (each type's frame set).
 *
 *  Dealing: every pack has the same shape, its slots in order ("3 Paper · 1 Wood · 1 Wood or better · 1 Fire or
 *  better"). Every card is rolled on its own, its type by its slot's odds (each type's % of that slot's cards), then
 *  its holo by that type's holo odds, then its character by the character odds (none = every character equally
 *  likely). No pool, caps or guarantees beyond what the slots say: the first and the last pack of a Series have the
 *  same odds.
 *
 *  One per character (optional, the Standard's Full Art): one type in no slot, dealt exactly once per character per
 *  Series. As each pack starts, with chance (still owed) / (packs still to deal, this one included), the pack's first
 *  card becomes that type for a character still owed one (picked at random); the pack's other cards roll as always.
 *  So a Series of at least as many packs as characters ends with exactly one per character (RecipeDealer
 *  _onePerCharacter). Its odds need the Series' size: perPackCounts / typeOdds take it (SeriesSize).
 *
 *  - checkRecipe: every check RecipeCompiler.compile makes, in the same order (so the first problem is the contract's
 *    revert), plus the studio's own (number formats, each slot adding up to 100%).
 *  - slotOdds / perPackCounts / typeOdds / holoOdds / holoLooksFor: the odds the contract deals by.
 *  - recipeJson: the recipe.json that contracts/script/ConfigureSeries.s.sol reads.
 *
 *  The owner sets each slot's odds as plain percentages (up to 2 decimals, adding up to exactly 100% in each slot; blank
 *  or 0 = not in that slot). The contract takes whole-number weights: a percentage becomes percent x 10,000 (100% =
 *  1,000,000), with the zeros every weight of the slot shares dropped (simplifyWeights: same ratios, so the Standard's
 *  Fire-or-better slot exports 6732 / 1734 / 1534).
 *
 *  Numbers the contract stores above 2^53 (weights, holo chances) are kept as decimal strings. */

import { HOLO_TYPES, type HoloType } from './rules'
import type { SaleJson } from './sale'

/** Independent: frame and picture each rolled at a chance out of 1e18. Distribution: weights for none, frame,
 *  picture, full (any total above 0). */
export type HoloRule =
  | { mode: 'independent'; frame: string; picture: string }
  | { mode: 'distribution'; weights: [string, string, string, string] }

export interface CardTypeDef {
  /** Local id (stable across reordering). */
  id: string
  /** The "Material" trait and the first word of the card's name: 1-64 bytes, no `"`, `\` or control characters. */
  name: string
  /** Image file names: 1-32 bytes of [a-z0-9-], unique in the recipe. */
  slug: string
  /** Set once the slug is typed by hand; until then it follows the name. */
  slugEdited?: boolean
  /** Rarity order for display (higher = rarer); ties allowed. */
  rank: number
  holo: HoloRule
  /** The frame set (src/assets/frames/<set>.webp) and character art this type uses. */
  frameSet: string
}

/** `count` cards in a row of the pack, each rolled from this slot's odds. */
export interface SlotDef {
  /** Local id (stable across reordering). */
  id: string
  /** Cards in this slot, at least 1. */
  count: number
  /** Each type's % of this slot's cards, by type id: up to 2 decimals, adding up to exactly 100%. Missing, blank or 0 =
   *  never in this slot. */
  percents: Record<string, string>
  /** Exact odds (the contract's weights, by type id; missing = 0) kept from a save whose deal is locked, or read from a
   *  recipe.json: the studio deals and exports by these while every slot has them. Any edit to an open recipe drops
   *  them. */
  weights?: Record<string, string>
}

export interface Recipe {
  types: CardTypeDef[]
  /** The pack's shape, in pack order. Cards per pack = the counts added up (1 to MAX_CARDS_PER_PACK). */
  slots: SlotDef[]
  /** The type (by id) dealt exactly once per character per Series, in no slot (RecipeDealer.Recipe.onePerCharacter).
   *  Missing = none. */
  onePerCharacter?: string
}

/** A Series' size, for the odds that depend on it (the one-per-character type). */
export interface SeriesSize { packs: number; chars: number }

export const HOLO_ONE = 1_000_000_000_000_000_000n
export const UINT32_MAX = 0xffff_ffff
const U64 = (1n << 64n) - 1n
export const MAX_TYPE_NAME_BYTES = 64
export const MAX_SLUG_BYTES = 32
/** FireCards.MAX_CARDS_PER_PACK (RecipeCompiler refuses more). */
export const MAX_CARDS_PER_PACK = 1000
/** FirePsa's fresh odds (out of 10,000), grade 1 first: fixed forever, the same for every Series (docs/grading.md).
 *  10 1%, 9 30%, 8 40%, 7 29%; 1-6 come only from wear. Shown, never set or exported. */
export const FRESH_PDA_ODDS = [0, 0, 0, 0, 0, 0, 2700, 4000, 3000, 300] as const

// ---------------------------------------------------------------- presets

/** StandardRecipe.sol: holo roll chances 1 - sqrt(1 - rate) for 5 / 10 / 50 / 90%, at 1e18. */
export const STANDARD_ROLLS = {
  paper: '25320565519103609',
  wood: '51316701949486200',
  fire: '292893218813452475',
  coal: '683772233983162066',
} as const

/** StandardRecipe.sol's slots, as the owner sets them (% of each slot's cards). Per pack on average: 3 Paper (less the
 *  Full Arts that take a Paper's place), 1.494 Wood, 0.9732 Fire, 0.2934 Coal, 0.2394 Gold. Full Art is in no slot:
 *  exactly one per character per Series (its old 4.5% and 7.5% went to Wood and Fire; Coal and Gold unchanged). */
export const STANDARD_SLOTS: { id: string; count: number; percents: Record<string, string> }[] = [
  { id: 'paper', count: 3, percents: { paper: '100' } },
  { id: 'wood', count: 1, percents: { wood: '100' } },
  { id: 'wood-up', count: 1, percents: { wood: '49.4', fire: '30', coal: '12', gold: '8.6' } },
  { id: 'fire-up', count: 1, percents: { fire: '67.32', coal: '17.34', gold: '15.34' } },
]
/** The weights StandardRecipe.sol has, per slot (recipe type order: paper, wood, fire, coal, gold, fullart). */
export const STANDARD_SLOT_WEIGHTS = [['1', '0', '0', '0', '0', '0'], ['0', '1', '0', '0', '0', '0'], ['0', '494', '300', '120', '86', '0'], ['0', '0', '6732', '1734', '1534', '0']] as const

const ind = (roll: string): HoloRule => ({ mode: 'independent', frame: roll, picture: roll })

const fullHolo = (): HoloRule => ({ mode: 'distribution', weights: ['0', '0', '0', '1'] })

/** One slot holding every type of the list, at these percentages (by type id). */
const oneSlot = (count: number, percents: Record<string, string>, weights?: Record<string, string>): SlotDef => ({ id: 'all', count, percents, ...(weights ? { weights } : {}) })

/** Exactly StandardRecipe.build(): 6 cards a pack in four slots: 3 Paper · 1 Wood · 1 Wood or better (Wood 49.4%, Fire
 *  30%, Coal 12%, Gold 8.6%) · 1 Fire or better (Fire 67.32%, Coal 17.34%, Gold 15.34%); Full Art one per character
 *  (in place of a Paper); Paper / Wood / Fire / Coal any holo 5 / 10 / 50 / 90% (two independent rolls), Gold and Full
 *  Art always full holo. */
export function standardRecipe(): Recipe {
  return {
    types: [
      { id: 'paper', name: 'Paper', slug: 'paper', rank: 0, holo: ind(STANDARD_ROLLS.paper), frameSet: 'paper' },
      { id: 'wood', name: 'Wood', slug: 'wood', rank: 1, holo: ind(STANDARD_ROLLS.wood), frameSet: 'wood' },
      { id: 'fire', name: 'Fire', slug: 'fire', rank: 2, holo: ind(STANDARD_ROLLS.fire), frameSet: 'burning' },
      { id: 'coal', name: 'Coal', slug: 'coal', rank: 3, holo: ind(STANDARD_ROLLS.coal), frameSet: 'charcoal' },
      { id: 'gold', name: 'Gold', slug: 'gold', rank: 4, holo: fullHolo(), frameSet: 'gold' },
      { id: 'fullart', name: 'Full Art', slug: 'fullart', rank: 5, holo: fullHolo(), frameSet: 'fullart' },
    ],
    slots: STANDARD_SLOTS.map((sl) => ({ ...sl, percents: { ...sl.percents } })),
    onePerCharacter: 'fullart',
  }
}

/** The Standard as it was before Full Art became one per character (Full Art 4.5% of Wood or better, 7.5% of Fire or
 *  better; Wood 44.9%, Fire 59.82%). migrate.ts moves an open Series still on exactly this to the new Standard. */
export function oldStandardRecipe(): Recipe {
  const { onePerCharacter: _none, ...r } = standardRecipe()
  r.slots[2].percents = { wood: '44.9', fire: '30', coal: '12', gold: '8.6', fullart: '4.5' }
  r.slots[3].percents = { fire: '59.82', coal: '17.34', gold: '15.34', fullart: '7.5' }
  return r
}

/** The recipe Series saved before Gold had: the old Standard with Diamond (frame / picture / full, a third each), at
 *  the old pool's shares for a 167-pack Series with one Diamond (501 Paper, 301 Wood, 150 Fire, 49 Coal, 1 Diamond of
 *  1,002), in one slot of 6. Only migrate.ts uses it, so old saves keep their cards and images. */
export function legacyDiamondRecipe(): Recipe {
  return withPercentsFromWeights({
    types: [
      { id: 'paper', name: 'Paper', slug: 'paper', rank: 0, holo: ind(STANDARD_ROLLS.paper), frameSet: 'paper' },
      { id: 'wood', name: 'Wood', slug: 'wood', rank: 1, holo: ind(STANDARD_ROLLS.wood), frameSet: 'wood' },
      { id: 'fire', name: 'Fire', slug: 'fire', rank: 2, holo: ind(STANDARD_ROLLS.fire), frameSet: 'burning' },
      { id: 'coal', name: 'Coal', slug: 'coal', rank: 3, holo: ind(STANDARD_ROLLS.coal), frameSet: 'charcoal' },
      { id: 'diamond', name: 'Diamond', slug: 'diamond', rank: 4, holo: { mode: 'distribution', weights: ['0', '1', '1', '1'] }, frameSet: 'diamond' },
    ],
    slots: [oneSlot(6, {}, { paper: '501', wood: '301', fire: '150', coal: '49', diamond: '1' })],
  })
}

/** An example special Series: 3 cards per pack in one slot, every card holo (frame, picture or full, a third each;
 *  Gold always full), so no "none" images are built. Fire 68%, Coal 30%, Gold 2% per card. */
export function specialAllHoloRecipe(): Recipe {
  const anyHolo = (): HoloRule => ({ mode: 'distribution', weights: ['0', '1', '1', '1'] })
  return {
    types: [
      { id: 'fire', name: 'Fire', slug: 'fire', rank: 2, holo: anyHolo(), frameSet: 'burning' },
      { id: 'coal', name: 'Coal', slug: 'coal', rank: 3, holo: anyHolo(), frameSet: 'charcoal' },
      { id: 'gold', name: 'Gold', slug: 'gold', rank: 4, holo: fullHolo(), frameSet: 'gold' },
    ],
    slots: [oneSlot(3, { fire: '68', coal: '30', gold: '2' })],
  }
}

/** A fresh copy with new type and slot ids, set by its percentages (exact weights from an old save are not copied). */
export function cloneRecipe(r: Recipe, newId: () => string): Recipe {
  const ids = new Map(r.types.map((t) => [t.id, newId()]))
  const remap = (rec: Record<string, string>) => Object.fromEntries(Object.entries(rec).flatMap(([k, v]) => (ids.has(k) ? [[ids.get(k)!, v]] : [])))
  return {
    types: r.types.map((t) => ({ ...t, id: ids.get(t.id)!, holo: t.holo.mode === 'independent' ? { ...t.holo } : { mode: 'distribution', weights: [...t.holo.weights] } })),
    slots: r.slots.map((sl) => ({ id: newId(), count: sl.count, percents: remap(sl.percents) })),
    ...(r.onePerCharacter && ids.has(r.onePerCharacter) ? { onePerCharacter: ids.get(r.onePerCharacter)! } : {}),
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

// ---------------------------------------------------------------- percentages (the owner's odds) and weights

/** Weight per 1%: a percentage becomes percent x 10,000, so 100% = 1,000,000 (0.01% = 100). */
export const WEIGHT_PER_PERCENT = 10_000n
export const WEIGHT_TOTAL = 100n * WEIGHT_PER_PERCENT
/** 100% in hundredths of a percent (the smallest step the owner can type). */
const ALL = 10_000

/** "24.15" to hundredths of a percent (2415). null unless 0 to 100 with at most 2 decimals. */
export function parsePercent(text: string | undefined): number | null {
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec((text ?? '').trim())
  if (!m) return null
  const v = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return v <= ALL ? v : null
}

/** Hundredths of a percent as the owner reads it: 2415 = "24.15", 5000 = "50", 390 = "3.9". */
export function formatPercent(hundredths: number): string {
  const neg = hundredths < 0
  const a = Math.abs(Math.round(hundredths))
  const frac = String(a % 100).padStart(2, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${Math.floor(a / 100)}${frac ? `.${frac}` : ''}`
}

/** Percentages to weights: percent x 10,000 each (100% = 1,000,000). A percentage that isn't a number counts as 0. */
export function percentsToWeights(percents: readonly (string | undefined)[]): bigint[] {
  return percents.map((p) => BigInt(parsePercent(p) ?? 0) * (WEIGHT_PER_PERCENT / 100n))
}

/** The same weights with the zeros they all share dropped (divided by the biggest power of ten that divides every one):
 *  the same odds in smaller numbers. 500,000 / 241,500 / ... / 20,000 (Standard) = 5000 / 2415 / ... / 200. */
export function simplifyWeights(weights: readonly bigint[]): bigint[] {
  if (!weights.some((w) => w > 0n)) return [...weights]
  let d = 1n
  while (weights.every((w) => w % (d * 10n) === 0n)) d *= 10n
  return weights.map((w) => w / d)
}

/** Weights (any total) to percentages of at most 2 decimals that add up to exactly 100%: each rounded down, then the
 *  hundredths left over go to the biggest remainders. A weight above 0 never becomes 0% (it takes 0.01% from the
 *  biggest). All 0 (or none): every one "0". */
export function weightsToPercents(weights: readonly (bigint | number | string)[]): string[] {
  const w = weights.map((x) => { try { const b = BigInt(typeof x === 'number' ? Math.max(0, Math.floor(x)) : String(x).trim() || '0'); return b > 0n ? b : 0n } catch { return 0n } })
  const total = w.reduce((a, x) => a + x, 0n)
  if (total === 0n) return w.map(() => '0')
  const exact = w.map((x) => x * BigInt(ALL))
  const out = exact.map((x) => Number(x / total))
  let left = ALL - out.reduce((a, x) => a + x, 0)
  const order = exact.map((x, i) => ({ i, rem: x % total })).sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1))
  for (let k = 0; left > 0; k = (k + 1) % order.length) { out[order[k].i]++; left-- }
  w.forEach((x, i) => {
    if (x > 0n && out[i] === 0) {
      const big = out.reduce((b, v, j) => (v > out[b] ? j : b), 0)
      if (out[big] > 1) { out[big]--; out[i] = 1 }
    }
  })
  return out.map(formatPercent)
}

export interface PercentTotal {
  /** The total, in hundredths of a percent (10,000 = 100%), counting only the ones that are numbers. */
  total: number
  /** 100% - total (negative when over). */
  left: number
  /** Indexes that aren't a number from 0 to 100 with at most 2 decimals. */
  bad: number[]
  ok: boolean
}

export function percentTotal(percents: readonly (string | undefined)[]): PercentTotal {
  const bad: number[] = []
  let total = 0
  percents.forEach((p, i) => { const v = parsePercent(p); if (v == null) bad.push(i); else total += v })
  return { total, left: ALL - total, bad, ok: bad.length === 0 && total === ALL }
}

/** "96.01% · 3.99% left to assign" (or "1% over", or "all assigned"). */
export function percentTotalLine(t: PercentTotal): string {
  const tail = t.left === 0 ? 'all assigned' : t.left > 0 ? `${formatPercent(t.left)}% left to assign` : `${formatPercent(-t.left)}% over`
  return `Total ${formatPercent(t.total)}% · ${tail}`
}

/** The problem with a total that isn't exactly 100% (null when it is). `what` names the list: "The card types". */
export function percentTotalProblem(t: PercentTotal, what: string): string | null {
  if (t.left === 0) return null
  return t.left > 0
    ? `${what} add up to ${formatPercent(t.total)}%: they must add up to exactly 100% (${formatPercent(t.left)}% left to assign).`
    : `${what} add up to ${formatPercent(t.total)}%: they must add up to exactly 100% (${formatPercent(-t.left)}% too much).`
}

/** The one-click fix: the one with the biggest share takes what's left (or gives up the extra), never the one the
 *  owner just edited (`lastEdited`, when there are others: the fix would undo that edit). Its index and new
 *  percentage, or null when the total is already 100%, a percentage isn't a number, or the fix would leave it at 0 or
 *  below. */
export function fillTheRest(percents: readonly (string | undefined)[], lastEdited?: number): { index: number; percent: string } | null {
  const t = percentTotal(percents)
  if (t.bad.length || t.left === 0 || !percents.length) return null
  const vals = percents.map((p) => parsePercent(p) ?? 0)
  const skip = lastEdited !== undefined && lastEdited >= 0 && lastEdited < vals.length && vals.length > 1 ? lastEdited : -1
  const index = vals.reduce((b, v, j) => (j === skip ? b : b === skip || v > vals[b] ? j : b), skip === 0 ? 1 : 0)
  const next = vals[index] + t.left
  return next > 0 && next <= ALL ? { index, percent: formatPercent(next) } : null
}

// ---------------------------------------------------------------- slots

/** A slot's percentage for each type, in recipe order ('' where the type isn't in the slot). */
export function slotPercents(r: Recipe, sl: SlotDef): string[] {
  return r.types.map((t) => (sl.percents[t.id] ?? '').trim())
}

/** Blank counts as 0% (not in this slot). */
const p0 = (x: string) => (x === '' ? '0' : x)

/** Whether a slot deals by exact weights (from a locked old save or a recipe.json) rather than by its percentages. */
const slotExact = (sl: SlotDef) => sl.weights !== undefined

/** Whether the recipe deals by exact weights (every slot has them) rather than by its percentages. */
export const hasExactWeights = (r: Recipe) => r.slots.length > 0 && r.slots.every(slotExact)

/** A recipe whose slots carry exact weights, with each slot's percentages filled in from them (adding up to 100% per
 *  slot; a type with weight 0 has no percentage). */
export function withPercentsFromWeights(r: Recipe): Recipe {
  return {
    ...r,
    slots: r.slots.map((sl) => {
      if (!sl.weights) return sl
      const w = r.types.map((t) => sl.weights?.[t.id] ?? '0')
      const p = weightsToPercents(w)
      return { ...sl, percents: Object.fromEntries(r.types.flatMap((t, i) => ((parseUint(w[i]) ?? 0n) > 0n ? [[t.id, p[i]]] : []))) }
    }),
  }
}

/** The recipe set by its percentages only (exact weights dropped). */
export function dropExactWeights(r: Recipe): Recipe {
  return r.slots.some(slotExact) ? { ...r, slots: r.slots.map(({ weights: _exact, ...sl }) => sl) } : r
}

/** Which types a slot can deal (weight above 0), in recipe order. */
export function slotTypes(r: Recipe, s: number): number[] {
  const w = slotWeights(r)[s]?.weights ?? []
  return w.flatMap((x, i) => (x > 0n ? [i] : []))
}

/** A slot as people read it: "Paper", "Wood or better" (every type from the lowest rank it holds up), else its types
 *  ("Fire or Gold"). The site's pack row says the same (info.js slotLabel). */
export function slotLabel(r: Recipe, s: number): string {
  const ts = slotTypes(r, s)
  if (!ts.length) return 'nothing'
  const name = (i: number) => r.types[i].name || `Type ${i + 1}`
  if (ts.length === 1) return name(ts[0])
  const low = Math.min(...ts.map((i) => r.types[i].rank))
  // the one-per-character type is in no slot: "or better" leaves it out
  const one = onePerIndex(r)
  const upFrom = r.types.flatMap((t, i) => (t.rank >= low && i !== one ? [i] : []))
  if (upFrom.length === ts.length && upFrom.every((i) => ts.includes(i))) {
    const first = ts.filter((i) => r.types[i].rank === low)
    if (first.length === 1) return `${name(first[0])} or better`
  }
  return ts.map(name).join(', ').replace(/, ([^,]*)$/, ' or $1')
}

/** "3 Paper · 1 Wood · 1 Wood or better · 1 Fire or better". */
export function packShapeLine(r: Recipe): string {
  return r.slots.map((sl, s) => `${sl.count} ${slotLabel(r, s)}`).join(' · ')
}

// ---------------------------------------------------------------- one per character

/** The one-per-character type's index (-1 = none, or its id names no type). */
export function onePerIndex(r: Recipe): number {
  return r.onePerCharacter ? r.types.findIndex((t) => t.id === r.onePerCharacter) : -1
}

/** Cards of the one-per-character type a Series deals: one per character, at most one per pack (so all of them only
 *  when packs >= characters). */
export function onePerCharacterCount(size: SeriesSize): number {
  return Math.max(0, Math.min(Math.floor(size.packs) || 0, Math.floor(size.chars) || 0))
}

/** The chance a pack's first card is the one-per-character card (averaged over the Series' packs): its count / packs. */
export function onePerPackChance(r: Recipe, size?: SeriesSize): number {
  if (onePerIndex(r) < 0 || !size || !(size.packs > 0)) return 0
  return onePerCharacterCount(size) / size.packs
}

/** The slot of a pack's first card (the one the one-per-character card replaces). */
export function firstCardSlot(r: Recipe): number {
  return r.slots.findIndex((sl) => Number.isFinite(sl.count) && sl.count > 0)
}

/** The one-per-character type marked or cleared. Marking takes it out of every slot (the contract refuses it in one):
 *  its share of a slot goes to the slot's lowest-rank other type (as the Standard's Full Art share went to Wood and
 *  Fire), so each slot still adds up to 100%. Exact weights are dropped (the recipe is set by its percentages). */
export function setOnePerCharacter(r: Recipe, typeId: string | null): Recipe {
  if (!typeId) { const { onePerCharacter: _off, ...rest } = r; return rest }
  const t = r.types.find((x) => x.id === typeId)
  if (!t) return r
  const slots = dropExactWeights(r).slots.map((sl) => {
    const share = parsePercent(sl.percents[typeId])
    const { [typeId]: _gone, ...percents } = sl.percents
    if (share) {
      const others = r.types.filter((x) => x.id !== typeId && (parsePercent(percents[x.id]) ?? 0) > 0)
      const to = others.sort((a, b) => a.rank - b.rank)[0]
      if (to) percents[to.id] = formatPercent((parsePercent(percents[to.id]) ?? 0) + share)
    }
    return { ...sl, percents }
  })
  return { ...r, slots, onePerCharacter: typeId }
}

// ---------------------------------------------------------------- checks

export interface Problem {
  /** The contract's error ('BadType(i,why)', 'BadSlot(s,why)', 'BadRecipe(why)', 'BadText') or 'Studio' for the
   *  studio's own checks. */
  code: string
  /** 'total': a slot's percentages don't add up to 100% (index = the slot). */
  where: 'recipe' | 'type' | 'slot' | 'total'
  index?: number
  message: string
}

/** Cards per pack: the slots' counts added up. */
export function cardsPerPack(r: Recipe): number {
  return r.slots.reduce((n, sl) => n + (Number.isFinite(sl.count) ? sl.count : 0), 0)
}

function badText(s: string): boolean {
  // JS strings are always valid UTF-8 once encoded, except lone surrogates: the contract refuses those too
  return /["\\\u0000-\u001f\u007f]/.test(s) || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s)
}

const typeLabel = (r: Recipe, i: number) => `Type ${i + 1}${r.types[i]?.name ? ` (${r.types[i].name})` : ''}`
export const slotName = (s: number) => `Slot ${s + 1}`

/** Studio-side format checks: every number is a whole number in its on-chain range. */
function formatProblems(r: Recipe): Problem[] {
  const out: Problem[] = []
  const typeP = (i: number, message: string) => out.push({ code: 'Studio', where: 'type', index: i, message: `${typeLabel(r, i)}: ${message}` })
  const slotP = (s: number, message: string) => out.push({ code: 'Studio', where: 'slot', index: s, message: `${slotName(s)}: ${message}` })
  r.types.forEach((t, i) => {
    if (!Number.isInteger(t.rank) || t.rank < 0 || t.rank > UINT32_MAX) typeP(i, 'rank must be a whole number from 0 to 4,294,967,295.')
    if (t.holo.mode === 'independent') {
      for (const [k, v] of [['frame', t.holo.frame], ['picture', t.holo.picture]] as const) {
        const x = parseUint(v)
        if (x == null || x > U64) typeP(i, `holo ${k} chance is not a valid number.`)
      }
    } else {
      if (t.holo.weights.length !== 4 || t.holo.weights.some((w) => { const x = parseUint(w); return x == null || x > U64 })) typeP(i, 'holo weights must be 4 whole numbers.')
    }
  })
  r.slots.forEach((sl, s) => {
    if (!Number.isInteger(sl.count) || sl.count < 0 || sl.count > UINT32_MAX) slotP(s, 'cards must be a whole number.')
    if (slotExact(sl)) {
      if (r.types.some((t) => { const w = parseUint(sl.weights?.[t.id] ?? '0'); return w == null || w > U64 })) slotP(s, 'its odds are not valid whole numbers.')
    } else {
      const bad = slotPercents(r, sl).flatMap((x, i) => (parsePercent(p0(x)) == null ? [i] : []))
      if (bad.length) slotP(s, `% of this slot must be a number from 0 to 100, with at most 2 decimals (${bad.map((i) => r.types[i].name || typeLabel(r, i)).join(', ')}).`)
    }
  })
  return out
}

/** Every problem with a recipe. The contract's checks come in the contract's order (RecipeCompiler.compile), so the
 *  first contract problem is the one RecipeDealer.check reverts with. Studio format problems come first (the contract
 *  couldn't even take the recipe). */
export function checkRecipe(r: Recipe): Problem[] {
  const out = formatProblems(r)
  if (out.length) return out
  const T = r.types.length
  const typeP = (i: number, why: string, message: string, code = 'BadType') => out.push({ code: code === 'BadType' ? `BadType(${i},${why})` : code, where: 'type', index: i, message: `${typeLabel(r, i)}: ${message}` })
  const slotP = (s: number, why: string, message: string) => out.push({ code: `BadSlot(${s},${why})`, where: 'slot', index: s, message: `${slotName(s)}: ${message}` })
  if (T === 0 || T > UINT32_MAX) { out.push({ code: 'BadRecipe(no types)', where: 'recipe', message: 'Add at least one card type.' }); return out }
  if (r.slots.length === 0) { out.push({ code: 'BadRecipe(no slots)', where: 'recipe', message: 'Add at least one slot.' }); return out }
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
    if (t.holo.mode === 'independent') {
      if (parseUint(t.holo.frame)! > HOLO_ONE || parseUint(t.holo.picture)! > HOLO_ONE) typeP(i, 'holo chances', 'a holo chance is above 100%.')
    } else if (t.holo.weights.reduce((a, w) => a + parseUint(w)!, 0n) === 0n) {
      typeP(i, 'holo weights', 'the holo split adds up to 0 (give at least one look a part).')
    }
  })
  const sw = slotWeights(r)
  const exact = hasExactWeights(r)
  const one = onePerIndex(r)
  if (r.onePerCharacter !== undefined && one < 0) {
    out.push({ code: 'BadRecipe(one per character)', where: 'recipe', message: 'The one-per-character type is not one of the card types.' })
  }
  let perPack = 0
  for (let s = 0; s < r.slots.length; s++) {
    const sl = r.slots[s]
    if (sl.count === 0) slotP(s, 'count', 'give it at least 1 card (remove the slot to leave it out).')
    perPack += sl.count
    if (perPack > MAX_CARDS_PER_PACK) {
      out.push({ code: 'BadRecipe(cards per pack)', where: 'recipe', message: `Cards per pack (the slots' cards added up) must be 1 to ${MAX_CARDS_PER_PACK.toLocaleString('en-US')}: it's ${cardsPerPack(r).toLocaleString('en-US')}.` })
      break
    }
    if (one >= 0 && sw[s].weights[one] > 0n) slotP(s, 'one-per-character type in a slot', `${r.types[one].name || 'the one-per-character type'} is one per character: take it out of this slot (give it 0%).`)
    if (sw[s].total === 0n) slotP(s, 'weights', exact ? 'its odds add up to 0.' : 'give at least one type a % of this slot.')
  }
  const dealt = new Set(sw.flatMap((x) => x.weights.flatMap((w, i) => (w > 0n ? [i] : []))))
  if (one >= 0) dealt.add(one) // dealt once per character, in no slot
  r.types.forEach((t, i) => {
    if (!dealt.has(i)) typeP(i, 'in no slot', `no slot deals ${t.name || 'it'}: give it a % in a slot, or remove the type.`)
  })
  // each slot's percentages must add up to exactly 100% (the contract would take any total: this is the studio's rule)
  r.slots.forEach((sl, s) => {
    if (slotExact(sl)) return
    const t = percentTotal(slotPercents(r, sl).map(p0))
    if (t.total === 0) return // reported above (no type in the slot)
    const msg = percentTotalProblem(t, `${slotName(s)}'s types`)
    if (msg) out.push({ code: 'Studio', where: 'total', index: s, message: msg })
  })
  return out
}

/** Problems the contract itself would reject (RecipeDealer.check / setRecipe). */
export function contractProblems(problems: Problem[]): Problem[] {
  return problems.filter((p) => p.code !== 'Studio')
}

// ---------------------------------------------------------------- odds

/** Each slot's weight for each type (recipe order, BigInt; 0 = not in the slot) and their total: what the contract
 *  gets. From the percentages (percent x 10,000, simplified per slot), or the exact weights a locked old save or a
 *  recipe.json carries. */
export function slotWeights(r: Recipe): { count: number; weights: bigint[]; total: bigint }[] {
  return r.slots.map((sl) => {
    const weights = slotExact(sl)
      ? r.types.map((t) => parseUint(sl.weights?.[t.id] ?? '0') ?? 0n)
      : simplifyWeights(percentsToWeights(slotPercents(r, sl).map(p0)))
    return { count: Number.isFinite(sl.count) ? Math.max(0, sl.count) : 0, weights, total: weights.reduce((a, w) => a + w, 0n) }
  })
}

/** Each slot's chance of each type for one of its cards (RecipeDealer.slotsOf: its weight over the slot's total). */
export function slotOdds(r: Recipe): number[][] {
  return slotWeights(r).map(({ weights, total }) => weights.map((w) => (total > 0n ? Number((w * 1_000_000_000_000n) / total) / 1e12 : 0)))
}

/** Expected cards of each type in one pack (recipe order): the sum over the slots of count x the slot's odds. With a
 *  one-per-character type and the Series' size: that type gets its count / packs, taken from the first card's slot
 *  (the first card's types each lose that share of their odds). Without the size: the slots only. */
export function perPackCounts(r: Recipe, size?: SeriesSize): number[] {
  const odds = slotOdds(r)
  const out = r.types.map((_, t) => r.slots.reduce((a, sl, s) => a + (Number.isFinite(sl.count) ? sl.count : 0) * (odds[s][t] ?? 0), 0))
  const f = onePerPackChance(r, size)
  const s0 = firstCardSlot(r)
  if (f > 0 && s0 >= 0) {
    out.forEach((_, t) => { out[t] -= f * (odds[s0][t] ?? 0) })
    out[onePerIndex(r)] += f
  }
  return out
}

/** Each type's share of all cards (recipe order): its expected cards per pack over cards per pack. The chance a card
 *  picked at random from a Series is that type (the site's "about 1 in N cards"). */
export function typeOdds(r: Recipe, size?: SeriesSize): number[] {
  const S = cardsPerPack(r)
  return perPackCounts(r, size).map((x) => (S > 0 ? x / S : 0))
}

/** Each character's chance per card, from its weight (missing or no weights: equal). RecipeDealer.characterOddsOf. */
export function characterOdds(weights: readonly number[] | undefined, chars: number): number[] {
  const n = Math.max(0, Math.floor(chars))
  const w = Array.from({ length: n }, (_, i) => (weights && weights.length === n ? Math.max(0, weights[i] ?? 0) : 1))
  const total = w.reduce((a, x) => a + x, 0)
  return w.map((x) => (total > 0 ? x / total : 0))
}

/** Chance of none / frame / picture / full for a card of a type (RecipeDealer.holoOdds), as fractions. */
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

/** Which holo looks a type's cards can come out as: exactly the looks its holo odds allow. The image grid builds
 *  exactly these. */
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
  return HOLO_TYPES.filter((h) => exact[h])
}

// ---------------------------------------------------------------- recipe.json (ConfigureSeries.s.sol)

export interface RecipeJsonCharacter { name: string; category: string; weight?: number | string }

export interface RecipeJsonSlot {
  count: number
  /** The slot's weight for each type it can deal, by slug (a type left out: never in this slot). */
  weights: Record<string, number | string>
}

export interface RecipeJson {
  fire: number
  imagesBase?: string
  types: ({ name: string; slug: string; rank: number; holo: { mode: 'independent'; frame: string; picture: string } | { mode: 'distribution'; weights: string[] } })[]
  /** The pack's shape, in pack order (cards per pack = the counts added up). */
  slots: RecipeJsonSlot[]
  /** The slug of the type dealt exactly once per character per Series (in no slot); left out = none. */
  onePerCharacter?: string
  /** Characters in image order; each has a "weight" only when the Series gives characters their own odds. */
  characters: RecipeJsonCharacter[]
  /** FireSale.configureDrop's settings (sale.ts saleJson). */
  sale?: SaleJson
}

const num = (v: bigint): number | string => (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString())

/** The recipe.json ConfigureSeries.s.sol reads (shape in docs/cards-contracts.md). Characters in image order, each
 *  with `weight` only if `weights` gives the characters different odds (all equal: left out, the default). */
export function recipeJson(fire: number, r: Recipe, characters: { name: string; category: string }[], imagesBase?: string, sale?: SaleJson, weights?: readonly number[]): RecipeJson {
  const weighted = !!weights && weights.length === characters.length && weights.some((w) => w !== weights[0])
  const sw = slotWeights(r)
  return {
    fire,
    ...(imagesBase ? { imagesBase } : {}),
    types: r.types.map((t) => ({
      name: t.name, slug: t.slug, rank: t.rank,
      holo: t.holo.mode === 'independent'
        ? { mode: 'independent' as const, frame: String(parseUint(t.holo.frame)), picture: String(parseUint(t.holo.picture)) }
        : { mode: 'distribution' as const, weights: t.holo.weights.map((w) => String(parseUint(w))) },
    })),
    slots: sw.map(({ count, weights: w }) => ({ count, weights: Object.fromEntries(r.types.flatMap((t, i) => (w[i] > 0n ? [[t.slug, num(w[i])]] : []))) })),
    ...(onePerIndex(r) >= 0 ? { onePerCharacter: r.types[onePerIndex(r)].slug } : {}),
    characters: weighted ? characters.map((c, i) => ({ ...c, weight: weights![i] })) : characters,
    ...(sale ? { sale } : {}),
  }
}

/** Read a recipe.json back (for tests and for copying a recipe in). Frame sets default to the type's slug. Each slot
 *  keeps the JSON's exact weights (so the odds are the contract's) and gets its percentages from them (2 decimals,
 *  adding up to 100%); editing the recipe drops the exact weights. */
export function recipeFromJson(j: RecipeJson, frameSetOf: (slug: string) => string = (s) => s): Recipe {
  // a slug names the first type that has it (as ConfigureSeries.s.sol reads it)
  const idOf = new Map([...j.types].reverse().map((t, k) => [t.slug, `t${j.types.length - 1 - k}`]))
  return withPercentsFromWeights({
    types: j.types.map((t, i) => ({
      id: `t${i}`, name: t.name, slug: t.slug, slugEdited: t.slug !== slugify(t.name), rank: t.rank,
      holo: t.holo.mode === 'independent' ? { mode: 'independent', frame: String(t.holo.frame), picture: String(t.holo.picture) }
        : { mode: 'distribution', weights: t.holo.weights.map(String) as [string, string, string, string] },
      frameSet: frameSetOf(t.slug),
    })),
    slots: (j.slots ?? []).map((sl, s) => ({
      id: `s${s}`, count: sl.count, percents: {},
      weights: Object.fromEntries(Object.entries(sl.weights ?? {}).flatMap(([slug, w]) => (idOf.has(slug) ? [[idOf.get(slug)!, String(w)]] : []))),
    })),
    // a slug that names no type: kept as a missing id, so checkRecipe reports it (ConfigureSeries refuses it too)
    ...(j.onePerCharacter !== undefined ? { onePerCharacter: idOf.get(j.onePerCharacter) ?? `missing:${j.onePerCharacter}` } : {}),
  })
}

/** The character weights a recipe.json gives (each character's "weight"; none = undefined, equal odds). */
export function characterWeightsFromJson(j: RecipeJson): number[] | undefined {
  return j.characters.some((c) => c.weight !== undefined) ? j.characters.map((c) => Number(c.weight ?? 1)) : undefined
}

/** The Standard frame sets by slug (Fire uses the 'burning' frames, Coal the 'charcoal' ones). */
export const STANDARD_FRAME_SET: Record<string, string> = {
  paper: 'paper', wood: 'wood', fire: 'burning', coal: 'charcoal', gold: 'gold', fullart: 'fullart', diamond: 'diamond',
}

/** A short fingerprint of everything in the recipe that changes which images exist or what they show. */
export function recipeGridKey(r: Recipe): string {
  return JSON.stringify(r.types.map((t, i) => [t.slug, t.name, t.frameSet, holoLooksFor(r, i)]))
}
