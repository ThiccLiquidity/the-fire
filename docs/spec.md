# The Fire — v2 Spec (storm nights)

*September 26, 2026. Replaces the v1 spec. Everything here was chosen in conversation today and checked against the simulation in `sim/fire_v2.py`. Numbers marked **fixed** don't change after launch; numbers marked *set at launch* are chosen once.*

---

## 1. The game, in one breath

> **Buy tickets with PAPER and PLANK. PAPER burns. Half the PLANK burns, half feeds the fire. Every night a storm rolls in — a big fire survives, a small one dies. When the fire goes out, one ticket wins the pot.**

That's everything a player needs. The rest of this doc is the numbers behind it and the build.

---

## 2. Rules

### Tickets
- **1 ticket = 1 PAPER + 10,000,000 PLANK** (**fixed**, in tokens, never repriced). ~$0.94 of PLANK today; PAPER's fair value is ~$0.20–0.40, so the two legs start close. If prices drift, the ticket leans toward whichever token got expensive, which is self-correcting: whoever's short on the pricey leg has to buy it.
- **No PAPER? Buy it from the fire with ETH.** Same ticket, the PAPER leg replaced by *set at launch* **~$1.00 in ETH** (fixed ETH amount, no oracle). Priced deliberately 3–5× above where PAPER should trade so it's a convenience for outsiders, not a replacement for buying real PAPER. This is not a token — it's just a second checkout path. Optional later: ratchet ±5%/fire based on how much it sells.
- **Bundles:** 10 tickets for the price of 9, 100 for the price of 80, 1,000 for the price of 700. Same PAPER:PLANK ratio at every tier. Bulk buyers get up to 43% more odds per dollar — normal for a raffle; don't go steeper. Sim: bundle discounts barely change who wins (whales' return per dollar ends up within a few points of small holders').
- **Every ticket counts until the fire goes out.** No expiry, no decay. Buy on night 1 or night 19, same ticket.
- **Stoke:** throw PLANK with no ticket. 50% burns, 50% to the pot. For people who just want a bigger fire.

### Where the tokens go
| | Burned | Pot | Mill fund |
|---|---|---|---|
| PAPER (ticket) | 100% | — | — |
| PLANK (ticket or stoke) | 50% | 50% | — |
| ETH ("buy paper from the fire") | — | — | 100% |

"Burned" = sent to `0x…dead`. No permission from any token contract needed.

### The pot
- Held in PLANK. **The fire is a PLANK bag that never sells.** If PLANK doubles, the pot doubles.
- When the fire goes out: **40% to the winner, 30% burned, 30% relights the next fire** (**fixed**). Sim: 40/30/30 grows the next fire ~4× faster than 50/25/25 at the same burn.
- **5% of the winner's slice goes to the Paper Mill royalty pool** — every mill holder gets PLANK every time a fire ends. One transfer to an address that already exists. *(Founder note: you hold a large bag, so you're the largest recipient of your own contract's tithe. It's the community's norm and there's no exploit, but say it out loud.)*

### Storm nights
- **Night 1: no storm.** The fire always survives its first night.
- Every night after, at a fixed time (**8:00 PM Arizona**), the storm rolls:
  - Fire size = tickets bought in the last 24 hours (all paths).
  - Storm strength = a random number, drawn from a range that **grows with the fire's age**. On average, a storm on night N is about **N/8 × the community's recent daily volume** (7-night trailing average), with wide randomness — a night-3 storm can occasionally be a monster, a night-12 storm can occasionally be a breeze.
  - **Fire size ≥ storm → survives.** Otherwise it goes out and the drawing happens.
- **Night 24: the storm is infinite.** No fire survives it. (*set at launch*; 24 is the cap that gives "24 hours to 24 days".)
- The forecast is public all day: "Tonight's storm: 400–900 tickets." That's what makes the rally ("we need 300 more before 8") a thing.
- Scaling the storm to the community's own trailing volume means the game balances itself at 1,000 mills or 5,000, and after mills get eaten.

### The drawing
- When the fire goes out, one random number (the same VRF request that rolled the storm) picks one ticket. Winner is paid in PLANK, same transaction. No claim step.
- Winner gets to name the next fire (a text field; cosmetic).

### The mill fund
- ETH from "buy paper from the fire" accumulates. When it can afford the floor mill, the fire **buys it and burns it in one transaction**. The ~800M PLANK inside goes to the **royalty pool** — every remaining mill gets paid, emission drops forever.
- The fire never sells PLANK or PAPER to do this. It only spends ETH outsiders chose to bring.
- Build detail still open: which marketplace mills trade on (a Seaport-style contract is a clean call; if not, the fire posts its own standing WETH bid — same result).

### Death
- The fire only ends by storm. There's no zero-ticket death rule because a night with zero tickets loses to any storm anyway.

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
| Ticket | 1 PAPER + 10M PLANK (fixed) |
| ETH paper | ~$1.00 in ETH per ticket, fixed ETH amount set at launch |
| Bundles | 10 / 100 / 1,000 at 0.9 / 0.8 / 0.7 per ticket |
| PLANK split | 50% burn / 50% pot |
| Payout | 40% winner / 30% burn / 30% relight |
| Tithe | 5% of winner slice → royalty pool |
| Storm time | 8:00 PM America/Phoenix, nightly |
| Storm base | night N: N/8 × 7-night trailing avg daily tickets; night 1 none; night 24 infinite |
| Storm noise | lognormal σ = 0.55 |
| Mill fund | 100% of ETH; buys floor mill when affordable; PLANK inside → royalty pool |
| Founder seed | $0 opening pot needed. $200 → first PLANK feed to light fire #1 (PLANK, so it's a real pot from minute one); $50 gas/randomness reserve |

---

## 5. Build

**Contracts**
- `Fire.sol` — state: current fire (id, night, pot, tickets ledger as cumulative ranges per buyer for O(1) winner lookup), trailing volume, mill fund balance. Functions: `buyTickets(n)`, `buyTicketsWithEth(n)`, `stoke(plankAmount)`, `roll()` (permissionless, callable once per night window after the randomness lands), `eatMill()` (permissionless once fund ≥ floor). No admin functions after launch except a 48-hour-timelocked pause that refunds nothing (there's nothing to refund — tickets are burns).
- Randomness: **no Chainlink VRF on Robinhood Chain.** Use Gelato VRF (drand-backed, built for Orbit chains), fallback Pyth Entropy, fallback self-relayed drand. Never blockhash/prevrandao — the sequencer can grind it. One request per night: it decides the storm and, if the fire dies, the winner.
- Nightly roll runs on a keeper (Gelato Automate or our own cron); anyone can also call it.
- Security path: testnet → mainnet with fire #1 capped at 3 nights → bug bounty in PLANK → audit before removing caps.

**Site (one screen)**
- **The fire.** Sized by the last 24h of tickets. Flares when a buy lands (every purchase pushes a "stoke" animation with the buyer's title and note). Shrinks visibly through a quiet afternoon.
- **The sky.** Forecast card all day: "Tonight's storm: 400–900." Clouds gather toward 8pm. At 8pm: clouds roll by (fire roars, "NIGHT 7 SURVIVED") or rain (hiss, smoke, dark screen, then the winner's address lights up and the payout plays).
- **Numbers:** pot in PLANK and $, nights survived, tickets today vs forecast, your tickets and your odds, PAPER burned and PLANK burned all-time, mills eaten, "N days until your next ticket" for small holders.
- **Buttons:** Buy tickets (PAPER+PLANK) · Buy paper from the fire (ETH+PLANK) · Stoke · one-click PLANK swap via the chain's DEX.
- **Feed:** every buy with a 32-character note ("gm from 1 mill"), cosmetic titles by lifetime thrown (Kindling, Paper Boy, Lumberjack, Arsonist, Fire Marshal for 10 straight nights).
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
1. Which marketplace mills trade on (decides how the fire buys the floor).
2. Confirm Gelato VRF or Pyth Entropy is live on Robinhood Chain before contract work.
3. Exact ETH amount for "paper from the fire" (set on launch day from ETH price).
4. Name/domain. "The Fire" works; "BONFIRE" was suggested.
