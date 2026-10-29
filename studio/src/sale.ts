/** A Series' drop (FireSale.configureDrop), in the owner's units: hours, minutes, dollars, PAPER, percent. The drop is
 *  a total of base packs split into 1 to 6 groups (docs/drop-groups.md): each says who can buy, how many, at what
 *  price, when, and where its unsold packs go. The checks mirror ConfigureSeries.s.sol / FireGroups.configure, and
 *  saleJson turns the settings into the "sale" block of recipe.json that contracts/script/ConfigureSeries.s.sol reads
 *  (the drop-wide FireSale.DropConfig fields and a "groups" list, by name, in contract units). Shape in
 *  docs/cards-contracts.md. Cards per free pack is not here: it is fixed at 42 forever (FireCredits.CARDS_PER_CREDIT). */

import { MAX_PACKS } from './rules'

export type Gate = 'open' | 'nft' | 'snapshot'
/** How a group's packs are typed: a count, a percent of the total, or "the rest" (the total less every other group). */
export type PacksAs = 'count' | 'percent' | 'rest'

/** The coins a dollar price takes (FireGroups' bit mask). */
export const COIN = { PLANK: 1, ETH: 2, USDG: 4 } as const
export const COINS = ['PLANK', 'ETH', 'USDG'] as const

export interface SaleGroup {
  /** The studio's label (exported as "name"; not sent on chain). */
  name: string
  packsAs: PacksAs
  /** Packs when packsAs is 'count'. */
  packs: number
  /** Percent of the total when packsAs is 'percent' (up to 2 decimals). */
  percent: string
  /** No pack count: sells on top of the total while its rising price and idle end let it (needs both). */
  unlimited: boolean
  gate: Gate
  /** NFT gate: "press" (the Paper Press) or the ERC-721's 0x address. */
  nft: string
  /** NFT gate: packs per NFT id in this drop. */
  perNft: number
  /** Snapshot gate: the Merkle root from ops/snapshot (0x + 64 hex), or '' until launch (GROUP_ROOT_<i>). */
  root: string
  /** Dollars per pack ('0' = no dollar price). */
  priceUsd: string
  /** PAPER per pack ('0' = none). */
  paper: string
  /** Coins for the dollar price: PLANK 1 + ETH 2 + USDG 4. */
  coins: number
  /** Packs per wallet in this group; 0 = no limit. */
  perWallet: number
  /** The per-wallet limit lifts this many hours after the group opens (then as many as you like); 0 = never. */
  limitHours: number
  /** Packs per purchase in this group; 0 = the drop's limit. */
  perTx: number
  /** -1 = opens with the drop; else the index of an EARLIER group it opens after. */
  afterGroup: number
  /** Hours after the drop opens (or after that group ends). */
  delayHours: number
  /** Longest it stays open, hours; 0 = until its packs are gone. */
  hours: number
  /** Ends after this many minutes with no sale; 0 = off. */
  idleMinutes: number
  /** -1 = unsold packs are never made; else the index of a LATER group they go to. */
  rollTo: number
  /** Rising price: each pack costs this % more than the one before ('0' = off; at most 50). */
  taxPercent: string
  /** Liquidity share: this % of the group's dollar price, in the coin paid, goes to LiquidityBurner (the liquidity
   *  fire: it pairs PAPER with PLANK, adds them to the pool and burns the pool tokens). The Standard 10%. The name is
   *  kept from when this share burned PLANK. */
  plankBurnPercent: string
  /** More to liquidity: added to the share above, also to LiquidityBurner (the Standard 20%). The two together at most
   *  100%; the rest goes to the revenue wallet, and a rising-price tax all goes to liquidity too. The name is kept from
   *  when this share went to PaperBurner. */
  paperBurnPercent: string
}

export interface SaleSettings {
  /** Unix seconds; 0 = decided later (ConfigureSeries' DROP_START). */
  start: number
  /** The base Series: the finite groups' packs add up to it (an unlimited group sells on top). */
  packs: number
  /** Each with its own liquidity shares (plankBurnPercent, paperBurnPercent). */
  groups: SaleGroup[]
  /** Most a pack's PAPER may be worth, in dollars, at the PAPER price; 0 = no ceiling. */
  paperCapUsd: string
  /** Most packs in one purchase, drop-wide. */
  maxPerTx: number
  /** Contracts (bots) can't buy for this long after the start; 0 = off. */
  regularWalletsHours: number
  creditsPerPick: number
  /** Most free (credit) packs in this drop, as a percent of the total; 0 = no limit. */
  creditPacksPercent: string
  /** Most free (credit) packs per wallet in this drop; 0 = no limit. */
  creditPacksPerWallet: number
  /** The group free packs come from (its packs and timing; credits pay only its PAPER); -1 = no free packs. */
  creditGroup: number
}

/** Fixed forever in the contract (FireCredits.CARDS_PER_CREDIT): burn progress carries over between Series. */
export const CARDS_PER_CREDIT = 42
/** FireGroups.MAX_WINDOW: the longest any delay, duration, idle time or bots window may be. */
export const MAX_WINDOW_HOURS = 30 * 24
export const MAX_GROUPS = 6
/** FireGroups.MAX_TAX_BPS: a rising price of at most 50% a pack. */
export const MAX_TAX_PERCENT = 50
/** FireGroups.MAX_TAX_GROWTH: no pack of a taxed group may cost more than 1e9 times its base. */
const MAX_TAX_GROWTH = 1_000_000_000n

/** The Standard drop's Everyone group: 5 per wallet for this many hours after it opens, then no limit. A placeholder
 *  until the owner confirms the number. */
export const EVERYONE_LIMIT_HOURS = 24

/** The Standard shares every group starts with: 10% + 20% = 30% of its dollar price goes to LiquidityBurner (in the
 *  coin paid; docs/liquidity-burn.md). The two names are kept from when they burned PLANK and bought PAPER apart:
 *  only their sum matters now. */
export const STANDARD_PLANK_BURN = '10'
export const STANDARD_PAPER_BURN = '20'

/** A group with every field at "off" (the liquidity shares at the Standard 10% + 20%). */
export function blankGroup(): SaleGroup {
  return {
    name: '', packsAs: 'count', packs: 0, percent: '0', unlimited: false, gate: 'open', nft: '', perNft: 0, root: '',
    priceUsd: '0', paper: '0', coins: 0, perWallet: 0, limitHours: 0, perTx: 0, afterGroup: -1, delayHours: 0, hours: 0,
    idleMinutes: 0, rollTo: -1, taxPercent: '0', plankBurnPercent: STANDARD_PLANK_BURN, paperBurnPercent: STANDARD_PAPER_BURN,
  }
}

/** The groups the editor adds with one click. `others` is the groups already there (an After sell-out group opens
 *  after the last of them). */
export const GROUP_TEMPLATES: { name: string; make: (others: SaleGroup[]) => SaleGroup }[] = [
  {
    name: 'Paper Press holders',
    make: () => ({ ...blankGroup(), name: 'Paper Press holders', gate: 'nft', nft: 'press', perNft: 1, perWallet: 2, paper: '1', hours: 6 }),
  },
  {
    name: 'Coin holders (snapshot)',
    make: () => ({ ...blankGroup(), name: 'PLANK holders', gate: 'snapshot', priceUsd: '2.50', paper: '1', coins: COIN.PLANK, perWallet: 5, hours: 24 }),
  },
  {
    name: 'NFT holders',
    make: () => ({ ...blankGroup(), name: 'NFT holders', gate: 'nft', nft: '', perNft: 1, priceUsd: '2.50', paper: '1', coins: 7, hours: 24 }),
  },
  {
    name: 'Everyone',
    make: (others) => ({
      ...blankGroup(), name: 'Everyone', packsAs: others.some((g) => g.packsAs === 'rest' && !g.unlimited) ? 'count' : 'rest',
      priceUsd: '2.50', paper: '1', coins: 7, perWallet: 5, limitHours: EVERYONE_LIMIT_HOURS,
    }),
  },
  {
    name: 'After sell-out (rising price)',
    make: (others) => ({
      ...blankGroup(), name: 'After sell-out', unlimited: true, priceUsd: '2.50', paper: '1', coins: COIN.ETH, perTx: 1,
      idleMinutes: 15, taxPercent: '4', afterGroup: others.length - 1,
    }),
  },
]

/** The Standard drop (docs/drop-groups.md): 167 base packs. Paper Press holders 50 (1 PAPER, 1 per Press, 2 per wallet, up to 6h),
 *  PLANK holders 40 (snapshot, $2.50 + 1 PAPER, PLANK only, 5 per wallet, up to 24h), both rolling leftovers to
 *  Everyone; Everyone the other 77 ($2.50 + 1 PAPER, any coin, 5 per wallet for the first
 *  EVERYONE_LIMIT_HOURS, then no limit) after the PLANK group, until sold; then
 *  After sell-out: no count, $2.50 rising 4% a pack + 1 PAPER, ETH only, 1 per purchase, ends 15 minutes after its
 *  last sale. Free packs up to 10% (16), 3 per wallet, from Everyone. Every group sends 30% of its dollar price to
 *  liquidity, except the PLANK holders: all of their PLANK goes to liquidity (owner, Oct 2026). A pack's PAPER never more than
 *  $1, 50 per purchase, contracts kept out for 48h. */
export function standardSale(): SaleSettings {
  return {
    start: 0, packs: 167,
    groups: [
      { ...blankGroup(), name: 'Paper Press holders', packs: 50, gate: 'nft', nft: 'press', perNft: 1, perWallet: 2, paper: '1', hours: 6, rollTo: 2 },
      { ...blankGroup(), name: 'PLANK holders', packs: 40, gate: 'snapshot', priceUsd: '2.50', paper: '1', coins: COIN.PLANK, perWallet: 5, hours: 24, rollTo: 2, plankBurnPercent: '100', paperBurnPercent: '0' },
      { ...blankGroup(), name: 'Everyone', packsAs: 'rest', priceUsd: '2.50', paper: '1', coins: 7, perWallet: 5, limitHours: EVERYONE_LIMIT_HOURS, afterGroup: 1 },
      {
        ...blankGroup(), name: 'After sell-out', unlimited: true, priceUsd: '2.50', paper: '1', coins: COIN.ETH, perTx: 1,
        idleMinutes: 15, taxPercent: '4', afterGroup: 2,
      },
    ],
    paperCapUsd: '1', maxPerTx: 50, regularWalletsHours: 48,
    creditsPerPick: 1, creditPacksPercent: '10', creditPacksPerWallet: 3, creditGroup: 2,
  }
}

/** An example of a giant drop: 10,000 base packs, 50 per wallet (the ops policy's most), 100 per purchase, 3 packs
 *  per Press. */
export function giantSale(): SaleSettings {
  const s = standardSale()
  const [press, plank, everyone, after] = s.groups
  return {
    ...s, packs: 10_000, maxPerTx: 100,
    groups: [
      { ...press, packs: 1_000, perNft: 3, perWallet: 0, hours: 24 },
      { ...plank, packs: 1_000, perWallet: 50 },
      { ...everyone, perWallet: 50 },
      after,
    ],
  }
}

/** The testnet run (owner, Oct 29): the Standard's four groups, small and quick, so a few testers can go through every
 *  group in an afternoon with no long waits. 12 packs: Paper Press holders 2 and PLANK holders 3 open together, each
 *  ending when sold, 3 minutes after its last sale, or at 15 minutes; Everyone (the other 7, 3 per wallet) opens
 *  when the PLANK group ends; After sell-out ends 5 minutes after its last sale. Free packs: 2, 1 per wallet. Bots
 *  rule off, so testers on smart-contract wallets can buy. */
export function testRunSale(): SaleSettings {
  const s = standardSale()
  const [press, plank, everyone, after] = s.groups
  const quick = { hours: 0.25, idleMinutes: 3 }
  return {
    ...s, packs: 12, regularWalletsHours: 0, creditPacksPercent: '20', creditPacksPerWallet: 1,
    groups: [
      { ...press, packs: 2, ...quick },
      { ...plank, packs: 3, perWallet: 3, ...quick },
      { ...everyone, perWallet: 3, limitHours: 0 },
      { ...after, idleMinutes: 5 },
    ],
  }
}

export const SALE_PRESETS: { name: string; make: () => SaleSettings }[] = [
  { name: 'Standard', make: standardSale },
  { name: 'Giant', make: giantSale },
  { name: 'Test run', make: testRunSale },
]

// ---------------------------------------------------------------- old saves

/** The sale settings saved before drop groups (paid + press packs, one price, a PLANK-only share, a holder window, a
 *  wallet limit that lifted). */
export interface OldSaleSettings {
  start?: number
  paidPacks?: number
  pressPacks?: number
  priceUsd?: string
  paperPerPack?: string
  paperCapUsd?: string
  plankBurnPercent?: string
  paperBurnPercent?: string
  plankOnly?: number
  plankOnlyHours?: number
  walletLimit?: number
  liftHours?: number
  maxPerTx?: number
  holderHours?: number
  holderRoot?: string
  regularWalletsHours?: number
  pressPerPress?: number
  pressPerWallet?: number
  pressHours?: number
  pressPrice?: 'free' | 'paper' | 'usd' | 'usdPaper'
  pressUsd?: string
  pressPaper?: string
  creditsPerPick?: number
  creditPacksPercent?: string
  /** Older still: the free-pack cap as a number of packs. */
  creditPacksMax?: number
  creditPacksPerWallet?: number
}

export const isOldSale = (sale: unknown): boolean => !!sale && typeof sale === 'object' && !Array.isArray((sale as { groups?: unknown }).groups)

/** An old save as groups: the press packs as a "Paper Press holders" group (its per-press, per-wallet, window and
 *  price), rolling its leftovers into "Everyone" (the paid packs at the old price and wallet limit, any coin). The
 *  PLANK-only share, holder window and wallet-limit lift have no group of their own (keep it simple: the owner adds a
 *  snapshot group if wanted). Free packs come from Everyone, the cap as before. The burn shares, PAPER ceiling,
 *  packs per purchase, bots window and start carry over. Saved before the second share existed: the old Standard 30%
 *  becomes 10% + 20% (the two liquidity shares); any other share keeps its number in the first, with 0 in the second. */
export function saleFromOld(old: OldSaleSettings): SaleSettings {
  const std = standardSale()
  const num = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const paid = Math.max(0, Math.floor(num(old.paidPacks, 117)))
  const press = Math.max(0, Math.floor(num(old.pressPacks, 50)))
  const price = old.priceUsd ?? '2.50'
  const paper = old.paperPerPack ?? '1'
  const pp = old.pressPrice ?? 'paper'
  const groups: SaleGroup[] = []
  if (press > 0) {
    groups.push({
      ...blankGroup(), name: 'Paper Press holders', packs: press, gate: 'nft', nft: 'press', perNft: num(old.pressPerPress, 1),
      perWallet: num(old.pressPerWallet, 1), hours: num(old.pressHours, 24),
      priceUsd: pp === 'usd' || pp === 'usdPaper' ? (old.pressUsd ?? '0') : '0',
      paper: pp === 'paper' || pp === 'usdPaper' ? (old.pressPaper ?? '1') : '0',
      coins: pp === 'usd' || pp === 'usdPaper' ? 7 : 0,
      rollTo: 1,
    })
  }
  groups.push({ ...blankGroup(), name: 'Everyone', packs: paid, priceUsd: price, paper, coins: 7, perWallet: num(old.walletLimit, 5) })
  let plankBurnPercent = old.plankBurnPercent ?? STANDARD_PLANK_BURN
  let paperBurnPercent = old.paperBurnPercent ?? STANDARD_PAPER_BURN
  if (old.paperBurnPercent === undefined && old.plankBurnPercent !== undefined) {
    const oldStandard = old.plankBurnPercent.trim() === '30'
    plankBurnPercent = oldStandard ? '10' : old.plankBurnPercent
    paperBurnPercent = oldStandard ? '20' : '0'
  }
  const total = paid + press
  const creditPacksPercent = old.creditPacksPercent ?? (old.creditPacksMax !== undefined ? capPercentOf(old.creditPacksMax, total) : std.creditPacksPercent)
  return {
    start: num(old.start, 0), packs: total, groups: groups.map((g) => ({ ...g, plankBurnPercent, paperBurnPercent })),
    paperCapUsd: old.paperCapUsd ?? std.paperCapUsd, maxPerTx: num(old.maxPerTx, std.maxPerTx),
    regularWalletsHours: num(old.regularWalletsHours, std.regularWalletsHours), creditsPerPick: num(old.creditsPerPick, std.creditsPerPick),
    creditPacksPercent,
    creditPacksPerWallet: num(old.creditPacksPerWallet, old.creditPacksMax !== undefined ? 0 : std.creditPacksPerWallet),
    creditGroup: groups.length - 1,
  }
}

/** A Series' sale settings: the saved ones over the Standard drop's drop-wide defaults (each group over a blank
 *  group), or an old save converted to groups (saleFromOld); no sale saved = the Standard drop. A save from when the
 *  burn shares were drop-wide gives each group those shares (unless the group has its own). */
export function saleOf(f: { sale?: Partial<SaleSettings> | OldSaleSettings }): SaleSettings {
  if (!f.sale) return standardSale()
  if (isOldSale(f.sale)) return saleFromOld(f.sale as OldSaleSettings)
  const { plankBurnPercent, paperBurnPercent, ...s } = f.sale as Partial<SaleSettings> & { plankBurnPercent?: string; paperBurnPercent?: string }
  const shares = { ...(plankBurnPercent !== undefined ? { plankBurnPercent } : {}), ...(paperBurnPercent !== undefined ? { paperBurnPercent } : {}) }
  return { ...standardSale(), ...s, groups: (s.groups ?? []).map((g) => ({ ...blankGroup(), ...shares, ...g })) }
}

// ---------------------------------------------------------------- packs

/** The drop's base packs: the Series' pack count (FireRecord.packs follows it while the deal is open): the pool, the
 *  rarity and the per-pack numbers all use it. An unlimited group's sales come on top. */
export function salePacks(s: SaleSettings): number {
  return s.packs
}

/** Each group's packs, as exported: counts as typed, a percent of the total (rounded down, then the packs short of
 *  the total handed out by largest remainder when the percents fill it to the nearest pack), "the rest" the total less
 *  every other finite group (may be negative: checkSale says so), unlimited 0. */
export function groupPacks(s: SaleSettings): number[] {
  const total = Number.isFinite(s.packs) ? Math.max(0, Math.floor(s.packs)) : 0
  const out = s.groups.map(() => 0)
  const pct: { i: number; frac: bigint }[] = []
  let used = 0
  let pctBp = 0n
  s.groups.forEach((g, i) => {
    if (g.unlimited || g.packsAs === 'rest') return
    if (g.packsAs === 'count') out[i] = Number.isFinite(g.packs) ? g.packs : 0
    else {
      const bp = parseDecimal(g.percent, 2) ?? 0n
      const exact = BigInt(total) * bp
      out[i] = Number(exact / 10_000n)
      pct.push({ i, frac: exact % 10_000n })
      pctBp += bp
    }
    used += out[i]
  })
  const restAt = s.groups.findIndex((g) => !g.unlimited && g.packsAs === 'rest')
  if (restAt >= 0) out[restAt] = total - used
  else if (pct.length) {
    // the percents fill exactly what the counts leave: give the rounding's few packs to the largest remainders
    const counted = s.groups.reduce((n, g, i) => n + (!g.unlimited && g.packsAs === 'count' ? out[i] : 0), 0)
    // (to the nearest pack: 2-decimal percents rarely land exactly)
    if ((BigInt(total) * pctBp + 5_000n) / 10_000n === BigInt(total - counted)) {
      let short = total - used
      for (const p of [...pct].sort((a, b) => (a.frac === b.frac ? a.i - b.i : a.frac > b.frac ? -1 : 1))) {
        if (short <= 0) break
        out[p.i]++
        short--
      }
    }
  }
  return out
}

/** `s` with a total of `packs`: count groups keep their packs (cut in order to fit), percents and "the rest" follow.
 *  Turns a Series' old pack count into sale settings. */
export function saleWithPacks(s: SaleSettings, packs: number): SaleSettings {
  const total = Math.max(0, Math.floor(packs) || 0)
  let left = total
  const groups = s.groups.map((g) => {
    if (g.unlimited || g.packsAs !== 'count') return g
    const n = Math.min(Math.max(0, g.packs), left)
    left -= n
    return { ...g, packs: n }
  })
  return { ...s, packs: total, groups }
}

/** A free-pack cap saved as a number of packs (before it was a percent) as the percent of the drop's `packs` that
 *  gives at most that many (0 stays 0: no cap). */
export function capPercentOf(maxPacks: number, packs: number): string {
  if (!(maxPacks > 0)) return '0'
  if (!(packs > 0) || maxPacks >= packs) return '100'
  // the largest percent (2 decimals) whose cap, as creditPacksMax rounds it, is still at most maxPacks
  const bp = (BigInt(Math.floor(maxPacks) + 1) * 10_000n - 1n) / BigInt(Math.floor(packs))
  return String(Number(bp < 1n ? 1n : bp) / 100)
}

/** A decimal typed as text ("2.50") to an integer with `decimals` places; null if it isn't one or has more places. */
export function parseDecimal(text: string, decimals: number): bigint | null {
  const m = /^\s*(\d*)(?:\.(\d*))?\s*$/.exec(text)
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null
  const frac = m[2] ?? ''
  if (frac.length > decimals) return null
  return BigInt(m[1] || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

const U16 = 0xffffn
const U32 = 0xffff_ffffn
const U64 = 0xffff_ffff_ffff_ffffn
const U128 = (1n << 128n) - 1n
const NONE = 255

/** The free-pack cap in packs: the percent of the base total, rounded down (at least 1 when it's on). */
export function creditPacksMax(s: SaleSettings): number {
  const bp = parseDecimal(s.creditPacksPercent, 2)
  if (bp == null || bp === 0n || !(s.packs > 0)) return 0
  return Math.max(1, Number((BigInt(Math.floor(s.packs)) * bp) / 10_000n))
}

const usd8 = (t: string) => parseDecimal(t, 8) ?? 0n
const bpsOf = (t: string) => Number(parseDecimal(t, 2) ?? 0n)
const seconds = (h: number) => Math.round(h * 3600)
export const groupName = (s: SaleSettings, i: number) => s.groups[i]?.name.trim() || `Group ${i + 1}`

/** FireGroups._growthOk: (1 + bps/10000)^n <= 1e9, in the contract's 18-decimal fixed point. */
export function taxGrowthOk(bps: number, n: number): boolean {
  const lim = MAX_TAX_GROWTH * 10n ** 18n
  let r = 10n ** 18n + BigInt(bps) * 10n ** 14n
  let z = 10n ** 18n
  let k = BigInt(Math.max(0, Math.floor(n)))
  while (k > 0n) {
    if (k & 1n) {
      z = (z * r) / 10n ** 18n
      if (z > lim) return false
    }
    k >>= 1n
    if (k > 0n) {
      if (r > lim) return false
      r = (r * r) / 10n ** 18n
    }
  }
  return true
}

/** The k-th pack of a taxed group (k = 1 for its first): base * (1 + bps/10000)^k, as the contract prices it. */
export const taxedPrice = (base: number, bps: number, k: number) => base * (1 + bps / 10_000) ** k

// ---------------------------------------------------------------- checks

export type SaleField = Exclude<keyof SaleSettings, 'groups'>
export type GroupField = keyof SaleGroup
/** A problem on a drop-wide field, or (with `group`) on one group's field. Warnings don't block the export. */
export interface SaleProblem { field: SaleField | GroupField; group?: number; message: string; warning?: boolean }

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const ROOT = /^0x[0-9a-fA-F]{64}$/

/** ConfigureSeries' and configureDrop's checks (plus the field widths), each on the field it's about, in plain words. */
export function checkSale(s: SaleSettings, now = Date.now() / 1000): SaleProblem[] {
  const out: SaleProblem[] = []
  const bad = (field: SaleField, message: string) => out.push({ field, message })
  const whole = (field: SaleField, v: number, max: bigint, what: string) => {
    if (!Number.isInteger(v) || v < 0) bad(field, `${what}: a whole number, 0 or more.`)
    else if (BigInt(v) > max) bad(field, `${what}: too big for the contract.`)
  }
  const hours = (h: number) => Number.isFinite(h) && h >= 0 && seconds(h) <= MAX_WINDOW_HOURS * 3600
  const n = s.groups.length
  whole('packs', s.packs, U64, 'Total packs')
  if (Number.isInteger(s.packs) && s.packs === 0) bad('packs', 'The drop needs at least one pack.')
  else if (s.packs > MAX_PACKS) bad('packs', `At most ${MAX_PACKS.toLocaleString('en-US')} packs in all.`)
  whole('maxPerTx', s.maxPerTx, U32, 'Packs per purchase')
  if (s.maxPerTx === 0) bad('maxPerTx', 'At least 1.')
  whole('creditsPerPick', s.creditsPerPick, U16, 'Credits per picked suggestion')
  whole('creditPacksPerWallet', s.creditPacksPerWallet, U64, 'Free packs per wallet')

  const paperCap = parseDecimal(s.paperCapUsd, 8)
  if (paperCap == null || paperCap > U128) bad('paperCapUsd', 'A dollar amount, up to 8 decimals (0 = no ceiling).')
  const creditPct = parseDecimal(s.creditPacksPercent, 2)
  if (creditPct == null || creditPct > 10_000n) bad('creditPacksPercent', '0 to 100%, up to 2 decimals (0 = no limit).')
  if (!hours(s.regularWalletsHours)) bad('regularWalletsHours', `Hours, 0 to ${MAX_WINDOW_HOURS} (30 days).`)

  if (n === 0) bad('packs', 'Add at least one group: it says who can buy the packs.')
  if (n > MAX_GROUPS) bad('packs', `At most ${MAX_GROUPS} groups.`)
  if (s.creditGroup !== -1 && !(Number.isInteger(s.creditGroup) && s.creditGroup >= 0 && s.creditGroup < n)) {
    bad('creditGroup', 'Pick a group for free packs, or "none".')
  } else if (s.creditGroup >= 0 && !creditGroupOk(s.groups[s.creditGroup])) {
    bad('creditGroup', `Free packs need a fixed, untaxed group: ${groupName(s, s.creditGroup)} is ${s.groups[s.creditGroup].unlimited ? 'unlimited' : 'taxed (rising price)'}.`)
  }

  const packs = groupPacks(s)
  const finite = s.groups.some((g) => !g.unlimited)
  const sum = packs.reduce((a, b) => a + b, 0)
  if (n > 0 && !finite) bad('packs', 'Every group is unlimited: at least one group needs a pack count (the base Series).')
  else if (n > 0 && Number.isInteger(s.packs) && s.packs > 0 && sum !== s.packs && packs.every((p) => p >= 0)) {
    bad('packs', `The groups add up to ${sum.toLocaleString('en-US')} packs, not the total ${s.packs.toLocaleString('en-US')}.`)
  }
  if (s.groups.filter((g) => !g.unlimited && g.packsAs === 'rest').length > 1) {
    s.groups.forEach((g, i) => { if (!g.unlimited && g.packsAs === 'rest') out.push({ field: 'packs', group: i, message: 'Only one group can take "the rest".' }) })
  }

  s.groups.forEach((g, i) => {
    const gp = (field: GroupField, message: string, warning?: boolean) => out.push({ field, group: i, message, ...(warning ? { warning } : {}) })
    const gwhole = (field: GroupField, v: number, max: bigint, what: string) => {
      if (!Number.isInteger(v) || v < 0) gp(field, `${what}: a whole number, 0 or more.`)
      else if (BigInt(v) > max) gp(field, `${what}: too big for the contract.`)
    }
    // packs
    if (!g.unlimited) {
      if (g.packsAs === 'count') gwhole('packs', g.packs, U64, 'Packs')
      else if (g.packsAs === 'percent') {
        const p = parseDecimal(g.percent, 2)
        if (p == null || p > 10_000n) gp('percent', '0 to 100%, up to 2 decimals.')
      } else if (packs[i] < 0) gp('packs', `The other groups take ${(s.packs - packs[i]).toLocaleString('en-US')}: more than the total.`)
    }
    // who
    if (g.gate === 'nft') {
      if (g.nft !== 'press' && !ADDRESS.test(g.nft)) gp('nft', 'The NFT contract: 0x and 40 hex characters (or pick Paper Press).')
      gwhole('perNft', g.perNft, U32, 'Packs per NFT')
      if (g.perNft === 0) gp('perNft', 'At least 1 pack per NFT.')
    } else if (g.gate === 'snapshot') {
      if (g.root !== '' && !ROOT.test(g.root)) gp('root', '0x and 64 hex characters (ops/snapshot prints it), or blank until launch.')
      if (g.root === '') gp('root', `No snapshot root yet: run ops/snapshot before launch and set GROUP_ROOT_${i} (or paste it here).`, true)
    }
    // price
    const price = parseDecimal(g.priceUsd, 8)
    if (price == null || price > U128) gp('priceUsd', 'A dollar amount, up to 8 decimals (0 = none).')
    const paper = parseDecimal(g.paper, 18)
    if (paper == null || paper > U128) gp('paper', 'A PAPER amount, up to 18 decimals (0 = none).')
    if (!Number.isInteger(g.coins) || g.coins < 0 || g.coins > 7) gp('coins', 'PLANK, ETH and/or USDG.')
    else if (price != null && price > 0n && g.coins === 0) gp('coins', 'A dollar price needs a coin: tick PLANK, ETH or USDG.')
    // the group's burn shares: at most 100% together (FireGroups refuses more)
    const burn = parseDecimal(g.plankBurnPercent, 2)
    if (burn == null || burn > 10_000n) gp('plankBurnPercent', '0 to 100%, up to 2 decimals.')
    const paperBurn = parseDecimal(g.paperBurnPercent, 2)
    if (paperBurn == null || paperBurn > 10_000n) gp('paperBurnPercent', '0 to 100%, up to 2 decimals.')
    else if (burn != null && burn + paperBurn > 10_000n) gp('paperBurnPercent', 'The PLANK and PAPER shares add up to more than 100%.')
    if (g.gate === 'open' && price === 0n && paper === 0n) gp('priceUsd', 'Free packs open to everyone are refused: give it a price, PAPER or a "who".')
    gwhole('perWallet', g.perWallet, U32, 'Per wallet')
    gwhole('perTx', g.perTx, U32, 'Per purchase')
    if (!hours(g.limitHours)) gp('limitHours', `Hours, 0 to ${MAX_WINDOW_HOURS} (30 days; 0 = never).`)
    else if (g.limitHours > 0 && !g.perWallet) gp('limitHours', 'Lifts the per-wallet limit: set a per wallet first (or leave this blank).')
    else if (g.limitHours > 0 && seconds(g.limitHours) < 60) gp('limitHours', 'At least 1 minute (0.02 hours), or blank for never.')
    // when
    if (g.afterGroup !== -1 && !(Number.isInteger(g.afterGroup) && g.afterGroup >= 0 && g.afterGroup < i)) {
      gp('afterGroup', 'It can only open after a group above it (or with the drop).')
    }
    if (!hours(g.delayHours)) gp('delayHours', `Hours, 0 to ${MAX_WINDOW_HOURS} (30 days).`)
    if (!hours(g.hours)) gp('hours', `Hours, 0 to ${MAX_WINDOW_HOURS} (30 days; 0 = no limit).`)
    if (!(Number.isFinite(g.idleMinutes) && g.idleMinutes >= 0 && Math.round(g.idleMinutes * 60) <= MAX_WINDOW_HOURS * 3600)) {
      gp('idleMinutes', `Minutes, 0 to ${(MAX_WINDOW_HOURS * 60).toLocaleString('en-US')} (30 days; 0 = off).`)
    }
    // leftovers
    if (g.rollTo !== -1) {
      if (!(Number.isInteger(g.rollTo) && g.rollTo > i && g.rollTo < n)) gp('rollTo', 'Leftovers can only go to a group below it (or nowhere).')
      else if (s.groups[g.rollTo].unlimited) gp('rollTo', `${groupName(s, g.rollTo)} is unlimited: nothing rolls into it.`)
      else if (bpsOf(s.groups[g.rollTo].taxPercent) > 0) gp('rollTo', `${groupName(s, g.rollTo)} has a rising price: it takes no leftovers.`)
    }
    // rising price, unlimited
    const tax = parseDecimal(g.taxPercent, 2)
    if (tax == null || tax > BigInt(MAX_TAX_PERCENT * 100)) gp('taxPercent', `0 to ${MAX_TAX_PERCENT}% a pack, up to 2 decimals (0 = off).`)
    else if (tax > 0n) {
      if (price === 0n) gp('taxPercent', 'A rising price needs a dollar price.')
      else if (!g.unlimited && packs[i] > 0 && !taxGrowthOk(Number(tax), packs[i])) {
        gp('taxPercent', `Too steep for ${packs[i].toLocaleString('en-US')} packs: the last would cost over a billion times the first. Fewer packs or a smaller rise.`)
      }
    }
    if (g.unlimited) {
      if (tax === 0n || Math.round(g.idleMinutes * 60) === 0) gp('unlimited', 'An unlimited group needs a rising price and an "ends after no sale" time, so it always stops.')
      if (g.rollTo !== -1) gp('rollTo', 'An unlimited group has no leftovers: set it to nowhere.')
    }
  })

  if (s.start !== 0 && s.start <= now) out.push({ field: 'start', message: 'The start is in the past: the contract needs a future start.', warning: true })
  else if (s.start > now + 365 * 86_400) bad('start', 'More than a year away: a typo?')
  if (s.start === 0) out.push({ field: 'start', message: 'No start yet: set it here or with DROP_START when running ConfigureSeries.', warning: true })
  if (s.creditGroup === -1 && creditPct != null && creditPct > 0n) {
    out.push({ field: 'creditGroup', message: 'No group for free packs: credits can\'t buy packs in this drop.', warning: true })
  }
  return out
}

export const saleErrors = (s: SaleSettings, now?: number) => checkSale(s, now).filter((p) => !p.warning)

/** Whether free (credit) packs can come from this group: FireGroups refuses a taxed or unlimited credit group. */
export const creditGroupOk = (g: SaleGroup | undefined): boolean => !!g && !g.unlimited && bpsOf(g.taxPercent) === 0

// ---------------------------------------------------------------- export

/** One group of the "sale" block: FireGroups.Group by field name, contract units. Big numbers go as strings. */
export interface SaleGroupJson {
  name?: string
  packs: number
  gate: Gate
  nft?: string
  perNft?: number
  root?: string
  priceUsd: string
  paper: string
  coins: number
  /** The group's burn shares, basis points of its dollar price (FireGroups.Group); together at most 10000. */
  plankBurnBps: number
  paperBurnBps: number
  perWallet: number
  /** Seconds after the group opens that perWallet lifts (FireGroups.Group.limitFor); left out = never. */
  limitFor?: number
  afterGroup: number
  startDelay: number
  duration: number
  rollTo: number
  taxBps?: number
  idle?: number
  perTx?: number
  unlimited?: boolean
}

/** The "sale" block of recipe.json: FireSale.DropConfig by field name, contract units, with its groups. */
export interface SaleJson {
  start: number
  packs: number
  paperCapUsd: string
  maxPerTx: number
  regularWalletsFor: number
  creditsPerPick: number
  creditPacksMax: number
  creditPacksPerWallet: number
  creditGroup: number
  groups: SaleGroupJson[]
}

export function saleJson(s: SaleSettings): SaleJson {
  const packs = groupPacks(s)
  return {
    start: s.start,
    packs: s.packs,
    paperCapUsd: String(usd8(s.paperCapUsd)),
    maxPerTx: s.maxPerTx,
    regularWalletsFor: seconds(s.regularWalletsHours),
    creditsPerPick: s.creditsPerPick,
    creditPacksMax: creditPacksMax(s),
    creditPacksPerWallet: s.creditPacksPerWallet,
    creditGroup: s.creditGroup < 0 ? NONE : s.creditGroup,
    groups: s.groups.map((g, i) => groupJson(g, packs[i])),
  }
}

function groupJson(g: SaleGroup, packs: number): SaleGroupJson {
  const price = usd8(g.priceUsd)
  const tax = bpsOf(g.taxPercent)
  const idle = Math.round(g.idleMinutes * 60)
  return {
    ...(g.name.trim() ? { name: g.name.trim() } : {}),
    packs: g.unlimited ? 0 : packs,
    gate: g.gate,
    ...(g.gate === 'nft' ? { nft: g.nft, perNft: g.perNft } : {}),
    ...(g.gate === 'snapshot' && g.root ? { root: g.root.toLowerCase() } : {}),
    priceUsd: String(price),
    paper: String(parseDecimal(g.paper, 18) ?? 0n),
    coins: price === 0n ? 0 : g.coins,
    plankBurnBps: bpsOf(g.plankBurnPercent),
    paperBurnBps: bpsOf(g.paperBurnPercent),
    perWallet: g.perWallet,
    ...(g.limitHours > 0 ? { limitFor: seconds(g.limitHours) } : {}),
    afterGroup: g.afterGroup < 0 ? NONE : g.afterGroup,
    startDelay: seconds(g.delayHours),
    duration: seconds(g.hours),
    rollTo: g.rollTo < 0 ? NONE : g.rollTo,
    ...(tax ? { taxBps: tax } : {}),
    ...(idle ? { idle } : {}),
    ...(g.perTx ? { perTx: g.perTx } : {}),
    ...(g.unlimited ? { unlimited: true } : {}),
  }
}

// ---------------------------------------------------------------- the picture

/** The drop as numbers: what a sell-out of the base packs brings in and where the dollars go. */
export interface DropPlan {
  /** The base packs (the finite groups). */
  total: number
  /** Each group's packs (unlimited 0). */
  packs: number[]
  /** Most packs that can go free to credits, from the credit group (0 = none). */
  freeMax: number
  freeCapped: boolean
  /** Dollars if every group sells its own packs at its price (a rising price included); unlimited sales on top. */
  revenueUsd: number
  /** The same with every free pack used. */
  revenueMinUsd: number
  /** The plankBurnBps part of the base prices (each group's own share), to LiquidityBurner. */
  burnUsd: number
  /** The paperBurnBps part of the base prices plus every rising-price tax, to LiquidityBurner. */
  paperUsd: number
  /** All of it to LiquidityBurner: burnUsd + paperUsd. */
  liquidityUsd: number
  /** What's left for the revenue wallet. */
  keepUsd: number
  /** PAPER paid (and burned) with the base packs. */
  paperPaid: number
}

export function dropPlan(s: SaleSettings): DropPlan {
  const packs = groupPacks(s).map((p) => (Number.isFinite(p) && p > 0 ? Math.floor(p) : 0))
  const total = packs.reduce((a, b) => a + b, 0)
  let base = 0
  let tax = 0
  let burnUsd = 0
  let paperShare = 0
  let paperPaid = 0
  s.groups.forEach((g, i) => {
    const p = Number(usd8(g.priceUsd)) / 1e8
    const bps = bpsOf(g.taxPercent)
    const n = g.unlimited ? 0 : packs[i]
    base += n * p
    burnUsd += n * p * (bpsOf(g.plankBurnPercent) / 10_000)
    paperShare += n * p * (bpsOf(g.paperBurnPercent) / 10_000)
    if (bps > 0 && n > 0) {
      const r = 1 + bps / 10_000
      tax += (p * r * (r ** n - 1)) / (r - 1) - n * p
    }
    paperPaid += n * (Number(parseDecimal(g.paper, 18) ?? 0n) / 1e18)
  })
  const cg = s.groups[s.creditGroup]
  const cap = creditPacksMax(s)
  const groupCap = cg ? (cg.unlimited ? Infinity : packs[s.creditGroup]) : 0
  const freeMax = !cg ? 0 : cap > 0 ? Math.min(cap, groupCap) : groupCap === Infinity ? 0 : groupCap
  const cgPrice = cg ? Number(usd8(cg.priceUsd)) / 1e8 : 0
  const revenueUsd = base + tax
  return {
    total, packs, freeMax, freeCapped: cap > 0, revenueUsd, revenueMinUsd: revenueUsd - freeMax * cgPrice,
    burnUsd, paperUsd: paperShare + tax, liquidityUsd: burnUsd + paperShare + tax, keepUsd: base - burnUsd - paperShare, paperPaid,
  }
}

/** When each group opens and ends, in hours from the drop's start, at the latest ("up to"): `opens` null when it
 *  waits for a group that runs until sold; `ends` null when it runs until sold (or, unlimited, until it idles). */
export interface GroupTime { opens: number | null; ends: number | null }

export function groupTimes(s: SaleSettings): GroupTime[] {
  const out: GroupTime[] = []
  s.groups.forEach((g, i) => {
    const delay = Number.isFinite(g.delayHours) ? Math.max(0, g.delayHours) : 0
    const after = g.afterGroup >= 0 && g.afterGroup < i ? out[g.afterGroup] : null
    const opens = g.afterGroup < 0 || g.afterGroup >= i ? delay : after && after.ends != null ? after.ends + delay : null
    const ends = opens != null && g.hours > 0 ? opens + g.hours : null
    out.push({ opens, ends })
  })
  return out
}

/** Hours as the owner reads them: "15 min", "6h", "2d", "1.5h". */
export function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h >= 48 && h % 24 === 0) return `${h / 24}d`
  return `${Math.round(h * 100) / 100}h`
}

const money = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const coinsText = (c: number) => {
  if (c === 7) return 'any coin'
  const names = COINS.filter((k) => c & COIN[k])
  return names.length === 1 ? `${names[0]} only` : names.join(' or ')
}

/** One plain-English line for group `i`: "50 packs for Paper Press holders · 1 PAPER · 1 per Press · up to 6h ·
 *  leftovers → Everyone". */
export function groupSummary(s: SaleSettings, i: number): string {
  const g = s.groups[i]
  const packs = groupPacks(s)[i]
  const parts: string[] = []
  const who = g.gate === 'open' ? 'everyone'
    : g.gate === 'snapshot' ? 'the snapshot list'
    : g.nft === 'press' ? 'Paper Press holders' : `holders of ${g.nft ? `${g.nft.slice(0, 6)}…${g.nft.slice(-4)}` : 'an NFT'}`
  parts.push(g.unlimited ? `No pack count, for ${who}` : `${packs.toLocaleString('en-US')} packs for ${who}`)
  const price = Number(usd8(g.priceUsd)) / 1e8
  const paper = g.paper.trim() && (parseDecimal(g.paper, 18) ?? 0n) > 0n ? `${g.paper.trim()} PAPER` : ''
  const tax = bpsOf(g.taxPercent)
  const usd = price > 0 ? `${money(price)}${tax ? ` rising ${tax / 100}% a pack` : ''}` : ''
  parts.push([usd, paper].filter(Boolean).join(' + ') || 'free')
  if (price > 0) parts.push(coinsText(g.coins))
  // the liquidity share, when the group's differs from the Standard 30%
  const lq = bpsOf(g.plankBurnPercent) + bpsOf(g.paperBurnPercent)
  if (price > 0 && lq !== bpsOf(STANDARD_PLANK_BURN) + bpsOf(STANDARD_PAPER_BURN)) parts.push(`${lq / 100}% to liquidity`)
  if (g.gate === 'nft') parts.push(`${g.perNft} per ${g.nft === 'press' ? 'Press' : 'NFT'}`)
  if (g.perWallet) parts.push(`${g.perWallet} per wallet${g.limitHours > 0 ? ` for ${fmtHours(g.limitHours)}, then no limit` : ''}`)
  if (g.perTx) parts.push(`${g.perTx} per purchase`)
  const delay = g.delayHours > 0 ? ` + ${fmtHours(g.delayHours)}` : ''
  if (g.afterGroup >= 0) parts.push(`opens after ${groupName(s, g.afterGroup)}${delay}`)
  else if (delay) parts.push(`opens ${fmtHours(g.delayHours)} in`)
  parts.push(g.hours > 0 ? `up to ${fmtHours(g.hours)}` : g.unlimited ? 'no time limit' : 'until sold')
  if (g.idleMinutes > 0) parts.push(`ends after ${fmtHours(g.idleMinutes / 60)} with no sale`)
  if (!g.unlimited && (g.hours > 0 || g.idleMinutes > 0)) {
    parts.push(g.rollTo >= 0 ? `leftovers → ${groupName(s, g.rollTo)}` : 'leftovers never made')
  }
  return parts.join(' · ')
}

/** A taxed group's first prices: packs 1, 10, 25 and 50 (those it has), at the contract's base × (1 + bps/10000)^k. */
export function taxedPrices(s: SaleSettings, i: number): { k: number; usd: number }[] {
  const g = s.groups[i]
  const bps = bpsOf(g.taxPercent)
  const base = Number(usd8(g.priceUsd)) / 1e8
  if (!bps || !base) return []
  const n = g.unlimited ? Infinity : groupPacks(s)[i]
  return [1, 10, 25, 50].filter((k) => k <= n).map((k) => ({ k, usd: taxedPrice(base, bps, k) }))
}
