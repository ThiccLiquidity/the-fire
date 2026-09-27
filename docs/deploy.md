# Deploy runbook (Robinhood Chain mainnet, chain id 4663)

Everything below is signed from a **fresh deployer wallet** with ~$50 of ETH. Keys live in a Foundry keystore
(`cast wallet import deployer --interactive`), never in files or command lines.

## 0. OpenVRF router (theirs, once)
```powershell
git clone https://github.com/Robinhood-OSS/OpenVRF; cd OpenVRF
git submodule update --init --recursive; pnpm install; forge build; forge test
# .env: RPC_URL, WS_URL, CHAIN_ID=4663, DEPLOYER_ACCOUNT=deployer, DEPLOYER_ADDRESS, OWNER_ADDRESS (=deployer),
#       RELAYER_ADDRESS (a second fresh wallet, ~$20 ETH), REQUEST_FEE_WEI=0
pnpm run deploy:mainnet                 # simulate
pnpm run deploy:mainnet -- --broadcast  # deploy; note ROUTER_ADDRESS and START_BLOCK
```
Then stand up the relayer (Docker + Postgres) on a small VPS per their `docs/operator-runbook.md`, with
`RELAY_ALL_CONSUMERS=true`. The relayer wallet pays gas for every fulfilment (~$0.001 cap each by default).

## 1. PLANK/USD TWAP feed (ours)
```powershell
cd the-fire\contracts; copy .env.example .env   # fill PLANK_WETH_V2_PAIR, PLANK, ETH_USD_FEED
forge script script/DeployTwap.s.sol --rpc-url $env:RPC --account deployer --broadcast --verify
```
Put the address in `.env` as `PLANK_USD_FEED`. Call `checkpoint()` now and again **24h later** (and daily after —
a cron/keeper; anyone can call it). The Fire's ratchet holds still until the feed has a full window.

## 2. Adapter + Fire (ours)
Fill the rest of `.env` (PAPER once it exists; VRF_ROUTER; PLANK_PER_TICKET0 from the feed's price; MILL_BID_BASE
just under the OpenSea floor; SEAPORT if the Seaport 1.6 address on this chain is confirmed, else leave unset).
```powershell
forge script script/Deploy.s.sol --rpc-url $env:RPC --account deployer --broadcast --verify
```
Note the Fire and Adapter addresses.

## 3. Authorize + fund
```powershell
cast send $ROUTER "setConsumerAuthorization(address,bool)" $ADAPTER true --rpc-url $env:RPC --account deployer
```
If the router charges a request fee, send that much ETH × ~30 nights to the adapter (it forwards its balance
per request). With `REQUEST_FEE_WEI=0` nothing is needed; the relayer wallet covers gas.

## 4. Plank Press admin
Ask them to call `PulpPool.addRewardToken(0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc)` so PLANK we send to the
pool counts toward every mill's share.

## 5. Nightly roll
Anyone can call `Fire.roll()` after 8:00 PM Phoenix. Set a cron (or Gelato Automate) to call it at 8:00:30 PM and
`PlankUsdTwap.checkpoint()` at the same time. The site also offers a "roll now" button once the time has passed.

## 6. Light fire #1
Throw the first PLANK in yourself (pyro mode, a few dollars). Site flips from mock to live with `VITE_FIRE_ADDRESS`.

## Verify a roll (anyone)
```
node scripts/verify-request.mjs --rpc $RPC --router $ROUTER --request-id N --from-block $START_BLOCK
```
(from the OpenVRF repo) — checks the drand signature and the derived word against chain state.

## Profiles (any time)

`forge script script/DeployProfiles.s.sol --rpc-url $RPC --account deployer --broadcast --verify` with `MILL` set. Standalone, no owner. Put the address in the site's `VITE_PROFILES_ADDRESS`. Until it's set the site shows short addresses.
