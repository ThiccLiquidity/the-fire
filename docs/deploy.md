# Deploy runbook (Robinhood Chain mainnet, chain id 4663)

Everything below is signed from a **fresh deployer wallet** with ~$50 of ETH. Keys live in a Foundry keystore
(`cast wallet import deployer --interactive`) or a Ledger, never in files or command lines. Never `--private-key`.

## 1. PLANK/USD TWAP feed (ours) — at least 30 minutes before step 2 (first-timer version: `docs/launch-day.md`)
```powershell
cd the-fire\contracts; copy .env.example .env   # fill RPC, PLANK_WETH_V2_PAIR, PLANK, ETH_USD_FEED
forge script script/DeployTwap.s.sol --rpc-url $env:RPC --account deployer --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
Put the address in `.env` as `PLANK_USD_FEED`. The constructor refuses a pair without PLANK in it. Call
`checkpoint()` **30+ minutes after deploy** and then every 30 minutes (the keeper does it once it's running; anyone can).
Calls less than 30 minutes after the last accepted checkpoint are ignored, so extra calls are harmless. The feed reports 0 until its
first full window; step 2 refuses to run until it has a fresh price.

## 2. PAPER feed + router + adapter + Fire (ours)
Fill the rest of `.env`:
- `PAPER` once it exists (18 decimals, checked).
- `PLANK_PER_TICKET0`: $0.90 of PLANK in wei at the feed's price, i.e. `90000000 * 1e28 / <feed price>`. The script
  refuses anything more than 10% off and prints the right number.
- `MILL_BID_BASE`: the press floor on OpenSea at launch (his call), as a starting bid in USD, 8 decimals, between $10 and $5,000 (`30000000000` = $300). It climbs 25% of
  its starting value per day while the fund can pay it, so start at or below the floor you expect.
- `SEAPORT` = `0x0000000000000068F116a894984e2DB1123eB395` (Seaport 1.6, checked on-chain Sep 27 2026), `USDG` =
  `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, `UNIV2_FACTORY`, `WETH` — prefilled in `.env.example`.
- `PAPER_PER_TICKET=1e18`, `PAPER_USD_CAP=33000000`, `PLANK_USD_PER_TICKET=90000000`, `ETH_USD_PER_TICKET=100000000`,
  `ROLL_TIME_OF_DAY=75600` (21:00 UTC = 2:00 PM MST) — prefilled.

Deploy just after 21:00 UTC so fire #1 gets a full first day:
```powershell
forge script script/Deploy.s.sol --rpc-url $env:RPC --account deployer --sender <deployer address> --slow --broadcast `
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```
Before sending anything the script checks: chain 4663; contract code at every address; PAPER and PLANK are 18 decimals;
`PLANK_USD_FEED` is the 18-decimal TWAP, sits on a PLANK pool and has a fresh price; the ETH/USD feed is fresh;
`PLANK_PER_TICKET0` is within 10% of $0.90; `ETH_USD_PER_TICKET` is $1; `MILL_BID_BASE` is sane. The Fire's constructor
also refuses zero prices, a roll time ≥ 1 day, addresses with no code and an adapter that names a different Fire.

It deploys four contracts: `PaperUsdTwap`, `OpenDrandRouter`, `OpenVRFAdapter` and `Fire`. `--slow` sends one
transaction at a time so the Fire lands at the address the adapter was built for; don't use the deployer wallet for
anything else while it runs. None has an owner and there is nothing to configure afterwards: the deploy wallet has no
powers once this finishes. Note the four addresses, and check `adapter.FIRE()` == the Fire on the explorer before
announcing.

## 3. Keeper
Set up the keeper box per `ops/README.md` (one script, one `docker run`). It rolls, delivers drand's number, recovers
stuck rolls, checkpoints both price feeds and sweeps the mill floor. It only needs the Fire address; it reads the rest
from the Fire.

## 4. Plank Press admin
Done: the admin added PLANK as a Pulp Pool reward token (Sep 28).

## 5. Nightly roll
The keeper does it. Anyone can also call `Fire.roll()` after 21:00 UTC, and the site shows a button when a roll,
a delivery or a re-roll is due.

## 6. Light fire #1
The $250 seed goes in during step 2 (`SEED_PLANK`, from the deployer's PLANK), or later by hand with approve +
`Fire.seed(amount)` (deployer only, once, before the first storm). **Don't send PLANK straight to the Fire address** — it
never counts toward the pot and can't be recovered. Set `SWAP_FEE_WALLET` in `web/src/data/types.ts`. Site flips from mock to live with `VITE_FIRE_ADDRESS` (set
`VITE_PROFILES_ADDRESS` + `VITE_PROFILES_FROM_BLOCK` too; see `web/.env.example`).

## Verify a roll (anyone)
See `docs/randomness.md`: the word is `keccak256(abi.encode(CHAIN_HASH, sha256(signature), chainid, router, id, adapter))`,
with the signature from drand's public relays for the request's round.

## Profiles (any time)

`forge script script/DeployProfiles.s.sol --rpc-url $RPC --account deployer --broadcast --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/` Standalone, no owner, no constructor args. Put the address in the site's `VITE_PROFILES_ADDRESS`. Until it's set the site shows short addresses.
