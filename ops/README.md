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

## Launch a Series (`series/launch.mjs`)

One command for a whole Series (snapshot, fork rehearsal, batch A on the Ledger, VerifySeries GREEN, type `LOCK`,
batch B, read-back), resumable after any STOP: `docs/deploy.md`, "Launch a Series". `node series/launch-e2e.mjs`
tests it end to end on anvil (CI runs it).

## Rehearsal (`rehearsal/`)

The whole launch on a local anvil chain (or a Robinhood Chain fork with `--fork <RPC>`): `docs/deploy.md`,
"Rehearsal". `npm test` here runs VerifySeries' and record's unit tests; the keeper's are in `keeper/`.

## Suggestions (`suggestions/`)

Each Series' theme, art style and characters come from the public, in two waves (`docs/cards-contracts.md`, "Two waves
per Series"). The owner's steps for one Series:

1. **Look wave closes.** `node suggestions/draw.mjs --rpc <url> --kind look --series <n>`: the 10 drawn per kind, with
   the seed (saved to `draw-round-<r>-look.json`). Choose the theme and the art style from those 10.
2. **Announce them** (nothing on chain yet): `node suggestions/publish.mjs --draw draw-round-<r>-look.json --series <n>
   --picks <theme id>,<style id> --next "The characters wave is open"`, then `web/art/factory/sync_forge.sh` and deploy.
   The site shows the results and opens the characters wave for that theme and style.
3. **Characters wave closes.** `node suggestions/draw.mjs --rpc <url> --kind character --series <n>`, choose the
   characters, publish them the same way (`--draw draw-round-<r>-character.json --picks <ids>`).
4. **At the drop setup, pick once on chain:** `FireCredits.pickSuggestions(<n>, [theme, style, character ids])` from
   the owner wallet (a configured drop that hasn't started). This gives the free packs. Then
   `node suggestions/publish.mjs --draw draw-round-<r>-character.json --series <n> --rpc <url>` fills in the pick
   transaction on the site.
5. **Only now open the next Series' look wave.** Suggestions sent before step 4 land in the round that pick takes and
   can never be picked; `draw.mjs --series` warns about it.

The draw is seeded: anyone can run `draw.mjs` with the published seed and round and get the same 10. Exactly one theme
and one art style can win a pack (`EXTRA_PICKS` = 2), and for an idea several wallets sent, the first to suggest it
wins. Tests: `npm test` (includes `suggestions/*.test.mjs`).
