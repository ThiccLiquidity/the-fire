# Omni Cardworks

Omni Cardworks is a collectible NFT card game on Robinhood Chain. Cards are sold in sealed packs, one Series at a time.
Part of every sale and each pack's PAPER go into PAPER/PLANK liquidity that is locked for good
([`docs/liquidity-burn.md`](docs/liquidity-burn.md)). Packs are opened with drand randomness, so nobody can know a
pack's contents in advance. Cards wear while left uncased; a Case freezes a card, and PDA grading reveals its grade
(1 to 10) once and seals it in a Slab. Case and grading fees go to the same locked liquidity
([`docs/grading.md`](docs/grading.md)).

Live site: https://web-mu-mocha-95.vercel.app (Cardworks in demo mode: demo data, no wallet, no payments).

## Repository layout

| Path | What it is |
|---|---|
| `contracts/` | Foundry project: the card contracts (`src/cards`), the drand randomness router and adapter, and the PLANK and PAPER price feeds. Deploy scripts in `script/`. |
| `studio/` | Card Studio: a Vite + React + TypeScript app that builds the card images and metadata for each Series. |
| `web/` | The site. Cardworks is served statically from `web/public/forge`; `web/src/lib` holds the chain, wallet, swap and contract-ABI modules for the live version. |
| `web/art/factory/` | Source for Cardworks: the page code (`forge/`) and the pipeline that builds the workshop scene's art. |
| `sim/omni/` | Python models of the card economy (pack supply and pricing, PLANK, PAPER, card burns). |
| `ops/` | Operations tooling: the keeper (`ops/keeper`), the deploy recorder (`ops/deploy`), the Series check before lock (`ops/series`, VerifySeries), the full launch rehearsal on a local chain (`ops/rehearsal`, with the testnet kit `DevStack`) and the PLANK-holder snapshot for a drop's holder window (`ops/snapshot`). |
| `brand/` | Logos and the script that prepares them from `brand/originals`. |
| `docs/` | Reference documentation (see below). |

**Naming.** The card contracts are named `Fire*` (`FirePacks`, `FireCards`, `FireSale`, `FirePsa`) for historical
reasons: `Fire*` means the card system. In identifiers (`fire`, `setDealer`, `lockFire`, `fire.json`), "fire" is a
Series number. Prose says "Series".

## Quick start

**Contracts** (needs [Foundry](https://getfoundry.sh)):

```sh
cd contracts
forge build
forge test
```

**Card Studio** (needs Node.js 22.12+):

```sh
cd studio
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
```

**Site** (needs Node.js 20.19+ or 22.12+):

```sh
cd web
npm install
npm run dev        # http://localhost:5173, redirects to /forge/
npm run build
```

After editing Cardworks source in `web/art/factory/forge`, regenerate the served copy with
`web/art/factory/sync_forge.sh` (see `web/README.md`).

**Economy sims** (needs Python 3 with numpy):

```sh
cd sim/omni/paper
python3 paper_model.py   # a second; sim/omni/packs/sim_packs.py takes several minutes
```

Each folder in `sim/omni` has its model and its recorded output; most also have a `results.md`. See
`sim/omni/README.md`.

## Deploying

Deployment is a three-step Foundry runbook (`DeployTwap`, then `DeployInfra`, then `DeployCards`) followed by the
owner's hardware wallet accepting ownership (`AcceptOwnership`, checked by `VerifyDeploy`) and the keeper going live
(`ops/keeper`). Each Series is set up in two signings on that device with `ops/series` (VerifySeries) in between, and the whole launch can be rehearsed on a local
chain (`ops/rehearsal`) and run on the Robinhood Chain testnet (`DevStack` stand-ins, chain 46630). See
[`docs/deploy.md`](docs/deploy.md). Settings go in
`contracts/.env` (copy `contracts/.env.example`). The deployer signs with a Foundry keystore (`--account`), the owner with `--ledger` / `--trezor`; never put
a private key in a file or on the command line.

The site deploys on Vercel from `main` with Root Directory `web`.

## Documentation

| Doc | Covers |
|---|---|
| [`docs/omni-economy.md`](docs/omni-economy.md) | Drops, prices, burns, starter packs, free pack credits, case and grading prices |
| [`docs/liquidity-burn.md`](docs/liquidity-burn.md) | LiquidityBurner: how sale shares, PAPER and fees become locked PAPER/PLANK liquidity |
| [`docs/grading.md`](docs/grading.md) | Cases, PDA grading and slabs: hidden condition, wear rules, fresh odds, images, metadata |
| [`docs/cards-contracts.md`](docs/cards-contracts.md) | The card contracts: pieces, the open/deal flow, safety properties, deployment wiring |
| [`docs/card-studio.md`](docs/card-studio.md) | Card rules (the pack's slots and odds, holo, PDA wear) and how the studio builds a Series |
| [`docs/randomness.md`](docs/randomness.md) | The drand router: request flow, recovery paths, how to verify a number |
| [`docs/deploy.md`](docs/deploy.md) | Deploy runbook: mainnet, the local rehearsal and the testnet (46630) |
| [`docs/addresses.md`](docs/addresses.md) | Robinhood Chain addresses and on-chain findings |
| [`docs/audit-2026-10.md`](docs/audit-2026-10.md) | Internal security review (rounds 1–8): findings, fixes and accepted risks |
| [`docs/review-2026-10.md`](docs/review-2026-10.md) | The owner's strategic review: each decision and its status |
| [`docs/roadmap.md`](docs/roadmap.md) | Project status and open work before launch |

## Key properties

- **The sale contracts never hold funds.** Everything paid for packs is forwarded in the same transaction, in the coin
  paid: the group's PAPER and PLANK shares (Standard: 30%), any rising tax and each pack's PAPER go to
  `LiquidityBurner`; the rest (Standard: 70%) to the revenue wallet.
- **Case and grading fees all go to `LiquidityBurner`**; none goes to the team.
- **`LiquidityBurner` locks it all as liquidity.** The keepers run it: it buys PAPER or PLANK with what it holds, adds
  matching amounts to the PAPER/PLANK Uniswap V2 pool and sends the pool tokens to the dead address. Only a side worth
  over $100 burns outright. It has no withdraw; if a price guard says no, the coins wait for a later run.
- **Randomness** comes from drand through an ownerless router that anyone can fulfill.
- **The owner is one hardware wallet** (Ledger or Trezor; no multisig: nothing holds funds) that configures each Series and drop. It can pause buying and case/grading payments
  (never opening, dealing, transfers or finishing grades) and can't renounce ownership. What it can and can't change
  is listed in `docs/cards-contracts.md` and `docs/audit-2026-10.md`.
