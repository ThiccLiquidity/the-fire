# Launch plan

The order to go live, what each step needs from you, and what's already done. Nothing goes to `main`, the live
site address or mainnet without your OK. Work lands on `wip/pending-approval` and shows on Vercel preview links only.

## Where things are (Oct 21, 2026)

| Done | Not done |
|---|---|
| Card contracts, tested and reviewed internally (rounds 5-8) | An outside audit |
| Testnet deploy (chain 46630), VerifyDeploy 0 FAIL, owner on the Ledger | The testnet card contracts predate `suggestMany` (theme + style in one transaction): redeploy them (step 1) |
| Railway keeper on the testnet | A full end-to-end testnet run with a real Series |
| Card Studio: library, recipe, deal, build, drawn holo, Filebase upload | The practice Series built and uploaded with the new holo |
| Demo site: buy, open, case & grade, burn, suggest, live holo | The site talking to the chain (being built: the chain layer and a `?live=testnet` preview mode) |
| Suggestion waves (contract + site form + local draw) | The public results page (being built) |
| Security checklist (`docs/security-checklist.md`) | You working through it |

## 1. Testnet redeploy (about 30 minutes, needs your Ledger)

The testnet `FireCredits` has no `suggestMany`, so the card contracts go again. The PLANK and PAPER price feeds and
the drand router stay (steps 1-2 of the runbook are not repeated).

1. `git pull` in `C:\Users\DubT1\the-fire`.
2. In PowerShell, from `contracts`, set up the testnet session exactly as in `docs/deploy.md` → Testnet (the `$env:RPC`,
   `$env:EXPECTED_CHAIN_ID = "46630"` and `$verify` lines, and load the inputs from `deployments\46630.json`).
3. Runbook step 3 (DeployCards) with `--account testnet-deployer`, then `node ..\ops\deploy\record.mjs --rpc $env:RPC`.
   It writes the new card contract addresses into `deployments/46630.json`.
4. Runbook step 4 (AcceptOwnership) on the Ledger: seven confirmations. Then VerifyDeploy: 0 FAIL.
5. Push (`deployments/46630.json`). Railway's testnet keepers read that file: redeploy them in Railway so they pick
   up the new addresses (or they'll keep watching the old contracts).

## 2. Official testnet run (an afternoon, needs your Ledger)

Use the practice Series with real art (five pictures per character, the studio draws the holo).

1. Studio: build the Series' images, upload to Filebase, recipe → `node ops/series/launch.mjs --chain 46630` (it
   stops at the first problem and tells you what to fix).
2. Site: open the preview with `?live=testnet` (the live mode being built now). Connect a test wallet.
3. Walk every flow and tick it:
   - [ ] Buy a pack with PAPER, with ETH, with PLANK, with USDG
   - [ ] The holder window (a wallet in the snapshot buys early; one not in it can't)
   - [ ] The wallet limit refuses one too many
   - [ ] Sell out or end the drop; the Series closes
   - [ ] Open a pack; drand arrives (~90 s); the cards appear; the keeper log shows `fulfillMany` and `process`
   - [ ] Case a card; grade a card; the slab shows the grade
   - [ ] Burn cards for PAPER
   - [ ] Suggest a theme and an art style in one transaction; suggest a character
   - [ ] Run the draw (`ops/suggestions/draw.mjs`), pick winners, publish results; a winner claims the free pack
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
   After the week: run the draw (10 per kind at random, seed published), you pick, results go up, winners get their
   free pack.
3. **Characters wave** for the picked theme and style, same way.
4. **Series 1**: build the art, upload, set up the drop, announce the date.

## Still open before the first drop

- Real-chain gas test (`contracts/test/cards/SaleFork.t.sol` against Robinhood Chain). Runs on your PC: the cloud
  machine I build on can't reach Robinhood Chain's RPC.
- On-chain checks: PAPER is 18 decimals; transfers to `0x…dEaD` work for PAPER and PLANK; a USDG/WETH pool exists;
  PLANK's reward-list status.
- Final case and grade prices.
- Marketplace support for Robinhood Chain; a trademark search for the name; a legal read on selling packs with
  random contents.
