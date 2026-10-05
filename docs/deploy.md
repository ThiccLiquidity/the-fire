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
Uses `PAPER`, `USDG`, `WETH`, `UNIV2_FACTORY`, `ETH_USD_FEED`; checks chain 4663, contract code at each, PAPER is 18
decimals and the ETH/USD feed is 8. Deploys `OpenDrandRouter` and `PaperUsdTwap`. Neither has an owner. Put them in
`.env` as `DRAND_ROUTER` and `PAPER_USD_FEED`.

## 3. Card contracts
Fill the card section of `.env` (`OWNER` multisig, royalty, revenue and burn wallets; details at the top of
`script/DeployCards.s.sol` and in `docs/cards-contracts.md`), then:
```powershell
forge script script/DeployCards.s.sol --rpc-url $env:RPC --account deployer --sender <deployer address> --slow --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
It checks every input first (including that `DRAND_ROUTER` really is the router and `PLANK_USD_FEED` sits on the
pool the V2 router trades), then deploys FirePacks, FireCards, FireSale, FirePsa and one drand adapter each for
FireCards and FirePsa, wires them, and hands ownership to `OWNER`.

## 4. Multisig accepts
`OWNER` calls `acceptOwnership()` on FirePacks, FireCards and FirePsa (FireSale is its own from the start), then
checks the wiring (list in `docs/cards-contracts.md`). Until then the deployer key controls those three.

## 5. Keeper
Needed before the first drop: PLANK feed checkpoints every 30 minutes, PAPER feed when `due()`, drand deliveries for
opens and reveals. Not built yet (`ops/README.md`, `docs/roadmap.md`).

## 6. Each Series
The `OWNER` multisig calls `FireCards.configureFire`, then `FireSale.configureDrop` (and `pickSuggestions`). Holder window:
`ops/snapshot` makes the `holderRoot`.

## 7. Site
The Forge is static (`web/public/forge`). When it goes live it uses `web/src/lib` (chain, wallet, card ABIs, swap
guard). Set `SWAP_FEE_WALLET` in `web/src/lib/config.ts` first. If the site uses its own `VITE_RPC_URL`, add that
host to `connect-src` in `web/vercel.json` or the browser blocks every read (the build refuses it).

## Verify a number (anyone)
See `docs/randomness.md`.
