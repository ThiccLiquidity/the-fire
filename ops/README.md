# Ops

## Snapshot (holder window)

`snapshot/` takes the PLANK-holder snapshot for a drop's holder window: every regular wallet (not a contract) holding
at least $69 of PLANK, priced with the same 30-minute average the sale uses (`PlankUsdTwap`). It builds the Merkle
tree, checks every proof and writes a JSON file for the site.

```sh
cd ops/snapshot
npm install
export RPC=https://rpc.mainnet.chain.robinhood.com
export PLANK_USD_FEED=<PlankUsdTwap address>
node snapshot.mjs --min-usd 69 --out fire-7-holders.json
npm run selftest   # offline check of the Merkle code
```

It prints the **root**: set it as `holderRoot` in the drop's `configureDrop`. The JSON file goes to the site so
buyers' proofs load automatically. Take the snapshot at a time nobody knows in advance, before the drop is set up.

## Keeper (not built yet)

The card system needs one always-on process before the first drop. Every call it makes is permissionless:

- `PlankUsdTwap.checkpoint()` every 30 minutes (FireSale pauses PLANK pricing when the window is over 2 hours old)
- `PaperUsdTwap.checkpoint()` when `due()`
- `FirePsa.pokePrice()` now and then
- delivering drand numbers for card opens and PDA reveals (`OpenDrandRouter.fulfill`, `adapter.settle`)

A keeper from an earlier version of this project (`git show 21bb12d:ops/keeper/keeper.mjs`) covers checkpoints and
drand delivery and is a starting point.
