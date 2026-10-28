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
 *         factory holds at least MIN_LIQUIDITY_USD ($10) on its other side (PLANK valued by the PLANK feed) and at
 *         least MIN_PAPER_RESERVE (1,000 PAPER) on its PAPER side, a checkpoint starts that pool's run; if it still
 *         qualifies at every checkpoint for MIN_WINDOW (20h), it's adopted, and the first price appears one full
 *         window (>= 20h) after that: about 40h after the first checkpoint, even when a pool already exists at
 *         deploy. A pool in another currency takes over the same way once it holds twice the current pool's dollar
 *         liquidity for MIN_WINDOW. Each pool runs on its own clock: a pool that qualifies for a moment (a flash
 *         loan) starts only its own run, which breaks at the keeper's next checkpoint, and never resets another
 *         pool's. When several runs finish, the pool with the most liquidity at every checkpoint of its run wins
 *         (a flash at the deciding checkpoint can't raise that). Liquidity is read from spot reserves, so the "for
 *         MIN_WINDOW" part is what stops a flash loan from forcing a switch: the keeper checkpoints whenever due().
 *         While the ETH/USD feed (or the PLANK feed) is stale, every run holds and no pool is adopted or switched.
 *         After a switch, the last full window's price (heldPrice, dated when that window ended) keeps serving until
 *         the new pool has a full window, so a switch never takes the price away; consumers still drop it at their
 *         own maximum age.
 *
 *         Lopsided pools are ignored. A pool's price is its quote side over its PAPER side, so "$11 against 1 wei of
 *         PAPER" would read as an absurd PAPER price that nobody can trade against (there is no PAPER to buy). A pool
 *         with under MIN_PAPER_RESERVE PAPER counts as $0 of liquidity: it can't start a run, a run that drops under
 *         it breaks, and an adopted pool that drops under it can be replaced by any pool that
 *         qualifies. While the adopted pool holds under MIN_PAPER_RESERVE, the price reads 0 (FireSale keeps its last
 *         good PAPER price, LiquidityBurner waits). With 1,000 PAPER in the pool, showing a PAPER price of $P takes about
 *         $P x 1,000 on the quote side, which anyone can arbitrage away; the dollar floor alone set no such cost. This
 *         is a size rule only: nothing here reacts to how far or how fast the price moves.
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
    /// @dev ...and 1,000 PAPER on its PAPER side (ignores lopsided pools: see above). Checked on spot reserves.
    uint256 public constant MIN_PAPER_RESERVE = 1_000e18;

    IUniswapV2Pair public pair; // the pool the price comes from; address(0) until one exists
    address public quote; // WETH, USDG or PLANK: what PAPER is priced in on that pool
    bool public paperIsToken0;

    /// @dev Each other pool's run (0 WETH, 1 USDG, 2 PLANK): when it started qualifying, without a break at any
    ///      checkpoint, and the least liquidity it showed at any checkpoint since (8-decimal dollars). A pool whose run
    ///      reaches MIN_WINDOW can be adopted; when several have, the one with the most liquidity all along wins.
    ///      Each pool keeps its own clock, so a pool that qualifies for a moment (a flash loan) can't reset the
    ///      progress of the real one.
    struct Run { uint32 since; uint224 minLiq; }
    Run[3] internal runs;

    struct Obs { uint256 cum; uint32 ts; }
    Obs public prev; // window start
    Obs public last; // window end
    /// @notice The last full window's price (USD per PAPER, 18 decimals) and when that window ended. Served while a
    ///         newly adopted pool waits for its first full window, so a switch never takes the price away.
    uint256 public heldPrice;
    uint32 public heldTs;

    event PoolAdopted(address pair, address quote);
    event Candidate(address pair); // a pool started its run
    event CandidateDropped(address pair); // a pool's run broke (it stopped qualifying at a checkpoint)
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

    /// @notice Anyone. Rolls the window once the last checkpoint is at least MIN_WINDOW old, then (unless a feed is
    ///         late) updates each other pool's run and adopts a pool whose run has lasted MIN_WINDOW.
    function checkpoint() external {
        if (address(pair) != address(0)) {
            (uint256 cum, uint32 ts) = _current();
            if (ts - last.ts >= MIN_WINDOW) {
                prev = last;
                last = Obs(cum, ts);
                uint256 px = _price();
                if (px != 0) (heldPrice, heldTs) = (px, ts);
                emit Checkpoint(ts, px);
            }
        }
        if (_hold()) return; // a late feed can't value pools fairly: every run keeps its progress
        uint256 cur = _currentLiq();
        int256 best = -1;
        uint256 bestLiq;
        for (uint256 k; k < 3; k++) {
            (address p, address q) = _poolOf(k);
            Run storage r = runs[k];
            uint256 liq = p == address(0) || p == address(pair) ? 0 : _liquidityUsd(p, q);
            if (!_eligible(p, liq, cur)) {
                if (r.since != 0) {
                    delete runs[k];
                    emit CandidateDropped(p);
                }
                continue;
            }
            if (r.since == 0) {
                (r.since, r.minLiq) = (uint32(block.timestamp), uint224(liq));
                emit Candidate(p);
            } else if (liq < r.minLiq) {
                r.minLiq = uint224(liq);
            }
            if (block.timestamp - r.since >= MIN_WINDOW && r.minLiq > bestLiq) (best, bestLiq) = (int256(k), r.minLiq);
        }
        if (best < 0) return;
        (address np, address nq) = _poolOf(uint256(best));
        pair = IUniswapV2Pair(np);
        quote = nq;
        paperIsToken0 = IUniswapV2Pair(np).token0() == PAPER;
        delete runs[uint256(best)];
        (uint256 c, uint32 t) = _current();
        prev = Obs(c, t);
        last = Obs(c, t); // the new pool's own price after a full window; heldPrice until then
        emit PoolAdopted(np, nq);
    }

    /// @notice True when checkpoint() would change something: a window to roll, a run to start, break or finish, or a
    ///         running pool's liquidity down 10% from its recorded least (so the record stays honest). Lets a keeper
    ///         stay quiet (and spend nothing) while PAPER has no market.
    function due() external view returns (bool) {
        if (address(pair) != address(0) && block.timestamp - last.ts >= MIN_WINDOW) return true;
        if (_hold()) return false;
        uint256 cur = _currentLiq();
        for (uint256 k; k < 3; k++) {
            (address p, address q) = _poolOf(k);
            Run memory r = runs[k];
            uint256 liq = p == address(0) || p == address(pair) ? 0 : _liquidityUsd(p, q);
            bool ok = _eligible(p, liq, cur);
            if (ok != (r.since != 0)) return true;
            if (ok && (block.timestamp - r.since >= MIN_WINDOW || liq * 10 < uint256(r.minLiq) * 9)) return true;
        }
        return false;
    }

    /// @notice The pool most likely adopted next: a finished run with the most liquidity, else the longest run.
    ///         address(0) = none running.
    function candidate() public view returns (address p) {
        (p,) = _candidate();
    }

    /// @notice When the candidate's run started (0 = none).
    function candidateSince() external view returns (uint32 since) {
        (, since) = _candidate();
    }

    /// @notice A pool's run (k: 0 WETH, 1 USDG, 2 PLANK).
    function runOf(uint256 k) external view returns (address pool, uint32 since, uint256 minLiqUsd8) {
        (pool,) = _poolOf(k);
        (since, minLiqUsd8) = (runs[k].since, runs[k].minLiq);
    }

    /// @notice Chainlink-compatible read. 0 = no price yet. `updatedAt` = the window's end. Right after a switch, the
    ///         last full window's price (heldPrice) and its end, until the new pool has a full window.
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (address(pair) != address(0) && last.ts == prev.ts) return (0, int256(heldPrice), 0, heldTs, 0);
        return (0, int256(_price()), 0, last.ts, 0);
    }

    function decimals() external pure returns (uint8) { return 18; }

    // ---------------------------------------------------------------- internals
    /// @dev A late ETH price (or PLANK price, when PLANK pools count) holds every run and every switch.
    function _hold() internal view returns (bool) {
        return _ethUsd() == 0 || (PLANK != address(0) && _plankUsd() == 0);
    }

    /// @dev Pool k (0 WETH, 1 USDG, 2 PLANK) and its quote token; address(0) if not looked for or not created.
    function _poolOf(uint256 k) internal view returns (address p, address q) {
        q = k == 0 ? WETH : k == 1 ? USDG : PLANK;
        if (q != address(0)) p = FACTORY.getPair(PAPER, q);
    }

    function _currentLiq() internal view returns (uint256) {
        return address(pair) == address(0) ? 0 : _liquidityUsd(address(pair), quote);
    }

    /// @dev A pool can run if it holds MIN_LIQUIDITY_USD (and MIN_PAPER_RESERVE), and, once a pool is adopted, if it
    ///      holds SWITCH_FACTOR times the adopted pool's liquidity. The adopted pool itself never runs.
    function _eligible(address p, uint256 liq, uint256 cur) internal view returns (bool) {
        if (p == address(0) || p == address(pair) || liq < MIN_LIQUIDITY_USD) return false;
        return address(pair) == address(0) || liq >= cur * SWITCH_FACTOR;
    }

    function _candidate() internal view returns (address p, uint32 since) {
        uint256 bestLiq;
        bool done;
        for (uint256 k; k < 3; k++) {
            Run memory r = runs[k];
            if (r.since == 0) continue;
            bool fin = block.timestamp - r.since >= MIN_WINDOW;
            bool better = since == 0 || (fin && !done) || (fin == done && (fin ? r.minLiq > bestLiq : r.since < since));
            if (better) {
                (p,) = _poolOf(k);
                (since, bestLiq, done) = (r.since, r.minLiq, fin);
            }
        }
    }

    /// @dev Dollar value of the quote side of a pool, 8 decimals. WETH pools count 0 while the ETH feed is stale, and
    ///      any pool counts 0 while it holds under MIN_PAPER_RESERVE PAPER.
    function _liquidityUsd(address p, address q) internal view returns (uint256) {
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(p).getReserves();
        bool q0 = IUniswapV2Pair(p).token0() == q;
        if ((q0 ? r1 : r0) < MIN_PAPER_RESERVE) return 0;
        uint256 qr = q0 ? r0 : r1;
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
        (uint112 r0, uint112 r1,) = pair.getReserves();
        if ((paperIsToken0 ? r0 : r1) < MIN_PAPER_RESERVE) return 0; // the pool went lopsided: no price until it isn't
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
