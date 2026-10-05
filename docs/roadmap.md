# Status and roadmap

## Where things stand

| Part | Where | State |
|---|---|---|
| Card contracts | `contracts/src/cards` (FirePacks, FireCards, FireSale, FirePsa, CardRules) | Built and tested, three internal review rounds (`docs/audit-2026-10.md`). Not deployed. |
| Shared on-chain pieces | `contracts/src`: OpenDrandRouter, OpenVRFAdapter, PlankUsdTwap, PaperUsdTwap | Built and tested. Not deployed. |
| Deploy scripts | `contracts/script`: DeployTwap, DeployInfra, DeployCards | Runbook in `docs/deploy.md`. |
| Card Studio | `studio/` | Working end to end (library, Series setup, sample deal, full 209-image-per-character WEBP build, Pinata upload). Frames are built in. |
| Forge site | Source `web/art/factory/forge`, served from `web/public/forge` | Demo mode (demo banner, demo data), no chain connection yet. |
| Site modules for the live version | `web/src/lib`: chain/RPC config, wallet connection, drand helper, card ABIs, KyberSwap guard | Type-checked, not wired into the Forge yet. |
| Holder snapshot | `ops/snapshot` | Ready. |
| Economy sims | `sim/omni` | Done; recorded output in each folder. |

Naming: the card contracts are named `Fire*` for historical reasons (`Fire*` is the card system). In identifiers
(`configureFire`, `fire.json`), "fire" is a Series number.

## Open work before launch

1. **Keeper bot.** Required before the first drop. Every call is permissionless (see `ops/README.md`):
   - `PlankUsdTwap.checkpoint()` every 30 minutes
   - `PaperUsdTwap.checkpoint()` when `due()`
   - `FirePsa.pokePrice()` now and then
   - delivering drand numbers to the router (`OpenDrandRouter.fulfill`; `adapter.settle` if a callback didn't land)
   - `FireCards.process(maxOpens)` and `FirePsa.finish(index)` if the site doesn't call them
2. **Real wallet connection on the site.** Wire the Forge's buy, open, PDA, burn and suggestion screens to the
   deployed contracts through `web/src/lib`, replacing the demo store and the demo banner. Planned with it: loading
   each buyer's holder-window proof automatically, the "Get PAPER" box (KyberSwap, 0.5% fee), and calling
   `process(maxOpens)` and `finish(index)` right after randomness arrives.
3. **Series content.** Characters, their categories (free text, set in the Card Studio) and their 10 source images
   each, built (209 WEBP images per character) and uploaded with the Card Studio; pack art per Series. Lock each
   Series (`lockFire`) once its images are final.
4. **Large Series upload.** The studio uploads a Series' whole images folder to Pinata as one request (about 71 MB
   per character). Batch the upload for large Series.
5. **Real-chain gas test.** Run `contracts/test/cards/SaleFork.t.sol` against Robinhood Chain (real router gas and the
   real PLANK swap).
6. **On-chain checks.** PAPER (`0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6`) has 18 decimals; transfers to
   `0x…dEaD` work for PAPER and PLANK; a USDG/WETH V2 pool exists (otherwise the USDG burn share always goes to the
   burn wallet); PLANK's PulpPool reward-list status (`docs/addresses.md`).
7. **PAPER price feed timing.** `PaperUsdTwap` reports its first price about 40 hours after the keeper's first
   checkpoint. Deploy it and start the keeper early enough that PDA reveals are priced by launch, or accept the set
   PAPER amount until then.
8. **Testnet run** of every flow end to end, and a small first drop.
9. **Off-chain checks.** Marketplace support for Robinhood Chain, a trademark search for the name, and a legal
   read on selling sealed packs with random contents.

## Deploy-day inputs

Public addresses only; private keys stay in the Foundry keystore or a Ledger.

| Input | Used for |
|---|---|
| Deployer wallet | Deploys everything; has no powers once the multisig accepts ownership |
| `OWNER` multisig | Owns the card contracts and configures each Series |
| `REVENUE_WALLET`, `BURN_WALLET` | 70% of sales / fallback for the 30% burn share (must differ) |
| `ROYALTY_RECEIVER`, `ROYALTY_BPS` | Resale royalties on packs and cards (max 10%) |
| `SWAP_FEE_WALLET` in `web/src/lib/config.ts` | The site's 0.5% swap fee (no fee while unset) |
