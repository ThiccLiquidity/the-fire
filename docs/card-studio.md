# Card Studio: the NFT card generator

Owner decisions, Oct 1 2026, on top of `NFT_Card_Fire_System_Handoff` (Sept 30). The studio is a standalone app in
`studio/`, kept separate from the Fire site so it can plug into whichever front end the cards end up living in.

## What it does, every Fire
1. **Library.** The owner adds characters, which are saved and reusable across Fires. A character can't go into a Fire until it has
   all **10 images**: Paper, Wood, Burning, Charcoal, Diamond, plus a holo version of each.
2. **Frames.** The owner makes a **normal and a holo frame for each material** (10 files, 1500 x 2100). Once per
   frame, the owner drags boxes in the studio for the art window and each text field and picks font, size and colour.
   The layout is saved and reused every Fire.
3. **Fire setup.** The owner picks any number of characters for the Fire (modular: new, returning or mixed). Every
   character must be complete.
4. **Deal.** After the Fire ends, its card pool is dealt into the bought packs (for now: a sample deal on the real
   rules, until the pack contract exists).
5. **Build.** Every card is assembled automatically from frame + art + text. Each card is its own image file; the art
   and frames are shared.
6. **Approval.** The owner reviews **one sample of every character x material x holo type** and approves them all at
   once. Nothing is uploaded before that.
7. **Upload.** Images and metadata go to **IPFS via Pinata**. The Pinata key is typed into the page each session and
   never stored or sent anywhere else.

## Locked numbers
- Card: **1500 x 2100 px** (2.5 x 3.5).
- Rarity per card: **Paper 50%, Wood 30%, Burning 15%, Charcoal 4.90%, Diamond 0.10%** (Charcoal 4.90% approved Oct 1).
  Fractional accumulators carry across Fires.
- Pack (6 cards): slots 1-3 Paper, 4 Wood, 5 Wood-or-better, 6 Burning-or-better.
- Holo: chance a card is holo at all stays **5 / 10 / 50 / 90 / 100%** (Paper -> Diamond). It's two equal, independent
  rolls, one for a holo frame and one for a holo picture, each at p = 1 - sqrt(1 - rate). Both hitting = **full holo**.

  | Material | Holo (any) | Each roll | Frame only | Picture only | Full holo |
  |---|---|---|---|---|---|
  | Paper | 5% | 2.53% | 2.47% | 2.47% | 0.064% (1 in ~1,560) |
  | Wood | 10% | 5.13% | 4.87% | 4.87% | 0.26% (1 in ~380) |
  | Burning | 50% | 29.3% | 20.7% | 20.7% | 8.6% |
  | Charcoal | 90% | 68.4% | 21.6% | 21.6% | 46.8% |
  | Diamond | 100% | 100% | 0 | 0 | 100% |
- Printed on the card: character name, material, **edition** ("12 of 43 · Fire #7" = this card's place among that
  character + material in that Fire), **global serial** (never resets), and the PSA grade once revealed. No separate
  "overall" count, since the serial covers that.

## Left open
- **PSA wear look.** It's a separate, swappable render step. Two prototypes will be built for the owner to compare: a
  fixed overlay per grade, and a per-card version seeded from the serial (same grade, slightly different damage on
  every card).
- The pack contract (deal, accumulators, drand grades, reveal fee) and the token standard come next. The studio's
  deal step is written so the real contract result can replace the sample deal.
- Whether the Fire scene stays as the home for packs isn't decided. The studio doesn't depend on it.
