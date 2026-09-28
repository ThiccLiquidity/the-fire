# Pot simulation

`python3 sim/fire_sim.py --pots`. $250 PLANK seed, one year, 200 runs per pattern, rules as on `wip/pending-approval` (storm luck lognormal(0, 1.5), fire in thousandths of a ticket, empty fires carry the whole pot). Each ticket adds $0.45 × 10/11 (every buy assumed a 10-pack; the free ticket adds no PLANK). PLANK price held flat.

- Nobody buys: the pot stays at $250 forever (empty fires carry 100%). Under the old rule it would have been ~$3 after a month.
- The pot settles at about $2.70 per ticket bought per day.
- The seed is a first prize: the first fire with a buyer pays 40% of it; 30% carries, so it's mostly gone after 3 fires with buyers.

| Buying pattern | Pot day 30 | Pot 6 mo | Pot 1 yr | Typical prize | Biggest prize | Winners/yr | Into pot/yr | Paid | Burned |
|---|---|---|---|---|---|---|---|---|---|
| Nobody ever buys | $250 | $250 | $250 | $0 | $0 | 0 | $0 | $0 | $0 |
| 1 ticket a week | $2 | $1 | $0 | $0 | $100 | 51 | $21 | $155 | $97 |
| 1 a day | $5 | $3 | $3 | $2 | $103 | 50 | $150 | $227 | $142 |
| 3 a day | $10 | $7 | $7 | $5 | $108 | 50 | $448 | $394 | $246 |
| 10 a day | $29 | $27 | $26 | $17 | $123 | 49 | $1,493 | $980 | $612 |
| 30 a day | $83 | $85 | $76 | $52 | $178 | 48 | $4,481 | $2,656 | $1,660 |
| 100 a day | $262 | $293 | $266 | $175 | $358 | 48 | $14,936 | $8,512 | $5,320 |
| 300 a day | $770 | $823 | $822 | $515 | $1,129 | 48 | $44,784 | $25,248 | $15,780 |
| 1,000 a day | $2,706 | $2,604 | $2,876 | $1,711 | $3,739 | 48 | $149,346 | $83,724 | $52,328 |
| 10,000 a day | $28,342 | $27,845 | $27,159 | $17,188 | $36,117 | 48 | $1,493,163 | $837,197 | $523,248 |
| Mixed days: each day either 10 or 1,000 | $1,117 | $1,251 | $1,125 | $700 | $2,338 | 59 | $74,868 | $42,197 | $26,373 |
| Mixed weeks: a quiet week (10/day), a busy week (1,000/day) | $377 | $2,522 | $949 | $365 | $1,549 | 77 | $75,215 | $42,277 | $26,423 |
| Mixed months: a dead month (0-2/day), then a busy month (500/day) | $213 | $928 | $197 | $354 | $1,588 | 52 | $36,882 | $21,079 | $13,174 |
| Launch 1,000/day, fades to 5/day by month 4 | $906 | $14 | $14 | $10 | $1,909 | 50 | $10,854 | $6,337 | $3,961 |
| Starts at 300/day, fades to nothing by month 6 | $611 | $1 | $1 | $128 | $763 | 25 | $7,426 | $4,385 | $2,741 |
| Grows 10 -> 1,000 a day over the year | $40 | $255 | $2,720 | $162 | $2,573 | 48 | $32,220 | $16,996 | $10,623 |
| 200 a day, 2 empty weeks every 2 months | $559 | $707 | $498 | $328 | $732 | 39 | $22,992 | $12,989 | $8,118 |
