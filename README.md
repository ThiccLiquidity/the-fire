# The Fire

Buy tickets with PAPER and PLANK. PAPER burns. All the PLANK goes into the fire's pot. Every day at 21:00 UTC (2:00 PM MST) a storm rolls in — a big fire survives, a small one dies. When the fire goes out, one ticket wins the pot.

- `docs/spec.md` — the design, numbers, and why. Start here.
- `docs/randomness.md` — where the daily number comes from (drand, through our ownerless `OpenDrandRouter`) and how to verify a roll.
- `contracts/` — Foundry project. `Fire.sol` is the game, `Profiles.sol` is names + pictures for wallets (picture bytes live in the event log, hash in storage). 124 tests at the Sep 29 audit (two suites run against a real drand proof and real Seaport 1.6 code). See `contracts/README.md`.
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
```

Deploying is a runbook, not one command: `docs/deploy.md`.

Deploy env vars: copy `contracts/.env.example` to `contracts/.env` (details at the top of `script/Deploy.s.sol`). Site env vars: `web/.env.example`. Never put a private key in this repo; use `--account` (Foundry keystore) or `--ledger`.

## Your money

- **Nobody runs the contract.** No owner, no admin, no pause, no upgrade, no withdraw function. The deploy wallet has
  no powers once it's deployed.
- **A buy takes only what it says, only from you.** It pulls tokens from the wallet that sends it, and only the ticket
  price for the tickets in that buy. Every buy carries the most you agreed to pay; if the price moved past it, the buy
  fails and nothing is taken. Extra ETH comes straight back. The site asks for an exact approval for each buy, never an
  open-ended one.
- **Where it goes:** PAPER is burned. All your PLANK goes into the pot; 25% of every pot that pays out is burned. The $1 in ETH or USDG goes to
  the press fund, which can only buy a press at or under the fire's bid and burn it in the same transaction.
- **The pot only leaves by the rules:** when the fire goes out, 40% to the winner, 25% burned, 5% to the Paper Press
  royalty pool, 30% to the next fire. If the prize can't be sent, it waits for the winner to `claim` it.
- **If the randomness dies for 7 days** (counted from that day's first roll; rerolls don't restart it), anyone can end the game and every ticket holder of the current fire takes back
  their share of the pot with `refund`.
- **Out of our control:** the PLANK and USDG token contracts' own rules; the Paper Press contract's admin (it can pause the
  press contract, and decides whether the royalty pool counts PLANK); Chainlink's ETH/USD feed (if it stops, the ETH
  option closes, the PLANK price holds, and the press fund can only spend its USDG); drand (if it stops, rolls wait, then re-roll, then the 7-day refund).
- Tickets are a burn, not an investment. On average most of each dollar is burned or funds the game.

## Security model, in one paragraph

The pot lives inside `Fire.sol`. There is no owner, no withdraw, no pause. PLANK enters through ticket buys (and the
PLANK released by burning a press, which is passed straight to the Paper Press royalty pool); pot PLANK only leaves
through the rules (winner 40% / burn 25% / Paper Press royalty pool 5% / next fire 30%), an unpaid prize's `claim`, or
the 7-day `refund`. ETH and USDG only leave through `eatMillFromSeaport`, which pays only if a Seaport listing at or
under the bid fills and the press is burned in the same transaction. Anyone can fill the bid with any listing,
their own included; that's the point. A press safe-sent to the Fire bounces. Randomness comes from drand through an
ownerless router that anyone can fulfill. The deploy wallet and the keeper have no special powers.

## Before mainnet

- Test router + adapter + keeper on Robinhood testnet (chain id 46630) against live drand.
- Set `PLANK_PER_TICKET0` (the deploy script prints the right number from the feed), `SEED_PLANK` ($250) and
  `MILL_BID_BASE` from launch-day prices. The script refuses an empty `PLANK_PER_TICKET0`, a missing seed (unless
  `NO_SEED=true`), a roll time other than 75600 and an `ETH_USD_PER_TICKET` other than $1.
- PLANK is on the PulpPool reward list (per the owner); confirm on the explorer on deploy day.
- Full checklist: `docs/HANDOFF.md` ("Before deploy") and `docs/launch-day.md`.
