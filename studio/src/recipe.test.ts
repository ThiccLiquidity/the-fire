import standardSampleText from '../../contracts/test/cards/recipe-standard.json?raw'
import { describe, expect, it } from 'vitest'
import {
  FRESH_PDA_ODDS, HOLO_ONE, MAX_CARDS_PER_PACK, STANDARD_ROLLS, STANDARD_WEIGHTS, characterOdds, characterWeightsFromJson, checkRecipe,
  holoLooksFor, percentToScaled, recipeFromJson, recipeJson, roundedPercent, scaledToPercent, slugify, specialAllHoloRecipe,
  standardRecipe, typeOdds, typeWeights, type Recipe,
} from './recipe'

const codes = (r: Recipe) => checkRecipe(r).map((p) => p.code)

describe('Standard recipe', () => {
  it('is valid, 6 cards per pack', () => {
    expect(checkRecipe(standardRecipe())).toEqual([])
    expect(standardRecipe().cardsPerPack).toBe(6)
  })

  it('odds out of 10,000: the old pool dealing\'s expected share per card (167 packs, 20 characters)', () => {
    const { weights, total } = typeWeights(standardRecipe())
    expect(total).toBe(10_000n)
    expect(weights).toEqual([5000n, 2415n, 1497n, 489n, 399n, 200n])
    // the old pool for 167 packs and 20 characters: 501 Paper, 242 Wood, 150 Fire, 49 Coal, 40 Gold, 20 Full Art of 1,002
    const old = [501, 242, 150, 49, 40, 20]
    typeOdds(standardRecipe()).forEach((p, i) => expect(Math.abs(p - old[i] / 1002)).toBeLessThan(0.00005))
    expect(STANDARD_WEIGHTS.fullart).toBe('200')
  })

  it('recipe.json has no PDA odds: they are fixed in FirePsa for every Series', () => {
    const j = recipeJson(7, standardRecipe(), [{ name: 'A', category: 'B' }])
    expect('pdaOdds' in j).toBe(false)
    expect(FRESH_PDA_ODDS).toEqual([0, 0, 0, 0, 0, 0, 2900, 4000, 3000, 100])
  })

  it('recipe.json is exactly contracts/test/cards/recipe-standard.json', () => {
    const sample = JSON.parse(standardSampleText)
    const j = recipeJson(7, standardRecipe(), sample.characters, 'ipfs://bafyexampleimages/')
    expect(j).toEqual(sample)
    expect(Object.keys(j)).toEqual(Object.keys(sample))
    const back = recipeFromJson(j)
    expect(back.cardsPerPack).toBe(6)
    expect(back.types.map((t) => t.weight)).toEqual(standardRecipe().types.map((t) => t.weight))
    expect(characterWeightsFromJson(j)).toBeUndefined()
  })

  it('character weights go into recipe.json only when they differ', () => {
    const chars = [{ name: 'A', category: 'X' }, { name: 'B', category: 'X' }]
    expect(recipeJson(7, standardRecipe(), chars, undefined, undefined, [1, 1]).characters).toEqual(chars)
    const j = recipeJson(7, standardRecipe(), chars, undefined, undefined, [3, 1])
    expect(j.characters).toEqual([{ name: 'A', category: 'X', weight: 3 }, { name: 'B', category: 'X', weight: 1 }])
    expect(characterWeightsFromJson(j)).toEqual([3, 1])
    expect(characterOdds([3, 1], 2)).toEqual([0.75, 0.25])
    expect(characterOdds(undefined, 4)).toEqual([0.25, 0.25, 0.25, 0.25])
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
    expect(r.cardsPerPack).toBe(3)
    expect(r.types.map((_, i) => holoLooksFor(r, i))).toEqual([['frame', 'picture', 'full'], ['frame', 'picture', 'full'], ['full']])
  })
})

describe('checkRecipe mirrors RecipeCompiler.compile', () => {
  const base = () => standardRecipe()
  it('no types; cards per pack 1 to 1,000', () => {
    expect(codes({ types: [], cardsPerPack: 6 })[0]).toBe('BadRecipe(no types)')
    const r = base()
    r.cardsPerPack = 0
    expect(codes(r)[0]).toBe('BadRecipe(cards per pack)')
    r.cardsPerPack = MAX_CARDS_PER_PACK + 1
    expect(codes(r)[0]).toBe('BadRecipe(cards per pack)')
    r.cardsPerPack = MAX_CARDS_PER_PACK
    expect(codes(r)).toEqual([])
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
  it('weights at least 1, holo chances and weights', () => {
    const r = base()
    r.types[2].weight = '0'
    expect(codes(r)[0]).toBe('BadType(2,weight)')
    const r2 = base()
    r2.types[0].holo = { mode: 'independent', frame: '1000000000000000001', picture: '0' }
    expect(codes(r2)[0]).toBe('BadType(0,holo chances)')
    const r3 = base()
    r3.types[4].holo = { mode: 'distribution', weights: ['0', '0', '0', '0'] }
    expect(codes(r3)[0]).toBe('BadType(4,holo weights)')
  })
  it('studio checks: number formats', () => {
    const r = base()
    r.types[2].weight = '1.5'
    expect(checkRecipe(r)[0].code).toBe('Studio')
    const r2 = base()
    r2.types[2].weight = (1n << 64n).toString()
    expect(checkRecipe(r2)[0].code).toBe('Studio')
  })
})

describe('helpers', () => {
  it('roundedPercent: holo rolls shown to 2 decimals, the stored value untouched', () => {
    expect(scaledToPercent(BigInt(STANDARD_ROLLS.paper), HOLO_ONE)).toBe('2.5320565519103609')
    expect(roundedPercent(BigInt(STANDARD_ROLLS.paper), HOLO_ONE)).toBe('2.53')
    expect(roundedPercent(BigInt(STANDARD_ROLLS.wood), HOLO_ONE)).toBe('5.13')
    expect(roundedPercent(BigInt(STANDARD_ROLLS.fire), HOLO_ONE)).toBe('29.29')
    expect(roundedPercent(BigInt(STANDARD_ROLLS.coal), HOLO_ONE)).toBe('68.38')
    expect(roundedPercent(HOLO_ONE / 2n, HOLO_ONE)).toBe('50')
    expect(roundedPercent(HOLO_ONE, HOLO_ONE)).toBe('100')
    expect(roundedPercent(0n, HOLO_ONE)).toBe('0')
    expect(roundedPercent(10n ** 12n, HOLO_ONE)).toBe('0.0001') // too small to round: shown exactly
    expect(standardRecipe().types[0].holo).toEqual({ mode: 'independent', frame: STANDARD_ROLLS.paper, picture: STANDARD_ROLLS.paper })
  })
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
    expect(percentToScaled('2.5320565519103609', 10n ** 18n)).toBe(25320565519103609n)
  })
})
