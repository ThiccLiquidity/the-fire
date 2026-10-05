# Omni Forge

Collectible card packs on Robinhood Chain. PLANK feeds the forge, PAPER is what cards are printed on. Packs are sold
per Series, opened with drand randomness, and cards can get a PDA grade.

- `docs/HANDOFF.md` — where the work stands. Start here.
- `contracts/` — Foundry project: the card contracts (`src/cards`) and the shared randomness router and price feeds.
  See `contracts/README.md`.
- `studio/` — the Card Studio (card generator). See `studio/README.md` and `docs/card-studio.md`.
- `web/` — the site. The Forge is static in `web/public/forge` (source: `web/art/factory`); `web/src/lib` holds the
  chain, wallet, swap and card-ABI modules for going live.
- `ops/snapshot` — the PLANK-holder snapshot for a drop's holder window.
- `sim/omni` — the card economy models.

## Working on it (PowerShell)

```powershell
git clone https://github.com/ThiccLiquidity/the-fire.git
cd the-fire\web
npm install
npm run dev        # http://localhost:5173 (redirects to /forge/)
```

The site deploys on Vercel from `main` (Root Directory `web`). Nothing merges to `main` without the owner's OK.

## Contracts

Foundry is only needed on the machine that deploys. Install: https://getfoundry.sh

```powershell
cd contracts
forge test
```

Deploying is a runbook, not one command: `docs/deploy.md`. Deploy settings: copy `contracts/.env.example` to
`contracts/.env`. Never put a private key in this repo; use `--account` (Foundry keystore) or `--ledger`.

## Your money

- **The contracts never hold funds.** Whatever is paid is forwarded or burned in the same transaction: 70% of a sale
  to the revenue wallet, the burn share buys PLANK and burns it (or goes to the burn wallet if the swap can't go
  through). PAPER spent is burned. Details: `docs/omni-economy.md`, `docs/omni-money-map.html`.
- **Randomness** comes from drand through an ownerless router that anyone can fulfill (`docs/randomness.md`).
- **The owner is a multisig** that sets up each Series. What it can and can't change: `docs/cards-contracts.md`.
