# Card Studio: the NFT card generator

Owner decisions, Oct 1 2026, on top of `NFT_Card_Fire_System_Handoff` (Sept 30). The studio is a standalone app in
`studio/`, kept separate from the Fire site so it can plug into whichever front end the cards end up living in.

## What it does, every Fire
1. **Library.** The owner adds characters, which are saved and reusable across Fires. A character can't go into a Fire until it has
   all **10 images**: Paper, Wood, Fire, Charcoal, Diamond, plus a holo version of each.
2. **Frames.** Built in and locked (see "Decided Oct 3"). The owner sets each text field's font, size and colour once;
   the art window is fixed by the frames.
3. **Fire setup.** The owner picks any number of characters for the Fire (modular: new, returning or mixed). Every
   character must be complete.
4. **Deal.** After the Fire ends, its card pool is dealt into the bought packs (for now: a sample deal on the real
   rules, until the pack contract exists).
5. **Build.** One image per look (character x material x holo frame x holo picture x wear), assembled from frame + art
   + text, shared by every card with that look (a 900-card Fire is a few dozen images). Each card's metadata points at
   its shared image and carries its serial, edition and Fire #.
6. **Approval.** The owner reviews **one sample of every character x material x holo type** and approves them all at
   once. Nothing is uploaded before that.
7. **Upload.** Images and metadata go to **IPFS via Pinata**. The Pinata key is typed into the page each session and
   never stored or sent anywhere else.

## Locked numbers
- Card: **1500 x 2100 px** (2.5 x 3.5).
- Rarity per card: **Paper 50%, Wood 30%, Fire 15%, Charcoal 4.90%, Diamond 0.10%** (Charcoal 4.90% approved Oct 1).
  Fractional accumulators carry across Fires.
- Pack (6 cards): slots 1-3 Paper, 4 Wood, 5 Wood-or-better, 6 Fire-or-better.
- Holo: chance a card is holo at all stays **5 / 10 / 50 / 90 / 100%** (Paper -> Diamond). It's two equal, independent
  rolls, one for a holo frame and one for a holo picture, each at p = 1 - sqrt(1 - rate). Both hitting = **full holo**.
  Diamond is always holo, split evenly: 1/3 frame only, 1/3 picture only, 1/3 full (decided Oct 3), so a full-holo
  Diamond is the rarest Diamond.

  | Material | Holo (any) | Each roll | Frame only | Picture only | Full holo |
  |---|---|---|---|---|---|
  | Paper | 5% | 2.53% | 2.47% | 2.47% | 0.064% (1 in ~1,560) |
  | Wood | 10% | 5.13% | 4.87% | 4.87% | 0.26% (1 in ~380) |
  | Fire | 50% | 29.3% | 20.7% | 20.7% | 8.6% |
  | Charcoal | 90% | 68.4% | 21.6% | 21.6% | 46.8% |
  | Diamond | 100% | - | 33.3% | 33.3% | 33.3% |
- Printed on the card: character name (top bar, centered), material, category and the PSA grade ("PSA ?" until
  revealed). **Edition** ("12 of 43" in Fire #7) and the **global serial** (never resets) are in the metadata, not on
  the image (shared images, decided Oct 3).

## Name
**Omni** — tagline **"Forged in Fire"** (decided Oct 3). Run a trademark search before launch.

## Decided Oct 3
- **Frames are built in and locked.** The owner's master frames ship with the studio (`studio/src/assets/frames`,
  cleaned from `studio/frames-src` by `clean_frames.py`). The only thing dropped in per card is the character image.
  The set is the 10 "OMNI Prismatic" frames (all 5 materials, normal + holo), approved Oct 3.
- **Holo comes from the frame art itself**, not a code effect. Procedural foils were prototyped and rejected.
- **PSA wear is designed into the frames:** 6 wear levels, each a full frame per material x normal/holo
  (6 x 5 x 2 = 60 frames; PSA 10 is the clean frame itself, so 50 worn files, in `studio/frames-src/originals/wear`).
  The clean frame is used before the grade is revealed. On PSA 3-2 and 1, dark text gets a light outline so it stays
  readable over the scorch marks.

  | Level | Grades |
  |---|---|
  | 1 | PSA 10 (unique) |
  | 2 | PSA 9-8 |
  | 3 | PSA 7-6 |
  | 4 | PSA 5-4 |
  | 5 | PSA 3-2 |
  | 6 | PSA 1 (unique) |
- **Shared images, not one per card.** One image per character x material x holo type x wear look within a Fire
  (each Fire has brand-new characters and its own "Forged · Fire #" line, so nothing is shared across Fires)
  (~110 MB per character instead of ~450 MB per Fire). Printed on the image: name, material, PSA grade (and category,
  if printed). Serial, edition and Fire # go in each NFT's metadata (traits) and in a live `animation_url` version
  that draws them on the card. The metadata must be updatable for the grade reveal (pack contract).
- **Storage:** Arweave (one-time, permanent) looks best for shared images: roughly $40-300 total over two years
  depending on how many characters are made. IPFS (Storacha / Filebase / Pinata) is the alternative at $0-20 a month.
  Check live prices before choosing.
- **Category per character** (set once in the Library), first match wins: Person (fictional only), Animal, Plant,
  Place, Object, Element, Idea.

- **Bottom panel:** material, category, and **Forged · Fire #** (the Fire the card came from), with the PSA seal on
  the right.
- **Material name:** the third tier is called **Fire** (was Burning; the studio's internal id stays `burning`).
- **PSA seal:** the grade shows as a round wax seal on the right of the bottom panel, matched to each frame (Paper
  graphite, Wood walnut, Fire ember, Charcoal silver-graphite, Diamond icy crystal) with a thin gold rim, "PSA" small on top and **?** in the middle until the
  grade is paid for, then the number. A revealed seal gets a glowing ring in the grade's colour: 10 green, 9-8 teal,
  7-6 sky blue, 5-4 blue, 3-2 orange, 1 red (over a thin dark edge so it reads on every seal).

## Packs and opening (decided Oct 3)
- **Two collections.** *The Fire: Packs*: sealed packs, one stackable token type per Fire (ERC-1155), so "Fire #7
  Sealed Pack x 3" lists and trades like any item and each Fire has its own floor. *The Fire: Cards*: every card a
  unique NFT (ERC-721) with its serial, edition, material, holo, category and grade as traits.
- **Buying:** packs are bought while the fire burns and are tradeable sealed from then on.
- **When the fire goes out:** the contract freezes the pack count and computes the Fire's pool from the rarity math and
  carry-over (the same math as the studio, ported exactly, with a parity test).
- **Contents stay secret until opened.** Opening is two steps: the holder taps Open (the pack is burned), fresh drand
  randomness arrives a few seconds later and draws that pack's 6 cards from what's left in the Fire's pool, keeping
  the pack guarantees. Nobody, including the owner, can know a sealed pack's contents in advance, and the Fire's
  totals stay exact. The cards are minted to the holder and the site plays the opening animation from them.
- **Pack art:** every sealed pack uses the same master graphic (being made in ChatGPT) with the Fire number stamped on
  it by the generator ("FIRE #7"), so each Fire's pack is its own NFT image and doubles as the opening-animation art.
- **Images** depend only on the Fire's characters (shared images), so they're built before the fire goes out; each
  card's metadata points at its shared image.
- To check before launch: marketplace support for Robinhood Chain, and a lawyer's read on selling and reselling
  sealed packs with random contents.

## Left open
- Category is printed on the card for now (it can be hidden per material in Frames & Layout).
- PSA 9-8 frames are slightly softer than PSA 10 (ChatGPT redrew the texture); the owner may have them redone.
- The pack contract (deal, accumulators, drand grades, reveal fee) and the token standard come next. The studio's
  deal step is written so the real contract result can replace the sample deal.
- Whether the Fire scene stays as the home for packs isn't decided. The studio doesn't depend on it.
