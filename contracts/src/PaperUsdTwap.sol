// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniswapV2Pair, IEthUsdFeed} from "./PlankUsdTwap.sol";

interface IUniswapV2Factory {
    function getPair(address a, address b) external view returns (address);
}

/**
 * @title PaperUsdTwap
 * @notice A Chainlink-style PAPER/USD feed (**18 decimals**) that finds its own pool. FirePsa's PAPER_USD_FEED must
 *         be this contract, never a pool.
 *
 *         It starts with no pool and reports 0. Once a PAPER/WETH, PAPER/USDG or PAPER/PLANK pool on the Uniswap V2
 *         factory holds at least MIN_LIQUIDITY_USD ($10) on its other side (PLANK valued by the PLANK feed), a
 *         checkpoint marks it as the candidate; if it still qualifies at every checkpoint for MIN_WINDOW (20h), it's
 *         adopted, and the first price appears one full window (>= 20h) after that: about 40h after the first
 *         checkpoint, even when a pool already exists at deploy. A pool in the other
 *         currency takes over the same way once it holds twice the current pool's dollar liquidity for MIN_WINDOW.
 *         Liquidity is read from spot reserves, so the "for MIN_WINDOW" part is what stops a flash loan from
 *         forcing a switch: the keeper checkpoints whenever due() and drops a candidate the moment it stops
 *         qualifying. While the ETH/USD feed is stale, no pool is adopted or switched.
 *
 *         Same windowing as PlankUsdTwap: checkpoints closer than MIN_WINDOW to the last accepted one are no-ops, so
 *         the average always spans >= 20h and nobody can shorten it or pin its start. No owner, no admin.
 *
 *         Assumes PAPER and PLANK have 18 decimals; check on deploy day. A PLANK pool's price follows the PLANK feed
 *         (PlankUsdTwap, a 30-minute average) at read time; while that feed is stale the PLANK pool counts for
 *         nothing and its price reads 0.
 */
contract PaperUsdTwap {
    IUniswapV2Factory public immutable FACTORY;
    address public immutable PAPER;
    address public immutable WETH;
    address public immutable USDG; // address(0) = only look for a WETH pool
    uint8 public immutable USDG_DECIMALS;
    IEthUsdFeed public immutable ETH_USD;
    address public immutable PLANK; // address(0) = don't look for a PLANK pool
    IEthUsdFeed public immutable PLANK_USD; // PlankUsdTwap (18 decimals)
    uint256 public constant PLANK_FEED_MAX_AGE = 2 hours;
    uint256 public constant MIN_WINDOW = 20 hours;
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours;
    uint256 public constant SWITCH_FACTOR = 2; // another pool must hold 2x the dollar liquidity to take over
    uint256 public constant MIN_LIQUIDITY_USD = 10e8; // a pool needs $10 on its dollar side to be considered (ignores empty and dust pools)

    IUniswapV2Pair public pair; // the pool the price comes from; address(0) until one exists
    address public quote; // WETH or USDG: what PAPER is priced in on that pool
    bool public paperIsToken0;
    address public candidate; // a pool waiting out MIN_WINDOW before it's adopted
    uint32 public candidateSince;

    struct Obs { uint256 cum; uint32 ts; }
    Obs public prev; // window start
    Obs public last; // window end

    event PoolAdopted(address pair, address quote);
    event Candidate(address pair); // address(0) = the candidate stopped qualifying
    event Checkpoint(uint32 ts, uint256 paperUsd18);

    constructor(
        address factory,
        address paper,
        address weth,
        address usdg,
        uint8 usdgDecimals,
        address ethUsd,
        address plank,
        address plankUsd
    ) {
        FACTORY = IUniswapV2Factory(factory);
        PAPER = paper;
        WETH = weth;
        USDG = usdg;
        USDG_DECIMALS = usdgDecimals;
        ETH_USD = IEthUsdFeed(ethUsd);
        PLANK = plank;
        PLANK_USD = IEthUsdFeed(plankUsd);
    }

    /// @notice Anyone. Tracks a candidate pool and adopts it once it has qualified for MIN_WINDOW, then rolls the
    ///         window forward once the last checkpoint is at least MIN_WINDOW old.
    function checkpoint() external {
        (address best, address bestQuote, bool better, bool hold) = _contender();
        if (better) {
            if (candidate != best) {
                candidate = best;
                candidateSince = uint32(block.timestamp);
                emit Candidate(best);
            } else if (block.timestamp - candidateSince >= MIN_WINDOW) {
                pair = IUniswapV2Pair(best);
                quote = bestQuote;
                paperIsToken0 = IUniswapV2Pair(best).token0() == PAPER;
                candidate = address(0);
                (uint256 c, uint32 t) = _current();
                prev = Obs(c, t);
                last = Obs(c, t); // price reads 0 until a full window has passed on the new pool
                emit PoolAdopted(best, bestQuote);
                return;
            }
        } else if (candidate != address(0) && !hold) { // a hold (a feed is late) keeps the candidate's progress
            candidate = address(0);
            emit Candidate(address(0));
        }
        if (address(pair) == address(0)) return;
        (uint256 cum, uint32 ts) = _current();
        if (ts - last.ts < MIN_WINDOW) return;
        prev = last;
        last = Obs(cum, ts);
        emit Checkpoint(ts, _price());
    }

    /// @notice True when checkpoint() would change something: a candidate to record, drop or adopt, or a window to
    ///         roll. Lets a keeper stay quiet (and spend nothing) while PAPER has no market.
    function due() external view returns (bool) {
        (address best,, bool better, bool hold) = _contender();
        if (better && (candidate != best || block.timestamp - candidateSince >= MIN_WINDOW)) return true;
        if (!better && !hold && candidate != address(0)) return true;
        return address(pair) != address(0) && block.timestamp - last.ts >= MIN_WINDOW;
    }

    /// @dev The best pool, and whether it should replace the current reference (none yet, or 2x its liquidity).
    function _contender() internal view returns (address best, address bestQuote, bool better, bool hold) {
        if (_ethUsd() == 0) return (address(0), address(0), false, true); // can't compare fairly: hold
        if (PLANK != address(0) && _plankUsd() == 0) return (address(0), address(0), false, true); // same while PLANK's price is late
        uint256 bestLiq;
        (best, bestQuote, bestLiq) = _bestPool();
        if (best == address(0) || best == address(pair) || bestLiq < MIN_LIQUIDITY_USD) return (best, bestQuote, false, false);
        better = address(pair) == address(0) || bestLiq >= _liquidityUsd(address(pair), quote) * SWITCH_FACTOR;
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
        if (PLANK != address(0)) {
            address k = FACTORY.getPair(PAPER, PLANK);
            if (k != address(0)) {
                uint256 l = _liquidityUsd(k, PLANK);
                if (best == address(0) || l > bestLiq) (best, bestQuote, bestLiq) = (k, PLANK, l);
            }
        }
    }

    /// @dev Dollar value of the quote side of a pool, 8 decimals. WETH pools count 0 while the ETH feed is stale.
    function _liquidityUsd(address p, address q) internal view returns (uint256) {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(p).getReserves();
        uint256 qr = IUniswapV2Pair(p).token0() == q ? r0 : r1;
        if (q == USDG) return qr * 1e8 / (10 ** USDG_DECIMALS);
        if (q == PLANK) return qr * _plankUsd() / 1e28;
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

    /// @dev USD per PLANK, 18 decimals; 0 if missing or stale.
    function _plankUsd() internal view returns (uint256) {
        if (address(PLANK_USD) == address(0)) return 0;
        (bool ok, bytes memory ret) = address(PLANK_USD).staticcall(abi.encodeCall(IEthUsdFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) return 0;
        (, int256 px,, uint256 upd,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        if (px <= 0 || upd > block.timestamp || block.timestamp - upd > PLANK_FEED_MAX_AGE) return 0;
        return uint256(px);
    }

    /// @dev Cumulative price of PAPER in the quote token's raw units (UQ112x112), synced to now.
    function _current() internal view returns (uint256 cum, uint32 ts) {
        (uint112 r0, uint112 r1, uint32 tLast) = pair.getReserves();
        cum = paperIsToken0 ? pair.price0CumulativeLast() : pair.price1CumulativeLast();
        ts = uint32(block.timestamp);
        if (tLast != ts && r0 > 0 && r1 > 0) {
            uint256 px = paperIsToken0 ? (uint256(r1) << 112) / r0 : (uint256(r0) << 112) / r1;
            unchecked { cum += px * (ts - tLast); } // V2 cumulatives are meant to wrap
        }
    }

    function _price() internal view returns (uint256 paperUsd18) {
        if (last.ts == prev.ts) return 0;
        uint256 avgQ112; // quote raw units per PAPER raw unit
        unchecked { avgQ112 = (last.cum - prev.cum) / (last.ts - prev.ts); }
        if (quote == USDG) {
            // USD per PAPER, 18 dec = raw ratio * 10^18 (PAPER dec) / 10^usdgDec * 10^18
            return (avgQ112 * (10 ** (36 - uint256(USDG_DECIMALS)))) >> 112;
        }
        if (quote == PLANK) return (avgQ112 * _plankUsd()) >> 112; // (PLANK per PAPER, Q112) * (USD per PLANK, 18 dec)
        uint256 eth = _ethUsd();
        if (eth == 0) return 0;
        // (WETH per PAPER, Q112) * (USD per ETH, 8 dec) * 1e10 / 2^112
        return (avgQ112 * eth * 1e10) >> 112;
    }
}
