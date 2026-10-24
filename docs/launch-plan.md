# Launch plan

The order to go live, what each step needs from you, and what's already done. Nothing goes to `main`, the live
site address or mainnet without your OK. Work lands on `wip/pending-approval` and shows on Vercel preview links only.

## Where things are (Oct 24, 2026)

| Done | Not done |
|---|---|
| Card contracts and the Morning Wood, tested and reviewed internally (rounds 5-8, pre-testnet audit Oct 24: no Critical/High/Medium) | An outside audit |
| Testnet deploy (chain 46630), owner on the Ledger | The testnet card contracts predate FireGroups, FireProfiles and the Morning Wood: redeploy them (step 1, `docs/testnet-runbook.md`) |
| Railway keeper on the testnet | A full end-to-end testnet run with a real Series |
| Card Studio: library, recipe, deal, build, drawn holo, Filebase upload | The practice Series built and uploaded with the new holo |
| Demo site: buy, open, case & grade, burn, suggest, live holo | |
| Live mode: `?live=testnet` runs the site on the contracts (connect, buy, press and free packs, open, case & grade, burn, suggest); walked end to end on a local chain (`npm run test:forge`) | Walking it on the real testnet (step 2) |
| Suggestion waves, the public results page and its one-time reveal; `ops/suggestions/publish.mjs` publishes results | Running it for real (the first suggestion week) |
| Security checklist (`docs/security-checklist.md`) | You working through it |

## 1. Testnet redeploy (about 30 minutes, needs your Ledger)

Follow `docs/testnet-runbook.md` top to bottom: it is the up-to-date version of this step (DevRouter, DeployInfra,
DeployCards, the Morning Wood, AcceptOwnership + AcceptPress, VerifyDeploy, Railway). The notes below are background.

The testnet `FireCredits` has no `suggestMany`, the sale now has its PAPER share, the PAPER price feed has the
per-pool clocks and PaperBurner the flusher list (Oct 22 wallet audit), so the PAPER feed and the card contracts go
again. The PLANK price feed stays (runbook step 1 is not repeated); runbook step 2 (DeployInfra: the drand router and
the PAPER feed) is.

1. `git pull` in `C:\Users\DubT1\the-fire`.
2. In PowerShell, from `contracts`, set up the testnet session exactly as in `docs/deploy.md` → Testnet (the `$env:RPC`,
   `$env:EXPECTED_CHAIN_ID = "46630"` and `$verify` lines, and load the inputs from `deployments\46630.json`).
3. The testnet kit's router needs the exact-output swaps (Get PAPER, buying with ETH alone):
   `forge script script/DevRouter.s.sol --rpc-url $env:RPC --account testnet-deployer --sender <deployer address> --slow --broadcast`,
   then `node ..\ops\deploy\record.mjs --rpc $env:RPC` and set `$env:V2_ROUTER` to the address it printed.
   Runbook step 2 (DeployInfra), then `node ..\ops\deploy\record.mjs --rpc $env:RPC`. Then set
   `$env:KEEPERS = "<main keeper address>,<backup keeper address>"` (public addresses, from Railway) and run runbook
   step 3 (DeployCards) with `--account testnet-deployer`, then `node ..\ops\deploy\record.mjs --rpc $env:RPC`.
   It writes the new card contract addresses into `deployments/46630.json` (FireProfiles included: names and profile
   pictures, no owner).
4. Runbook step 4 (AcceptOwnership) on the Ledger: seven confirmations. Then VerifyDeploy: 0 FAIL.
   Only adding profiles, not redeploying? Instead of 3-4: `forge script script/DeployProfiles.s.sol --rpc-url $env:RPC
   --account testnet-deployer --sender <deployer address> --broadcast @verify`, record, VerifyDeploy (no Ledger: it has
   no owner).
5. Push (`deployments/46630.json`). Railway's testnet keepers read that file: redeploy them in Railway so they pick
   up the new addresses (or they'll keep watching the old contracts). The PAPER price comes back about 40 hours later.

## 2. Official testnet run (an afternoon, needs your Ledger)

Use the practice Series with real art (five pictures per character, the studio draws the holo).

1. Studio: build the Series' images, upload to Filebase, recipe → `node ops/series/launch.mjs --chain 46630` (it
   stops at the first problem and tells you what to fix).
2. Site: open the preview with `?live=testnet`. Connect a test wallet. (Without `?live` the site is the demo, as
   always. `?live=mainnet` shows the demo until `deployments/4663.json` has the card contracts.)
   If the drop has a snapshot group (e.g. the Standard preset's PLANK holders), say whose wallets it takes in
   `fire-<n>-snapshots.json` next to the recipe (token, minimum, allowance tiers: `ops/README.md`); the launcher takes
   the snapshot and, after the lock, writes `web/art/factory/forge/holders/series-<n>.json` (each wallet's allowance and
   proof) for the site: publish it with the drop. Paper Press holders need no file (checked live). The snapshot counts
   each wallet's smallest holding (Uniswap V2 LP share included) over 5 blocks in the past week; `node
   ops/snapshot/snapshot.mjs --verify <file>` rebuilds it from the chain (needs an archive RPC; VerifySeries runs it too).
3. Walk every flow and tick it:
   - [ ] Buy packs with PLANK, with ETH (with your own PAPER, and with "Pay the PAPER in ETH too"), with USDG; each burns the PAPER per pack
   - [ ] Get PAPER on the site (ETH, PLANK, USDG)
   - [ ] The groups: a Press holder claims in the Press group; a wallet in the snapshot buys up to its allowance in the
         PLANK group, one not in it can't; Everyone opens when the PLANK group ends
   - [ ] A group's wallet limit (and the after sell-out group's one pack a purchase) refuses one too many
   - [ ] The after sell-out group's price rises each pack; 15 minutes without a sale ends it and the keeper closes the
         Series (`FireSale.close`); or sell out or end the drop; the Series closes
   - [ ] Open a pack; drand arrives (~90 s); the cards appear; the keeper log shows `fulfillMany` and `process`
   - [ ] Case a card; grade a card; the slab shows the grade
   - [ ] Burn 42 cards for a free pack credit (it can only be used in a later Series: cards exist only once this
         one has closed). Free packs this run come from picked suggestions (runbook step 14)
   - [ ] Suggest a theme and an art style in one transaction; suggest a character
   - [ ] Announce the wave's closing block and drand round (`draw.mjs --plan`), run the draw with them
     (`--to-block`, `--drand-round`), `draw.mjs --verify` it, pick winners, publish results; a winner claims the free pack
   - [ ] Pause and unpause the sale from the Ledger
   - [ ] Stop the main keeper; the backup steps in
   - [ ] Cards and packs show on the testnet explorer with the right images and traits
4. Anything that fails: note it, I fix it, run that part again.

## 3. Audit (in parallel with 2)

- **Code:** a final internal pass over everything changed since the last review (holo, suggestion waves,
  `suggestMany`, the live site). Then decide on an outside audit of the contracts. An outside audit is the
  strongest single thing for buyers' trust; it costs money and usually 1-3 weeks of lead time, so ask for quotes now
  if you want one.
- **You:** `docs/security-checklist.md`.

## 4. Mainnet (one sitting, needs your Ledger, ~$50 of ETH for the deployer)

The runbook in `docs/deploy.md`, in order. Start the PLANK price feed at least 30 minutes before the card contracts,
and the PAPER feed about 40 hours before the first drop (it needs that long for its first price). Owner accepts,
VerifyDeploy 0 FAIL, keepers on mainnet, `deployments/4663.json` committed.
Then your OK to merge to `main`: the live site switches from demo to the real contracts.

## 5. Announce and the first suggestion week

1. **Announce Omni Cards**: what they are, how packs, holo, grading and burning work, and that the first Series'
   theme, art style and characters come from the community. Real site link only.
2. **Theme & art style week**: the suggestion box opens (1 PAPER each; theme and style in one transaction).
   **When it opens, announce how the draw will be made** (`node ops/suggestions/draw.mjs --rpc <url> --plan --close
   "<closing time>"` prints both): "the wave closes at block N; the draw's seed is drand quicknet round R" (a round
   about an hour after the close). Entries mined after block N don't count, and nobody, you included, can know
   round R's number before it comes out, so nobody can steer the shortlist.
   After the week, once block N is final and round R is out: run the draw with `--to-block N --drand-round R` (10 per
   kind; the file keeps the block, the round and drand's signature), you pick, results go up, winners get their free
   pack. Anyone can re-run it with `draw.mjs --verify <file>`.
3. **Characters wave** for the picked theme and style, same way (a new closing block and round, announced when it
   opens).
4. **Series 1**: build the art, upload, set up the drop, announce the date.

## Still open before the first drop

- Real-chain gas test (`contracts/test/cards/SaleFork.t.sol` against Robinhood Chain). Runs on your PC: the cloud
  machine I build on can't reach Robinhood Chain's RPC.
- On-chain checks: PAPER is 18 decimals; transfers to `0x…dEaD` work for PAPER and PLANK; a USDG/WETH pool exists;
  PLANK's reward-list status.
- Final case and grade prices.
- Marketplace support for Robinhood Chain; a trademark search for the name; a legal read on selling packs with
  random contents.
