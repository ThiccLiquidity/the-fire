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
   rules; checked as you type) and their 10 images (Paper, Wood, Fire, Coal, Diamond, each normal and holo). Art on a
   flat magenta (#FF00FF) background can be keyed out, with Tolerance / Feather / Despill controls. Only complete
   characters (10/10) can join a Series.
2. **Frames & Layout:** the frames are built in. Per material, position the text boxes and the PDA seal and set font,
   size range, colour, outline and alignment. Custom .ttf/.otf/.woff2 fonts can be uploaded. **Preview** shows any
   card look.
3. **Series:** create a Series, pick its characters (at most 255, the contract's limit), packs (1 to 100,000) and
   Diamonds. The table shows the exact pool and the expected holos.
4. **Deal:** type or randomize the seed, check the pool (dealt in a background worker, so big Series don't freeze the
   tab), then **Lock deal** (blocked while the Series has 0 packs). Locking advances the studio's serial counter,
   which numbers the sample deal only; on-chain serials come from `FireCards` as packs are dealt. **Undo lock** works
   only for the latest Series before upload.
5. **Build & Review:** one sample per character x material x holo type renders for review. **Approve all**, then
   **Build all images**: the full grid, not just what the sample deal dealt (grades are revealed on-chain later, so
   every card's image must already exist). Per character: 4 materials x 4 holo types + Diamond x 3 (always holo) = 19
   looks, each in 11 grade states (ungraded, PDA 1-10, each with its wear frame and seal number; PDA 10 adds the gold
   glow) = **209 images per character**. WEBP only. It runs on a pool of workers, two images at a time, each saved to
   IndexedDB as it finishes, with progress and Cancel. **Check a built image** opens any image of the grid by
   character, material, holo and grade. Changing art, layouts or fonts afterwards requires approving again.
6. **Export & Upload:** **Download zip** (images, one ERC-721 metadata JSON per card, and `fire.json`, the deal
   record and the `configureFire` arguments), or **Upload to Pinata (IPFS)**. The Pinata JWT is kept in memory for
   the tab only. Images upload as one folder (`fire-<n>-images-<fingerprint>`), then the metadata folder
   (`fire-<n>-metadata-<last 10 characters of the images CID>`, so a rebuild never reuses old metadata); a failed
   upload resumes where it stopped.

### Image file names

`c<characterIndex>-<mat>-<holo>-<grade>.webp`, exactly what `FireCards.imageFile` builds on-chain:

- `characterIndex`: the character's position in the Series (the order passed to `configureFire`), 0-254.
- `mat`: a fixed id, not the display label: `paper`, `wood`, `fire`, `coal`, `diamond`.
- `holo`: `none`, `frame`, `picture` or `full`. Diamond has no `none`.
- `grade`: `u` while ungraded, else `1`-`10`.

E.g. `c0-wood-none-u.webp`, `c1-fire-frame-7.webp`, `c2-diamond-full-10.webp`. Always WEBP.

### What the upload is used for on-chain

Only the **images folder**. Its `ipfs://<images CID>/` is the `base` argument of `FireCards.configureFire` (stored
as `imagesBase`), and the contract's `tokenURI` builds every card's JSON itself, pointing at
`imagesBase + imageFile(card)`. The per-card metadata JSON (zip `metadata/` and the metadata folder on Pinata) is for
preview and reference only; wallets and marketplaces never read it.

**Testing without real art or a Pinata key:** Data → Dev / testing → **Load sample characters** creates three
placeholder characters, and **Mock Pinata** (or `?mockPinata` in the URL) fakes the upload with fake CIDs.

## Code map

| File | Purpose |
|---|---|
| `src/rules.ts` | Every game rule and number (materials, pool shares, holo rates, wear levels) |
| `src/categories.ts` | On-chain text rules (`textProblem`): character names (64 bytes) and categories (free text, 32 bytes, suggestions, old-save migration) |
| `src/deal.ts` | The sample deal as pure functions (`computePool`, `dealFire`); same output shape as the contract |
| `src/deal.worker.ts`, `src/dealPreview.ts` | The Deal tab's preview, dealt in a worker and debounced |
| `src/prng.ts` | Seeded randomness (SHA-256 counter mode) |
| `src/render.ts`, `src/renderCore.ts` | Card rendering (Canvas 2D, 1500 x 2100); builds run in `src/build.worker.ts` |
| `src/frames.ts` | The built-in frames (`src/assets/frames`, generated by `frames-src/clean_frames.py`) |
| `src/looks.ts` | Shared-image looks, the full per-Series grid (`seriesGrid`) and file names (`lookFileName`) |
| `src/metadata.ts` | ERC-721 metadata |
| `src/pinata.ts` | Pinata folder upload, with a mock transport |
| `src/chroma.ts` | Magenta chroma key |
| `scripts/pool-fixture.test.ts` | Writes `contracts/test/cards/pool-fixture.json` with `WRITE_POOL_FIXTURE=1`, for the contract parity test |
