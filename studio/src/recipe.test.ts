import standardSampleText from '../../contracts/test/cards/recipe-standard.json?raw'
import { describe, expect, it } from 'vitest'
import { oddsText, percentText } from './rarity'
import {
  FRESH_PDA_ODDS, HOLO_ONE, MAX_CARDS_PER_PACK, STANDARD_ROLLS, STANDARD_SLOT_WEIGHTS, WEIGHT_TOTAL, cardsPerPack, characterOdds,
  characterWeightsFromJson, checkRecipe, cloneRecipe, fillTheRest, formatPercent, holoLooksFor, packShapeLine, parsePercent,
  percentToScaled, percentTotal, percentTotalLine, percentTotalProblem, percentsToWeights, perPackCounts, recipeFromJson, recipeJson,
  roundedPercent, scaledToPercent, simplifyWeights, slotLabel, slotOdds, slotPercents, slotWeights, slugify, specialAllHoloRecipe,
  standardRecipe, typeOdds, weightsToPercents, type Recipe,
} from './recipe'

const codes = (r: Recipe) => checkRecipe(r).map((p) => p.code)

describe('Standard recipe', () => {
  it('is valid, 6 cards per pack: 3 Paper · 1 Wood · 1 Wood or better · 1 Fire or better', () => {
    const r = standardRecipe()
    expect(checkRecipe(r)).toEqual([])
    expect(cardsPerPack(r)).toBe(6)
    expect(packShapeLine(r)).toBe('3 Paper · 1 Wood · 1 Wood or better · 1 Fire or better')
    expect(r.slots.map((_, s) => slotLabel(r, s))).toEqual(['Paper', 'Wood', 'Wood or better', 'Fire or better'])
  })

  it('slot weights are StandardRecipe.sol\'s: Wood or better of 1,000, Fire or better of 10,000', () => {
    const sw = slotWeights(standardRecipe())
    expect(sw.map((x) => x.count)).toEqual([3, 1, 1, 1])
    expect(sw.map((x) => x.weights.map(String))).toEqual(STANDARD_SLOT_WEIGHTS)
    expect(sw.map((x) => x.total)).toEqual([1n, 1n, 1000n, 10_000n])
    // each slot's % add up to exactly 100%
    standardRecipe().slots.forEach((sl) => expect(percentTotal(slotPercents(standardRecipe(), sl).map((x) => x || '0')).total).toBe(10_000))
  })

  it('per pack: exactly the averages of the straight odds before slots (3 / 1.449 / 0.8982 / 0.2934 / 0.2394 / 0.12)', () => {
    const per = perPackCounts(standardRecipe())
    const want = [3, 1.449, 0.8982, 0.2934, 0.2394, 0.12]
    per.forEach((x, i) => expect(x).toBeCloseTo(want[i], 10))
    expect(per.reduce((a, x) => a + x, 0)).toBeCloseTo(6, 10)
    // so each type's share of cards is the old per-card odds: 50 / 24.15 / 14.97 / 4.89 / 3.99 / 2%
    const old = [0.5, 0.2415, 0.1497, 0.0489, 0.0399, 0.02]
    typeOdds(standardRecipe()).forEach((p, i) => expect(p).toBeCloseTo(old[i], 10))
    const so = slotOdds(standardRecipe())
    expect(so[3][2]).toBeCloseTo(0.5982, 10)
    expect(so[2][5]).toBeCloseTo(0.045, 10)
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
    expect(cardsPerPack(back)).toBe(6)
    expect(slotWeights(back)).toEqual(slotWeights(standardRecipe()))
    expect(back.slots.map((sl) => slotPercents(back, sl))).toEqual(standardRecipe().slots.map((sl) => slotPercents(standardRecipe(), sl)))
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
    expect(cardsPerPack(r)).toBe(3)
    expect(r.types.map((_, i) => holoLooksFor(r, i))).toEqual([['frame', 'picture', 'full'], ['frame', 'picture', 'full'], ['full']])
  })
})

describe('checkRecipe mirrors RecipeCompiler.compile', () => {
  const base = () => standardRecipe()
  it('no types, no slots; slots of at least 1 card, adding up to at most 1,000', () => {
    expect(codes({ types: [], slots: base().slots })[0]).toBe('BadRecipe(no types)')
    expect(codes({ ...base(), slots: [] })[0]).toBe('BadRecipe(no slots)')
    const r = base()
    r.slots[1].count = 0
    expect(codes(r)[0]).toBe('BadSlot(1,count)')
    r.slots[1].count = 1
    r.slots[0].count = MAX_CARDS_PER_PACK - 2
    expect(codes(r)[0]).toBe('BadRecipe(cards per pack)')
    r.slots[0].count = MAX_CARDS_PER_PACK - 3
    expect(codes(r)).toEqual([])
    expect(cardsPerPack(r)).toBe(MAX_CARDS_PER_PACK)
  })
  it('a slot with no type, a type in no slot', () => {
    const r = base()
    r.slots[1].percents = {}
    expect(codes(r)).toEqual(['BadSlot(1,weights)'])
    const r2 = base()
    r2.slots[0].percents = { wood: '100' }
    expect(codes(r2)).toEqual(['BadType(0,in no slot)'])
    expect(checkRecipe(r2)[0].message).toBe('Type 1 (Paper): no slot deals Paper: give it a % in a slot, or remove the type.')
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
  it('holo chances and weights', () => {
    const r2 = base()
    r2.types[0].holo = { mode: 'independent', frame: '1000000000000000001', picture: '0' }
    expect(codes(r2)[0]).toBe('BadType(0,holo chances)')
    const r3 = base()
    r3.types[4].holo = { mode: 'distribution', weights: ['0', '0', '0', '0'] }
    expect(codes(r3)[0]).toBe('BadType(4,holo weights)')
  })
  it('studio checks: number formats', () => {
    const r = base()
    r.slots[3].percents.fire = '1.555'
    expect(checkRecipe(r)[0]).toMatchObject({ code: 'Studio', where: 'slot', index: 3, message: 'Slot 4: % of this slot must be a number from 0 to 100, with at most 2 decimals (Fire).' })
    const r2 = base()
    r2.slots[3].percents.fire = '101'
    expect(checkRecipe(r2)[0].code).toBe('Studio')
    // exact weights (a recipe.json or a locked old save): checked as weights
    const r3 = recipeFromJson(recipeJson(7, base(), []))
    r3.slots[3].weights!.t2 = (1n << 64n).toString()
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
    const r = standardRecipe()
    const w = percentsToWeights(slotPercents(r, r.slots[3]).map((x) => x || '0'))
    expect(w).toEqual([0n, 0n, 598_200n, 173_400n, 153_400n, 75_000n])
    expect(sum(w)).toBe(WEIGHT_TOTAL)
    expect(WEIGHT_TOTAL).toBe(1_000_000n)
    expect(sum(percentsToWeights(['33.34', '33.33', '33.33']))).toBe(1_000_000n)
    expect(sum(percentsToWeights(['0.01', '99.99']))).toBe(1_000_000n)
  })

  it('the Standard exports StandardRecipe.sol\'s slot weights: the shared zeros of each slot dropped', () => {
    const r = standardRecipe()
    const w = percentsToWeights(slotPercents(r, r.slots[2]).map((x) => x || '0'))
    expect(simplifyWeights(w)).toEqual([0n, 449n, 300n, 120n, 86n, 45n])
    expect(recipeJson(7, standardRecipe(), []).slots).toEqual([
      { count: 3, weights: { paper: 1 } }, { count: 1, weights: { wood: 1 } },
      { count: 1, weights: { wood: 449, fire: 300, coal: 120, gold: 86, fullart: 45 } },
      { count: 1, weights: { fire: 5982, coal: 1734, gold: 1534, fullart: 750 } },
    ])
    expect(recipeJson(8, specialAllHoloRecipe(), []).slots).toEqual([{ count: 3, weights: { fire: 68, coal: 30, gold: 2 } }])
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

  it('a recipe is valid only when each slot adds up to exactly 100%', () => {
    const r = standardRecipe()
    r.slots[3].percents.fullart = '6.5'
    const problems = checkRecipe(r)
    expect(problems).toEqual([{ code: 'Studio', where: 'total', index: 3, message: "Slot 4's types add up to 99%: they must add up to exactly 100% (1% left to assign)." }])
    r.slots[3].percents.fire = '60.82'
    expect(checkRecipe(r)).toEqual([])
    // the contract itself would take any total: only the studio refuses it
    r.slots[3].percents.fire = '70'
    expect(checkRecipe(r).filter((p) => p.code !== 'Studio')).toEqual([])
  })

  it('a recipe.json keeps its exact weights (the contract\'s odds) beside its percentages; a copy is set by %', () => {
    const j = recipeJson(7, standardRecipe(), [])
    j.slots[3].weights = { fire: 7, coal: 3, gold: 1, fullart: 1 }
    const r = recipeFromJson(j)
    expect(slotWeights(r)[3].weights).toEqual([0n, 0n, 7n, 3n, 1n, 1n])
    expect(slotPercents(r, r.slots[3])).toEqual(['', '', '58.34', '25', '8.33', '8.33'])
    expect(checkRecipe(r)).toEqual([])
    const copy = cloneRecipe(r, (() => { let n = 0; return () => `id${n++}` })())
    expect(copy.slots.some((sl) => 'weights' in sl)).toBe(false)
    expect(slotWeights(copy)[3].weights).toEqual([0n, 0n, 5834n, 2500n, 833n, 833n])
    expect(copy.types.map((t) => t.id)).toEqual(['id0', 'id1', 'id2', 'id3', 'id4', 'id5'])
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
