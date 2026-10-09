# Status and roadmap

## Where things stand

| Part | Where | State |
|---|---|---|
| Card contracts | `contracts/src/cards` (FirePacks, FireCards, CardsRenderer, RecipeDealer, RecipeCompiler, FireSale, FireCredits, PlankBurner, FirePsa, PaperBurner) | Built and tested. Reviewed in rounds 5–8 (internal; `docs/audit-2026-10.md`), grading included (`docs/grading.md`); no external audit. Not deployed. |
| Shared on-chain pieces | `contracts/src`: OpenDrandRouter, OpenVRFAdapter, PlankUsdTwap, PaperUsdTwap | Built and tested. Not deployed. |
| Deploy scripts | `contracts/script`: DeployTwap, DeployInfra, DeployCards, AcceptOwnership, VerifyDeploy, ConfigureSeries, DevStack (testnet stand-ins) | Runbook in `docs/deploy.md` (mainnet, rehearsal, testnet). |
| Card Studio | `studio/` | Working end to end (library, Series setup, sample deal, full 216-image-per-character WEBP build with cases and slabs, Pinata upload). Frames are built in, Gold included (holo only, every wear level); the Full Art frames are still to come. |
| Cardworks site | Source `web/art/factory/forge`, served from `web/public/forge` | Demo mode (demo banner, demo data), no chain connection yet. Shows wear, cases and slabs (Case & grade). |
| Site modules for the live version | `web/src/lib`: chain/RPC config, wallet connection, drand helper, card ABIs, KyberSwap guard | Type-checked, not wired into Cardworks yet. |
| Holder snapshot | `ops/snapshot` | Ready. |
| Ops | `ops/keeper`, `ops/deploy/record.mjs`, `ops/series/verify-series.mjs`, `ops/rehearsal` | Built; the rehearsal runs every deploy step and the keepers on a local chain in CI. |
| Economy sims | `sim/omni` | Done; recorded output in each folder. |

Naming: the card contracts are named `Fire*` for historical reasons (`Fire*` is the card system). In identifiers
(`setDealer`, `fire.json`), "fire" is a Series number.

## Open work before launch

1. **Keeper bot.** Built (`ops/keeper`): two Railway services in different regions (main and backup), plus an
   optional GitHub Actions pass. Before the first drop: two funded gas-only wallets, the two services and their
   heartbeats (`ops/keeper/README.md`).
2. **Real wallet connection on the site.** Wire Cardworks' buy, open, case and grade, burn and suggestion screens to the
   deployed contracts through `web/src/lib`, replacing the demo store and the demo banner. Planned with it: loading
   each buyer's holder-window proof automatically, the "Get PAPER" box (KyberSwap, 0.5% fee), and calling
   `process(fire, maxCards)` and `finish(index, ids)` right after randomness arrives.
3. **Series content.** Characters, their categories (free text, set in the Card Studio) and their source images,
   built (216 WEBP images per character) and uploaded with the Card Studio; pack art per Series. The Full Art frames
   (the Gold frames are built). A Series' images lock when its drop is set up (`configureDrop`), so upload the
   final images first.
4. **Real-chain gas test.** Run `contracts/test/cards/SaleFork.t.sol` against Robinhood Chain (real router gas and the
   real PLANK swap).
5. **On-chain checks.** PAPER (`0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6`) has 18 decimals (the deploy scripts
   refuse otherwise); transfers to
   `0x…dEaD` work for PAPER and PLANK; a USDG/WETH V2 pool exists (otherwise the USDG burn share always goes to
   `PlankBurner`, which can't swap it either); PLANK's PulpPool reward-list status (`docs/addresses.md`).
6. **PAPER price feed timing.** `PaperUsdTwap` reports its first price about 40 hours after the keeper's first
   checkpoint. Deploy it and start the keeper early enough: until then packs take the set PAPER with no dollar ceiling, and
   case and grading fees wait in `PaperBurner`.
7. **Grading numbers.** Case and grading prices are not final until the last numbers audit (`docs/grading.md`).
8. **Testnet run** of every flow end to end, and a small first drop.
9. **Off-chain checks.** Marketplace support for Robinhood Chain, a trademark search for the name, and a legal
   read on selling sealed packs with random contents.

## Deploy-day inputs

Public addresses only; private keys stay in the Foundry keystore or a Ledger.

| Input | Used for |
|---|---|
| Deployer wallet | Throwaway hot wallet; deploys everything; has no powers once the owner accepts ownership |
| `OWNER` hardware wallet | One Ledger or Trezor; owns the card contracts and configures each Series |
| `REVENUE_WALLET` | 70% of sales (the 30% burn share falls back to the deployed PlankBurner, which has no withdraw) |
| `ROYALTY_RECEIVER`, `ROYALTY_BPS` | Resale royalties on packs and cards (max 10%) |
| `SWAP_FEE_WALLET` in `web/src/lib/config.ts` | The site's 0.5% swap fee (no fee while unset) |
