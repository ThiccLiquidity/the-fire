# Testnet redeploy runbook (Robinhood Chain testnet, 46630)

One page, top to bottom, on your PC in PowerShell. Every step: what it does, the command, what "good" looks like,
what to do if not. Play tokens only; nothing here touches mainnet or `main`.

What goes again: everything. A fresh testnet kit (DevStack: stand-in PAPER, PLANK, USDG, WETH, the pools and the
router, with the PAPER/PLANK pool LiquidityBurner needs) and its PLANK price feed (DeployTwap), the drand router + PAPER
price feed (DeployInfra), every card contract (DeployCards, FireProfiles and FireGames included) and the Morning Wood
(DeployPress). The old stand-ins can't take liquidity, so they're replaced, not reused. Test wallets need new test
PLANK and Paper Presses afterwards (step 14).

Dress-rehearsed on a local chain (chain id 46630) on Oct 29, 2026: `node rehearsal\rehearse.mjs --chain-id 46630` runs
this exact order (DevStack, DeployTwap, DeployInfra, DeployCards, the owner's accept, a Series of four groups, buying,
opening, grading, both keepers, LiquidityBurner) and ends `REHEARSAL PASSED`. It does not cover the Morning Wood.

**Timing.** The PAPER price needs ~40 h after the keepers start (step 12). Packs, opening, cases and grading work
before that; paid games and the first liquidity run don't. So: steps 1-13 one evening, then the friends' test (step 15)
at least two days later. Step 14 (the Series launch) can be that day or the day before.

## What only you can supply

- **Testnet RPC URL.** Alchemy's Robinhood Chain testnet URL is best (it has a key in it: type it hidden). The
  Series snapshot needs past blocks (an archive RPC). The public `https://rpc.testnet.chain.robinhood.com/rpc` works
  for the deploy if it serves past blocks; if the snapshot says it can't read old blocks, use Alchemy.
- **Test ETH** from the Robinhood Chain testnet faucet for: the deployer (~0.05), the Ledger testnet owner (~0.02),
  each keeper wallet (~0.05), and your test wallets.
- **The deployer's keystore** `testnet-deployer` (address `0xec994A7a7d534BAC97E75deb095F4E266Af86391` last time) and
  its password.
- **The Ledger**, testnet owner account (`0x4D57C7eB9D18Ac8a846b470292E155Cf2AF0640A` last time) and its path.
- **Both keeper addresses** (main and backup) from Railway (public addresses, not keys).
- **The Morning Wood editor wallet**: a new key, imported once on the PC that will publish the paper
  (`cast wallet import editor --interactive`), with a little test ETH (~0.01). It can only publish issues.
- **The practice Series** from Card Studio (Jean Phil = Series 1, Gym Bros = Series 2, step 14): each `recipe.json`,
  art uploaded to Filebase, the pack art folder.
- **Railway, Vercel, Alchemy** logins.

Never paste a private key into a command, a file or a chat. Keys go into `cast wallet import ... --interactive`, the
Ledger, or Railway's own variable fields.

---

## 1. Pull the branch

```powershell
cd C:\Users\DubT1\the-fire
git fetch origin
git checkout wip/pending-approval
git pull
git log --oneline -1
```
- Good: no errors; the last line shows the newest commit.
- If not: `git status`. Local changes in the way? `git stash`, then pull again.

## 2. Install (once per machine, or after a pull that changed packages)

```powershell
node -v                     # v22.23.4 or newer (the Brotli fix, CVE-2026-111497)
forge --version             # Foundry
cd C:\Users\DubT1\the-fire\ops;          npm ci
cd C:\Users\DubT1\the-fire\ops\keeper;   npm ci
cd C:\Users\DubT1\the-fire\ops\snapshot; npm ci
```
- Good: each `npm ci` ends with "added N packages".
- If not: node too old → install the latest Node 22 LTS from nodejs.org (22.23.4 or newer; the keeper won't start on older). `forge` not found → install Foundry (`foundryup`), new window.

## 3. Build and rehearse on your PC (no keys, no network)

```powershell
cd C:\Users\DubT1\the-fire\contracts
forge build
forge test
cd ..\ops
npm test
node rehearsal\rehearse.mjs --chain-id 46630
```
- Good: `forge test` "0 failed"; `npm test` "fail 0"; the rehearsal ends `REHEARSAL PASSED`.
- If not: stop and send me the last 30 lines (`ops\rehearsal\out\rehearsal.log`). Don't deploy.

## 4. Set up the PowerShell window (every new window)

```powershell
cd C:\Users\DubT1\the-fire\contracts
$s = Read-Host "Testnet RPC URL" -AsSecureString
$env:RPC = [System.Net.NetworkCredential]::new("", $s).Password
$env:EXPECTED_CHAIN_ID = "46630"
$verify = "--verify", "--verifier", "blockscout", "--verifier-url", "https://explorer.testnet.chain.robinhood.com/api/"
function Load-Inputs { (Get-Content ..\deployments\46630.json | ConvertFrom-Json).inputs.psobject.Properties | ForEach-Object { Set-Item "env:$($_.Name)" $_.Value } }
Load-Inputs
$env:OWNER_HD_PATH = "m/44'/60'/N'/0/0"        # N = the testnet owner's account number in Ledger Live
cast chain-id --rpc-url $env:RPC
cast wallet list
$DEPLOYER = cast wallet address --account testnet-deployer
cast balance $DEPLOYER --ether --rpc-url $env:RPC
```
- Good: chain id `46630`; `cast wallet list` shows `testnet-deployer`; `$DEPLOYER` is the deployer's address (it asks
  the keystore password); balance about 0.05 or more.
- If not: no `testnet-deployer` → `cast wallet import testnet-deployer --interactive` (type the key in, it's hidden).
  Wrong chain id → wrong RPC URL, set it again. Balance 0 → faucet.

Check the Ledger (close Ledger Live, unlock, open the Ethereum app, Blind signing on):
```powershell
cast wallet address --ledger --hd-path $env:OWNER_HD_PATH
$env:OWNER
```
- Good: both print the same address (the testnet owner).
- If not: wrong account number N. Try the next one. Don't go on until they match.

## 5. Note the old pack art folder (before it's replaced)

```powershell
$oldPacks = (Get-Content ..\deployments\46630.json | ConvertFrom-Json).contracts.FirePacks
$env:PACK_IMAGE_BASE = (cast call $oldPacks "packImageBase()(string)" --rpc-url $env:RPC).Trim('"')
$env:PACK_IMAGE_BASE
```
- Good: prints `ipfs://.../` (or nothing, if it was never set).
- If not: empty is fine. The new FirePacks then needs `setPackImageBase` from the Ledger later (the launcher warns).

## 6. A fresh testnet kit: DevStack + DeployTwap

```powershell
$env:FROM_BLOCK = cast block-number --rpc-url $env:RPC     # the snapshot (step 14) scans from here
forge script script/DevStack.s.sol --rpc-url $env:RPC --account testnet-deployer --sender $DEPLOYER --slow --broadcast
node ..\ops\deploy\record.mjs --rpc $env:RPC
Load-Inputs
forge script script/DeployTwap.s.sol --rpc-url $env:RPC --account testnet-deployer --sender $DEPLOYER --slow --broadcast @verify
node ..\ops\deploy\record.mjs --rpc $env:RPC
Load-Inputs
$env:PAPER; $env:V2_ROUTER
```
- Good: DevStack prints the new PAPER, PLANK, USDG, WETH, pools, router and Paper Press (`MILL`); DeployTwap prints
  `PlankUsdTwap`; both records OK; the last line shows the NEW PAPER and router (different from before).
  DevStack's router already has the exact-output swaps: no DevRouter step any more.
- If not: "refuses to start while an unrecorded .pending file is there" → a broadcast before didn't get recorded:
  run `record.mjs`; if record says it didn't land, delete `..\deployments\46630.json.pending` and run the step again.
  Only "verify" failed (Blockscout)? It's deployed: run `record.mjs` and go on. "not the testnet" →
  `$env:EXPECTED_CHAIN_ID` isn't 46630 (step 4).
- The file keeps two old entries nobody reads (`PaperBurner`, `PlankBurner`), so the contract counts below are 2 higher.

## 7. DeployInfra: new drand router + PAPER price feed

```powershell
forge script script/DeployInfra.s.sol --rpc-url $env:RPC --account testnet-deployer --sender $DEPLOYER --slow --broadcast @verify
node ..\ops\deploy\record.mjs --rpc $env:RPC
```
- Good: prints `OpenDrandRouter (DRAND_ROUTER): 0x...` and `PaperUsdTwap (PAPER_USD_FEED): 0x...`; record OK.
- If not: "has no contract code" or "decimals" → `Load-Inputs` didn't run in this window (step 4). Pending file: as
  step 6.

## 8. DeployCards: every card contract, keepers allowed to run LiquidityBurner

```powershell
$env:KEEPERS = "<main keeper address>,<backup keeper address>"
$env:ROYALTY_BPS = "500"
forge script script/DeployCards.s.sol --rpc-url $env:RPC --account testnet-deployer --sender $DEPLOYER --slow --broadcast @verify
node ..\ops\deploy\record.mjs --rpc $env:RPC
```
- Good: it lists FirePacks, FireCards, ... FireGroups, FireProfiles, ... and "Next: the OWNER hardware wallet
  accepts"; no "KEEPERS not set" line; record OK. `deployments\46630.json` now has 18 contracts: all new except
  `PlankUsdTwap`. Keep this window open: steps 8b-10 use `$env:KEEPERS` and `$env:ROYALTY_BPS`.
- If not: "OWNER is the deployer" → `$env:OWNER` is wrong (run `Load-Inputs`). "V2_ROUTER" / "PLANK_USD_FEED"
  errors → `Load-Inputs` again after step 6. "V2_ROUTER's factory has no PAPER/PLANK pool for the liquidity" → step 6
  didn't run (or `Load-Inputs` didn't after it). Ran out of gas money → faucet, then delete the `.pending` only if record
  says nothing landed, and run again.

**Profiles and the market:** FireProfiles and FireMarket come with DeployCards. Do **not** run `DeployProfiles.s.sol` or
`DeployMarket.s.sol` here (they refuse: "... is already in the deployments file"). They're only for adding them to a
deploy made before they existed.

## 8b. DeployPress: the Morning Wood

The daily paper's contract, paying LiquidityBurner (its PAPER still burns). The editor key (the paper's nightly pipeline) can only publish issues,
at least an hour before they open; the owner can veto until then.
```powershell
cast wallet import editor --interactive            # once, on the PC that publishes the paper (type the new key, hidden)
$env:EDITOR = cast wallet address --account editor
$env:EDITOR
forge script script/DeployPress.s.sol:DeployPress --rpc-url $env:RPC --account testnet-deployer --sender $DEPLOYER --slow --broadcast @verify
node ..\ops\deploy\record.mjs --rpc $env:RPC
```
- Good: forge prints `MorningWood 0x...` and `editor 0x...` (your `$env:EDITOR`); record OK. `deployments\46630.json`
  now has 18 contracts (the 17 + `MorningWood`).
- If not: "Multiple contracts in the target path" → the `:DeployPress` after the file name is missing. "MorningWood is
  already in the deployments file" → it was deployed already: skip to step 9 (or `$env:REPLACE_PRESS = "true"` for a
  new one). "OWNER / ROYALTY_RECEIVER missing" or "have no code" → `Load-Inputs` (step 4). Pending file: as step 6.

## 9. AcceptOwnership + AcceptPress on the Ledger (8 + 1 confirmations)

Dry run first (nothing sent), then for real:
```powershell
forge script script/AcceptOwnership.s.sol --rpc-url $env:RPC --ledger --hd-paths $env:OWNER_HD_PATH --sender $env:OWNER --slow
forge script script/AcceptOwnership.s.sol --rpc-url $env:RPC --ledger --hd-paths $env:OWNER_HD_PATH --sender $env:OWNER --slow --broadcast
```
- Good: eight confirmations on the device (FirePacks, FireCards, RecipeDealer, FireCredits, FireSale, FirePsa,
  LiquidityBurner, FireGames). Check each contract address on the screen against `deployments\46630.json`.

Then the Morning Wood (one confirmation; dry run first):
```powershell
forge script script/DeployPress.s.sol:AcceptPress --rpc-url $env:RPC --ledger --hd-paths $env:OWNER_HD_PATH --sender $env:OWNER --slow
forge script script/DeployPress.s.sol:AcceptPress --rpc-url $env:RPC --ledger --hd-paths $env:OWNER_HD_PATH --sender $env:OWNER --slow --broadcast
```
- Good: one confirmation (the address is `MorningWood` in `deployments\46630.json`); it prints `accepted 0x...` (or "The
  owner already holds MorningWood").
- If not: "refuses any other signer" → the Ledger account isn't `OWNER` (step 4 check). Ledger errors → Ledger Live
  closed? Ethereum app open? Blind signing on? It skips what's already accepted, so just run it again.

## 10. VerifyDeploy (read-only)

```powershell
forge script script/VerifyDeploy.s.sol --rpc-url $env:RPC
```
Run it in the **same window** as steps 8 and 8b: it checks the keepers, the royalty and the editor against
`$env:KEEPERS`, `$env:ROYALTY_BPS` and `$env:EDITOR`. In a new window, set those three again first (without
`KEEPERS` it FAILs with "KEEPERS not set here").
- Good: last line `0 FAIL`. Expected WAIT: `PAPER/USD: no PAPER pool with $10 found yet` (the new PAPER feed needs
  ~40 h after the keepers' first checkpoint), maybe `PLANK/USD not live yet` (the keepers checkpoint it every 30 min).
  Lines `a keeper in KEEPERS may run LiquidityBurner` (twice), `FireProfiles.CARDS is FireCards`, `FireMarket.CARDS is
  FireCards`, `FireMarket.PACKS is FirePacks`, `OpenDrandRouter is
  the real one`, the token and USDG lines, `MorningWood owned by the hardware wallet`, `MorningWood.editor is EDITOR`
  and `MorningWood pays LiquidityBurner` say OK.
- If not: any FAIL → stop and send me the FAIL lines. WAIT on `acceptOwnership` or `AcceptPress` → step 9 didn't
  finish: run it again.

## 11. Push the new addresses

```powershell
cd C:\Users\DubT1\the-fire
git add deployments\46630.json
git commit -m "Testnet redeploy: drand router, PAPER feed, card contracts, FireProfiles, FireMarket, Morning Wood"
git push origin wip/pending-approval
git push origin wip/pending-approval:refs/heads/claude/practical-gates-va0gq1
```
- Good: both pushes say `wip/pending-approval -> ...`. Vercel builds a new preview; Railway rebuilds the keepers if
  they run from this branch.
- If not: "rejected (fetch first)" → `git pull --rebase`, then push both again.

## 12. Railway: redeploy the two testnet keepers

In railway.com, for **each** testnet keeper service (main and backup):
1. Settings → Source: branch `wip/pending-approval`; config file `ops/keeper/railway.json`.
2. Variables, per service. These must be set:
   - `CHAIN_ID` = `46630`
   - `RPC_URL`: the testnet RPC (Alchemy; sealed)
   - `KEEPER_PRIVATE_KEY`: already there (sealed); never re-paste it anywhere else
   - `KEEPER_ROLE` = `main` on one service, `backup` on the other
   - `ALERT_WEBHOOK_URL` (sealed) and `HEARTBEAT_URL` (its own healthchecks.io check per service). Without these two
     the keeper refuses to start.
   - backup only: `MAIN_KEEPER_ADDRESS` = the main keeper's address.
   Optional: `FALLBACK_RPC_URL` (default: the public testnet RPC; `none` turns it off) and the thresholds
   (`CANCEL_WARN_HOURS` 6, `LOW_BALANCE_ETH` 0.002, `MIN_FLUSH_USD` 1). Nothing is needed for the Morning Wood: its
   ETH/USDG lands in LiquidityBurner and the keepers' normal run takes it.
3. These must **not** be set (they'd pin the old contracts): `DEPLOYMENTS_FILE`, `START_BLOCK`, `FIRE_CARDS`,
   `FIRE_SALE`, `FIRE_PSA`, `LIQUIDITY_BURNER`, `PAPER_BURNER`, `PLANK_BURNER`, `DRAND_ROUTER`, `CARDS_ADAPTER`, `PSA_ADAPTER`,
   `PAPER_USD_FEED`, `PLANK_USD_FEED`, `ETH_USD_FEED`, `SERIES`. Delete any you find.
4. Deployments → Redeploy (if it didn't rebuild by itself after step 11).
- Good: the log's first line is `keeper (main) 0x... on chain 46630; FireCards 0x<the NEW FireCards>`; the webhook gets
  a heartbeat. Each keeper has ~0.05 test ETH.
- If not: FireCards is the old address → step 3 above, or the service builds another branch. "expected 46630" → wrong
  RPC_URL. Low ETH alert → faucet.

**The PAPER price comes ~40 h after this.** Until then: packs take the set PAPER (fine) and everything sent to
LiquidityBurner (sale shares, pack PAPER, case and grading fees) waits there (fine). Check:
```powershell
cd C:\Users\DubT1\the-fire\contracts
$feed = (Get-Content ..\deployments\46630.json | ConvertFrom-Json).contracts.PaperUsdTwap
cast call $feed "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url $env:RPC
```
- Good (after ~40 h): the second number is above 0.

## 13. Site: testnet preview

Vercel → the project → Settings → Environment Variables:
- `VITE_LIVE` = `testnet`, environment **Preview only** (never Production).
- Leave `VITE_TESTNET_RPC_URL` empty: the public testnet RPC is already allowed by the site's security policy; another
  host would be blocked in the browser.
- `VITE_REOWN_PROJECT_ID`: needed for the test (phones connect through it; without it a phone browser with no wallet
  only sees "No wallet found"). It's already in, from earlier: check it's ticked for Preview.

Then Deployments → the newest `wip/pending-approval` preview → Redeploy.
- Good: the preview opens live on the testnet (no demo banner; Connect asks for Robinhood Chain Testnet). Without the
  variable, add `?live=testnet` to the preview URL: same thing.
- If not: still the demo → the variable isn't on Preview, or the preview wasn't rebuilt after setting it.

## 13b. Competitive games on the testnet (once; needs the PAPER price, so test them two days after step 12)

Follow `docs/game-server.md` sections 1-3 with these differences:
- Environment **Preview** (not Production) for every variable.
- `GAME_CHAIN_ID` = `46630`, `FIRE_GAMES_ADDRESS` = `FireGames` from `deployments\46630.json`, `GAMES_PAID_OPEN` = `1`,
  `GAMES_JUDGING` = `1`. A testnet signer: a new `cast wallet new` key, never the mainnet one.
- On chain, from the Ledger (each one confirmation):
  ```powershell
  $games = (Get-Content ..\deployments\46630.json | ConvertFrom-Json).contracts.FireGames
  cast send $games "setSigner(address)" <the signer's address> --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC
  cast send $games "setSeries(uint256)" 1 --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC
  cast send $games "setGameOpen(uint256,bool)" 1 true --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC
  ```
  (`setGameOpen` may already be on from the deploy; sending it again is harmless.) Prizes: `FireCredits.setPrizeAwarder`
  only before you hand out prizes (section 4); not needed to play.
- Redeploy the preview.
- Good: the Game room's Fold and Flick shows `Competitive · 1 PAPER`. Before the PAPER price exists it says "That game
  isn't open": wait for it. Friends in AZ, AR, CT, DE, LA, MT, SC, SD, TN, IN or ME can't play competitive (the
  server blocks those states); free play works everywhere.

## 14. Series 1 = Jean Phil, Series 2 = Gym Bros (the Test run preset)

The two practice Series are the collections already in the Card Studio: **Jean Phil × Painted Cubism** as **Series 1**
and **Renaissance Gym Bros × Fresco Painting** as **Series 2** (5 characters each). In the studio, set each one's Series
number (1 and 2) before building, so the cards print the right Series. Series 2 is what tests burn credits (a credit
earned in Series 1 is spent in Series 2) and a second pack art.

Sale tab → **Start from: Test run**. It's the Standard's four groups, small and quick, with no long waits:
- 12 packs. **Paper Press holders** (2) and **PLANK holders** (3, snapshot) open together at the start. Each ends when
  it's sold, **3 minutes after its last sale**, or at **15 minutes**, whichever is first; leftovers go to Everyone.
- **Everyone** (the other 7, 3 per wallet) opens the moment the PLANK group ends.
- **After sell-out**: extra packs at a rising price, ending **5 minutes** after its last sale. Then the keeper closes
  the Series and packs can open.
- Free packs: 2 (1 per wallet), from Everyone. Bots rule off (0 h), so friends on smart wallets can buy too.
Nothing is outside the policy, so no `--allow` is needed.

**Sell it out.** Packs only open once the Series closes. If the 12 don't sell, the owner can end it only 24 h after
the start (`endDrop`, below). So count your testers: if fewer than ~6 people, buy the rest yourself near the end.
```powershell
$sale = (Get-Content ..\deployments\46630.json | ConvertFrom-Json).contracts.FireSale
cast send $sale "endDrop(uint256)" 1 --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC   # only 24 h after the start
```

**Pack art.** The site shows `fire<N>.webp` from FirePacks' pack art folder. In the studio, Export → **Pack art** with
Jean Phil's pack as Series 1 and Gym Bros' as Series 2, upload the folder, then (Ledger)
`cast send <FirePacks> "setPackImageBase(string)" "ipfs://<CID>/" --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC`.

**Friends' wallets, a day before.** Ask each tester for their wallet address. Send each a little test ETH if they
can't get it from the faucet (https://faucet.testnet.chain.robinhood.com). Mint PLANK to the ones who'll test the PLANK
group and Paper Presses to the ones who'll test the Press group (commands below), **before** the launch's snapshot.

**Full Art is one per character (Oct 29).** In the studio's Recipe tab, Full Art must show **1 per character** (the
Standard has it). With 5 characters and 12 packs, all five Full Arts come out of each Series, one each.

**Free packs this run: suggestions, picked before the start.** A burn credit (step 15) only works in a *later*
Series (cards exist only after this one closes), so test free packs with a picked suggestion:
1. Before the launch, a test wallet suggests something on the site (Suggest). Its id is the newest:
   `cast call (Get-Content C:\Users\DubT1\the-fire\deployments\46630.json | ConvertFrom-Json).contracts.FireCredits "suggestionCount()(uint256)" --rpc-url $env:RPC`
   minus 1.
2. Launch with a start time at least 30 min after you expect to type `LOCK`.
3. After `LOCK` and **before the start**, pick it from the Ledger:
   ```powershell
   $credits = (Get-Content C:\Users\DubT1\the-fire\deployments\46630.json | ConvertFrom-Json).contracts.FireCredits
   cast send $credits "pickSuggestions(uint256,uint256[])" <N> "[<id>]" --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC
   ```
   (After the start it refuses: `DropStarted`.) The wallet then has a credit; it claims the free pack on the site
   while Everyone is open.

Next to it, the snapshot side file `contracts\series\fire-<N>-snapshots.json` (group index 1 = the PLANK group).
The snapshot scans the token's transfers in log searches: Alchemy's free plan allows only 10 blocks per search, so
run the launch with `RPC` = Alchemy (it keeps past balances; the public node doesn't) and `LOGS_RPC` = the public
RPC (big log searches), and start the scan at this deploy (`fromBlock`: the deployments
file's `startBlock`; the test PLANK goes out after it). For a practice run, `days` can be a fraction (0.02 = ~30 min).
```json
{ "1": { "token": "plank", "minUsd": 69, "tiers": "69:1,300:2", "days": 1, "fromBlock": <the FROM_BLOCK from step 6> } }
```
Test wallets must hold the PLANK through that window (`days` 1 = the last day). Mint them PLANK and a Paper Press a day
before (deployer pays; amounts in wei; on the testnet kit 10^27 wei of PLANK is about $1, so this is about $1,000):
```powershell
cast send $env:PLANK "mint(address,uint256)" <test wallet> "1000000000000000000000000000000" --account testnet-deployer --rpc-url $env:RPC
cast send $env:MILL "mint(address)" <test wallet> --account testnet-deployer --rpc-url $env:RPC
```
(Quote big numbers like the PLANK amount: PowerShell would otherwise turn them into `1E+30`.) Mint two Paper Presses
in all (the Press group is 2 packs, 1 per Press), one each to two testers.

Launch (Ledger: batch A, then one confirmation for batch B). `$env:RPC` is already set from step 4:
```powershell
cd C:\Users\DubT1\the-fire
$env:LOGS_RPC = "https://rpc.testnet.chain.robinhood.com/rpc"   # big log searches (the snapshot)
node ops\series\launch.mjs --recipe contracts\series\recipe-fire-<N>.json --start "2026-10-25 18:00" --chain 46630
```
- Good: one OK line per check; a PLANK snapshot line like `2 wallets hold $69+ of PLANK`; `GREEN`; you type `LOCK`;
  `Series locked`; `7  Done`. It writes `web\art\factory\forge\holders\series-<N>.json`. Expected WARN: `PAPER price
  feed isn't live yet` (before 40 h).
- If not: read the STOP line, fix that one thing, run the **same command** again (done steps are skipped, nothing is
  sent twice). Snapshot can't read old blocks → archive RPC (Alchemy). RED on images → re-pin on Filebase, run again.
  `FirePacks has no pack art folder` → `cast send <FirePacks> "setPackImageBase(string)" "ipfs://<CID>/" --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC`.

Then push the holders file and the recipe so the site has the proofs:
```powershell
git add web\art\factory\forge\holders\series-<N>.json contracts\series\recipe-fire-<N>.json contracts\series\fire-<N>-*.json
git commit -m "Testnet Series <N>: holders file"
git push origin wip/pending-approval
git push origin wip/pending-approval:refs/heads/claude/practical-gates-va0gq1
```

Check the whole deploy with the Series:
```powershell
cd contracts
$env:SERIES = "<N>"
forge script script/VerifyDeploy.s.sol --rpc-url $env:RPC
```
- Good: `0 FAIL` and `Series <N>: locked, drop set`.

## 15. Test checklist on the testnet preview

Use a test wallet with test ETH. Tick each:

- [ ] **Connect**: the wallet switches to Robinhood Chain Testnet.
- [ ] **Get PAPER** on the site with ETH (also PLANK, USDG).
- [ ] **Buy** in each group: a Press holder claims in the Press group; a snapshot wallet buys up to its allowance in
      the PLANK group (one not in the file can't); Everyone opens when the PLANK group ends.
- [ ] **Pay** with ETH (own PAPER, and "Pay the PAPER in ETH too"), with PLANK, with USDG.
- [ ] **Extra packs** (after sell-out group): one pack per purchase, the price goes up each pack; no sale for the idle
      time ends it; the keeper closes the Series.
- [ ] **Open packs**: the button shows only once the Series has closed and you hold packs; drand arrives (~90 s);
      the cards appear. Keeper log: `fulfillMany success`, `process success`.
- [ ] **Case and grade, paid in ETH**: the slab shows the grade; the card's page on the explorer shows the grade
      after a refresh.
- [ ] **Case and grade, paid in USDG or PLANK**: the cost shown, the wallet asks to approve it, then it goes through;
      Pay with shows ETH, PLANK and USDG only (no PAPER).
- [ ] **One grading price**: every card shows the same grading price (`FirePsa.gradeUsd18`).
- [ ] **Profiles**: set a name and a picture from a card you hold; it shows next to your pulls; sell or send the card
      and the picture goes away.
- [ ] **Market**: Menu › Market. From one wallet: open a card › Sell › 0.001 › List for sale (the wallet asks once to
      let the market sell your cards, then to list); the card says "For sale". From a second wallet: Market › tap it ›
      Buy. It moves to the second wallet; the first gets the price less the 5% royalty. Also: Mine › Sell packs (before
      opening), buy them from the other wallet; change a price; Take off sale; Take everything off sale.
- [ ] **Feed**: your rare pulls show in the feed; the Series board shows who fed the fire.
- [ ] **Free pack**: the wallet whose suggestion you picked (step 14) claims its free pack while Everyone is open.
- [ ] **Burn** 42 cards: the wallet gets a free pack credit (it can only be used in a later Series).
- [ ] **Suggest** a theme and style in one transaction; suggest a character.
- [ ] **Pause** and unpause the sale from the Ledger (`cast send <FireSale> "setPaused(bool)" true --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC`, then `false`): buying stops, then works.
- [ ] **Backup keeper**: stop the main keeper in Railway for 10 min while a pack opens; the backup steps in (webhook
      says so); start the main keeper again.
- [ ] **Explorer**: packs and cards show with the right images and traits.
- [ ] **Morning Wood** (cast or the explorer's Write tab only: the site's paper page doesn't buy yet). In the step 4
      window, `$press = (Get-Content C:\Users\DubT1\the-fire\deployments\46630.json | ConvertFrom-Json).contracts.MorningWood`, then:
  - The editor publishes issue 1 to open in 70 min:
    `$at = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 4200`, then
    `cast send $press "publish(uint256,string,uint64)" 1 "ipfs://<any test CID>/metadata.json" $at --account editor --rpc-url $env:RPC`.
    Publishing to open now (`0`) or in under an hour is refused (`BadTime`).
  - The owner vetoes it: `cast send $press "unpublish(uint256)" 1 --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC`.
  - The owner publishes issue 2 to open now (only the owner can):
    `cast send $press "publish(uint256,string,uint64)" 2 "ipfs://<any test CID>/metadata.json" 0 --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC`.
  - A test wallet buys a copy in ETH: `cast call $press "quote(uint256,uint256,uint8)(uint256,uint256)" 2 1 0 --rpc-url $env:RPC`
    gives the ETH cost and the PAPER; approve that PAPER to `$press`, then `buy(uint256,uint256,uint8,uint256)` with
    `2 1 0 <cost>` and `--value <cost>` (the explorer's Write tab, or `cast send ... --account <a test keystore>`).
    The ETH lands in LiquidityBurner.
  - It sends a letter: `submitLetter(uint256,string)` `2 "Dear editor ..."` (1 PAPER, to the liquidity fire; approve it first).

- [ ] **Full Art**: once every pack is open, exactly 5 Full Arts, one per character, each in a pack with 2 Papers.
      `cast call (Get-Content C:\Users\DubT1\the-fire\deployments\46630.json | ConvertFrom-Json).contracts.RecipeDealer "onePerCharacterOwed(uint256)(uint256[])" <N> --rpc-url $env:RPC`
      gives `[]` when all are out.
- [ ] **Liquidity on the home page**: after the keeper's first LiquidityBurner run that adds liquidity (it needs the
      PAPER price, ~40 h after step 12), the burn gauge shows "Liquidity locked" in dollars next to the burned PLANK and
      PAPER.

Anything that fails: write down what you did, what you saw, and the time. Send it to me; I fix it, you redo that line.

## 16. Mainnet-fork liquidity test (read-only, any time, no keys)

Runs LiquidityBurner against the **real** PAPER/PLANK pool on a copy of Robinhood Chain: nothing is sent anywhere.
```powershell
cd C:\Users\DubT1\the-fire\contracts
$env:FORK_RPC = "https://rpc.mainnet.chain.robinhood.com"
forge test --match-path test/cards/LiquidityFork.t.sol -vv
Remove-Item Env:FORK_RPC
```
- Good: `[PASS] test_fork_pairsAndBurnsOnTheRealPool`, with the PAPER and PLANK prices it read and "pool tokens burned".
- If it says `[SKIP]`: `FORK_RPC` wasn't set in this window. Any other failure: send me the output.
