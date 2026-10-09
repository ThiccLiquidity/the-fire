/** The Sale settings: configureDrop's checks, the presets and the exported units. (The sample recipe.json the
 *  contract tests parse is checked in scripts/sale-sample.test.ts.) */
import { describe, expect, it } from 'vitest'
import { checkSale, dropPlan, giantSale, parseDecimal, saleErrors, saleJson, salePacks, saleWithPacks, standardSale, type SaleSettings } from './sale'

const NOW = 1_800_000_000
const errs = (s: Partial<SaleSettings>) => saleErrors({ ...standardSale(), start: NOW + 3600, ...s }, NOW).map((p) => p.field)

describe('sale settings', () => {
  it('the Standard preset is today\'s sale and exports in contract units', () => {
    expect(errs({})).toEqual([])
    expect(saleJson(standardSale())).toEqual({
      start: 0, packs: 117, starters: 50, plankOnly: 50, walletLimit: 5, starterWindow: 86_400, liftAfter: 172_800,
      plankBurnBps: 3_000, priceUsd: '250000000', paperPerPack: '1000000000000000000', paperCapUsd: '100000000', holderWindow: 86_400, maxPerTx: 50,
      plankOnlyFor: 172_800, regularWalletsFor: 172_800, starterPerPress: 1, starterWalletLimit: 1, starterPriceUsd: '0',
      starterPaper: '1000000000000000000', creditsPerPick: 1, creditPacksMax: 16, creditPacksPerWallet: 3,
    })
  })

  it('the Giant preset is valid: 10,000 packs, 100 per wallet and per purchase', () => {
    const g = giantSale()
    expect(errs(g)).toEqual([])
    expect(g.paidPacks + g.pressPacks).toBe(10_000)
    expect(saleJson(g)).toMatchObject({ walletLimit: 100, maxPerTx: 100, creditPacksMax: 1_000, creditPacksPerWallet: 3 })
  })

  it('mirrors configureDrop\'s checks', () => {
    expect(errs({ paidPacks: 0, pressPacks: 0 })).toContain('paidPacks')
    expect(errs({ priceUsd: '0' })).toContain('priceUsd')
    expect(errs({ paidPacks: 0, plankOnly: 0, priceUsd: '0' })).toEqual(['priceUsd']) // press only: unclaimed ones sell at it
    expect(errs({ paidPacks: 0, plankOnly: 0 })).toEqual([])
    expect(errs({ plankOnly: 118 })).toContain('plankOnly')
    expect(errs({ plankBurnPercent: '100.01' })).toContain('plankBurnPercent')
    expect(errs({ paperCapUsd: 'x' })).toContain('paperCapUsd')
    expect(errs({ paperCapUsd: '0.000000001' })).toContain('paperCapUsd') // 8 decimals at most
    expect(errs({ paperCapUsd: '0' })).toEqual([]) // no ceiling
    expect(errs({ plankOnlyHours: 0 })).toContain('plankOnlyHours')
    expect(errs({ plankOnly: 0, plankOnlyHours: 0 })).toEqual([])
    expect(errs({ walletLimit: 0 })).toContain('walletLimit')
    expect(errs({ liftHours: 0 })).toContain('liftHours')
    expect(errs({ walletLimit: 0, liftHours: 0 })).toEqual([]) // no limit
    expect(errs({ pressHours: 0 })).toContain('pressHours')
    expect(errs({ pressPerPress: 0 })).toContain('pressPerPress')
    expect(errs({ pressPerWallet: 0 })).toContain('pressPerWallet')
    expect(errs({ pressPacks: 0, pressPerPress: 0, pressHours: 0 })).toEqual([]) // press packs off
    expect(errs({ holderHours: 721 })).toContain('holderHours')
    expect(errs({ holderHours: 720 })).toEqual([])
    expect(errs({ holderRoot: '0x12' })).toContain('holderRoot')
    expect(errs({ maxPerTx: 0 })).toContain('maxPerTx')
    expect(errs({ creditsPerPick: 70_000 })).toContain('creditsPerPick')
    expect(errs({ creditPacksPercent: '101' })).toContain('creditPacksPercent')
    expect(errs({ creditPacksPerWallet: 1.5 })).toContain('creditPacksPerWallet')
    expect(errs({ creditPacksPercent: '10', creditPacksPerWallet: 2 })).toEqual([])
    const cap = (s: Partial<SaleSettings>) => saleJson({ ...standardSale(), ...s }).creditPacksMax
    expect(cap({ creditPacksPercent: '0' })).toBe(0) // no limit
    expect(cap({ paidPacks: 5, pressPacks: 0, plankOnly: 0, creditPacksPercent: '10' })).toBe(1) // at least 1 when on
    expect(cap({ paidPacks: 450, pressPacks: 50, creditPacksPercent: '12.5' })).toBe(62)
    expect(errs({ pressPrice: 'usd', pressUsd: '0' })).toContain('pressUsd')
    expect(errs({ pressPrice: 'paper', pressPaper: '0' })).toContain('pressPaper')
    expect(errs({ priceUsd: '2.123456789' })).toContain('priceUsd') // more than 8 decimals
  })

  it('press pack prices: free, PAPER, dollars, dollars + PAPER', () => {
    const j = (s: Partial<SaleSettings>) => saleJson({ ...standardSale(), ...s })
    expect(j({ pressPrice: 'free' })).toMatchObject({ starterPriceUsd: '0', starterPaper: '0' })
    expect(j({ pressPrice: 'paper', pressPaper: '2.5' })).toMatchObject({ starterPriceUsd: '0', starterPaper: '2500000000000000000' })
    expect(j({ pressPrice: 'usd', pressUsd: '1' })).toMatchObject({ starterPriceUsd: '100000000', starterPaper: '0' })
    expect(j({ pressPrice: 'usdPaper', pressUsd: '1', pressPaper: '1' })).toMatchObject({ starterPriceUsd: '100000000', starterPaper: '1000000000000000000' })
    expect(j({ pressPacks: 0 })).toMatchObject({ starters: 0, starterPerPress: 0, starterWalletLimit: 0, starterWindow: 0 })
  })

  it('warns (without blocking) about a missing or past start and a missing snapshot root', () => {
    const ps = checkSale({ ...standardSale(), start: NOW - 1 }, NOW)
    expect(ps.filter((p) => p.warning).map((p) => p.field)).toEqual(['start', 'holderRoot'])
    expect(ps.filter((p) => !p.warning)).toEqual([])
  })

  it('the drop picture: Standard splits 167 packs and a sell-out brings in $292.50', () => {
    const d = dropPlan(standardSale())
    expect(d).toMatchObject({ total: 167, paid: 117, press: 50, plankOnly: 50, freeMax: 16, freeCapped: true })
    expect(d.revenueUsd).toBeCloseTo(292.5)
    expect(d.revenueMinUsd).toBeCloseTo(101 * 2.5) // 16 free packs come out of the paid ones
    expect(d.burnUsd).toBeCloseTo(87.75)
    // no cap: every paid pack could go free; a cap above the paid packs stops at them
    expect(dropPlan({ ...standardSale(), creditPacksPercent: '0' })).toMatchObject({ freeMax: 117, freeCapped: false })
    expect(dropPlan({ ...standardSale(), paidPacks: 5, plankOnly: 0, creditPacksPercent: '50' }).freeMax).toBe(5)
  })

  it('reads decimals exactly', () => {
    expect(parseDecimal('2.50', 8)).toBe(250_000_000n)
    expect(parseDecimal('.5', 2)).toBe(50n)
    expect(parseDecimal('1', 18)).toBe(10n ** 18n)
    expect(parseDecimal('', 2)).toBeNull()
    expect(parseDecimal('1.2.3', 2)).toBeNull()
    expect(parseDecimal('-1', 2)).toBeNull()
  })

  it('the drop is the Series: paid + press packs, at most a trillion', () => {
    expect(salePacks(standardSale())).toBe(167)
    expect(saleWithPacks(standardSale(), 500)).toMatchObject({ paidPacks: 450, pressPacks: 50, plankOnly: 50 })
    expect(saleWithPacks(standardSale(), 30)).toMatchObject({ paidPacks: 0, pressPacks: 30, plankOnly: 0 })
    expect(errs({ paidPacks: 1_000_000_000_001, pressPacks: 0 })).toContain('paidPacks')
  })
})
