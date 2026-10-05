# Card rules and the Card Studio

The Card Studio (`studio/`) is a standalone browser app that builds every card image and its metadata for a Series.
It is kept separate from the site so it can feed whichever front end the cards are shown in. The rules below are
encoded once in `studio/src/rules.ts` and `studio/src/deal.ts` and ported exactly to `contracts/src/cards/CardRules.sol`
(a parity test checks the contract against the studio's output).

## The card

- **Size:** 1500 x 2100 px (2.5 x 3.5 in).
- **Materials**, common to rare: Paper, Wood, Fire, Coal, Diamond. (Internal ids: `paper`, `wood`, `burning`,
  `charcoal`, `diamond`; the ids are kept so saved data stays valid.)
- **Printed on the image:** character name (top bar), and in the bottom panel the material, the category and
  "Forged · Series #", with the PDA seal on the right.
- **In the metadata only:** the global serial (never resets) and the edition ("12 of 43"). This lets every card with
  the same look share one image.
- **Category** per character: free text, typed in the Library. There is no preset list; the field suggests the
  categories already used, so the list builds up as categories are added. Spaces are trimmed and collapsed, the
  capitalisation typed is what prints, and the same word in other capitalisation is saved with the spelling already
  in use. Limits (the contract's): 1 to 32 bytes of UTF-8, no `"`, `\` or control characters. It is stored on-chain
  with the Series (`configureFire`). Older saves and backups with the old fixed ids (`sports`) load as labels
  (`Sports`).

## Frames

- The frames are built into the studio and are not edited by hand: `studio/src/assets/frames`, produced from
  `studio/frames-src/originals` by `studio/frames-src/clean_frames.py`. The only per-card input is the character image.
- 10 base frames (5 materials x normal/holo), plus 5 worn versions of each for the PDA grades: 60 files.
- Holo comes from the frame art itself (a holo frame) and from a holo version of the character art (a holo picture),
  not from a code effect.

## A Series' card pool

Each Series stands alone: its cards come only from its own packs and nothing carries over. For P packs (N = 6P cards):

| Material | Count |
|---|---|
| Paper | 3P (half the cards) |
| Fire | 15% of N, rounded half up |
| Coal | 4.9% of N, rounded half up |
| Diamond | as set for the Series: at least 1, at most 1000, never more than one per pack |
| Wood | the rest |

Then the pack floor: Fire-or-better stays between P and 2P (extra Fire, then Coal, becomes Wood; a shortfall is
taken from Wood). Example: 167 packs and 1 Diamond make 501 Paper, 301 Wood, 150 Fire, 49 Coal, 1 Diamond.

**Pack (6 cards):** slots 1-3 Paper, 4 Wood, 5 Wood-or-better, 6 Fire-or-better.

## Holo

The chance a card is holo at all is 5 / 10 / 50 / 90 / 100% (Paper to Diamond). It is two equal, independent rolls,
one for a holo frame and one for a holo picture, each at p = 1 - sqrt(1 - rate); both hitting is a **full holo**.
Diamond is always holo, split evenly between frame only, picture only and full.

| Material | Holo (any) | Each roll | Frame only | Picture only | Full holo |
|---|---|---|---|---|---|
| Paper | 5% | 2.53% | 2.47% | 2.47% | 0.064% (1 in ~1,560) |
| Wood | 10% | 5.13% | 4.87% | 4.87% | 0.26% (1 in ~380) |
| Fire | 50% | 29.3% | 20.7% | 20.7% | 8.6% |
| Coal | 90% | 68.4% | 21.6% | 21.6% | 46.8% |
| Diamond | 100% | - | 33.3% | 33.3% | 33.3% |

## PDA grade and wear

A card's PDA grade (1 to 10) is revealed once, through `FirePsa` (pricing in `docs/omni-economy.md`). Until then the
card uses its clean frame and the seal shows "?". The grade picks a wear level, each a full frame per material and
holo variant:

| Wear level | Grades | Default odds |
|---|---|---|
| 1 | PDA 10 | 1% |
| 2 | PDA 9-8 | 17% + 24% |
| 3 | PDA 7-6 | 25% + 18% |
| 4 | PDA 5-4 | 7% + 3.5% |
| 5 | PDA 3-2 | 2% + 1.5% |
| 6 | PDA 1 | 1% |

Odds are `FirePsa.oddsOf`'s defaults and can be changed per Series before any of its packs exist.

- **PDA 10** uses the clean frame plus a thin warm-gold glow along the card's outer edge and a few small sparkles
  near the corners, drawn by the renderer on every material, never over the name panel, art or seal.
- **Readability:** on PDA 3-2 and 1, dark text gets a light outline so it reads over the scorch marks.
- **PDA seal:** a round wax seal on the right of the bottom panel, matched to each frame (Paper graphite, Wood walnut,
  Fire ember, Coal silver-graphite, Diamond icy crystal) with a thin gold rim, "PDA" small on top and the grade (or
  "?") in the middle. A revealed seal gets a ring in the grade's colour: 10 green, 9-8 teal, 7-6 sky blue, 5-4 blue,
  3-2 orange, 1 red.

## Shared images

One image per character x material x holo type x wear look within a Series. Each Series has new characters and its
own "Forged · Series #" line, so images are never shared across Series. A Series builds a few dozen images per
character, not one per card. Each card's metadata points at its shared image.

## Collections

- **Omni Card Packs** (`FirePacks`, ERC-1155): one stackable token type per Series, so "Series 7 Sealed Pack x 3"
  lists and trades like any item. Pack art is `<packImageBase>fire<N>.webp`.
- **Omni Cards** (`FireCards`, ERC-721): every card unique, with character, category, material, holo, Series,
  edition, serial and PDA grade as traits. Image file names match the studio's export:
  `c<character>-<material>-<holo>-<wear>.webp`.

A pack's contents are decided only when it is opened: the pack is burned, drand randomness arrives a few seconds
later and its 6 cards are drawn from what is left in the Series' pool, keeping the pack guarantees. See
`docs/cards-contracts.md`.

## Studio workflow, per Series

1. **Library:** characters are saved and reused across Series. A character can join a Series only once it has all
   10 images (each material, normal and holo).
2. **Frames & Layout:** text fields' font, size and colour are set once per material; the art window is fixed by
   the frames.
3. **Series:** pick the characters, the pack count and the Diamonds. The tab shows the exact pool and the expected
   holos.
4. **Deal:** a sample deal on the real rules, seeded by a string. The contract's result replaces it in the same shape.
5. **Build & Review:** one sample of every character x material x holo type renders for review; **Approve all**, then
   **Build all**. Any later asset change requires approving again.
6. **Export & Upload:** a zip of images, per-card ERC-721 metadata and `fire.json` (which includes the
   `configureFire` arguments: names and categories in order, and the images folder once uploaded), or an upload to
   IPFS through Pinata. The Pinata key is typed in per session and never stored.

## Storage

Arweave (one-time, permanent) suits shared images; IPFS (Pinata, Storacha, Filebase) is the alternative. The studio
uploads to Pinata today. Check current prices before choosing for launch.
