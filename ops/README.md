# Ops

## Snapshot (a snapshot group's wallets)

`snapshot/` takes the holder snapshot for a drop's snapshot group (`docs/drop-groups.md`): every regular wallet
holding at least a minimum of any ERC-20 or ERC-721, each with its own **allowance** (the packs it may take in the
group). It builds the Merkle tree FireGroups checks, checks every proof and writes a JSON file (the launcher turns it
into the site's holders file, below).

- **Which token:** `--token <address>`, or `plank` / `press` (the deployments file's `PLANK` / `MILL`); default PLANK.
  An ERC-721 is detected by ERC-165 (`supportsInterface(0x80ac58cd)`), else it must be an ERC-20 (`decimals()`).
- **The minimum:** `--min <amount>` in whole tokens (`"1000000"`, `"0.5"`) or NFTs, or for PLANK `--min-usd <dollars>`,
  priced with the same 30-minute average the sale uses (`PlankUsdTwap`, at the last block). PLANK with no minimum
  given: `--min-usd 69`.
- **Allowances:** `--tiers "1000000:1,10000000:2,100000000:5"`: a wallet's allowance is the highest tier its holding
  reaches (in dollars with `--min-usd`); the minimum defaults to the lowest tier. Below every tier (but at least the
  minimum), or with no tiers: `--allowance N` (default 1). FireGroups still caps it at the group's `perWallet`.
- **What counts:** the token in the wallet plus, for an ERC-20, its share of each Uniswap V2 pool of it the wallet
  provides liquidity to (LP balance / LP supply x the pool's token reserve; the pools: the factory's pairs of the
  token with WETH, USDG, PAPER and PLANK, `PLANK_WETH_V2_PAIR` for PLANK, plus `--pairs a,b`). LP held by a contract (a
  farm, a locker) isn't followed into it. A regular wallet has no code, or is an EIP-7702 delegated wallet (code
  `0xef0100` + an address); any other code is a contract and doesn't count. `0x0` and `0x...dEaD` never count.
- **The smallest holding over several blocks:** `--blocks 5` (default) over the past `--days 7` (default): the last
  block (`--block <n>`, default the latest) and four at random times from a seed it prints and saves (`--seed` to give
  one). Tokens borrowed or bought for a moment don't get anyone in. Every block used goes in the file.
- **Leaves:** `keccak256(bytes.concat(keccak256(abi.encode(wallet, allowance))))`, exactly FireGroups' snapshot check
  (OpenZeppelin StandardMerkleTree leaves of `["address","uint256"]`, sorted-pair hashing). The unit tests check the
  leaves against `cast`; the rehearsal and the launch test buy in a snapshot group on the real FireGroups with the
  script's proofs.
- **Verify:** `node snapshot.mjs --verify <file>` rebuilds the list from the chain at the file's blocks (checking they
  follow from its seed and that it counted every pool) and compares wallets, balances, allowances, every served proof
  and the root: GREEN or RED. A wallet or allowance added or changed by hand is RED. VerifySeries runs the same check.
- **RPC:** it reads past blocks (7 days back), so it needs an archive RPC. Reads go through Multicall3 (in chunks of
  300) when the chain has it, else 20 at a time; only wallets that qualify at the last block are read at the others.

```sh
cd ops/snapshot
npm ci
export RPC=https://rpc.mainnet.chain.robinhood.com
node snapshot.mjs --min-usd 69 --out g1.json                                  # PLANK, $69+, 1 pack each
node snapshot.mjs --min-usd 69 --tiers "69:1,1000:2,10000:5" --out g1.json    # $1,000+ = 2 packs, $10,000+ = 5
node snapshot.mjs --token press --min 1 --allowance 2 --out g0.json           # an NFT: 2 packs per Press holder
node snapshot.mjs --verify g1.json
npm run selftest   # offline check of the Merkle code
npm test           # unit tests (LP share, EIP-7702, the minimum over blocks, tiers, ERC-721, leaves vs cast, verify)
```

The file: `root` (the group's root: `GROUP_ROOT_<i>` for batch B), `wallets` `{ <address>: { allowance, proof } }`
(what a buyer passes), `holders` `[{ wallet, balance, allowance }]`, and how it was taken: `token`, `kind`
(`erc20` / `erc721`), `symbol`, `decimals`, `unit` (`token` / `usd`), `min`, `minRaw`, `tiers`, `allowance`, `feed` and
`tokenUsd` (dollar minimums), `block`, `blocks`, `seed`, `days`, `blockCount`, `fromBlock`, `pairs`, `count`,
`version` 3. PLANK, MILL and the PlankUsdTwap come from `deployments/<chainId>.json` (`PLANK`, `MILL`,
`PLANK_USD_FEED` override; only on mainnet does it fall back to the mainnet PLANK). With a dollar minimum it refuses a
PLANK price over 2 hours old or over a window longer than 2 hours (what FireSale accepts); checkpoint the feed and run
it again. Take the snapshot at a time nobody knows in advance, before the drop is set up (the launcher takes it).

### The snapshots side file (`fire-<N>-snapshots.json`)

The recipe JSON's keys are strict (ConfigureSeries refuses unknown ones), so what each snapshot group's snapshot is
lives in a small side file next to the recipe (the launcher's `--snapshots <file>` for another). Keys are the group's
index in `sale.groups` (`"0"` is the first group, as `GROUP_ROOT_<i>`); every snapshot group needs one, and only
snapshot groups may have one:

```json
{
  "1": { "token": "plank", "minUsd": 69, "days": 7 },
  "4": { "token": "0x...", "min": "1000000", "tiers": "1000000:1,10000000:2,100000000:5", "allowance": 1, "blocks": 5 }
}
```

`token` (an address, `"plank"` or `"press"`), `min` (whole tokens or NFTs) or `minUsd` (PLANK, dollars; tiers then in
dollars too), `tiers` (`"<min>:<packs>,..."`, or `[{ "min", "allowance" }]`), `allowance` (default 1), `days` (default
7, or the launcher's `--snapshot-days`), `blocks` (default 5, or `--snapshot-blocks`); or `"file": "<snapshot.json>"`
for a snapshot taken by hand (VerifySeries rebuilds it from the chain all the same).

### The site's holders file (`web/art/factory/forge/holders/series-<N>.json`)

Written by the launcher after the lock (batch B read back, each file's root checked against the drop's on chain;
`--holders-out <file>` for another place), from every snapshot group's snapshot:

```json
{
  "series": 7, "chainId": 4663, "updated": "2026-11-01T17:40:00.000Z",
  "groups": {
    "1": {
      "name": "PLANK holders", "root": "0x...", "token": "0x...", "kind": "erc20", "symbol": "PLANK", "count": 812, "block": "1234567",
      "wallets": { "0xabc...": { "allowance": 2, "proof": ["0x...", "0x..."] } }
    }
  }
}
```

`groups` keys are the group indexes (`"0"` is the first group: the `group` argument of `FireSale.buy`), only snapshot
groups. `wallets` keys are lowercase addresses. A buyer passes `Access { nftIds: [], allowance, proof }` for that group;
a wallet not listed can't buy in it. Commit it and deploy the site with the drop.

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
- `FireSale.close(fire)` once nothing can still sell (`status(fire).left` 0: a group's time ran out, or the unlimited
  "after sell-out" group idled out, with no purchase to close it); the backup 5 minutes after the last group ended
- `FireSale.endDrop(fire)` for a drop that didn't sell out, once anyone may (`status(fire).endableAt` + 7 days)

Alerts (Discord, Slack or Telegram webhook): stale feeds, opens or gradings ready but not done, waiting fees, an
unsold drop the owner can end, a close that didn't go through, drand lag, low keeper ETH, a pause, a randomness switch, FireSale's wallets or feeds
changed (`WalletsSet` / `FeedsSet`, once per event with the new addresses), the backup stepping in, a keeper that can't start, and a daily
heartbeat; each service's dead-man's switch (`HEARTBEAT_URL`, pinged after every completed pass whatever the alerts)
catches one that dies.

## VerifySeries (`series/`)

The read-back between a Series' two owner signings on the hardware wallet (`docs/deploy.md`, step 6): on-chain recipe, characters, dealer,
images base against the studio's `recipe.json`, and FirePsa's fixed PDA odds; every image the contract can name, loaded through two or
more gateways (a gateway missing some is a warning while each image loads from two; each gateway gets a few connections
at a time and is slowed down by a 429 for its Retry-After); the folder's `manifest.json`; each snapshot group's root
against its snapshot file (the file's own tree and served proofs too), and the snapshot rebuilt from the chain at its
saved blocks; each NFT group's collection has code; the sale settings against the policy, FireSale's wallets against
the deployments file and FireGroups wired to FireSale (below). GREEN or RED.

```sh
cd ops && npm ci
RPC=... node series/verify-series.mjs --recipe ../contracts/series/recipe-fire-7.json --snapshots 1=fire-7-group-1.json [--roots 1=0x...] [--allow <rule>,...]
```

`--snapshots` and `--roots` take `<group index>=<value>` pairs (`0` is the first group); a root not given comes from
`GROUP_ROOT_<i>`, else the JSON's `root`.

**Sale policy** (`series/sale-policy.mjs`, checked by VerifySeries and by the launcher before batch A and again before
LOCK). Drop-wide and per group; each rule is RED unless `--allow <rule>` names it (some only warn):

| Rule | Bound |
|---|---|
| `price` | a group's `priceUsd` is $1 to $10; 0 only for a holders' group (NFT or snapshot: free or PAPER only) |
| `burn-total` | a group's `plankBurnBps + paperBurnBps` is 10% to 100% (each group sets its own; checked for groups with a dollar price; over 100% is hard: the contract refuses it) |
| `paper-burn` | a group's `paperBurnBps` is at least 10% (the goal is PAPER buy pressure; Standard is 20%). A PLANK group set to burn all its PLANK (`plankBurnBps` 10000, `paperBurnBps` 0) needs `--allow paper-burn` |
| `paper-per-pack` | a group's `paper` is at least 0.1 PAPER |
| `no-paper` | a group's `paper` is not 0 |
| `paper-cap` | `paperCapUsd` is at least $0.10; 0 (no cap) is a warning |
| `wallet-limit` | a group's `perWallet` is 50 or less; 0 (no limit) is a warning for a finite open group (fine for a gated group, where the gate limits it, and for the unlimited group, where the rising price does) |
| `limit-lifts` | a group's per-wallet limit on a timer (`limitFor`) lifts 1 h to 7 days after the group opens (the Standard Everyone group: 24 h); a `limitFor` with no `perWallet` is hard (the contract refuses it) |
| `tax` | warning: a group's `taxBps` is over 1000 (10% a pack; the owner's default is 400) |
| `idle` | warning: an unlimited group's `idle` is over 1 h |

Hard (no `--allow`; the contract refuses them anyway): a snapshot group without a root at LOCK, an NFT group whose
collection has no code, an open group with neither a price nor PAPER, a group whose two burn shares add up to more
than 100%. `FireSale.revenueWallet`, `plankBurner` and
`paperBurner` must equal the deployments file's `inputs.REVENUE_WALLET` and `contracts.PlankBurner` / `PaperBurner`,
and `FireSale.GROUPS` the deployments file's `FireGroups` (whose `sale` is FireSale): RED otherwise (no `--allow`).

## Launch a Series (`series/launch.mjs`)

One command for a whole Series (sale policy and wallets, one snapshot per snapshot group from the side file above,
fork rehearsal, batch A on the Ledger, VerifySeries GREEN, the drop-wide settings and every group shown in plain words,
type `LOCK`, batch B with `GROUP_ROOT_<i>`, read-back of every drop and group field, the site's holders file),
resumable after any STOP: `docs/deploy.md`, "Launch a Series". `node series/launch-e2e.mjs` tests it end to end on
anvil (CI runs it), then buys through the groups (a snapshot proof from the holders file, the press leftovers rolling
into Everyone, the unlimited group idling out) and has the keeper close the Series. `series/sale-abi.mjs` holds the
FireSale / FireGroups ABI slices ops uses (`sale-abi.test.mjs` checks them against `contracts/out`).

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
   --picks <theme id>,<style id> --next "The characters wave is open"`, then commit and push: the site's build syncs it
   (the build runs `sync_forge.sh`; nothing to run by hand, no bash needed on Windows).
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
