# Deploy runbook (Robinhood Chain mainnet, chain id 4663)

Everything below is signed from a **fresh deployer wallet** with ~$50 of ETH. Keys live in a Foundry keystore
(`cast wallet import deployer --interactive`), never in files or command lines.

## 1. PLANK/USD TWAP feed (ours)
```powershell
cd the-fire\contracts; copy .env.example .env   # fill PLANK_WETH_V2_PAIR, PLANK, ETH_USD_FEED
forge script script/DeployTwap.s.sol --rpc-url $env:RPC --account deployer --broadcast --verify
```
Put the address in `.env` as `PLANK_USD_FEED`. Call `checkpoint()` **20h+ after deploy** and then once a day (a cron/keeper;
anyone can call it). Calls less than 20h after the last accepted checkpoint are ignored, so extra calls are harmless.
The feed reports 0 until its first full window, and the Fire's ratchet holds still until then.

## 2. Router + adapter + Fire (ours)
Fill the rest of `.env` (PAPER once it exists; PLANK_PER_TICKET0 from the feed's price; MILL_BID_BASE in USD with 8
decimals; SEAPORT = `0x0000000000000068F116a894984e2DB1123eB395`, Seaport 1.6, confirmed deployed on Robinhood Chain
Sep 27 2026 — required; USDG = `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`).
```powershell
forge script script/Deploy.s.sol --rpc-url $env:RPC --account deployer --broadcast --verify
```
It deploys `OpenDrandRouter`, `OpenVRFAdapter` and `Fire`. None has an owner and there is nothing to configure
afterwards: the deploy wallet has no powers once this finishes. Note the three addresses.

## 3. Keeper
Set up the keeper box per `ops/README.md` (one script, one `docker run`). It rolls, delivers drand's number, recovers
stuck rolls, checkpoints the TWAP and sweeps the mill floor.

## 4. Plank Press admin
Ask them to call `PulpPool.addRewardToken(0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc)` so PLANK we send to the
pool counts toward every mill's share.

## 5. Nightly roll
The keeper does it. Anyone can also call `Fire.roll()` after 8:00 PM Phoenix, and the site shows a button when a roll,
a delivery or a re-roll is due.

## 6. Light fire #1
Pyro mode was removed from the contract, so seed fire #1 by buying its first tickets yourself. **Don't send PLANK
straight to the Fire address** — it never counts toward the pot and can't be recovered. Site flips from mock to live
with `VITE_FIRE_ADDRESS` (set `VITE_PROFILES_ADDRESS` + `VITE_PROFILES_FROM_BLOCK` too; see `web/.env.example`).

## Verify a roll (anyone)
Each `RandomnessFulfilled(id, word)` on the router can be checked against drand: take the request's round from
`router.requests(id)`, fetch `https://api.drand.sh/04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3/public/<round>`,
and the word is `keccak256(abi.encode(CHAIN_HASH, sha256(signature), chainid, router, id, adapter))`. The router
already rejected any signature drand didn't make.

## Profiles (any time)

`forge script script/DeployProfiles.s.sol --rpc-url $RPC --account deployer --broadcast --verify` Standalone, no owner, no constructor args. Put the address in the site's `VITE_PROFILES_ADDRESS`. Until it's set the site shows short addresses.
