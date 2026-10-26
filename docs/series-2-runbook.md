# Testnet Series 2 runbook

A small second Series on the testnet (chain 46630) to try what Series 1 didn't: pack art from the Studio, the tilt
layers inside the images folder, pausing a live sale, and a second launch. About an hour or two at your PC, with the
Ledger. The full background is `docs/testnet-runbook.md` (steps 4 and 14); this is the short path.

## 1. Pull and start the Studio

```powershell
cd C:\Users\DubT1\the-fire
git pull origin wip/pending-approval
cd studio
npm install
npm run dev
```
Keep that window open; open the `Local: http://localhost:...` address it prints. Open a second PowerShell window for
everything below.

## 2. Build Series 2 in the Studio

1. **New Series** (number 2), Standard recipe, the same three characters (or new ones).
2. **Small sale**, so it sells out in an afternoon: Paper Press 2 packs (20 min), PLANK holders 3 packs (20 min),
   Everyone the rest (about 10 in all, 5 per wallet, limit lifting after 15 min), after sell-out idle 10 min.
3. **Build all**, then **Export**:
   - Enter the Filebase key (access key, secret, bucket `omni-cards-test`) and **Use key**.
   - **Upload to Filebase only**. The images folder now carries the tilt layers too, so the site needs nothing extra.
   - **Pack art**: **Add pack art** for Series 2 (any image for the test; Series 1 can get one too: open Series 1's
     Export and add it there). Then **Upload pack art**, and copy the `ipfs://.../` it shows.
   - **Download recipe.json** into `C:\Users\DubT1\the-fire\contracts\series\recipe-fire-2.json`.

## 3. PowerShell session (the second window)

As in `docs/testnet-runbook.md` step 4: set `$env:RPC` (Alchemy, typed in hidden), `$env:EXPECTED_CHAIN_ID`,
`Load-Inputs`, `$env:OWNER_HD_PATH = "m/44'/60'/9'/0/0"`, then check the Ledger address matches `$env:OWNER`.
For the launch's snapshot also set the public RPC for log searches:
```powershell
$env:LOGS_RPC = "https://rpc.testnet.chain.robinhood.com/rpc"
```

## 4. Pack art on chain (Ledger, one confirmation)

```powershell
$packs = (Get-Content C:\Users\DubT1\the-fire\deployments\46630.json | ConvertFrom-Json).contracts.FirePacks
cast send $packs "setPackImageBase(string)" "ipfs://<the pack art CID>/" --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC
```
- Good: `status 1 (success)`. Series 1's packs on the explorer then show their art too (if Series 1's image is in the
  folder).

## 5. Snapshot file and launch

`contracts\series\fire-2-snapshots.json` (group 1 = PLANK holders; a short window for a practice run):
```json
{ "1": { "token": "plank", "minUsd": 69, "tiers": "69:1,300:2", "days": 1, "fromBlock": <deployments startBlock>, "step": 10 } }
```
```powershell
cd C:\Users\DubT1\the-fire
node ops\series\launch.mjs --recipe contracts\series\recipe-fire-2.json --start "<date> <time>" --chain 46630 --skip-image-check
```
- Good: OK lines, `Pack art is there: ...fire2.webp`, `GREEN`, type `LOCK`, `7  Done`.
- If not: read the STOP line, fix that one thing, run the same command again.

Push the holders file and recipe (as in testnet-runbook step 14), then tell me so the preview shows Series 2.

## 6. On the site, while it's on sale

- Buy a pack in each group as before.
- **Pause** (Ledger):
  ```powershell
  $sale = (Get-Content C:\Users\DubT1\the-fire\deployments\46630.json | ConvertFrom-Json).contracts.FireSale
  cast send $sale "setPaused(bool)" true --ledger --hd-path $env:OWNER_HD_PATH --from $env:OWNER --rpc-url $env:RPC
  ```
  Try to buy: it should refuse. Then unpause (`false` in place of `true`) and buy again: it works.
- After sell-out: open packs. Holo cards tilt (the layers come from the images folder this time), pack art shows on the
  packs, the gauge counts down the draw.
