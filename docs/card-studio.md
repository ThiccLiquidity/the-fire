# Card rules and the Card Studio

The Card Studio (`studio/`) is a standalone browser app that builds every card image and its metadata for a Series.
It is kept separate from the site so it can feed whichever front end the cards are shown in. The rules are
set per Series as a **recipe** (`studio/src/recipe.ts`): card types and their odds, holo odds and cards per pack.
Every card of every pack is rolled on its own from those fixed odds (straight odds: no slots, guarantees, caps or
pool). PDA grade odds and wear rules are not part of it: they are fixed forever in `FirePsa`, the same for every
Series. It is the same recipe `RecipeDealer` deals on-chain (`docs/cards-contracts.md`); the studio's checks and odds
are ports of the contract's and are tested against it. New Series start from the **Standard recipe** (below,
`contracts/src/cards/StandardRecipe.sol`).

## The card

- **Size:** 1500 x 2100 px (2.5 x 3.5 in).
- **Materials**, common to rare: Paper, Wood, Fire, Coal, Gold, then **Full Art** (the character art over the whole
  card). Diamond is the older top material, kept for Series saved before Gold. (Frame set ids: `paper`, `wood`,
  `burning`, `charcoal`, `diamond`, `gold`, `fullart`; the ids are kept so saved data stays valid.)
- **Printed on the image:** character name (top bar), and in the bottom panel the material, the category and
  "Forged · Series #", with the PDA seal on the right.
- **In the metadata only:** the global serial (never resets) and the print number ("#12": the 12th of that exact card,
  same character, type and holo look, in the order opened; the first one opened is #1). This lets every card with the
  same look and grade share one image.
- **Name** per character: at most 64 bytes of UTF-8 (the contract's `MAX_NAME_BYTES`), no `"`, `\`, control
  characters or DEL (`RecipeCompiler._checkText`). A Series takes any number of characters (the contract stores them in batches).
- **Category** per character: free text, typed in the Library. There is no preset list; the field suggests the
  categories already used, so the list builds up as categories are added. Spaces are trimmed and collapsed, the
  capitalisation typed is what prints, and the same word in other capitalisation is saved with the spelling already
  in use. Limits (the contract's): 1 to 32 bytes of UTF-8, no `"`, `\`, control characters or DEL. It is stored on-chain
  with the Series (`RecipeDealer.setCharacters`). Older saves and backups with the old fixed ids (`sports`) load as labels
  (`Sports`).

## Frames

- The frames are built into the studio and are not edited by hand: `studio/src/assets/frames`, produced from
  `studio/frames-src/originals` by `studio/frames-src/clean_frames.py`. The only per-card input is the character image.
- A **frame set** is one clean frame, `<set>.webp`. The built sets are `paper`, `wood`, `burning` (Fire), `charcoal`
  (Coal), `gold` (its one frame is `gold-holo.webp`) and `diamond` (retired: hidden in the studio, kept so older Series
  still build). The other `<set>-holo.webp` files are retired: holo is drawn over the clean frame (below).
- **Pictures: five per character** (Library): Paper, Wood, Fire, Coal and Full Art, one each. **Gold uses the Wood
  picture.** No holo pictures: the studio draws every holo.
- **Full Art has no frame.** The character's photo is the whole card (its own border drawn in), cut to the same
  rounded card shape; the name, type and PDA seal print on it like every card.
- **Art safety net** (Library, every frame set): **Template** gives the image generator the exact target: a 1244 x
  1244 square for a frame's art window; for Full Art a 1500 x 2100 guide with the card shape, the zones where the name
  and the type, category, Series and seal print, and the wear margin. Every uploaded image is checked: a warning when
  it isn't the right shape (how much is cut off which sides) or is small enough to look soft. **Preview and frame it**
  shows the card as built (Full Art with the print zones outlined); **Zoom** and **Move** frame that image for the
  character (it always still covers its window), saved with the character and used by every build.
  In the preview, drag the picture to move it and scroll to zoom; bright green behind it shows any gap (with a
  warning).
- **Text positions are fixed** on every frame set: the name is centred in the top bar both ways, whatever the font or
  size; the type, category and Series lines sit left in the bottom panel; the seal in its spot. Text is placed by the
  letters actually drawn (capital height centred, a centred line centred on its ink; the seal's grade or "?" centred
  on its own shape), so changing font never shifts it. Frames & Layout sets only the look: font, size, colour,
  outline, bold, italic, capitals, shown or hidden.
  The look is set for every line at once or line by line (name, type, category, Series line, seal number), and
  **Clean view** hides the editing boxes to see the card as it prints.
- **PDA wear is the same on every card type.** One set of wear layers, `studio/src/assets/wear/wear-l2.webp` to
  `-l6.webp` (PDA 9-8, 7-6, 5-4, 3-2, 1; PDA 10 is pristine), goes over the finished card, framed or Full Art: worn
  card-stock edges and corners, ink chips, scratches, scuffs, rubbed-off ink, creases, cracks, dents and stains, building
  to a wrecked PDA 1 (water damage, grime, a pen scribble). The card's shape never changes. Made by
  `studio/frames-src/wear_overlays.py` (fixed seeds, so it rebuilds the same files). No frame set ever needs worn
  versions.
- **Holo is drawn by the studio** (`studio/src/holoFx.ts`, approved in the Holo Playground, Oct 2026), over the normal
  frame and picture: diagonal rainbow bands in the foil, fine foil lines, rainbow glitter, sparkles and small
  starbursts that each catch the light at their own angle (coloured like the foil where they sit), and a glare.
  - **Holo frame**: the holo on the frame, everywhere outside the picture (bands closer together and bigger sparkles,
    since the frame is thin). **Holo picture**: on the picture. **Full holo**: both.
  - **Gold** (always): gold leaf flakes and the same holo in gold on the picture; the frame gets only a band of gold
    light across it.
  - **Full Art** (always): the rainbow holo over the whole card.
  - Order on the card: picture, picture holo, frame, frame holo, PDA 10 glow, text and seal, wear. The text and seal
    are never under the holo; wear scuffs land over the foil.
  - A saved image is drawn with the light from the upper left. Everything is seeded, so a look always renders the same
    pixels. The site draws the same holo live (moving with the mouse or finger) on raw cards.
- Each card type of a recipe uses one frame set: its frames, its text layout (set per frame set in Frames & Layout)
  and the characters' art for that set. A new type can reuse a set or get its own.
- **Adding a frame set**: put `<set>.png` in `frames-src/originals` and run
  `python3 frames-src/clean_frames.py` from `studio/`. Nothing else: the wear layers cover it. The studio finds the set by its files (set ids are lowercase
  letters and digits) and lists it in Frames & Layout, the Library (art slots) and each card type's Frames choice.
  Bump `FRAMES_UPDATED_AT` in `studio/src/frames.ts`. A type whose frames are missing blocks approval and the build.

## A Series' recipe

Set on the **Recipe** tab, per Series, and locked with the deal:

- **Card types**, any number: name (the Material trait, 1-64 bytes), slug (image file names, `[a-z0-9-]`, 1-32
  bytes, unique; follows the name until typed), rank (the rarity order the site shows), its **% of cards** (up to 2
  decimals, above 0), holo (two independent rolls, frame and picture, or a split in parts for plain / frame / picture /
  full) and its frame set. The types must add up to exactly 100%: the tab shows a running total ("Total 96.01% · 3.99%
  left to assign"), refuses anything else, and offers a one-click "Fill the rest into Paper" (the biggest type takes
  what's left, or gives up the extra).
- **Cards per pack**: 1 to 1,000.
- **Character odds** (Series tab): **All equal** by default (every character equally likely, no inputs). Turned off,
  each picked character gets a % of cards (starting equal), with the same total, "left to assign" and fill helper;
  they must add up to exactly 100% (the Deal and Export tabs block until they do). Exported as each character's
  `weight` in recipe.json only when they differ.
- **Percentages in, weights out:** the owner only ever sees percentages; odds everywhere read "3.99% · about 1 in 25
  cards". The contract takes whole-number weights: percent x 10,000 (100% = 1,000,000), with the zeros every weight
  shares dropped (same ratios), so the Standard still exports 5000 / 2415 / 1497 / 489 / 399 / 200 and 10 / 10 / 10 /
  70% exports 1 / 1 / 1 / 7 (`studio/src/recipe.ts` `percentsToWeights`, `simplifyWeights`). Saves store the
  percentages. Older saves with weights load as percentages (2 decimals, rounded so they add up to exactly 100%:
  `weightsToPercents`); a Series whose deal is locked also keeps its exact weights, so its odds and its recipe.json
  never change.
- **PDA odds** are fixed forever (the same for every Series) and shown read-only; recipe.json never carries them. A
  Series saved with its own odds drops them when it loads and uses the fixed ones.
- **Holo rolls** show at most 2 decimals (the exact stored value on hover); the stored value stays exact (the Standard
  rolls match `StandardRecipe` to the wei) until the field is edited.

The tab lists every problem the contract would refuse (no types, cards per pack, slugs, text, weights, holo). **What it
makes** (top of the tab, for the Series' packs and characters or any others typed in) shows each type's odds per card
and expected cards, and for every holo look how rare one exact card is on the site's scale (its chance per card dealt:
type x holo x character odds, "1 in N"; with character odds, the rarest character's too; Rare from 1 in 100, Epic
1 in 400, Legendary 1 in 1,000; `studio/src/rarity.ts` mirrors `trueOdds` / `Info.lookP`), and the exact chance a pack
holds at least one (and two or more) of each type: 1 - (1 - odds)^cards, the same for every pack. Packs of 42 or more
cards get a warning: free-pack credits (42 cards burned each) can't be spent on that Series. The Series tab shows the
same result. Presets: **Standard**, **Special: 3 cards, all holo** (Fire 68%, Coal 30%, Gold 2%; every card holo), or
a copy of another Series' recipe. Older saves load as odds: Series from before recipes get the old Standard (Diamond)
at its old shares; a recipe saved with the old pool rules (supply, slots) gets each type's weight from the cards its
rules gave for that Series' packs and characters, so its expected shares stay about the same.

**How many of each card** (Recipe tab under the card types, and the Series tab under the cast) shows what the Series
prints if the odds land exactly: total cards x type odds [x character odds] [x holo look odds]
(`studio/src/rarity.ts` `expectedCounts`). Each type reads "Gold · 3.99% · about 1 in 25 cards · ≈ 40 cards" with the total cards, each
character its "≈ N cards", and a grid of types x characters, optionally split by holo look (per type or per cell).
Counts under 10 get one decimal, others whole numbers; anything expected below 1 shows in red as "< 1, may not print".
The pack count is the Sale's base packs, with a "what if" field (not saved); packs sold after sell-out add more cards
at the same odds. Labelled "If the odds land exactly: expected counts. Real pulls will vary."

## The Standard recipe

Each Series stands alone: its cards come only from its own packs and nothing carries over. Every card is rolled on its
own (6 a pack):

| Material | recipe.json weight (of 10,000) | Per card |
|---|---|---|
| Paper | 5,000 | 50% |
| Wood | 2,415 | 24.15% |
| Fire | 1,497 | 14.97% |
| Coal | 489 | 4.89% |
| Gold | 399 | 3.99% |
| Full Art | 200 | 2% |

These keep the old pool dealing's expected share of each type for the example Series (167 packs, 20 characters: 501
Paper, 242 Wood, 150 Fire, 49 Coal, 40 Gold, 20 Full Art of 1,002). Real counts vary around the expectation, and any
pack can hold any mix (all Paper, or two Full Arts).

## Holo (Standard)

The chance a card is holo at all is 5 / 10 / 50 / 90% (Paper to Coal). It is two equal, independent rolls, one for a
holo frame and one for a holo picture, each at p = 1 - sqrt(1 - rate); both hitting is a **full holo**. Gold and Full
Art are always full holo.

| Material | Holo (any) | Each roll | Frame only | Picture only | Full holo |
|---|---|---|---|---|---|
| Paper | 5% | 2.53% | 2.47% | 2.47% | 0.064% (1 in ~1,560) |
| Wood | 10% | 5.13% | 4.87% | 4.87% | 0.26% (1 in ~380) |
| Fire | 50% | 29.3% | 20.7% | 20.7% | 8.6% |
| Coal | 90% | 68.4% | 21.6% | 21.6% | 46.8% |
| Gold, Full Art | 100% | - | - | - | 100% |

## PDA grade and wear

A card's condition is hidden until it is graded, once, through `FirePsa`; it is then sealed in a slab. Until then it
wears with time uncased and with moves between wallets, unless it is cased. Rules, fresh odds and prices:
`docs/grading.md` and `docs/omni-economy.md`. An ungraded card uses its clean frame and the seal shows "?". The grade
picks a wear level, each a full frame per material and holo variant:

| Wear level | Grades | Fresh odds |
|---|---|---|
| 1 | PDA 10 | 1% |
| 2 | PDA 9-8 | 30% + 40% |
| 3 | PDA 7-6 | 29% + wear only |
| 4 | PDA 5-4 | wear only |
| 5 | PDA 3-2 | wear only |
| 6 | PDA 1 | wear only |

Fresh odds are `FirePsa`'s constants (`freshOdds`), fixed forever for every Series; the studio shows them read-only.

- **PDA 10** uses the clean frame plus a thin warm-gold glow along the card's outer edge and a few small sparkles
  near the corners, drawn by the renderer on every material, never over the name panel, art or seal.
- **Case and slab:** a cased card is drawn inside a clear top-loader; a graded card inside a slab with a label
  (OMNI CARDS, the character, Series and material, the grade in its colour and its word). Both are drawn in code over
  the finished card, the same for every card (`studio/src/protect.ts`); the frames are never touched.
- **Readability:** on PDA 3-2 and 1, dark text gets a light outline so it reads over the scorch marks.
- **PDA seal:** a round wax seal on the right of the bottom panel, matched to each frame (Paper graphite, Wood walnut,
  Fire ember, Coal silver-graphite, Diamond icy crystal) with a thin gold rim, "PDA" small on top and the grade (or
  "?") in the middle. A graded seal gets a ring in the grade's colour: 10 green, 9-8 teal, 7-6 sky blue, 5-4 blue,
  3-2 orange, 1 red.

## Shared images

One image per character x card type x holo look x state within a Series. Each grade has its own image (the slab and
seal print the number), even where two grades share a wear layer. The image folder holds the full grid the recipe can
produce: every character x type x the holo looks that type can have (from its holo rule: a type that is always holo has
no `none` image, a 0% holo type only `none`) x 12 states (ungraded, cased, PDA 1 to 10
slabbed), WEBP only. Standard: 4 types x 4 holo looks + Gold + Full Art = 18 looks x 12 = **216 images** per
character; Special 3-card all-holo: (Fire 3 + Coal 3 + Gold 1) x 12 = 84. Every one is built before upload, since
cards are cased and graded on-chain later. Each Series
has its own "Forged · Series #" line, so images are never shared across Series.

## Collections

- **Omni Card Packs** (`FirePacks`, ERC-1155): one stackable token type per Series, so "Series 7 Sealed Pack x 3"
  lists and trades like any item. Pack art is `<packImageBase>fire<N>.webp`.
- **Omni Cards** (`FireCards`, ERC-721): every card unique, with character, category, material, holo, Series,
  print number, serial and PDA as traits (Material = the type's name). Ungraded cards add Cased, Dealt (a date) and
  Moves, plus Age when cased (days) once cased, with PDA "Ungraded"; graded cards show "PDA N" only. Image file names match the studio's export and
  `CardsRenderer.imageName`: `c<character>-<type slug>-<holo>-<state>.webp`, `holo` one of `none`, `frame`,
  `picture`, `full`, `state` `u` (ungraded), `c` (cased) or `1` to `10` (slabbed). Standard slugs are `paper`, `wood`,
  `fire`, `coal`, `gold`, `fullart`: `c0-wood-none-u.webp`, `c0-wood-none-c.webp`, `c2-gold-full-10.webp`.
  A Series' images lock when its drop is set up.

A pack's contents are decided only when it is opened: the pack is burned, drand randomness arrives about 90 seconds
later (the router commits to a drand round 90 to 93 seconds ahead) and each card is rolled from the Series' fixed odds. See
`docs/cards-contracts.md`.

## Studio workflow, per Series

1. **Library:** characters are saved and reused across Series. Search and pages keep hundreds manageable; **Add
   many** takes `Name, Category` lines and a drop of many images named `<character>__<frame set>.png` (one per
   material; Gold uses Wood's). A character can join a Series once it has the pictures that Series' recipe uses.
2. **Frames & Layout:** text fields' font, size and colour are set once per frame set; the art window is fixed by
   the frames.
3. **Series:** pick the characters (any number; their order is the image order c0, c1, ...). The pack count is the
   drop's total (base) packs, set on the Sale tab (one number: the expected counts use it). Character odds: All equal
   (the default), or each character's % of cards, adding up to 100%.
4. **Recipe:** card types with their odds, cards per pack, the contract's checks and the result (odds, expected
   counts, rarity, per-pack chances).
   **Sale** (next tab): the drop as **groups** (`docs/drop-groups.md`) for `FireSale.configureDrop`, in plain units.
   Work backwards from the total: set the total (base) packs, then split it into 1 to 6 groups, each a compact card
   added from a template (Paper Press holders, Coin holders (snapshot), NFT holders, Everyone, After sell-out (rising
   price)) and moved up/down or removed: name; packs as a count, a % of the total or "the rest" (one group); who
   (anyone, NFT holders: the Paper Press or a contract address + packs per NFT, or a snapshot list whose root the
   snapshot script fills in before launch); price in $ and PAPER; coins (PLANK/ETH/USDG); per wallet (and "limit lifts
   after (hours)", blank = never: 5 per wallet for Everyone's first 24 h, then no limit); opens with the
   drop or after an earlier group; max time (0 = until sold); leftovers to a later group or nowhere; rising price %
   and unlimited (needs a rising price and an idle end); behind "more": delay, per purchase, ends after N minutes
   with no sale. Each card ends with a one-line summary, and a taxed group shows packs 1, 10, 25 and 50 at the
   contract's `base × (1 + bps/10000)^k`. Above them: base packs, sell-out dollars (and with every free pack used),
   PAPER bought & burned (its share plus every tax), PLANK burned and the revenue wallet's part; a split bar by group
   and a timeline ("up to" times; until-sold groups fade, an unlimited group runs off the edge). Drop-wide: start,
   PLANK burn %, PAPER buy & burn %, PAPER ceiling $, packs per purchase, bots kept out (hours), credits per picked
   suggestion, free packs at most (% of the total) and per wallet, and the group they come from. Every rule
   ConfigureSeries checks is checked live, next to its field (the groups add up to the total, opens-after earlier /
   leftovers later, nothing rolls into an unlimited or taxed group, unlimited needs a rising price and idle and rolls
   nowhere, gate data, a price needs a coin, no free group open to everyone, times at most 30 days, a rise at most 50%
   and within the 1e9 price bound). Presets: Standard (the drop in `docs/drop-groups.md`) and Giant (10,000 packs,
   100 per wallet and per purchase, 3 per Press). Cards per free pack shows as fixed (42, forever). Old saves (paid +
   press packs) become a Paper Press group (its packs, per press, per wallet, window and price) rolling leftovers into
   an Everyone group (the paid packs at the old price and wallet limit), free packs from Everyone; a Series saved
   without sale settings gets the Standard drop resized to its packs.
5. **Deal:** a sample deal on the recipe (the contract's dealing with the studio's own randomness, up to 600,000
   cards), seeded by a string, dealt in a background worker. Locking it locks the recipe and advances the studio's own
   serial counter (not the contract's).
6. **Build & Review:** one sample per character x type x holo look renders for review (12 characters a page).
   **Approve all**, then **Build all images** builds the recipe's full grid in background workers; the count, size
   and time are estimated first, and checked against the browser's free storage (`navigator.storage.estimate()`). A
   stopped build resumes: the images already stored for the same grid key are kept, unless art, layouts or fonts
   changed since it started. Missing frames block approval and the build. A later asset, recipe or character change
   means building again.
7. **Export & Upload:** a readiness checklist (recipe valid, frames for every type, characters valid, deal locked,
   approved, the full grid built, sale settings valid, the sale's packs equal to the Series' or the locked deal's);
   **recipe.json** (what `contracts/script/ConfigureSeries.s.sol` reads: cards per pack, types, characters (with
   their weights if they have their own odds), `imagesBase` once
   uploaded, and the `sale` block; tied to the uploaded build; it warns until both pins are checked and the CAR is
   confirmed stored); a zip of the images, per-card metadata (preview only), `fire.json` and `recipe.json` (big Series
   in parts of at most 1.5 GB or 60,000 files, the metadata in its own parts, written straight into a folder the owner
   picks); or the upload to IPFS: Pinata, then a second pin of the same images on Filebase, then the images CAR saved
   offline. The screen keeps its copy short: one
   line per step, the buttons, and the two safety prompts (both pins must hold the same CID; save the CAR offline).

**Upload.** Each folder (images, then the preview metadata) is packed in the browser into one CAR file. Its root CID
(a UnixFS directory, CIDv1, sharded when large) is known before upload. The CAR goes to Pinata's v3 upload API with
`car: true` over its resumable (tus) protocol (`Tus-Resumable: 1.0.0`) in 50 MB pieces: a dropped connection or a
reload resumes where Pinata got to, and a folder Pinata already has (checked by its folder CID) is reused. When every
byte is in but no `upload-cid` came back, the studio asks for the upload's status (and the folder's CID) again, with
backoff, instead of sending the CAR again. The page must be able to read `Location`, `Upload-Offset` and `upload-cid`
from Pinata's answers (exposed to the browser). Pinata keeps exactly that folder, so its CID is the
single `imagesBase` the contract expects (`ipfs://<images CID>/`). The Pinata key (Files write permission) is typed in
per session and never stored. The legacy one-request folder upload is not used: it can't resume, and one folder
can't be built from several pins.

**manifest.json.** The images folder also holds `manifest.json`: every image's name, size and sha256, the studio's
grid key, and the recipe hash (sha256 of `recipe.json`'s fire, cardsPerPack, types and characters; `imagesBase` and
the sale block left out). VerifySeries (`ops/series`) reads it before the Series is locked.

**Filebase only.** Pinata's free plan refuses CAR uploads, so **Upload to Filebase only** sends the images CAR
straight to Filebase (same root CID, read back) with no Pinata pin; the offline CAR is the backup. A paid Pinata key
restores the two-pin upload below.

**Second pin (Filebase).** Right after Pinata, the same images CAR is pinned on Filebase through its S3-compatible API
(`https://s3.filebase.com`, object `<images folder>.car` with the `import: car` metadata), in 64 MB parts that resume
after a failure or a reload. Filebase reports the CID it pinned (it can take a few minutes after the upload: the studio looks it up with backoff
for about 6 minutes, never uploading again for it); it must equal the folder's root CID, which is also what Pinata
holds. Then both are read back (**Check both pins**). If no Filebase key was entered, **Pin to Filebase**
does it later. The Filebase access key, secret and bucket are typed in per session, like the Pinata JWT: memory only,
never stored or logged. One-time setup:
1. Filebase console: Buckets → Create bucket (network IPFS); Access Keys → a key that can write to it.
2. Let the studio's page reach the bucket (a CORS rule exposing `ETag` and `x-amz-meta-cid`), from `studio`:
   `node scripts/filebase-cors.mjs` (it asks for the key, the secret and the bucket; nothing is saved; `--origin` adds
   another address than `http://localhost:5173`).

**Offline copy.** Until the owner confirms it, the Export screen asks to **Save images CAR** (streamed to a file the
owner picks; Chrome or Edge, since the CAR is never collected in memory) and to keep it on a drive they keep. With that file the images can be pinned again anywhere (any
service's CAR upload, or `ipfs dag import`) and come back with the same CID, even if both pinning services drop them.

**Mock IPFS** (Data tab, or `?mockPinata` in the URL) covers Pinata and Filebase: nothing leaves the machine.

Only the images folder is used on-chain: `tokenURI` builds each card's JSON itself. The studio's per-card metadata is
for preview and reference only.

## Storage

Arweave (one-time, permanent) suits shared images; IPFS (Pinata, Storacha, Filebase) is the alternative. Decided
(review item 23): IPFS on two services, Pinata and Filebase, with the same CID, plus the CAR file kept offline. Check
current prices before launch.
