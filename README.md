# Omni Forge

Omni Forge is a collectible NFT card game on Robinhood Chain. Cards are sold in sealed packs, one Series at a time.
PLANK fuels the forge (part of every sale buys and burns it) and every pack burns PAPER. Packs are opened with
drand randomness, so nobody can know a pack's contents in advance, and any card can be graded once (a PDA reveal)
for a wear frame and grade from 1 to 10.

Live site: https://web-mu-mocha-95.vercel.app (the Forge in demo mode: demo data, no wallet, no payments).

## Repository layout

| Path | What it is |
|---|---|
| `contracts/` | Foundry project: the card contracts (`src/cards`), the drand randomness router and adapter, and the PLANK and PAPER price feeds. Deploy scripts in `script/`. |
| `studio/` | Card Studio: a Vite + React + TypeScript app that builds the card images and metadata for each Series. |
| `web/` | The site. The Forge is served statically from `web/public/forge`; `web/src/lib` holds the chain, wallet, swap and contract-ABI modules for the live version. |
| `web/art/factory/` | Source for the Forge: the page code (`forge/`) and the pipeline that builds the workshop scene's art. |
| `sim/omni/` | Python models of the card economy (pack supply and pricing, PLANK, PAPER, card burns). |
| `ops/` | Operations tooling: the PLANK-holder snapshot for a drop's holder window. |
| `brand/` | Logos and the logo clean-up script. |
| `docs/` | Reference documentation (see below). |

**Naming.** The card contracts are named `Fire*` (`FirePacks`, `FireCards`, `FireSale`, `FirePsa`) for historical
reasons: `Fire*` means the card system. In identifiers (`fire`, `configureFire`, `lockFire`, `fire.json`), "fire" is a
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

After editing the Forge source in `web/art/factory/forge`, regenerate the served copy with
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
multisig accepting ownership and a keeper going live. See [`docs/deploy.md`](docs/deploy.md). Settings go in
`contracts/.env` (copy `contracts/.env.example`). Sign with a Foundry keystore (`--account`) or `--ledger`; never put
a private key in a file or on the command line.

The site deploys on Vercel from `main` with Root Directory `web`.

## Documentation

| Doc | Covers |
|---|---|
| [`docs/omni-economy.md`](docs/omni-economy.md) | Drops, prices, burns, starter packs, free pack credits, PDA reveal pricing and odds |
| [`docs/cards-contracts.md`](docs/cards-contracts.md) | The card contracts: pieces, the open/deal flow, safety properties, deployment wiring |
| [`docs/card-studio.md`](docs/card-studio.md) | Card rules (pool, pack slots, holo, wear) and how the studio builds a Series |
| [`docs/randomness.md`](docs/randomness.md) | The drand router: request flow, recovery paths, how to verify a number |
| [`docs/deploy.md`](docs/deploy.md) | Mainnet deploy runbook |
| [`docs/addresses.md`](docs/addresses.md) | Robinhood Chain addresses and on-chain findings |
| [`docs/audit-2026-10.md`](docs/audit-2026-10.md) | Internal security review: findings, fixes and accepted risks |
| [`docs/roadmap.md`](docs/roadmap.md) | Project status and open work before launch |

## Key properties

- **The contracts never hold funds.** Everything paid is forwarded or burned in the same transaction: 70% of a sale
  to the revenue wallet; the 30% burn share buys PLANK and burns it (or goes to the burn wallet if the swap can't go
  through). All PAPER spent is burned.
- **Randomness** comes from drand through an ownerless router that anyone can fulfill.
- **The owner is a multisig** that configures each Series and drop. What it can and can't change is listed in
  `docs/cards-contracts.md` and `docs/audit-2026-10.md`.
