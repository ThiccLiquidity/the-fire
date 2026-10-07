# Robinhood Chain addresses and findings

## Chain
- Mainnet chain ID **4663**, gas in ETH. Public RPC `https://rpc.mainnet.chain.robinhood.com` (rate-limited; use Alchemy for the deploy and the keeper). If the site gets its own `VITE_RPC_URL`, add its host to `connect-src` in `web/vercel.json` or the browser blocks it. Explorer: https://robinhoodchain.blockscout.com
- Testnet chain ID 46630.

## Paper Presses (`PlankPress.sol`, verified): `MILL`, used by FireSale's starter packs
- One NFT, several names: "Paper Press" (in these docs and on the site), `MILL` (the deploy setting), the `PlankPress`
  contract and the-plank-press on OpenSea are all the same collection. A single press is a "mill" below.
- NFT: **`0x8DaA534c13C8b6164D73163F521fE3c94889dFC9`** (OpenSea collection: the-plank-press)
- PLANK per mill: **88,842,006,942.0888 PLANK** (= total supply / 10,000)
- `burn(tokenId)`: **payable, `burnFee = 0.0003 ETH`** (forwarded to their `feeRecipient`), caller must be `ownerOf`, **allowed only after `mintingSunset` = Oct 1 2026 00:00 UTC**. Calls `pulpPool.releaseBurned(tokenId)` then `_burn` then transfers `plankPerNFT` PLANK to the caller.
- Mint fee 0.0003 ETH. Pausable by admin; AccessControl admin `0x196254c3ad32f7735420f40DA387387D5DCBd8D5`.
- Royalties recipient (ERC-2981): `0xb495e814EFAB946e6CdCA3B344aa3A96ead5a806`. Fee recipient: `0x4B53E3D48B49f71A0E4A2BDb518efc2c8795BDe1`.
- **PAPER is not in this contract.** Printing/claiming lives in a separate PAPER contract: **`0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6`**. Not yet checked on chain: confirm it has 18 decimals (FireSale and FirePsa assume 18) and that `transferFrom` to `0x…dEaD` works.

## Pulp Pool (`PulpPool.sol`, verified): the presses' royalty pool (not used by the card contracts)
- **`0x85715BbE2707476294B0c20B7DfbE32cCcADD0E1`**
- Splits every whitelisted reward token evenly across all live mills (per-NFT accumulator). `receive()` auto-wraps ETH → WETH. A burned mill's unclaimed share rolls to the survivors.
- **Only whitelisted tokens count.** Whitelist is admin-controlled (`addRewardToken`); WETH is in by default. A token sent before it is whitelisted sits uncounted until an admin adds it.
- PLANK's PulpPool reward-list status: unconfirmed; check on the explorer before launch.
- Rewards claimable only after `mintingSunset`.

## PLANK (`RobinWood`, 18 decimals)
Holder and pool figures are a snapshot from late September 2026.

- **`0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc`**, total supply **888,420,069,420,888 PLANK** (888.42T). 490 holders.
- Top holders: `0x6d05f45b602397eC1842395b2b465298BC36e5fB` (unverified contract, **56%**; purpose unconfirmed), Uniswap V2 pair (10%), PlankPress (9.4%, the mills' locked PLANK).
- **Main pool: Uniswap V2 pair `0x01b1BEf6fBA02c846eA5c4Ff59193988B5f86F73`** — 28.1 WETH / 88.7T PLANK ≈ **$0.00000000106 per PLANK** (1.06e-9) at $3,333 ETH → mcap ≈ $940k; a mill's PLANK ≈ $94.
- Uniswap V3 pool `0x3CE05Efe2e7C9c136f12a1Be695f75F807B6c69E` is tiny (0.8 WETH). Ignore.
- PLANK price source: **Uniswap V2 cumulative-price TWAP** on the V2 pair (30-minute window, anyone can checkpoint; `PlankUsdTwap`) × Chainlink ETH/USD. FireSale reads it at every PLANK purchase. (The ≥20h window is `PaperUsdTwap`'s.)

## Chainlink
- **ETH/USD standard proxy (mainnet): `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`** (8 decimals). SVR proxy exists but not needed. Update gaps observed: 0.4–6h (deviation-triggered; 24h heartbeat).
- No Chainlink VRF on this chain.

## Randomness — our OpenDrandRouter (drand evmnet)
- Robinhood's OpenVRF has no shared deployment, and its `fulfill()` is relayer-only: the single relayer could hold back
  a number it dislikes. So we deploy `OpenDrandRouter` (OpenVRF minus owner, fees and allowlists): anyone may submit
  the drand signature, the router verifies it on-chain (pinned evmnet key), and there's one valid number per request.
- Round = the drand evmnet round 90–93 s after the request (rounds are 3 s apart). Public relays: api.drand.sh,
  api2.drand.sh, api3.drand.sh. Recovery paths: `docs/randomness.md`.
- No owner anywhere: nobody can pause, re-point or re-price randomness.

## Uniswap V2
- Router `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba` (FireSale's PLANK burn swaps): factory `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f`,
  WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. The PLANK pair's token0 = WETH, token1 = PLANK.

## USDG
- **`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`** (6 decimals).
