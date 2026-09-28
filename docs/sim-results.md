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


## 7. What the sim can't tell you, and what it flags

- **PLANK price is held flat, and that's the biggest lie in the model.** At 1,000 mills the game burns ~18% of PLANK's supply a year at today's price; at 5,000 mills ~88% and at 10,000 mills ~177%, which can't happen. In reality the PLANK price rises, the $0.90 leg needs fewer PLANK, and the burn in tokens shrinks while the burn in dollars holds. Read the big-mill rows as "PLANK demand far exceeds supply at this price": the ratchet handles the pricing, but expect the PLANK chart to move hard if the mill count grows. Dollar figures don't depend on the PLANK price the sim uses; the % of supply does.
- **PAPER price is held flat too.** At medium participation ~24% of emission gets sold. Whether that's absorbed depends on the pool nobody has built yet. The model's $0.25 is only used to state dollar figures.
- **The mill fund is entirely outsider-driven.** With no ETH/USDG buyers, zero mills get eaten. Five outsiders a day (~$11,315/yr) eats ~112 mills a year at a $100 floor and ~13 at $786 (the listings seen so far). Every mill the fire eats raises every other mill's royalty share.
- **Fire lifetimes are stable everywhere** (mean 9.6 nights, max 19) because the storm scales to the community's own volume.
- Not modeled: PAPER/PLANK price moves, wallet splitting to dodge the 500 cap, founder behaviour, the mill floor moving as mills get eaten, the OpenSea fee and creator royalty inside a listing's price, the 20h TWAP lag.

## PAPER price scenarios (`python3 sim/economy.py --paper`: 1,000 mills, medium participation, 5 outsiders/day, $300 floor, 3 seeds)

A ticket takes 1 PAPER, or less once PAPER trades above $0.33 (`Fire.PAPER_USD_CAP`): the target is $0.33 worth. The leg moves at most 5% a night toward that target from a ≥20h average price, so it lags a rally: ~22 nights to catch up with a 3× move above the cap, ~45 nights with a 10× move. Until it catches up a PAPER-path ticket costs more than $1.23 — at 5% a night the PAPER part can be worth several dollars for weeks after a sharp spike. The $1 ETH/USDG option never moves and is the cheaper path in that window. The table's runs start with PAPER already at its price, so the first weeks pay the lag. "Tickets/day" assumes holders keep their buying habit and keep the PAPER they save (`paper_demand="tickets"`); the last two columns assume they burn as much PAPER as before and buy more tickets (`"paper"`, optimistic: needs proportionally more PLANK).

| PAPER price | PAPER per ticket (settled) | Nights to settle | Ticket cost once settled (PAPER path) | Tickets/day | Share of printed PAPER burned | Median pot | Tickets/day if people burn the same PAPER | Median pot then |
|---|---|---|---|---|---|---|---|---|
| $0.001 | 1 | 0 | $0.90 | 788 | 74% | $4,665 | 788 | $4,665 |
| $0.1 | 1 | 0 | $1.00 | 788 | 74% | $4,665 | 788 | $4,665 |
| $0.33 | 1 | 0 | $1.23 | 788 | 74% | $4,665 | 788 | $4,665 |
| $1 | 0.33 | 22 | $1.23 | 1,425 | 45% | $8,142 | 2,410 | $14,045 |
| $5 | 0.066 | 53 | $1.23 | 2,038 | 16% | $11,262 | 10,111 | $58,822 |

Reading it: at a penny or at 33¢ nothing changes. Above 33¢ tickets settle at ~$1.23 once the leg catches up; holders' PAPER stretches further, so they play more and pots grow, while a smaller share of printed PAPER is burned (fewer PAPER per ticket).
