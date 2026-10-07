# Ops

## Snapshot (holder window)

`snapshot/` takes the PLANK-holder snapshot for a drop's holder window: every regular wallet (not a contract) holding
at least $69 of PLANK, priced with the same 30-minute average the sale uses (`PlankUsdTwap`). It builds the Merkle
tree, checks every proof and writes a JSON file for the site.

```sh
cd ops/snapshot
npm install
export RPC=https://rpc.mainnet.chain.robinhood.com
node snapshot.mjs --min-usd 69 --out fire-7-holders.json
npm run selftest   # offline check of the Merkle code
```

PLANK and the PlankUsdTwap come from `deployments/<chainId>.json` (`PLANK`, `PLANK_USD_FEED` override). It prints the
**root**: pass it as `HOLDER_ROOT` to batch B (`docs/deploy.md`, step 6); VerifySeries recomputes it from the file. The JSON file is for the site: the
live site is planned to load each buyer's proof from it automatically. Take the snapshot at a time nobody knows in advance, before the drop is set up.

## Keeper (`keeper/`)

Always on (Railway) with a GitHub Actions backup (`.github/workflows/keeper.yml`, one pass every 5 minutes). Setup,
settings and alerts: `keeper/README.md`. Every call it makes is permissionless:

- `PlankUsdTwap.checkpoint()` when `due()` (every 30 minutes; FireSale pauses PLANK pricing when the window is over
  2 hours old) and `PaperUsdTwap.checkpoint()` when `due()`
- drand numbers to the router for card opens and PDA grading (`OpenDrandRouter.fulfillMany`; `adapter.settle` if a
  callback didn't land), each request answered through the source that took it
- `FireCards.process(fire, maxCards)` and `FirePsa.finish(index, ids)` (ids from the grading's `Protected` event)
- `PaperBurner.flush(pay)` and `PlankBurner.flush(pay)` when they hold a backlog a flush can burn

Alerts (Discord, Slack or Telegram webhook): stale feeds, opens or gradings ready but not done, waiting fees, drand
lag, low keeper ETH, and a daily heartbeat.

## VerifySeries (`series/`)

The read-back between a Series' two Safe signings (`docs/deploy.md`, step 6): on-chain recipe, characters, dealer,
images base against the studio's `recipe.json`, and FirePsa's fixed PDA odds; every image the contract can name, loaded through two or
more gateways; the folder's `manifest.json`; the holder Merkle root from the snapshot file. GREEN or RED.

```sh
cd ops && npm install
RPC=... node series/verify-series.mjs --recipe ../contracts/series/recipe-fire-7.json --snapshot fire-7-holders.json
```

## Rehearsal (`rehearsal/`)

The whole launch on a local anvil chain (or a Robinhood Chain fork with `--fork <RPC>`): `docs/deploy.md`,
"Rehearsal". `npm test` here runs VerifySeries' unit tests; the keeper's are in `keeper/`.
