# The Fire — v3 Spec (storm nights, persistent fire)

*September 26, 2026 (v3, evening). Replaces v1 and v2. Everything here was chosen in conversation today and checked against the simulation in `sim/fire_v2.py`. Numbers marked **fixed** don't change after launch; numbers marked *set at launch* are chosen once.*

---

## 1. The game, in one breath

> **Buy tickets with PAPER and PLANK. PAPER burns. Half the PLANK burns, half feeds the fire. Every ticket makes the fire bigger. Every night a storm takes a bite out of it — keep it fed or it goes out. When it does, one ticket wins the pot.**

That's everything a player needs. The rest of this doc is the numbers behind it and the build.

---

## 2. Rules

### Tickets
- **1 ticket = 1 PAPER + 10,000,000 PLANK** (**fixed**, in tokens, never repriced). ~$0.94 of PLANK today; PAPER's fair value is ~$0.20–0.40, so the two legs start close. If prices drift, the ticket leans toward whichever token got expensive, which is self-correcting: whoever's short on the pricey leg has to buy it.
- **No PAPER? Buy it from the fire with ETH.** Same ticket, the PAPER leg replaced by *set at launch* **~$1.00 in ETH** (fixed ETH amount, no oracle). Priced deliberately 3–5× above where PAPER should trade so it's a convenience for outsiders, not a replacement for buying real PAPER. This is not a token — it's just a second checkout path. Optional later: ratchet ±5%/fire based on how much it sells.
- **Per buy: up to 10 tickets. Per wallet per day: 500.** A full 10 is 3% off; that's the only discount, so a whale's built-in edge is 3%. The 500 cap forces big buyers to spread over days, which is what makes rallies and streaks a community thing.
- **Priced in dollars, not tokens.** The PAPER leg is 1 PAPER. The ETH leg ("paper from the fire") is $1.00 of ETH via a price feed. The PLANK leg targets $0.90 of PLANK and ratchets at most 5% per night toward that target, so a pump or dump moves it over days, not minutes — a thin pool can't be gamed inside a night.
- **Every ticket counts until the fire goes out.** No expiry, no decay. Buy on night 1 or night 19, same ticket.
- **Pyro mode:** throw PLANK with no ticket. 50% burns, 50% to the pot. Labeled loudly as "you get nothing for this." It's a joke and a burn, not a strategy.

### Where the tokens go
| | Burned | Pot | Mill fund |
|---|---|---|---|
| PAPER (ticket) | 100% | — | — |
| PLANK (ticket) | 50% | 50% | — |
| ETH ("buy paper from the fire") | — | — | 100% |

"Burned" = sent to `0x…dead`. No permission from any token contract needed.

### The pot
- Held in PLANK. **The fire is a PLANK bag that never sells.** If PLANK doubles, the pot doubles.
- When the fire goes out: **40% to the winner, 30% burned, 30% relights the next fire** (**fixed**). Sim: 40/30/30 grows the next fire ~4× faster than 50/25/25 at the same burn.
- **5% of the winner's slice goes to the Paper Mill royalty pool** — every mill holder gets PLANK every time a fire ends. One transfer to an address that already exists. *(Founder note: you hold a large bag, so you're the largest recipient of your own contract's tithe. It's the community's norm and there's no exploit, but say it out loud.)*

### The fire's size (this is the game)
- The fire has a **size, in tickets**. Every ticket bought adds one. This is what you see on screen: a fire worth 5 days of the community's normal buying is "full height" under the pot.
- **Overnight the fire burns down to 60% of its size.** A fire nobody feeds shrinks on its own.
- **Every night at 8:00 PM Arizona a storm hits and subtracts its strength from the size.** If the size hits zero, the fire's out and the drawing happens. Otherwise what's left (then ×0.6) is tomorrow's starting size.

### Storm nights
- **Night 1: no storm.** A new fire always gets its first night.
- **Storm strength = (the community's 7-night average daily buys) × ((night − 1) / 8)^1.5 × luck.** The first factor makes it self-scaling — the same game at 100 tickets a day or 5,000. The middle factor is the age curve: night 2's average storm is ~4% of a day's buys, night 5 is ~35%, night 9 is a full day, night 17 is nearly three days. **Luck is a random draw** (lognormal, σ = 0.9): a gentle night is a fifth of average, a brutal one is five times. Storms are random, not a ramp — the *odds* shift with age.
- **Night 24: the storm is infinite.** No fire survives it.
- The randomness comes from OpenVRF (drand); one request per night decides the storm and, if the fire dies, the winner. Nobody, including us, knows the roll in advance.
- The site never shows the number. The sky is the forecast: clearer or darker, "light rain possible" vs "a monster is rolling in." You feel the danger; you don't compute it.

**Tuned in `sim/storm_v3.py`** (4,000 simulated nights per setting). With normal feeding: fires live **4–21 nights, average ~10**; **none die in their first 3 nights**, 2% by night 5; half reach night 10; 5% reach night 15; night 20+ is rare. A neglected fire (30% of normal buys) lasts about 6. Rallies extend life and are what build the big pots. Identical at any community size.

### The drawing
- When the fire goes out, one random number (the same VRF request that rolled the storm) picks one ticket. Winner is paid in PLANK, same transaction. No claim step.

### The mill fund
- ETH from "buy paper from the fire" accumulates. When it can afford the floor mill, the fire **buys it and burns it in one transaction**. The ~800M PLANK inside goes to the **royalty pool** — every remaining mill gets paid, emission drops forever.
- The fire never sells PLANK or PAPER to do this. It only spends ETH outsiders chose to bring.
- The fire buys the floor listing on OpenSea (Seaport). It never accepts a mill from anyone directly.

### The drawing, cont.
- When the fire goes out, the same random number picks one ticket, weighted by count. Paid in PLANK in the same transaction. Fires go by number; no naming.

---

## 3. What the simulation says (1,000 mills, one year, 6 seeds each)

| Scenario | Fires/yr | Avg life (min–max) | Pot at end (median / max) | PAPER burned ÷ minted | PLANK burned/week | Mills eaten/yr |
|---|---|---|---|---|---|---|
| Baseline (people spend ~30–50% of PAPER, some rally, 5 outsiders/day) | 47 | 7.7 nights (2–17) | $2,800 / $15,700 | 0.67 | ~$3,100 | 167 |
| Low participation | 48 | 7.5 (3–17) | $1,400 / $11,600 | 0.38 | ~$1,900 | 160 |
| Worst case (low participation, nobody rallies, no outsiders) | 47 | 7.6 (4–11) | $1,100 / $1,550 | 0.22 | ~$1,000 | 0 |
| 2,000 mills | 47 | 7.6 (3–18) | $5,500 / $42,000 | 0.72 | ~$6,700 | 178 |
| 20 outsiders/day | 48 | 7.4 | $3,300 / $15,300 | 0.77 | ~$3,900 | 697 |

Things worth knowing:
- **The baseline participation is a guess and probably optimistic.** It assumes whales spend ~50% of daily PAPER on tickets, mids ~40%, smalls ~30%, plus rallies and 5 outsiders/day. Here is the same game if that's wrong:

| Share of PAPER spent on tickets | Tickets/day | Typical pot | Best pot of year | PLANK burned/week |
|---|---|---|---|---|
| 30–50% (baseline) | ~750 | $2,800 | $15,700 | ~$3,100 |
| 15–25% | ~390 | $1,200 | $13,000 | ~$1,600 |
| 8–12% | ~135 | $500 | $2,500 | ~$580 |
| 3–5%, no rallies, no outsiders | ~24 | $120 | $160 | ~$110 |

  The game doesn't break at low participation — fires still last a week, the storm scales to actual volume, and there's no liability since tickets are burns. It just gets smaller. **Plan on the 8–25% band at launch**; quote those numbers publicly, not the baseline.
- **Rallies are what make legends.** With nobody rallying, the biggest fire of the year is ~$3,700. With normal rally behaviour it's ~$15,700, because a community that saves a fire on night 9 has just built a monster pot for night 10.
- **The ramp matters.** Pure random storms with no age ramp (your "random every day" taken literally) kill the fire every ~3 nights and it never lives long enough to matter. Random *with* a ramp gives both: freak early storms and old fires that feel doomed. Recommended randomness: wide (lognormal σ≈0.5–0.6) on top of the N/8 ramp.
- **Ticket price sets the pot.** At 5M PLANK per ticket the median pot is ~$1,300; at 10M ~$2,800; at 20M ~$6,000. 10M is the pick: under a dollar a ticket, pots in the thousands.
- **PLANK demand is large relative to the market.** ~$3k/week of PLANK burned is ~20% of today's market cap per year, on top of ~$3k/week locked in pots. The sim holds prices flat; reality won't. Expect PLANK to move, which grows the pot in dollars and raises the ticket price — a feedback loop the sim can't price. Treat the dollar figures as "at today's prices."
- **Small holders under-buy** because a 1–3 mill wallet prints less than a ticket a day. They play by saving up a few days or via rallies. Show "N days until your next ticket" on the site.
- Players get back ~20¢ per dollar spent in expectation. It's a burn game; that's the design. The upside is PAPER and PLANK scarcity and the occasional four-figure pot.

`sim/sweep_v2.py` runs all of it.

---

## 4. Launch numbers

| Parameter | Value |
|---|---|
| Ticket | 1 PAPER + $0.90 of PLANK (PLANK leg ratchets ≤5%/night toward target) |
| ETH paper | $1.00 of ETH per ticket, via ETH/USD feed (reverts if stale >1h) |
| Per buy / per day | 10 / 500 tickets; a full 10 is 3% off |
| PLANK split | 50% burn / 50% pot |
| Payout | 40% winner / 30% burn / 30% relight |
| Tithe | 5% of winner slice → royalty pool |
| Storm time | 8:00 PM America/Phoenix, nightly |
| Fire size | persistent; +1 per ticket; ×0.6 overnight |
| Storm | trailingAvg × ((N−1)/8)^1.5 × lognormal(0, 0.9); night 1 none; night 24 infinite |
| Storm luck | 32-point quantile table of lognormal(0, 0.9), picked by the random word |
| Mill fund | 100% of ETH; buys floor mill when affordable; PLANK inside → royalty pool |
| Founder seed | $0 opening pot needed. $200 → first PLANK feed to light fire #1 (PLANK, so it's a real pot from minute one); $50 gas/randomness reserve |

---

## 5. Build

**Contracts**
- `Fire.sol` — state: current fire (id, night, pot, tickets ledger as cumulative ranges per buyer for O(1) winner lookup), trailing volume, mill fund balance. Functions: `buyTickets(n)`, `buyTicketsWithEth(n)`, `roll()` (permissionless, callable once per night window after the randomness lands), `eatMill()` (permissionless once fund ≥ floor). No admin functions after launch except a 48-hour-timelocked pause that refunds nothing (there's nothing to refund — tickets are burns).
- Randomness: **no Chainlink VRF on Robinhood Chain.** Use Gelato VRF (drand-backed, built for Orbit chains), fallback Pyth Entropy, fallback self-relayed drand. Never blockhash/prevrandao — the sequencer can grind it. One request per night: it decides the storm and, if the fire dies, the winner.
- Nightly roll runs on a keeper (Gelato Automate or our own cron); anyone can also call it.
- Security path: testnet → mainnet with fire #1 capped at 3 nights → bug bounty in PLANK → audit before removing caps.

**Site (one screen)**
- **The fire.** Canvas scene: a fire in the woods, fixed camera, height = fire size. Paper and logs fly in on every buy; burn notes drift up through the flames. Real day/night cycle on the Arizona clock.
- **The sky.** Clouds gather as 8pm approaches and the forecast card reads the threat in words, never numbers. At 8pm: clouds roll in, lightning flickers inside them (bolts on big storms), real thunder recordings (nine CC0 clips, distant ones muffled and delayed, close ones with a clap), then rain — angled, layered, with splashes. The fire is beaten down to what's left. If it dies: smoke, dark, the winner lights up.
- **Numbers:** pot in PLANK and $, nights survived, fire size, your tickets and odds, your PAPER and PLANK balances and how many tickets they buy, PAPER/PLANK burned all-time, mills eaten.
- **Buy panel:** 1 / 5 / 10 / Max (Max = smallest of what you can afford, 10, and what's left of your 500). Two clearly separate paths: "With your PAPER" and "No PAPER? Buy paper from the fire" (ETH, premium spelled out). OpenSea link with a hover explainer for mills. Pyro mode behind a red PYRO tag with an "I understand I get nothing" checkbox. Swap aggregator embed (community's, TBD).
- **Feed:** a one-line ticker under the fire, not a wall. Notes drift over the flames instead.
- **Archive:** every fire named and recorded — nights survived, peak size, pot, winner, storm replay. "The October fire lasted 17 nights and paid $3,900."
- **Share cards** auto-generated at 8pm every night, and on every death.
- Art: stick-figure world. PAPER is kindling, PLANK is logs, ETH buyers are "buying paper from the fire," an umbrella guy shows up when it rains.

---

## 6. Rejected today (so we don't relitigate)
- Second token (OJ), blind commit-reveal showdown, floating ratios — too much to explain.
- Holding anyone's mills (parking, sacrifice, sell-to-fire) — never be a middleman for someone's PLANK.
- Any rule that sells PLANK or PAPER — the fire only ever buys mills with ETH outsiders brought.
- Fixed 3-day rounds — replaced by storm nights (kills last-minute sniping without an anti-cheat rule).
- Pot-proportional minimums, extending timers, bonding-curve ticket prices, "1% a day" yields.
- Claim deadlines / let-it-ride — unnecessary once the ending is random.

## 7. Still to settle
1. Mills trade on OpenSea (Seaport — the fire fills the floor listing directly; it never takes a mill from anyone). Mill contract `0x8daa…dfc9`, PLANK `0x6942…2DDc`. Still to confirm from the mill contract: a contract can hold and burn one, and where the royalty pool lives.
2. OpenVRF router address on Robinhood Chain (repo found; address to pin).
3. A PLANK/USD price source for the ratchet — our own TWAP adapter over the main pool, updated by anyone.
4. Community swap aggregator embed URL (waiting on a DM). OpenSea: opensea.io/collection/the-plank-press.
6. Name/domain.
