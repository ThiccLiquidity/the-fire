# Ops

## Keeper (to build)

The card system needs one always-on helper, like the old game had: `PlankUsdTwap.checkpoint()` every 30 minutes
(FireSale pauses PLANK pricing when the window is over 2 hours old), `PaperUsdTwap.checkpoint()` when `due()`, and
delivering drand numbers for card opens and PDA reveals (`OpenDrandRouter.fulfill`, `adapter.settle`). Every call is
permissionless. Not written yet; the old game's keeper (`git show 21bb12d:ops/keeper/keeper.mjs`) is a
starting point.

## Snapshot (holder window)

`ops/snapshot` takes the secret PLANK-holder snapshot for a drop's holder window: every regular wallet holding $69+
of PLANK, priced with the same 30-minute average the sale uses. From PowerShell:

```powershell
cd C:\Users\DubT1\the-fire\ops\snapshot
npm install
$env:RPC = "https://rpc.mainnet.chain.robinhood.com"
$env:PLANK_USD_FEED = "<PlankUsdTwap address>"
node snapshot.mjs --min-usd 69 --out fire-7-holders.json
```

It prints the **root**: paste it as `holderRoot` when you set up the drop. Give the JSON file to the site so buyers'
proofs load automatically. Run it at a moment nobody knows in advance.
