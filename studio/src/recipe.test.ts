import poolFixtureText from '../../contracts/test/cards/pool-fixture.json?raw'
import standardSampleText from '../../contracts/test/cards/recipe-standard.json?raw'
import { describe, expect, it } from 'vitest'
import { computePool } from './deal'
import {
  checkRecipe, classicRecipe, compileRecipe, holoLooksFor, percentToScaled, previewPool, recipeFromJson, recipeJson, scaledToPercent, slugify,
  specialAllHoloRecipe, standardRecipe, type Recipe,
} from './recipe'
import { MATERIALS } from './rules'

const fixture = JSON.parse(poolFixtureText) as {
  rows: { packs: number; diamonds: number; counts: number[] }[]
}
const codes = (r: Recipe) => checkRecipe(r).map((p) => p.code)

describe('Standard recipe', () => {
  it('is valid, 6 cards per pack', () => {
    expect(checkRecipe(standardRecipe())).toEqual([])
    expect(compileRecipe(standardRecipe()).S).toBe(6)
  })

  it('pool port = computePool on every row of pool-fixture.json (the contract parity fixture)', () => {
    for (const row of fixture.rows) {
      const got = previewPool(classicRecipe(row.diamonds), BigInt(row.packs)).map(Number)
      expect(got, `${row.packs} packs, ${row.diamonds} diamonds`).toEqual(row.counts)
      if (row.packs < 1e6) expect(got).toEqual(MATERIALS.map((m) => computePool(row.packs, row.diamonds)[m]))
    }
  })

  it('167 packs and 1 Gold: 501 / 301 / 150 / 49 / 1', () => {
    expect(previewPool(classicRecipe(1), 167n)).toEqual([501n, 301n, 150n, 49n, 1n])
  })

  it('the Standard recipe: 15 Gold and one Full Art per character', () => {
    // 167 packs, 10 characters: Full Art and Gold come out of the Wood-or-better / Fire-or-better slots
    expect(previewPool(standardRecipe(), 167n, 10n)).toEqual([501n, 277n, 150n, 49n, 15n, 10n])
    expect(previewPool(standardRecipe(), 167n, 1n)[5]).toBe(1n)
    expect(previewPool(standardRecipe(), 3n, 10n)[5]).toBe(3n) // at most one per pack's worth
  })

  it('a per-character type: 1 to 65,535 each', () => {
    const r = standardRecipe()
    r.types[5].amount = '0'
    expect(codes(r)).toContain('BadType(5,per character)')
    r.types[5].amount = '65536'
    expect(codes(r)).toContain('BadType(5,per character)')
    r.types[5].amount = '2'
    expect(codes(r)).toEqual([])
    expect(previewPool(r, 1000n, 7n)[5]).toBe(14n)
  })

  it('fresh PDA odds: grades 1-4 stay 0', () => {
    const r = standardRecipe()
    r.pdaOdds[2] = '5'
    expect(codes(r)).toContain('BadOdds')
  })

  it('recipe.json is exactly the shape of contracts/test/cards/recipe-standard.json', () => {
    const sample = JSON.parse(standardSampleText)
    const j = recipeJson(7, standardRecipe(15), sample.characters, 'ipfs://bafyexampleimages/')
    // the sample writes slot 2 as an explicit list and slot 4 with an explicit mustHolo: false; same recipe
    expect(j.types).toEqual(sample.types)
    expect(j.pdaOdds).toEqual(sample.pdaOdds)
    expect(j.slots).toEqual([{ count: 3, types: [0] }, { count: 1, types: [1] }, { count: 1, minRank: 1 }, { count: 1, minRank: 2 }])
    expect(j.fire).toBe(7)
    expect(j.imagesBase).toBe('ipfs://bafyexampleimages/')
    // and it reads back to the same pools
    const back = recipeFromJson(j)
    for (const p of [1n, 7n, 167n]) expect(previewPool(back, p, 3n)).toEqual(previewPool(standardRecipe(15), p, 3n))
  })

  it('holo looks: 4 per type, Gold and Full Art 1 (always full holo) = 18 per character', () => {
    const r = standardRecipe()
    expect(r.types.map((_, i) => holoLooksFor(r, i).length)).toEqual([4, 4, 4, 4, 1, 1])
  })
})

describe('Special 3-card all-holo recipe', () => {
  it('is valid, 3 cards, never plain', () => {
    const r = specialAllHoloRecipe()
    expect(checkRecipe(r)).toEqual([])
    expect(compileRecipe(r).S).toBe(3)
    expect(r.types.map((_, i) => holoLooksFor(r, i))).toEqual([['frame', 'picture', 'full'], ['frame', 'picture', 'full'], ['full']])
  })
  it('the floor keeps one Coal-or-better per pack', () => {
    for (const p of [1n, 2n, 3n, 10n, 100n, 12345n]) {
      const [fire, coal, diamond] = previewPool(specialAllHoloRecipe(), p)
      expect(fire + coal + diamond).toBe(3n * p)
      expect(coal + diamond).toBeGreaterThanOrEqual(p)
      expect(diamond).toBeLessThanOrEqual(p)
    }
  })
})

describe('checkRecipe mirrors RecipeDealer.check', () => {
  const base = () => standardRecipe()
  it('filler: none, or two', () => {
    const r = base()
    r.types[1].supply = 'share'
    r.types[1].amount = '1'
    expect(codes(r)[0]).toBe('BadFiller')
    const r2 = base()
    r2.types[0].supply = 'filler'
    expect(codes(r2)[0]).toBe('BadFiller')
  })
  it('slug and text rules', () => {
    const r = base()
    r.types[2].slug = 'Fire'
    expect(codes(r)[0]).toBe('BadType(2,slug characters)')
    r.types[2].slug = 'wood'
    expect(codes(r)[0]).toBe('BadType(2,slug repeated)')
    r.types[2].slug = 'x'.repeat(33)
    expect(codes(r)[0]).toBe('BadType(2,slug length)')
    r.types[2].slug = 'fire'
    r.types[2].name = 'Fi"re'
    expect(codes(r)[0]).toBe('BadText')
    r.types[2].name = ''
    expect(codes(r)[0]).toBe('BadType(2,name length)')
  })
  it('share above 100%, holo chances and weights', () => {
    const r = base()
    r.types[2].amount = '1000000001'
    expect(codes(r)[0]).toBe('BadType(2,share above 100%)')
    const r2 = base()
    r2.types[0].holo = { mode: 'independent', frame: '1000000000000000001', picture: '0' }
    expect(codes(r2)[0]).toBe('BadType(0,holo chances)')
    const r3 = base()
    r3.types[4].holo = { mode: 'distribution', weights: ['0', '0', '0', '0'] }
    expect(codes(r3)[0]).toBe('BadType(4,holo weights)')
  })
  it('overlapping slot sets are refused (NotNested); nested and disjoint are fine', () => {
    const r = base()
    r.slots[0] = { ...r.slots[0], typeIds: ['paper', 'wood'] }
    r.slots[1] = { ...r.slots[1], typeIds: ['wood', 'fire'] }
    expect(codes(r)[0]).toBe('NotNested(0,1)')
    expect(checkRecipe(r)[0].message).toMatch(/overlap/)
  })
  it('a type no slot takes, and never-holo in a must-holo slot', () => {
    const r = base()
    r.slots[2] = { ...r.slots[2], kind: 'types', typeIds: ['wood'] }
    r.slots[3] = { ...r.slots[3], minRank: 2, maxRank: 3 }
    expect(codes(r)[0]).toBe('TypeNeverDealt(4)')
    const r2 = base()
    r2.slots[0].mustHolo = true
    r2.types[0].holo = { mode: 'independent', frame: '0', picture: '0' }
    expect(codes(r2)[0]).toBe('NeverHolo(0,0)')
  })
  it('slots: none, a zero count, an empty rank range', () => {
    const r = base()
    r.slots = []
    expect(codes(r)[0]).toBe('BadSlot(0,no slots)')
    const r2 = base()
    r2.slots[1].count = 0
    expect(codes(r2)[0]).toBe('BadSlot(1,count)')
    const r3 = base()
    r3.slots[3] = { ...r3.slots[3], minRank: 9 }
    expect(codes(r3)[0]).toBe('BadSlot(3,no type in rank range)')
    r3.slots[3] = { ...r3.slots[3], minRank: 3, maxRank: 2 }
    expect(codes(r3)[0]).toBe('BadSlot(3,rank range)')
  })
  it('studio checks: number formats, PDA odds', () => {
    const r = base()
    r.types[2].amount = '1.5'
    expect(checkRecipe(r)[0].code).toBe('Studio')
    const r2 = base()
    r2.pdaOdds = r2.pdaOdds.map(() => '0')
    expect(codes(r2)).toEqual(['BadOdds'])
  })
})

describe('helpers', () => {
  it('slugify', () => {
    expect(slugify('Gold')).toBe('gold')
    expect(slugify('  Rose Gold!! ')).toBe('rose-gold')
    expect(slugify('Émeraude')).toBe('emeraude')
    expect(slugify('x'.repeat(40))).toHaveLength(32)
  })
  it('percent <-> scaled', () => {
    expect(percentToScaled('15', 1_000_000_000n)).toBe(150_000_000n)
    expect(percentToScaled('4.9', 1_000_000_000n)).toBe(49_000_000n)
    expect(percentToScaled('0.0000001', 1_000_000_000n)).toBe(1n)
    expect(percentToScaled('0.00000001', 1_000_000_000n)).toBeNull()
    expect(percentToScaled('101', 1_000_000_000n)).toBeNull()
    expect(scaledToPercent(25320565519103609n, 10n ** 18n)).toBe('2.5320565519103609')
    expect(scaledToPercent(150_000_000n, 1_000_000_000n)).toBe('15')
    expect(percentToScaled('2.5320565519103609', 10n ** 18n)).toBe(25320565519103609n)
  })
})
