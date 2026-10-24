/** Rarity on the site's scale and the per-pack chances, from the recipe's fixed odds. */
import { describe, expect, it } from 'vitest'
import { checkRecipe, specialAllHoloRecipe, standardRecipe } from './recipe'
import { cardChance, oneIn, packChances, seriesResult, tierOf } from './rarity'

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
