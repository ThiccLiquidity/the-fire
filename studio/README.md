# Card Studio

A browser app that builds the Omni Cards images and metadata for each Series. It runs entirely client-side: no
server, no account. Characters, layouts, fonts, Series and the studio's serial counter are stored in the browser's
IndexedDB and survive reloads. Card rules and design decisions: `docs/card-studio.md`.

## Run

Requires Node.js 22.12+ (Vite 8). Use Chrome or Edge: builds encode WEBP with OffscreenCanvas in workers.

```sh
npm install
npm run dev        # http://localhost:5173 (Chrome or Edge)
npm test           # vitest
npm run build      # tsc -b && vite build
```

Data is stored per browser and per address, so use the same browser and URL each time. **Data → Export library
(.zip)** makes a backup (saved straight to a file you pick); **Import backup** restores it (replacing what's there),
reading the zip in pieces. Built card images are not part of the backup.

## Workflow

1. **Library:** add characters (name: 1 to 64 bytes of UTF-8, no `"`, `\`, control characters or DEL, the contract's
   rules; checked as you type) and their art: normal and holo for each frame set (Paper, Wood, Fire, Coal, Gold, Full
   Art, Diamond for older Series, and any frame set added later). Art on a flat magenta (#FF00FF) background can be
   keyed out, with Tolerance / Feather / Despill controls. For hundreds of characters: search, pages, and **Add many**
   (`Name, Category` per line; drop many images named `<character>__<frame set>[__holo].png`, e.g.
   `Ember Fox__paper__holo.png`).
2. **Frames & Layout:** the frames are built in. Per frame set, position the text boxes and the PDA seal and set font,
   size range, colour, outline and alignment. Custom .ttf/.otf/.woff2 fonts can be uploaded. **Preview** shows any
   card look.
3. **Series:** create a Series and pick its characters (any number; their order is the image order). Its packs are
   the sale's (paid + press, set on the Sale tab). Each picked character has optional odds (a weight, 1 by default:
   every character equally likely). The table shows each type's odds and the expected cards and holos.
4. **Recipe:** the Series' card types, their odds and cards per pack (below), with the contract's checks and an odds
   preview. PDA odds are
   fixed (FirePsa) and shown read-only. Packs of 42 or more cards get a warning: free-pack credits can't be spent on
   them. **Sale:** the drop's settings for `FireSale.configureDrop` (paid and press packs, price, PAPER, windows,
   limits, free-pack caps); the pack price is always above 0 (unclaimed press packs sell at it).
5. **Deal:** type or randomize the seed, check the sample deal (dealt in a background worker, up to 600,000 cards),
   then **Lock deal** (it locks the recipe too). Locking advances the studio's serial counter, which numbers the sample
   deal only; on-chain serials come from `FireCards`. **Undo lock** works only for the latest Series before upload.
6. **Build & Review:** one sample per character x type x holo look renders for review (12 characters a page).
   **Approve all**, then **Build all images**: the recipe's full grid (below), with the image count, size and time
   estimated first, and the browser's free storage checked against it. It runs on a pool of workers, two images at a
   time, each saved to IndexedDB as it finishes, with progress and Cancel. A stopped build resumes: the images already
   stored for the same grid are kept (unless art, layouts or fonts changed). **Check a built image** opens any image of
   the grid. Missing frames block approval and the build; changing art, layouts, fonts, the recipe or the characters
   afterwards means approving and building again.
7. **Export & Upload:** a readiness checklist (including the sale's packs matching the Series); **Download
   recipe.json** (for `ConfigureSeries.s.sol`; it warns until both pins are checked and the CAR is stored offline);
   **Download zip** (images, one ERC-721 metadata JSON per card of the sample deal, `fire.json` and `recipe.json`; big
   Series in parts of at most 1.5 GB or 60,000 files, the metadata in its own parts, written into a folder you pick);
   or **Upload**: Pinata, then a second pin of the same CAR on Filebase, then **Save images CAR** offline (streamed to
   a file: Chrome or Edge). The Pinata JWT (Files write permission) and the Filebase key are kept in memory for the
   tab only.

### Recipes

A Series' recipe is the same thing `RecipeDealer` deals on-chain (`docs/cards-contracts.md`):

- **Card types**: name, slug (auto from the name until typed), rank (the rarity order the site shows), holo (two
  independent rolls, or weights for none / frame / picture / full) and a frame set. Standard types use the Standard
  frame sets (Fire = `burning`, Coal = `charcoal`).
- **Slots** (the pack's shape, in order): each slot's number of cards and each type's % of that slot's cards (blank =
  never in that slot; each slot adds up to exactly 100%). Cards per pack = the slots' cards added up (1 to 1,000).
  Every pack has the same shape and every card is rolled on its own from its slot's odds: no pool or caps, so the first
  and the last pack have the same odds. Standard: 3 Paper · 1 Wood · 1 Wood or better · 1 Fire or better.
- **Character odds** (Series tab): optional weights; none = every character equally likely.
- **PDA odds**: fixed in `FirePsa` for every Series, shown read-only (never in recipe.json).

Presets: Standard (exactly `StandardRecipe.sol`), Special: 3 cards, all holo, or a copy of another Series' recipe.
The checks mirror `RecipeCompiler.compile` in the same order. Series and backups from before recipes load with the old
Standard (Diamond) recipe; recipes saved with straight odds (one % per type) load as one slot of their cards per pack
at those odds; recipes saved with the old pool rules load as slots (each old slot group over the types it held, at the
cards their rules gave).

A new card type needs a frame set: reuse one or build a new set with `frames-src/clean_frames.py` (put `<set>.png`,
`<set>-holo.png` in `frames-src/originals`, run `python3 frames-src/clean_frames.py`, bump `FRAMES_UPDATED_AT` in
`src/frames.ts`). PDA wear needs nothing per set: the same wear layers (`frames-src/wear_overlays.py`) go over every
card. Full Art has no frame. The studio finds the new set by its files. Its text layout starts from a neutral default
(Frames & Layout).

### The image grid and file names

Every character x type x the holo looks that type's holo odds allow x 12 states (ungraded, cased, PDA 1-10 slabbed). Standard: 216 images per character; Special all-holo: 84.

`c<characterIndex>-<type slug>-<holo>-<state>.webp`, exactly what `CardsRenderer.imageName` builds on-chain:

- `characterIndex`: the character's position in the Series (the order of `setCharacters`), from 0.
- `type slug`: the type's slug. Standard: `paper`, `wood`, `fire`, `coal`, `gold`, `fullart`.
- `holo`: `none`, `frame`, `picture` or `full`.
- `state`: `u` (ungraded), `c` (cased) or `1`-`10` (slabbed).

E.g. `c0-wood-none-u.webp`, `c0-wood-none-c.webp`, `c1-fire-frame-7.webp`, `c2-gold-full-10.webp`. Always WEBP.

### recipe.json

The shape `contracts/script/ConfigureSeries.s.sol` reads (`docs/cards-contracts.md`): `fire`, `imagesBase` (once the
images are uploaded), `cardsPerPack`, `types` (each with its `weight`), `characters` (in image order; each with a
`weight` only when the characters have their own odds) and the `sale` block. No PDA odds: they are fixed
in FirePsa, the same for every Series. The script checks it against the dealer and prints the owner's calls
(setRecipe, setCharacters and appendCharacters in batches, setCharacterWeights if weighted, setDealer, setImagesBase,
then configureDrop).

### Upload

Each folder (the images, then the preview metadata) is packed in the browser into one CAR (`src/car.ts`): a UnixFS
directory, CIDv1, raw leaves, HAMT-sharded when large, so its root CID is known before uploading. The CAR goes to
Pinata's v3 API (`uploads.pinata.cloud/v3/files`, `car: true`) over the resumable tus protocol in 50 MB pieces
(`Tus-Resumable: 1.0.0`). The upload URL is saved on the Series, so a failure or a reload resumes from the offset
Pinata reports; a folder Pinata already has (same CID) is reused, and the CID Pinata returns must match the local root.
If the last piece is answered without `upload-cid`, the studio asks for the upload's status again instead of sending
the CAR again. The page must be able to read `Location`, `Upload-Offset` and `upload-cid` from Pinata's answers.
Nothing is held in memory: the CAR is hashed once for its CID and size, then rebuilt byte for byte as it is sent. The metadata folder is named
after the images CID (`fire-<n>-metadata-<last 10 characters>`).

Then the same images CAR is pinned on **Filebase** (S3 API, `import: car`, 64 MB parts that resume; `src/filebase.ts`):
Filebase must report the same root CID (the studio waits for it with backoff after the upload completes, for several
minutes, without uploading again). **Check both pins** reads both back. **Save images CAR** keeps a copy offline: with it
the images can be pinned again anywhere with the same CID. The bucket needs a CORS rule once
(`node scripts/filebase-cors.mjs`; `docs/card-studio.md`).

On-chain, only the **images folder** is used: `ipfs://<images CID>/` is the Series' `imagesBase` (in recipe.json,
`FireCards.setImagesBase`), and `tokenURI` builds every card's JSON itself. The per-card metadata JSON is for preview
and reference only.

**Testing without real art or a Pinata key:** Data → Dev / testing → **Load sample characters** creates three
placeholder characters, and **Mock IPFS** (or `?mockPinata` in the URL) runs the whole upload, Pinata and Filebase,
locally (real CIDs, nothing stored).

## Code map

| File | Purpose |
|---|---|
| `src/recipe.ts` | Recipes: presets, the contract's checks (`checkRecipe`), odds (`typeOdds`, `characterOdds`, `holoOdds`), holo looks, `recipe.json` |
| `src/rules.ts` | Standard numbers (materials, holo rates, wear levels, limits) |
| `src/series.ts` | What a Series needs: art per frame set, missing frames, readiness, build fingerprint |
| `src/categories.ts` | On-chain text rules (`textProblem`): character names (64 bytes) and categories (free text, 32 bytes, suggestions, old-save migration) |
| `src/deal.ts` | The sample deal on a recipe (`dealFire`): every card rolled from the odds |
| `src/rarity.ts` | What a recipe makes: odds per type, "1 in N" per exact card (character weights included), per-pack chances |
| `src/migrate.ts` | Older saves and backups: old pool recipes to odds, the free-pack cap as a percent, packs from the sale |
| `src/deal.worker.ts`, `src/dealPreview.ts` | The Deal tab's preview, dealt in a worker and debounced |
| `src/prng.ts` | Seeded randomness (SHA-256 counter mode) |
| `src/render.ts`, `src/renderCore.ts` | Card rendering (Canvas 2D, 1500 x 2100); builds run in `src/build.worker.ts` |
| `src/frames.ts` | The built-in frame sets (`src/assets/frames`, generated by `frames-src/clean_frames.py`) |
| `src/looks.ts` | Shared-image looks, the recipe's full grid (`seriesGrid`) and file names (`lookFileName`) |
| `src/metadata.ts` | ERC-721 metadata |
| `src/car.ts`, `src/pinata.ts` | CAR folders and the resumable Pinata upload, with a mock transport |
| `src/filebase.ts`, `src/sigv4.ts` | The second pin on Filebase (S3 multipart, CAR import), with a mock |
| `src/sale.ts` | The drop's settings (`FireSale.configureDrop` checks) and recipe.json's `sale` block |
| `src/files.ts`, `src/backup.ts` | Streaming zips (export parts, backups) and the save pickers |
| `src/chroma.ts` | Magenta chroma key |
| `scripts/recipe-parity.test.ts` | Checks `recipe.ts` against `RecipeDealer` (verdict, weights, holo odds) on 400+ recipes in recipe.json shape (`scripts/fixtures/recipe-parity.json`) |
| `scripts/contract-parity.sh` | Refreshes that fixture with forge, on a scratch copy of `contracts/` (`scripts/forge/StudioParity.t.sol`) |
