# Pot simulation

`python3 sim/fire_sim.py --pots`. $250 PLANK seed (the deployer's one-time `Fire.seed`), one year, 200 runs per pattern. Rules as on `wip/pending-approval`: storm luck lognormal(0, 1.5), fire in thousandths of a ticket, empty fires carry the whole pot, and the **prize cap**: a fire pays out on at most 20x what its own tickets put into the pot (the seed counts as carried-in, so ~30 tickets in one fire unlock it in full). Each ticket adds $0.45 x 10/11 (every buy assumed a 10-pack). PLANK price held flat. `contracts/test/FireSimParity.t.sol` checks the pot (seed + cap) against the contract every night.

- Nobody buys: the pot stays at $250 forever.
- The pot settles at about $2.70 per ticket bought per day; the cap never binds at 10+ a day.
- The cap stops a 1-3 ticket fire from taking 40% of a big pot; at 1 ticket a week the seed pays out as ~$3 prizes over a year instead of $100 to the first buyer.

| Buying pattern | Pot day 30 | Pot 6 mo | Pot 1 yr | Typical prize | Biggest prize | Winners/yr | Into pot/yr | Paid | Burned |
|---|---|---|---|---|---|---|---|---|---|
| Nobody ever buys | $250 | $250 | $250 | $0 | $0 | 0 | $0 | $0 | $0 |
| 1 ticket a week | $229 | $117 | $0 | $3 | $7 | 51 | $21 | $155 | $97 |
| 1 a day | $106 | $2 | $3 | $2 | $75 | 50 | $149 | $227 | $142 |
| 3 a day | $14 | $8 | $8 | $5 | $108 | 49 | $448 | $394 | $246 |
| 10 a day | $32 | $26 | $26 | $18 | $126 | 49 | $1,493 | $980 | $612 |
| 30 a day | $84 | $76 | $83 | $53 | $186 | 48 | $4,482 | $2,655 | $1,659 |
| 100 a day | $285 | $282 | $272 | $174 | $374 | 48 | $14,938 | $8,523 | $5,327 |
| 300 a day | $811 | $776 | $774 | $518 | $1,065 | 48 | $44,799 | $25,271 | $15,795 |
| 1,000 a day | $2,644 | $2,745 | $2,552 | $1,713 | $3,704 | 48 | $149,305 | $83,876 | $52,422 |
| 10,000 a day | $24,907 | $27,763 | $25,006 | $17,245 | $36,623 | 48 | $1,493,223 | $838,013 | $523,758 |
| Mixed days: each day either 10 or 1,000 | $1,329 | $1,091 | $1,310 | $749 | $2,332 | 59 | $75,745 | $42,614 | $26,634 |
| Mixed weeks: a quiet week (10/day), a busy week (1,000/day) | $928 | $2,979 | $1,136 | $115 | $1,609 | 77 | $75,183 | $42,199 | $26,375 |
| Mixed months: a dead month (0-2/day), then a busy month (500/day) | $345 | $977 | $428 | $394 | $1,568 | 52 | $36,878 | $20,964 | $13,102 |
| Launch 1,000/day, fades to 5/day by month 4 | $1,023 | $13 | $12 | $10 | $1,812 | 50 | $10,858 | $6,340 | $3,963 |
| Starts at 300/day, fades to nothing by month 6 | $608 | $1 | $1 | $127 | $748 | 25 | $7,419 | $4,382 | $2,738 |
| Grows 10 -> 1,000 a day over the year | $39 | $249 | $2,664 | $161 | $2,630 | 48 | $32,225 | $17,011 | $10,632 |
| 200 a day, 2 empty weeks every 2 months | $572 | $689 | $494 | $329 | $676 | 39 | $22,996 | $12,997 | $8,123 |

## 5-10 tickets a day for 3 years (300 runs each)

| Buying pattern | Fires/yr | Avg life | Out by night 3 | Reach night 10 | Tickets per fire | Typical prize | 1 in 10 prizes over | Pot after 1 yr | Pot after 3 yrs | Seed under $100 by |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 a day | 49 | 7.4 | 5% | 20% | 36 | $9 | $12 | $13 | $13 | day 8 |
| 7.5 a day | 49 | 7.4 | 4% | 20% | 54 | $13 | $18 | $20 | $19 | day 7 |
| 10 a day | 49 | 7.4 | 4% | 20% | 73 | $17 | $24 | $26 | $27 | day 6 |
| Somewhere between 5 and 10 each day | 49 | 7.4 | 4% | 20% | 54 | $13 | $18 | $20 | $19 | day 7 |
| 7.5 a day on average, very uneven days | 52 | 7.0 | 8% | 16% | 48 | $12 | $20 | $17 | $17 | day 7 |
| 7.5 a day on average, busy weekends | 50 | 7.2 | 5% | 18% | 53 | $13 | $18 | $24 | $17 | day 8 |
| 10 a day, but every 4th week nobody buys | 71 | 5.1 | 44% | 10% | 65 | $15 | $22 | $13 | $22 | day 6 |

At 5-10 a day every fire has 36-73 tickets, so the cap never binds: the first fire wins most of the seed (about $100-130) in week one, then the pot settles at $13-27 and a typical winner gets $9-17. Releasing the seed 5-10% per fire instead would keep prizes a few dollars higher for 3-6 months and change nothing after that.
