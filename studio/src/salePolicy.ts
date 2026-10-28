/** The ops sale policy (ops/series/sale-policy.mjs), as warnings in the Sale tab: launch.mjs and VerifySeries mark a
 *  drop outside these bounds RED (unless the owner runs them with --allow <rule>). The contract takes it; the policy
 *  is the owner's own guard rail. The numbers come from the one file both read (ops/series/sale-policy-bounds.json).
 *  The policy's hard rules (free open packs, no root, a limit lift with nothing to lift) are checkSale errors already. */

import BOUNDS from '../../ops/series/sale-policy-bounds.json'
import { saleJson, type SaleProblem, type SaleSettings } from './sale'

const B = {
  priceUsdMin: BigInt(BOUNDS.priceUsdMin),
  priceUsdMax: BigInt(BOUNDS.priceUsdMax),
  burnTotalBpsMin: BOUNDS.burnTotalBpsMin,
  burnTotalBpsMax: BOUNDS.burnTotalBpsMax,
  paperPerPackMin: BigInt(BOUNDS.paperPerPackMin),
  paperCapUsdMin: BigInt(BOUNDS.paperCapUsdMin),
  perWalletMax: BOUNDS.perWalletMax,
  limitForMin: BOUNDS.limitForMin,
  limitForMax: BOUNDS.limitForMax,
  taxBpsMax: BOUNDS.taxBpsMax,
  idleMax: BOUNDS.idleMax,
}

/** The bounds in the owner's units, for the messages. */
export const POLICY = {
  priceMin: Number(B.priceUsdMin) / 1e8,
  priceMax: Number(B.priceUsdMax) / 1e8,
  burnMin: B.burnTotalBpsMin / 100,
  burnMax: B.burnTotalBpsMax / 100,
  paperMin: Number(B.paperPerPackMin) / 1e18,
  paperCapMin: Number(B.paperCapUsdMin) / 1e8,
  perWalletMax: B.perWalletMax,
  limitMinHours: B.limitForMin / 3600,
  limitMaxDays: B.limitForMax / 86_400,
  taxMax: B.taxBpsMax / 100,
  idleMaxMinutes: B.idleMax / 60,
}

const hrs = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s <= 2 * 86_400 ? `${Math.round((s / 3600) * 100) / 100}h` : `${Math.round((s / 86_400) * 100) / 100} days`)

/** One rule outside the policy: `policy` is the ops rule's name (for --allow); `red` when launch.mjs stops on it (else
 *  it only warns there too). */
export type PolicyProblem = SaleProblem & { policy: string; red: boolean }

/** The policy over the drop as it exports: a warning on each field outside it. */
export function salePolicy(s: SaleSettings): PolicyProblem[] {
  const j = saleJson(s)
  const out: PolicyProblem[] = []
  const warn = (policy: string, field: SaleProblem['field'], message: string, group?: number, red = true) =>
    out.push({ policy, red, field, message: `Policy: ${message}`, warning: true, ...(group !== undefined ? { group } : {}) })

  const cap = BigInt(j.paperCapUsd)
  if (cap === 0n) warn('paper-cap', 'paperCapUsd', 'no PAPER ceiling (0).', undefined, false)
  else if (cap < B.paperCapUsdMin) warn('paper-cap', 'paperCapUsd', `a PAPER ceiling of at least $${POLICY.paperCapMin.toFixed(2)}.`)

  j.groups.forEach((g, i) => {
    const sg = s.groups[i]
    const holders = g.gate === 'nft' || g.gate === 'snapshot'
    const price = BigInt(g.priceUsd)
    // each group's own liquidity share (a group with no dollar price has nothing to split; over 100% is a checkSale
    // error). Only the sum matters: both parts go to LiquidityBurner, which decides what to buy.
    const burn = g.plankBurnBps + g.paperBurnBps
    if (price !== 0n && burn <= 10_000) {
      if (burn < B.burnTotalBpsMin || burn > B.burnTotalBpsMax) {
        warn('burn-total', 'plankBurnPercent', `the liquidity share is ${burn / 100}%: keep it ${POLICY.burnMin}% to ${POLICY.burnMax}%.`, i)
      }
    }
    if (price === 0n) {
      if (!holders) warn('price', 'priceUsd', 'no dollar price is only for a holders\' group (NFT or snapshot).', i)
    } else if (price < B.priceUsdMin || price > B.priceUsdMax) warn('price', 'priceUsd', `a price of $${POLICY.priceMin} to $${POLICY.priceMax} a pack.`, i)
    const paper = BigInt(g.paper)
    if (paper === 0n) warn('no-paper', 'paper', 'no PAPER per pack.', i)
    else if (paper < B.paperPerPackMin) warn('paper-per-pack', 'paper', `at least ${POLICY.paperMin} PAPER a pack.`, i)
    if (g.perWallet === 0) {
      if (!g.unlimited && !holders) warn('wallet-limit', 'perWallet', 'no wallet limit on a group open to everyone.', i, false)
    } else if (g.perWallet > B.perWalletMax) warn('wallet-limit', 'perWallet', `at most ${POLICY.perWalletMax} per wallet.`, i)
    if (g.limitFor !== undefined && g.perWallet > 0 && (g.limitFor < B.limitForMin || g.limitFor > B.limitForMax)) {
      warn('limit-lifts', 'limitHours', `lifts ${hrs(g.limitFor)} in: keep it ${POLICY.limitMinHours}h to ${POLICY.limitMaxDays} days.`, i)
    }
    if (g.taxBps !== undefined && g.taxBps > B.taxBpsMax) warn('tax', 'taxPercent', `a rise of at most ${POLICY.taxMax}% a pack.`, i, false)
    if (sg.unlimited && g.idle !== undefined && g.idle > B.idleMax) warn('idle', 'idleMinutes', `an unlimited group ends within ${POLICY.idleMaxMinutes} min of its last sale.`, i, false)
  })
  return out
}
