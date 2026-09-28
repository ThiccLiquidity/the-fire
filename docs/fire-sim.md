# Fire simulation

`python3 sim/fire_sim.py` (add `--difftest` to regenerate `contracts/test/FireSimParity.t.sol`, which replays 600 nights through the contract and matches storm, fire size, fire and pot every night). The only input is daily log volume. 150 simulated years per pattern. Rules: the fire keeps 85% overnight; storm = the storm's normal level x (night-1)/8 x luck; the normal level follows the 7-night average up 3% of the gap a night, and down 3% (30% in a real slump, the week under half the level); luck lognormal(0, 1.2); fire in thousandths of a log; an empty fire carries its whole pot.

| Buying pattern | Fires / yr | Avg life (nights) | Out by night 3 | Reach 10 | Reach 15 | Longest | Fires with 0 logs |
|---|---|---|---|---|---|---|---|
| 0.3 a day (a ticket every few days) | 56 | 6.4 | 55% | 28% | 12.1% | 24 | 54% |
| 1 a day | 44 | 8.2 | 18% | 38% | 8.7% | 24 | 14% |
| 3 a day | 42 | 8.5 | 6% | 37% | 5.0% | 24 | 0% |
| 10 a day | 42 | 8.6 | 5% | 38% | 4.3% | 23 | 0% |
| 30 a day | 41 | 8.8 | 4% | 40% | 4.8% | 21 | 0% |
| 100 a day | 41 | 8.8 | 4% | 39% | 4.6% | 22 | 0% |
| 300 a day | 41 | 8.9 | 3% | 41% | 4.7% | 20 | 0% |
| 1,000 a day | 41 | 8.8 | 3% | 39% | 4.5% | 24 | 0% |
| 3,000 a day | 41 | 8.8 | 4% | 40% | 4.9% | 22 | 0% |
| 10,000 a day | 41 | 8.8 | 3% | 39% | 4.6% | 22 | 0% |
| 100,000 a day | 41 | 8.8 | 4% | 40% | 4.7% | 21 | 0% |
| 5 a day, very uneven days | 42 | 8.5 | 10% | 38% | 6.8% | 24 | 1% |
| 100 a day, very uneven days | 42 | 8.5 | 7% | 38% | 6.3% | 24 | 0% |
| 5,000 a day, very uneven days | 43 | 8.5 | 8% | 36% | 5.7% | 24 | 0% |
| 100 a day, busy weekends | 41 | 8.7 | 5% | 39% | 5.2% | 23 | 0% |
| 20 a day, 40% of days empty | 45 | 8.1 | 20% | 38% | 8.2% | 24 | 16% |
| 50 a day + a whale day (20x) 1 day in 20 | 44 | 8.1 | 10% | 33% | 6.6% | 24 | 0% |
| 200 a day, 2 empty weeks every 2 months | 57 | 6.2 | 59% | 26% | 12.8% | 24 | 58% |
| 500 a day, drops 20x for a month every quarter | 44 | 8.0 | 22% | 32% | 12.0% | 24 | 0% |
| Grows 10 -> 1,000 a day over the year | 33 | 10.9 | 1% | 62% | 18.0% | 24 | 0% |
| Shrinks 1,000 -> 10 a day over the year | 55 | 6.5 | 11% | 13% | 0.4% | 18 | 0% |
| Launch week 2,000 a day, settles to 50 | 49 | 7.3 | 9% | 23% | 2.0% | 21 | 0% |
