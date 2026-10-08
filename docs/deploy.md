# Deploy runbook (Robinhood Chain mainnet, chain id 4663)

Two wallets:
- **The deployer**: a fresh, throwaway hot wallet with ~$50 of ETH. It only pays gas for steps 1–3 and has no
  powers once step 4 is done. Its key goes into a Foundry keystore (`cast wallet import deployer --interactive`,
  typed in, never pasted into a file or a command line). Never `--private-key`.
- **The owner**: one hardware wallet (Ledger or Trezor) owns every contract. No multisig: nothing in the contracts
  holds funds, and the risk is key theft, which the device covers. It signs on the device (`--ledger` / `--trezor`).

Commands are shown for PowerShell.

```powershell
cd contracts; copy .env.example .env   # then fill in the real .env, never .env.example
$env:RPC = Read-Host "RPC URL"                  # once per PowerShell window: forge reads .env, PowerShell doesn't
```

### The owner's Ledger account
The owner is a fresh Ethereum account on the Ledger, not necessarily its first one. Ledger Live numbers accounts
0, 1, 2…; account N has the path `m/44'/60'/N'/0/0`. Set it (and the address) once per PowerShell window, and check
the device shows that address before using it anywhere:
```powershell
$env:OWNER_HD_PATH = "m/44'/60'/1'/0/0"        # N = the account's number in Ledger Live (here account 1)
cast wallet address --ledger --hd-path $env:OWNER_HD_PATH
$env:OWNER = "<the address it printed>"         # the same address goes in .env as OWNER
```
Keep the path in `.env` too (`OWNER_HD_PATH="m/44'/60'/1'/0/0"`, double quotes kept, or forge can't read the file);
PowerShell still needs the two `$env:` lines in each new window. `cast wallet address` takes `--hd-path`,
`forge script` takes `--hd-paths`. On a Trezor use `--trezor` and the path Trezor Suite shows (its accounts are
`m/44'/60'/0'/0/N`).

Before each owner command: close Ledger Live, unlock the device, open the Ethereum app, and turn on **Blind signing**
there (Settings; contract calls need it). Switch it off again between uses if you like. The owner address needs a
little ETH for gas (~$10). The device shows every transaction: check the contract address against
`deployments/4663.json` before confirming.

Every step writes what it deployed to **`deployments/4663.json`** (the one address file: ConfigureSeries,
VerifyDeploy, VerifySeries, the keeper, `ops/snapshot` and the site read it), so later steps need no addresses
typed in. Commit that file after each step. The scripts write it only when they really broadcast.

Rehearse the whole thing first (below, "Rehearsal").

## 1. PLANK/USD TWAP feed: at least 30 minutes before step 3
```powershell
forge script script/DeployTwap.s.sol --rpc-url $env:RPC --account deployer --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
Uses `PLANK_WETH_V2_PAIR`, `PLANK`, `ETH_USD_FEED`. Put the address in `.env` as `PLANK_USD_FEED`. Call `checkpoint()`
**30+ minutes after deploy** and then every 30 minutes (the keeper's job; anyone can; every pack purchase also calls
it). Extra calls are ignored. The feed reports 0 until its first full window, and FireSale pauses PLANK pricing whenever
the window is over 2 hours old.

## 2. Randomness router + PAPER feed
```powershell
forge script script/DeployInfra.s.sol --rpc-url $env:RPC --account deployer --sender <deployer address> --slow --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
Uses `PAPER`, `USDG`, `WETH`, `UNIV2_FACTORY`, `ETH_USD_FEED`, `PLANK`, `PLANK_USD_FEED` (step 1, read from the
deployments file if not in `.env`); checks chain 4663,
contract code at each, PAPER and PLANK are 18 decimals, the ETH/USD feed is 8 and the PLANK feed 18. Deploys `OpenDrandRouter` and `PaperUsdTwap`. Neither has an owner. Both go in the
deployments file (step 3 reads them from there; `DRAND_ROUTER` and `PAPER_USD_FEED` in `.env` override). `PAPER_USD_FEED` is this `PaperUsdTwap`, never the PAPER pool itself.
It finds a PAPER/WETH, PAPER/USDG or PAPER/PLANK pool holding at least $10 on its other side (PLANK valued by
`PLANK_USD_FEED`) and reports its first price about 40 hours after the keeper's first checkpoint (20 hours as
candidate, then one 20-hour window). Until then packs take the set PAPER (no dollar ceiling) and case and grading fees wait in
`PaperBurner`.

## 3. Card contracts
Fill the card section of `.env` (`OWNER` = the hardware wallet's address, royalty, revenue wallet; details at the top of
`script/DeployCards.s.sol` and in `docs/cards-contracts.md`), then:
```powershell
forge script script/DeployCards.s.sol --rpc-url $env:RPC --account deployer --sender <deployer address> --slow --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
It checks every input first, including that `DRAND_ROUTER` returns a zero `requestFee()` like the OpenDrandRouter,
that `PLANK_USD_FEED` sits on the PLANK/WETH pool the V2 router trades, and that `PLANK_USD_FEED` and `PAPER_USD_FEED`
are built on this `ETH_USD_FEED` (and this PAPER and `PLANK_USD_FEED`, for the PAPER feed). `PAPER_USD_FEED` is
required. Then it deploys FirePacks, FireCards, CardsRenderer, RecipeDealer and RecipeCompiler, PlankBurner (no
owner, no withdraw: it holds the PLANK burn share when a sale's swap can't run), FireCredits, FireSale, PaperBurner
(with its feeds and default routes), FirePsa and one drand adapter each for FireCards and FirePsa, wires them (set-once
links, each checked: FireSale and FireCredits point at each other, FireSale's PlankBurner uses the same router and
feeds), and hands ownership to `OWNER`. It refuses an `OWNER` equal to the deployer.

## 4. Hardware wallet accepts
The owner accepts FirePacks, FireCards, RecipeDealer, FireCredits, FirePsa and PaperBurner in one run (FireSale is
owned by `OWNER` from deployment; PlankBurner has no owner). Until then the deployer key controls those six, so do it
right after step 3. Six confirmations on the device:
```powershell
forge script script/AcceptOwnership.s.sol --rpc-url $env:RPC --ledger --hd-paths $env:OWNER_HD_PATH `
  --sender $env:OWNER --slow --broadcast
```
It reads the addresses and the expected owner from `deployments/4663.json`, refuses any other signer, and skips what
the owner already holds (safe to run again). Leave out `--broadcast` for a dry run. Then the read-only check (no key
needed):
```powershell
forge script script/VerifyDeploy.s.sol --rpc-url $env:RPC
```
It prints OK / WAIT / FAIL per line: code at every address, every owner is the hardware wallet recorded as `OWNER` in
the deployments file (or it still has to accept), every set-once link (the list
in `docs/cards-contracts.md`), the feeds live, nothing paused or locked by mistake. It fails on any FAIL; WAIT means
"not yet" (an acceptOwnership still to sign, the PLANK feed before its first checkpoint, the PAPER feed before its
pool). Ownership can never be renounced. Optional:
`FirePacks.setContractURI` and `FireCards.setContractURI` (collection pages on marketplaces).

## 5. Keeper
`ops/keeper` (setup: `ops/keeper/README.md`). Railway runs it always on; a GitHub Actions workflow runs one pass every
5 minutes as a backup that only acts on work left waiting. Each runs from its own gas-only wallet, its key only in a
Railway variable or a GitHub secret. Start it right after step 1 (the PLANK feed needs its checkpoints). Every call is
permissionless:
- `PlankUsdTwap.checkpoint()` every 30 minutes; `PaperUsdTwap.checkpoint()` when `due()`
- drand numbers to the router (`OpenDrandRouter.fulfillMany`; `adapter.settle` if a callback didn't land)
- `FireCards.process(fire, maxCards)` and `FirePsa.finish(index, ids)` (ids from the grading's `Protected` event)
- `PaperBurner.flush(pay)` and `PlankBurner.flush(pay)` when they hold something a flush can burn

It alerts a Discord/Slack/Telegram webhook on stale feeds, stuck opens or gradings, waiting fees, drand lag and low
keeper ETH, with a daily heartbeat. None of these calls pause. The owner's pause (`FireSale.setPaused`,
`FirePsa.setPaused`) stops only buying, press packs, credit spending, paid suggestions and case/grading payments.

## 6. Each Series: two signings on the device with a check in between
Put the studio's `recipe.json` in `contracts/series/` (the scripts may only read there).

**Try it first on a fork** (as the owner, impersonated; no device, nothing sent):
```powershell
$env:RECIPE_JSON = "series/recipe-fire-7.json"; $env:BATCH = "AB"; $env:SIMULATE = "true"
forge script script/ConfigureSeries.s.sol --fork-url $env:RPC
Remove-Item Env:SIMULATE
```

**Batch A, the content** (nothing locks yet):
```powershell
$env:BATCH = "A"
forge script script/ConfigureSeries.s.sol --rpc-url $env:RPC --ledger --hd-paths $env:OWNER_HD_PATH `
  --sender $env:OWNER --slow --broadcast
```
It checks the recipe against the dealer, prints each call and sends them from the owner, one confirmation each on
the device: `RecipeDealer.setRecipe` and `setCharacters` (+ `appendCharacters` for long lists), `FireCards.setDealer`
and `setImagesBase`. No PDA odds: they are fixed in `FirePsa`, the same for every Series. It refuses any signer but
the owner. Leave out `--broadcast` for a dry run.

**The check** (read-only; the holder snapshot first, `ops/README.md`):
```powershell
cd ops; npm install
node series/verify-series.mjs --recipe ..\contracts\series\recipe-fire-7.json --snapshot fire-7-holders.json
```
It reads the Series back and diffs it against `recipe.json` (recipe, characters, dealer, images base), checks
FirePsa's fixed PDA odds and that `imagesBase` is `ipfs://<CID>/`, loads every image the contract can point a card at through two or more gateways,
reads the folder's `manifest.json`, and recomputes the snapshot's Merkle root. Sign batch B only when it says
**GREEN**.

**Batch B, the lock:** `configureDrop` from the JSON's `sale` block (it locks the Series: recipe, characters and images
are fixed from then).
```powershell
$env:BATCH = "B"; $env:DROP_START = "<unix seconds>"; $env:HOLDER_ROOT = "<the snapshot's root>"
forge script script/ConfigureSeries.s.sol --rpc-url $env:RPC --ledger --hd-paths $env:OWNER_HD_PATH `
  --sender $env:OWNER --slow --broadcast
```
It refuses unless the chain holds batch A exactly as the JSON says, then sends `configureDrop` from the owner (one
confirmation). Then `FireCredits.pickSuggestions` as before.

## 7. Site
The Forge is static (`web/public/forge`) and runs in demo mode (a demo banner, no wallet, no payments). The live
version will use `web/src/lib` (chain, wallet, card ABIs, swap guard); `web/src/lib/config.ts` reads the contract
addresses from `deployments/<chainId>.json` (Vercel must include files outside the Root Directory, its default). Set `SWAP_FEE_WALLET` in
`web/src/lib/config.ts` first. If the site uses its own `VITE_RPC_URL`, add that host to `connect-src` in
`web/vercel.json` or the browser blocks every read (the build refuses it).

## Rehearsal
`ops/rehearsal/rehearse.mjs` runs everything above on a local chain with the real scripts and the real keeper code:
deploy → VerifyDeploy → the owner accepts (AcceptOwnership, owner impersonated) → keeper checkpoints → batch A from
the owner (ConfigureSeries) → snapshot
→ VerifySeries (RED with an image missing, then GREEN) → batch B → buy (one with the PLANK swap down) → sold out,
closed → open → the keeper delivers drand and deals → case and grade → the keeper finishes the grading → both burners
flushed (the PAPER feed going live 40 h later) → VerifyDeploy.
```powershell
cd ops; npm install; cd keeper; npm install; cd ..\snapshot; npm install; cd ..
node rehearsal/rehearse.mjs                       # plain anvil, nothing needed from outside
node rehearsal/rehearse.mjs --fork $env:RPC       # a Robinhood Chain fork: real tokens, pools and drand
```
On plain anvil, stand-ins replace the tokens, pools and Chainlink (`contracts/script/dev/DevContracts.sol`, never
deployed for real). The first open is timed to drand round 1000 and proved through the real `OpenDrandRouter` with
drand's real signature; then the owner switches the randomness to a stand-in router that accepts any signature, so the
rest runs without drand. It also races two keepers on the same work and checks the backup leaves it to the main
keeper. CI runs it on every push. The fork mode needs the RPC and drand reachable, and skips the 40-hour PAPER feed
leg (a fork's Chainlink doesn't update).

## Verify a number (anyone)
See `docs/randomness.md`.
