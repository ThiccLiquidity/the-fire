# Deploy runbook (Robinhood Chain mainnet, chain id 4663)

Everything below is signed from a **fresh deployer wallet** with ~$50 of ETH. Keys live in a Foundry keystore
(`cast wallet import deployer --interactive`) or a Ledger, never in files or command lines. Never `--private-key`.

Commands are shown for PowerShell.

```powershell
cd contracts; copy .env.example .env   # then fill in the real .env, never .env.example
$env:RPC = Read-Host "RPC URL"                  # once per PowerShell window: forge reads .env, PowerShell doesn't
```

## 1. PLANK/USD TWAP feed: at least 30 minutes before step 3
```powershell
forge script script/DeployTwap.s.sol --rpc-url $env:RPC --account deployer --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
Uses `PLANK_WETH_V2_PAIR`, `PLANK`, `ETH_USD_FEED`. Put the address in `.env` as `PLANK_USD_FEED`. Call `checkpoint()`
**30+ minutes after deploy** and then every 30 minutes (the keeper's job; anyone can). Extra calls are ignored. The
feed reports 0 until its first full window, and FireSale pauses PLANK pricing whenever the window is over 2 hours old.

## 2. Randomness router + PAPER feed
```powershell
forge script script/DeployInfra.s.sol --rpc-url $env:RPC --account deployer --sender <deployer address> --slow --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
Uses `PAPER`, `USDG`, `WETH`, `UNIV2_FACTORY`, `ETH_USD_FEED`, `PLANK`, `PLANK_USD_FEED` (step 1); checks chain 4663,
contract code at each, PAPER and PLANK are 18 decimals, the ETH/USD feed is 8 and the PLANK feed 18. Deploys `OpenDrandRouter` and `PaperUsdTwap`. Neither has an owner. Put them in
`.env` as `DRAND_ROUTER` and `PAPER_USD_FEED`. `PAPER_USD_FEED` is this `PaperUsdTwap`, never the PAPER pool itself.
It finds a PAPER/WETH, PAPER/USDG or PAPER/PLANK pool holding at least $10 on its other side (PLANK valued by
`PLANK_USD_FEED`) and reports its first price about 40 hours after the keeper's first checkpoint (20 hours as
candidate, then one 20-hour window). Until then packs take the set PAPER (no $1 cap) and case and grading fees wait in
`PaperBurner`.

## 3. Card contracts
Fill the card section of `.env` (`OWNER` multisig, royalty, revenue and burn wallets; details at the top of
`script/DeployCards.s.sol` and in `docs/cards-contracts.md`), then:
```powershell
forge script script/DeployCards.s.sol --rpc-url $env:RPC --account deployer --sender <deployer address> --slow --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
It checks every input first, including that `DRAND_ROUTER` returns a zero `requestFee()` like the OpenDrandRouter,
that `PLANK_USD_FEED` sits on the PLANK/WETH pool the V2 router trades, and that `PLANK_USD_FEED` and `PAPER_USD_FEED`
are built on this `ETH_USD_FEED` (and this PAPER and `PLANK_USD_FEED`, for the PAPER feed). `PAPER_USD_FEED` is
required. Then it deploys FirePacks, FireCards, CardsRenderer, RecipeDealer and RecipeCompiler, FireSale, PaperBurner
(with its feeds and default routes), FirePsa and one drand adapter each for FireCards and FirePsa, wires them, and
hands ownership to `OWNER`.

## 4. Multisig accepts
`OWNER` calls `acceptOwnership()` on FirePacks, FireCards, RecipeDealer, FirePsa and PaperBurner (FireSale is owned by
`OWNER` from deployment), then checks the wiring (list in `docs/cards-contracts.md`). Until then the deployer key
controls those five.

## 5. Keeper
Needed before the first drop; not built yet (`ops/README.md`, `docs/roadmap.md`). Every call is permissionless:
- `PlankUsdTwap.checkpoint()` every 30 minutes
- `PaperUsdTwap.checkpoint()` when `due()`
- `PaperBurner.flush(pay)` when a case or grading fee is waiting (`Waiting` events)
- delivering drand numbers to the router (`OpenDrandRouter.fulfill`; `adapter.settle` if a callback didn't land)
- `FireCards.process(fire, maxCards)` and `FirePsa.finish(index)` if the site doesn't call them

## 6. Each Series
The `OWNER` multisig sets up the Series (`script/ConfigureSeries.s.sol` turns the studio's recipe JSON into the calls:
`RecipeDealer.setRecipe` and `setCharacters`, `FireCards.setDealer` and `setImagesBase`, optionally `FirePsa.setOdds`;
see `docs/cards-contracts.md`), then `FireSale.configureDrop` (and `pickSuggestions`). `configureDrop` locks the
Series: recipe, characters, fresh odds and images are fixed from then. The drop's settings come from the
studio's Sale tab, in the JSON's `sale` block: with `FIRE_SALE` set the script adds `configureDrop` as the last call.
Holder window: `ops/snapshot` makes the `holderRoot` (pass it as `HOLDER_ROOT`; `DROP_START` sets the opening time if
it wasn't set in the studio).

## 7. Site
The Forge is static (`web/public/forge`) and runs in demo mode (a demo banner, no wallet, no payments). The live
version will use `web/src/lib` (chain, wallet, card ABIs, swap guard). Set `SWAP_FEE_WALLET` in
`web/src/lib/config.ts` first. If the site uses its own `VITE_RPC_URL`, add that host to `connect-src` in
`web/vercel.json` or the browser blocks every read (the build refuses it).

## Verify a number (anyone)
See `docs/randomness.md`.
