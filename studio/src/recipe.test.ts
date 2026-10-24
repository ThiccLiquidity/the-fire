import standardSampleText from '../../contracts/test/cards/recipe-standard.json?raw'
import { describe, expect, it } from 'vitest'
import { oddsText, percentText } from './rarity'
import {
  FRESH_PDA_ODDS, HOLO_ONE, MAX_CARDS_PER_PACK, STANDARD_ROLLS, STANDARD_WEIGHTS, WEIGHT_TOTAL, characterOdds, characterWeightsFromJson,
  checkRecipe, cloneRecipe, fillTheRest, formatPercent, holoLooksFor, parsePercent, percentToScaled, percentTotal, percentTotalLine,
  percentTotalProblem, percentsToWeights, recipeFromJson, recipeJson, roundedPercent, scaledToPercent, simplifyWeights, slugify,
  specialAllHoloRecipe, standardRecipe, typeOdds, typeWeights, weightsToPercents, type Recipe,
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
    expect(typeWeights(back)).toEqual(typeWeights(standardRecipe()))
    expect(back.types.map((t) => t.percent)).toEqual(standardRecipe().types.map((t) => t.percent))
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
    r.types[2].percent = '0'
    expect(codes(r)[0]).toBe('BadType(2,weight)')
    expect(checkRecipe(r)[0].message).toBe('Type 3 (Fire): its % of cards must be above 0 (remove the type to leave it out).')
    const r2 = base()
    r2.types[0].holo = { mode: 'independent', frame: '1000000000000000001', picture: '0' }
    expect(codes(r2)[0]).toBe('BadType(0,holo chances)')
    const r3 = base()
    r3.types[4].holo = { mode: 'distribution', weights: ['0', '0', '0', '0'] }
    expect(codes(r3)[0]).toBe('BadType(4,holo weights)')
  })
  it('studio checks: number formats', () => {
    const r = base()
    r.types[2].percent = '1.555'
    expect(checkRecipe(r)[0]).toMatchObject({ code: 'Studio', message: 'Type 3 (Fire): % of cards must be a number from 0 to 100, with at most 2 decimals.' })
    const r2 = base()
    r2.types[2].percent = '101'
    expect(checkRecipe(r2)[0].code).toBe('Studio')
    // exact weights (a recipe.json or a locked old save): checked as weights
    const r3 = recipeFromJson(recipeJson(7, base(), []))
    r3.types[2].weight = (1n << 64n).toString()
    expect(checkRecipe(r3)[0].code).toBe('Studio')
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

describe('odds as percentages (the owner sets %, the contract gets weights)', () => {
  const sum = (w: bigint[]) => w.reduce((a, x) => a + x, 0n)

  it('parses and prints % of cards: 0 to 100, at most 2 decimals', () => {
    expect(parsePercent('24.15')).toBe(2415)
    expect(parsePercent('50')).toBe(5000)
    expect(parsePercent('3.9')).toBe(390)
    expect(parsePercent('0.01')).toBe(1)
    expect(parsePercent('100')).toBe(10_000)
    for (const bad of ['', ' ', '100.01', '1.555', '-1', 'abc', '.5', '1e2']) expect(parsePercent(bad), bad).toBeNull()
    expect(formatPercent(2415)).toBe('24.15')
    expect(formatPercent(390)).toBe('3.9')
    expect(formatPercent(10_000)).toBe('100')
    expect(formatPercent(-100)).toBe('-1')
  })

  it('exactly 100% gives weights that add up to 1,000,000 (percent x 10,000)', () => {
    const w = percentsToWeights(standardRecipe().types.map((t) => t.percent))
    expect(w).toEqual([500_000n, 241_500n, 149_700n, 48_900n, 39_900n, 20_000n])
    expect(sum(w)).toBe(WEIGHT_TOTAL)
    expect(WEIGHT_TOTAL).toBe(1_000_000n)
    expect(sum(percentsToWeights(['33.34', '33.33', '33.33']))).toBe(1_000_000n)
    expect(sum(percentsToWeights(['0.01', '99.99']))).toBe(1_000_000n)
  })

  it('the Standard exports the same odds as before: 5000 / 2415 / 1497 / 489 / 399 / 200 of 10,000', () => {
    const w = percentsToWeights(standardRecipe().types.map((t) => t.percent))
    const old = [5000n, 2415n, 1497n, 489n, 399n, 200n]
    // the same ratios at 1,000,000 ...
    w.forEach((x, i) => expect(x * 10_000n).toBe(old[i] * 1_000_000n))
    // ... and, with the shared zeros dropped, the very same numbers in recipe.json
    expect(simplifyWeights(w)).toEqual(old)
    expect(typeWeights(standardRecipe())).toEqual({ weights: old, total: 10_000n })
    expect(recipeJson(7, standardRecipe(), []).types.map((t) => t.weight)).toEqual([5000, 2415, 1497, 489, 399, 200])
    expect(recipeJson(8, specialAllHoloRecipe(), []).types.map((t) => t.weight)).toEqual([68, 30, 2])
    expect(simplifyWeights([0n, 0n])).toEqual([0n, 0n])
    expect(simplifyWeights([123n, 1000n])).toEqual([123n, 1000n])
  })

  it('weights to percentages: 2 decimals, rounding fixed so they add up to exactly 100%', () => {
    const total = (p: string[]) => percentTotal(p).total
    expect(weightsToPercents([5000, 2415, 1497, 489, 399, 200])).toEqual(['50', '24.15', '14.97', '4.89', '3.99', '2'])
    expect(weightsToPercents([1, 1, 1])).toEqual(['33.34', '33.33', '33.33'])
    expect(weightsToPercents([1, 1, 1, 7])).toEqual(['10', '10', '10', '70'])
    // the old Diamond Standard (of 1,002): 501 / 301 / 150 / 49 / 1
    expect(weightsToPercents([501, 301, 150, 49, 1])).toEqual(['50', '30.04', '14.97', '4.89', '0.1'])
    // the old pool for 167 packs, 20 characters: the Standard's percentages
    expect(weightsToPercents([501, 242, 150, 49, 40, 20])).toEqual(['50', '24.15', '14.97', '4.89', '3.99', '2'])
    // a weight too small to show still gets 0.01% (taken from the biggest)
    expect(weightsToPercents([1, 10_000_000])).toEqual(['0.01', '99.99'])
    expect(weightsToPercents([0, 3])).toEqual(['0', '100'])
    expect(weightsToPercents([0, 0])).toEqual(['0', '0'])
    expect(weightsToPercents(['25320565519103609', '1'])).toEqual(['99.99', '0.01'])
    let x = 7
    for (let k = 0; k < 300; k++) {
      const w = Array.from({ length: 1 + (k % 9) }, () => { x = (x * 1103515245 + 12345) % 2147483648; return 1 + (x % 100_000) })
      const p = weightsToPercents(w)
      expect(total(p), w.join(',')).toBe(10_000)
      p.forEach((v) => expect(parsePercent(v)).toBeGreaterThan(0))
      // each within 0.01% of exact (or 0.02% when a tiny one borrowed)
      const t = w.reduce((a, b) => a + b, 0)
      p.forEach((v, i) => expect(Math.abs(parsePercent(v)! - (w[i] / t) * 10_000)).toBeLessThan(2))
    }
  })

  it('the total line, its problem and the one-click fill', () => {
    const p = ['50', '24.15', '14.97', '4.89', '2']
    const t = percentTotal(p)
    expect(t).toMatchObject({ total: 9601, left: 399, ok: false })
    expect(percentTotalLine(t)).toBe('Total 96.01% · 3.99% left to assign')
    expect(percentTotalProblem(t, 'The card types')).toBe('The card types add up to 96.01%: they must add up to exactly 100% (3.99% left to assign).')
    expect(fillTheRest(p)).toEqual({ index: 0, percent: '53.99' })
    const over = ['50', '30', '21']
    expect(percentTotalLine(percentTotal(over))).toBe('Total 101% · 1% over')
    expect(percentTotalProblem(percentTotal(over), 'The characters')).toBe('The characters add up to 101%: they must add up to exactly 100% (1% too much).')
    expect(fillTheRest(over)).toEqual({ index: 0, percent: '49' })
    expect(percentTotalLine(percentTotal(['50', '50']))).toBe('Total 100% · all assigned')
    expect(percentTotalProblem(percentTotal(['50', '50']), 'x')).toBeNull()
    expect(fillTheRest(['50', '50'])).toBeNull()
    expect(fillTheRest(['50', 'x'])).toBeNull()
    expect(fillTheRest(['1', '150'])).toBeNull() // 150 isn't a %
    // never the one just edited: the biggest of the others takes it
    expect(fillTheRest(['1.5', '0.84', '0.83'].concat(Array(117).fill('0.83')), 0)?.index).toBe(1)
    expect(fillTheRest(p, 0)).toEqual({ index: 1, percent: '28.14' })
    expect(fillTheRest(over, 0)).toEqual({ index: 1, percent: '29' })
    expect(fillTheRest(['90', '5'], 1)).toEqual({ index: 0, percent: '95' })
    expect(fillTheRest(['95'], 0)).toEqual({ index: 0, percent: '100' }) // the only one
    expect(percentTotal(['1', '150']).bad).toEqual([1])
  })

  it('a recipe is valid only when its types add up to exactly 100%', () => {
    const r = standardRecipe()
    r.types[5].percent = '1'
    const problems = checkRecipe(r)
    expect(problems).toEqual([{ code: 'Studio', where: 'total', message: 'The card types add up to 99%: they must add up to exactly 100% (1% left to assign).' }])
    r.types[0].percent = '51'
    expect(checkRecipe(r)).toEqual([])
    // the contract itself would take any total: only the studio refuses it
    r.types[0].percent = '60'
    expect(checkRecipe(r).filter((p) => p.code !== 'Studio')).toEqual([])
  })

  it('a recipe.json keeps its exact weights (the contract\'s odds) beside its percentages; a copy is set by %', () => {
    const j = recipeJson(7, standardRecipe(), [])
    j.types.forEach((t, i) => { t.weight = [7, 3, 1, 1, 1, 1][i] })
    const r = recipeFromJson(j)
    expect(typeWeights(r).weights).toEqual([7n, 3n, 1n, 1n, 1n, 1n])
    expect(r.types.map((t) => t.percent)).toEqual(['50', '21.43', '7.15', '7.14', '7.14', '7.14'])
    expect(checkRecipe(r)).toEqual([])
    const copy = cloneRecipe(r, () => 'id')
    expect(copy.types.some((t) => 'weight' in t)).toBe(false)
    expect(typeWeights(copy).weights).toEqual([5000n, 2143n, 715n, 714n, 714n, 714n])
  })

  it('odds read "% · about 1 in N"', () => {
    expect(oddsText(0.0399)).toBe('3.99% · about 1 in 25 cards')
    expect(oddsText(0.5)).toBe('50% · about 1 in 2 cards')
    expect(oddsText(0.002)).toBe('0.2% · about 1 in 500 cards')
    expect(oddsText(0.25, '')).toBe('25% · about 1 in 4')
    expect(oddsText(0.9999)).toBe('99.99% · almost every card') // never "about 1 in 1" under 100%
    expect(oddsText(0.96, '')).toBe('96% · almost every one')
    expect(oddsText(0.9)).toBe('90% · about 1 in 1.1 cards')
    expect(oddsText(0.68)).toBe('68% · about 1 in 1.5 cards')
    expect(oddsText(0.3)).toBe('30% · about 1 in 3.3 cards')
    expect(oddsText(0.001)).toBe('0.1% · about 1 in 1,000 cards')
    expect(oddsText(1)).toBe('100% · every card')
    expect(oddsText(0)).toBe('0%')
    expect(percentText(0.000042)).toBe('0.0042%')
    expect(percentText(0.99999)).toBe('99.99%')
  })
})
