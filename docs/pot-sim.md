# Pot simulation

`python3 sim/fire_sim.py --pots`. $250 PLANK seed (deployer's one-time `Fire.seed`). Rules: all of a log's PLANK into the pot; 40/25/5/30 split when a fire goes out; the 5x prize cap (a fire pays out on at most 5x what its own logs put in; the rest carries); empty fires carry everything; the storm ladder (docs/fire-sim.md). Each log adds $0.90 x 10/(10 + free logs) (every buy a 10-pack: 13 logs on a fire's first day, 12 on its second, 11 after). PLANK price flat. The parity test checks the pot against the contract every night.

## Buying patterns, one year

| Buying pattern | Pot day 30 | Pot 6 mo | Pot 1 yr | Typical prize | Biggest prize | Winners/yr |
|---|---|---|---|---|---|---|
| Nobody ever buys | $250 | $250 | $250 | $0 | $0 | 0 |
| 1 ticket a week | $243 | $203 | $156 | $2 | $2 | 52 |
| 1 a day | $197 | $1 | $1 | $1 | $18 | 158 |
| 3 a day | $87 | $3 | $3 | $3 | $32 | 172 |
| 10 a day | $16 | $15 | $17 | $12 | $116 | 124 |
| 30 a day | $101 | $110 | $97 | $68 | $198 | 71 |
| 100 a day | $578 | $628 | $582 | $421 | $643 | 40 |
| 300 a day | $2,353 | $2,647 | $2,582 | $1,791 | $2,400 | 28 |
| 1,000 a day | $14,984 | $12,624 | $12,807 | $7,699 | $9,723 | 21 |
| 10,000 a day | $113,733 | $187,886 | $122,586 | $110,937 | $111,632 | 15 |
| Mixed days: each day either 10 or 1,000 | $3,935 | $5,011 | $5,355 | $3,085 | $6,738 | 29 |
| Mixed weeks: a quiet week (10/day), a busy week (1,000/day) | $7,354 | $7,197 | $7,997 | $3,187 | $5,224 | 33 |
| Mixed months: a dead month (0-2/day), then a busy month (500/day) | $554 | $3,050 | $2,587 | $4 | $3,937 | 68 |
| Launch 1,000/day, fades to 5/day by month 4 | $2,806 | $6 | $6 | $5 | $4,626 | 122 |
| Starts at 300/day, fades to nothing by month 6 | $1,938 | $0 | $0 | $41 | $1,638 | 31 |
| Grows 10 -> 1,000 a day over the year | $30 | $568 | $10,436 | $82 | $7,354 | 51 |
| 200 a day, 2 empty weeks every 2 months | $1,838 | $1,688 | $1,508 | $974 | $1,500 | 27 |

Low volume under the ladder: fires die in 2-3 nights, so a game of under ~30 logs a day pays out many small prizes. The 5x cap keeps each of those from taking more than 5x what its own logs put in, so the seed and earlier fires' carry drain slowly and wait for a real fire. See also `docs/wild-year.md` (random moods, FOMO, dry spells).
