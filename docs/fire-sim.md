# Fire simulation

`python3 sim/fire_sim.py` (add `--difftest` to regenerate `contracts/test/FireSimParity.t.sol`). The only input is daily ticket volume; everything else runs exactly as `Fire.sol` (the parity test replays 600 nights through the contract and matches every night). 150 simulated years per pattern. Rules as of Sep 28 2026: storm luck lognormal(0, 1.5), fire counted in thousandths of a ticket, an empty fire carries its whole pot.

| Buying pattern | Fires / yr | Avg life (nights) | Out by night 3 | Reach 10 | Reach 15 | Longest | Fires with 0 tickets |
|---|---|---|---|---|---|---|---|
| 0.3 a day (a ticket every few days) | 91 | 4.0 | 57% | 3% | 0.0% | 15 | 56% |
| 1 a day | 58 | 6.2 | 20% | 12% | 0.4% | 18 | 14% |
| 3 a day | 50 | 7.2 | 6% | 18% | 0.5% | 18 | 0% |
| 10 a day | 49 | 7.4 | 4% | 20% | 0.5% | 21 | 0% |
| 30 a day | 48 | 7.5 | 4% | 21% | 0.5% | 18 | 0% |
| 100 a day | 48 | 7.6 | 3% | 21% | 0.7% | 18 | 0% |
| 300 a day | 48 | 7.5 | 4% | 21% | 0.6% | 19 | 0% |
| 1,000 a day | 48 | 7.5 | 3% | 20% | 0.6% | 21 | 0% |
| 3,000 a day | 48 | 7.6 | 3% | 22% | 0.8% | 18 | 0% |
| 10,000 a day | 48 | 7.5 | 3% | 21% | 0.6% | 17 | 0% |
| 100,000 a day | 48 | 7.6 | 3% | 21% | 0.6% | 18 | 0% |
| 5 a day, very uneven days | 52 | 6.9 | 9% | 16% | 0.3% | 18 | 1% |
| 100 a day, very uneven days | 51 | 7.2 | 6% | 17% | 0.4% | 18 | 0% |
| 5,000 a day, very uneven days | 50 | 7.2 | 7% | 18% | 0.3% | 18 | 0% |
| 100 a day, busy weekends | 50 | 7.1 | 6% | 16% | 0.3% | 18 | 0% |
| 20 a day, 40% of days empty | 58 | 6.2 | 21% | 12% | 0.3% | 17 | 16% |
| 50 a day + a whale day (20x) 1 day in 20 | 52 | 7.0 | 9% | 17% | 0.5% | 19 | 0% |
| 200 a day, 2 empty weeks every 2 months | 74 | 4.9 | 49% | 11% | 0.3% | 17 | 47% |
| 500 a day, drops 20x for a month every quarter | 50 | 7.2 | 8% | 19% | 0.9% | 21 | 0% |
| Grows 10 -> 1,000 a day over the year | 47 | 7.6 | 3% | 22% | 0.7% | 19 | 0% |
| Shrinks 1,000 -> 10 a day over the year | 49 | 7.4 | 4% | 20% | 0.5% | 19 | 0% |
| Launch week 2,000 a day, settles to 50 | 49 | 7.4 | 3% | 20% | 0.5% | 18 | 0% |
