// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniswapV2Pair, IEthUsdFeed} from "./PlankUsdTwap.sol";

interface IUniswapV2Factory {
    function getPair(address a, address b) external view returns (address);
}

/**
 * @title PaperUsdTwap
 * @notice A Chainlink-style PAPER/USD feed (**18 decimals**) that works before PAPER has a market.
 *
 *         At deploy there is no PAPER pool, so the feed reports 0 and the Fire keeps the PAPER leg at 1 PAPER. Once
 *         someone creates a PAPER/WETH or PAPER/USDG pool on the Uniswap V2 factory, the next `checkpoint()` adopts
 *         it; the first price appears one full window (>= 20h) later. If a pool in the other currency later holds
 *         at least twice the dollar liquidity, a checkpoint switches to it (and the window restarts), so a tiny
 *         early pool can't stay the reference once the real market is elsewhere.
 *
 *         Same windowing as PlankUsdTwap: checkpoints closer than MIN_WINDOW to the last accepted one are no-ops, so
 *         the average always spans >= 20h and nobody can shorten it or pin its start. No owner, no admin.
 *
 *         Assumes PAPER has 18 decimals (as the Fire's PAPER_PER_TICKET does); check on deploy day.
 */
contract PaperUsdTwap {
    IUniswapV2Factory public immutable FACTORY;
    address public immutable PAPER;
    address public immutable WETH;
    address public immutable USDG; // address(0) = only look for a WETH pool
    uint8 public immutable USDG_DECIMALS;
    IEthUsdFeed public immutable ETH_USD;
    uint256 public constant MIN_WINDOW = 20 hours;
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours;
    uint256 public constant SWITCH_FACTOR = 2; // another pool must hold 2x the dollar liquidity to take over

    IUniswapV2Pair public pair; // the pool the price comes from; address(0) until one exists
    address public quote; // WETH or USDG: what PAPER is priced in on that pool
    bool public paperIsToken0;

    struct Obs { uint256 cum; uint32 ts; }
    Obs public prev; // window start
    Obs public last; // window end

    event PoolAdopted(address pair, address quote);
    event Checkpoint(uint32 ts, uint256 paperUsd18);

    constructor(address factory, address paper, address weth, address usdg, uint8 usdgDecimals, address ethUsd) {
        FACTORY = IUniswapV2Factory(factory);
        PAPER = paper;
        WETH = weth;
        USDG = usdg;
        USDG_DECIMALS = usdgDecimals;
        ETH_USD = IEthUsdFeed(ethUsd);
    }

    /// @notice Anyone. Adopts or switches the pool when warranted, then rolls the window forward once the last
    ///         checkpoint is at least MIN_WINDOW old.
    function checkpoint() external {
        (address best, address bestQuote, uint256 bestLiq) = _bestPool();
        if (best != address(0) && best != address(pair)) {
            uint256 curLiq = address(pair) == address(0) ? 0 : _liquidityUsd(address(pair), quote);
            if (address(pair) == address(0) || bestLiq >= curLiq * SWITCH_FACTOR) {
                pair = IUniswapV2Pair(best);
                quote = bestQuote;
                paperIsToken0 = IUniswapV2Pair(best).token0() == PAPER;
                (uint256 c, uint32 t) = _current();
                prev = Obs(c, t);
                last = Obs(c, t); // price reads 0 until a full window has passed on the new pool
                emit PoolAdopted(best, bestQuote);
                return;
            }
        }
        if (address(pair) == address(0)) return;
        (uint256 cum, uint32 ts) = _current();
        if (ts - last.ts < MIN_WINDOW) return;
        prev = last;
        last = Obs(cum, ts);
        emit Checkpoint(ts, _price());
    }

    /// @notice True when checkpoint() would change something: a pool to adopt or switch to, or a window to roll.
    ///         Lets a keeper stay quiet (and spend nothing) while PAPER has no market.
    function due() external view returns (bool) {
        (address best,, uint256 bestLiq) = _bestPool();
        if (best != address(0) && best != address(pair)) {
            if (address(pair) == address(0)) return true;
            if (bestLiq >= _liquidityUsd(address(pair), quote) * SWITCH_FACTOR) return true;
        }
        return address(pair) != address(0) && block.timestamp - last.ts >= MIN_WINDOW;
    }

    /// @notice Chainlink-compatible read. 0 = no price yet (no pool, or no full window). `updatedAt` = window end.
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, int256(_price()), 0, last.ts, 0);
    }

    function decimals() external pure returns (uint8) { return 18; }

    // ---------------------------------------------------------------- internals
    function _bestPool() internal view returns (address best, address bestQuote, uint256 bestLiq) {
        address w = FACTORY.getPair(PAPER, WETH);
        if (w != address(0)) (best, bestQuote, bestLiq) = (w, WETH, _liquidityUsd(w, WETH));
        if (USDG != address(0)) {
            address u = FACTORY.getPair(PAPER, USDG);
            if (u != address(0)) {
                uint256 l = _liquidityUsd(u, USDG);
                if (best == address(0) || l > bestLiq) (best, bestQuote, bestLiq) = (u, USDG, l);
            }
        }
    }

    /// @dev Dollar value of the quote side of a pool, 8 decimals. WETH pools count 0 while the ETH feed is stale.
    function _liquidityUsd(address p, address q) internal view returns (uint256) {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(p).getReserves();
        uint256 qr = IUniswapV2Pair(p).token0() == q ? r0 : r1;
        if (q == USDG) return qr * 1e8 / (10 ** USDG_DECIMALS);
        uint256 eth = _ethUsd();
        return qr * eth / 1e18;
    }

    function _ethUsd() internal view returns (uint256) {
        (bool ok, bytes memory ret) = address(ETH_USD).staticcall(abi.encodeCall(IEthUsdFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) return 0;
        (, int256 px,, uint256 upd,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        if (px <= 0 || upd > block.timestamp || block.timestamp - upd > ETH_FEED_MAX_AGE) return 0;
        return uint256(px);
    }

    /// @dev Cumulative price of PAPER in the quote token's raw units (UQ112x112), synced to now.
    function _current() internal view returns (uint256 cum, uint32 ts) {
        (uint112 r0, uint112 r1, uint32 tLast) = pair.getReserves();
        cum = paperIsToken0 ? pair.price0CumulativeLast() : pair.price1CumulativeLast();
        ts = uint32(block.timestamp);
        if (tLast != ts && r0 > 0 && r1 > 0) {
            uint256 px = paperIsToken0 ? (uint256(r1) << 112) / r0 : (uint256(r0) << 112) / r1;
            cum += px * (ts - tLast);
        }
    }

    function _price() internal view returns (uint256 paperUsd18) {
        if (last.ts == prev.ts) return 0;
        uint256 avgQ112 = (last.cum - prev.cum) / (last.ts - prev.ts); // quote raw units per PAPER raw unit
        if (quote == USDG) {
            // USD per PAPER, 18 dec = raw ratio * 10^18 (PAPER dec) / 10^usdgDec * 10^18
            return (avgQ112 * (10 ** (36 - uint256(USDG_DECIMALS)))) >> 112;
        }
        uint256 eth = _ethUsd();
        if (eth == 0) return 0;
        // (WETH per PAPER, Q112) * (USD per ETH, 8 dec) * 1e10 / 2^112
        return (avgQ112 * eth * 1e10) >> 112;
    }
}
