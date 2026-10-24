/** A Series' recipe: its card types (each with its odds) and its cards per pack. This is the studio's copy of
 *  RecipeDealer.Recipe (contracts/src/cards/RecipeDealer.sol) plus what only the studio needs (each type's frame set).
 *
 *  Dealing is straight odds: every card of every pack is rolled on its own, its type by the type odds (each type's
 *  % of cards), then its holo by that type's holo odds, then its character by the character odds (none = every
 *  character equally likely). No slots, guarantees, caps or pool: the first and the last pack of
 *  a Series have the same odds.
 *
 *  - checkRecipe: every check RecipeCompiler.compile makes, in the same order (so the first problem is the contract's
 *    revert), plus the studio's own (number formats).
 *  - typeOdds / holoOdds / holoLooksFor: the odds the contract deals by.
 *  - recipeJson: the recipe.json that contracts/script/ConfigureSeries.s.sol reads.
 *
 *  The owner sets odds as plain percentages (up to 2 decimals, adding up to exactly 100%). The contract takes whole-number
 *  weights: a percentage becomes percent x 10,000 (100% = 1,000,000), with the zeros every weight shares dropped
 *  (simplifyWeights: same ratios, so the Standard still exports 5000 / 2415 / ... of 10,000).
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
  /** The type's odds as the owner sets them: its % of cards, above 0 and up to 100 with at most 2 decimals. All types
   *  add up to exactly 100%. */
  percent: string
  /** Exact odds (the contract's weight) kept from a save whose deal is locked, or read from a recipe.json: the studio
   *  deals and exports by these while every type has one. Any edit to an open recipe drops them. */
  weight?: string
  holo: HoloRule
  /** The frame set (src/assets/frames/<set>.webp) and character art this type uses. */
  frameSet: string
}

export interface Recipe {
  types: CardTypeDef[]
  /** Cards in one pack, 1 to MAX_CARDS_PER_PACK. */
  cardsPerPack: number
}

export const HOLO_ONE = 1_000_000_000_000_000_000n
export const UINT32_MAX = 0xffff_ffff
const U64 = (1n << 64n) - 1n
export const MAX_TYPE_NAME_BYTES = 64
export const MAX_SLUG_BYTES = 32
/** FireCards.MAX_CARDS_PER_PACK (RecipeCompiler refuses more). */
export const MAX_CARDS_PER_PACK = 1000
/** FirePsa's fresh odds (out of 10,000), grade 1 first: fixed forever, the same for every Series (docs/grading.md).
 *  10 1%, 9 30%, 8 40%, 7 29%; 1-6 come only from wear. Shown, never set or exported. */
export const FRESH_PDA_ODDS = [0, 0, 0, 0, 0, 0, 2900, 4000, 3000, 100] as const

// ---------------------------------------------------------------- presets

/** StandardRecipe.sol: holo roll chances 1 - sqrt(1 - rate) for 5 / 10 / 50 / 90%, at 1e18. */
export const STANDARD_ROLLS = {
  paper: '25320565519103609',
  wood: '51316701949486200',
  fire: '292893218813452475',
  coal: '683772233983162066',
} as const

/** StandardRecipe.sol's type weights, out of 10,000: the old pool dealing's expected share of each type per card (167
 *  packs, 20 characters: 501 Paper, 242 Wood, 150 Fire, 49 Coal, 40 Gold, 20 Full Art of 1,002). */
export const STANDARD_WEIGHTS = { paper: '5000', wood: '2415', fire: '1497', coal: '489', gold: '399', fullart: '200' } as const
/** The same odds as the owner sets them: % of cards. */
export const STANDARD_PERCENTS = { paper: '50', wood: '24.15', fire: '14.97', coal: '4.89', gold: '3.99', fullart: '2' } as const

const ind = (roll: string): HoloRule => ({ mode: 'independent', frame: roll, picture: roll })

const fullHolo = (): HoloRule => ({ mode: 'distribution', weights: ['0', '0', '0', '1'] })

/** Exactly StandardRecipe.build(): 6 cards a pack; Paper 50%, Wood 24.15%, Fire 14.97%, Coal 4.89%, Gold 3.99%, Full
 *  Art 2% per card; Paper / Wood / Fire / Coal any holo 5 / 10 / 50 / 90% (two independent rolls), Gold and Full Art
 *  always full holo. */
export function standardRecipe(): Recipe {
  const w = STANDARD_PERCENTS
  return {
    cardsPerPack: 6,
    types: [
      { id: 'paper', name: 'Paper', slug: 'paper', rank: 0, percent: w.paper, holo: ind(STANDARD_ROLLS.paper), frameSet: 'paper' },
      { id: 'wood', name: 'Wood', slug: 'wood', rank: 1, percent: w.wood, holo: ind(STANDARD_ROLLS.wood), frameSet: 'wood' },
      { id: 'fire', name: 'Fire', slug: 'fire', rank: 2, percent: w.fire, holo: ind(STANDARD_ROLLS.fire), frameSet: 'burning' },
      { id: 'coal', name: 'Coal', slug: 'coal', rank: 3, percent: w.coal, holo: ind(STANDARD_ROLLS.coal), frameSet: 'charcoal' },
      { id: 'gold', name: 'Gold', slug: 'gold', rank: 4, percent: w.gold, holo: fullHolo(), frameSet: 'gold' },
      { id: 'fullart', name: 'Full Art', slug: 'fullart', rank: 5, percent: w.fullart, holo: fullHolo(), frameSet: 'fullart' },
    ],
  }
}

/** The recipe Series saved before Gold had: the old Standard with Diamond (frame / picture / full, a third each), at
 *  the old pool's shares for a 167-pack Series with one Diamond (501 Paper, 301 Wood, 150 Fire, 49 Coal, 1 Diamond of
 *  1,002). Only migrate.ts uses it, so old saves keep their cards and images. */
export function legacyDiamondRecipe(): Recipe {
  return withPercentsFromWeights({
    cardsPerPack: 6,
    types: [
      { id: 'paper', name: 'Paper', slug: 'paper', rank: 0, weight: '501', holo: ind(STANDARD_ROLLS.paper), frameSet: 'paper' },
      { id: 'wood', name: 'Wood', slug: 'wood', rank: 1, weight: '301', holo: ind(STANDARD_ROLLS.wood), frameSet: 'wood' },
      { id: 'fire', name: 'Fire', slug: 'fire', rank: 2, weight: '150', holo: ind(STANDARD_ROLLS.fire), frameSet: 'burning' },
      { id: 'coal', name: 'Coal', slug: 'coal', rank: 3, weight: '49', holo: ind(STANDARD_ROLLS.coal), frameSet: 'charcoal' },
      { id: 'diamond', name: 'Diamond', slug: 'diamond', rank: 4, weight: '1', holo: { mode: 'distribution', weights: ['0', '1', '1', '1'] }, frameSet: 'diamond' },
    ].map((t) => ({ ...t, percent: '' })) as CardTypeDef[],
  })
}

/** An example special Series: 3 cards per pack, every card holo (frame, picture or full, a third each; Gold always
 *  full), so no "none" images are built. Fire 68%, Coal 30%, Gold 2% per card. */
export function specialAllHoloRecipe(): Recipe {
  const anyHolo = (): HoloRule => ({ mode: 'distribution', weights: ['0', '1', '1', '1'] })
  return {
    cardsPerPack: 3,
    types: [
      { id: 'fire', name: 'Fire', slug: 'fire', rank: 2, percent: '68', holo: anyHolo(), frameSet: 'burning' },
      { id: 'coal', name: 'Coal', slug: 'coal', rank: 3, percent: '30', holo: anyHolo(), frameSet: 'charcoal' },
      { id: 'gold', name: 'Gold', slug: 'gold', rank: 4, percent: '2', holo: fullHolo(), frameSet: 'gold' },
    ],
  }
}

/** A fresh copy with new type ids, set by its percentages (exact weights from an old save are not copied). */
export function cloneRecipe(r: Recipe, newId: () => string): Recipe {
  return {
    cardsPerPack: r.cardsPerPack,
    types: r.types.map(({ weight: _exact, ...t }) => ({ ...t, id: newId(), holo: t.holo.mode === 'independent' ? { ...t.holo } : { mode: 'distribution', weights: [...t.holo.weights] } })),
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

/** The one-click fix: the one with the biggest share takes what's left (or gives up the extra). Its index and new
 *  percentage, or null when the total is already 100%, a percentage isn't a number, or the fix would leave it at 0 or
 *  below. */
export function fillTheRest(percents: readonly (string | undefined)[]): { index: number; percent: string } | null {
  const t = percentTotal(percents)
  if (t.bad.length || t.left === 0 || !percents.length) return null
  const vals = percents.map((p) => parsePercent(p) ?? 0)
  const index = vals.reduce((b, v, j) => (v > vals[b] ? j : b), 0)
  const next = vals[index] + t.left
  return next > 0 && next <= ALL ? { index, percent: formatPercent(next) } : null
}

/** A recipe whose types carry exact weights, with each type's percent filled in from them (adding up to 100%). */
export function withPercentsFromWeights(r: Recipe): Recipe {
  const p = weightsToPercents(r.types.map((t) => t.weight ?? '0'))
  return { ...r, types: r.types.map((t, i) => ({ ...t, percent: p[i] })) }
}

/** The recipe set by its percentages only (exact weights dropped). */
export function dropExactWeights(r: Recipe): Recipe {
  return r.types.some((t) => t.weight !== undefined) ? { ...r, types: r.types.map(({ weight: _exact, ...t }) => t) } : r
}

/** Whether the recipe deals by exact weights (every type has one) rather than by its percentages. */
export const hasExactWeights = (r: Recipe) => r.types.length > 0 && r.types.every((t) => t.weight !== undefined)

// ---------------------------------------------------------------- checks

export interface Problem {
  /** The contract's error ('BadType(i,why)', 'BadRecipe(why)', 'BadText') or 'Studio' for the studio's own checks. */
  code: string
  /** 'total': the card types' percentages don't add up to 100%. */
  where: 'recipe' | 'type' | 'total'
  index?: number
  message: string
}

export function cardsPerPack(r: Recipe): number {
  return Number.isFinite(r.cardsPerPack) ? r.cardsPerPack : 0
}

function badText(s: string): boolean {
  // JS strings are always valid UTF-8 once encoded, except lone surrogates: the contract refuses those too
  return /["\\\u0000-\u001f\u007f]/.test(s) || /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s)
}

const typeLabel = (r: Recipe, i: number) => `Type ${i + 1}${r.types[i]?.name ? ` (${r.types[i].name})` : ''}`

/** Studio-side format checks: every number is a whole number in its on-chain range. */
function formatProblems(r: Recipe): Problem[] {
  const out: Problem[] = []
  const typeP = (i: number, message: string) => out.push({ code: 'Studio', where: 'type', index: i, message: `${typeLabel(r, i)}: ${message}` })
  if (!Number.isInteger(r.cardsPerPack) || r.cardsPerPack < 0 || r.cardsPerPack > UINT32_MAX) {
    out.push({ code: 'Studio', where: 'recipe', message: 'Cards per pack must be a whole number.' })
  }
  const exact = hasExactWeights(r)
  r.types.forEach((t, i) => {
    if (!Number.isInteger(t.rank) || t.rank < 0 || t.rank > UINT32_MAX) typeP(i, 'rank must be a whole number from 0 to 4,294,967,295.')
    if (exact) {
      const w = parseUint(t.weight ?? '')
      if (w == null || w > U64) typeP(i, 'its odds are not a valid whole number.')
    } else if (parsePercent(t.percent) == null) typeP(i, '% of cards must be a number from 0 to 100, with at most 2 decimals.')
    if (t.holo.mode === 'independent') {
      for (const [k, v] of [['frame', t.holo.frame], ['picture', t.holo.picture]] as const) {
        const x = parseUint(v)
        if (x == null || x > U64) typeP(i, `holo ${k} chance is not a valid number.`)
      }
    } else {
      if (t.holo.weights.length !== 4 || t.holo.weights.some((w) => { const x = parseUint(w); return x == null || x > U64 })) typeP(i, 'holo weights must be 4 whole numbers.')
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
  const { weights } = typeWeights(r)
  const exact = hasExactWeights(r)
  const typeP = (i: number, why: string, message: string, code = 'BadType') => out.push({ code: code === 'BadType' ? `BadType(${i},${why})` : code, where: 'type', index: i, message: `${typeLabel(r, i)}: ${message}` })
  if (T === 0 || T > UINT32_MAX) out.push({ code: 'BadRecipe(no types)', where: 'recipe', message: 'Add at least one card type.' })
  else if (r.cardsPerPack < 1 || r.cardsPerPack > MAX_CARDS_PER_PACK) {
    out.push({ code: 'BadRecipe(cards per pack)', where: 'recipe', message: `Cards per pack must be 1 to ${MAX_CARDS_PER_PACK.toLocaleString('en-US')}.` })
  }
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
    if (weights[i] === 0n) typeP(i, 'weight', exact ? 'its odds must be above 0 (remove the type to leave it out).' : 'its % of cards must be above 0 (remove the type to leave it out).')
    if (t.holo.mode === 'independent') {
      if (parseUint(t.holo.frame)! > HOLO_ONE || parseUint(t.holo.picture)! > HOLO_ONE) typeP(i, 'holo chances', 'a holo chance is above 100%.')
    } else if (t.holo.weights.reduce((a, w) => a + parseUint(w)!, 0n) === 0n) {
      typeP(i, 'holo weights', 'the holo split adds up to 0 (give at least one look a part).')
    }
  })
  // the owner's percentages must add up to exactly 100% (the contract would take any total: this is the studio's rule)
  if (!exact && T > 0) {
    const msg = percentTotalProblem(percentTotal(r.types.map((t) => t.percent)), 'The card types')
    if (msg) out.push({ code: 'Studio', where: 'total', message: msg })
  }
  return out
}

/** Problems the contract itself would reject (RecipeDealer.check / setRecipe). */
export function contractProblems(problems: Problem[]): Problem[] {
  return problems.filter((p) => p.code !== 'Studio')
}

// ---------------------------------------------------------------- odds

/** Each type's weight (recipe order, BigInt) and their total: what the contract gets. From the percentages (percent x
 *  10,000, simplified), or the exact weights a locked old save or a recipe.json carries. */
export function typeWeights(r: Recipe): { weights: bigint[]; total: bigint } {
  const weights = hasExactWeights(r) ? r.types.map((t) => parseUint(t.weight ?? '') ?? 0n) : simplifyWeights(percentsToWeights(r.types.map((t) => t.percent)))
  return { weights, total: weights.reduce((a, w) => a + w, 0n) }
}

/** Each type's chance per card (recipe order), as fractions (RecipeDealer.oddsOf: its weight over the total). */
export function typeOdds(r: Recipe): number[] {
  const { weights, total } = typeWeights(r)
  return weights.map((w) => (total > 0n ? Number((w * 1_000_000_000_000n) / total) / 1e12 : 0))
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

export interface RecipeJson {
  fire: number
  imagesBase?: string
  cardsPerPack: number
  types: ({ name: string; slug: string; rank: number; weight: number | string; holo: { mode: 'independent'; frame: string; picture: string } | { mode: 'distribution'; weights: string[] } })[]
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
  const typeW = typeWeights(r).weights
  return {
    fire,
    ...(imagesBase ? { imagesBase } : {}),
    cardsPerPack: r.cardsPerPack,
    types: r.types.map((t, i) => ({
      name: t.name, slug: t.slug, rank: t.rank, weight: num(typeW[i]),
      holo: t.holo.mode === 'independent'
        ? { mode: 'independent' as const, frame: String(parseUint(t.holo.frame)), picture: String(parseUint(t.holo.picture)) }
        : { mode: 'distribution' as const, weights: t.holo.weights.map((w) => String(parseUint(w))) },
    })),
    characters: weighted ? characters.map((c, i) => ({ ...c, weight: weights![i] })) : characters,
    ...(sale ? { sale } : {}),
  }
}

/** Read a recipe.json back (for tests and for copying a recipe in). Frame sets default to the type's slug. Each type
 *  keeps the JSON's exact weight (so the odds are the contract's) and gets its percentage from it (2 decimals, adding
 *  up to 100%); editing the recipe drops the exact weights. */
export function recipeFromJson(j: RecipeJson, frameSetOf: (slug: string) => string = (s) => s): Recipe {
  return withPercentsFromWeights({
    cardsPerPack: j.cardsPerPack,
    types: j.types.map((t, i) => ({
      id: `t${i}`, name: t.name, slug: t.slug, slugEdited: t.slug !== slugify(t.name), rank: t.rank, percent: '', weight: String(t.weight),
      holo: t.holo.mode === 'independent' ? { mode: 'independent', frame: String(t.holo.frame), picture: String(t.holo.picture) }
        : { mode: 'distribution', weights: t.holo.weights.map(String) as [string, string, string, string] },
      frameSet: frameSetOf(t.slug),
    })),
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
