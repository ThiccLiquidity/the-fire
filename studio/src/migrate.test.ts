import { describe, expect, it } from 'vitest'
import { compileRecipe, legacyDiamondRecipe, previewPool } from './recipe'
import { migrateFire, needsMigration } from './migrate'
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

  it('a missing Diamond setting reads as 1', () => {
    const { diamonds: _d, deal: _deal, ...noDiamonds } = oldFire
    expect(migrateFire(noDiamonds).recipe).toEqual(legacyDiamondRecipe(1))
  })
})
