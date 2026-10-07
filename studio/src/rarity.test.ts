/** Rarity on the site's scale, exact share <-> count conversion, and the per-pack estimate. */
import { describe, expect, it } from 'vitest'
import { checkRecipe, previewPool, specialAllHoloRecipe, standardRecipe } from './recipe'
import { countForShare, oneIn, packChances, seriesResult, shareForCount, tierOf } from './rarity'

describe('rarity', () => {
  it('matches the site (info.js): Standard, 167 packs, 10 characters', () => {
    const r = standardRecipe()
    const res = seriesResult(r, 167n, 10)
    expect(res.total).toBe(1002n)
    const by = (slug: string) => res.types[r.types.findIndex((t) => t.slug === slug)]
    // Full Art: 1 per character, always full holo: 1 / 1,002 -> "1 in 1,000", Legendary
    const fa = by('fullart').looks
    expect(fa.map((l) => l.look)).toEqual(['full'])
    expect(oneIn(fa[0].p)).toBe('1,000')
    expect(fa[0].tier).toBe('legendary')
    // Gold: 2 per character -> 1 in 500, Epic
    expect(oneIn(by('gold').looks[0].p)).toBe('500')
    expect(by('gold').looks[0].tier).toBe('epic')
    // Paper plain: 50.1 per character x 0.95 / 1,002 -> 1 in 21, no tier
    const paper = by('paper').looks.find((l) => l.look === 'none')!
    expect(oneIn(paper.p)).toBe('21')
    expect(paper.tier).toBe(null)
    // Paper full holo: Legendary
    expect(by('paper').looks.find((l) => l.look === 'full')!.tier).toBe('legendary')
  })

  it('counts are the contract pool', () => {
    const r = standardRecipe()
    const res = seriesResult(r, 167n, 20)
    expect(res.types.map((t) => t.count)).toEqual(previewPool(r, 167, 20))
    expect(res.types.map((t) => Number(t.count))).toEqual([501, 242, 150, 49, 40, 20])
  })

  it('tiers', () => {
    expect(tierOf(99)).toBe(null)
    expect(tierOf(100)).toBe('rare')
    expect(tierOf(400)).toBe('epic')
    expect(tierOf(1000)).toBe('legendary')
  })

  it('a card count turns into the share that gives exactly it, with few decimals', () => {
    expect(countForShare(shareForCount(150n, 1002n)!.share, 1002n)).toBe(150n)
    expect(shareForCount(150n, 1000n)).toEqual({ share: 150_000_000n, exact: true }) // 15%
    for (const n of [1n, 6n, 1002n, 60_000n, 600_000_000n]) {
      for (const c of [0n, 1n, n / 3n, n / 2n, n]) {
        const a = shareForCount(c, n)!
        expect(a.exact).toBe(true)
        expect(countForShare(a.share, n)).toBe(c)
      }
    }
    // past a billion cards not every count has a share: the nearest
    const big = shareForCount(1n, 6_000_000_000n)!
    expect(big.exact).toBe(false)
    expect(countForShare(big.share, 6_000_000_000n)).toBe(0n)
  })

  it('per pack: the Standard pack always has Paper, Wood and Fire-or-better', () => {
    const r = standardRecipe()
    const c = packChances(r, 167, 10)!
    expect(c.atLeastOne[0]).toBe(1) // Paper
    expect(c.atLeastOne[1]).toBe(1) // Wood: its own slot
    const fireOrBetter = c.atLeastOne.slice(2).reduce((a, b) => a + b, 0)
    expect(fireOrBetter).toBeGreaterThanOrEqual(1)
    // Full Art: 10 cards over 167 packs, at most one each -> about 6%
    expect(c.atLeastOne[5]).toBeGreaterThan(0.05)
    expect(c.atLeastOne[5]).toBeLessThan(0.07)
  })

  it('the special all-holo recipe has no plain looks', () => {
    const r = specialAllHoloRecipe()
    expect(checkRecipe(r)).toEqual([])
    const res = seriesResult(r, 100n, 5)
    for (const t of res.types) expect(t.looks.some((l) => l.look === 'none')).toBe(false)
  })
})
