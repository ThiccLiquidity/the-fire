# Audit prep: changes since the pre-testnet audit (26 Oct 2026)

**Baseline:** `667159f` "Pre-testnet audit fixes, PLANK/PAPER brand, demo pull boost" (24 Oct). That commit holds the
fixes from the last full review: round 8 in [audit-2026-10.md](audit-2026-10.md), and the "pre-testnet audit Oct 24"
in [launch-plan.md](launch-plan.md). Range reviewed: `667159f..2b59075` (26 commits), plus the studio fixes still
in the working tree (bottom of this page).

Look at the contract changes first. Two of them change the rules buyers rely on: the pack odds and the grade odds.

## Contracts (most important)

| Commit | What changed | What a reviewer should look at |
|---|---|---|
| **`7759cee`** CONTRACT | **Slots are back.** `RecipeDealer`/`RecipeCompiler`: `Recipe { types, slots }`. Each `Slot { count, weights[] }` rolls its cards' type from that slot's own weights. The per-type `weight` and `cardsPerPack` are gone (cards per pack = the slot counts added up). `oddsOf` is replaced by `slotsOf`. New `BadSlot` error. `RecipeSet` event gains a `slots` field. `StandardRecipe` is now 3 Paper, 1 Wood, 1 Wood or better, 1 Fire or better. `IDealer`, `ConfigureSeries.s.sol` and the recipe hash cover slots. | The plan layout (`TW` 6→5, new slot records `SW_HEAD`+types) and the `_dealRange` slot walk (`while (pos >= end)`): off-by-one at slot edges, `fromCard` ranges that start partway through a pack, and `deal` staying a pure function of the seed. Compiler checks: `count ≥ 1`, one weight per type, slot total > 0, total ≤ `MAX_CARDS_PER_PACK`, every type in some slot. The audit-8 L-2 recheck (`lockForSale`/`lockFire`/`ready`) still applies to the new shape. ABI break (`oddsOf` removed, `RecipeSet` changed): the site, ops and indexers must read the new form. Gas of `deal` for big packs. Fuzz: `RecipeFuzz.t.sol`. Parity: `StudioParity.t.sol`, image-parity vectors. |
| **`c2e533f`** CONTRACT | **Grade odds and wear.** `FirePsa` fresh odds 7/8/9/10 change from 29/40/30/1% to 27/40/30/3%. Time wear is now D ~ Poisson(6·years^0.6) (was 1.45·years^0.68), so a card wears much faster. New `NO_TEN_AFTER = 14 days`: after that, a card's grade-10 share moves to 9. The `WEAR_CDFS` table was regenerated. | Regenerate `WEAR_CDFS` from `contracts/test/cards/wear-model.py` and diff it byte for byte. `NO_TEN_AFTER` is compared with `age` (time since dealt, free day included), not `t` (time past the free day): check that matches the docs ("14 days uncased since dealt"). Odds still add up to 1e18 minus rounding after the 10→9 move. These constants are fixed forever, so the owner must sign off on the economics (grading revenue and the PAPER burn). The site's `wear.js` must match `oddsFor`. |
| `4d0914e` | Testnet redeploy (`deployments/46630.json`): new V2 router, OpenDrandRouter, PaperUsdTwap, every card contract, plus FireGroups and FireProfiles. | Testnet only. Run `VerifyDeploy` against these addresses and check the bytecode matches HEAD (that is, it includes `7759cee` and `c2e533f`). |
| `76c160d` | Testnet Series 1 data: `contracts/series/recipe-fire-1.json`, group-1 holders and snapshot file. | Data, not code. The recipe is in the slot form, and the holder root matches the snapshot. |

## Keeper / ops

| Commit | What changed | What a reviewer should look at |
|---|---|---|
| `b53684a` | The keeper returns `nextRoundIn` and wakes 1 s after the next drand round it is waiting on, not at the next interval. | The wait has a 1 s floor, and only future rounds count, so the keeper can't spin. Check RPC load with many opens waiting. |
| `e6988eb` | Keeper, ops and `paper/` refuse to run on a Node without the Brotli fix (CVE-2026-111497). CI and the Dockerfile pin a fixed Node. | Is the version table in `node-check.mjs` right? Does it fail closed on unknown majors below 26? |
| `b7506a0`, `94e49f6`, `d592c18` | `launch.mjs`: `--image-sample N` and `--skip-image-check`, both refused on chain 4663. VerifySeries gives up on a gateway that serves none of its first 12 images. | Both flags must be refused on mainnet, so the chain-id guard is the only thing standing between a skipped image check and a live Series. Check that nothing else sets `skipImages` or `sample`. |
| `9d06c2d`, `dfc01f9` | Snapshot: `LOGS_RPC` for the log searches, and a side-file `fromBlock`/step (Alchemy free plan). | A snapshot can quietly miss holders if the step or fromBlock is wrong. Compare against an explorer holder count. |
| `dc25605` | The rehearsal ignores a leftover `contracts/.env`. | Real keys must never leak into the rehearsal. |
| `91d9247`, `e99e385` | Weekly `npm audit` workflow with an accepted list. Vite 8.3.5 in the studio and web. | Check what is in `.github/security/accepted.json` and why. |

## Site live mode (`web/`)

| Commit | What changed | What a reviewer should look at |
|---|---|---|
| `6818ec7`, `8a4e577` | Card pictures go through the site's `/ipfs/:path*`, which rewrites to `ipfs.filebase.io` and is cached for a year (immutable). Fallbacks: dweb.link, then ipfs.io. | **This is an open proxy on the site's own origin:** any CID, including an HTML page, is served from the site's domain, which makes phishing or XSS possible against wallet users. Limit it to the Series image CIDs, or force image content types, `Content-Disposition` and a strict CSP on `/ipfs/`. |
| `d91f309`, `299619c` | Live holo: the site loads the studio's tilt layers (from the hard-coded `TILT` map for locked Series) and draws the moving holo, falling back to the finished image. | Tilt layers are off-chain and not checked against the on-chain images, so a wrong CID shows the wrong art (no funds at risk). Check that a failed load falls back cleanly. |
| `99288cc`, `2c8442a` | No JSON-RPC batching (the testnet RPC refused big batches). Card reads go 20 at a time. Burn picks stacks of exact copies. The reveal no longer hangs on a failed card read. | Load on the RPC (rate limits) for big wallets. The burn stack picker must send the exact ids picked. |
| `2b59075` | Burning 10 or more cards at once always asks for BURN to be typed. | Make sure no path skips the confirmation (for example "All Paper"). |
| `cbd896e` | Press group: held Presses are found through Blockscout (`erc721IdsOf`). | Explorer data is only used as a UI hint, and the contract still enforces ownership. It is capped at 20 pages. |
| `b53684a`, `9d6818a` | Open packs lists packs first and returns to a waiting open. Casing and grading UI. "Opens in 21 min" wording. | UI only. Check the CLAUDE.md rule: "Open packs" only shows when the wallet has packs that can open. |
| `7759cee`, `c2e533f` (web parts) | The site deals the demo by slots, reads `slotsOf`, and shows PDA odds and wear from the new model. | The shown odds must equal the on-chain `slotsOf` and `oddsFor`. The demo boost must stay demo-only. |
| `06ac1e1`, `9ffbad8` | Holo flips the shown rarity order. Rip video (pack-opening trailer). | UI only. Check the music licence (`ui/sfx/credits.json`). |

## Studio (`studio/`)

| Commit | What changed | What a reviewer should look at |
|---|---|---|
| `7759cee` | Slot editor (count plus "% of this slot" per type, fill helper), per-slot counts, `recipe.ts` rewrite, migration of old saves into slots. | `recipe.json` must match what `ConfigureSeries` sends (`recipe-parity.test.ts`, `StudioParity.t.sol`). A locked Series must keep its exact weights after migration. |
| `c2e533f` | Fresh PDA odds in the studio. | They must equal the `FirePsa` constants. |
| `d91f309` | Export writes tilt layers (`c<i>-<slug>-plain.webp`, `-print-<state>.webp`), plus "Upload tilt layers" for a locked Series. | The tilt folder is separate from the on-chain images folder, so the images CID and `recipe.json` are unchanged. |
| working tree (not committed) | Library: picture thumbnails no longer break. `useBlobUrl` now watches its blob and gets a fresh URL when the cached one is revoked (after an import or reload, a re-key, or a remove). A new picture or re-key now saves the slot before it deletes the old files. Export: a Filebase-only upload no longer uses Pinata wording. | Tests are in `studio/src/store.test.ts`. |
