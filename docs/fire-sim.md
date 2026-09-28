# Fire simulation

`python3 sim/fire_sim.py` (add `--difftest` to regenerate `contracts/test/FireSimParity.t.sol`, which replays 600 nights through the contract and matches storm, fire size, fire and pot every night, and checks every rung of the storm ladder). The only input is daily log volume. 150 simulated years per pattern.

Rules: the fire is measured in logs (thousandths of a log on-chain). Every log adds 1. Overnight the fire keeps 85%. Every night from night 2 a storm is drawn off a fixed ladder of 20 sizes (5, 8, 12, 19, 30, 47, 74, 115, 180, 283, 442, 693, 1,084, 1,698, 2,658, 4,161, 6,515, 10,199, 15,968, 25,000 logs). If the fire is bigger it survives and loses the storm's size; otherwise it goes out. Storms never grow: the odds move. Night 2 draws mostly 5-30 log storms; the likely size moves up 0.75 of a rung each night, so by night 16 half the storms are 1,700+ logs and by night 23 almost all are. Night 1 no storm, night 24 infinite. An empty fire carries its whole pot.

| Night | Small (5-47) | Medium (74-1,084) | Big (1,698-25,000) |
|---|---|---|---|
| 2 | 91% | 9% | 0% |
| 5 | 68% | 32% | 0% |
| 8 | 34% | 65% | 1% |
| 12 | 5% | 83% | 11% |
| 16 | 0% | 50% | 50% |
| 20 | 0% | 12% | 88% |
| 23 | 0% | 2% | 98% |

| Buying pattern | Fires / yr | Avg life (nights) | Out by night 3 | Reach 10 | Reach 15 | Longest | Fires with 0 logs |
|---|---|---|---|---|---|---|---|
| 0.3 a day (a ticket every few days) | 182 | 2.0 | 100% | 0% | 0% | 2 | 54% |
| 1 a day | 182 | 2.0 | 100% | 0% | 0% | 3 | 14% |
| 3 a day | 173 | 2.1 | 100% | 0% | 0% | 5 | 0.2% |
| 10 a day | 125 | 2.9 | 75% | 0% | 0% | 8 | 0% |
| 30 a day | 71 | 5.1 | 25% | 0.7% | 0% | 11 | 0% |
| 100 a day | 39 | 9.2 | 2% | 50% | 0.0% | 15 | 0% |
| 300 a day | 28 | 13.0 | 0.1% | 95% | 22% | 19 | 0% |
| 1,000 a day | 21 | 16.8 | 0% | 100% | 90% | 22 | 0% |
| 3,000 a day | 17 | 20.4 | 0% | 100% | 100% | 24 | 0% |
| 10,000 a day | 15 | 24.0 | 0% | 100% | 100% | 24 | 0% |
| 100,000 a day | 15 | 24.0 | 0% | 100% | 100% | 24 | 0% |
| 5 a day, very uneven days | 158 | 2.3 | 94% | 0% | 0% | 7 | 0.7% |
| 100 a day, very uneven days | 42 | 8.6 | 5% | 41% | 0.2% | 15 | 0% |
| 5,000 a day, very uneven days | 16 | 22.0 | 0% | 100% | 100% | 24 | 0% |
| 100 a day, busy weekends | 40 | 8.9 | 3% | 45% | 0.0% | 16 | 0% |
| 20 a day, 40% of days empty | 96 | 3.8 | 52% | 0.2% | 0% | 11 | 16% |
| 50 a day + a whale day (20x) 1 day in 20 | 47 | 7.7 | 9% | 27% | 0.4% | 16 | 0% |
| 200 a day, 2 empty weeks every 2 months | 58 | 6.2 | 54% | 36% | 2% | 18 | 54% |
| 500 a day, drops 20x for a month every quarter | 40 | 9.0 | 18% | 45% | 23% | 19 | 0% |
| Grows 10 -> 1,000 a day over the year | 51 | 7.0 | 27% | 28% | 7% | 20 | 0% |
| Shrinks 1,000 -> 10 a day over the year | 51 | 7.1 | 26% | 28% | 8% | 23 | 0% |
| Launch week 2,000 a day, settles to 50 | 47 | 7.7 | 8% | 21% | 5% | 22 | 0% |
