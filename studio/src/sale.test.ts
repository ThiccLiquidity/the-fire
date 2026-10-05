/** The Sale settings: configureDrop's checks, the presets and the exported units. (The sample recipe.json the
 *  contract tests parse is checked in scripts/sale-sample.test.ts.) */
import { describe, expect, it } from 'vitest'
import { checkSale, giantSale, parseDecimal, saleErrors, saleJson, standardSale, type SaleSettings } from './sale'

const NOW = 1_800_000_000
const errs = (s: Partial<SaleSettings>) => saleErrors({ ...standardSale(), start: NOW + 3600, ...s }, NOW).map((p) => p.field)

describe('sale settings', () => {
  it('the Standard preset is today\'s sale and exports in contract units', () => {
    expect(errs({})).toEqual([])
    expect(saleJson(standardSale())).toEqual({
      start: 0, packs: 117, starters: 50, plankOnly: 50, walletLimit: 5, starterWindow: 86_400, liftAfter: 172_800,
      plankBurnBps: 3_000, priceUsd: '250000000', paperPerPack: '1000000000000000000', holderWindow: 86_400, maxPerTx: 50,
      plankOnlyFor: 172_800, regularWalletsFor: 172_800, starterPerPress: 1, starterWalletLimit: 1, starterPriceUsd: '0',
      starterPaper: '1000000000000000000', creditsPerPick: 1, creditPacksMax: 0, creditPacksPerWallet: 0,
    })
  })

  it('the Giant preset is valid: 10,000 packs, 100 per wallet and per purchase', () => {
    const g = giantSale()
    expect(errs(g)).toEqual([])
    expect(g.paidPacks + g.pressPacks).toBe(10_000)
    expect(saleJson(g)).toMatchObject({ walletLimit: 100, maxPerTx: 100, creditPacksMax: 0, creditPacksPerWallet: 0 })
  })

  it('mirrors configureDrop\'s checks', () => {
    expect(errs({ paidPacks: 0, pressPacks: 0 })).toContain('paidPacks')
    expect(errs({ priceUsd: '0' })).toContain('priceUsd')
    expect(errs({ paidPacks: 0, plankOnly: 0, priceUsd: '0' })).toEqual([]) // press packs only
    expect(errs({ plankOnly: 118 })).toContain('plankOnly')
    expect(errs({ plankBurnPercent: '100.01' })).toContain('plankBurnPercent')
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
    expect(errs({ creditPacksMax: -1 })).toContain('creditPacksMax')
    expect(errs({ creditPacksPerWallet: 1.5 })).toContain('creditPacksPerWallet')
    expect(errs({ creditPacksMax: 100, creditPacksPerWallet: 2 })).toEqual([])
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

  it('reads decimals exactly', () => {
    expect(parseDecimal('2.50', 8)).toBe(250_000_000n)
    expect(parseDecimal('.5', 2)).toBe(50n)
    expect(parseDecimal('1', 18)).toBe(10n ** 18n)
    expect(parseDecimal('', 2)).toBeNull()
    expect(parseDecimal('1.2.3', 2)).toBeNull()
    expect(parseDecimal('-1', 2)).toBeNull()
  })
})
