# Pot simulation

`python3 sim/fire_sim.py --pots`. $250 PLANK seed (deployer's one-time `Fire.seed`). Current rules: all of a ticket's PLANK into the pot; 40/25/5/30 split when a fire goes out; the 20x prize cap; empty fires carry everything; the storm rules above (fire keeps 85%, slow-up/fast-down storm level, luck 1.2). Each ticket adds $0.90 x 10/11 (every buy a 10-pack). PLANK price flat. The parity test checks the pot against the contract every night.

## Average 5 to 100 tickets a day, 3 years

| Tickets/day (avg) | Tickets per fire | Typical prize | 1 in 10 prizes over | Biggest | Pot usually | Avg fire life |
|---|---|---|---|---|---|---|
| 5 | 46 | $22 | $34 | $85 | $35 | 9.6 nights |
| 10 | 92 | $44 | $65 | $117 | $70 | 9.5 nights |
| 20 | 184 | $87 | $130 | $247 | $140 | 9.5 nights |
| 30 | 274 | $130 | $193 | $369 | $208 | 9.5 nights |
| 50 | 453 | $216 | $316 | $548 | $343 | 9.4 nights |
| 75 | 688 | $326 | $482 | $904 | $520 | 9.5 nights |
| 100 | 908 | $430 | $632 | $1,102 | $686 | 9.4 nights |

## Buying patterns, one year

| Buying pattern | Pot day 30 | Pot 6 mo | Pot 1 yr | Typical prize | Biggest prize | Winners/yr |
|---|---|---|---|---|---|---|
| Nobody ever buys | $250 | $250 | $250 | $0 | $0 | 0 |
| 1 ticket a week | $207 | $3 | $1 | $1 | $26 | 33 |
| 1 a day | $41 | $7 | $8 | $5 | $110 | 35 |
| 3 a day | $32 | $20 | $20 | $14 | $125 | 38 |
| 10 a day | $79 | $65 | $69 | $44 | $160 | 39 |
| 30 a day | $206 | $201 | $199 | $127 | $338 | 40 |
| 100 a day | $666 | $626 | $684 | $413 | $933 | 40 |
| 300 a day | $2,114 | $2,190 | $2,067 | $1,209 | $2,569 | 41 |
| 1,000 a day | $6,301 | $7,187 | $6,818 | $4,042 | $8,590 | 41 |
| 10,000 a day | $63,593 | $60,068 | $63,537 | $40,324 | $90,079 | 41 |
| Mixed days: each day either 10 or 1,000 | $4,023 | $4,244 | $4,093 | $2,095 | $6,944 | 41 |
| Mixed weeks: a quiet week (10/day), a busy week (1,000/day) | $7,372 | $7,170 | $7,926 | $3,048 | $6,144 | 43 |
| Mixed months: a dead month (0-2/day), then a busy month (500/day) | $484 | $4,130 | $2,052 | $33 | $4,901 | 45 |
| Launch 1,000/day, fades to 5/day by month 4 | $2,214 | $34 | $32 | $28 | $4,248 | 42 |
| Starts at 300/day, fades to nothing by month 6 | $1,408 | $2 | $2 | $272 | $1,677 | 23 |
| Grows 10 -> 1,000 a day over the year | $106 | $721 | $7,107 | $449 | $7,839 | 33 |
| 200 a day, 2 empty weeks every 2 months | $1,243 | $1,740 | $2,325 | $1,061 | $2,053 | 24 |
