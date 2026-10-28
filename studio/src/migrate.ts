/** Saves and backups from before per-Series recipes. Every Series made then was a Standard Series: it gets the
 *  old Standard (Diamond) recipe, and a locked deal's cards (stored by material) are re-labelled with the
 *  Standard type indexes. Recipes saved with straight odds (one weight or % per type, a cards per pack) become one slot
 *  of that many cards at those odds (oddsRecipeToSlots: the same cards, the same odds). Recipes saved with the old pool
 *  rules (supply, slot groups) become slot recipes: each old slot group becomes a slot of its count, dealing the types
 *  it could hold at the odds those types had over the whole Series (each type's weight = the cards its old rule gave
 *  for the Series' packs and characters: oldRecipeToSlots), and holo is kept. Recipes saved with their own PDA odds drop them: the odds are fixed in FirePsa for every
 *  Series now. Sale settings saved before drop groups (paid + press packs, one price) become groups (sale.ts
 *  saleFromOld; a free-pack cap saved as a number of packs becomes a percent of the drop). A Series whose deal isn't
 *  locked takes its pack count from its sale (the groups' total); one saved without
 *  sale settings gets the Standard sale resized to its packs. A deal saved with editions ("k of N") gets print
 *  numbers instead (numberPrints: per exact card, in the order dealt). Odds saved as weights (card types and
 *  characters) become percentages (2 decimals, rounded so they add up to exactly 100%: weightsToPercents); a Series
 *  whose deal is locked keeps its exact weights too, so its odds (and its recipe.json) never change. An open Series still on exactly
 *  the old Standard (Full Art 4.5% / 7.5% in the top two slots) moves to the new Standard (Full Art one per character,
 *  its share to Wood and Fire): it never chose those odds, the Standard did. Every other recipe (the owner's own, or
 *  any locked Series) keeps its odds; the owner can mark a type one per character on the Recipe tab. Runs on load
 *  (store.ts loadStudio), so imports of old backups migrate too. */

import { numberPrints, type DealResult, type DealtCard } from './deal'
import { dropExactWeights, legacyDiamondRecipe, oldStandardRecipe, standardRecipe, weightsToPercents, withPercentsFromWeights, type CardTypeDef, type HoloRule, type Recipe, type SlotDef } from './recipe'
import { CARDS_PER_PACK, MATERIALS, type Material } from './rules'
import { isOldSale, saleFromOld, salePacks, saleOf, saleWithPacks, standardSale, type OldSaleSettings } from './sale'
import type { Character, FireRecord } from './types'

type OldCard = Omit<DealtCard, 'type' | 'printNumber'> & { material?: Material; type?: number; group?: number; printNumber?: number; edition?: number; editionOf?: number }

const hasEditions = (d: { cards?: unknown[] } | undefined) => !!d?.cards?.some((c) => !('printNumber' in (c as object)))

/** A recipe saved with the old pool rules (RecipeDealer before straight odds). */
interface OldType { id: string; name: string; slug: string; slugEdited?: boolean; rank: number; supply: 'filler' | 'share' | 'perPack' | 'count' | 'perCharacter'; amount: string; maxPerPack: string; holo: HoloRule; frameSet: string }
interface OldSlot { count: number; kind?: 'types' | 'rank'; typeIds?: string[]; minRank?: number; maxRank?: number | null }
interface OldRecipe { types: OldType[]; slots: OldSlot[] }
/** A recipe saved with straight odds (before slots): one weight or % per type, and a cards per pack. */
interface OddsType extends CardTypeDef { percent?: string; weight?: string }
interface OddsRecipe { types: OddsType[]; cardsPerPack: number }

const isOldRecipe = (r: unknown): r is OldRecipe => !!r && typeof r === 'object'
  && (((r as OldRecipe).types ?? []).some((t) => 'supply' in t) || ((r as OldRecipe).slots ?? []).some((s) => s && typeof s === 'object' && ('kind' in s || !('percents' in s))))
const isOddsRecipe = (r: unknown): r is OddsRecipe => !!r && typeof r === 'object' && !Array.isArray((r as Recipe).slots)

const typeOnly = ({ percent: _p, weight: _w, ...t }: OddsType): CardTypeDef => t

/** A straight-odds recipe as one slot of its cards per pack, at its odds: the exact weights when every type has one
 *  (a locked deal's, or a recipe.json's), else its percentages. */
export function oddsRecipeToSlots(r: OddsRecipe): Recipe {
  const count = Number.isFinite(r.cardsPerPack) && r.cardsPerPack > 0 ? r.cardsPerPack : 6
  const allExact = r.types.length > 0 && r.types.every((t) => t.weight !== undefined)
  const anyPercent = r.types.some((t) => typeof t.percent === 'string' && t.percent.trim() !== '')
  const slot: SlotDef = !allExact && anyPercent
    ? { id: 'all', count, percents: Object.fromEntries(r.types.flatMap((t) => (typeof t.percent === 'string' && t.percent.trim() !== '' ? [[t.id, t.percent]] : []))) }
    : { id: 'all', count, percents: {}, weights: Object.fromEntries(r.types.map((t) => [t.id, String(t.weight ?? '1')])) }
  return withPercentsFromWeights({ types: r.types.map(typeOnly), slots: [slot] })
}

/** The type indexes an old slot group could hold (an explicit list, or a rank range), in recipe order. */
function oldSlotTypes(r: OldRecipe, s: OldSlot): number[] {
  if (s.kind === 'types' || (!s.kind && s.typeIds)) return r.types.flatMap((t, i) => ((s.typeIds ?? []).includes(t.id) ? [i] : []))
  const lo = s.minRank ?? 0
  const hi = s.maxRank ?? Number.MAX_SAFE_INTEGER
  return r.types.flatMap((t, i) => (t.rank >= lo && t.rank <= hi ? [i] : []))
}

/** An old pool recipe as slots: each type's weight = the cards its old rule gave for `packs` packs (at least 1) and
 *  `chars` characters, capped as before; the filler the rest (at least 1). Each old slot group becomes a slot of its
 *  count over the types it could hold, at those weights (no old slots: one slot of 6 over every type). */
export function oldRecipeToSlots(r: OldRecipe, packs: number, chars: number): Recipe {
  const oldSlots = (r.slots ?? []).filter((s) => Number.isFinite(s.count) && s.count > 0)
  const perPack = oldSlots.reduce((n, s) => n + s.count, 0) || 6
  const P = BigInt(Math.max(1, Math.floor(packs)))
  const C = BigInt(Math.max(1, Math.floor(chars)))
  const N = P * BigInt(perPack)
  const big = (x: string) => { try { return BigInt(x || '0') } catch { return 0n } }
  let used = 0n
  const counts = r.types.map((t) => {
    if (t.supply === 'filler') return 0n
    const a = big(t.amount)
    let x = t.supply === 'share' ? (a * N + 500_000_000n) / 1_000_000_000n : t.supply === 'perPack' ? a * P : t.supply === 'perCharacter' ? a * C : a
    const cap = big(t.maxPerPack)
    if (cap > 0n && x > cap * P) x = cap * P
    used += x
    return x
  })
  const fi = r.types.findIndex((t) => t.supply === 'filler')
  if (fi >= 0) counts[fi] = N > used ? N - used : 0n
  const w = counts.map((x) => (x > 0n ? x : 1n))
  const types: CardTypeDef[] = r.types.map((t) => ({
    id: t.id, name: t.name, slug: t.slug, ...(t.slugEdited ? { slugEdited: true } : {}), rank: t.rank, holo: t.holo, frameSet: t.frameSet,
  }))
  const groups = oldSlots.length ? oldSlots.map((s) => ({ count: s.count, set: oldSlotTypes(r, s) })) : [{ count: perPack, set: r.types.map((_, i) => i) }]
  // a type no group could hold would never be dealt: it joins the last group
  const covered = new Set(groups.flatMap((g) => g.set))
  r.types.forEach((_, i) => { if (!covered.has(i)) groups[groups.length - 1].set.push(i) })
  const slots: SlotDef[] = groups.map((g, k) => ({
    id: `s${k}`, count: g.count, percents: {},
    weights: Object.fromEntries((g.set.length ? g.set : r.types.map((_, i) => i)).map((i) => [r.types[i].id, String(w[i])])),
  }))
  return withPercentsFromWeights({ types, slots })
}
type OldDeal = Omit<DealResult, 'pool' | 'cards' | 'cardsPerPack'> & { pool: number[] | Record<Material, number>; cards: OldCard[]; cardsPerPack?: number; diamonds?: number }

/** A recipe from before slots, or (open Series) exact weights or character weights. */
function oddsNeedMigration(r: Partial<FireRecord>): boolean {
  if (!r.recipe || isOddsRecipe(r.recipe)) return true
  return !r.deal && (r.recipe.slots.some((s) => s.weights !== undefined) || !!r.characterWeights)
}

/** An open Series' recipe that is exactly the Standard from before Full Art became one per character. */
function isOldStandard(r: Partial<FireRecord>): boolean {
  if (r.deal || !r.recipe || !Array.isArray(r.recipe.slots) || r.recipe.onePerCharacter !== undefined) return false
  const want = oldStandardRecipe()
  const sorted = (o: object | undefined) => (o ? Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)) : null)
  const key = (x: Recipe) => JSON.stringify([
    x.types.map((t) => [t.id, t.name, t.slug, !!t.slugEdited, t.rank, t.frameSet, sorted(t.holo)]),
    x.slots.map((sl) => [sl.count, sorted(sl.percents), sorted(sl.weights)]),
  ])
  return key(r.recipe) === key(want)
}

export function needsMigration(f: unknown): boolean {
  const r = f as Partial<FireRecord> & { deal?: OldDeal }
  return isOldStandard(r) || !r.recipe || 'pdaOdds' in r.recipe || isOldRecipe(r.recipe) || (!!r.deal && !Array.isArray(r.deal.pool)) || hasEditions(r.deal) || saleNeedsMigration(r) || oddsNeedMigration(r)
}

function saleNeedsMigration(r: Partial<FireRecord>): boolean {
  if (r.sale && isOldSale(r.sale)) return true
  return !r.deal && (!r.sale || salePacks(saleOf(r)) !== r.packs)
}

export function migrateFire(raw: unknown): FireRecord {
  const old = raw as Omit<FireRecord, 'recipe' | 'deal'> & { recipe?: FireRecord['recipe']; deal?: OldDeal }
  const f = { ...old } as FireRecord & { deal?: OldDeal }
  if (!f.recipe) f.recipe = legacyDiamondRecipe()
  else if ('pdaOdds' in f.recipe) {
    const { pdaOdds: _fixedNow, ...recipe } = f.recipe as FireRecord['recipe'] & { pdaOdds?: string[] }
    f.recipe = recipe
  }
  if (isOldRecipe(f.recipe)) f.recipe = oldRecipeToSlots(f.recipe, old.deal?.packs ?? old.packs ?? 167, (old.deal?.characterIds ?? old.characterIds ?? []).length)
  // straight odds (one weight or % per type): one slot of the cards per pack; a locked Series keeps its exact weights
  if (isOddsRecipe(f.recipe)) f.recipe = oddsRecipeToSlots(f.recipe)
  if (!old.deal) {
    f.recipe = dropExactWeights(f.recipe)
    if (f.characterWeights) {
      const ids = f.characterIds ?? []
      const w = ids.map((id) => Math.max(1, Math.floor(f.characterWeights?.[id] ?? 1)))
      const p = weightsToPercents(w)
      delete f.characterWeights
      if (w.some((x) => x !== w[0])) f.characterPercents = Object.fromEntries(ids.map((id, k) => [id, p[k]]))
    }
  }
  if (isOldStandard(f)) f.recipe = standardRecipe()
  const d = old.deal
  if (d && !Array.isArray(d.pool)) {
    const pool = d.pool as Record<Material, number>
    const cards: DealtCard[] = d.cards.map((c) => {
      const { material, ...rest } = c
      const { group: _noSlotsNow, ...card } = rest
      return { ...card, type: MATERIALS.indexOf(material ?? 'paper') } as DealtCard
    })
    const deal: DealResult = { ...(d as unknown as DealResult), pool: MATERIALS.map((m) => pool[m] ?? 0), cards, cardsPerPack: CARDS_PER_PACK }
    delete (deal as { diamonds?: number }).diamonds
    f.deal = deal
  }
  if (f.deal && hasEditions(f.deal)) {
    const cards = (f.deal.cards as OldCard[]).map((c) => {
      const { edition: _k, editionOf: _n, ...card } = c
      return { ...card, printNumber: 0 } as DealtCard
    })
    numberPrints(cards)
    f.deal = { ...(f.deal as unknown as DealResult), cards }
  }
  if (f.sale && isOldSale(f.sale)) f.sale = saleFromOld(f.sale as OldSaleSettings)
  if (!f.deal) {
    // the pack count lives in the sale now: a Series without sale settings keeps its packs (the Standard sale, resized)
    if (!f.sale) f.sale = saleWithPacks(standardSale(), f.packs)
    else f.packs = salePacks(saleOf(f))
  }
  return f as FireRecord
}

/** Holo is drawn now (holoFx.ts), so each set takes one normal picture. Full Art used to take only a holo picture:
 *  that picture becomes its normal one. Other holo pictures stay stored but unused. Returns the changed character, or
 *  null when nothing moves. */
export function migrateCharacterArt(c: Character): Character | null {
  const fa = c.images.fullart
  if (!fa?.holo || fa.normal) return null
  const { holo, ...rest } = fa
  return { ...c, images: { ...c.images, fullart: { ...rest, normal: holo } } }
}
