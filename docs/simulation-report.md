# The Fire — full economy simulation

*Sep 28 2026. Model: `sim/economy.py` (`python3 sim/economy.py`, ~30 s; `--paper` for the PAPER table). Rules match `contracts/src/Fire.sol`.*

**Runs:** 324 year-long runs: mills ∈ {1k, 2.5k, 5k, 10k} × participation ∈ {low, medium, high} × outsiders ∈ {0, 5, 25}/day × mill floor ∈ {$100, $300, $786} × 3 seeds.

**Inputs held flat:** PLANK $1.056e-9 (Uniswap V2 pair ~28.1 WETH / 88.7T PLANK at $3,333/ETH, Sep 27 2026), supply 888.42T, 88.84B PLANK inside a mill (~$94). ETH $3,333. PAPER $0.25 (reporting only). Ticket = PAPER leg + $0.90 of PLANK, or $1 of ETH/USDG + $0.90 of PLANK. Mill bid starts at 85% of the floor.

**Contract rules modeled:** 10 paid per buy, buy 10 get 1 free, 500 tickets *received* per wallet per day (the free ones count). Storm = 7-night average (today excluded) × age table × 32-point luck table (lognormal σ 1.5), in thousandths of a ticket like the contract. A fire nobody bought into carries its whole pot. Fire keeps 60% overnight. Pot split 40/25/5/30. Mill bid +25% of its start per day, capped at 3× and at the fund, restarts at 90% of the price paid; the keeper sweeps hourly; each mill also costs the 0.0003 ETH burn fee.

**Participation** = share of each day's fresh PAPER a wallet spends on tickets (whale/mid/small): low 25/18/10%, medium 50/40/30%, high 75/65/55%, plus a 10%/day trickle of stockpiles and rallies when the fire looks threatened.

## 1. Participation is the whole game (1,000 mills, 5 outsiders/day, $300 floor)

| Participation | Tickets/day | PAPER burned | PAPER sold | Stockpile (days of emission) | Fire life (min–max) | Pot median / max | PLANK burned/yr | Wins whale/mid/small/outsider |
|---|---|---|---|---|---|---|---|---|
| low | 452 | 41% | 56% | 11.2 | 7.6 (3–13) | $1,914 / $4,777 | $95,601 | 13/19/11/4 |
| med | 749 | 70% | 28% | 8.7 | 7.6 (3–14) | $2,991 / $7,383 | $159,115 | 14/12/18/3 |
| high | 949 | 90% | 9% | 5.8 | 7.5 (3–15) | $4,130 / $8,612 | $202,115 | 10/16/21/2 |

## 2. Scale: more mills (medium participation, 5 outsiders/day, $300 floor)

| Mills | Wallets | Tickets/day | Pot median / max | PLANK burned/yr | % of PLANK supply/yr | PLANK sitting in pot | Fire life |
|---|---|---|---|---|---|---|---|
| 1,000 | 230 | 749 | $2,991 / $7,383 | $159,115 | 17% | $1,701 | 7.6 |
| 2,500 | 581 | 1,841 | $7,778 / $18,124 | $391,101 | 42% | $6,722 | 7.6 |
| 5,000 | 1132 | 3,694 | $14,714 / $37,629 | $783,113 | 83% | $11,097 | 7.2 |
| 10,000 | 2215 | 7,448 | $32,162 / $69,140 | $1,578,334 | 168% | $19,836 | 7.7 |

## 3. The mill fund: how fast the fire eats mills (medium participation, 1,000 mills)

| Outsiders/day | ETH+USDG in/yr | Mill floor | Mills eaten/yr | Days per mill | Emission drop | Royalty $/mill/yr | Outsider share of tickets |
|---|---|---|---|---|---|---|---|
| 0 | $0 | $100 | 0 | — | 0% | $7.99 | 0% |
| 0 | $0 | $300 | 0 | — | 0% | $7.99 | 0% |
| 0 | $0 | $786 | 0 | — | 0% | $7.99 | 0% |
| 5 | $11,425 | $100 | 113 | 3.2 | 11% | $20.86 | 5% |
| 5 | $11,258 | $300 | 37 | 9.9 | 4% | $12.21 | 4% |
| 5 | $11,362 | $786 | 14 | 26.1 | 1% | $9.76 | 4% |
| 25 | $56,078 | $100 | 554 | 0.7 | 53% | $127.52 | 23% |
| 25 | $56,317 | $300 | 186 | 2.0 | 19% | $32.88 | 20% |
| 25 | $55,889 | $786 | 71 | 5.2 | 7% | $17.28 | 19% |

Royalty $/mill/yr = the pot's 5% plus the PLANK inside every eaten mill, split across the mills still standing. It counts only once the Plank Press admin whitelists PLANK in the pool.

## 4. Fairness: return per dollar by tier (all scenarios averaged)

Whales get back 23% of what they spend, mids 24%, small holders 20%. The only discount is the free 11th ticket on a full buy of 10 (~9%), and the 500/day cap rarely binds, so the raffle stays close to proportional. It's a burn game: ~24¢ back per dollar in expectation; the rest is burned PAPER/PLANK, the 5% royalty and the 30% that relights the next fire.

## 5. Fire lifetimes across everything

Across all 324 runs: 48 fires a year; average fire lives 6.6–8.8 nights (mean 7.6); 6% of fires die by night 3; 25% reach night 10; 1.8% reach night 15; longest fire seen: 19 nights. Night 24 is never reached. The storm scales to the community's own volume, so this barely moves with mills or participation — which is the point.

## 6. Daily cap

Wallets that wanted more than the 500/day cap allows: 0.00 per day on average, max 0.01 in any scenario. The cap is almost never binding; it exists for the one whale who tries to buy the fire in an evening.
