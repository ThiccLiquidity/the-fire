# Status and roadmap

## Where things stand

| Part | Where | State |
|---|---|---|
| Card contracts | `contracts/src/cards` (FirePacks, FireCards, FireSale, FirePsa, CardRules) | Built and tested, two internal review rounds (`docs/audit-2026-10.md`). Not deployed. |
| Shared on-chain pieces | `contracts/src`: OpenDrandRouter, OpenVRFAdapter, PlankUsdTwap, PaperUsdTwap | Built and tested. Not deployed. |
| Deploy scripts | `contracts/script`: DeployTwap, DeployInfra, DeployCards | Runbook in `docs/deploy.md`. |
| Card Studio | `studio/` | Working end to end (library, Series setup, sample deal, build, Pinata upload). Frames are built in. |
| Forge site | Source `web/art/factory/forge`, served from `web/public/forge` | Demo data, no chain connection yet. |
| Site modules for the live version | `web/src/lib`: chain/RPC config, wallet connection, drand helper, card ABIs, KyberSwap guard | Type-checked, not wired into the Forge yet. |
| Holder snapshot | `ops/snapshot` | Ready. |
| Economy sims | `sim/omni` | Done; results in each folder. |

Naming: "Fire" in contract and studio identifiers (`FireSale`, `configureFire`, `fire.json`) is the historical name
for a Series.

## Open work before launch

1. **Keeper bot.** Required before the first drop: `PlankUsdTwap.checkpoint()` every 30 minutes,
   `PaperUsdTwap.checkpoint()` when `due()`, `FirePsa.pokePrice()` now and then, and delivering drand numbers for
   opens and reveals (`OpenDrandRouter.fulfill`, `adapter.settle`). Every call is permissionless. See `ops/README.md`.
2. **Real wallet connection on the site.** Wire the Forge's buy, open, PDA, burn and suggestion screens to the
   deployed contracts through `web/src/lib`, replacing the demo store.
3. **Series content.** Characters and their 10 images each, built and uploaded with the Card Studio; pack art per
   Series.
4. **Real-chain gas test.** Run `contracts/test/cards/SaleFork.t.sol` against Robinhood Chain (real router gas and the
   real PLANK swap).
5. **On-chain checks.** PAPER (`0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6`) has 18 decimals; transfers to
   `0x…dEaD` work for PAPER and PLANK; a USDG/WETH V2 pool exists (otherwise the USDG burn share always goes to the
   burn wallet).
6. **Testnet run** of every flow end to end, and a small first drop.
7. **Off-chain checks.** Marketplace support for Robinhood Chain, a trademark search for the name, and a legal
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
