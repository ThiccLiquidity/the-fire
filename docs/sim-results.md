# The Fire — full economy simulation

*Sep 28 2026. Model: `sim/economy.py` (`python3 sim/economy.py`, ~30 s; `--paper` for the PAPER table). Rules matched the contract on Sep 28; **superseded** since (storm ladder, 85% keep, 3/2/1 free logs, 5× cap). Current numbers: `docs/fire-sim.md`, `docs/pot-sim.md`.*

**Runs:** 324 year-long runs: mills ∈ {1k, 2.5k, 5k, 10k} × participation ∈ {low, medium, high} × outsiders ∈ {0, 5, 25}/day × mill floor ∈ {$100, $300, $786} × 3 seeds.

**Inputs held flat:** PLANK $1.056e-9 (Uniswap V2 pair ~28.1 WETH / 88.7T PLANK at $3,333/ETH, Sep 27 2026), supply 888.42T, 88.84B PLANK inside a mill (~$94). ETH $3,333. PAPER $0.25 (reporting only). Ticket = PAPER leg + $0.90 of PLANK, or $1 of ETH/USDG + $0.90 of PLANK. Mill bid starts at 85% of the floor.

**Contract rules modeled:** 10 paid per buy, buy 10 get 1 free, 500 tickets *received* per wallet per day (the free ones count). Storm = 7-night average (today excluded) × age table × 32-point luck table (lognormal σ 1.5), in thousandths of a ticket like the contract. A fire nobody bought into carries its whole pot. All of a ticket's PLANK goes into the pot (no burn at purchase). Fire keeps 60% overnight. Pot split 40/25/5/30. Mill bid +25% of its start per day, capped at 3× and at the fund, restarts at 90% of the price paid; the keeper sweeps hourly; each mill also costs the 0.0003 ETH burn fee.

**Participation** = share of each day's fresh PAPER a wallet spends on tickets (whale/mid/small): low 25/18/10%, medium 50/40/30%, high 75/65/55%, plus a 10%/day trickle of stockpiles and rallies when the fire looks threatened.

## 1. Participation is the whole game (1,000 mills, 5 outsiders/day, $300 floor)

| Participation | Tickets/day | PAPER burned | PAPER sold | Stockpile (days of emission) | Fire life (min–max) | Pot median / max | PLANK burned/yr | Wins whale/mid/small/outsider |
|---|---|---|---|---|---|---|---|---|
| low | 452 | 41% | 56% | 11.2 | 7.6 (3–13) | $3,828 / $9,554 | $49,613 | 13/19/11/4 |
| med | 749 | 70% | 28% | 8.7 | 7.6 (3–14) | $5,982 / $14,766 | $82,849 | 14/12/18/3 |
| high | 949 | 90% | 9% | 5.8 | 7.5 (3–15) | $8,260 / $17,223 | $105,261 | 10/16/21/2 |

## 2. Scale: more mills (medium participation, 5 outsiders/day, $300 floor)

| Mills | Wallets | Tickets/day | Pot median / max | PLANK burned/yr | % of PLANK supply/yr | PLANK sitting in pot | Fire life |
|---|---|---|---|---|---|---|---|
| 1,000 | 230 | 749 | $5,982 / $14,766 | $82,849 | 9% | $3,403 | 7.6 |
| 2,500 | 581 | 1,841 | $15,556 / $36,248 | $202,305 | 22% | $13,445 | 7.6 |
| 5,000 | 1132 | 3,694 | $29,428 / $75,259 | $406,324 | 43% | $22,194 | 7.2 |
| 10,000 | 2215 | 7,448 | $64,324 / $138,279 | $820,262 | 87% | $39,671 | 7.7 |

## 3. The mill fund: how fast the fire eats mills (medium participation, 1,000 mills)

| Outsiders/day | ETH+USDG in/yr | Mill floor | Mills eaten/yr | Days per mill | Emission drop | Royalty $/mill/yr | Outsider share of tickets |
|---|---|---|---|---|---|---|---|
| 0 | $0 | $100 | 0 | — | 0% | $15.99 | 0% |
| 0 | $0 | $300 | 0 | — | 0% | $15.99 | 0% |
| 0 | $0 | $786 | 0 | — | 0% | $15.99 | 0% |
| 5 | $11,425 | $100 | 113 | 3.2 | 11% | $29.81 | 5% |
| 5 | $11,258 | $300 | 37 | 9.9 | 4% | $20.81 | 4% |
| 5 | $11,362 | $786 | 14 | 26.1 | 1% | $18.18 | 4% |
| 25 | $56,078 | $100 | 554 | 0.7 | 53% | $144.31 | 23% |
| 25 | $56,317 | $300 | 186 | 2.0 | 19% | $44.28 | 20% |
| 25 | $55,889 | $786 | 71 | 5.2 | 7% | $27.42 | 19% |

Royalty $/mill/yr = the pot's 5% plus the PLANK inside every eaten mill, split across the mills still standing. It counts only once the Plank Press admin whitelists PLANK in the pool.

## 4. Fairness: return per dollar by tier (all scenarios averaged)

Whales get back 46% of what they spend, mids 47%, small holders 40%. The only discount is the free 11th ticket on a full buy of 10 (~9%), and the 500/day cap rarely binds, so the raffle stays close to proportional. It's a burn game: ~47¢ back per dollar in expectation; the rest is burned PAPER/PLANK, the 5% royalty and the 30% that relights the next fire.

## 5. Fire lifetimes across everything

Across all 324 runs: 48 fires a year; average fire lives 6.6–8.8 nights (mean 7.6); 6% of fires die by night 3; 25% reach night 10; 1.8% reach night 15; longest fire seen: 19 nights. Night 24 is never reached. The storm scales to the community's own volume, so this barely moves with mills or participation — which is the point.

## 6. Daily cap

Wallets that wanted more than the 500/day cap allows: 0.00 per day on average, max 0.01 in any scenario. The cap is almost never binding; it exists for the one whale who tries to buy the fire in an evening.


## 7. What the sim can't tell you, and what it flags

- **PLANK price is held flat, and that's the biggest lie in the model.** At 1,000 mills the game burns ~9% of PLANK's supply a year at today's price; at 5,000 mills ~43% and at 10,000 mills ~87%, which can't happen. In reality the PLANK price rises, the $0.90 leg needs fewer PLANK, and the burn in tokens shrinks while the burn in dollars holds. Read the big-mill rows as "PLANK demand far exceeds supply at this price": the ratchet handles the pricing, but expect the PLANK chart to move hard if the mill count grows. Dollar figures don't depend on the PLANK price the sim uses; the % of supply does.
- **PAPER price is held flat too.** At medium participation ~24% of emission gets sold. Whether that's absorbed depends on the pool nobody has built yet. The model's $0.25 is only used to state dollar figures.
- **The mill fund is entirely outsider-driven.** With no ETH/USDG buyers, zero mills get eaten. Five outsiders a day (~$11,425/yr) eats ~113 mills a year at a $100 floor and ~14 at $786 (the listings seen so far). Every mill the fire eats raises every other mill's royalty share.
- **Fire lifetimes are stable everywhere** (mean 7.6 nights, max 19) because the storm scales to the community's own volume.
- Not modeled: PAPER/PLANK price moves, wallet splitting to dodge the 500 cap, founder behaviour, the mill floor moving as mills get eaten, the OpenSea fee and creator royalty inside a listing's price, the 20h TWAP lag.

## PAPER price scenarios (`python3 sim/economy.py --paper`: 1,000 mills, medium participation, 5 outsiders/day, $300 floor, 3 seeds)

A ticket takes 1 PAPER, or less once PAPER trades above $0.33 (`Fire.PAPER_USD_CAP`): the target is $0.33 worth. The leg moves at most 5% a night toward that target from a ≥20h average price, so it lags a rally: ~22 nights to catch up with a 3× move above the cap, ~45 nights with a 10× move. Until it catches up a PAPER-path ticket costs more than $1.23 — at 5% a night the PAPER part can be worth several dollars for weeks after a sharp spike. The $1 ETH/USDG option never moves and is the cheaper path in that window. The table's runs start with PAPER already at its price, so the first weeks pay the lag. "Tickets/day" assumes holders keep their buying habit and keep the PAPER they save (`paper_demand="tickets"`); the last two columns assume they burn as much PAPER as before and buy more tickets (`"paper"`, optimistic: needs proportionally more PLANK).

| PAPER price | PAPER per ticket (settled) | Nights to settle | Ticket cost once settled (PAPER path) | Tickets/day | Share of printed PAPER burned | Median pot | Tickets/day if people burn the same PAPER | Median pot then |
|---|---|---|---|---|---|---|---|---|
| $0.001 | 1 | 0 | $0.90 | 749 | 70% | $5,982 | 749 | $5,982 |
| $0.1 | 1 | 0 | $1.00 | 749 | 70% | $5,982 | 749 | $5,982 |
| $0.33 | 1 | 0 | $1.23 | 749 | 70% | $5,982 | 749 | $5,982 |
| $1 | 0.33 | 22 | $1.23 | 1,252 | 40% | $9,530 | 2,307 | $18,519 |
| $5 | 0.066 | 53 | $1.23 | 1,741 | 13% | $13,156 | 9,690 | $79,324 |

Reading it: at a penny or at 33¢ nothing changes. Above 33¢ tickets settle at ~$1.23 once the leg catches up; holders' PAPER stretches further, so they play more and pots grow, while a smaller share of printed PAPER is burned (fewer PAPER per ticket).
