// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title PlankUsdTwap
 * @notice A Chainlink-style PLANK/USD feed (**18 decimals** — PLANK is ~1e-9 USD, 8 decimals would round to 0) built from the Uniswap V2 PLANK/WETH pair's
 *         cumulative prices (a ~30-minute TWAP) and Chainlink ETH/USD.
 *
 *         Anyone can call `checkpoint()` at any time; the feed reports the average price between the
 *         two most recent checkpoints, which are always at least MIN_WINDOW apart (the first window opens
 *         MIN_WINDOW after deploy; until then the feed reports 0 and PLANK purchases wait). The keeper
 *         checkpoints whenever `due()`, so prices follow PLANK within about an hour. A flash loan lives for one
 *         transaction and adds nothing to a time-weighted average; moving it means holding the pool off its price for
 *         half an hour against arbitrage. No owner, no admin.
 */
interface IUniswapV2Pair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function price0CumulativeLast() external view returns (uint256);
    function price1CumulativeLast() external view returns (uint256);
    function getReserves() external view returns (uint112, uint112, uint32);
}

interface IEthUsdFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

contract PlankUsdTwap {
    IUniswapV2Pair public immutable PAIR;
    IEthUsdFeed public immutable ETH_USD;
    bool public immutable PLANK_IS_TOKEN0;
    uint256 public constant MIN_WINDOW = 30 minutes; // checkpoints closer together than this are ignored
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours; // Chainlink ETH/USD: deviation updates + 24h heartbeat

    struct Obs { uint256 cum; uint32 ts; }
    Obs public prev; // window start
    Obs public last; // window end

    event Checkpoint(uint32 ts, uint256 plankUsd18);

    constructor(address pair, address plank, address ethUsd) {
        PAIR = IUniswapV2Pair(pair);
        ETH_USD = IEthUsdFeed(ethUsd);
        PLANK_IS_TOKEN0 = IUniswapV2Pair(pair).token0() == plank;
        require(PLANK_IS_TOKEN0 || IUniswapV2Pair(pair).token1() == plank, "pair has no PLANK");
        (uint256 cum, uint32 ts) = _current();
        prev = Obs(cum, ts);
        last = Obs(cum, ts);
    }

    /// @dev Cumulative price of PLANK in WETH (UQ112x112), synced to now (pair may not have been touched this block).
    function _current() internal view returns (uint256 cum, uint32 ts) {
        (uint112 r0, uint112 r1, uint32 tLast) = PAIR.getReserves();
        cum = PLANK_IS_TOKEN0 ? PAIR.price0CumulativeLast() : PAIR.price1CumulativeLast();
        ts = uint32(block.timestamp);
        if (tLast != ts && r0 > 0 && r1 > 0) {
            // price of PLANK in WETH = reserveWETH / reservePLANK, as UQ112x112
            uint256 px = PLANK_IS_TOKEN0 ? (uint256(r1) << 112) / r0 : (uint256(r0) << 112) / r1;
            unchecked { cum += px * (ts - tLast); } // V2 cumulatives are meant to wrap
        }
    }

    /// @notice Anyone. Rolls the window forward once the last checkpoint is at least MIN_WINDOW old; earlier calls
    ///         are no-ops. Both ends of the window only ever move together, so the reported average always spans
    ///         >= MIN_WINDOW and calling often can neither shorten it nor pin its start in the past.
    function checkpoint() external {
        (uint256 cum, uint32 ts) = _current();
        if (ts - last.ts < MIN_WINDOW) return;
        prev = last;
        last = Obs(cum, ts);
        emit Checkpoint(ts, _price());
    }

    /// @notice True when checkpoint() would roll the window forward (the keeper's cue).
    function due() external view returns (bool) {
        return block.timestamp - last.ts >= MIN_WINDOW;
    }

    function _price() internal view returns (uint256 plankUsd18) {
        if (last.ts == prev.ts) return 0;
        uint256 avgWethPerPlankQ112;
        unchecked { avgWethPerPlankQ112 = (last.cum - prev.cum) / (last.ts - prev.ts); }
        (, int256 ethUsd,, uint256 upd,) = ETH_USD.latestRoundData();
        if (ethUsd <= 0 || upd > block.timestamp || block.timestamp - upd > ETH_FEED_MAX_AGE) return 0;
        // USD per PLANK, 18 dec = (WETH per PLANK, Q112) * (USD per ETH, 8 dec) * 1e10 / 2^112
        plankUsd18 = (avgWethPerPlankQ112 * uint256(ethUsd) * 1e10) >> 112;
    }

    /// @notice Chainlink-compatible read. `updatedAt` is the window end; consumers apply their own staleness limit (FireSale: 2 hours).
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint256 p = _price();
        return (0, int256(p), 0, last.ts, 0);
    }

    function decimals() external pure returns (uint8) { return 18; }
}
