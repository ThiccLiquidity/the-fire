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

Every step records what it deployed in **`deployments/4663.json`** (the one address file: ConfigureSeries,
VerifyDeploy, VerifySeries, the keeper, `ops/snapshot` and the site read it), so later steps need no addresses
typed in. forge runs a script before it broadcasts (and a broadcast can fail half way), so the scripts never write
that file themselves: with `--broadcast` they leave `deployments/4663.json.pending`, and after each broadcast you run
```powershell
node ..\ops\deploy\record.mjs --rpc $env:RPC     # from contracts/ (cd ops; npm ci once first)
```
It checks every new address against the broadcast's receipts and the chain (code at each one), then merges it into
the file and removes the `.pending` one; if anything didn't land it writes nothing and says what. Run VerifyDeploy
(step 4) before committing the file. A script refuses to start while an unrecorded `.pending` file is there (delete it
if that broadcast failed).

Rehearse the whole thing first (below, "Rehearsal").

## 1. PLANK/USD TWAP feed: at least 30 minutes before step 3
```powershell
forge script script/DeployTwap.s.sol --rpc-url $env:RPC --account deployer --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
Then `node ..\ops\deploy\record.mjs --rpc $env:RPC`. Uses `PLANK_WETH_V2_PAIR`, `PLANK`, `ETH_USD_FEED`. Call `checkpoint()`
**30+ minutes after deploy** and then every 30 minutes (the keeper's job; anyone can; every pack purchase also calls
it). Extra calls are ignored. The feed reports 0 until its first full window, and FireSale pauses PLANK pricing whenever
the window is over 2 hours old.

## 2. Randomness router + PAPER feed
```powershell
forge script script/DeployInfra.s.sol --rpc-url $env:RPC --account deployer --sender <deployer address> --slow --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
Then `node ..\ops\deploy\record.mjs --rpc $env:RPC`. Uses `PAPER`, `USDG`, `WETH`, `UNIV2_FACTORY`, `ETH_USD_FEED`,
`PLANK`, `PLANK_USD_FEED` (step 1, read from the deployments file if not in `.env`); checks chain 4663,
contract code at each, PAPER and PLANK are 18 decimals, the ETH/USD feed is 8 and the PLANK feed 18. Deploys `OpenDrandRouter` and `PaperUsdTwap`. Neither has an owner. Both go in the
deployments file (step 3 reads them from there; `DRAND_ROUTER` and `PAPER_USD_FEED` in `.env` override). `PAPER_USD_FEED` is this `PaperUsdTwap`, never the PAPER pool itself.
It finds a PAPER/WETH, PAPER/USDG or PAPER/PLANK pool holding at least $10 on its other side (PLANK valued by
`PLANK_USD_FEED`) and at least 1,000 PAPER, and reports its first price about 40 hours after the keeper's first checkpoint (20 hours as
candidate, then one 20-hour window). Each pool keeps its own 20-hour clock, so a pool that appears for a moment (a flash
loan) can't restart the real pool's; when several finish, the one that held the most liquidity all along wins. After a
switch to a new pool, the last full window's price keeps serving until the new pool has its own. Until then packs take the set PAPER (no dollar ceiling) and case and grading fees wait in
`PaperBurner`.

## 3. Card contracts
Fill the card section of `.env` (`OWNER` = the hardware wallet's address, royalty, revenue wallet; details at the top of
`script/DeployCards.s.sol` and in `docs/cards-contracts.md`), then:
```powershell
forge script script/DeployCards.s.sol --rpc-url $env:RPC --account deployer --sender <deployer address> --slow --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
Then `node ..\ops\deploy\record.mjs --rpc $env:RPC`. It checks every input first, including that `DRAND_ROUTER` returns a zero `requestFee()` like the OpenDrandRouter,
that `PLANK_USD_FEED` sits on the PLANK/WETH pool the V2 router trades, and that `PLANK_USD_FEED` and `PAPER_USD_FEED`
are built on this `ETH_USD_FEED` (and this PAPER and `PLANK_USD_FEED`, for the PAPER feed). `PAPER_USD_FEED` is
required. Then it deploys FirePacks, FireCards, CardsRenderer, RecipeDealer and RecipeCompiler, PlankBurner (no
owner, no withdraw: it holds the PLANK burn share when a sale's swap can't run), FireCredits, FireSale, PaperBurner
(with its feeds and default routes), FirePsa and one drand adapter each for FireCards and FirePsa, wires them (set-once
links, each checked: FireSale and FireCredits point at each other, FireSale's PlankBurner uses the same router and
feeds; FireSale's PaperBurner is the one deployed; FirePsa and the `KEEPERS` wallets may flush PaperBurner), and offers ownership of all seven owned contracts to `OWNER` (two steps: the owner accepts in step 4). It
refuses an `OWNER` equal to the deployer.

## 4. Hardware wallet accepts
The owner accepts FirePacks, FireCards, RecipeDealer, FireCredits, FireSale, FirePsa and PaperBurner in one run
(PlankBurner has no owner). Until then the deployer key controls those seven, so do it right after step 3. Seven
confirmations on the device:
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
`ops/keeper` (setup: `ops/keeper/README.md`). Two always-on Railway services in different regions: the main keeper
(`KEEPER_ROLE=main`) and a backup (`KEEPER_ROLE=backup`) that only acts on work left waiting 5 minutes. Each has its own
gas-only wallet (its key only in a Railway variable, typed in there) and its own dead-man's switch (`HEARTBEAT_URL`,
required). A GitHub Actions workflow can run a third, best-effort pass every 5 minutes (optional, off by default).
Start them right after step 1 (the PLANK feed needs its checkpoints). Every call is permissionless:
- `PlankUsdTwap.checkpoint()` every 30 minutes; `PaperUsdTwap.checkpoint()` when `due()`
- drand numbers to the router (`OpenDrandRouter.fulfillMany`; `adapter.settle` if a callback didn't land)
- `FireCards.process(fire, maxCards)` and `FirePsa.finish(index, ids)` (ids from the grading's `Protected` event)
- `PaperBurner.flush(pay)` and `PlankBurner.flush(pay)` when they hold something a flush can burn worth the gas
  ($1 by default, at most every 15 min; smaller balances after 6 h, so dust can't drain the keeper)
- `FireSale.close(fire)` once nothing can still sell in a Series (`status(fire).left` 0: a group's time ran out with
  its leftovers rolling nowhere, or the unlimited "after sell-out" group idled out); no purchase closes it then
- `FireSale.endDrop(fire)` for a drop that didn't sell out, once anyone may (7 days after `status(fire).endableAt`)

It alerts a Discord/Slack/Telegram webhook on stale feeds (PLANK price over 90 min old, a PAPER candidate pool not
adopted in time), stuck opens or gradings, waiting fees, an unsold drop the owner can end, a close that didn't go through, drand lag, low keeper ETH
(under 0.002), a pause turned on, a randomness switch, FireSale's wallets or price feeds changed (`WalletsSet` /
`FeedsSet`, once per event with the new addresses: if it wasn't you, pause the sale) and the backup having to step in, with a daily heartbeat; a keeper that can't start says so before it exits. None of these calls pause. The owner's pause (`FireSale.setPaused`,
`FirePsa.setPaused`) stops only buying (every group), credit spending, paid suggestions and case/grading payments.

## 6. Each Series: two signings on the device with a check in between
Put the studio's `recipe.json` in `contracts/series/` (the scripts may only read there). If its sale has snapshot groups
(`docs/drop-groups.md`), put `fire-<N>-snapshots.json` next to it: for each snapshot group, by its index in
`sale.groups` (`"0"` is the first), whose wallets it takes, e.g. `{ "1": { "token": "plank", "minUsd": 69, "days": 7 } }`
(token, minimum, allowance tiers, days, blocks: `ops/README.md`, "The snapshots side file").

### Launch a Series (one command)
`ops/series/launch.mjs` runs everything in this step in order, one line per check, and stops at the first problem.
Once per machine: `cd ops; npm ci; cd snapshot; npm ci; cd ..\..`. Then, from the repo:
```powershell
cd C:\Users\DubT1\the-fire
$env:RPC = Read-Host "RPC URL"
$env:OWNER_HD_PATH = "m/44'/60'/1'/0/0"        # or keep it in contracts\.env
node ops\series\launch.mjs --recipe contracts\series\recipe-fire-7.json --start "2026-11-01 18:00"
```
`--start` is your local time (it prints local and UTC). Testnet: add `--chain 46630` (default 4663, mainnet).
`.\ops\series\launch.ps1 <same options>` does the same and asks for the RPC URL hidden if `$env:RPC` isn't set.
1. **Preflight**: the RPC is the right chain, the owner in `deployments/<chain>.json` holds the contracts and is the
   Ledger account at `OWNER_HD_PATH`, the Series isn't locked, no other drop is open, the keeper is alive (recent PLANK
   checkpoint; PAPER feed live), the pack art `fire<N>.webp` is up, the start is at least 15 minutes away, the sale
   settings (the drop-wide fields and each group) are inside the policy (below), every NFT group's collection is a
   contract, and FireSale's revenue wallet, burners and FireGroups are the deployments file's.
2. **Snapshots** (one per snapshot group, from the side file): each wallet's smallest holding of the group's token
   (LP share included for a coin) over 5 blocks in the past 7 days (`--snapshot-blocks`, `--snapshot-days` as
   defaults), with its allowance (tiers), saved as `fire-<N>-group-<i>.json` next to the recipe with its seed and
   blocks; each root goes to batch B as `GROUP_ROOT_<i>`. The RPC must serve past blocks (an archive node).
3. **Fork rehearsal**: batches A and B as the owner on a copy of the chain; nothing is sent.
4. **Batch A** on the Ledger (it says how many confirmations).
5. **VerifySeries** until GREEN (retries while new pins reach the gateways); RED stops it.
6. **Confirm**: the policy and the wallets checked again (read fresh), the drop-wide settings and each group in plain
   words (who, packs or "no limit", price in dollars + PAPER, coins, per wallet and per purchase, opens with the drop
   or after which group, max time, idle, where leftovers go, the rising %), and the wallets, then type `LOCK`.
   Anything else stops it.
7. **Batch B** on the Ledger (one confirmation), then reads every drop-wide and group field back from FireSale and
   FireGroups, and writes the site's holders file `web/art/factory/forge/holders/series-<N>.json` (every snapshot
   group's wallets, allowances and proofs; format in `ops/README.md`). Commit it and deploy the site with the drop.

**Sale policy** (`ops/series/sale-policy.mjs`; the table is in `ops/README.md`): drop-wide, PLANK + PAPER burn 10-100%
of each sale, with PAPER at least 10% (Standard: 10% + 20%), and a PAPER cap of $0.10 or more (0 = no cap: a
warning); per group, a price of $1-$10 a pack (0 only for an NFT or snapshot group: free or PAPER only), at least 0.1
PAPER a pack, at most 50 per wallet (no limit warns for a finite open group), a rising tax up to 10% a pack (a warning
above; the owner's default is 4%), an unlimited group idling out within 1 h (a warning above), and a root on every
snapshot group. Outside a bound the launch STOPs, before batch A and again before LOCK, unless that rule is allowed by
name: `--allow price,wallet-limit` (VerifySeries takes the same `--allow`). The wallets have no `--allow`: a FireSale
revenue wallet or burner that isn't the deployments file's, or a FireGroups not wired to FireSale, is always RED.

After a STOP, fix the problem and run the same command again: finished steps are skipped, and batch A and B are
judged by the chain, so neither is sent twice. State and log: `ops\series\out\series-<N>.state.json` and
`series-<N>.log` (never committed; no keys in them). On testnet a throwaway owner key can sign instead of the Ledger:
`--key-env OWNER_KEY` after `$k = Read-Host "Owner key" -AsSecureString; $env:OWNER_KEY = [System.Net.NetworkCredential]::new("", $k).Password`
(refused on mainnet). The steps below are what it
runs, for doing it by hand.

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

**The check** (read-only; the snapshot groups' snapshots first, `ops/README.md`):
```powershell
cd ops; npm ci
node series/verify-series.mjs --recipe ..\contracts\series\recipe-fire-7.json --snapshots 1=..\contracts\series\fire-7-group-1.json --roots 1=<its root>
```
It reads the Series back and diffs it against `recipe.json` (recipe, characters, dealer, images base), checks
FirePsa's fixed PDA odds and that `imagesBase` is `ipfs://<CID>/`, loads every image the contract can point a card at through two or more gateways (one gateway missing some is a
warning, as long as each image loads from two),
reads the folder's `manifest.json`, checks each snapshot group's root against its file (the file's own tree and every
proof it serves) and rebuilds the snapshot from the chain at its saved blocks (a wallet, amount or allowance edited
into the file is RED; `node ops/snapshot/snapshot.mjs --verify <file>` does the same on its own), checks every NFT
group's collection has code, the sale block against the sale policy (`--allow <rule>` for a meant exception),
FireSale's revenue wallet and burners against the deployments file and FireGroups wired to FireSale. Sign batch B only
when it says **GREEN**.

**Batch B, the lock:** `configureDrop` from the JSON's `sale` block (it locks the Series: recipe, characters and images
are fixed from then).
```powershell
$env:BATCH = "B"; $env:DROP_START = "<unix seconds>"; $env:GROUP_ROOT_1 = "<group 1's snapshot root>"   # one per snapshot group
forge script script/ConfigureSeries.s.sol --rpc-url $env:RPC --ledger --hd-paths $env:OWNER_HD_PATH `
  --sender $env:OWNER --slow --broadcast
```
It refuses unless the chain holds batch A exactly as the JSON says, then sends `configureDrop` from the owner (one
confirmation). Then write the site's holders file from the snapshots (`ops/README.md`; the launcher does it) and
`FireCredits.pickSuggestions` as before.

## 7. Site
Cardworks is static (`web/public/forge`) and runs in demo mode (a demo banner, no wallet, no payments). The live
version will use `web/src/lib` (chain, wallet, card ABIs, swap guard); `web/src/lib/config.ts` reads the contract
addresses from `deployments/<chainId>.json` (Vercel must include files outside the Root Directory, its default). Set `SWAP_FEE_WALLET` in
`web/src/lib/config.ts` first. If the site uses its own `VITE_RPC_URL`, add that host to `connect-src` in
`web/vercel.json` or the browser blocks every read (the build refuses it).

## Rehearsal
`ops/rehearsal/rehearse.mjs` runs everything above on a local chain with the real scripts and the real keeper code:
DevStack (the testnet kit) → deploy, each step recorded with `ops/deploy/record.mjs` → VerifyDeploy → the owner accepts (AcceptOwnership, owner impersonated) → keeper checkpoints → batch A from
the owner (ConfigureSeries) → snapshots (PLANK, the smallest holding over 5 blocks with allowance tiers: an EIP-7702
wallet in, a last-block whale out, $500 = 2 packs; a wallet added to the file by hand is RED; the Paper Press as an
ERC-721) → VerifySeries (RED with an image missing, then GREEN, the snapshot rebuilt from the chain, the sale policy
and wallets) → batch B: four groups, the Standard preset scaled small (Press holders, PLANK snapshot holders,
everyone, an unlimited taxed group idling out after 5 minutes) → buy through the groups (a proof from the snapshot
script; a raised allowance refused; one buy with the PLANK swap down) → the taxed group's price rises, then it idles
out → the keeper closes the Series (`FireSale.close`) → open → the keeper delivers drand and deals → the main keeper and the backup race → case and grade → the
keeper finishes the grading → the backup steps in while the main keeper is down → a pause, a randomness switch and
FireSale's `WalletsSet` reach the webhook → both burners flushed (the PAPER feed going live 40 h later) → VerifyDeploy.
```powershell
cd ops; npm ci; cd keeper; npm ci; cd ..\snapshot; npm ci; cd ..
node rehearsal/rehearse.mjs                       # plain anvil, nothing needed from outside
node rehearsal/rehearse.mjs --chain-id 46630      # the same, as the testnet's chain id (the testnet kit exactly)
node rehearsal/rehearse.mjs --fork $env:RPC       # a Robinhood Chain fork: real tokens, pools and drand
```
On plain anvil, `contracts/script/DevStack.s.sol` deploys stand-ins for the tokens, pools and Chainlink
(`contracts/script/dev/DevContracts.sol`; never on mainnet, it refuses chain 4663). The first open is timed to drand round 1000 and proved through the real `OpenDrandRouter` with
drand's real signature; then the owner switches the randomness to a stand-in router that accepts any signature, so the
rest runs without drand. It races the main keeper and the backup for real (automine off, a block a second, each in its
own loop, the work overdue for both) and fails on any reverted transaction, any transaction that did nothing, or a
drand request delivered twice. Everything it prints is also in `ops/rehearsal/out/rehearsal.log` (CI keeps it when the
rehearsal fails). CI runs it on every push to `wip/*` and on pull requests into `main`. The fork mode needs the RPC and drand reachable, and skips the 40-hour PAPER feed
leg (a fork's Chainlink doesn't update).

## Testnet (Robinhood Chain testnet, chain id 46630)
The same runbook on the testnet, with stand-ins for what mainnet already has (tokens, pools, Chainlink, the Paper
Press). Play tokens only; nothing here touches mainnet. Wallets: a testnet deployer (its own Foundry keystore, e.g.
`cast wallet import testnet-deployer --interactive`) and a testnet owner: a second Ledger account (`m/44'/60'/2'/0/0`,
say) to practise the real signing, or a throwaway keystore account. Testnet ETH for both and the keepers comes from
the Robinhood Chain testnet faucet.

```powershell
cd contracts
$env:RPC = Read-Host "Testnet RPC URL"          # e.g. https://rpc.testnet.chain.robinhood.com/rpc, or Alchemy's
$env:EXPECTED_CHAIN_ID = "46630"                # every deploy script refuses any other chain
$verify = "--verify", "--verifier", "blockscout", "--verifier-url", "https://explorer.testnet.chain.robinhood.com/api/"   # testnet Blockscout
```
1. **Stand-ins** (refuses chain 4663): PAPER, PLANK, USDG, WETH, an ETH/USD feed that never goes stale, a Uniswap V2
   factory with PLANK/WETH and PAPER/WETH pools, a router, a Paper Press. Only the deployer can mint, set prices or
   reserves, or break the router, so nobody else can wreck the testnet.
   ```powershell
   forge script script/DevStack.s.sol --rpc-url $env:RPC --account testnet-deployer --sender <deployer address> --slow --broadcast @verify
   node ..\ops\deploy\record.mjs --rpc $env:RPC
   # the deploy scripts read their inputs from the environment: load them from the file just written
   (Get-Content ..\deployments\46630.json | ConvertFrom-Json).inputs.psobject.Properties | ForEach-Object { Set-Item "env:$($_.Name)" $_.Value }
   ```
   Testers get PAPER by swapping test ETH on the stand-in router, or the deployer mints it
   (`cast send <PAPER> "mint(address,uint256)" <to> <wei> --account testnet-deployer --rpc-url $env:RPC`).
2. **Steps 1–3** exactly as above, with `--account testnet-deployer`, `@verify` in place of the mainnet
   `--verify ...` line, and `OWNER` = the testnet owner. DeployInfra deploys the **real** `OpenDrandRouter` (real drand,
   no stand-in). Record after each one. Every script reads and writes `deployments/46630.json` (the chain's id).
3. **Owner accepts** (step 4 above: all seven owned contracts, seven confirmations) with the testnet owner, then
   VerifyDeploy.
4. **Keepers**: the same Railway setup (`ops/keeper/README.md`) as two more services with `CHAIN_ID=46630`, the testnet
   RPC and their own testnet wallets (~0.05 test ETH each; separate from the mainnet keeper wallets). Start them right
   after the PLANK feed (mainnet step 1), as on mainnet.
5. **Site**: build with `VITE_CHAIN=testnet` (reads `deployments/46630.json`; wallet and explorer switch to the testnet).
6. **Series**: step 6 as above, with the testnet owner. Then confirm one live drand delivery: buy a few packs, sell the
   drop out, let its groups' time run out (short durations and a short `idle` in a testnet sale: the keeper closes the
   Series with `FireSale.close`) or end it (`endDrop`, once its schedule is over) so the Series closes, open one pack and check the keeper log shows `fulfillMany success` and
   `process success` (or the open's `ready` on the explorer). Packs can only be opened once their Series has closed.
Commit `deployments/46630.json` after VerifyDeploy says no FAIL.

## Verify a number (anyone)
See `docs/randomness.md`.
