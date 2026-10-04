# Card Studio: the NFT card generator

Owner decisions, Oct 1 2026, on top of `NFT_Card_Fire_System_Handoff` (Sept 30). The studio is a standalone app in
`studio/`, kept separate from the Fire game site so it can plug into whichever front end the cards end up living in.

## What it does, every Series
1. **Library.** The owner adds characters, which are saved and reusable across Series. A character can't go into a Series until it has
   all **10 images**: Paper, Wood, Fire, Charcoal, Diamond, plus a holo version of each.
2. **Frames.** Built in and locked (see "Decided Oct 3"). The owner sets each text field's font, size and colour once;
   the art window is fixed by the frames.
3. **Fire setup.** The owner picks any number of characters for the Series (modular: new, returning or mixed). Every
   character must be complete.
4. **Deal.** After the Series ends, its card pool is dealt into the bought packs (for now: a sample deal on the real
   rules, until the pack contract exists).
5. **Build.** One image per look (character x material x holo frame x holo picture x wear), assembled from frame + art
   + text, shared by every card with that look (a 900-card Fire is a few dozen images). Each card's metadata points at
   its shared image and carries its serial, edition and Series #.
6. **Approval.** The owner reviews **one sample of every character x material x holo type** and approves them all at
   once. Nothing is uploaded before that.
7. **Upload.** Images and metadata go to **IPFS via Pinata**. The Pinata key is typed into the page each session and
   never stored or sent anywhere else.

## Locked numbers
- Card: **1500 x 2100 px** (2.5 x 3.5).
- Each Series stands alone (decided Oct 4; replaces the 0.10% Diamond and the carried accumulators). For P packs
  (6P cards): **Paper 3P; Fire 15% and Charcoal 4.90%** of the cards, rounded half up (Charcoal 4.90% approved Oct 1);
  **Diamond: at least 1**, more if the owner sets it, never more than one per pack; **Wood the rest**. Then the pack
  floor: Fire-or-better stays between P and 2P (extra Fire, then Charcoal, goes to Wood; a shortfall comes from Wood).
  167 packs, 1 Diamond: 501 Paper, 301 Wood, 150 Fire, 49 Charcoal, 1 Diamond. The Series tab shows these counts
  and the holos to expect (holo stays random per card).
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
- Printed on the card: character name (top bar, centered), material, category and the PDA grade ("PDA ?" until
  revealed). **Edition** ("12 of 43" in Series 7) and the **global serial** (never resets) are in the metadata, not on
  the image (shared images, decided Oct 3).

## Name
**Omni** — tagline **"Forged in Fire"** (decided Oct 3). Run a trademark search before launch.

## Decided Oct 3
- **Frames are built in and locked.** The owner's master frames ship with the studio (`studio/src/assets/frames`,
  cleaned from `studio/frames-src` by `clean_frames.py`). The only thing dropped in per card is the character image.
  The set is the 10 "OMNI Prismatic" frames (all 5 materials, normal + holo), approved Oct 3.
- **Holo comes from the frame art itself**, not a code effect. Procedural foils were prototyped and rejected.
- **PDA wear is designed into the frames:** 6 wear levels, each a full frame per material x normal/holo
  (6 x 5 x 2 = 60 frames; PDA 10 is the clean frame itself, so 50 worn files, in `studio/frames-src/originals/wear`).
  The clean frame is used before the grade is revealed. On PDA 3-2 and 1, dark text gets a light outline so it stays
  readable over the scorch marks.

  | Level | Grades | Odds |
  |---|---|---|
  | 1 | PDA 10 (unique) | 1% |
  | 2 | PDA 9-8 | 17% + 24% |
  | 3 | PDA 7-6 | 25% + 18% |
  | 4 | PDA 5-4 | 7% + 3.5% |
  | 5 | PDA 3-2 | 2% + 1.5% |
  | 6 | PDA 1 (unique) | 1% |

  Odds are the contract's defaults (`FirePsa.oddsOf`, decided Oct 4; full table in `docs/omni-economy.md`).
- **PDA 10 glow:** a PDA 10 gets the clean frame plus a thin warm-gold glow along the card's outer edge and a few
  small four-point sparkles near the corners. Drawn in code by the renderer (the frames stay locked), the same on
  every material, and never over the name panel, art or seal.
- **Shared images, not one per card.** One image per character x material x holo type x wear look within a Series
  (each Series has brand-new characters and its own "Forged · Series " line, so nothing is shared across Series)
  (~110 MB per character instead of ~450 MB per Series). Printed on the image: name, material, PDA grade (and category,
  if printed). Serial, edition and Series # go in each NFT's metadata (traits) and in a live `animation_url` version
  that draws them on the card. The metadata must be updatable for the grade reveal (pack contract).
- **Storage:** Arweave (one-time, permanent) looks best for shared images: roughly $40-300 total over two years
  depending on how many characters are made. IPFS (Storacha / Filebase / Pinata) is the alternative at $0-20 a month.
  Check live prices before choosing.
- **Category per character** (set once in the Library), first match wins: Person (fictional only), Animal, Plant,
  Place, Object, Element, Idea.

- **Bottom panel:** material, category, and **Forged · Series #** (the Series the card came from), with the PDA seal on
  the right.
- **Material name:** the third tier is called **Fire** (was Burning; the studio's internal id stays `burning`).
- **PDA seal:** the grade shows as a round wax seal on the right of the bottom panel, matched to each frame (Paper
  graphite, Wood walnut, Fire ember, Charcoal silver-graphite, Diamond icy crystal) with a thin gold rim, "PDA" small on top and **?** in the middle until the
  grade is paid for, then the number. A revealed seal gets a glowing ring in the grade's colour: 10 green, 9-8 teal,
  7-6 sky blue, 5-4 blue, 3-2 orange, 1 red (over a thin dark edge so it reads on every seal).

## Packs and opening (decided Oct 3)
- **Two collections.** *The Fire: Packs*: sealed packs, one stackable token type per Series (ERC-1155), so "Series 7
  Sealed Pack x 3" lists and trades like any item and each Series has its own floor. *The Fire: Cards*: every card a
  unique NFT (ERC-721) with its serial, edition, material, holo, category and grade as traits.
- **Buying:** packs are bought while the fire burns and are tradeable sealed from then on.
- **When the fire goes out:** the contract freezes the pack count and computes the Series' pool from its packs and
  Diamond setting (the same math as the studio, ported exactly, with a parity test).
- **Contents stay secret until opened.** Opening is two steps: the holder taps Open (the pack is burned), fresh drand
  randomness arrives a few seconds later and draws that pack's 6 cards from what's left in the Series' pool, keeping
  the pack guarantees. Nobody, including the owner, can know a sealed pack's contents in advance, and the Series'
  totals stay exact. The cards are minted to the holder and the site plays the opening animation from them.
- **Pack art:** every sealed pack uses the same master graphic (being made in ChatGPT) with the Series number stamped on
  it by the generator ("FIRE #7"), so each Series' pack is its own NFT image and doubles as the opening-animation art.
- **Images** depend only on the Series' characters (shared images), so they're built before the fire goes out; each
  card's metadata points at its shared image.
- To check before launch: marketplace support for Robinhood Chain, and a lawyer's read on selling and reselling
  sealed packs with random contents.

## Left open
- Category is printed on the card for now (it can be hidden per material in Frames & Layout).
- PDA 9-8 frames are slightly softer than PDA 10 (ChatGPT redrew the texture); the owner may have them redone.
- The pack contract (deal, drand grades, reveal fee) and the token standard come next. The studio's
  deal step is written so the real contract result can replace the sample deal.
- Whether the Fire game's scene stays as the home for packs isn't decided. The studio doesn't depend on it.
