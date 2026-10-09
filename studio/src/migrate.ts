/** Saves and backups from before per-Series recipes. Every Series made then was a Standard Series: it gets the
 *  Standard recipe with its Diamond setting, and a locked deal's cards (stored by material) are re-labelled with the
 *  Standard type indexes. Recipes saved with their own PDA odds drop them: the odds are fixed in FirePsa for every
 *  Series now. Sale settings saved with the free-pack cap as a number of packs (creditPacksMax) get it as a percent of
 *  the drop. A Series whose deal isn't locked takes its pack count from its sale (paid + press); one saved without
 *  sale settings gets the Standard sale resized to its packs. Runs on load (store.ts loadStudio), so imports of old backups migrate too. */

import { effectiveDiamonds, type DealResult, type DealtCard } from './deal'
import { legacyDiamondRecipe } from './recipe'
import { CARDS_PER_PACK, MATERIALS, type Material } from './rules'
import { capPercentOf, salePacks, saleOf, saleWithPacks, standardSale, type SaleSettings } from './sale'
import type { FireRecord } from './types'

type OldSale = Partial<SaleSettings> & { creditPacksMax?: number }

/** Old pack slots 1..6 (3 Paper, Wood, Wood-or-better, Fire-or-better) to the Standard recipe's slot groups. */
const OLD_SLOT_GROUP = [0, 0, 0, 1, 2, 3]

type OldCard = Omit<DealtCard, 'type' | 'group'> & { material?: Material; type?: number; group?: number }
type OldDeal = Omit<DealResult, 'pool' | 'cards' | 'cardsPerPack'> & { pool: number[] | Record<Material, number>; cards: OldCard[]; cardsPerPack?: number; diamonds?: number }

export function needsMigration(f: unknown): boolean {
  const r = f as Partial<FireRecord> & { deal?: OldDeal }
  return !r.recipe || 'pdaOdds' in r.recipe || (!!r.deal && !Array.isArray(r.deal.pool)) || saleNeedsMigration(r)
}

function saleNeedsMigration(r: Partial<FireRecord>): boolean {
  if (r.sale && 'creditPacksMax' in r.sale) return true
  return !r.deal && (!r.sale || salePacks(saleOf(r)) !== r.packs)
}

/** The sale settings as saved now: a pack-count free cap becomes a percent of that drop's packs (no cap stays no
 *  cap; the per-wallet cap is kept as saved, 0 included). */
function migrateSale(sale: OldSale): Partial<SaleSettings> {
  if (!('creditPacksMax' in sale)) return sale
  const { creditPacksMax, ...rest } = sale
  const packs = (rest.paidPacks ?? 0) + (rest.pressPacks ?? 0)
  return { ...rest, creditPacksPercent: rest.creditPacksPercent ?? capPercentOf(creditPacksMax ?? 0, packs), creditPacksPerWallet: rest.creditPacksPerWallet ?? 0 }
}

export function migrateFire(raw: unknown): FireRecord {
  const old = raw as Omit<FireRecord, 'recipe' | 'deal'> & { recipe?: FireRecord['recipe']; deal?: OldDeal }
  const f = { ...old } as FireRecord & { deal?: OldDeal }
  if (!f.recipe) f.recipe = legacyDiamondRecipe(effectiveDiamonds(old.deal?.diamonds ?? old.diamonds))
  else if ('pdaOdds' in f.recipe) {
    const { pdaOdds: _fixedNow, ...recipe } = f.recipe as FireRecord['recipe'] & { pdaOdds?: string[] }
    f.recipe = recipe
  }
  const d = old.deal
  if (d && !Array.isArray(d.pool)) {
    const pool = d.pool as Record<Material, number>
    const cards: DealtCard[] = d.cards.map((c) => {
      const { material, ...rest } = c
      return { ...rest, type: MATERIALS.indexOf(material ?? 'paper'), group: OLD_SLOT_GROUP[(c.slot ?? 1) - 1] ?? 0 } as DealtCard
    })
    const deal: DealResult = { ...(d as unknown as DealResult), pool: MATERIALS.map((m) => pool[m] ?? 0), cards, cardsPerPack: CARDS_PER_PACK }
    delete (deal as { diamonds?: number }).diamonds
    f.deal = deal
  }
  if (f.sale) f.sale = migrateSale(f.sale as OldSale) as SaleSettings
  if (!f.deal) {
    // the pack count lives in the sale now: a Series without sale settings keeps its packs (the Standard sale, resized)
    if (!f.sale) f.sale = saleWithPacks(standardSale(), f.packs)
    else f.packs = salePacks(saleOf(f))
  }
  return f as FireRecord
}
