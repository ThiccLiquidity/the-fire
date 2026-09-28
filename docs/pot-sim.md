# Pot simulation

`python3 sim/fire_sim.py --pots`. $250 PLANK seed (deployer's one-time `Fire.seed`). Rules: all of a log's PLANK into the pot; 40/25/5/30 split when a fire goes out; the 20x prize cap; empty fires carry everything; the storm ladder (docs/fire-sim.md). Each log adds $0.90 x 10/(10 + free logs) (every buy a 10-pack: 13 logs on a fire's first day, 12 on its second, 11 after). PLANK price flat. The parity test checks the pot against the contract every night.

## Buying patterns, one year

| Buying pattern | Pot day 30 | Pot 6 mo | Pot 1 yr | Typical prize | Biggest prize | Winners/yr |
|---|---|---|---|---|---|---|
| Nobody ever buys | $250 | $250 | $250 | $0 | $0 | 0 |
| 1 ticket a week | $213 | $6 | $0 | $6 | $6 | 52 |
| 1 a day | $3 | $1 | $1 | $1 | $52 | 157 |
| 3 a day | $3 | $3 | $3 | $3 | $106 | 172 |
| 10 a day | $16 | $15 | $14 | $12 | $127 | 125 |
| 30 a day | $107 | $103 | $99 | $69 | $211 | 71 |
| 100 a day | $572 | $642 | $621 | $424 | $640 | 39 |
| 300 a day | $2,410 | $2,759 | $2,935 | $1,786 | $2,431 | 28 |
| 1,000 a day | $14,896 | $12,818 | $12,288 | $7,738 | $9,785 | 21 |
| 10,000 a day | $113,771 | $187,857 | $122,480 | $110,937 | $111,642 | 15 |
| Mixed days: each day either 10 or 1,000 | $3,733 | $4,989 | $4,944 | $3,108 | $6,138 | 29 |
| Mixed weeks: a quiet week (10/day), a busy week (1,000/day) | $7,288 | $7,112 | $7,946 | $3,145 | $5,243 | 33 |
| Mixed months: a dead month (0-2/day), then a busy month (500/day) | $379 | $3,010 | $2,551 | $17 | $4,198 | 68 |
| Launch 1,000/day, fades to 5/day by month 4 | $2,734 | $6 | $6 | $5 | $4,531 | 122 |
| Starts at 300/day, fades to nothing by month 6 | $1,980 | $0 | $0 | $42 | $1,672 | 32 |
| Grows 10 -> 1,000 a day over the year | $28 | $536 | $10,773 | $87 | $7,149 | 51 |
| 200 a day, 2 empty weeks every 2 months | $1,776 | $1,652 | $1,092 | $974 | $1,457 | 27 |

Low volume under the ladder: fires die in 2-3 nights, so a game of under ~30 logs a day pays out many small prizes and the $250 seed is paid out within weeks (the 20x cap limits each fire to 20x what its own logs put in). At 100+ a day the pot holds above the seed.
