/** The Sale settings: drop groups, ConfigureSeries' checks, the presets, old saves and the exported units. (The sample
 *  recipe.json the contract tests parse is checked in scripts/sale-sample.test.ts.) */
import { describe, expect, it } from 'vitest'
import {
  EVERYONE_LIMIT_HOURS, GROUP_TEMPLATES, blankGroup, checkSale, creditPacksMax, dropPlan, giantSale, groupPacks, groupSummary, groupTimes, parseDecimal,
  creditGroupOk, saleErrors, saleJson, saleOf, salePacks, saleWithPacks, standardSale, taxGrowthOk, taxedPrices,
  type OldSaleSettings, type SaleGroup, type SaleSettings,
} from './sale'
import { salePolicy } from './salePolicy'

const NOW = 1_800_000_000
const withStart = (s: Partial<SaleSettings>): SaleSettings => ({ ...standardSale(), start: NOW + 3600, ...s })
/** The errors of the Standard drop with `s` over it, as "field" (drop-wide) or "i.field" (group i). */
const errs = (s: Partial<SaleSettings>) => saleErrors(withStart(s), NOW).map((p) => (p.group === undefined ? p.field : `${p.group}.${p.field}`))
/** The Standard drop with group `i` changed. */
const g = (i: number, patch: Partial<SaleGroup>, more: Partial<SaleSettings> = {}): Partial<SaleSettings> => ({
  ...more, groups: standardSale().groups.map((x, k) => (k === i ? { ...x, ...patch } : x)),
})

describe('the Standard and Giant presets', () => {
  it('Standard is valid and exports exactly the drop docs/drop-groups.md describes', () => {
    expect(errs({})).toEqual([])
    expect(saleJson(standardSale())).toEqual({
      start: 0, packs: 167, plankBurnBps: 1_000, paperBurnBps: 2_000, paperCapUsd: '100000000', maxPerTx: 50, regularWalletsFor: 172_800,
      creditsPerPick: 1, creditPacksMax: 16, creditPacksPerWallet: 3, creditGroup: 2,
      groups: [
        { name: 'Paper Press holders', packs: 50, gate: 'nft', nft: 'press', perNft: 1, priceUsd: '0', paper: '1000000000000000000', coins: 0, perWallet: 2, afterGroup: 255, startDelay: 0, duration: 21_600, rollTo: 2 },
        { name: 'PLANK holders', packs: 40, gate: 'snapshot', priceUsd: '250000000', paper: '1000000000000000000', coins: 1, perWallet: 5, afterGroup: 255, startDelay: 0, duration: 86_400, rollTo: 2 },
        { name: 'Everyone', packs: 77, gate: 'open', priceUsd: '250000000', paper: '1000000000000000000', coins: 7, perWallet: 5, limitFor: 86_400, afterGroup: 1, startDelay: 0, duration: 0, rollTo: 255 },
        { name: 'After sell-out', packs: 0, gate: 'open', priceUsd: '250000000', paper: '1000000000000000000', coins: 2, perWallet: 0, afterGroup: 2, startDelay: 0, duration: 0, rollTo: 255, taxBps: 400, idle: 900, perTx: 1, unlimited: true },
      ],
    })
  })

  it('exports only the keys ConfigureSeries reads, in its order', () => {
    const j = saleJson({ ...standardSale(), groups: standardSale().groups.map((x, i) => (i === 1 ? { ...x, root: '0x' + 'AB'.repeat(32) } : x)) })
    expect(Object.keys(j).join(',')).toBe('start,packs,plankBurnBps,paperBurnBps,paperCapUsd,maxPerTx,regularWalletsFor,creditsPerPick,creditPacksMax,creditPacksPerWallet,creditGroup,groups')
    const allowed = 'name,packs,gate,nft,perNft,root,priceUsd,paper,coins,perWallet,limitFor,afterGroup,startDelay,duration,rollTo,taxBps,idle,perTx,unlimited'.split(',')
    for (const grp of j.groups) {
      const keys = Object.keys(grp)
      expect(keys.every((k) => allowed.includes(k))).toBe(true)
      expect(keys).toEqual(allowed.filter((k) => keys.includes(k))) // the parser's order
    }
    expect(j.groups[1].root).toBe('0x' + 'ab'.repeat(32)) // lower case
  })

  it('Giant: 10,000 base packs, 50 per wallet (the policy\'s most), 100 per purchase, 3 per Press', () => {
    const s = giantSale()
    expect(saleErrors({ ...s, start: NOW + 3600 }, NOW)).toEqual([])
    expect(groupPacks(s)).toEqual([1_000, 1_000, 8_000, 0])
    expect(saleJson(s)).toMatchObject({ packs: 10_000, maxPerTx: 100, creditPacksMax: 1_000, creditGroup: 2 })
    expect(s.groups.map((x) => x.perWallet)).toEqual([0, 50, 50, 0])
    expect(salePolicy(s)).toEqual([])
    expect(s.groups[0].perNft).toBe(3)
  })
})

describe('packs: counts, percents and "the rest"', () => {
  const drop = (packs: number, groups: Partial<SaleGroup>[]): SaleSettings => ({
    ...standardSale(), packs, creditGroup: -1,
    groups: groups.map((x) => ({ ...blankGroup(), priceUsd: '1', coins: 7, ...x })),
  })

  it('"the rest" is the total less every other finite group; unlimited groups count 0', () => {
    expect(groupPacks(standardSale())).toEqual([50, 40, 77, 0])
    expect(groupPacks({ ...standardSale(), packs: 500 })).toEqual([50, 40, 410, 0])
    expect(salePacks(standardSale())).toBe(167)
  })

  it('percents of the total: rounded down, and the rounding\'s packs handed out when they are meant to fill it', () => {
    expect(groupPacks(drop(167, [{ packsAs: 'percent', percent: '30' }, { packsAs: 'percent', percent: '70' }]))).toEqual([50, 117])
    // 3 x 33.33% + 0.01% of 100 = 100: the remainders go out largest first
    expect(groupPacks(drop(10, [{ packsAs: 'percent', percent: '33.33' }, { packsAs: 'percent', percent: '33.33' }, { packsAs: 'percent', percent: '33.34' }]))).toEqual([3, 3, 4])
    expect(groupPacks(drop(7, [{ packsAs: 'percent', percent: '50' }, { packsAs: 'percent', percent: '50' }]))).toEqual([4, 3])
    // with counts: the percents fill what the counts leave
    expect(groupPacks(drop(11, [{ packs: 1 }, { packsAs: 'percent', percent: '50' }, { packsAs: 'percent', percent: '40.91' }]))).toEqual([1, 5, 5])
    // they don't fill it: rounded down, and the check says the groups don't add up
    const short = drop(10, [{ packsAs: 'percent', percent: '25' }, { packsAs: 'percent', percent: '25' }])
    expect(groupPacks(short)).toEqual([2, 2])
    expect(saleErrors({ ...short, start: NOW + 1 }, NOW).map((p) => p.message)).toContain('The groups add up to 4 packs, not the total 10.')
    // a percent and the rest
    expect(groupPacks(drop(167, [{ packsAs: 'percent', percent: '30' }, { packsAs: 'rest' }]))).toEqual([50, 117])
  })

  it('the rest can\'t go below 0, and only one group takes it', () => {
    expect(errs({ packs: 80 })).toEqual(['2.packs'])
    expect(saleErrors(withStart({ packs: 80 }), NOW)[0].message).toBe('The other groups take 90: more than the total.')
    expect(errs(g(1, { packsAs: 'rest' }))).toEqual(['1.packs', '2.packs'])
    expect(errs(g(0, { packsAs: 'percent', percent: '101' }))).toContain('0.percent')
  })

  it('a resized drop keeps its count groups (cut in order to fit) and the rest follows', () => {
    expect(groupPacks(saleWithPacks(standardSale(), 1_000))).toEqual([50, 40, 910, 0])
    expect(groupPacks(saleWithPacks(standardSale(), 60))).toEqual([50, 10, 0, 0])
    expect(saleWithPacks(standardSale(), 60).packs).toBe(60)
    expect(errs(saleWithPacks(standardSale(), 60))).toEqual([])
  })
})

describe('the checks mirror ConfigureSeries and FireGroups.configure', () => {
  it('drop-wide', () => {
    expect(errs({ packs: 0 })).toContain('packs')
    expect(errs({ packs: 1.5 })).toContain('packs')
    expect(errs({ packs: 1_000_000_000_001 })).toContain('packs')
    expect(errs(g(0, { packs: 51 }))).toEqual([]) // the rest (Everyone) gives one up; with Everyone fixed at 77:
    expect(errs({ ...g(2, { packsAs: 'count', packs: 77 }), packs: 168 })).toEqual(['packs'])
    expect(saleErrors(withStart({ ...g(2, { packsAs: 'count', packs: 77 }), packs: 168 }), NOW)[0].message).toBe('The groups add up to 167 packs, not the total 168.')
    expect(errs({ groups: [] })).toContain('packs')
    expect(errs({ groups: Array.from({ length: 7 }, () => standardSale().groups[2]) })).toContain('packs')
    expect(errs({ groups: [standardSale().groups[3]], creditGroup: -1 })).toContain('packs') // every group unlimited
    expect(errs({ maxPerTx: 0 })).toContain('maxPerTx')
    expect(errs({ plankBurnPercent: '100.01' })).toContain('plankBurnPercent')
    expect(errs({ plankBurnPercent: '60', paperBurnPercent: '40.01' })).toContain('paperBurnPercent')
    expect(errs({ plankBurnPercent: '60', paperBurnPercent: '40' })).toEqual([])
    expect(errs({ paperCapUsd: 'x' })).toContain('paperCapUsd')
    expect(errs({ paperCapUsd: '0.000000001' })).toContain('paperCapUsd')
    expect(errs({ paperCapUsd: '0' })).toEqual([])
    expect(errs({ regularWalletsHours: 721 })).toContain('regularWalletsHours')
    expect(errs({ regularWalletsHours: 720 })).toEqual([])
    expect(errs({ creditsPerPick: 70_000 })).toContain('creditsPerPick')
    expect(errs({ creditPacksPercent: '101' })).toContain('creditPacksPercent')
    expect(errs({ creditPacksPerWallet: 1.5 })).toContain('creditPacksPerWallet')
    expect(errs({ creditGroup: 4 })).toContain('creditGroup')
    expect(errs({ creditGroup: -1 })).toEqual([]) // none: a warning only
    // FireGroups refuses a taxed or unlimited credit group
    expect(errs({ creditGroup: 3 })).toEqual(['creditGroup'])
    expect(saleErrors(withStart({ creditGroup: 3 }), NOW)[0].message).toBe('Free packs need a fixed, untaxed group: After sell-out is unlimited.')
    expect(errs({ ...g(2, { taxPercent: '1' }), creditGroup: 2 })).toContain('creditGroup')
    expect(creditGroupOk(standardSale().groups[2])).toBe(true)
    expect(creditGroupOk(standardSale().groups[3])).toBe(false)
    expect(creditGroupOk(undefined)).toBe(false)
    expect(errs({ start: NOW + 366 * 86_400 })).toContain('start')
  })

  it('opens after an earlier group; leftovers go to a later one', () => {
    expect(errs(g(0, { afterGroup: 0 }))).toEqual(['0.afterGroup'])
    expect(errs(g(1, { afterGroup: 2 }))).toEqual(['1.afterGroup'])
    expect(errs(g(1, { afterGroup: 0 }))).toEqual([])
    expect(errs(g(2, { rollTo: 1 }))).toEqual(['2.rollTo'])
    expect(errs(g(2, { rollTo: 2 }))).toEqual(['2.rollTo'])
    expect(errs(g(1, { rollTo: 9 }))).toEqual(['1.rollTo'])
  })

  it('nothing rolls into an unlimited or a taxed group', () => {
    expect(errs(g(2, { rollTo: 3, hours: 1 }))).toEqual(['2.rollTo'])
    const ps = saleErrors(withStart(g(2, { rollTo: 3, hours: 1 })), NOW)
    expect(ps[0].message).toBe('After sell-out is unlimited: nothing rolls into it.')
    expect(errs(g(2, { taxPercent: '1' }, { creditGroup: -1 }))).toEqual(['0.rollTo', '1.rollTo'])
    expect(saleErrors(withStart(g(2, { taxPercent: '1' }, { creditGroup: -1 })), NOW)[0].message).toBe('Everyone has a rising price: it takes no leftovers.')
  })

  it('an unlimited group needs a rising price and an idle end, and rolls nowhere', () => {
    expect(errs(g(3, { taxPercent: '0' }))).toEqual(['3.unlimited'])
    expect(errs(g(3, { idleMinutes: 0 }))).toEqual(['3.unlimited'])
    expect(saleErrors(withStart(g(3, { idleMinutes: 0 })), NOW)[0].message).toMatch(/rising price and an "ends after no sale" time/)
    expect(errs(g(3, { rollTo: 2 }))).toContain('3.rollTo')
    // an unlimited group exports packs 0 whatever was typed, and adds on top of the total
    expect(saleJson(withStart(g(3, { packs: 99 }))).groups[3].packs).toBe(0)
  })

  it('the gate has what it needs', () => {
    expect(errs(g(0, { nft: '' }))).toEqual(['0.nft'])
    expect(errs(g(0, { nft: '0x12' }))).toEqual(['0.nft'])
    expect(errs(g(0, { nft: '0x' + '12'.repeat(20) }))).toEqual([])
    expect(errs(g(0, { perNft: 0 }))).toEqual(['0.perNft'])
    expect(errs(g(1, { root: '0x12' }))).toEqual(['1.root'])
    expect(errs(g(1, { root: '0x' + 'ab'.repeat(32) }))).toEqual([])
    // a blank root is fine until launch: a warning naming GROUP_ROOT_1
    const w = checkSale(withStart({}), NOW).filter((p) => p.warning)
    expect(w).toEqual([{ field: 'root', group: 1, message: expect.stringContaining('GROUP_ROOT_1'), warning: true }])
  })

  it('a price needs a coin; free packs are never open to everyone', () => {
    expect(errs(g(2, { coins: 0 }))).toEqual(['2.coins'])
    expect(errs(g(0, { priceUsd: '1', coins: 0 }))).toEqual(['0.coins'])
    expect(errs(g(0, { coins: 0 }))).toEqual([]) // no dollar price: no coin needed
    expect(errs(g(2, { priceUsd: '0', paper: '0' }))).toEqual(['2.priceUsd'])
    expect(errs(g(2, { priceUsd: '0', paper: '1' }))).toEqual([]) // PAPER only is a price
    expect(errs(g(0, { paper: '0' }))).toEqual([]) // free for Press holders is fine
    expect(errs(g(2, { priceUsd: '2.123456789' }))).toEqual(['2.priceUsd'])
    expect(errs(g(2, { paper: 'x' }))).toEqual(['2.paper'])
  })

  it('every time at most 30 days; whole numbers within their fields', () => {
    expect(errs(g(1, { hours: 721 }))).toEqual(['1.hours'])
    expect(errs(g(1, { hours: 720 }))).toEqual([])
    expect(errs(g(1, { delayHours: 721 }))).toEqual(['1.delayHours'])
    expect(errs(g(3, { idleMinutes: 43_201 }))).toEqual(['3.idleMinutes'])
    expect(errs(g(1, { hours: -1 }))).toEqual(['1.hours'])
    expect(errs(g(1, { perWallet: 1.5 }))).toEqual(['1.perWallet'])
    expect(errs(g(1, { perTx: 2 ** 32 }))).toEqual(['1.perTx'])
  })

  it('the per-wallet limit lifts after its hours (Everyone: EVERYONE_LIMIT_HOURS); at most 30 days, and only with a per wallet', () => {
    const everyone = standardSale().groups[2]
    expect(everyone).toMatchObject({ perWallet: 5, limitHours: EVERYONE_LIMIT_HOURS })
    expect(standardSale().groups.map((x) => x.limitHours)).toEqual([0, 0, EVERYONE_LIMIT_HOURS, 0]) // Press, PLANK: no timer
    expect(errs(g(2, { limitHours: 720 }))).toEqual([])
    expect(errs(g(2, { limitHours: 721 }))).toEqual(['2.limitHours'])
    expect(errs(g(2, { limitHours: -1 }))).toEqual(['2.limitHours'])
    expect(errs(g(2, { perWallet: 0 }))).toEqual(['2.limitHours']) // nothing to lift
    expect(saleErrors(withStart(g(2, { perWallet: 0 })), NOW)[0].message).toMatch(/set a per wallet first/)
    expect(errs(g(2, { perWallet: 0, limitHours: 0 }))).toEqual([])
    // blank (0) = never: no limitFor key; hours become seconds
    expect(saleJson(withStart(g(2, { limitHours: 0 }))).groups[2]).not.toHaveProperty('limitFor')
    expect(saleJson(withStart(g(2, { limitHours: 1.5 }))).groups[2].limitFor).toBe(5_400)
    expect(groupSummary(withStart(g(2, { limitHours: 0 })), 2)).toMatch(/· 5 per wallet · opens/)
    expect(GROUP_TEMPLATES.find((t) => t.name === 'Everyone')!.make([]).limitHours).toBe(EVERYONE_LIMIT_HOURS)
  })

  it('a rising price: at most 50%, needs a dollar price, and a finite group fits the 1e9 bound', () => {
    expect(errs(g(3, { taxPercent: '50.01' }))).toEqual(['3.taxPercent'])
    expect(errs(g(3, { taxPercent: '50' }))).toEqual([])
    expect(errs(g(1, { taxPercent: '4' }))).toEqual([]) // nothing rolls into PLANK holders; 40 packs at 4% fit
    expect(errs(g(0, { taxPercent: '4' }))).toEqual(['0.taxPercent']) // the Press group has no dollar price
    const one = (packs: number, taxPercent: string) => saleErrors({
      ...withStart({}), packs, creditGroup: -1, groups: [{ ...standardSale().groups[2], packsAs: 'count', packs, afterGroup: -1, taxPercent }],
    }, NOW).map((p) => `${p.group}.${p.field}`)
    expect(one(528, '4')).toEqual([])
    expect(one(529, '4')).toEqual(['0.taxPercent'])
  })
})

describe('the rising price bound', () => {
  it('matches FireGroups._growthOk: 528 packs at 4%, not 529', () => {
    expect(taxGrowthOk(400, 528)).toBe(true)
    expect(taxGrowthOk(400, 529)).toBe(false)
    expect(taxGrowthOk(5_000, 51)).toBe(true) // 1.5^51 ~ 9.5e8
    expect(taxGrowthOk(5_000, 52)).toBe(false)
    expect(taxGrowthOk(1, 0)).toBe(true)
  })
})

describe('what the owner reads', () => {
  it('one plain line per group', () => {
    const s = standardSale()
    expect(groupSummary(s, 0)).toBe('50 packs for Paper Press holders · 1 PAPER · 1 per Press · 2 per wallet · up to 6h · leftovers → Everyone')
    expect(groupSummary(s, 1)).toBe('40 packs for the snapshot list · $2.50 + 1 PAPER · PLANK only · 5 per wallet · up to 24h · leftovers → Everyone')
    expect(groupSummary(s, 2)).toBe('77 packs for everyone · $2.50 + 1 PAPER · any coin · 5 per wallet for 24h, then no limit · opens after PLANK holders · until sold')
    expect(groupSummary(s, 3)).toBe('No pack count, for everyone · $2.50 rising 4% a pack + 1 PAPER · ETH only · 1 per purchase · opens after Everyone · no time limit · ends after 15 min with no sale')
  })

  it('a taxed group\'s first prices, as the contract prices them (base x (1 + bps/10000)^k)', () => {
    const p = taxedPrices(standardSale(), 3)
    expect(p.map((x) => x.k)).toEqual([1, 10, 25, 50])
    expect(p.map((x) => Math.round(x.usd * 100) / 100)).toEqual([2.6, 3.7, 6.66, 17.77])
    expect(taxedPrices(standardSale(), 2)).toEqual([]) // no rise
    // a finite taxed group shows only the packs it has
    expect(taxedPrices({ ...standardSale(), groups: [{ ...standardSale().groups[2], packsAs: 'count', packs: 12, taxPercent: '2', afterGroup: -1 }] }, 0).map((x) => x.k)).toEqual([1, 10])
  })

  it('the timeline: side by side, then one after another ("up to" hours; null = until sold)', () => {
    expect(groupTimes(standardSale())).toEqual([{ opens: 0, ends: 6 }, { opens: 0, ends: 24 }, { opens: 24, ends: null }, { opens: null, ends: null }])
    expect(groupTimes(withStart(g(2, { delayHours: 1, hours: 2 })))).toEqual([{ opens: 0, ends: 6 }, { opens: 0, ends: 24 }, { opens: 25, ends: 27 }, { opens: 27, ends: null }])
  })

  it('the drop picture: Standard brings in $292.50 sold out (the Press packs cost only PAPER)', () => {
    const d = dropPlan(standardSale())
    expect(d).toMatchObject({ total: 167, packs: [50, 40, 77, 0], freeMax: 16, freeCapped: true, paperPaid: 167 })
    expect(d.revenueUsd).toBeCloseTo(292.5)
    expect(d.revenueMinUsd).toBeCloseTo(292.5 - 16 * 2.5) // 16 free packs from Everyone
    expect(d.burnUsd).toBeCloseTo(29.25) // 10% PLANK
    expect(d.paperUsd).toBeCloseTo(58.5) // 20% PAPER
    expect(d.keepUsd).toBeCloseTo(204.75) // 70% revenue
    // no cap: every pack of the credit group could go free; no credit group: none
    expect(dropPlan({ ...standardSale(), creditPacksPercent: '0' })).toMatchObject({ freeMax: 77, freeCapped: false })
    expect(dropPlan({ ...standardSale(), creditGroup: -1 }).freeMax).toBe(0)
    // a finite taxed group's tax all goes to PaperBurner
    const taxed = dropPlan({ ...standardSale(), packs: 10, creditGroup: -1, groups: [{ ...standardSale().groups[2], packsAs: 'count', packs: 10, afterGroup: -1, taxPercent: '10' }] })
    const r = 1.1
    const sum = (2.5 * r * (r ** 10 - 1)) / (r - 1)
    expect(taxed.revenueUsd).toBeCloseTo(sum)
    expect(taxed.paperUsd).toBeCloseTo(25 * 0.2 + (sum - 25))
    expect(taxed.keepUsd).toBeCloseTo(25 * 0.7)
  })

  it('the free-pack cap is a percent of the base total (at least 1 when on)', () => {
    expect(creditPacksMax(standardSale())).toBe(16)
    expect(creditPacksMax({ ...standardSale(), creditPacksPercent: '0' })).toBe(0)
    expect(creditPacksMax({ ...standardSale(), packs: 5, creditPacksPercent: '10' })).toBe(1)
    expect(creditPacksMax({ ...standardSale(), packs: 500, creditPacksPercent: '12.5' })).toBe(62)
  })
})

describe('templates', () => {
  it('each adds a sensible group; the After sell-out one opens after the last group', () => {
    const names = GROUP_TEMPLATES.map((t) => t.name)
    expect(names).toEqual(['Paper Press holders', 'Coin holders (snapshot)', 'NFT holders', 'Everyone', 'After sell-out (rising price)'])
    const three = standardSale().groups.slice(0, 3)
    const after = GROUP_TEMPLATES[4].make(three)
    expect(after).toMatchObject({ unlimited: true, afterGroup: 2, taxPercent: '4', idleMinutes: 15, perTx: 1, coins: 2 })
    expect(errs({ groups: [...three, after] })).toEqual([])
    // Everyone takes the rest unless a group already does
    expect(GROUP_TEMPLATES[3].make([]).packsAs).toBe('rest')
    expect(GROUP_TEMPLATES[3].make(standardSale().groups).packsAs).toBe('count')
    // a drop of just the Press template (10 packs)
    expect(saleErrors({ ...withStart({}), packs: 10, creditGroup: -1, groups: [{ ...GROUP_TEMPLATES[0].make([]), packs: 10 }] }, NOW)).toEqual([])
    // NFT holders needs its contract
    expect(saleErrors({ ...withStart({}), packs: 10, creditGroup: -1, groups: [{ ...GROUP_TEMPLATES[2].make([]), packs: 10 }] }, NOW).map((p) => p.field)).toEqual(['nft'])
  })
})

describe('old saves (before drop groups)', () => {
  const oldStandard: OldSaleSettings = {
    start: 0, paidPacks: 117, pressPacks: 50, priceUsd: '2.50', paperPerPack: '1', paperCapUsd: '1', plankBurnPercent: '10',
    paperBurnPercent: '20', plankOnly: 50, plankOnlyHours: 48, walletLimit: 5, liftHours: 48, maxPerTx: 50, holderHours: 24, holderRoot: '',
    regularWalletsHours: 48, pressPerPress: 1, pressPerWallet: 1, pressHours: 24, pressPrice: 'paper', pressUsd: '0',
    pressPaper: '1', creditsPerPick: 1, creditPacksPercent: '10', creditPacksPerWallet: 3,
  }

  it('become a Press group (its packs, per Press, per wallet, window, price) rolling into Everyone (the paid packs)', () => {
    const s = saleOf({ sale: oldStandard })
    expect(s.packs).toBe(167)
    expect(s.groups).toEqual([
      { ...blankGroup(), name: 'Paper Press holders', packs: 50, gate: 'nft', nft: 'press', perNft: 1, perWallet: 1, hours: 24, priceUsd: '0', paper: '1', coins: 0, rollTo: 1 },
      { ...blankGroup(), name: 'Everyone', packs: 117, priceUsd: '2.50', paper: '1', coins: 7, perWallet: 5 },
    ])
    expect(s).toMatchObject({ creditGroup: 1, creditPacksPercent: '10', creditPacksPerWallet: 3, maxPerTx: 50, regularWalletsHours: 48, paperCapUsd: '1', plankBurnPercent: '10', paperBurnPercent: '20' })
    expect(saleErrors({ ...s, start: NOW + 1 }, NOW)).toEqual([])
    expect(creditPacksMax(s)).toBe(16)
    expect(saleJson(s).groups.map((x) => [x.packs, x.rollTo])).toEqual([[50, 1], [117, 255]])
  })

  it('press prices: free, PAPER, dollars, dollars + PAPER', () => {
    const press = (p: OldSaleSettings) => saleOf({ sale: { ...oldStandard, ...p } }).groups[0]
    expect(press({ pressPrice: 'free' })).toMatchObject({ priceUsd: '0', paper: '0', coins: 0 })
    expect(press({ pressPrice: 'paper', pressPaper: '2.5' })).toMatchObject({ priceUsd: '0', paper: '2.5', coins: 0 })
    expect(press({ pressPrice: 'usd', pressUsd: '1' })).toMatchObject({ priceUsd: '1', paper: '0', coins: 7 })
    expect(press({ pressPrice: 'usdPaper', pressUsd: '1', pressPaper: '1' })).toMatchObject({ priceUsd: '1', paper: '1', coins: 7 })
  })

  it('no press packs: Everyone alone; no paid packs: an Everyone group taking the press leftovers', () => {
    const noPress = saleOf({ sale: { ...oldStandard, pressPacks: 0 } })
    expect(noPress.groups.map((x) => x.name)).toEqual(['Everyone'])
    expect(noPress).toMatchObject({ packs: 117, creditGroup: 0 })
    expect(saleErrors({ ...noPress, start: NOW + 1 }, NOW)).toEqual([])
    const pressOnly = saleOf({ sale: { ...oldStandard, paidPacks: 0, plankOnly: 0 } })
    expect(groupPacks(pressOnly)).toEqual([50, 0])
    expect(saleErrors({ ...pressOnly, start: NOW + 1 }, NOW)).toEqual([])
  })

  it('before the PAPER share: the old Standard 30% becomes 10% PLANK + 20% PAPER, others get no PAPER share', () => {
    const { paperBurnPercent: _p, ...noPaper } = oldStandard
    expect(saleOf({ sale: { ...noPaper, plankBurnPercent: '30' } })).toMatchObject({ plankBurnPercent: '10', paperBurnPercent: '20' })
    expect(saleOf({ sale: { ...noPaper, plankBurnPercent: '25' } })).toMatchObject({ plankBurnPercent: '25', paperBurnPercent: '0' })
    expect(saleOf({ sale: { ...oldStandard, plankBurnPercent: '30', paperBurnPercent: '5' } })).toMatchObject({ plankBurnPercent: '30', paperBurnPercent: '5' })
    expect(saleOf({})).toEqual(standardSale())
  })

  it('a free-pack cap saved as packs becomes the percent of that drop', () => {
    const { creditPacksPercent: _c, ...rest } = oldStandard
    const s = saleOf({ sale: { ...rest, creditPacksMax: 16 } })
    expect(s.creditPacksPercent).toBe('10.17')
    expect(creditPacksMax(s)).toBe(16)
  })

  it('a new save reads back as saved, missing group fields filled in', () => {
    const { taxPercent: _t, ...partial } = standardSale().groups[2]
    const s = saleOf({ sale: { ...standardSale(), groups: [partial as SaleGroup] } })
    expect(s.groups[0]).toEqual(standardSale().groups[2])
  })
})

it('reads decimals exactly', () => {
  expect(parseDecimal('2.50', 8)).toBe(250_000_000n)
  expect(parseDecimal('.5', 2)).toBe(50n)
  expect(parseDecimal('1', 18)).toBe(10n ** 18n)
  expect(parseDecimal('', 2)).toBeNull()
  expect(parseDecimal('1.2.3', 2)).toBeNull()
  expect(parseDecimal('-1', 2)).toBeNull()
})

describe('a per-wallet limit that lifts', () => {
  it('lifts after at least a minute (never exported as 0 when set)', () => {
    expect(errs(g(2, { limitHours: 0.0001 }))).toEqual(['2.limitHours'])
    expect(errs(g(2, { limitHours: 1 / 60 }))).toEqual([])
    expect(saleJson(withStart(g(2, { limitHours: 1 / 60 }))).groups[2].limitFor).toBe(60)
  })
})

describe('the ops sale policy, as warnings', () => {
  const rules = (s: Partial<SaleSettings>) => salePolicy(withStart(s)).map((p) => `${p.group ?? '-'}.${p.policy}`)
  it('Standard is inside it', () => {
    expect(salePolicy(standardSale())).toEqual([])
  })
  it('flags what launch.mjs marks RED or warns on', () => {
    expect(rules(g(2, { perWallet: 100 }))).toEqual(['2.wallet-limit'])
    expect(rules(g(2, { limitHours: 0.5 }))).toEqual(['2.limit-lifts'])
    expect(rules(g(2, { limitHours: 24 * 8 }))).toEqual(['2.limit-lifts'])
    expect(rules(g(2, { priceUsd: '0.5' }))).toEqual(['2.price'])
    expect(rules(g(2, { priceUsd: '11' }))).toEqual(['2.price'])
    expect(rules(g(2, { paper: '0.05' }))).toEqual(['2.paper-per-pack'])
    expect(rules(g(2, { paper: '0' }))).toEqual(['2.no-paper'])
    expect(rules(g(3, { taxPercent: '11' }))).toEqual(['3.tax'])
    expect(rules(g(3, { idleMinutes: 61 }))).toEqual(['3.idle'])
    expect(rules(g(2, { perWallet: 0, limitHours: 0 }))).toEqual(['2.wallet-limit'])
    expect(rules({ paperBurnPercent: '5' })).toEqual(['-.paper-burn'])
    expect(rules({ plankBurnPercent: '0', paperBurnPercent: '5' })).toEqual(['-.burn-total', '-.paper-burn'])
    expect(rules({ paperCapUsd: '0' })).toEqual(['-.paper-cap'])
    expect(rules({ paperCapUsd: '0.05' })).toEqual(['-.paper-cap'])
    const p = salePolicy(withStart(g(2, { perWallet: 100 })))[0]
    expect(p).toMatchObject({ field: 'perWallet', group: 2, warning: true, red: true })
    expect(salePolicy(withStart(g(3, { taxPercent: '11' })))[0].red).toBe(false) // ops only warns on a steep rise
  })
})
