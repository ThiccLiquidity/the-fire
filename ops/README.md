# Ops

## Snapshot (holder window)

`snapshot/` takes the PLANK-holder snapshot for a drop's holder window: every regular wallet holding at least $69 of
PLANK, priced with the same 30-minute average the sale uses (`PlankUsdTwap`, at the last block). It builds the Merkle
tree, checks every proof and writes a JSON file for the site.

- **What counts:** PLANK in the wallet plus its share of each PLANK Uniswap V2 pool it provides liquidity to (LP
  balance / LP supply x the pool's PLANK reserve; the pools: `PLANK_WETH_V2_PAIR` and the factory's PLANK pairs with
  WETH, USDG and PAPER, plus `--pairs a,b`). LP held by a contract (a farm, a locker) isn't followed into it: those
  holders don't count through it. A regular wallet has no code, or is an EIP-7702 delegated wallet (code `0xef0100` +
  an address); any other code is a contract and doesn't count. `0x0` and `0x...dEaD` never count.
- **The smallest holding over several blocks:** `--blocks 5` (default) over the past `--days 7` (default): the last
  block (`--block <n>`, default the latest) and four at random times from a seed it prints and saves (`--seed` to give
  one). PLANK borrowed or bought for a moment doesn't get anyone in. Every block used goes in the file.
- **Verify:** `node snapshot.mjs --verify <file>` rebuilds the list from the chain at the file's blocks (checking they
  follow from its seed and that it counted every PLANK pool) and compares wallets, amounts and root: GREEN or RED. A
  wallet added or changed by hand is RED. VerifySeries runs the same check on `--snapshot`.
- **RPC:** it reads past blocks (7 days back), so it needs an archive RPC. Reads go through Multicall3 (in chunks of
  300) when the chain has it, else 20 at a time; only wallets that qualify at the last block are read at the others.

```sh
cd ops/snapshot
npm ci
export RPC=https://rpc.mainnet.chain.robinhood.com
node snapshot.mjs --min-usd 69 --out fire-7-holders.json      # [--blocks 5] [--days 7] [--block <n>]
node snapshot.mjs --verify fire-7-holders.json
npm run selftest   # offline check of the Merkle code
npm test           # unit tests (LP share, EIP-7702, the minimum over blocks, verify)
```

PLANK and the PlankUsdTwap come from `deployments/<chainId>.json` (`PLANK`, `PLANK_USD_FEED` override; only on
mainnet does it fall back to the mainnet PLANK). It refuses a PLANK price over 2 hours old or over a window longer than
2 hours (what FireSale accepts); checkpoint the feed and run it again. It prints the
**root**: pass it as `HOLDER_ROOT` to batch B (`docs/deploy.md`, step 6); VerifySeries recomputes it from the file and rebuilds the file from the chain. The JSON file is for the site: the
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
- `PaperBurner.flush(pay)` and `PlankBurner.flush(pay)` when they hold a backlog a flush can burn, worth the gas
- `FireSale.endDrop(fire)` for a drop that didn't sell out, once anyone may

Alerts (Discord, Slack or Telegram webhook): stale feeds, opens or gradings ready but not done, waiting fees, an
unsold drop the owner can end, drand lag, low keeper ETH, a pause, a randomness switch, FireSale's wallets or feeds
changed (`WalletsSet` / `FeedsSet`, once per event with the new addresses), the backup stepping in, a keeper that can't start, and a daily
heartbeat; each service's dead-man's switch (`HEARTBEAT_URL`, pinged after every completed pass whatever the alerts)
catches one that dies.

## VerifySeries (`series/`)

The read-back between a Series' two owner signings on the hardware wallet (`docs/deploy.md`, step 6): on-chain recipe, characters, dealer,
images base against the studio's `recipe.json`, and FirePsa's fixed PDA odds; every image the contract can name, loaded through two or
more gateways (a gateway missing some is a warning while each image loads from two; each gateway gets a few connections
at a time and is slowed down by a 429 for its Retry-After); the folder's `manifest.json`; the holder Merkle root from
the snapshot file, and the snapshot rebuilt from the chain at its saved blocks; the sale settings against the policy
and FireSale's wallets against the deployments file (below). GREEN or RED.

```sh
cd ops && npm ci
RPC=... node series/verify-series.mjs --recipe ../contracts/series/recipe-fire-7.json --snapshot fire-7-holders.json [--allow <rule>,...]
```

**Sale policy** (`series/sale-policy.mjs`, checked by VerifySeries and by the launcher before batch A and again before
LOCK). Each rule is RED unless `--allow <rule>` names it:

| Rule | Bound |
|---|---|
| `price` | a paid pack costs $1 to $10 (`priceUsd`) |
| `burn-total` | `plankBurnBps + paperBurnBps` is 10% to 100% |
| `paper-burn` | `paperBurnBps` is at least 10% (the goal is PAPER buy pressure; Standard is 20%) |
| `paper-per-pack` | `paperPerPack` is at least 0.1 PAPER |
| `no-paper` | `paperPerPack` is not 0 |
| `paper-cap` | `paperCapUsd` is at least $0.10; 0 (no cap) is a warning |
| `wallet-limit` | `walletLimit` is 50 or less |
| `holder-window` | a holder window has a holder root, or `--no-holders` (presses only) |

`FireSale.revenueWallet`, `plankBurner` and `paperBurner` must equal the deployments file's `inputs.REVENUE_WALLET`
and `contracts.PlankBurner` / `PaperBurner`: RED otherwise (no `--allow`).

## Launch a Series (`series/launch.mjs`)

One command for a whole Series (sale policy and wallets, snapshot, fork rehearsal, batch A on the Ledger, VerifySeries
GREEN, every sale setting shown in plain units, type `LOCK`, batch B, read-back of every drop field), resumable after
any STOP: `docs/deploy.md`, "Launch a Series". `node series/launch-e2e.mjs`
tests it end to end on anvil (CI runs it).

## Rehearsal (`rehearsal/`)

The whole launch on a local anvil chain (or a Robinhood Chain fork with `--fork <RPC>`): `docs/deploy.md`,
"Rehearsal". `npm test` here runs the unit tests of VerifySeries, the sale policy, the launcher, record, the
suggestions and the snapshot; the keeper's are in `keeper/`.

## Suggestions (`suggestions/`)

Each Series' theme, art style and characters come from the public, in two waves (`docs/cards-contracts.md`, "Two waves
per Series"). The owner's steps for one Series:

0. **Announce the draw when the wave opens.** `node suggestions/draw.mjs --rpc <url> --plan --close "2026-11-08 18:00"`
   prints the closing block (estimated from the chain's recent block time) and a drand quicknet round an hour after
   it. Post both with the wave: "the wave closes at block N; the draw's seed is drand quicknet round R". Suggestions
   mined after block N aren't in; nobody (you included) knows round R's number until it comes out, after the close.
1. **Look wave closes.** Once block N is final and round R is out:
   `node suggestions/draw.mjs --rpc <url> --kind look --series <n> --to-block N --drand-round R`: the 10 drawn per
   kind, saved to `draw-round-<r>-look.json` with the closing block, the round, its randomness and its signature
   (checked against quicknet's public key). Choose the theme and the art style from those 10.
2. **Announce them** (nothing on chain yet): `node suggestions/publish.mjs --draw draw-round-<r>-look.json --series <n>
   --picks <theme id>,<style id> --next "The characters wave is open"`, then `web/art/factory/sync_forge.sh` and deploy.
   The site shows the results and opens the characters wave for that theme and style.
3. **Characters wave closes.** `node suggestions/draw.mjs --rpc <url> --kind character --series <n> --to-block N2
   --drand-round R2` (the pair announced with that wave), choose the characters, publish them the same way (`--draw draw-round-<r>-character.json --picks <ids>`).
4. **At the drop setup, pick once on chain:** `FireCredits.pickSuggestions(<n>, [theme, style, character ids])` from
   the owner wallet (a configured drop that hasn't started). This gives the free packs. Then
   `node suggestions/publish.mjs --draw draw-round-<r>-character.json --series <n> --rpc <url>` fills in the pick
   transaction on the site. An on-chain pick of that wave's kinds that isn't on the shortlist is printed as a loud
   WARNING and still published, marked `offList` (the site shows what the chain did).
5. **Only now open the next Series' look wave.** Suggestions sent before step 4 land in the round that pick takes and
   can never be picked; `draw.mjs --series` warns about it.

Anyone can check a draw: `node suggestions/draw.mjs --rpc <url> --verify draw-round-<r>-look.json` re-reads the
entries up to the saved closing block, fetches the drand round again (signature checked), re-runs the draw and says
GREEN when the shortlist is the same. `--seed <hex>` is for tests and dry runs only: the file is marked test and
`publish.mjs` refuses it (`--allow-test-draw` for a test site). Exactly one theme and one art style can win a pack (`EXTRA_PICKS` = 2), and for an idea several wallets sent, the first to suggest it
wins. Tests: `npm test` (includes `suggestions/*.test.mjs`).
