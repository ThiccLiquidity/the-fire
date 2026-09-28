# Pot simulation

`python3 sim/fire_sim.py --pots`. $250 PLANK seed (the deployer's one-time `Fire.seed`). Rules as on `wip/pending-approval`: **all of a ticket's PLANK goes into the pot** (nothing burns at purchase; PLANK burns when a fire pays out), storm luck lognormal(0, 1.5), fire in thousandths of a ticket, empty fires carry the whole pot, and the **prize cap**: a fire pays out on at most 20x what its own tickets put into the pot (the seed counts as carried-in, so ~15 tickets in one fire unlock it in full). Each ticket adds $0.90 x 10/11 (every buy assumed a 10-pack). PLANK price held flat. `contracts/test/FireSimParity.t.sol` checks the pot (seed + cap) against the contract every night.

- Nobody buys: the pot stays at $250 forever.
- The typical prize is about $3.40 and the pot about $5.20 per ticket bought per day.
- The cap never binds at 5+ a day; it only stops fires with a handful of tickets from taking 40% of a big pot.

## Average 5 to 100 tickets a day, 3 years (200 runs each; days wobble around the average)

| Tickets/day (avg) | Tickets per fire | Typical prize | 1 in 10 prizes over | Biggest | Pot (typical, 8 in 10 between) | Into pot/yr | To winners/yr | Burned/yr | Royalty pool/yr |
|---|---|---|---|---|---|---|---|---|---|
| 5 | 35 | $16 | $24 | $46 | $25 ($12-$46) | $1,493 | $895 | $560 | $112 |
| 10 | 71 | $33 | $48 | $87 | $51 ($25-$91) | $2,986 | $1,743 | $1,089 | $218 |
| 15 | 106 | $50 | $72 | $136 | $77 ($38-$137) | $4,473 | $2,588 | $1,618 | $324 |
| 20 | 142 | $67 | $96 | $179 | $103 ($51-$182) | $5,967 | $3,436 | $2,148 | $430 |
| 25 | 177 | $84 | $120 | $214 | $128 ($64-$227) | $7,464 | $4,286 | $2,678 | $536 |
| 30 | 212 | $100 | $143 | $240 | $154 ($77-$272) | $8,944 | $5,130 | $3,206 | $641 |
| 40 | 285 | $134 | $191 | $357 | $207 ($103-$363) | $11,941 | $6,828 | $4,268 | $854 |
| 50 | 356 | $168 | $238 | $464 | $257 ($128-$452) | $14,908 | $8,513 | $5,321 | $1,064 |
| 60 | 426 | $201 | $287 | $530 | $309 ($154-$544) | $17,906 | $10,215 | $6,384 | $1,277 |
| 75 | 536 | $253 | $361 | $717 | $387 ($193-$681) | $22,396 | $12,767 | $7,979 | $1,596 |
| 100 | 713 | $337 | $481 | $856 | $516 ($258-$908) | $29,913 | $17,036 | $10,648 | $2,130 |

Prizes are after the first month; the first winner also takes most of the $250 seed. Fires: ~50 a year, ~7.3 nights, ~5% out by night 3, ~19% reach night 10 at every average.

## Buying patterns, one year

| Buying pattern | Pot day 30 | Pot 6 mo | Pot 1 yr | Typical prize | Biggest prize | Winners/yr | Into pot/yr | Paid | Burned |
|---|---|---|---|---|---|---|---|---|---|
| Nobody ever buys | $250 | $250 | $250 | $0 | $0 | 0 | $0 | $0 | $0 |
| 1 ticket a week | $207 | $2 | $0 | $1 | $13 | 51 | $43 | $167 | $104 |
| 1 a day | $19 | $5 | $5 | $4 | $106 | 50 | $297 | $310 | $194 |
| 3 a day | $19 | $17 | $16 | $10 | $117 | 50 | $898 | $646 | $404 |
| 10 a day | $58 | $54 | $52 | $35 | $151 | 48 | $2,983 | $1,815 | $1,135 |
| 30 a day | $161 | $160 | $167 | $104 | $248 | 48 | $8,970 | $5,166 | $3,229 |
| 100 a day | $519 | $537 | $516 | $345 | $763 | 48 | $29,855 | $16,883 | $10,552 |
| 300 a day | $1,542 | $1,577 | $1,642 | $1,024 | $2,313 | 48 | $89,586 | $50,350 | $31,468 |
| 1,000 a day | $5,359 | $5,494 | $5,473 | $3,448 | $7,101 | 48 | $298,575 | $167,478 | $104,673 |
| 10,000 a day | $50,730 | $55,946 | $52,282 | $34,381 | $72,605 | 48 | $2,986,533 | $1,675,202 | $1,047,001 |
| Mixed days: each day either 10 or 1,000 | $2,462 | $2,591 | $2,728 | $1,483 | $4,388 | 59 | $151,469 | $85,059 | $53,162 |
| Mixed weeks: a quiet week (10/day), a busy week (1,000/day) | $1,843 | $5,638 | $2,454 | $229 | $3,212 | 77 | $150,415 | $84,214 | $52,634 |
| Mixed months: a dead month (0-2/day), then a busy month (500/day) | $450 | $1,967 | $913 | $747 | $3,436 | 52 | $73,746 | $41,740 | $26,088 |
| Launch 1,000/day, fades to 5/day by month 4 | $1,903 | $27 | $27 | $21 | $4,038 | 49 | $21,701 | $12,527 | $7,829 |
| Starts at 300/day, fades to nothing by month 6 | $1,172 | $3 | $2 | $266 | $1,514 | 25 | $14,857 | $8,631 | $5,394 |
| Grows 10 -> 1,000 a day over the year | $78 | $468 | $5,432 | $321 | $5,691 | 48 | $64,450 | $33,855 | $21,159 |
| 200 a day, 2 empty weeks every 2 months | $1,125 | $1,359 | $993 | $654 | $1,470 | 39 | $46,005 | $25,822 | $16,139 |
