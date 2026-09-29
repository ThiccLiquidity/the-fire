# The Fire — v3 Spec (storm nights, persistent fire)

*September 26, 2026 (v3); updated Sep 29 2026 to match `contracts/src/Fire.sol`. Replaces v1 and v2. Numbers marked **fixed** are constants in the contract; numbers marked *set at launch* are chosen once at deploy and can't change after.*

---

## 1. The game, in one breath

> **Buy tickets with PAPER and PLANK. PAPER burns. All the PLANK goes into the fire's pot. Every ticket makes the fire bigger. Every day at 21:00 UTC (2:00 PM MST) a storm takes a bite out of it — keep it fed or it goes out. When it does, one ticket wins the pot.**

That's everything a player needs. The rest of this doc is the numbers behind it and the build.

---

## 2. Rules

### Tickets
- **1 ticket = a PAPER leg + $0.90 of PLANK.**
  - **PAPER leg:** 1 PAPER, or $0.33 worth if PAPER trades above $0.33 (`PAPER_USD_CAP`), from a ≥20h average price
    (`PaperUsdTwap`). Before PAPER has a market it's 1 PAPER. It moves at most 5% a day toward $0.33 worth, so it lags
    a rally: ~22 days to catch up with a 3× move above the cap, ~45 with a 10× move. Until then a PAPER-path ticket
    costs more than ~$1.23.
  - **PLANK leg:** $0.90 of PLANK at the big PLANK/WETH pool's ~30-minute average price × Chainlink ETH/USD
    (`PlankUsdTwap`, checkpointed by the keeper whenever `due()`), read live at every buy. A pump shows up in log prices
    within about an hour, so buyers don't overpay. A flash loan can't move it (it lasts one transaction and adds nothing
    to a time-weighted average); moving it means holding the pool off its price for half an hour against arbitrage.
    `PLANK_PER_TICKET0` (*set at launch*) is the price until the first 30-minute window closes; if the feed is broken or
    >2 days old, logs cost the last price the fire saw (`plankPerTicketLast`, refreshed every day).
- **No PAPER? Pay $1 instead.** The PAPER leg can be paid as **$1.00 of ETH** (Chainlink ETH/USD; the ETH path closes if
  the feed has missed its 24h heartbeat, i.e. is >25h old; the ETH price rounds up) or **$1.00 of USDG**. Same ticket,
  same PLANK. The dollar goes to the press fund. It's a convenience for outsiders, priced above where PAPER should trade.
- **Every buy names its max.** `buyTickets(n, maxPaper, maxPlank, note)`, `buyTicketsWithEth(n, maxPlank, note)` (the
  ETH sent is the max; anything above the price comes straight back), `buyTicketsWithUsdg(n, maxPlank, note)`. If a leg
  moved above what the buyer agreed to, the buy reverts (`PriceMoved`) instead of charging more.
- **Per buy: up to 10 tickets paid for. Per wallet per day: 500 tickets received.** **Free logs on a full throw of 10:**
  3 free on a fire's first day, 2 on its second, 1 after that (`FREE_DAY1/2`, `FREE_LATER`, `ticketsFor`). That's the
  only discount. Free logs count toward the 500/day cap and add no PLANK to the pot. The cap is per wallet, so it's a
  speed bump, not a hard limit.
- **Every ticket counts until the fire goes out.** No expiry, no decay. Buy on day 1 or day 19, same ticket.
- Buying is closed while a roll is pending (~35 s a day): drand's number is public a few seconds before it lands.

### Where the tokens go
| | Burned | Pot | Press fund |
|---|---|---|---|
| PAPER (ticket) | 100% | — | — |
| PLANK (ticket) | — | 100% | — |
| $1 in ETH or USDG (instead of PAPER) | — | — | 100% |

"Burned" = sent to `0x…dead`. No permission from any token contract needed.

### The pot
- Held in PLANK. **The fire is a PLANK bag that never sells.** If PLANK doubles, the pot doubles.
- When the fire goes out: **40% to the winner, 25% burned, 5% to the Paper Press royalty pool, 30% relights the next fire** (**fixed**). The winner keeps the whole 40%; the pool's share comes out of the pot, not the winner's prize. With no tickets at all, nothing burns and the whole pot carries into the next fire. **Prize cap:** the split is taken from the whole pot or from 5× what this fire's own tickets put in, whichever is smaller (`PRIZE_CAP_MULT`, `potCarriedIn`); the rest carries. So a small fire during a dry spell can't take 40% of a pot earlier fires (or the seed) built; once a fire's own tickets are a fifth of the pot, it pays the full 40%. The owner kept 5× (Sep 29), knowing the side effect: while the carry (or the seed) is at least 4× a fire's own PLANK, that fire's winner takes 2× what the fire's logs put in, so a lone buyer in a quiet fire comes out ahead (on the $250 seed, ~$50 of logs already wins $100).
- **The 5% goes to the Paper Press royalty pool** (PulpPool), which splits it across every live press each time a fire ends. One transfer to an address that already exists. *(Founder note: you hold a large bag, so you're the largest recipient of this share. It's the community's norm and there's no exploit, but say it out loud.)*

### The fire's size (this is the game)
- The fire has a **size, in tickets**. Every ticket bought adds one. This is what you see on screen: a fire worth 5 days of the community's normal buying is "full height" under the pot.
- **Overnight the fire burns down to 85% of its size.** A fire nobody feeds shrinks on its own; a fire people pile into grows and stays big.
- **Every day at 21:00 UTC a storm hits.** If the storm is at least as big as the fire, the fire's out and the drawing happens. Otherwise the storm's size comes off the fire and what's left (then ×0.85) is tomorrow's starting size.

### Storm nights
- **Night 1: no storm.** A new fire always gets its first night.
- **The storm ladder.** Every storm is one of 20 fixed sizes, in logs: 5, 8, 12, 19, 30, 47, 74, 115, 180, 283, 442, 693, 1,084, 1,698, 2,658, 4,161, 6,515, 10,199, 15,968, 25,000 (`STORM_LOGS`). Storms never grow. What changes with the fire's age is the **odds**: night 2 draws mostly 5-30 log storms, and the likely size moves up 0.75 of a rung each night (a bell curve over the rungs, width 2.5; `STORM_ODDS`, the running odds out of 10,000 for nights 2-23). By night 12 most storms are 180-1,000 logs, by night 16 half are 1,700+, by night 23 almost all are. The rung is picked by `word % 10,000`. Because storms are real log counts, volume is what matters: a 10-a-day fire lives ~3 nights, 100 a day ~9, 1,000 a day ~17, 3,000 a day ~20. The fire and the storm are counted in thousandths of a log (`fireSizeMilli`). `sim/fire_sim.py` builds the table (`storm_ladder()`) and mirrors the contract exactly; `test/FireSimParity.t.sol` checks every rung and 600 nights (results: `docs/fire-sim.md`).
- **Night 24: the storm is infinite.** No fire survives it.
- The randomness comes from drand through our ownerless `OpenDrandRouter` (see `docs/randomness.md`); one request per night decides the storm and, if the fire dies, the winner. Nobody, including us, knows the roll in advance.
- The site never shows the number. The sky is the forecast: clearer or darker, "light rain possible" vs "a monster is rolling in." You feel the danger; you don't compute it.

**Simulated in `sim/fire_sim.py`** (150 years per buying pattern, `docs/fire-sim.md`): fire life follows volume. Under ~10 logs a day fires go out in 2-3 nights; 100 a day, ~9 nights (half reach 10); 300 a day, ~13; 1,000 a day, ~17 (90% reach 15); 3,000 a day, ~20; 10,000+ a day reaches night 24. Low volume doesn't linger; high volume can go deep, never forever.

### The drawing
- When the fire goes out, the same random number picks one ticket, weighted by count. Winner is paid in PLANK in the same transaction. If that transfer fails (the token refuses the address), the prize is kept for them: `unclaimed[winner]`, collected with `claim(to)` to any address. A failed royalty or burn transfer carries into the next pot. Fires go by number; no naming.

### If randomness dies
- A roll with no answer for **2 hours** can be re-rolled by anyone, only while drand has no result for it.
- A roll stuck for **7 days**, counted from that day's first `roll()` (rerolls don't restart it), lets anyone call `abandon()`: the game ends for good, buys and rolls stop, and each ticket holder of the current fire calls `refund()` for pot × their tickets ÷ total. With no tickets, the pot burns. The press fund keeps working.

### The press fund
- The $1s paid in ETH or USDG accumulate, each on its own side (no swaps). The fire **bids for a press in USD**: the bid starts at `MILL_BID_BASE` (*set at launch*), climbs 25% of its start per day (~1%/hour) while nobody sells — only while the fund could pay it, never above the fund's value, never past 3× its start. After each purchase it restarts at 90% of the price paid (never below `MILL_BID_BASE`/10).
- The bid is a standing offer: anyone can fill it with any Seaport listing (their own included) at or under the bid, via `eatMillFromSeaport`. The fire pays the listing's own price in its own currency (USDG at face value, ETH at the Chainlink price), then **burns the press in the same transaction**; the PLANK inside (~88.8B, ~$94 today) goes to the **Paper Press royalty pool** — every remaining press gets paid, emission drops forever. Any ETH attached above the press's burn fee comes back. The keeper sweeps OpenSea listings.
- The fire never sells PLANK or PAPER to do this. It only spends the dollars outsiders chose to bring.
- It never takes a press any other way: a press safe-sent to it bounces.

---

## 3. What the simulation says

**Superseded.** This table is from `sim/economy.py`, which models the old rules (fire keeps 60%, the 32-point luck
storm, 50% of ticket PLANK burned, buy 10 get 1 free). It does not match the contract. Current numbers:
`sim/fire_sim.py` → `sim/fire_sim_results.json` / `docs/fire-sim.md` (fire life) and `sim/pot_sim_results.json` /
`docs/pot-sim.md` (pots, $250 seed, 5× cap); see `docs/HANDOFF.md` #28 and #33. Kept for history: 324 year-long runs,
full tables in `docs/sim-results.md`. Prices held flat: PLANK $1.056e-9, ETH $3,333, PAPER $0.25. 1,000 presses, 5 outsiders/day, $300 press floor:

| Participation (share of daily PAPER spent) | Tickets/day | Fire life (min–max) | Pot median / max | PLANK burned/yr | Share of PAPER printed that burns |
|---|---|---|---|---|---|
| low (25/18/10%) | 549 | 10.0 (3–17) | $3,347 / $6,425 | $116k | 50% |
| medium (50/40/30%) | 788 | 9.6 (5–14) | $4,665 / $7,266 | $167k | 74% |
| high (75/65/55%) | 962 | 9.5 (5–14) | $5,508 / $8,582 | $205k | 91% |

Things worth knowing:
- **The participation numbers are guesses.** Plan on the low row at launch and quote those numbers publicly.
- **Fire life follows volume** (storm ladder, Sep 28): bigger communities build bigger fires that last longer. The table
  above predates the ladder; see `docs/fire-sim.md` and `docs/pot-sim.md` for current numbers.
- **Rallies are what make legends.** A community that saves a fire on night 9 has just built a monster pot for night 10.
- **The ramp matters.** Pure random storms with no age ramp kill the fire every ~3 nights. Random *with* the ramp gives
  both: freak early storms and old fires that feel doomed.
- **PLANK demand is large relative to the market.** At medium participation the game burns ~18% of PLANK's supply a
  year at today's price. The sim holds prices flat; reality won't. PLANK up → the $0.90 leg needs fewer PLANK and the
  pot grows in dollars.
- **The press fund is outsider-driven.** 5 outsiders/day (~$11k/yr) eats ~37 presses a year at a $300 floor, ~13 at the
  ~$786 listings seen so far, ~110 at $100. No outsiders, no presses eaten.
- **Small holders under-buy** because a 1–3 press wallet prints less than a ticket a day. They play by saving up or in
  rallies. Show "N days until your next ticket" on the site.
- Overall, players get back well under a dollar per dollar (the old sim said ~22¢; not re-run on the current rules). It's a burn game; that's the design. Exception: the 5× prize cap lets a quiet fire win 2× its own PLANK out of a big carry or the seed (see *The pot*).

---

## 4. Launch numbers

| Parameter | Value |
|---|---|
| Ticket | PAPER leg + $0.90 of PLANK (live, ~30-min pool average); PAPER leg moves ≤5%/day toward $0.33 worth |
| PAPER leg | min(1 PAPER, $0.33 worth) from `PaperUsdTwap`; 1 PAPER until PAPER has a market |
| PLANK leg | $0.90 at `PlankUsdTwap` (30-min window), read at every buy; `PLANK_PER_TICKET0` until the first window closes; last price seen if the feed breaks |
| Instead of PAPER | $1.00 of ETH (Chainlink ETH/USD, closed if >25h old) or $1.00 of USDG |
| Max price | every buy names its max PAPER/PLANK (ETH: msg.value, excess refunded); reverts `PriceMoved` above it |
| Per buy / per day | 10 paid / 500 received per wallet; a throw of 10 gets 3 / 2 / 1 free logs (fire's day 1 / 2 / 3+) |
| PLANK split | 100% pot (PLANK burns only at payout, 25%) |
| Payout | 40% winner / 25% burn / 5% Paper Press royalty pool / 30% relight, taken from min(pot, 5× this fire's own PLANK); no tickets → the whole pot carries |
| Storm time | 21:00 UTC (2:00 PM MST), daily; the site shows it on each player's own clock |
| Fire size | persistent; +1 per log; ×0.85 overnight; thousandths of a log |
| Storm | a fixed ladder of 20 sizes, 5-25,000 logs; odds per night tilt up 0.75 rung a night; `word % 10,000`; out if storm ≥ fire (ties go out); night 1 none; night 24 infinite |
| Randomness | `OpenDrandRouter` (drand evmnet, round 30–33 s ahead, anyone fulfills); reroll after 2h; abandon 7 days after that day's first roll |
| Press fund | 100% of the ETH/USDG; USD bid from `MILL_BID_BASE` (*set at launch*), +25%/day of its start, ≤3×, ≤ fund; restarts at 90% of price paid |
| Founder seed | $250 of PLANK (`SEED_PLANK`, deployer only, once, before the first storm); ~$10 of ETH for the keeper wallet |

---

## 5. Build

**Contracts** (no owner anywhere; nothing to configure after deploy)
- `Fire.sol` — the game. `buyTickets(n, maxPaper, maxPlank, note)`, `buyTicketsWithEth(n, maxPlank, note)`,
  `buyTicketsWithUsdg(n, maxPlank, note)`, `roll()`, `reroll()`, `abandon()`, `refund()`, `claim(to)`,
  `eatMillFromSeaport(order, extraData)`, `pokeMillBid()` — all permissionless. No pause, no withdraw, no admin.
  Tickets are stored as cumulative ranges per buy, so the winner is found by binary search.
- Every input is immutable, so the constructor refuses a feed, token or randomness address with no code, zero prices,
  a roll time ≥ 1 day, and an adapter whose `FIRE()` isn't this Fire. `Deploy.s.sol` checks the rest before sending.
- Feed reads can't revert the daily roll: a stale or broken feed only makes a leg hold.
- `OpenDrandRouter` + `OpenVRFAdapter` — drand randomness, open fulfillment (`docs/randomness.md`). Never
  blockhash/prevrandao: the sequencer can grind it.
- `PlankUsdTwap` (30-minute TWAP; follows the pool within about an hour) and `PaperUsdTwap` (≥20h TWAP), anyone
  checkpoints. The PAPER feed finds PAPER's pool by itself: a pool needs $1,000 on its dollar side, becomes a candidate, and is adopted only if it qualifies at every checkpoint for
  20h, so a flash loan can't force a switch. No adopt or switch while the ETH feed is stale.
- `Profiles.sol` — a name and a picture per wallet.
- `ops/keeper` rolls, delivers drand's number, recovers stuck rolls, checkpoints both feeds and sweeps the press floor.
  Anyone can do each of those; the site shows a button for the storm steps.

**Site (one screen)**
- **The fire.** Canvas scene: a fire in the woods, fixed camera, height = fire size. Paper and logs fly in on every buy; burn notes drift up through the flames. Real day/night cycle on the player's own clock.
- **The sky.** Clouds gather over the 3 hours before the storm (21:00 UTC, shown on the player's own clock) and the forecast card reads the threat in words, never numbers. At storm time: clouds roll in, lightning flickers inside them (bolts on big storms), real thunder recordings (nine CC0 clips, distant ones muffled and delayed, close ones with a clap), then rain — angled, layered, with splashes. The fire is beaten down to what's left. If it dies: smoke, dark, the winner lights up.
- **Numbers:** pot in PLANK and $, nights survived, fire size, your tickets and odds, your PAPER and PLANK balances and how many tickets they buy, PAPER/PLANK burned all-time, presses eaten.
- **Buy panel:** 1 / 5 / 10 / Max. Pay with PAPER, ETH or USDG; a "You pay" line shows exactly what leaves the wallet; exact token approvals; the buy carries the price the buyer saw as its max. OpenSea link with a hover explainer for mills.
- **Feed:** a one-line ticker under the fire, not a wall. Notes drift over the flames instead.
- **Archive:** every fire recorded — nights survived, peak size, pot, winner, storm replay.
- **Share cards** auto-generated at every storm (21:00 UTC), and on every death.
- Art: stick-figure world. PAPER is kindling, PLANK is logs, an umbrella guy shows up when it rains.

---

## 6. Rejected (so we don't relitigate)
- Second token (OJ), blind commit-reveal showdown, floating ratios — too much to explain.
- Holding anyone's presses (parking, sacrifice) — a press the fire buys is burned in the same transaction.
- Any rule that sells PLANK or PAPER — the fire only ever buys presses with the dollars outsiders brought.
- Pyro mode (PLANK with no ticket) — removed.
- A pause, an owner, a launch cap on fire #1 — none exist; the 7-day abandon/refund is the only exit.
- Fixed 3-day rounds — replaced by storm nights (kills last-minute sniping without an anti-cheat rule).
- Pot-proportional minimums, extending timers, bonding-curve ticket prices, "1% a day" yields.
- Claim deadlines / let-it-ride — unnecessary once the ending is random.

## 7. Still to settle
1. ~~Plank Press admin calls `PulpPool.addRewardToken(PLANK)`~~ Done per the owner (Sep 28); confirm PLANK is on the
   PulpPool reward list on the explorer on deploy day.
2. PAPER contract address (Oct 1 2026).
3. `MILL_BID_BASE`: the starting press bid — the owner's number, set on deploy day (default: the OpenSea floor at launch).
   Listings so far are $786+ with no real market yet; the PLANK inside a press is ~$94, and ~$90 has been suggested.
4. Community swap aggregator embed URL. OpenSea: opensea.io/collection/the-plank-press.
5. Name/domain.
