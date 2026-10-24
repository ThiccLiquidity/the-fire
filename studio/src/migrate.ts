/** Saves and backups from before per-Series recipes. Every Series made then was a Standard Series: it gets the
 *  old Standard (Diamond) recipe, and a locked deal's cards (stored by material) are re-labelled with the
 *  Standard type indexes. Recipes saved with the old pool rules (supply, slots) become odds recipes: each type's
 *  weight is the cards its old rule gave for the Series' packs and characters (so its expected share stays about
 *  the same), cards per pack is the old slots' total, and holo is kept (oldRecipeToOdds). Recipes saved with their own PDA odds drop them: the odds are fixed in FirePsa for every
 *  Series now. Sale settings saved before drop groups (paid + press packs, one price) become groups (sale.ts
 *  saleFromOld; a free-pack cap saved as a number of packs becomes a percent of the drop). A Series whose deal isn't
 *  locked takes its pack count from its sale (the groups' total); one saved without
 *  sale settings gets the Standard sale resized to its packs. A deal saved with editions ("k of N") gets print
 *  numbers instead (numberPrints: per exact card, in the order dealt). Runs on load (store.ts loadStudio), so imports of old backups migrate too. */

import { numberPrints, type DealResult, type DealtCard } from './deal'
import { legacyDiamondRecipe, type CardTypeDef, type HoloRule, type Recipe } from './recipe'
import { CARDS_PER_PACK, MATERIALS, type Material } from './rules'
import { isOldSale, saleFromOld, salePacks, saleOf, saleWithPacks, standardSale, type OldSaleSettings } from './sale'
import type { Character, FireRecord } from './types'

type OldCard = Omit<DealtCard, 'type' | 'printNumber'> & { material?: Material; type?: number; group?: number; printNumber?: number; edition?: number; editionOf?: number }

const hasEditions = (d: { cards?: unknown[] } | undefined) => !!d?.cards?.some((c) => !('printNumber' in (c as object)))

/** A recipe saved with the old pool rules (RecipeDealer before straight odds). */
interface OldType { id: string; name: string; slug: string; slugEdited?: boolean; rank: number; supply: 'filler' | 'share' | 'perPack' | 'count' | 'perCharacter'; amount: string; maxPerPack: string; holo: HoloRule; frameSet: string }
interface OldRecipe { types: OldType[]; slots: { count: number }[] }

const isOldRecipe = (r: unknown): r is OldRecipe => !!r && typeof r === 'object' && ('slots' in r || ((r as OldRecipe).types ?? []).some((t) => 'supply' in t))

/** An old pool recipe as odds: each type's weight = the cards its old rule gave for `packs` packs (at least 1) and
 *  `chars` characters, capped as before; the filler the rest (at least 1). Cards per pack = the old slots' total. */
export function oldRecipeToOdds(r: OldRecipe, packs: number, chars: number): Recipe {
  const perPack = (r.slots ?? []).reduce((n, s) => n + (Number.isFinite(s.count) ? s.count : 0), 0) || 6
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
  const types: CardTypeDef[] = r.types.map((t, i) => ({
    id: t.id, name: t.name, slug: t.slug, ...(t.slugEdited ? { slugEdited: true } : {}), rank: t.rank,
    weight: String(counts[i] > 0n ? counts[i] : 1n), holo: t.holo, frameSet: t.frameSet,
  }))
  return { types, cardsPerPack: perPack }
}
type OldDeal = Omit<DealResult, 'pool' | 'cards' | 'cardsPerPack'> & { pool: number[] | Record<Material, number>; cards: OldCard[]; cardsPerPack?: number; diamonds?: number }

export function needsMigration(f: unknown): boolean {
  const r = f as Partial<FireRecord> & { deal?: OldDeal }
  return !r.recipe || 'pdaOdds' in r.recipe || isOldRecipe(r.recipe) || (!!r.deal && !Array.isArray(r.deal.pool)) || hasEditions(r.deal) || saleNeedsMigration(r)
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
  if (isOldRecipe(f.recipe)) f.recipe = oldRecipeToOdds(f.recipe, old.deal?.packs ?? old.packs ?? 167, (old.deal?.characterIds ?? old.characterIds ?? []).length)
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
