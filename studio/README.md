# Card Studio

A standalone NFT card generator for The Series. It runs entirely in your browser: no server, no account. Your
characters, frames, layouts, fonts, Series and the global serial counter are saved in the
browser's local database (IndexedDB) on your machine, and they survive reloads and restarts.

Decisions it follows are in `docs/card-studio.md`.

## Run it (Windows PowerShell)

You need Node.js 20 or newer (https://nodejs.org, the LTS installer).

```powershell
cd studio
npm install      # first time only (and after pulling updates)
npm run dev
```

Open the URL it prints (usually http://localhost:5173) in Chrome or Edge. Leave the PowerShell window open while
you work and press `Ctrl+C` in it to stop.

Use the same browser and the same URL every time: the library is stored per browser and per address. To move to
another machine or browser, or just to keep a backup, go to **Data → Export library (.zip)**, then
**Import backup** on the other side. Import replaces everything there. Built card images aren't included in the
backup; rebuild them in Build & Review if you still need them.

## One-time setup

1. **Library.** Add each character and drop in its 10 images: Paper, Wood, Burning, Charcoal, Diamond, each as
   normal and holo. Art on a flat magenta (#FF00FF) background is detected and keyed out automatically; use the
   **Key out magenta** toggle and the Tolerance / Feather / Despill sliders to tune the edge. The badge shows n/10;
   only 10/10 characters can go into a Series.
2. **Frames & Layout.** For each material, drop a normal and a holo frame (1500 x 2100 PNG; other sizes are scaled
   to fit with a warning). Then drag the boxes on the preview (body to move, orange corner to resize): art window,
   name, material label, edition line, serial and PDA badge. Pick font, max/min size (text shrinks to fit the box),
   colour, outline, alignment and uppercase per text box; fit (cover/contain), scale and offset for the art; and
   whether the art sits behind the frame (frame has a transparent window) or above it. **Save** each material, or
   **Copy to all materials** once one looks right. Upload your own .ttf/.otf/.woff2 fonts at the bottom.

## Every Series

1. **Series** tab: **New Series**, tick the characters for this Series, enter the packs and the Diamonds (at least
   1). The table shows what this Series will make: the cards per material (exact; each Series stands alone) and the
   holos to expect (about; holo is random per card).
2. **Deal** tab: type or **Randomize** the seed (the stand-in for the drand round), check the pool and holo counts,
   then **Lock deal**. Locking moves the global serial counter on. **Undo lock** works only for
   the latest Series, before it's uploaded.
3. **Build & Review**: one sample card renders for every character x material x holo type. Click any to see it big.
   When they look right, **Approve all**. Then **Build all** renders every card (WEBP or PNG). The list below has
   filters and counts. If you change art, frames, layouts or fonts afterwards, the studio asks you to approve and
   build again.
4. **Export & Upload**: **Download zip** gives every card image, one ERC-721 metadata JSON per card and `fire.json`
   (the deal record). For IPFS, paste your Pinata JWT (kept in memory for this tab only, never saved; you re-enter it
   after a reload) and **Upload to Pinata**. Images go up as one folder, then the metadata folder pointing at them.
   The CIDs are saved on the Series. If anything fails, press the button again: finished steps are skipped.

## Testing without real art or a Pinata key

**Data → Dev / testing → Load sample assets** creates placeholder frames and three placeholder characters on magenta
(all labelled PLACEHOLDER). **Mock Pinata** (or open the app with `?mockPinata` in the URL) fakes the upload with fake
CIDs, and can be told to fail so you can try the resume path.

## For developers

```powershell
npm test           # vitest: deal rules, chroma key, Pinata upload flow (mock)
npm run build      # tsc -b && vite build
```

- `src/deal.ts`: the sample deal as pure functions, `dealFire(input) -> DealResult`. The pack contract's result
  replaces it later in the same shape. The randomness is in `src/prng.ts` (SHA-256 counter mode, seeded by string).
- `src/render.ts`: assets + layout + card -> canvas / Blob (Canvas 2D, 1500 x 2100). Builds run in Web Workers
  (`src/build.worker.ts`, OffscreenCanvas).
- `src/wear.ts`: the swappable PDA wear step. It's a no-op for now; two stub approaches are described there.
- `src/pinata.ts`: the upload (Pinata `pinFileToIPFS`, folder upload) with a mock transport.
