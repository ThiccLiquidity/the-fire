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
(.zip)** makes a backup; **Import backup** restores it (replacing what's there). Built card images are not part of
the backup.

## Workflow

1. **Library:** add characters (name: 1 to 64 bytes of UTF-8, no `"`, `\` or control characters, the contract's
   rules; checked as you type) and their art: normal and holo for each frame set (Paper, Wood, Fire, Coal, Diamond,
   and any frame set added later). Art on a flat magenta (#FF00FF) background can be keyed out, with Tolerance /
   Feather / Despill controls. For hundreds of characters: search, pages, and **Add many** (`Name, Category` per line;
   drop many images named `<character>__<frame set>[__holo].png`, e.g. `Ember Fox__paper__holo.png`).
2. **Frames & Layout:** the frames are built in. Per frame set, position the text boxes and the PDA seal and set font,
   size range, colour, outline and alignment. Custom .ttf/.otf/.woff2 fonts can be uploaded. **Preview** shows any
   card look.
3. **Series:** create a Series, pick its characters (any number; their order is the image order) and packs. The table
   shows the exact pool and the expected holos.
4. **Recipe:** the Series' card types, slots and PDA odds (below), with the contract's checks and a pool preview.
5. **Deal:** type or randomize the seed, check the sample deal (dealt in a background worker, up to 600,000 cards),
   then **Lock deal** (it locks the recipe too). Locking advances the studio's serial counter, which numbers the sample
   deal only; on-chain serials come from `FireCards`. **Undo lock** works only for the latest Series before upload.
6. **Build & Review:** one sample per character x type x holo look renders for review (12 characters a page).
   **Approve all**, then **Build all images**: the recipe's full grid (below), with the image count, size and time
   estimated first. It runs on a pool of workers, two images at a time, each saved to IndexedDB as it finishes, with
   progress and Cancel. **Check a built image** opens any image of the grid. Missing frames block approval and the
   build; changing art, layouts, fonts, the recipe or the characters afterwards means approving and building again.
7. **Export & Upload:** a readiness checklist; **Download recipe.json** (for `ConfigureSeries.s.sol`); **Download
   zip** (images, one ERC-721 metadata JSON per card of the sample deal, `fire.json` and `recipe.json`; in parts of
   about 1.5 GB for big Series); or **Upload to Pinata (IPFS)**. The Pinata JWT (Files write permission) is kept in
   memory for the tab only.

### Recipes

A Series' recipe is the same thing `RecipeDealer` deals on-chain (`docs/cards-contracts.md`):

- **Card types**: name, slug (auto from the name until typed), rank, supply (share of the cards, per pack, exact
  count, or the filler), optional max per pack, holo (two independent rolls, or weights for none / frame / picture /
  full) and a frame set. Standard types use the Standard frame sets (Fire = `burning`, Coal = `charcoal`).
- **Slot groups**: count, the allowed types (a list or a rank range), must-holo. Cards per pack is their sum.
- **PDA odds**: 10 weights.

Presets: Standard (exactly `StandardRecipe.sol`), Special: 3 cards, all holo, or a copy of another Series' recipe.
The checks mirror `RecipeDealer.check` in the same order; the pool preview is a port of its pool and floor maths.
Series and backups from before recipes load with the Standard recipe and their Diamond setting.

A new card type needs a frame set: reuse one (e.g. Diamond's frames for a "Gold" placeholder) or build a new set with
`frames-src/clean_frames.py` (put `<set>.png`, `<set>-holo.png` in `frames-src/originals` and the worn versions in
`frames-src/originals/wear/l2..l6`, run `python3 frames-src/clean_frames.py`, bump `FRAMES_UPDATED_AT` in
`src/frames.ts`). The studio finds the new set by its files. Its text layout starts from a neutral default
(Frames & Layout).

### The image grid and file names

Every character x type x the holo looks that type can have (a type dealt only in must-holo slots has no `none`
image) x 11 grade states (ungraded, PDA 1-10). Standard: 209 images per character; Special all-holo: 99.

`c<characterIndex>-<type slug>-<holo>-<grade>.webp`, exactly what `FireCards.imageName` builds on-chain:

- `characterIndex`: the character's position in the Series (the order of `setCharacters`), from 0.
- `type slug`: the type's slug. Standard: `paper`, `wood`, `fire`, `coal`, `diamond` (names unchanged).
- `holo`: `none`, `frame`, `picture` or `full`.
- `grade`: `u` while ungraded, else `1`-`10`.

E.g. `c0-wood-none-u.webp`, `c1-fire-frame-7.webp`, `c2-diamond-full-10.webp`. Always WEBP.

### recipe.json

The shape `contracts/script/ConfigureSeries.s.sol` reads (`docs/cards-contracts.md`): `fire`, `imagesBase` (once the
images are uploaded), `types`, `slots`, `characters` (in image order) and `pdaOdds`. The script checks it against the
dealer and prints the owner's calls (setRecipe, setCharacters and appendCharacters in batches, setDealer,
setImagesBase, setOdds).

### Upload

Each folder (the images, then the preview metadata) is packed in the browser into one CAR (`src/car.ts`): a UnixFS
directory, CIDv1, raw leaves, HAMT-sharded when large, so its root CID is known before uploading. The CAR goes to
Pinata's v3 API (`uploads.pinata.cloud/v3/files`, `car: true`) over the resumable tus protocol in 50 MB pieces. The
upload URL is saved on the Series, so a failure or a reload resumes from the offset Pinata reports; a folder Pinata
already has (same CID) is reused, and the CID Pinata returns must match the local root. Nothing is held in memory:
the CAR is hashed once for its CID and size, then rebuilt byte for byte as it is sent. The metadata folder is named
after the images CID (`fire-<n>-metadata-<last 10 characters>`).

On-chain, only the **images folder** is used: `ipfs://<images CID>/` is the Series' `imagesBase` (in recipe.json,
`FireCards.setImagesBase`), and `tokenURI` builds every card's JSON itself. The per-card metadata JSON is for preview
and reference only.

**Testing without real art or a Pinata key:** Data → Dev / testing → **Load sample characters** creates three
placeholder characters, and **Mock Pinata** (or `?mockPinata` in the URL) runs the whole upload locally (real CIDs,
nothing stored).

## Code map

| File | Purpose |
|---|---|
| `src/recipe.ts` | Recipes: presets, the contract's checks (`checkRecipe`), pool maths (`previewPool`), holo looks, `recipe.json` |
| `src/rules.ts` | Standard numbers (materials, holo rates, wear levels, limits) |
| `src/series.ts` | What a Series needs: art per frame set, missing frames, readiness, build fingerprint |
| `src/categories.ts` | On-chain text rules (`textProblem`): character names (64 bytes) and categories (free text, 32 bytes, suggestions, old-save migration) |
| `src/deal.ts` | The sample deal on a recipe (`dealFire`); `computePool` is the original Standard pool |
| `src/migrate.ts` | Saves and backups from before recipes get the Standard recipe |
| `src/deal.worker.ts`, `src/dealPreview.ts` | The Deal tab's preview, dealt in a worker and debounced |
| `src/prng.ts` | Seeded randomness (SHA-256 counter mode) |
| `src/render.ts`, `src/renderCore.ts` | Card rendering (Canvas 2D, 1500 x 2100); builds run in `src/build.worker.ts` |
| `src/frames.ts` | The built-in frame sets (`src/assets/frames`, generated by `frames-src/clean_frames.py`) |
| `src/looks.ts` | Shared-image looks, the recipe's full grid (`seriesGrid`) and file names (`lookFileName`) |
| `src/metadata.ts` | ERC-721 metadata |
| `src/car.ts`, `src/pinata.ts` | CAR folders and the resumable Pinata upload, with a mock transport |
| `src/chroma.ts` | Magenta chroma key |
| `scripts/pool-fixture.test.ts` | Writes `contracts/test/cards/pool-fixture.json` with `WRITE_POOL_FIXTURE=1`, for the contract parity test |
| `scripts/recipe-parity.test.ts` | Checks `recipe.ts` against `RecipeDealer` on 400+ recipes in recipe.json shape (`scripts/fixtures/recipe-parity.json`) |
| `scripts/contract-parity.sh` | Refreshes that fixture with forge, on a scratch copy of `contracts/` (`scripts/forge/StudioParity.t.sol`) |
