# Robinhood Chain addresses and findings (Sep 27 2026)

## Chain
- Mainnet chain ID **4663**, gas in ETH. Public RPC `https://rpc.mainnet.chain.robinhood.com` (rate-limited; use Alchemy for the deploy and the keeper). If the site gets its own `VITE_RPC_URL`, add its host to `connect-src` in `web/vercel.json` or the browser blocks it. Explorer: https://robinhoodchain.blockscout.com
- Testnet chain ID 46630.

## Paper Mills = "Plank Press" (`PlankPress.sol`, verified)
- NFT: **`0x8DaA534c13C8b6164D73163F521fE3c94889dFC9`** (symbol on OpenSea: the-plank-press)
- PLANK per mill: **88,842,006,942.0888 PLANK** (= total supply / 10,000)
- `burn(tokenId)`: **payable, `burnFee = 0.0003 ETH`** (forwarded to their `feeRecipient`), caller must be `ownerOf`, **allowed only after `mintingSunset` = Oct 1 2026 00:00 UTC**. Calls `pulpPool.releaseBurned(tokenId)` then `_burn` then transfers `plankPerNFT` PLANK to the caller. → **A contract that owns a mill can burn it and receives the PLANK.** Our Seaport fill must send `0.0003 ETH` with the burn.
- Mint fee 0.0003 ETH. Pausable by admin; AccessControl admin `0x196254c3ad32f7735420f40DA387387D5DCBd8D5`.
- Royalties recipient (ERC-2981): `0xb495e814EFAB946e6CdCA3B344aa3A96ead5a806`. Fee recipient: `0x4B53E3D48B49f71A0E4A2BDb518efc2c8795BDe1`.
- **PAPER is not in this contract.** Printing/claiming lives in a separate PAPER contract, not deployed yet. Plug in on deploy day.

## Pulp Pool (`PulpPool.sol`, verified) — the royalty pool
- **`0x85715BbE2707476294B0c20B7DfbE32cCcADD0E1`**
- Splits every whitelisted reward token evenly across all live mills (per-NFT accumulator). `receive()` auto-wraps ETH → WETH. A burned mill's unclaimed share rolls to the survivors.
- **Only whitelisted tokens count.** Whitelist is admin-controlled (`addRewardToken`); WETH is in by default; PLANK was not. PLANK sent before whitelisting sits uncounted until an admin adds it.
- **Done, per the owner (Sep 28):** PLANK is on the PulpPool reward list (`addRewardToken(0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc)`).
  Not yet checked on-chain: **confirm on the explorer on deploy day** (PulpPool's reward-token list includes PLANK) and
  note the tx hash here.
- Rewards claimable only after `mintingSunset`.

## PLANK (`RobinWood`, 18 decimals)
- **`0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc`**, total supply **888,420,069,420,888 PLANK** (888.42T). 490 holders.
- Top holders: `0x6d05f45b602397eC1842395b2b465298BC36e5fB` (unverified contract, **56%** — locker/treasury? ask), Uniswap V2 pair (10%), PlankPress (9.4%, the mills' locked PLANK).
- **Main pool: Uniswap V2 pair `0x01b1BEf6fBA02c846eA5c4Ff59193988B5f86F73`** — 28.1 WETH / 88.7T PLANK ≈ **$0.00000000106 per PLANK** (1.06e-9) at $3,333 ETH → mcap ≈ $940k; a mill's PLANK ≈ $94.
- Uniswap V3 pool `0x3CE05Efe2e7C9c136f12a1Be695f75F807B6c69E` is tiny (0.8 WETH). Ignore.
- PLANK price source: **Uniswap V2 cumulative-price TWAP** on the V2 pair (30-minute window, anyone can checkpoint; `PlankUsdTwap`) × Chainlink ETH/USD. Read live at every buy, so log prices follow the pool within about an hour. (The ≥20h window is `PaperUsdTwap`'s.)
- At $0.90 per ticket the PLANK leg ≈ **852M PLANK** at today's price.

## Chainlink
- **ETH/USD standard proxy (mainnet): `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`** (8 decimals). SVR proxy exists but not needed.
- No Chainlink VRF on this chain.

## Randomness — our OpenDrandRouter (drand evmnet)
- Robinhood's OpenVRF has no shared deployment, and its `fulfill()` is relayer-only: the single relayer could hold back
  a number it dislikes until the Fire re-rolls. So we deploy `OpenDrandRouter` (OpenVRF minus owner, fees and
  allowlists): anyone may submit the drand signature, the router verifies it on-chain (pinned evmnet key), and there's
  one valid number per request.
- Round = the drand evmnet round 30–33 s after the request (rounds are 3 s apart). Public relays: api.drand.sh,
  api2.drand.sh, api3.drand.sh.
- `ops/keeper` submits signatures; the site's button and anyone with `cast` can too. `Fire.reroll()` is possible
  only after 2 hours with no number delivered and while the router has no number for the request — i.e. a drand
  outage. After 7 days stuck, anyone can `abandon()` and ticket holders `refund()` (see `docs/randomness.md`).
- No owner anywhere: nobody can pause, re-point or re-price randomness.

## Seaport (checked on-chain Sep 27 2026)
- **Seaport 1.6: `0x0000000000000068F116a894984e2DB1123eB395`** (deployed, 23,981 bytes). Seaport 1.5 is not deployed.
- ConduitController `0x00000000F9490004C11Cef243f5400493c00Ad63` deployed.
- Uniswap V2 router `0x89e5DB8B5aA49aA85AC63f691524311AEB649eba`: factory `0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f`,
  WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`. The PLANK pair's token0 = WETH, token1 = PLANK.
- ETH/USD feed update gaps observed: 0.4–6h (deviation-triggered; 24h heartbeat). The Fire treats it as stale after 25h.

## Mill listings on OpenSea (checked Sep 27 2026, via the OpenSea API)
- 4 listings, all priced in **USDG** (not ETH): ~$786, $787, $888.42, and $88,842. Mills are still minting until the
  Oct 1 sunset, so this isn't a real floor yet; later listings may be in ETH too.
- All are plain open orders (orderType 0, no zone) with 3 consideration items (seller, OpenSea fee, royalty),
  on Seaport 1.6. The Fire pays USDG listings from its USDG side and ETH listings from its ETH side.
- **USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`** (6 decimals), read from a live listing's consideration.
- A $786 listing splits: seller $699.54, OpenSea fee 1% ($7.86, `0x0000a26b00c1F0DF003000390027140000fAa719`),
  creator royalty 10% ($78.60, to the Plank Press royalty recipient `0xb495…a806`). OpenSea's chain slug: `robinhood`.

## Mill floor (OpenSea, Seaport)
- Collection https://opensea.io/collection/the-plank-press. The fire fills listings through Seaport 1.6 (above).
- The mill bid is a standing offer: anyone can call `eatMillFromSeaport` with any Seaport listing (their own included)
  priced at or under the bid, and the fire buys and burns it in one transaction. OpenSea listings are what the keeper
  sweeps. The fire takes no mill any other way: a mill safe-sent to it bounces (no `onERC721Received`); one pushed in with a
  plain `transferFrom` is stuck for good, so don't.
