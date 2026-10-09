# Ops

## Snapshot (holder window)

`snapshot/` takes the PLANK-holder snapshot for a drop's holder window: every regular wallet (not a contract) holding
at least $69 of PLANK, priced with the same 30-minute average the sale uses (`PlankUsdTwap`). It builds the Merkle
tree, checks every proof and writes a JSON file for the site.

```sh
cd ops/snapshot
npm ci
export RPC=https://rpc.mainnet.chain.robinhood.com
node snapshot.mjs --min-usd 69 --out fire-7-holders.json
npm run selftest   # offline check of the Merkle code
```

PLANK and the PlankUsdTwap come from `deployments/<chainId>.json` (`PLANK`, `PLANK_USD_FEED` override; only on
mainnet does it fall back to the mainnet PLANK). It refuses a PLANK price over 2 hours old or over a window longer than
2 hours (what FireSale accepts); checkpoint the feed and run it again. It prints the
**root**: pass it as `HOLDER_ROOT` to batch B (`docs/deploy.md`, step 6); VerifySeries recomputes it from the file. The JSON file is for the site: the
live site is planned to load each buyer's proof from it automatically. Take the snapshot at a time nobody knows in advance, before the drop is set up.

## Recording a deploy (`deploy/`)

`deploy/record.mjs` writes `deployments/<chainId>.json` after a deploy script's broadcast: the scripts only leave a
`.pending` file (forge runs them before broadcasting), and this checks every new address against the broadcast's
receipts and the chain before merging it. `docs/deploy.md` has where it fits; run VerifyDeploy before committing the
file.

```sh
cd ops && npm ci
node deploy/record.mjs --rpc $RPC        # --dry-run to check only
```

## Keeper (`keeper/`)

Two always-on Railway services in different regions, each with its own wallet: the main keeper and a backup that only
acts on work left waiting 5 minutes (`KEEPER_ROLE=backup`). An optional GitHub Actions pass
(`.github/workflows/keeper.yml`) is a best-effort extra. Setup, settings and alerts: `keeper/README.md`. Every call
it makes is permissionless:

- `PlankUsdTwap.checkpoint()` when `due()` (every 30 minutes; FireSale pauses PLANK pricing when the window is over
  2 hours old) and `PaperUsdTwap.checkpoint()` when `due()`
- drand numbers to the router for card opens and PDA grading (`OpenDrandRouter.fulfillMany`; `adapter.settle` if a
  callback didn't land), each request answered through the source that took it
- `FireCards.process(fire, maxCards)` and `FirePsa.finish(index, ids)` (ids from the grading's `Protected` event)
- `PaperBurner.flush(pay)` and `PlankBurner.flush(pay)` when they hold a backlog a flush can burn

Alerts (Discord, Slack or Telegram webhook): stale feeds, opens or gradings ready but not done, waiting fees, drand
lag, low keeper ETH, a pause, a randomness switch, the backup stepping in, a keeper that can't start, and a daily
heartbeat; each service's dead-man's switch (`HEARTBEAT_URL`) catches one that dies.

## VerifySeries (`series/`)

The read-back between a Series' two owner signings on the hardware wallet (`docs/deploy.md`, step 6): on-chain recipe, characters, dealer,
images base against the studio's `recipe.json`, and FirePsa's fixed PDA odds; every image the contract can name, loaded through two or
more gateways (a gateway missing some is a warning while each image loads from two; each gateway gets a few connections
at a time and is slowed down by a 429 for its Retry-After); the folder's `manifest.json`; the holder Merkle root from the snapshot file. GREEN or RED.

```sh
cd ops && npm ci
RPC=... node series/verify-series.mjs --recipe ../contracts/series/recipe-fire-7.json --snapshot fire-7-holders.json
```

## Rehearsal (`rehearsal/`)

The whole launch on a local anvil chain (or a Robinhood Chain fork with `--fork <RPC>`): `docs/deploy.md`,
"Rehearsal". `npm test` here runs VerifySeries' and record's unit tests; the keeper's are in `keeper/`.
