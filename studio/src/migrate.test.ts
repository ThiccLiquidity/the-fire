import { describe, expect, it } from 'vitest'
import { compileRecipe, legacyDiamondRecipe, previewPool } from './recipe'
import { migrateFire, needsMigration } from './migrate'
import { creditPacksMax, saleOf, standardSale } from './sale'
import type { FireRecord } from './types'

/** A Series as saved before recipes: Diamonds on the record, a locked deal stored by material. */
const oldFire = {
  number: 3, characterIds: ['a', 'b'], packs: 2, diamonds: 2, seed: 's', createdAt: 1, updatedAt: 1,
  deal: {
    method: 'sample-sha256ctr-v1', fire: 3, packs: 2, seed: 's', characterIds: ['a', 'b'],
    pool: { paper: 6, wood: 2, burning: 1, charcoal: 1, diamond: 2 }, diamonds: 2, firstSerial: 1, nextSerial: 13,
    cards: Array.from({ length: 12 }, (_, i) => ({
      serial: i + 1, fire: 3, pack: i < 6 ? 1 : 2, slot: (i % 6) + 1,
      material: (['paper', 'paper', 'paper', 'wood', 'wood', 'diamond'] as const)[i % 6], characterId: i % 2 ? 'a' : 'b',
      holoFrame: false, holoPicture: false, holo: 'none', edition: 1, editionOf: 1,
    })),
    packContents: [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]],
  },
}

describe('old saves and backups', () => {
  it('a Series without a recipe gets the Standard recipe with its Diamond setting', () => {
    expect(needsMigration(oldFire)).toBe(true)
    const f = migrateFire(oldFire)
    expect(f.recipe).toEqual(legacyDiamondRecipe(2))
    expect(compileRecipe(f.recipe).S).toBe(6)
    expect(previewPool(f.recipe, 2n).map(Number)).toEqual([6, 2, 1, 1, 2])
    expect(needsMigration(f)).toBe(false)
  })

  it('a locked deal is re-labelled: materials to Standard type indexes, slots to slot groups, pool to an array', () => {
    const f = migrateFire(oldFire)
    const d = f.deal!
    expect(d.pool).toEqual([6, 2, 1, 1, 2])
    expect(d.cardsPerPack).toBe(6)
    expect(d.cards.slice(0, 6).map((c) => c.type)).toEqual([0, 0, 0, 1, 1, 4])
    expect(d.cards.slice(0, 6).map((c) => c.group)).toEqual([0, 0, 0, 1, 2, 3])
    expect('material' in d.cards[0]).toBe(false)
    expect('diamonds' in d).toBe(false)
    expect(d.packContents).toEqual(oldFire.deal.packContents)
  })

  it('a Series that already has a recipe is left alone', () => {
    const f = migrateFire(oldFire)
    const again = migrateFire(f as FireRecord)
    expect(again).toEqual(f)
  })

  it('a recipe saved with its own PDA odds drops them (the odds are fixed for every Series)', () => {
    const f = migrateFire(oldFire)
    const saved = { ...f, recipe: { ...f.recipe, pdaOdds: ['0', '0', '0', '0', '1', '1', '1', '1', '1', '1'] } }
    expect(needsMigration(saved)).toBe(true)
    const m = migrateFire(saved)
    expect('pdaOdds' in m.recipe).toBe(false)
    expect(m.recipe).toEqual(f.recipe)
    expect(needsMigration(m)).toBe(false)
  })

  it('a missing Diamond setting reads as 1', () => {
    const { diamonds: _d, deal: _deal, ...noDiamonds } = oldFire
    expect(migrateFire(noDiamonds).recipe).toEqual(legacyDiamondRecipe(1))
  })

  it('a free-pack cap saved as packs becomes a percent of that drop (no cap stays no cap)', () => {
    const base = migrateFire(oldFire)
    const { creditPacksPercent: _p, creditPacksPerWallet: _w, ...rest } = standardSale()
    const old = (max: number, perWallet: number, paidPacks = 117, pressPacks = 50) => ({ ...base, sale: { ...rest, paidPacks, pressPacks, creditPacksMax: max, creditPacksPerWallet: perWallet } })
    expect(needsMigration(old(16, 0))).toBe(true)
    const m = migrateFire(old(16, 0))
    expect(m.sale!.creditPacksPercent).toBe('10.17')
    expect(creditPacksMax(saleOf(m))).toBe(16)
    expect(m.sale!.creditPacksPerWallet).toBe(0) // 0 = no limit, kept
    expect('creditPacksMax' in m.sale!).toBe(false)
    expect(needsMigration(m)).toBe(false)
    expect(migrateFire(old(0, 3)).sale).toMatchObject({ creditPacksPercent: '0', creditPacksPerWallet: 3 })
    for (const [max, paid] of [[1, 9_999], [7, 3], [333, 1_000_000], [1_000, 9_000]]) {
      // the nearest 0.01% at or under the old cap (exact up to 10,000 packs)
      const cap = creditPacksMax(saleOf(migrateFire(old(max, 0, paid, 0))))
      expect(cap).toBeLessThanOrEqual(Math.min(max, paid))
      expect(cap).toBeGreaterThan(Math.min(max, paid) - Math.max(1, paid / 10_000))
    }
  })

  it('an open Series takes its packs from the sale; one with no sale keeps its packs', () => {
    const { deal: _deal, ...open } = migrateFire(oldFire)
    const noSale = { ...open, packs: 1_000, sale: undefined }
    expect(needsMigration(noSale)).toBe(true)
    const m = migrateFire(noSale)
    expect(m.packs).toBe(1_000)
    expect(m.sale).toMatchObject({ paidPacks: 950, pressPacks: 50, plankOnly: 50 })
    expect(needsMigration(m)).toBe(false)
    const off = migrateFire({ ...open, packs: 150, sale: standardSale() })
    expect(off.packs).toBe(167)
    expect(migrateFire({ ...open, packs: 10, sale: undefined }).sale).toMatchObject({ paidPacks: 0, pressPacks: 10, plankOnly: 0 })
    // a locked deal keeps its packs (the Export checklist flags a sale that disagrees)
    const locked = migrateFire(oldFire)
    expect(locked.packs).toBe(2)
    expect(needsMigration(locked)).toBe(false)
  })
})
