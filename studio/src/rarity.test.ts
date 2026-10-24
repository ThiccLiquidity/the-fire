/** Rarity on the site's scale and the per-pack chances, from the recipe's fixed odds. */
import { describe, expect, it } from 'vitest'
import { checkRecipe, specialAllHoloRecipe, standardRecipe } from './recipe'
import { cardChance, expectedCounts, mayNotPrint, oneIn, packChances, printCount, seriesResult, tierOf } from './rarity'

describe('rarity', () => {
  it('matches the site (info.js): Standard, 167 packs, 20 characters', () => {
    const r = standardRecipe()
    const res = seriesResult(r, 167n, 20)
    expect(res.total).toBe(1002n)
    const by = (slug: string) => res.types[r.types.findIndex((t) => t.slug === slug)]
    // Full Art: 2% per card, always full holo, 1 of 20 characters: 1 in 1,000, Legendary
    const fa = by('fullart').looks
    expect(fa.map((l) => l.look)).toEqual(['full'])
    expect(oneIn(fa[0].p)).toBe('1,000')
    expect(fa[0].tier).toBe('legendary')
    // Gold: 3.99% -> 1 in 500, Epic
    expect(oneIn(by('gold').looks[0].p)).toBe('500')
    expect(by('gold').looks[0].tier).toBe('epic')
    // Paper plain: 50% x 95% / 20 -> 1 in 42, no tier
    const paper = by('paper').looks.find((l) => l.look === 'none')!
    expect(oneIn(paper.p)).toBe('42')
    expect(paper.tier).toBe(null)
    // Paper full holo: Legendary
    expect(by('paper').looks.find((l) => l.look === 'full')!.tier).toBe('legendary')
    // expected cards follow the odds
    expect(by('paper').expected).toBeCloseTo(501, 6)
    expect(by('fullart').expected).toBeCloseTo(20.04, 6)
    expect(res.weighted).toBe(false)
  })

  it('character weights: a card\'s chance = type x holo x character odds', () => {
    const r = standardRecipe()
    const res = seriesResult(r, 167n, 4, [1, 1, 1, 7])
    expect(res.weighted).toBe(true)
    const fa = res.types[5].looks[0]
    expect(fa.p).toBeCloseTo(0.02 / 4, 12) // an average character
    expect(fa.pRarest).toBeCloseTo(0.02 * 0.1, 12) // weight 1 of 10
    expect(cardChance(r, 5, 'full', 0.7)).toBeCloseTo(0.014, 12)
  })

  it('tiers', () => {
    expect(tierOf(99)).toBe(null)
    expect(tierOf(100)).toBe('rare')
    expect(tierOf(400)).toBe('epic')
    expect(tierOf(1000)).toBe('legendary')
  })

  it('per pack: exact chances, the same in every pack (no guarantees)', () => {
    const r = standardRecipe()
    const c = packChances(r)
    expect(c.atLeastOne[0]).toBeCloseTo(1 - 0.5 ** 6, 12) // Paper
    expect(c.atLeastOne[5]).toBeCloseTo(1 - 0.98 ** 6, 12) // Full Art ~11.4%
    expect(c.twoOrMore[5]).toBeCloseTo(1 - 0.98 ** 6 - 6 * 0.02 * 0.98 ** 5, 12)
    expect(c.atLeastOne.every((p) => p < 1)).toBe(true)
  })

  it('the special all-holo recipe has no plain looks', () => {
    const r = specialAllHoloRecipe()
    expect(checkRecipe(r)).toEqual([])
    const res = seriesResult(r, 100n, 5)
    for (const t of res.types) expect(t.looks.some((l) => l.look === 'none')).toBe(false)
  })
})

describe('expectedCounts', () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

  it('every count sums to the Series\' cards (packs x cards per pack)', () => {
    const r = standardRecipe()
    const c = expectedCounts(r, 20, 167n)
    expect(c.totalCards).toBe(1002)
    expect(sum(c.types.map((t) => t.count))).toBeCloseTo(1002, 6)
    expect(sum(c.characters.map((t) => t.count))).toBeCloseTo(1002, 6)
    expect(sum(c.grid.flat())).toBeCloseTo(1002, 6)
    // Gold 3.99% of 1,002
    expect(c.types[4].count).toBeCloseTo(39.98, 2)
    // each type's row sums to the type
    c.grid.forEach((row, i) => expect(sum(row)).toBeCloseTo(c.types[i].count, 9))
  })

  it('uniform characters split evenly; weighted by their weight over the total', () => {
    const r = standardRecipe()
    const even = expectedCounts(r, 4, 100)
    expect(even.characters.map((x) => x.count)).toEqual([150, 150, 150, 150])
    const w = expectedCounts(r, [1, 1, 1, 7], 100)
    expect(w.characters.map((x) => x.count)).toEqual([60, 60, 60, 420])
    expect(w.grid[0][3]).toBeCloseTo(600 * 0.5 * 0.7, 9) // Paper (50%) x character 4 (70%)
    // equal weights = no weights
    expect(expectedCounts(r, [3, 3, 3, 3], 100).grid).toEqual(even.grid)
  })

  it('the holo split sums to the type\'s count, in both holo modes', () => {
    const r = standardRecipe()
    r.types[0].holo = { mode: 'independent', frame: '250000000000000000', picture: '100000000000000000' }
    r.types[1].holo = { mode: 'distribution', weights: ['6', '2', '1', '1'] }
    const c = expectedCounts(r, 10, 1000)
    c.types.forEach((t) => expect(sum(Object.values(t.looks))).toBeCloseTo(t.count, 9))
    const paper = c.types[0]
    expect(paper.looks.frame).toBeCloseTo(paper.count * 0.25 * 0.9, 9)
    expect(paper.looks.full).toBeCloseTo(paper.count * 0.025, 9)
    expect(c.types[1].looks.none).toBeCloseTo(c.types[1].count * 0.6, 9)
  })

  it('no packs or no characters: zero cards, no character rows', () => {
    const c = expectedCounts(standardRecipe(), 0, 0n)
    expect(c.totalCards).toBe(0)
    expect(c.characters).toEqual([])
    expect(c.types.every((t) => t.count === 0)).toBe(true)
  })

  it('reads counts sensibly', () => {
    expect(printCount(0)).toBe('0')
    expect(printCount(0.3)).toBe('< 1')
    expect(mayNotPrint(0.3)).toBe(true)
    expect(mayNotPrint(0)).toBe(false)
    expect(printCount(4.04)).toBe('4')
    expect(printCount(4.26)).toBe('4.3')
    expect(printCount(9.96)).toBe('10')
    expect(printCount(39.98)).toBe('40')
    expect(printCount(12345.4)).toBe('12,345')
  })
})
