# Grading, cases and slabs

How a card's PDA grade works: a real card's condition, protected by a **Case**, revealed and sealed in a **Slab**.
The contract side is `FirePsa` (grading and casing), `FireCards` (each card's wear state) and `LiquidityBurner` (fees
become locked PAPER/PLANK liquidity, `docs/liquidity-burn.md`). Prices and pricing models are in `docs/omni-economy.md`.

## The idea

- **A card's condition is decided by public randomness when it is graded.** Nobody can know it before: not the site,
  not the metadata, not the owner. It is rolled from that grading's drand randomness, asked for after payment.
- **Grading reveals it.** The card gets its PDA grade (1-10) and is sealed in a **Slab** automatically. Slabs are
  final: no regrade.
- **Wear.** A card that sits uncased and ungraded wears with time and with every move between wallets.
- **Case.** The one way to protect a card. Casing freezes it: no more wear from time or moves. A card graded straight
  away needs no case.
- **Nothing you pay for raises your odds.** Cases and grading only protect or reveal what the card already has.

## Fresh odds

A card cased or graded within **24 hours** of opening (being dealt) grades from the fresh odds. They are built into
`FirePsa` as constants (`FRESH_5` ... `FRESH_10`, out of `ODDS_TOTAL` = 10,000; read them with `freshOdds()`): fixed
forever, the same for every Series, and nobody can change them. Fresh cards only grade **7-10**: grades 1-6 come
only from wear (time and moves).

Fresh odds (every Series):

| PDA 10 | PDA 9 | PDA 8 | PDA 7 |
|---|---|---|---|
| 3% | 30% | 40% | 27% |

Why: real factory flaws leave a pack-fresh card at 7-9 (below that takes handling damage), and our wear images show
white edges from PDA 5, so a fresh card never looks worn. A PDA 10 is a 1-in-33 chase card, but only for a card protected early: the floor only
covers a card protected in its first 24 hours; after that time and moves wear it as below, fast (owner, Oct 2026: case or
grade right away, like a real collector).

## Wear (fixed forever)

The wear rules are built into `FirePsa` as constants: the same for every Series, and nobody can change them.

1. **Fresh grade** `g0`: rolled from the fresh odds (7-10).
2. **Moves.** Each of the first 10 wallet-to-wallet moves of an uncased, ungraded card (sales and plain transfers;
   sending a card to your own wallet doesn't count)
   takes a grade off with a 20% chance. Moves alone never take a card below 5 (a draw that would is re-drawn, so the
   odds above 5 keep their shape).
3. **Time.** Time uncased after the first free 24 hours, `t` in years, takes `D` grades off, `D` drawn from a Poisson
   distribution with mean `6 x t^0.6`, read from a fixed table (below). A card can't go below 1. Wear starts the
   day after the free day and adds up every day.
4. **Low grades fade in.** Grades below 5 open slowly: PDA 4 from 1 month (fully open at 2 months), PDA 3 from 6 months
   (fully at 1 year), PDA 2 from 1 year (fully at 2 years), PDA 1 from 2 years (fully at 4 years). A card that would
   land on a grade that isn't fully open lands one higher with the missing share, and so on up. No overnight jumps:
   the odds change by less than 5 points on any day (the most, 4.5, is the first day after the free day).
5. **No 10 after 14 days.** A card uncased for more than 14 days since it was dealt (`NO_TEN_AFTER`) can't grade 10:
   that share grades 9. Until then a 10 gets rarer every day: 3% fresh, 2.3% on day 3, 1.8% on day 7, 1.3% on day 14.

Casing freezes the clock and the move count where they are. Grading freezes them at the moment it is asked for (the
randomness wait doesn't count).

What a card grades at (no moves; time uncased after the free first day; the same for every Series; percent, from
`python3 contracts/test/cards/wear-model.py`):

| Uncased for | 10 | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | Avg |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ≤ 24 hours | 3.0 | 30 | 40 | 27 | | | | | | | 8.1 |
| 1 week | 1.7 | 18 | 33 | 31 | 13 | 3.8 | | | | | 7.5 |
| 1 month | | 9.7 | 22 | 29 | 22 | 18 | | | | | 6.8 |
| 3 months | | 3.0 | 9.5 | 18 | 22 | 20 | 28 | | | | 5.7 |
| 6 months | | 0.9 | 3.5 | 8.7 | 15 | 18 | 54 | | | | 4.9 |
| 1 year | | 0.1 | 0.7 | 2.3 | 5.3 | 9.3 | 13 | 69 | | | 3.6 |
| 2 years | | | | 0.2 | 0.7 | 1.8 | 3.7 | 6.2 | 87 | | 2.2 |
| 3 years | | | | | 0.1 | 0.4 | 0.9 | 1.9 | 50 | 47 | 1.6 |
| 5 years | | | | | | | 0.1 | 0.2 | 0.4 | 99 | 1.0 |

By moves (cased right after): 1 move takes PDA 10 from 3% to 2.4%; 3 moves 1.5%; 5 moves 1.0%; 10 or more 0.3%
(average 6.4). Moves can take a fresh 7 down to 6 or 5: after 1 move 5.4% of cards are below 7, after 5 moves 30%.

**PDA 1 is a patience trophy:** only a card held uncased for years can get one. **PDA 10 needs a card protected
within 14 days**, and the sooner the better.

The odds model and its charts: `contracts/test/cards/wear-model.py` (the contract's table is generated from it, and a
test checks the contract against it).

## Case and Slab

- **Case:** buy any time before grading. Freezes the card. Shows as a clear top-loader over the card.
- **Slab:** every graded card, automatically, no extra cost. A thick clear block with a label: OMNI CARDS, the
  character, Series and material, the PDA grade in its colour and its word (GEM MINT, MINT, NM-MT, NEAR MINT, EX-MT,
  EXCELLENT, VG-EX, VERY GOOD, GOOD, POOR).
- **Why case instead of grading now:** sell it as a mystery (a cased, never-graded card keeps its chances through
  trades); hold the gamble until later; cheap protection in bulk; age a card on purpose, then freeze it.

## Images

Each card look has 12 finished images, all built by the studio before upload:
`c<character>-<type>-<holo>-<state>.webp`, state `u` (ungraded), `c` (cased) or `1`-`10` (slabbed, that grade's wear
frame and seal). The case and slab are drawn by the studio over the finished card, the same for every card. A card
switches images when it is cased or graded; nothing is drawn live.

## Metadata

- **Ungraded:** Cased (Yes/No), Dealt (the date the card was dealt: a `date` trait, unix seconds, which marketplaces
  show as a date), Moves, PDA "Ungraded". Once cased it adds **Age when cased (days)**, frozen. Every value is fixed,
  so the metadata never changes just because time passes. The condition is never shown.
- **Slabbed:** the PDA grade (the date, age and moves traits are gone).
- `Dealt` is kept even if a grading is cancelled (the wear clock then resumes from where it stopped; the date doesn't
  move). FireCards stores the deal time once, the first time a card's clock freezes (about 22k gas on that case or
  grading request).

## Prices

- **Case $0.05 per card**, flat. **Grading $1 per card** (`gradeUsd18`; not final until the last numbers audit): one
  grading price for every card, whatever its type. Set by the owner in dollars (`setPrices`), at most $100 a card.
- **What a batch costs:** `quote(cases, grades, pay)`, exactly what `protect` charges (cases x the case price + grades
  x the grading price, in `pay`, rounded up). Every purchase names the most it pays (`maxCost`, or the ETH sent).
- **Paid in PLANK, ETH or USDG.** `Pay`: PLANK 0, ETH 1, USDG 2 (the same numbers as `LiquidityBurner.Pay`). PAPER is
  not a payment option. **100% of every fee goes to `LiquidityBurner`**, none of it goes to us. The 100% is fixed in
  the contract. `LiquidityBurner.quote` prices it.
- **Every fee** goes to `LiquidityBurner` in the coin paid; nothing is swapped when a case or grading is paid, so
  there is nothing to wrap in a buy and a sell. Only the keepers can run `LiquidityBurner` (`run`): it buys PAPER or
  PLANK with what it holds, pairs matching dollar amounts into the PAPER/PLANK pool and burns the pool tokens; a side
  worth over $100 burns outright. A run is its own transaction, and Robinhood Chain's sequencer is first-come with no
  public mempool, so it can't be sandwiched either.
- Every buy must get at least 95% of what the price feeds say it is worth (else it tries half, a quarter and so on),
  and liquidity is added only while the pool's price is within 3% of the feeds'; otherwise the coins wait for a later
  run. A price missing, or a PAPER price from a window over 30 hours (a checkpoint after a keeper gap), makes it wait.
  `LiquidityBurner` has no withdraw, its router, tokens and pool are fixed, its price feeds are set once, and its
  routes may only pass through WETH, PLANK, USDG or PAPER.

## Grading requests

- `protect` stores a hash of the cards sent for grading, not the list (less gas per card). `finish(index, ids)` and
  `cancelGrading(index, ids)` take the list from the grading's `Protected` event (`graded`), in the same order.
- The owner can pause case and grading payments (`setPaused`); finishing and cancelling never pause.
- The randomness source can be switched at any time (only new gradings use it; each grading keeps its own:
  `docs/randomness.md`). There is no re-request; a grading with no answer 24 hours after its request (`CANCEL_AFTER`) can be
  cancelled (why 24 hours: `docs/randomness.md`).
- **Gas** (measured with `contracts/test/cards/PsaBurn.t.sol`, each call its own transaction): `finish` for 100
  fresh cards ~6.3M gas, for 100 worn cards (3+ years uncased, 10 moves) ~16.3M; `protect` sending 100 cards for
  grading ~8.3M (fresh) to ~7.4M (worn). `maxBatch` is 20 at launch (cap 100). Arbitrum Orbit chains
  like Robinhood Chain cap one transaction at 32M gas by default (confirm on the chain before raising `maxBatch`), so a
  full batch of the most worn cards still fits.

## Locks

| Fixed forever | Fixed per Series when its drop is set up | Owner can change (announced) |
|---|---|---|
| Fresh PDA odds and wear rules (time, moves, fade-in), the same for every Series; 24h fresh window, 100% of fees to liquidity, slabs final, cards per free pack 42, suggestion PAPER ceiling $1 | Recipe (card types, holo, the pack's slots and their odds), characters and their odds, dealer, card images, the drop's PAPER ceiling per pack | Case and grading prices (one grading price for every card), cards per grading batch, LiquidityBurner's routes and keepers, the randomness source (new gradings only), pause on case and grading payments (`setPaused`) |
