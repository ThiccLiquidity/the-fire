# Launch day, step by step

Plain version of `docs/deploy.md` for a first deploy. Commands run in PowerShell from `C:\Users\DubT1\the-fire`.
**Private keys are only ever typed into a hidden prompt (Foundry keystore, keeper setup). Never in chat, never in a file.**

## What "deploying" means
The contracts are programs. Deploying uploads them to Robinhood Chain from a wallet (the deployer); each upload is a
normal transaction that costs a little ETH. After that they run on their own: **no owner, no admin, nobody can change
or stop them, including us.** So everything is checked before the real send, and we rehearse first.

## A few days before
1. **Wallets** (MetaMask, add new accounts, public addresses to Claude):
   - **Deployer**: ~$50 of ETH on Robinhood Chain + the $250 of PLANK for the seed. Used only for the deploy.
   - **Keeper**: ~$10 of ETH. Runs the nightly storm. Never the deployer.
   - **Swap fee**: receives the 0.5% swap fee. Nothing in it needed.
2. **Tools**: Foundry (`forge`, `cast`) installed; Claude walks you through it.
3. **Deployer key into Foundry's keystore** (encrypted on your PC, protected by a password you pick):
   `cast wallet import deployer --interactive` → paste the deployer's private key into the hidden prompt, set a password.
4. **RPC**: a free Alchemy (or similar) Robinhood Chain URL. Goes in `contracts\.env` only.
5. **Keeper box**: a $6/month DigitalOcean droplet (`ops/README.md`, ~10 minutes).
6. **Rehearsal**: run the deploy script **without `--broadcast`**. It runs everything against the real chain as a
   simulation and sends nothing. Any problem shows up here for free.

## Launch day (on or after Oct 1: PAPER must exist; presses can only be burned from Oct 1)
Times are MST. The storm is at 8:00 PM.

| When | Who | What |
|---|---|---|
| Morning | Claude | Fills in `contracts\.env.example` values (PAPER address, press floor → starting bid), sets the swap fee wallet in the site, tags the release. |
| 7:15 PM | You | **Step 1: price feed.** `forge script script/DeployTwap.s.sol ... --broadcast` (exact line from Claude). Copy the address it prints into `.env` as `PLANK_USD_FEED`. |
| 7:50 PM | You | **Checkpoint** the feed (one `cast send` line from Claude). It now has its first 30-minute price. |
| 7:55 PM | You | **Rehearse step 2**: the Fire deploy without `--broadcast`. It checks every address, both prices, the starting PLANK per log and the bid; if anything is off it stops and says what. |
| 8:05 PM | You | **Step 2: the Fire.** Same line with `--broadcast`. Four contracts go up one at a time (~1 minute), then the $250 seed goes into fire #1's pot. Copy the four addresses it prints. |
| 8:10 PM | Claude | Checks on the explorer: the randomness adapter points at the Fire, the pot holds the seed, nothing owns anything. |
| 8:15 PM | You | **Step 3: keeper.** On the droplet, one `docker run` line with the Fire address. Healthchecks texts you if it ever stops. |
| 8:20 PM | Claude | **Step 4: site.** Puts the addresses in the site and takes it out of demo mode. Merged to `main` **only on your word.** |
| 8:30 PM | You | **Step 5: dry run.** Connect your wallet, swap a little ETH for PLANK, throw 1 log. Check it shows in the feed and the pot went up. |
| Next day 8 PM | Keeper | Night 1 (no storm, fire #1 always survives it). Watch the first real storm the night after. |

## If something goes wrong
- **The script stops before sending**: nothing happened, nothing spent. Fix the value it names and run again.
- **It stops halfway through step 2**: the contracts already sent just sit unused (they hold nothing). Run it again for
  a fresh set. Only gas is lost.
- **The keeper dies**: the site shows a button to bring in the storm; anyone can press it.
- **Money at risk on launch day**: only the $250 seed, and it can only ever leave by the game's rules.

## Costs
Deploy gas: a few dollars (well under the $50 kept for it). Keeper: ~$10 of ETH, lasts a long time. Droplet: $6/month.
Seed: $250 of PLANK.
