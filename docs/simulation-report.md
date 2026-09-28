# The Fire — full economy simulation

*Sep 28 2026. Model: `sim/economy.py` (`python3 sim/economy.py`, ~30 s; `--paper` for the PAPER table). Rules match `contracts/src/Fire.sol`.*

**Runs:** 324 year-long runs: mills ∈ {1k, 2.5k, 5k, 10k} × participation ∈ {low, medium, high} × outsiders ∈ {0, 5, 25}/day × mill floor ∈ {$100, $300, $786} × 3 seeds.

**Inputs held flat:** PLANK $1.056e-9 (Uniswap V2 pair ~28.1 WETH / 88.7T PLANK at $3,333/ETH, Sep 27 2026), supply 888.42T, 88.84B PLANK inside a mill (~$94). ETH $3,333. PAPER $0.25 (reporting only). Ticket = PAPER leg + $0.90 of PLANK, or $1 of ETH/USDG + $0.90 of PLANK. Mill bid starts at 85% of the floor.

**Contract rules modeled:** 10 paid per buy, buy 10 get 1 free, 500 tickets *received* per wallet per day (the free ones count). Storm = floor(7-night average, today excluded × age table × 32-point luck table), the contract's integer tables. Fire keeps 60% overnight. Pot split 40/25/5/30. Mill bid +25% of its start per day, capped at 3× and at the fund, restarts at 90% of the price paid; the keeper sweeps hourly; each mill also costs the 0.0003 ETH burn fee.

**Participation** = share of each day's fresh PAPER a wallet spends on tickets (whale/mid/small): low 25/18/10%, medium 50/40/30%, high 75/65/55%, plus a 10%/day trickle of stockpiles and rallies when the fire looks threatened.

## 1. Participation is the whole game (1,000 mills, 5 outsiders/day, $300 floor)

| Participation | Tickets/day | PAPER burned | PAPER sold | Stockpile (days of emission) | Fire life (min–max) | Pot median / max | PLANK burned/yr | Wins whale/mid/small/outsider |
|---|---|---|---|---|---|---|---|---|
| low | 549 | 50% | 47% | 9.0 | 10.0 (3–17) | $3,347 / $6,425 | $116,402 | 9/12/13/2 |
| med | 788 | 74% | 24% | 7.6 | 9.6 (5–14) | $4,665 / $7,266 | $166,778 | 8/12/16/1 |
| high | 962 | 91% | 8% | 5.7 | 9.5 (5–14) | $5,508 / $8,582 | $204,980 | 7/11/19/1 |

## 2. Scale: more mills (medium participation, 5 outsiders/day, $300 floor)

| Mills | Wallets | Tickets/day | Pot median / max | PLANK burned/yr | % of PLANK supply/yr | PLANK sitting in pot | Fire life |
|---|---|---|---|---|---|---|---|
| 1,000 | 230 | 788 | $4,665 / $7,266 | $166,778 | 18% | $3,905 | 9.6 |
| 2,500 | 581 | 1,932 | $11,265 / $19,812 | $411,460 | 44% | $4,239 | 9.7 |
| 5,000 | 1132 | 3,931 | $21,899 / $39,786 | $827,925 | 88% | $27,939 | 9.5 |
| 10,000 | 2215 | 7,817 | $42,906 / $76,971 | $1,657,414 | 177% | $22,027 | 9.5 |

## 3. The mill fund: how fast the fire eats mills (medium participation, 1,000 mills)

| Outsiders/day | ETH+USDG in/yr | Mill floor | Mills eaten/yr | Days per mill | Emission drop | Royalty $/mill/yr | Outsider share of tickets |
|---|---|---|---|---|---|---|---|
| 0 | $0 | $100 | 0 | — | 0% | $8.17 | 0% |
| 0 | $0 | $300 | 0 | — | 0% | $8.17 | 0% |
| 0 | $0 | $786 | 0 | — | 0% | $8.17 | 0% |
| 5 | $11,315 | $100 | 112 | 3.3 | 11% | $21.17 | 4% |
| 5 | $11,133 | $300 | 37 | 10.0 | 4% | $12.47 | 4% |
| 5 | $11,147 | $786 | 13 | 27.4 | 1% | $10.07 | 4% |
| 25 | $55,447 | $100 | 548 | 0.7 | 53% | $126.57 | 22% |
| 25 | $56,341 | $300 | 187 | 2.0 | 19% | $33.40 | 19% |
| 25 | $56,356 | $786 | 71 | 5.1 | 7% | $17.82 | 18% |

Royalty $/mill/yr = the pot's 5% plus the PLANK inside every eaten mill, split across the mills still standing. It counts only once the Plank Press admin whitelists PLANK in the pool.

## 4. Fairness: return per dollar by tier (all scenarios averaged)

Whales get back 23% of what they spend, mids 22%, small holders 21%. The only discount is the free 11th ticket on a full buy of 10 (~9%), and the 500/day cap rarely binds, so the raffle stays close to proportional. It's a burn game: ~22¢ back per dollar in expectation; the rest is burned PAPER/PLANK, the 5% royalty and the 30% that relights the next fire.

## 5. Fire lifetimes across everything

Across all 324 runs: 37 fires a year; average fire lives 8.5–10.9 nights (mean 9.6); 1% of fires die by night 3; 52% reach night 10; 4.8% reach night 15; longest fire seen: 19 nights. Night 24 is never reached. The storm scales to the community's own volume, so this barely moves with mills or participation — which is the point.

## 6. Daily cap

Wallets that wanted more than the 500/day cap allows: 0.00 per day on average, max 0.01 in any scenario. The cap is almost never binding; it exists for the one whale who tries to buy the fire in an evening.
