# The Fire — full economy simulation

324 year-long runs: mills ∈ {1k, 2.5k, 5k, 10k} × participation ∈ {low, medium, high} × outsiders ∈ {0, 5, 25}/day × mill floor ∈ {$60, $100, $150} × 3 seeds. Prices fixed (PLANK $0.0000938, ETH $3,333, PAPER $0.25 for reporting only). Model: `sim/economy.py`.

**Participation** = share of each day's fresh PAPER a wallet spends on tickets (whale/mid/small): low 25/18/10%, medium 50/40/30%, high 75/65/55%, plus a 10%/day trickle of stockpiles and rallies when the fire looks threatened.

## 1. Participation is the whole game (1,000 mills, 5 outsiders/day, $100 floor)

| Participation | Tickets/day | PAPER burned | PAPER sold | Stockpile (days of emission) | Fire life (min–max) | Pot median / max | PLANK burned/yr | Wins whale/mid/small/outsider |
|---|---|---|---|---|---|---|---|---|
| low | 484 | 47% | 50% | 9.6 | 10.0 (4–15) | $3,034 / $5,384 | $111,169 | 8/16/10/2 |
| med | 741 | 74% | 24% | 7.8 | 9.8 (3–16) | $4,600 / $8,107 | $170,271 | 9/13/14/1 |
| high | 902 | 91% | 8% | 5.4 | 9.8 (5–15) | $5,449 / $8,755 | $207,559 | 7/11/18/1 |

## 2. Scale: more mills (medium participation, 5 outsiders/day, $100 floor)

| Mills | Wallets | Tickets/day | Pot median / max | PLANK burned/yr | % of PLANK supply/yr | PLANK sitting in pot | Fire life |
|---|---|---|---|---|---|---|---|
| 1,000 | 230 | 741 | $4,600 / $8,107 | $170,271 | 23% | $2,918 | 9.8 |
| 2,500 | 581 | 1860 | $11,999 / $18,777 | $428,201 | 57% | $5,849 | 10.1 |
| 5,000 | 1132 | 3769 | $22,680 / $38,696 | $864,963 | 115% | $16,228 | 9.5 |
| 10,000 | 2215 | 7578 | $44,658 / $77,213 | $1,737,564 | 232% | $35,593 | 9.4 |

## 3. The mill fund: how fast the fire eats mills (medium participation, 1,000 mills)

| Outsiders/day | ETH in/yr | Mill floor | Mills eaten/yr | Days per mill | Emission drop | Royalty $/mill/yr | Outsider share of tickets |
|---|---|---|---|---|---|---|---|
| 0 | $0 | $60 | 0 | — | 0% | $3.32 | 0% |
| 0 | $0 | $100 | 0 | — | 0% | $3.32 | 0% |
| 0 | $0 | $150 | 0 | — | 0% | $3.32 | 0% |
| 5 | $10,939 | $60 | 182 | 2.0 | 18% | $20.61 | 4% |
| 5 | $11,024 | $100 | 109 | 3.3 | 11% | $12.97 | 4% |
| 5 | $10,757 | $150 | 66 | 5.5 | 7% | $8.97 | 4% |
| 25 | $55,825 | $60 | 930 | 0.4 | 53% | $154.88 | 24% |
| 25 | $55,886 | $100 | 558 | 0.7 | 53% | $96.12 | 22% |
| 25 | $55,714 | $150 | 371 | 1.0 | 37% | $49.77 | 20% |

## 4. Fairness: return per dollar by tier (all scenarios averaged)

Whales get back 20% of what they spend, mids 20%, small holders 21%. Differences are noise — the 10/500 caps and 3% max discount make the raffle proportional. It's a burn game: ~20¢ back per dollar in expectation, the rest is destroyed PAPER/PLANK and the tithe.

## 5. Fire lifetimes across everything

Across all 324 runs: average fire lives 8.7–10.8 nights (mean 9.6); 1% of fires die by night 3; 53% reach night 10; 3% reach night 15; longest fire seen: 18 nights. The storm scales to the community's own volume, so this barely moves with mills or participation — which is the point.

## 6. Daily cap

Wallets hitting the 500/day cap: 0.00 per day on average, max 0.0 — only whales at high participation with 10k mills. The cap is almost never binding; it exists for the one whale who tries to buy the fire in an evening.


## 7. What the sim can't tell you, and what it flags

- **PLANK price is held flat, and that's the biggest lie in the model.** At 1,000 mills the game burns ~23% of PLANK's supply a year at today's price; at 5,000 mills it "burns" 115% and at 10,000 mills 232% — which can't happen. In reality the PLANK price rises, the $0.90 leg needs fewer PLANK, and the burn in tokens shrinks while the burn in dollars holds. Read the 5k/10k PLANK rows as "PLANK demand far exceeds supply at this price": the ratchet handles the pricing, but the community should expect the PLANK chart to move hard if the mill count grows.
- **PAPER price is held flat too.** At medium participation ~24% of emission gets sold. Whether that's absorbed depends on the pool nobody has built yet. The model's $0.25 is only used to state dollar figures.
- **The mill fund is entirely outsider-driven.** With no ETH buyers, zero mills get eaten. Five outsiders a day eats a mill every ~3 days at a $100 floor; 25 a day eats one most days and cuts emission by half over a year. Every mill the fire eats raises every other mill's royalty share.
- **Fire lifetimes are stable everywhere** (mean 9.6 nights, max 18) because the storm scales to the community's own volume. That was the design goal and it holds at 1k mills and 10k.
- **Fairness holds.** Whale, mid and small holders all get back ~20¢ per dollar. The caps and the tiny discount do their job. The daily cap essentially never binds.
- Not modeled: PAPER/PLANK price dynamics, wallet splitting to dodge the 500 cap (it's gas and effort; unlikely at this scale), founder behaviour, secondary-market mill floor changes as mills get eaten.
