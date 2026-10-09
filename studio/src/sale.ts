/** A Series' drop settings (FireSale.configureDrop), in the owner's units: hours, dollars, PAPER, percent. The
 *  checks mirror configureDrop's, and saleJson turns them into the "sale" block of recipe.json that
 *  contracts/script/ConfigureSeries.s.sol reads (every FireSale.DropConfig field by name, in contract units). Shape
 *  in docs/cards-contracts.md. Cards per free pack is not here: it is fixed at 42 forever (FireCredits.CARDS_PER_CREDIT). */

/** How press packs are paid for. 'usdPaper' is a dollar price plus PAPER. */
export type PressPrice = 'free' | 'paper' | 'usd' | 'usdPaper'
export const PRESS_PRICE_LABEL: Record<PressPrice, string> = {
  free: 'Free', paper: 'PAPER only', usd: 'Dollar price (PLANK, ETH or USDG)', usdPaper: 'Dollar price + PAPER',
}

export interface SaleSettings {
  /** Unix seconds; 0 = decided later (ConfigureSeries' DROP_START). */
  start: number
  paidPacks: number
  pressPacks: number
  priceUsd: string
  paperPerPack: string
  /** Most a pack's PAPER may be worth, in dollars, at the PAPER price (paid, press and free packs); 0 = no ceiling. */
  paperCapUsd: string
  plankBurnPercent: string
  plankOnly: number
  plankOnlyHours: number
  /** Paid packs per wallet; 0 = no limit (then liftHours is 0 too). */
  walletLimit: number
  liftHours: number
  maxPerTx: number
  holderHours: number
  /** 0x + 64 hex from ops/snapshot, or '' (presses only, or decided later with HOLDER_ROOT). */
  holderRoot: string
  regularWalletsHours: number
  pressPerPress: number
  pressPerWallet: number
  pressHours: number
  pressPrice: PressPrice
  pressUsd: string
  pressPaper: string
  creditsPerPick: number
  /** Most free (credit) packs in this drop in all, as a percent of the drop's packs; 0 = no limit. */
  creditPacksPercent: string
  /** Most free (credit) packs per wallet in this drop; 0 = no limit. */
  creditPacksPerWallet: number
}

/** Fixed forever in the contract (FireCredits.CARDS_PER_CREDIT): burn progress carries over between Series. */
export const CARDS_PER_CREDIT = 42
/** FireSale.MAX_WINDOW: the longest any timed phase may be. */
export const MAX_WINDOW_HOURS = 30 * 24

/** Today's Standard drop: 167 packs (117 paid + 50 press), $2.50 + 1 PAPER, 50 PLANK-only, 5 per wallet lifting after
 *  48h, 24h press window, 24h holder window, 30% PLANK burn, 50 per purchase, 1 press pack per press for 1 PAPER,
 *  free packs capped at 10% of the drop and 3 per wallet, a pack's PAPER never more than $1 worth. */
export function standardSale(): SaleSettings {
  return {
    start: 0, paidPacks: 117, pressPacks: 50, priceUsd: '2.50', paperPerPack: '1', paperCapUsd: '1', plankBurnPercent: '30',
    plankOnly: 50, plankOnlyHours: 48, walletLimit: 5, liftHours: 48, maxPerTx: 50, holderHours: 24, holderRoot: '',
    regularWalletsHours: 48, pressPerPress: 1, pressPerWallet: 1, pressHours: 24, pressPrice: 'paper', pressUsd: '0',
    pressPaper: '1', creditsPerPick: 1, creditPacksPercent: '10', creditPacksPerWallet: 3,
  }
}

/** A Series' sale settings: the saved ones over the Standard sale (settings saved before a field existed get its
 *  default). */
export function saleOf(f: { sale?: Partial<SaleSettings> }): SaleSettings {
  return { ...standardSale(), ...f.sale }
}

/** An example of a giant drop: 10,000 packs, 100 per wallet and per purchase. */
export function giantSale(): SaleSettings {
  return {
    ...standardSale(), paidPacks: 9_000, pressPacks: 1_000, plankOnly: 1_000, walletLimit: 100, maxPerTx: 100,
    pressPerPress: 3, pressPerWallet: 10,
  }
}

export const SALE_PRESETS: { name: string; make: () => SaleSettings }[] = [
  { name: 'Standard', make: standardSale },
  { name: 'Giant', make: giantSale },
]

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

/** The free-pack cap in packs: the percent of all the drop's packs, rounded down (at least 1 when it's on). */
export function creditPacksMax(s: SaleSettings): number {
  const bp = parseDecimal(s.creditPacksPercent, 2)
  if (bp == null || bp === 0n) return 0
  return Math.max(1, Number((BigInt(s.paidPacks + s.pressPacks) * bp) / 10_000n))
}

export type SaleField = keyof SaleSettings
export interface SaleProblem { field: SaleField; message: string; warning?: boolean }

const seconds = (h: number) => Math.round(h * 3600)
const pressUsdOn = (s: SaleSettings) => s.pressPrice === 'usd' || s.pressPrice === 'usdPaper'
const pressPaperOn = (s: SaleSettings) => s.pressPrice === 'paper' || s.pressPrice === 'usdPaper'

/** configureDrop's checks (plus the field widths), each on the field it's about. Warnings don't block the export. */
export function checkSale(s: SaleSettings, now = Date.now() / 1000): SaleProblem[] {
  const out: SaleProblem[] = []
  const bad = (field: SaleField, message: string) => out.push({ field, message })
  const whole = (field: SaleField, v: number, max: bigint, what: string) => {
    if (!Number.isInteger(v) || v < 0) bad(field, `${what}: a whole number, 0 or more.`)
    else if (BigInt(v) > max) bad(field, `${what}: too big for the contract.`)
  }
  whole('paidPacks', s.paidPacks, U64, 'Paid packs')
  whole('pressPacks', s.pressPacks, U64, 'Press packs')
  whole('plankOnly', s.plankOnly, U64, 'PLANK-only packs')
  whole('walletLimit', s.walletLimit, U64, 'Wallet limit')
  whole('maxPerTx', s.maxPerTx, U32, 'Most per purchase')
  whole('pressPerPress', s.pressPerPress, U32, 'Press packs per press')
  whole('pressPerWallet', s.pressPerWallet, U32, 'Press packs per wallet')
  whole('creditsPerPick', s.creditsPerPick, U16, 'Credits per picked suggestion')
  whole('creditPacksPerWallet', s.creditPacksPerWallet, U64, 'Free packs per wallet')
  if (s.paidPacks + s.pressPacks === 0) bad('paidPacks', 'The drop needs at least one pack.')
  if (s.maxPerTx === 0) bad('maxPerTx', 'At least 1.')

  const price = parseDecimal(s.priceUsd, 8)
  if (price == null || price > U128) bad('priceUsd', 'A dollar amount, up to 8 decimals.')
  else if (price === 0n) bad('priceUsd', 'Set a price above 0.')
  const paper = parseDecimal(s.paperPerPack, 18)
  if (paper == null || paper > U128) bad('paperPerPack', 'A PAPER amount, up to 18 decimals (0 = none).')
  const paperCap = parseDecimal(s.paperCapUsd, 8)
  if (paperCap == null || paperCap > U128) bad('paperCapUsd', 'A dollar amount, up to 8 decimals (0 = no ceiling).')
  const creditPct = parseDecimal(s.creditPacksPercent, 2)
  if (creditPct == null || creditPct > 10_000n) bad('creditPacksPercent', '0 to 100%, up to 2 decimals (0 = no limit).')
  const burn = parseDecimal(s.plankBurnPercent, 2)
  if (burn == null || burn > 10_000n) bad('plankBurnPercent', '0 to 100%, up to 2 decimals.')

  if (s.plankOnly > s.paidPacks) bad('plankOnly', 'More PLANK-only packs than paid packs.')
  if (s.plankOnly > 0 && seconds(s.plankOnlyHours) === 0) bad('plankOnlyHours', 'PLANK-only packs need a time they open to ETH and USDG.')
  if ((s.walletLimit === 0) !== (seconds(s.liftHours) === 0)) {
    bad(s.walletLimit === 0 ? 'walletLimit' : 'liftHours', 'A wallet limit needs a lift time, and the other way round (both 0 = no limit).')
  }
  if (s.pressPacks > 0) {
    if (seconds(s.pressHours) === 0) bad('pressHours', 'Press packs need a claim window.')
    if (s.pressPerPress === 0) bad('pressPerPress', 'At least 1 per press, or set press packs to 0 to turn them off.')
    if (s.pressPerWallet === 0) bad('pressPerWallet', 'At least 1 per wallet.')
    if (pressUsdOn(s)) {
      const v = parseDecimal(s.pressUsd, 8)
      if (v == null || v > U128) bad('pressUsd', 'A dollar amount, up to 8 decimals.')
      else if (v === 0n) bad('pressUsd', 'Set a dollar price, or pick another way to pay.')
    }
    if (pressPaperOn(s)) {
      const v = parseDecimal(s.pressPaper, 18)
      if (v == null || v > U128) bad('pressPaper', 'A PAPER amount, up to 18 decimals.')
      else if (v === 0n) bad('pressPaper', 'Set a PAPER amount, or pick "Free".')
    }
  }
  const hours: [SaleField, number][] = [
    ['pressHours', s.pressHours], ['liftHours', s.liftHours], ['holderHours', s.holderHours],
    ['plankOnlyHours', s.plankOnlyHours], ['regularWalletsHours', s.regularWalletsHours],
  ]
  for (const [f, h] of hours) {
    if (!Number.isFinite(h) || h < 0) bad(f, 'Hours, 0 or more.')
    else if (seconds(h) > MAX_WINDOW_HOURS * 3600) bad(f, `At most ${MAX_WINDOW_HOURS} hours (30 days).`)
  }
  if (s.holderRoot !== '' && !/^0x[0-9a-fA-F]{64}$/.test(s.holderRoot)) bad('holderRoot', '0x and 64 hex characters (ops/snapshot prints it), or empty.')

  if (s.start !== 0 && s.start <= now) out.push({ field: 'start', message: 'The start is in the past: the contract needs a future start.', warning: true })
  if (s.start === 0) out.push({ field: 'start', message: 'No start yet: set it here or with DROP_START when running ConfigureSeries.', warning: true })
  if (seconds(s.holderHours) > 0 && s.holderRoot === '') {
    out.push({ field: 'holderRoot', message: 'No snapshot root: only press holders can buy in the holder window (or set HOLDER_ROOT later).', warning: true })
  }
  return out
}

export const saleErrors = (s: SaleSettings, now?: number) => checkSale(s, now).filter((p) => !p.warning)

/** The "sale" block of recipe.json: FireSale.DropConfig by field name, contract units. Big numbers go as strings. */
export interface SaleJson {
  start: number
  packs: number
  starters: number
  plankOnly: number
  walletLimit: number
  starterWindow: number
  liftAfter: number
  plankBurnBps: number
  priceUsd: string
  paperPerPack: string
  paperCapUsd: string
  holderWindow: number
  holderRoot?: string
  maxPerTx: number
  plankOnlyFor: number
  regularWalletsFor: number
  starterPerPress: number
  starterWalletLimit: number
  starterPriceUsd: string
  starterPaper: string
  creditsPerPick: number
  creditPacksMax: number
  creditPacksPerWallet: number
}

export function saleJson(s: SaleSettings): SaleJson {
  const d = (t: string, places: number) => String(parseDecimal(t, places) ?? 0n)
  const on = s.pressPacks > 0
  return {
    start: s.start,
    packs: s.paidPacks,
    starters: s.pressPacks,
    plankOnly: s.plankOnly,
    walletLimit: s.walletLimit,
    starterWindow: on ? seconds(s.pressHours) : 0,
    liftAfter: seconds(s.liftHours),
    plankBurnBps: Number(parseDecimal(s.plankBurnPercent, 2) ?? 0n),
    priceUsd: d(s.priceUsd, 8),
    paperPerPack: d(s.paperPerPack, 18),
    paperCapUsd: d(s.paperCapUsd, 8),
    holderWindow: seconds(s.holderHours),
    ...(s.holderRoot ? { holderRoot: s.holderRoot.toLowerCase() } : {}),
    maxPerTx: s.maxPerTx,
    plankOnlyFor: seconds(s.plankOnlyHours),
    regularWalletsFor: seconds(s.regularWalletsHours),
    starterPerPress: on ? s.pressPerPress : 0,
    starterWalletLimit: on ? s.pressPerWallet : 0,
    starterPriceUsd: on && pressUsdOn(s) ? d(s.pressUsd, 8) : '0',
    starterPaper: on && pressPaperOn(s) ? d(s.pressPaper, 18) : '0',
    creditsPerPick: s.creditsPerPick,
    creditPacksMax: creditPacksMax(s),
    creditPacksPerWallet: s.creditPacksPerWallet,
  }
}

/** The drop as a picture: how its packs split, and what a sell-out brings in. Free (credit) packs come out of the
 *  paid packs (FireSale.creditPacks takes them from what's left to sell), so they are at most the paid packs. */
export interface DropPlan {
  total: number
  paid: number
  press: number
  /** The first paid packs only PLANK can buy. */
  plankOnly: number
  /** Most paid packs that can go free to credits (0 = no cap: up to every paid pack). */
  freeMax: number
  freeCapped: boolean
  /** Dollars if every pack sells: paid at the price, press at their dollar price. */
  revenueUsd: number
  /** The same with every free pack used (the least a sell-out brings in, with the cap). */
  revenueMinUsd: number
  /** The PLANK burn share of those dollars. */
  burnUsd: number
  burnMinUsd: number
}

export function dropPlan(s: SaleSettings): DropPlan {
  const ok = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
  const paid = ok(s.paidPacks)
  const press = ok(s.pressPacks)
  const capped = creditPacksMax(s) > 0
  const freeMax = capped ? Math.min(paid, creditPacksMax(s)) : paid
  const price = Number(parseDecimal(s.priceUsd, 8) ?? 0n) / 1e8
  const pressUsd = pressUsdOn(s) ? Number(parseDecimal(s.pressUsd, 8) ?? 0n) / 1e8 : 0
  const burn = Number(parseDecimal(s.plankBurnPercent, 2) ?? 0n) / 10_000
  const revenueUsd = paid * price + press * pressUsd
  const revenueMinUsd = (paid - freeMax) * price + press * pressUsd
  return {
    total: paid + press, paid, press, plankOnly: Math.min(ok(s.plankOnly), paid), freeMax, freeCapped: capped,
    revenueUsd, revenueMinUsd, burnUsd: revenueUsd * burn, burnMinUsd: revenueMinUsd * burn,
  }
}
