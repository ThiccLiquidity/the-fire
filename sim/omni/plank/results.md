# Omni card packs: PLANK, presses, liquidity (Oct 3 2026)

*Historical: an early study. The design that was built is in `docs/omni-economy.md` (30% of each sale burns PLANK,
with `PlankBurner` as the fallback; the contracts are owned by one hardware wallet).*

Model: `model.py` (run `python3 model.py`). Prices held flat: PLANK $1.056e-9 (888.42T supply, ~$940k cap), ETH $3,333,
V2 pool 28.1 WETH / 88.7T PLANK, 1,000 presses printing 1 PAPER/day, ~$94 of PLANK per press, 0.3% swap fee.
Base case: 250 packs x $2 x 2 drops/month = **$12,000/yr**. "Year buy impact" adds up a whole year of buys into the
pool with nobody selling, so it's the most it could be.

## Recommendation
- **PLANK:** a "log" worth **10% of the pack price** in every paid pack ($0.10 on a $1 pack), **included in the price,
  not added on top**. The sale contract swaps it from the ETH paid, through the V2 pool, and burns the PLANK in the same
  transaction. No extra step and no extra approval. PLANK payers just burn that part of their own PLANK. Keep the
  ~$10 PLANK-holder allowlist for the 1-PAPER starter packs.
  - Base case: $1,200/yr burned, 0.13% of supply, up to +2.6% on the PLANK price. At $36k/yr: $3,600, 0.38%, up to +7.8%.
  - Each $0.20 buy moves the price ~0.0004%, so it's invisible and too small to be worth front-running. Gas on Robinhood Chain: under 2 cents.
- **Idea A (presses):** 25% of revenue. Base case: $3,000/yr, 6 presses burned at a $500 floor (10 at $300). PAPER
  printing drops 0.6% (6 a day, for good). $560 of PLANK goes to PulpPool, which is $0.57 per press per year. Sending
  the same $3,000 straight to PulpPool pays $3.00 per press.
- **Idea B (liquidity):** 50% of revenue in year one. Base case: $6,000/yr. Half buys PAPER and half is paired with
  it, and the LP tokens are burned. With $1,000 a side today, the pool reaches ~$4,000 a side. A $100 PAPER trade then
  costs 2.7% instead of 9.3%, and the LP adds $3,000 of PAPER buying.
- **More value per dollar: B, while the PAPER pool is thin** (under about $5k a side). Every dollar goes into PAPER
  for good, and press holders, who sell 365k PAPER a year, keep 5-7% more on every sale. Under A, about $0.19 of each
  dollar ends up with the presses still running, and that comes from PLANK already locked in the burned press. The
  rest goes to the one seller. Once the pool is thick, switch the share to A.

## Risks
- **Contract holds funds (A):** the existing press fund *is* ETH/USDG sitting in `Fire.sol` until a listing comes in
  at or under its bid. The sale contract can forward the money in the same transaction, but the money then waits in
  Fire. Floors of $300-800 sit far above the ~$94 inside a press, so it could wait a long time. The other way: forward
  to the owner's wallet and buy and burn by hand, which relies on the owner.
- **B:** doing the LP add inside every sale is fiddly. It leaves leftover dust and can be front-run on a thin pool.
  Simpler: forward B% to the owner's wallet, which adds the LP and burns the LP tokens once a month. Burned LP can never
  come back.
- **PLANK swap:** needs a minimum-out based on the 30-minute TWAP. If PLANK spikes, sales revert until the TWAP
  catches up.
- PulpPool counts only whitelisted tokens. ETH is wrapped to WETH (counted); USDG probably isn't counted.
- Pay-in-PLANK at a discount costs 2 extra steps (buy PLANK, approve), gives away revenue, and nobody can predict how
  many buyers would use it.
- Revenue could be $0. All numbers scale in a straight line with revenue.

## Full tables

## 1. PLANK in the mint (per year)

### (i) PLANK log $0.10/pack, swapped from the ETH paid and burned in the same tx
| packs/drop | drops/mo | packs/yr | $ in PLANK/yr | % supply/yr @0.5x | @1x | @3x | yr buy impact @0.5x | @1x | @3x |
|---|---|---|---|---|---|---|---|---|---|
| 167 | 1 | 2,004 | $200 | 0.04% | 0.02% | 0.007% | +0.6% | +0.4% | +0.2% |
| 167 | 2 | 4,008 | $401 | 0.09% | 0.04% | 0.014% | +1.2% | +0.9% | +0.5% |
| 167 | 3 | 6,012 | $601 | 0.13% | 0.06% | 0.021% | +1.8% | +1.3% | +0.7% |
| 167 | 4 | 8,016 | $802 | 0.17% | 0.09% | 0.028% | +2.4% | +1.7% | +1.0% |
| 250 | 1 | 3,000 | $300 | 0.06% | 0.03% | 0.011% | +0.9% | +0.6% | +0.4% |
| 250 | 2 | 6,000 | $600 | 0.13% | 0.06% | 0.021% | +1.8% | +1.3% | +0.7% |
| 250 | 3 | 9,000 | $900 | 0.19% | 0.10% | 0.032% | +2.7% | +1.9% | +1.1% |
| 250 | 4 | 12,000 | $1,200 | 0.26% | 0.13% | 0.043% | +3.6% | +2.6% | +1.5% |
| 500 | 1 | 6,000 | $600 | 0.13% | 0.06% | 0.021% | +1.8% | +1.3% | +0.7% |
| 500 | 2 | 12,000 | $1,200 | 0.26% | 0.13% | 0.043% | +3.6% | +2.6% | +1.5% |
| 500 | 3 | 18,000 | $1,800 | 0.38% | 0.19% | 0.064% | +5.5% | +3.9% | +2.2% |
| 500 | 4 | 24,000 | $2,400 | 0.51% | 0.26% | 0.085% | +7.4% | +5.2% | +3.0% |

### (i') PLANK log $0.25/pack
| packs/drop | drops/mo | packs/yr | $ in PLANK/yr | % supply/yr @0.5x | @1x | @3x | yr buy impact @0.5x | @1x | @3x |
|---|---|---|---|---|---|---|---|---|---|
| 167 | 1 | 2,004 | $501 | 0.11% | 0.05% | 0.018% | +1.5% | +1.1% | +0.6% |
| 167 | 2 | 4,008 | $1,002 | 0.21% | 0.11% | 0.036% | +3.0% | +2.1% | +1.2% |
| 167 | 3 | 6,012 | $1,503 | 0.32% | 0.16% | 0.053% | +4.6% | +3.2% | +1.9% |
| 167 | 4 | 8,016 | $2,004 | 0.43% | 0.21% | 0.071% | +6.1% | +4.3% | +2.5% |
| 250 | 1 | 3,000 | $750 | 0.16% | 0.08% | 0.027% | +2.3% | +1.6% | +0.9% |
| 250 | 2 | 6,000 | $1,500 | 0.32% | 0.16% | 0.053% | +4.6% | +3.2% | +1.9% |
| 250 | 3 | 9,000 | $2,250 | 0.48% | 0.24% | 0.080% | +6.9% | +4.8% | +2.8% |
| 250 | 4 | 12,000 | $3,000 | 0.64% | 0.32% | 0.107% | +9.2% | +6.5% | +3.7% |
| 500 | 1 | 6,000 | $1,500 | 0.32% | 0.16% | 0.053% | +4.6% | +3.2% | +1.9% |
| 500 | 2 | 12,000 | $3,000 | 0.64% | 0.32% | 0.107% | +9.2% | +6.5% | +3.7% |
| 500 | 3 | 18,000 | $4,500 | 0.96% | 0.48% | 0.160% | +14.0% | +9.8% | +5.6% |
| 500 | 4 | 24,000 | $6,000 | 1.28% | 0.64% | 0.213% | +18.9% | +13.2% | +7.5% |

### (ii) Pay in PLANK at 10% off a $2 pack, all burned (assume 20% of buyers use it -> $0.36/pack avg)
| packs/drop | drops/mo | packs/yr | $ in PLANK/yr | % supply/yr @0.5x | @1x | @3x | yr buy impact @0.5x | @1x | @3x |
|---|---|---|---|---|---|---|---|---|---|
| 167 | 1 | 2,004 | $721 | 0.15% | 0.08% | 0.026% | +2.2% | +1.5% | +0.9% |
| 167 | 2 | 4,008 | $1,443 | 0.31% | 0.15% | 0.051% | +4.4% | +3.1% | +1.8% |
| 167 | 3 | 6,012 | $2,164 | 0.46% | 0.23% | 0.077% | +6.6% | +4.7% | +2.7% |
| 167 | 4 | 8,016 | $2,886 | 0.62% | 0.31% | 0.103% | +8.9% | +6.2% | +3.6% |
| 250 | 1 | 3,000 | $1,080 | 0.23% | 0.12% | 0.038% | +3.3% | +2.3% | +1.3% |
| 250 | 2 | 6,000 | $2,160 | 0.46% | 0.23% | 0.077% | +6.6% | +4.7% | +2.7% |
| 250 | 3 | 9,000 | $3,240 | 0.69% | 0.35% | 0.115% | +10.0% | +7.0% | +4.0% |
| 250 | 4 | 12,000 | $4,320 | 0.92% | 0.46% | 0.153% | +13.4% | +9.4% | +5.4% |
| 500 | 1 | 6,000 | $2,160 | 0.46% | 0.23% | 0.077% | +6.6% | +4.7% | +2.7% |
| 500 | 2 | 12,000 | $4,320 | 0.92% | 0.46% | 0.153% | +13.4% | +9.4% | +5.4% |
| 500 | 3 | 18,000 | $6,480 | 1.38% | 0.69% | 0.230% | +20.5% | +14.3% | +8.1% |
| 500 | 4 | 24,000 | $8,640 | 1.84% | 0.92% | 0.307% | +27.7% | +19.2% | +10.9% |

### (iv) $0.10/pack of PLANK sent to PulpPool instead of burned (same buy, no burn)
| packs/drop | drops/mo | packs/yr | $ in PLANK/yr | % supply/yr @0.5x | @1x | @3x | yr buy impact @0.5x | @1x | @3x |
|---|---|---|---|---|---|---|---|---|---|
| 167 | 1 | 2,004 | $200 | 0.00% | 0.00% | 0.000% | +0.6% | +0.4% | +0.2% |
| 167 | 2 | 4,008 | $401 | 0.00% | 0.00% | 0.000% | +1.2% | +0.9% | +0.5% |
| 167 | 3 | 6,012 | $601 | 0.00% | 0.00% | 0.000% | +1.8% | +1.3% | +0.7% |
| 167 | 4 | 8,016 | $802 | 0.00% | 0.00% | 0.000% | +2.4% | +1.7% | +1.0% |
| 250 | 1 | 3,000 | $300 | 0.00% | 0.00% | 0.000% | +0.9% | +0.6% | +0.4% |
| 250 | 2 | 6,000 | $600 | 0.00% | 0.00% | 0.000% | +1.8% | +1.3% | +0.7% |
| 250 | 3 | 9,000 | $900 | 0.00% | 0.00% | 0.000% | +2.7% | +1.9% | +1.1% |
| 250 | 4 | 12,000 | $1,200 | 0.00% | 0.00% | 0.000% | +3.6% | +2.6% | +1.5% |
| 500 | 1 | 6,000 | $600 | 0.00% | 0.00% | 0.000% | +1.8% | +1.3% | +0.7% |
| 500 | 2 | 12,000 | $1,200 | 0.00% | 0.00% | 0.000% | +3.6% | +2.6% | +1.5% |
| 500 | 3 | 18,000 | $1,800 | 0.00% | 0.00% | 0.000% | +5.5% | +3.9% | +2.2% |
| 500 | 4 | 24,000 | $2,400 | 0.00% | 0.00% | 0.000% | +7.4% | +5.2% | +3.0% |

Per-pack price impact of a single $0.10 log buy at 1x: 0.00021% (invisible); a $0.25 log: 0.00053%
(iii) Allowlist only: no burn. One-off buying if N newcomers buy $10 to qualify: N=100: $1,000 -> +2.1% (and they can sell after the snapshot), N=300: $3,000 -> +6.5% (and they can sell after the snapshot), N=1000: $10,000 -> +22.4% (and they can sell after the snapshot)
Extra gas for the in-tx swap+burn (~110k gas) at 0.01 gwei: $0.0037
Extra gas for the in-tx swap+burn (~110k gas) at 0.05 gwei: $0.0183
Extra gas for the in-tx swap+burn (~110k gas) at 0.5 gwei: $0.1833

## 4. Revenue sensitivity ($/yr), 250-pack drops
| drops/mo | $1/pack | $1.5/pack | $2/pack | $3/pack |
|---|---|---|---|---|
| 0 | $0 | $0 | $0 | $0 |
| 1 | $3,000 | $4,500 | $6,000 | $9,000 |
| 2 | $6,000 | $9,000 | $12,000 | $18,000 |
| 3 | $9,000 | $13,500 | $18,000 | $27,000 |
| 4 | $12,000 | $18,000 | $24,000 | $36,000 |

Base case: 250 packs x $2 x 2 drops/mo = $12,000/yr

## 2. Idea A: X% of revenue -> press fund (buy floor press, burn, PLANK to PulpPool)
| revenue/yr | X% | press floor | presses burned/yr | emission cut | PLANK to PulpPool | royalty $/press/yr (press fund) | royalty $/press/yr (same $ straight to PulpPool) |
|---|---|---|---|---|---|---|---|
| $3,000 | 25% | $300 | 2.5 | -0.2% (2 PAPER/day) | $234 | $0.23 | $0.75 |
| $3,000 | 25% | $500 | 1.5 | -0.1% (1 PAPER/day) | $141 | $0.14 | $0.75 |
| $3,000 | 25% | $800 | 0.9 | -0.1% (1 PAPER/day) | $88 | $0.09 | $0.75 |
| $3,000 | 50% | $300 | 5.0 | -0.5% (5 PAPER/day) | $468 | $0.47 | $1.50 |
| $3,000 | 50% | $500 | 3.0 | -0.3% (3 PAPER/day) | $281 | $0.28 | $1.50 |
| $3,000 | 50% | $800 | 1.9 | -0.2% (2 PAPER/day) | $176 | $0.18 | $1.50 |
| $12,000 | 25% | $300 | 10.0 | -1.0% (10 PAPER/day) | $937 | $0.95 | $3.00 |
| $12,000 | 25% | $500 | 6.0 | -0.6% (6 PAPER/day) | $563 | $0.57 | $3.00 |
| $12,000 | 25% | $800 | 3.7 | -0.4% (4 PAPER/day) | $352 | $0.35 | $3.00 |
| $12,000 | 50% | $300 | 19.9 | -2.0% (20 PAPER/day) | $1,874 | $1.91 | $6.00 |
| $12,000 | 50% | $500 | 12.0 | -1.2% (12 PAPER/day) | $1,126 | $1.14 | $6.00 |
| $12,000 | 50% | $800 | 7.5 | -0.7% (7 PAPER/day) | $704 | $0.71 | $6.00 |
| $36,000 | 25% | $300 | 29.9 | -3.0% (30 PAPER/day) | $2,811 | $2.90 | $9.00 |
| $36,000 | 25% | $500 | 18.0 | -1.8% (18 PAPER/day) | $1,689 | $1.72 | $9.00 |
| $36,000 | 25% | $800 | 11.2 | -1.1% (11 PAPER/day) | $1,056 | $1.07 | $9.00 |
| $36,000 | 50% | $300 | 59.8 | -6.0% (60 PAPER/day) | $5,621 | $5.98 | $18.00 |
| $36,000 | 50% | $500 | 35.9 | -3.6% (36 PAPER/day) | $3,377 | $3.50 | $18.00 |
| $36,000 | 50% | $800 | 22.5 | -2.2% (22 PAPER/day) | $2,112 | $2.16 | $18.00 |

## 3. Idea B: X% of revenue -> PAPER/ETH LP (half buys PAPER, half paired; LP tokens burned)
| PAPER LP now ($ per side) | revenue/yr | X% | LP added/yr (both sides) | depth after 12 mo ($/side) | $100 trade cost now | after 12 mo | PAPER bought by the zap |
|---|---|---|---|---|---|---|---|
| $500 | $3,000 | 25% | $750 | $875 | 16.9% | 10.5% | $375 |
| $500 | $3,000 | 50% | $1,500 | $1,250 | 16.9% | 7.7% | $750 |
| $500 | $12,000 | 25% | $3,000 | $2,000 | 16.9% | 5.0% | $1,500 |
| $500 | $12,000 | 50% | $6,000 | $3,500 | 16.9% | 3.1% | $3,000 |
| $500 | $36,000 | 25% | $9,000 | $5,000 | 16.9% | 2.2% | $4,500 |
| $500 | $36,000 | 50% | $18,000 | $9,500 | 16.9% | 1.3% | $9,000 |
| $1,000 | $3,000 | 25% | $750 | $1,375 | 9.3% | 7.0% | $375 |
| $1,000 | $3,000 | 50% | $1,500 | $1,750 | 9.3% | 5.7% | $750 |
| $1,000 | $12,000 | 25% | $3,000 | $2,500 | 9.3% | 4.1% | $1,500 |
| $1,000 | $12,000 | 50% | $6,000 | $4,000 | 9.3% | 2.7% | $3,000 |
| $1,000 | $36,000 | 25% | $9,000 | $5,500 | 9.3% | 2.1% | $4,500 |
| $1,000 | $36,000 | 50% | $18,000 | $10,000 | 9.3% | 1.3% | $9,000 |
| $2,500 | $3,000 | 25% | $750 | $2,875 | 4.1% | 3.6% | $375 |
| $2,500 | $3,000 | 50% | $1,500 | $3,250 | 4.1% | 3.3% | $750 |
| $2,500 | $12,000 | 25% | $3,000 | $4,000 | 4.1% | 2.7% | $1,500 |
| $2,500 | $12,000 | 50% | $6,000 | $5,500 | 4.1% | 2.1% | $3,000 |
| $2,500 | $36,000 | 25% | $9,000 | $7,000 | 4.1% | 1.7% | $4,500 |
| $2,500 | $36,000 | 50% | $18,000 | $11,500 | 4.1% | 1.2% | $9,000 |

Do nothing: depth stays put (or thins as presses sell 365k PAPER/yr into it); $100 trade cost unchanged.
PAPER printed per year: 365000 PAPER; at $0.01 = $3650, at $0.25 = $91250 of sell supply.
