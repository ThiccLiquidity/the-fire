# Card rules and the Card Studio

The Card Studio (`studio/`) is a standalone browser app that builds every card image and its metadata for a Series.
It is kept separate from the site so it can feed whichever front end the cards are shown in. The rules are
set per Series as a **recipe** (`studio/src/recipe.ts`): card types, how many of each, holo odds, what each pack holds
and the PDA odds. It is the same recipe `RecipeDealer` deals on-chain (`docs/cards-contracts.md`); the studio's checks
and pool maths are ports of the contract's and are tested against it. New Series start from the **Standard recipe**
(the original rules below, `contracts/src/cards/StandardRecipe.sol`).

## The card

- **Size:** 1500 x 2100 px (2.5 x 3.5 in).
- **Materials**, common to rare: Paper, Wood, Fire, Coal, Diamond. (Internal ids: `paper`, `wood`, `burning`,
  `charcoal`, `diamond`; the ids are kept so saved data stays valid.)
- **Printed on the image:** character name (top bar), and in the bottom panel the material, the category and
  "Forged · Series #", with the PDA seal on the right.
- **In the metadata only:** the global serial (never resets) and the edition ("12 of 43"). This lets every card with
  the same look and grade share one image.
- **Name** per character: at most 64 bytes of UTF-8 (the contract's `MAX_NAME_BYTES`), no `"`, `\` or control
  characters. A Series takes any number of characters (the contract stores them in batches).
- **Category** per character: free text, typed in the Library. There is no preset list; the field suggests the
  categories already used, so the list builds up as categories are added. Spaces are trimmed and collapsed, the
  capitalisation typed is what prints, and the same word in other capitalisation is saved with the spelling already
  in use. Limits (the contract's): 1 to 32 bytes of UTF-8, no `"`, `\` or control characters. It is stored on-chain
  with the Series (`RecipeDealer.setCharacters`). Older saves and backups with the old fixed ids (`sports`) load as labels
  (`Sports`).

## Frames

- The frames are built into the studio and are not edited by hand: `studio/src/assets/frames`, produced from
  `studio/frames-src/originals` by `studio/frames-src/clean_frames.py`. The only per-card input is the character image.
- A **frame set** is a normal frame, a holo frame and 5 worn versions of each for the PDA grades (12 files:
  `<set>.webp`, `<set>-holo.webp`, `<set>[-holo]-l2.webp` to `-l6.webp`). The Standard sets are `paper`, `wood`,
  `burning` (Fire), `charcoal` (Coal) and `diamond`: 60 files.
- Holo comes from the frame art itself (a holo frame) and from a holo version of the character art (a holo picture),
  not from a code effect.
- Each card type of a recipe uses one frame set: its frames, its text layout (set per frame set in Frames & Layout)
  and the characters' art for that set. A new type can reuse a set (e.g. Gold on Diamond's frames as a placeholder)
  or get its own.
- **Adding a frame set** (e.g. `gold`): put `gold.png` and `gold-holo.png` in `frames-src/originals` and the worn
  versions in `frames-src/originals/wear/l2` to `l6` (`gold.png`, `gold-holo.png` in each), then run
  `python3 frames-src/clean_frames.py` from `studio/`. The studio finds the set by its files (set ids are lowercase
  letters and digits) and lists it in Frames & Layout, the Library (art slots) and each card type's Frames choice.
  Bump `FRAMES_UPDATED_AT` in `studio/src/frames.ts`. A type whose frames are missing blocks approval and the build.

## A Series' recipe

Set on the **Recipe** tab, per Series, and locked with the deal:

- **Card types**, any number: name (the Material trait, 1-64 bytes), slug (image file names, `[a-z0-9-]`, 1-32
  bytes, unique; follows the name until typed), rank (for "X-or-better" slots), supply (a share of the cards, a
  number per pack, an exact count, or the filler: exactly one type takes the rest), an optional cap per pack's worth,
  holo (two independent rolls, frame and picture, or explicit weights for none / frame / picture / full) and its
  frame set.
- **Slot groups**: a number of cards that may be any type in a set (a list of types, or a rank range), optionally
  must-holo. Cards per pack is their sum. Two groups' sets must be nested or disjoint.
- **PDA odds**: a weight per grade.

The tab lists every problem the contract would refuse (filler, slugs, text, shares, holo, nested sets, a type no slot
takes, a never-holo type in a must-holo slot) and shows the exact pool for any pack count. Presets: **Standard**,
**Special: 3 cards, all holo** (Fire the filler, Coal 30%, Diamond 2% at most one per pack; 2 Fire-or-better and 1
Coal-or-better, all must-holo), or a copy of another Series' recipe. Series saved before recipes load with the
Standard recipe and their Diamond setting.

## The Standard recipe

Each Series stands alone: its cards come only from its own packs and nothing carries over. For P packs (N = 6P cards):

| Material | Count |
|---|---|
| Paper | 3P (half the cards) |
| Fire | 15% of N, rounded half up |
| Coal | 4.9% of N, rounded half up |
| Diamond | as set for the Series (at least 1), never more than one per pack |
| Wood | the rest |

Then the pack floor: Fire-or-better stays between P and 2P (extra Fire, then Coal, becomes Wood; a shortfall is
taken from Wood). Example: 167 packs and 1 Diamond make 501 Paper, 301 Wood, 150 Fire, 49 Coal, 1 Diamond.

**Pack (6 cards):** slots 1-3 Paper, 4 Wood, 5 Wood-or-better, 6 Fire-or-better.

## Holo (Standard)

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

One image per character x card type x holo look x grade within a Series. Each grade has its own image (the seal
prints the number), even where two grades share a wear frame. The image folder holds the full grid the recipe can
produce: every character x type x the holo looks that type can have (from its holo rule and slots: a type dealt only
in must-holo slots has no `none` image, a 0% holo type only `none`) x 11 grade states (unrevealed, PDA 1 to 10), WEBP
only. Standard: 4 types x 4 holo looks + Diamond x 3 = 19 looks x 11 = **209 images** per character; Special 3-card
all-holo: 3 x 3 x 11 = 99. Every one is built before upload, since grades are revealed on-chain later. Each Series
has its own "Forged · Series #" line, so images are never shared across Series.

## Collections

- **Omni Card Packs** (`FirePacks`, ERC-1155): one stackable token type per Series, so "Series 7 Sealed Pack x 3"
  lists and trades like any item. Pack art is `<packImageBase>fire<N>.webp`.
- **Omni Cards** (`FireCards`, ERC-721): every card unique, with character, category, material, holo, Series,
  edition, serial and PDA grade as traits (Material = the type's name). Image file names match the studio's export
  and `FireCards.imageName`: `c<character>-<type slug>-<holo>-<grade>.webp`, `holo` one of `none`, `frame`, `picture`,
  `full`, `grade` `u` (unrevealed) or `1` to `10`. Standard slugs are `paper`, `wood`, `fire`, `coal`, `diamond`, so
  Standard names are unchanged: `c0-wood-none-u.webp`, `c2-coal-full-10.webp`.

A pack's contents are decided only when it is opened: the pack is burned, drand randomness arrives about 30 seconds
later (the router commits to a drand round 30 to 33 seconds ahead) and its cards are drawn from what is left in the Series' pool, keeping the pack guarantees. See
`docs/cards-contracts.md`.

## Studio workflow, per Series

1. **Library:** characters are saved and reused across Series. Search and pages keep hundreds manageable; **Add
   many** takes `Name, Category` lines and a drop of many images named `<character>__<frame set>[__holo].png`. A
   character can join a Series once it has the art that Series' recipe uses.
2. **Frames & Layout:** text fields' font, size and colour are set once per frame set; the art window is fixed by
   the frames.
3. **Series:** pick the characters (any number; their order is the image order c0, c1, ...) and the pack count.
4. **Recipe:** card types, slots and PDA odds, with the contract's checks and the pool preview.
   **Sale** (next tab): the drop's settings for `FireSale.configureDrop` in plain units (paid and press packs, price,
   PAPER, burn share, PLANK-only packs, wallet limit, holder window and snapshot root, regular-wallets time, press
   packs per press and per wallet and their price, packs per purchase, credits per picked suggestion, caps on free
   packs per drop and per wallet), checked live
   like the contract checks them. Presets: Standard (today's sale) and Giant (10,000 packs, 100 per wallet and per
   purchase). Cards per free pack shows as fixed (42, forever). Missing settings mean the Standard sale.
5. **Deal:** a sample deal on the recipe (the contract's dealing with the studio's own randomness, up to 600,000
   cards), seeded by a string, dealt in a background worker. Locking it locks the recipe and advances the studio's own
   serial counter (not the contract's).
6. **Build & Review:** one sample per character x type x holo look renders for review (12 characters a page).
   **Approve all**, then **Build all images** builds the recipe's full grid in background workers; the count, size
   and time are estimated first. Missing frames block approval and the build. A later asset, recipe or character
   change means building again.
7. **Export & Upload:** a readiness checklist (recipe valid, frames for every type, characters valid, deal locked,
   approved, the full grid built, sale settings valid); **recipe.json** (what `contracts/script/ConfigureSeries.s.sol`
   reads: types, slots, characters, PDA odds, `imagesBase` once uploaded, and the `sale` block); a zip of the images, per-card metadata (preview
   only), `fire.json` and `recipe.json`, in parts of about 1.5 GB for big Series; or the upload to IPFS through Pinata.

**Upload.** Each folder (images, then the preview metadata) is packed in the browser into one CAR file. Its root CID
(a UnixFS directory, CIDv1, sharded when large) is known before upload. The CAR goes to Pinata's v3 upload API with
`car: true` over its resumable (tus) protocol in 50 MB pieces: a dropped connection or a reload resumes where Pinata
got to, and a folder Pinata already has (same CID) is reused. Pinata keeps exactly that folder, so its CID is the
single `imagesBase` the contract expects (`ipfs://<images CID>/`). The Pinata key (Files write permission) is typed in
per session and never stored. The legacy one-request folder upload is not used: it can't resume, and one folder
can't be built from several pins.

Only the images folder is used on-chain: `tokenURI` builds each card's JSON itself. The studio's per-card metadata is
for preview and reference only.

## Storage

Arweave (one-time, permanent) suits shared images; IPFS (Pinata, Storacha, Filebase) is the alternative. The studio
uploads to Pinata today. Check current prices before choosing for launch.
