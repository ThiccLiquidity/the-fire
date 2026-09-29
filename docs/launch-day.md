# Launch day, step by step

Plain version of `docs/deploy.md` for a first deploy. Commands run in PowerShell from `C:\Users\DubT1\the-fire`.
**Private keys are only ever typed into a hidden prompt (Foundry keystore, keeper setup). Never in chat, never in a file.**
**Edit `contracts\.env` (your copy), never `.env.example`.**

## What "deploying" means
The contracts are programs. Deploying uploads them to Robinhood Chain from a wallet (the deployer); each upload is a
normal transaction that costs a little ETH. After that they run on their own: **no owner, no admin, nobody can change
or stop them, including us.** So everything is checked before the real send, and we rehearse first.

## A few days before
1. **Wallets** (MetaMask, add new accounts, public addresses to Claude):
   - **Deployer**: ~$50 of ETH on Robinhood Chain + the $250 of PLANK for the seed. Used only for the deploy.
   - **Keeper**: ~$10 of ETH. Runs the daily storm. Never the deployer.
   - **Swap fee**: receives the 0.5% swap fee. Nothing in it needed.
2. **Tools**: Foundry (`forge`, `cast`) installed; Claude walks you through it.
3. **Deployer key into Foundry's keystore** (encrypted on your PC, protected by a password you pick):
   `cast wallet import deployer --interactive` → paste the deployer's private key into the hidden prompt, set a password.
4. **RPC**: a free Alchemy (or similar) Robinhood Chain URL. Goes in `contracts\.env` (`copy .env.example .env`). The
   deploy commands say `--rpc-url $env:RPC`, and PowerShell doesn't read `.env`, so in every new PowerShell window,
   before any `forge` line, run `$env:RPC = Read-Host "RPC URL"` and paste the URL (it's a URL, not a key).
5. **OpenSea API key** for the keeper (free, from OpenSea; it must serve collection `the-plank-press` on chain
   `robinhood`). Without it the press fund never buys a press.
6. **Keeper box**: a $6/month DigitalOcean droplet (`ops/README.md`, ~10 minutes). The release tag doesn't exist yet, so
   set it up from `main`: `curl -fsSL https://raw.githubusercontent.com/ThiccLiquidity/the-fire/main/ops/keeper-setup.sh | RELEASE=main bash`.
   It asks for the keeper key, the RPC URL and the OpenSea key in hidden prompts on the box. Don't start the keeper yet.
7. **Rehearsal**: run the deploy script **without `--broadcast`**. It runs everything against the real chain as a
   simulation and sends nothing. Any problem shows up here for free.

## Launch day (on or after Oct 1: PAPER must exist; presses can only be burned from Oct 1)
Times are MST. The storm is at 2:00 PM MST (21:00 UTC).

| When | Who | What |
|---|---|---|
| Morning | Claude | Gives you the values for your `contracts\.env` (PAPER address, starting bid — your number), sets the swap fee wallet in the site, tags the release. |
| Morning | You | **Keeper to the release tag.** On the droplet: `cd /root/the-fire && git fetch --tags && git checkout <tag> && cd ops/keeper && docker build -t fire-keeper .` (tag from Claude). |
| 1:15 PM | You | **Step 1: price feed.** `$env:RPC = Read-Host "RPC URL"`, then `forge script script/DeployTwap.s.sol ... --broadcast` (exact line from Claude). Copy the address it prints into `.env` as `PLANK_USD_FEED`. |
| 1:50 PM | You | **Checkpoint** the feed (one `cast send` line from Claude). It now has its first 30-minute price. |
| 1:52 PM | Claude | Gives `PLANK_PER_TICKET0` and `SEED_PLANK` ($250 of PLANK) from the feed price; you put them in `.env`. The script refuses to run if either is empty (or use `NO_SEED=true` and seed by hand), or if `ROLL_TIME_OF_DAY` isn't 75600. |
| 1:55 PM | You | **Rehearse step 2**: the Fire deploy without `--broadcast`. It checks every address, both prices, the starting PLANK per log and the bid; if anything is off it stops and says what. |
| 2:05 PM | You | **Step 2: the Fire.** Same line with `--broadcast`. Four contracts go up one at a time (~1 minute), then the $250 seed goes into fire #1's pot. Copy the four addresses it prints and the Fire's deploy block. |
| 2:08 PM | You | **Profiles.** `forge script script/DeployProfiles.s.sol ... --broadcast` (exact line from Claude). Copy its address and deploy block. |
| 2:10 PM | Claude | Checks on the explorer: the randomness adapter points at the Fire, the pot holds the seed, nothing owns anything, PLANK is on the PulpPool reward list. |
| 2:15 PM | You | **Step 3: keeper.** On the droplet, first the `docker run` line with `--rm -e ONCE=1` (one pass, then it exits; check the log for errors), then the real one with the Fire address and the healthchecks URL. Healthchecks texts you if it ever stops. |
| 2:20 PM | Claude | **Step 4: site.** Sets `VITE_FIRE_ADDRESS`, `VITE_FIRE_FROM_BLOCK` (Fire deploy block), `VITE_PROFILES_ADDRESS`, `VITE_PROFILES_FROM_BLOCK` (Profiles deploy block) on Vercel and takes the site out of demo mode. Merged to `main` **only on your word.** |
| 2:30 PM | You | **Step 5: dry run.** Connect your wallet, swap a little ETH for PLANK, throw 1 log. Check it shows in the feed and the pot went up. |
| Next day 2 PM | Keeper | Day 1 (no storm, fire #1 always survives it). Watch the first real storm the day after. |

## If something goes wrong
- **The script stops before sending**: nothing happened, nothing spent. Fix the value it names and run again.
- **It stops halfway through step 2**: the contracts already sent just sit unused (they hold nothing). Run it again for
  a fresh set. Only gas is lost.
- **The keeper dies**: the site shows a button to bring in the storm; anyone can press it.
- **Money at risk on launch day**: only the $250 seed, and it can only ever leave by the game's rules.

## Costs
Deploy gas: a few dollars (well under the $50 kept for it). Keeper: ~$10 of ETH, lasts a long time. Droplet: $6/month.
Seed: $250 of PLANK.
