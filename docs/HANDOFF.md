# Handoff — where the work stands

Updated Oct 4 2026. The PLANK raffle ("The Fire" game) is dead for good and its code is gone (it's in git history
before this change). The project is **Omni Forge**: the card contracts, the Card Studio and the Forge site.

## Rules from the owner (ThiccLiquidity)

See `CLAUDE.md`. In short: show anything visual before it's committed; nothing merges to `main`, deploys or goes live
without his OK; keys never in chat or the repo; short, direct answers; he works in PowerShell
(`C:\Users\DubT1\the-fire`).

## Branches

- `main` — the live site on Vercel (root `web/`).
- `wip/pending-approval` — work in progress, mirrored to `claude/practical-gates-va0gq1`. Not merged.

## What's here

| Part | Where | State |
|---|---|---|
| Card contracts | `contracts/src/cards` (FirePacks, FireCards, FireSale, FirePsa, CardRules; "Fire" in the names is historical, a Fire = a Series) | Built and tested, internal audit `docs/audit-2026-10.md`. Not deployed. Design: `docs/cards-contracts.md`, `docs/omni-economy.md` |
| Shared on-chain pieces | `contracts/src`: OpenDrandRouter + OpenVRFAdapter (randomness, `docs/randomness.md`), PlankUsdTwap (FireSale's PLANK price), PaperUsdTwap (FirePsa's PAPER price) | Built and tested. Not deployed |
| Deploy | `contracts/script`: DeployTwap, DeployInfra, DeployCards | Runbook `docs/deploy.md` |
| Card Studio | `studio/` | Decisions `docs/card-studio.md`. Frames are locked |
| Forge site | Source `web/art/factory/forge` (+ `build3` art); served copy `web/public/forge` (`/` redirects there) | Mock, no chain yet. Plan `docs/factory-scene-plan.md` |
| Site modules for going live | `web/src/lib`: chain/RPC config, wallet connect, drand helper, card ABIs, KyberSwap guard (`checkSwap`) | Not wired to the Forge yet |
| Holder snapshot | `ops/snapshot` | Ready |
| Keeper | `ops/README.md` | **To build** (price checkpoints, drand deliveries) |
| Economy sims | `sim/omni` | Results in each folder |

## Refreshing the Forge copy

`web/public/forge` is a copy of `web/art/factory/forge` with `../build3/` rewritten to `a/`, and
`web/art/factory/build3` copied to `web/public/forge/a`. Redo the copy after changing the mock.

## Verify

```
cd contracts; forge test           # all pass
cd studio; npx tsc -b; npx vitest run
cd web; npm run build
```

## Before deploy (he fills these in on deploy day)

Public addresses only. Private keys go only into PowerShell (`Read-Host -AsSecureString`), the Foundry keystore or
the keeper box's hidden prompt.

| What | Used for | Status |
|---|---|---|
| Deployer wallet | Deploys everything; no powers after ownership moves to the multisig | He picks it |
| `OWNER` multisig | Owns the card contracts, sets up each Series | He picks it |
| Revenue / burn wallets | 70% of sales / fallback for the 30% burn share | He picks them (must differ) |
| Royalty receiver + bps | Resale royalties on packs and cards | He picks them |
| Swap fee wallet | `SWAP_FEE_WALLET` in `web/src/lib/config.ts` (0.5% swap fee) | He picks it |
| PAPER | `0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6` | Confirm 18 decimals and transfers to `0x…dEaD` on chain |
| Keeper | Checkpoints + drand deliveries | To build |
| Real-chain gas test | `test/cards/SaleFork.t.sol` against the live RPC | Not run yet |
| Go live | Forge wired to the deployed contracts | Only on his word |
