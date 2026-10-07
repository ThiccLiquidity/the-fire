/** Saves and backups from before per-Series recipes. Every Series made then was a Standard Series: it gets the
 *  Standard recipe with its Diamond setting, and a locked deal's cards (stored by material) are re-labelled with the
 *  Standard type indexes. Recipes saved with their own PDA odds drop them: the odds are fixed in FirePsa for every
 *  Series now. Runs on load (store.ts loadStudio), so imports of old backups migrate too. */

import { effectiveDiamonds, type DealResult, type DealtCard } from './deal'
import { legacyDiamondRecipe } from './recipe'
import { CARDS_PER_PACK, MATERIALS, type Material } from './rules'
import type { FireRecord } from './types'

/** Old pack slots 1..6 (3 Paper, Wood, Wood-or-better, Fire-or-better) to the Standard recipe's slot groups. */
const OLD_SLOT_GROUP = [0, 0, 0, 1, 2, 3]

type OldCard = Omit<DealtCard, 'type' | 'group'> & { material?: Material; type?: number; group?: number }
type OldDeal = Omit<DealResult, 'pool' | 'cards' | 'cardsPerPack'> & { pool: number[] | Record<Material, number>; cards: OldCard[]; cardsPerPack?: number; diamonds?: number }

export function needsMigration(f: unknown): boolean {
  const r = f as Partial<FireRecord> & { deal?: OldDeal }
  return !r.recipe || 'pdaOdds' in r.recipe || (!!r.deal && !Array.isArray(r.deal.pool))
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
  return f as FireRecord
}
