# Robinhood Chain addresses and findings (Sep 27 2026)

## Chain
- Mainnet chain ID **4663**, gas in ETH. Public RPC `https://rpc.mainnet.chain.robinhood.com` (rate-limited; use Alchemy for production). Explorer: https://robinhoodchain.blockscout.com
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
- **Only whitelisted tokens count.** Whitelist is admin-controlled (`addRewardToken`); WETH is in by default. **PLANK is not.** PLANK sent before whitelisting sits uncounted until an admin adds it.
- **Ask for the Plank Press admin: call `addRewardToken(0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc)`.** Fallback if refused: pay the fire's tithe and eaten-mill PLANK to the pool as ETH/WETH instead (would need a swap — undesirable), or send the tithe in WETH from the ETH fund.
- Rewards claimable only after `mintingSunset`.

## PLANK (`RobinWood`, 18 decimals)
- **`0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc`**, total supply **888,420,069,420,888 PLANK** (888.42T). 490 holders.
- Top holders: `0x6d05f45b602397eC1842395b2b465298BC36e5fB` (unverified contract, **56%** — locker/treasury? ask), Uniswap V2 pair (10%), PlankPress (9.4%, the mills' locked PLANK).
- **Main pool: Uniswap V2 pair `0x01b1BEf6fBA02c846eA5c4Ff59193988B5f86F73`** — 28.1 WETH / 88.7T PLANK ≈ **$0.00000000106 per PLANK** (1.06e-9) at $3,333 ETH → mcap ≈ $940k; a mill's PLANK ≈ $94.
- Uniswap V3 pool `0x3CE05Efe2e7C9c136f12a1Be695f75F807B6c69E` is tiny (0.8 WETH). Ignore.
- Ratchet price source: **Uniswap V2 cumulative-price TWAP** on the V2 pair (24h window, anyone can checkpoint) × Chainlink ETH/USD.
- At $0.90 per ticket the PLANK leg ≈ **852M PLANK** at today's price.

## Chainlink
- **ETH/USD standard proxy (mainnet): `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9`** (8 decimals). SVR proxy exists but not needed.
- No Chainlink VRF on this chain.

## Randomness — OpenVRF (drand-backed), self-hosted
- **There is no shared router or hosted relayer.** We deploy our own `OpenVRF` router (owner = our deployer; controls consumer/relayer whitelist and fee; **cannot bias results** — the drand proof decides) and run the relayer: Docker + PostgreSQL on a small VPS, with a dedicated relayer wallet holding gas.
- Consumer inherits `RandomnessConsumer(router)`, calls `requestRandomness{value: fee}(callbackGas)` (25k–1M gas), receives `rawFulfillRandomness(id, word)` → `_fulfillRandomness`. Router: `src/OpenVRF.sol`, compiler 0.8.28, `MIN_DELAY = 2` (beacon round 2–4 s after the request block).
- Observed latency ~10 s request → callback. Liveness depends on our relayer being up; if it's down the night's roll waits (no redraw possible — same word on retry).
- Ops cost: a $5–10/mo VPS + relayer gas (~$0.001/request cap by default).
- Honest framing for the community: *nobody* controls the pot or the rules; we run the randomness *relay*, which can delay a roll but can't choose it, and anyone can verify each roll with their `verify-request.mjs` script.

## Mill floor (OpenSea, Seaport)
- Collection https://opensea.io/collection/the-plank-press. Seaport on Robinhood Chain: confirm the deployed Seaport 1.6 address before wiring the fill path. No standing bid, no sell-to-fire: the fire only buys listings.
