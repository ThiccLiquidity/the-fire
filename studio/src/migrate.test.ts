import { describe, expect, it } from 'vitest'
import { checkRecipe, legacyDiamondRecipe, standardRecipe, typeWeights } from './recipe'
import { characterOddsProblems, characterPercentsOf, characterWeightsOf, charactersAllEqual } from './series'
import { migrateCharacterArt, migrateFire, needsMigration, oldRecipeToOdds } from './migrate'
import { creditPacksMax, groupPacks, saleOf, standardSale } from './sale'
import type { Character, FireRecord, ImageSlot } from './types'

/** A Series as saved before recipes: Diamonds on the record, a locked deal stored by material. */
const oldFire = {
  number: 3, characterIds: ['a', 'b'], packs: 2, diamonds: 2, seed: 's', createdAt: 1, updatedAt: 1,
  deal: {
    method: 'sample-sha256ctr-v1', fire: 3, packs: 2, seed: 's', characterIds: ['a', 'b'],
    pool: { paper: 6, wood: 2, burning: 1, charcoal: 1, diamond: 2 }, diamonds: 2, firstSerial: 1, nextSerial: 13,
    cards: Array.from({ length: 12 }, (_, i) => ({
      serial: i + 1, fire: 3, pack: i < 6 ? 1 : 2, slot: (i % 6) + 1,
      material: (['paper', 'paper', 'paper', 'wood', 'wood', 'diamond'] as const)[i % 6], characterId: i % 2 ? 'a' : 'b',
      holoFrame: false, holoPicture: false, holo: 'none', edition: 1, editionOf: 1, // saved before print numbers
    })),
    packContents: [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]],
  },
}

describe('old saves and backups', () => {
  it('a Series without a recipe gets the old Standard (Diamond) recipe, as odds', () => {
    expect(needsMigration(oldFire)).toBe(true)
    const f = migrateFire(oldFire)
    expect(f.recipe).toEqual(legacyDiamondRecipe())
    expect(f.recipe.cardsPerPack).toBe(6)
    expect(typeWeights(f.recipe).weights).toEqual([501n, 301n, 150n, 49n, 1n])
    expect(needsMigration(f)).toBe(false)
  })

  it('a recipe saved with the old pool rules becomes odds at the cards its rules gave', () => {
    const old = {
      types: [
        { id: 'p', name: 'Paper', slug: 'paper', rank: 0, supply: 'perPack', amount: '3', maxPerPack: '0', holo: { mode: 'independent', frame: '1', picture: '1' }, frameSet: 'paper' },
        { id: 'w', name: 'Wood', slug: 'wood', rank: 1, supply: 'filler', amount: '0', maxPerPack: '0', holo: { mode: 'independent', frame: '1', picture: '1' }, frameSet: 'wood' },
        { id: 'f', name: 'Fire', slug: 'fire', rank: 2, supply: 'share', amount: '150000000', maxPerPack: '0', holo: { mode: 'independent', frame: '1', picture: '1' }, frameSet: 'burning' },
        { id: 'c', name: 'Coal', slug: 'coal', rank: 3, supply: 'share', amount: '49000000', maxPerPack: '0', holo: { mode: 'independent', frame: '1', picture: '1' }, frameSet: 'charcoal' },
        { id: 'g', name: 'Gold', slug: 'gold', rank: 4, supply: 'perCharacter', amount: '2', maxPerPack: '1', holo: { mode: 'distribution', weights: ['0', '0', '0', '1'] }, frameSet: 'gold' },
        { id: 'a', name: 'Full Art', slug: 'fullart', rank: 5, supply: 'perCharacter', amount: '1', maxPerPack: '1', holo: { mode: 'distribution', weights: ['0', '0', '0', '1'] }, frameSet: 'fullart' },
      ],
      slots: [{ count: 3 }, { count: 1 }, { count: 1 }, { count: 1 }],
    } as const
    const r = oldRecipeToOdds(old as never, 167, 20)
    expect(r.cardsPerPack).toBe(6)
    expect(typeWeights(r).weights).toEqual([501n, 242n, 150n, 49n, 40n, 20n])
    expect(r.types.map((t) => t.id)).toEqual(['p', 'w', 'f', 'c', 'g', 'a'])
    const { deal: _deal, ...open } = migrateFire(oldFire)
    const m = migrateFire({ ...open, packs: 167, characterIds: Array.from({ length: 20 }, (_, i) => `c${i}`), recipe: old as never })
    // an open Series: its odds become percentages (the old pool's shares are the Standard's)
    expect(m.recipe.types.map((t) => t.percent)).toEqual(['50', '24.15', '14.97', '4.89', '3.99', '2'])
    expect(m.recipe.types.some((t) => 'weight' in t)).toBe(false)
    expect(typeWeights(m.recipe).weights).toEqual([5000n, 2415n, 1497n, 489n, 399n, 200n])
    expect(needsMigration(m)).toBe(false)
    expect(typeWeights(standardRecipe()).weights).toEqual([5000n, 2415n, 1497n, 489n, 399n, 200n])
  })

  it('a locked deal is re-labelled: materials to Standard type indexes, pool to an array', () => {
    const f = migrateFire(oldFire)
    const d = f.deal!
    expect(d.pool).toEqual([6, 2, 1, 1, 2])
    expect(d.cardsPerPack).toBe(6)
    expect(d.cards.slice(0, 6).map((c) => c.type)).toEqual([0, 0, 0, 1, 1, 4])
    expect('material' in d.cards[0]).toBe(false)
    expect('diamonds' in d).toBe(false)
    expect(d.packContents).toEqual(oldFire.deal.packContents)
    // editions ("k of N") become print numbers: per exact card, in the order dealt
    expect(d.cards.map((c) => c.printNumber)).toEqual([1, 1, 2, 1, 1, 1, 3, 2, 4, 2, 2, 2])
    expect('edition' in d.cards[0] || 'editionOf' in d.cards[0]).toBe(false)
    expect(needsMigration(f)).toBe(false)
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


  /** The Standard sale as saved before drop groups. */
  const oldStandard = {
    start: 0, paidPacks: 117, pressPacks: 50, priceUsd: '2.50', paperPerPack: '1', paperCapUsd: '1', plankBurnPercent: '10',
    paperBurnPercent: '20', plankOnly: 50, plankOnlyHours: 48, walletLimit: 5, liftHours: 48, maxPerTx: 50, holderHours: 24, holderRoot: '',
    regularWalletsHours: 48, pressPerPress: 1, pressPerWallet: 1, pressHours: 24, pressPrice: 'paper', pressUsd: '0',
    pressPaper: '1', creditsPerPick: 1, creditPacksPercent: '10', creditPacksPerWallet: 3,
  }

  it('a free-pack cap saved as packs becomes a percent of that drop (no cap stays no cap)', () => {
    const base = migrateFire(oldFire)
    const { creditPacksPercent: _p, creditPacksPerWallet: _w, ...rest } = oldStandard
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

  it('a sale saved before drop groups becomes a Press group and an Everyone group', () => {
    const { deal: _deal, ...open } = migrateFire(oldFire)
    const f = { ...open, packs: 167, sale: oldStandard }
    expect(needsMigration(f)).toBe(true)
    const m = migrateFire(f)
    expect(m.packs).toBe(167)
    expect(m.sale!.packs).toBe(167)
    expect(m.sale!.groups.map((g) => [g.name, g.packs, g.gate, g.rollTo])).toEqual([['Paper Press holders', 50, 'nft', 1], ['Everyone', 117, 'open', -1]])
    expect(m.sale!.creditGroup).toBe(1)
    expect('paidPacks' in m.sale!).toBe(false)
    expect(needsMigration(m)).toBe(false)
  })

  it('an open Series takes its packs from the sale; one with no sale keeps its packs', () => {
    const { deal: _deal, ...open } = migrateFire(oldFire)
    const noSale = { ...open, packs: 1_000, sale: undefined }
    expect(needsMigration(noSale)).toBe(true)
    const m = migrateFire(noSale)
    expect(m.packs).toBe(1_000)
    expect(m.sale!.packs).toBe(1_000)
    expect(groupPacks(m.sale!)).toEqual([50, 40, 910, 0]) // Everyone takes the rest
    expect(needsMigration(m)).toBe(false)
    const off = migrateFire({ ...open, packs: 150, sale: standardSale() })
    expect(off.packs).toBe(167)
    expect(groupPacks(migrateFire({ ...open, packs: 10, sale: undefined }).sale!)).toEqual([10, 0, 0, 0])
    // a locked deal keeps its packs (the Export checklist flags a sale that disagrees)
    const locked = migrateFire(oldFire)
    expect(locked.packs).toBe(2)
    expect(needsMigration(locked)).toBe(false)
  })
})

describe('odds saved as weights become percentages', () => {
  const { deal: _deal, ...openBase } = migrateFire(oldFire)
  /** A recipe as saved before percentages: each type with only a weight. */
  const weightsOnly = (w: string[]) => ({ ...standardRecipe(), types: standardRecipe().types.map(({ percent: _p, ...t }, i) => ({ ...t, weight: w[i] })) })

  it('an open Series: type weights to % of cards (adding up to 100%), exact weights dropped', () => {
    const saved = { ...openBase, recipe: weightsOnly(['5000', '2415', '1497', '489', '399', '200']) }
    expect(needsMigration(saved)).toBe(true)
    const m = migrateFire(saved)
    expect(m.recipe).toEqual(standardRecipe())
    expect(needsMigration(m)).toBe(false)
    // rounding fixed so they add up to exactly 100%
    const odd = migrateFire({ ...openBase, recipe: weightsOnly(['1', '1', '1', '1', '1', '1']) })
    expect(odd.recipe.types.map((t) => t.percent)).toEqual(['16.67', '16.67', '16.67', '16.67', '16.66', '16.66'])
    expect(checkRecipe(odd.recipe)).toEqual([])
  })

  it('an open Series: character weights to % of cards; all equal weights to "All equal"', () => {
    const ids = ['a', 'b', 'c', 'd']
    const m = migrateFire({ ...openBase, characterIds: ids, characterWeights: { a: 1, b: 1, c: 1, d: 7 } })
    expect(m.characterPercents).toEqual({ a: '10', b: '10', c: '10', d: '70' })
    expect('characterWeights' in m).toBe(false)
    expect(characterWeightsOf(m)).toEqual([1, 1, 1, 7])
    expect(needsMigration(m)).toBe(false)
    const eq = migrateFire({ ...openBase, characterIds: ids, characterWeights: { a: 2, b: 2, c: 2, d: 2 } })
    expect(eq.characterPercents).toBeUndefined()
    expect(charactersAllEqual(eq)).toBe(true)
    const thirds = migrateFire({ ...openBase, characterIds: ['a', 'b', 'c'], characterWeights: { a: 1, b: 2, c: 3 } })
    expect(thirds.characterPercents).toEqual({ a: '16.67', b: '33.33', c: '50' })
    expect(characterOddsProblems(thirds)).toEqual([])
  })

  it('a locked Series keeps its exact weights (its odds and recipe.json never change), shown as %', () => {
    const f = migrateFire(oldFire)
    expect(typeWeights(f.recipe).weights).toEqual([501n, 301n, 150n, 49n, 1n])
    expect(f.recipe.types.map((t) => t.percent)).toEqual(['50', '30.04', '14.97', '4.89', '0.1'])
    const locked = migrateFire({ ...f, recipe: weightsOnly(['7', '3', '1', '1', '1', '1']), characterWeights: { a: 3, b: 1 } })
    expect(typeWeights(locked.recipe).weights).toEqual([7n, 3n, 1n, 1n, 1n, 1n])
    expect(locked.recipe.types.map((t) => t.percent)).toEqual(['50', '21.43', '7.15', '7.14', '7.14', '7.14'])
    expect(locked.characterWeights).toEqual({ a: 3, b: 1 })
    expect(locked.characterIds).toEqual(['a', 'b'])
    expect(characterWeightsOf(locked)).toEqual([3, 1])
    expect(characterPercentsOf(locked)).toEqual(['75', '25'])
    expect(characterOddsProblems(locked)).toEqual([])
    expect(needsMigration(locked)).toBe(false)
  })
})

describe('character odds as percentages', () => {
  const f = (p?: Record<string, string>) => ({ characterIds: ['a', 'b', 'c'], characterPercents: p })
  it('"All equal" (no percentages): no weights, no problems', () => {
    expect(charactersAllEqual(f())).toBe(true)
    expect(characterWeightsOf(f())).toBeUndefined()
    expect(characterOddsProblems(f())).toEqual([])
  })
  it('percentages to weights (percent x 10,000, simplified); equal percentages send none', () => {
    expect(characterWeightsOf(f({ a: '10', b: '20', c: '70' }))).toEqual([1, 2, 7])
    expect(characterWeightsOf(f({ a: '33.34', b: '33.33', c: '33.33' }))).toEqual([3334, 3333, 3333])
    expect(characterWeightsOf({ characterIds: ['a', 'b'], characterPercents: { a: '50', b: '50' } })).toBeUndefined()
  })
  it('must each be above 0 and add up to exactly 100%', () => {
    expect(characterOddsProblems(f({ a: '10', b: '20', c: '70' }))).toEqual([])
    expect(characterOddsProblems(f({ a: '10', b: '20' }), (k) => ['Ember', 'Ash', 'Cinder'][k])).toEqual([
      'Cinder has 0% of cards: give every character more than 0%, or turn "All equal" back on.',
      'The characters add up to 30%: they must add up to exactly 100% (70% left to assign).',
    ])
    expect(characterOddsProblems(f({ a: '10.123', b: '20', c: '70' }))[0]).toBe('c0: % of cards must be a number from 0 to 100, with at most 2 decimals.')
  })
})

describe('one picture per set (holo is drawn)', () => {
  const slot = (k: string) => ({ originalKey: k, keyMagenta: false, tolerance: 0, feather: 0, despill: 0, width: 1, height: 1, fileName: k, updatedAt: 1 }) as ImageSlot
  const char = (images: Character['images']) => ({ id: 'c', name: 'C', images, createdAt: 1 }) as unknown as Character

  it("Full Art's holo picture becomes its picture", () => {
    const c = migrateCharacterArt(char({ fullart: { holo: slot('fa') }, wood: { normal: slot('w'), holo: slot('wh') } }))
    expect(c?.images.fullart).toEqual({ normal: slot('fa') })
    expect(c?.images.wood).toEqual({ normal: slot('w'), holo: slot('wh') })
  })

  it('leaves a character alone when there is nothing to move', () => {
    expect(migrateCharacterArt(char({ fullart: { normal: slot('fa') } }))).toBeNull()
    expect(migrateCharacterArt(char({ fullart: { normal: slot('a'), holo: slot('b') } }))).toBeNull()
    expect(migrateCharacterArt(char({ paper: { normal: slot('p') } }))).toBeNull()
  })
})
