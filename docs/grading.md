# Grading, cases and slabs

How a card's PDA grade works: a real card's condition, protected by a **Case**, revealed and sealed in a **Slab**.
The contract side is `FirePsa` (grading and casing), `FireCards` (each card's wear state) and `PaperBurner` (fees buy
and burn PAPER). Prices and pricing models are in `docs/omni-economy.md`.

## The idea

- **Every card has a hidden condition.** Nobody can see it: not the site, not the metadata, not the owner. It is
  rolled when the card is graded, from that grading's drand randomness.
- **Grading reveals it.** The card gets its PDA grade (1-10) and is sealed in a **Slab** automatically. Slabs are
  final: no regrade.
- **Wear.** A card that sits uncased and ungraded wears with time and with every move between wallets.
- **Case.** The one way to protect a card. Casing freezes it: no more wear from time or moves. A card graded straight
  away needs no case.
- **Nothing you pay for raises your odds.** Cases and grading only protect or reveal what the card already has.

## Fresh odds

A card cased or graded within **24 hours** of opening (being dealt) grades from its Series' fresh odds, set per Series
in the studio and fixed once its drop is set up (`configureDrop` locks the Series). Fresh cards only grade **5-10**:
grades 1-4 come only from time.

Standard fresh odds:

| PDA 10 | PDA 9 | PDA 8 | PDA 7 | PDA 6 | PDA 5 |
|---|---|---|---|---|---|
| 1% | 17% | 25% | 27% | 20% | 10% |

## Wear (fixed forever)

The wear rules are built into `FirePsa` as constants: the same for every Series, and nobody can change them.

1. **Fresh grade** `g0`: rolled from the Series' fresh odds (5-10).
2. **Moves.** Each of the first 10 wallet-to-wallet moves of an uncased, ungraded card (sales and plain transfers;
   sending a card to your own wallet doesn't count)
   takes a grade off with a 20% chance. Moves alone never take a card below 5 (a draw that would is re-drawn, so the
   odds above 5 keep their shape).
3. **Time.** Time uncased after the first free 24 hours, `t` in years, takes `D` grades off, `D` drawn from a Poisson
   distribution with mean `1.45 x t^0.68`, read from a fixed table (below). A card can't go below 1.
4. **Low grades fade in.** Grades below 5 open slowly: PDA 4 from 1 month (fully open at 2 months), PDA 3 from 6 months
   (fully at 1 year), PDA 2 from 1 year (fully at 2 years), PDA 1 from 2 years (fully at 4 years). A card that would
   land on a grade that isn't fully open lands one higher with the missing share, and so on up. No overnight jumps:
   the odds change by at most about half a percent on any day.

Casing freezes the clock and the move count where they are. Grading freezes them at the moment it is asked for (the
randomness wait doesn't count).

What a Standard card grades at (no moves):

| Uncased for | 10 | 9 | 8 | 7 | 6 | 5 | 4 | 3 | 2 | 1 | Avg |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ≤ 24 hours | 1.0 | 17 | 25 | 27 | 20 | 10 | | | | | 7.2 |
| 1 month | 0.8 | 13 | 23 | 26 | 22 | 15 | | | | | 7.0 |
| 6 months | 0.4 | 7.3 | 17 | 23 | 23 | 17 | 13 | | | | 6.4 |
| 1 year | 0.2 | 4.3 | 12 | 19 | 22 | 20 | 13 | 9.8 | | | 5.8 |
| 3 years | | 0.9 | 3.8 | 8.8 | 14 | 18 | 18 | 15 | 16 | 5.5 | 4.3 |
| 5 years | | 0.3 | 1.4 | 4.1 | 8.1 | 13 | 16 | 16 | 14 | 27 | 3.2 |
| 10 years | | | 0.2 | 0.6 | 1.8 | 3.8 | 6.7 | 9.8 | 12 | 65 | 1.8 |

By moves (cased right after): 1 move takes PDA 10 from 1% to 0.8%; 3 moves 0.5%; 5 moves 0.3%; 10 or more 0.1%
(average 6.0).

**PDA 1 is a patience trophy:** only a card held uncased for years can get one. **PDA 10 needs a fresh card.**

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

- **Ungraded:** Cased (Yes/No), Uncased age (days), Moves, PDA "Ungraded". The condition is never shown.
- **Slabbed:** the PDA grade (the age and moves traits are gone).

## Prices

- **Case $0.05, grading $1** per card (grading not final until the last numbers audit). Set by the owner in dollars.
- Paid in ETH, USDG or PLANK, like packs. **100% of every fee buys PAPER and burns it**, none of it goes to us. The
  100% is fixed in the contract.
- The purchase goes through the best route among the known PAPER pools (direct, or through PLANK), split across two
  when that gives more, guarded by the PAPER price feed: the buy must get at least 95% of the PAPER the feed says the
  fee is worth. If the whole amount wouldn't, it tries half, a quarter and so on; if no piece would, or a price is
  missing, nothing is spent and the fee waits in `PaperBurner` for a later buy. `PaperBurner` has no withdraw, its
  router is fixed, its price feeds are set once, and its routes may only pass through WETH, PLANK or USDG.

## Locks

| Fixed forever | Fixed per Series when its drop is set up | Owner can change (announced) |
|---|---|---|
| Wear rules (time, moves, fade-in), 24h fresh window, 100% fee burn, slabs final, cards per free pack 42, pack PAPER cap $1 | Fresh odds, recipe, characters, dealer, card images | Case and grading prices, cards per grading batch, the PAPER feed, routes |
