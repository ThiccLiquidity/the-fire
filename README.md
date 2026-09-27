# The Fire

Buy tickets with PAPER and PLANK. PAPER burns. Half the PLANK burns, half feeds the fire. Every night a storm rolls in — a big fire survives, a small one dies. When the fire goes out, one ticket wins the pot.

- `docs/spec.md` — the design, numbers, and why. Start here.
- `docs/randomness.md` — which randomness provider to use on Robinhood Chain (OpenVRF).
- `contracts/` — Foundry project. `Fire.sol` is the game, `Profiles.sol` is names + pictures for wallets (picture bytes live in the event log, hash in storage). 44 tests.
- `web/` — the site (Vite + React). Runs on a built-in mock until the contract is deployed.
- `sim/` — the Python simulation the numbers came from.

## Working on it (PowerShell)

First time:

```powershell
git clone https://github.com/ThiccLiquidity/the-fire.git
cd the-fire\web
npm install
npm run dev        # http://localhost:5173
```

Push an update (site auto-deploys on Vercel from `main`):

```powershell
git add -A
git commit -m "what changed"
git push
```

## Setting up GitHub and Vercel (one time)

1. GitHub: create an empty repo `ThiccLiquidity/the-fire` (no README). Then from the project folder:
   ```powershell
   git remote add origin https://github.com/ThiccLiquidity/the-fire.git
   git branch -M main
   git push -u origin main
   ```
2. Vercel: **Add New Project → Import** `the-fire`. Set **Root Directory** to `web`. Framework auto-detects Vite. Deploy. Every push to `main` redeploys.

## Contracts

Foundry is only needed on the machine that deploys. Install: https://getfoundry.sh — or let Claude drive it.

```powershell
cd contracts
forge test                                  # run the suite
forge script script/Deploy.s.sol --rpc-url $env:RPC --broadcast --verify
```

Deploy env vars: copy `contracts/.env.example` to `contracts/.env` (details at the top of `script/Deploy.s.sol`). Site env vars: `web/.env.example`. Never put a private key in this repo; use `--account` (Foundry keystore) or `--ledger`.

## Security model, in one paragraph

The pot lives inside `Fire.sol`. There is no owner, no withdraw, no pause. PLANK only enters through ticket buys and only leaves through the rules (winner / burn / carry / tithe). ETH only leaves through `eatMillFromSeaport`, which pays only if the OpenSea listing fills and the mill is burned in the same transaction. Nobody can hand the fire a mill. The deploy wallet has no special powers after deployment.

## Before mainnet

- Confirm the Seaport 1.6 address on Robinhood Chain (the fire fills OpenSea listings through it).
- Pin the OpenVRF router address and consumer interface; test the adapter on Robinhood testnet (chain id 46630).
- Verify PAPER/PLANK decimals; set `ETH_PER_TICKET` and `MILL_BID_BASE` from launch-day prices.
- Light fire #1 small.
