// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

interface IBurnFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

interface IBurnTwap {
    function prev() external view returns (uint256 cum, uint32 ts);
    function last() external view returns (uint256 cum, uint32 ts);
}

interface IBurnRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        returns (uint256[] memory amounts);
}

/**
 * @title PaperBurner
 * @notice Turns fees into a PAPER burn (docs/grading.md). Whatever it holds (ETH, PLANK or USDG) it spends buying PAPER,
 *         straight to the dead address. Anyone can call `flush`; FirePsa sends every case and grading fee here and
 *         flushes in the same transaction. There is no withdraw: the only way out is buying PAPER and burning it.
 *
 *         Best route: for the amount, it asks each known route (e.g. ETH -> PAPER, ETH -> PLANK -> PAPER) what it
 *         would pay, and also every split of half on one route and half on another, and takes the best. A route that
 *         doesn't exist yet simply quotes nothing.
 *
 *         Guard: the buy must get at least SWAP_MIN_BPS (95%) of what the PAPER price feed (a 20-hour average) says
 *         it is worth. If the whole amount wouldn't, it tries half, then a quarter, ... (MAX_HALVINGS times), so a
 *         backlog drains in pieces the pools can take. If no piece passes, or a price is missing, nothing is spent: the
 *         fee waits here and the next flush tries again.
 *
 *         Locked so the fees can only ever buy PAPER: the router is fixed at deploy, the price feeds can be set once,
 *         and a route may only pass through WETH, PLANK or USDG on its way to PAPER. The owner can still choose among
 *         such routes (e.g. when a new pool opens). Quotes (`quote`) are what FirePsa charges for a dollar amount.
 */
contract PaperBurner is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Pay { PLANK, ETH, USDG }

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BPS = 10_000;
    uint256 public constant SWAP_MIN_BPS = 9_500;
    uint256 public constant MAX_HALVINGS = 6; // smallest piece tried: 1/64 of what's held
    uint256 public constant MAX_ROUTES = 4;
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours;
    uint256 public constant PLANK_FEED_MAX_AGE = 2 hours;
    uint256 public constant PLANK_WINDOW_MAX = 2 hours;
    uint256 public constant PAPER_FEED_MAX_AGE = 2 days;

    IERC20 public immutable PAPER;
    IERC20 public immutable PLANK;
    IERC20 public immutable USDG; // address(0) = no USDG
    uint256 public immutable USDG_UNIT;
    address public immutable WETH;
    IBurnRouter public immutable ROUTER;

    IBurnFeed public ethUsd; // 8 decimals (Chainlink)
    IBurnFeed public plankUsd; // 18 decimals (PlankUsdTwap)
    IBurnFeed public paperUsd; // 18 decimals (PaperUsdTwap)

    mapping(Pay => address[][]) internal _routes;

    event RoutesSet(Pay indexed pay, address[][] routes);
    event FeedsSet(address ethUsd, address plankUsd, address paperUsd);
    event Burned(Pay indexed pay, uint256 spent, uint256 paperOut);
    event Waiting(Pay indexed pay, uint256 amount);

    error ZeroAddress();
    error BadRoute();
    error FeedUnavailable();
    error FeedsAlreadySet();

    constructor(
        address owner_,
        address paper,
        address plank,
        address usdg,
        uint8 usdgDecimals,
        address weth,
        address router
    ) Ownable(owner_) {
        if (paper == address(0) || plank == address(0) || weth == address(0) || router == address(0)) revert ZeroAddress();
        PAPER = IERC20(paper);
        PLANK = IERC20(plank);
        USDG = IERC20(usdg);
        USDG_UNIT = 10 ** usdgDecimals;
        WETH = weth;
        ROUTER = IBurnRouter(router);
    }

    receive() external payable {}

    // ================================================================ owner

    /// @notice The routes tried for one currency: each starts at it (WETH for ETH) and ends at PAPER, 2-4 tokens,
    ///         at most MAX_ROUTES.
    function setRoutes(Pay pay, address[][] calldata routes) external onlyOwner {
        if (routes.length == 0 || routes.length > MAX_ROUTES) revert BadRoute();
        address input = _token(pay);
        if (input == address(0)) revert BadRoute();
        for (uint256 i; i < routes.length; i++) {
            address[] calldata r = routes[i];
            if (r.length < 2 || r.length > 4 || r[0] != input || r[r.length - 1] != address(PAPER)) revert BadRoute();
            for (uint256 j = 1; j < r.length - 1; j++) {
                // only the known tokens in between: a route can't send fees through a pool of someone's own token
                address t = r[j];
                if (t == input || (t != WETH && t != address(PLANK) && (t != address(USDG) || t == address(0)))) revert BadRoute();
            }
        }
        address[][] storage rs = _routes[pay];
        while (rs.length != 0) rs.pop();
        for (uint256 i; i < routes.length; i++) {
            address[] storage r = rs.push();
            for (uint256 j; j < routes[i].length; j++) r.push(routes[i][j]);
        }
        emit RoutesSet(pay, routes);
    }

    /// @notice The price feeds: ETH/USD (8 decimals), PlankUsdTwap and PaperUsdTwap (18 decimals each). Set once:
    ///         a feed the owner could swap later could also turn off the guard.
    function setFeeds(address eth, address plank, address paper) external onlyOwner {
        if (address(paperUsd) != address(0)) revert FeedsAlreadySet();
        if (eth == address(0) || plank == address(0) || paper == address(0)) revert ZeroAddress();
        if (_decimals(eth) != 8 || _decimals(plank) != 18 || _decimals(paper) != 18) revert FeedUnavailable();
        ethUsd = IBurnFeed(eth);
        plankUsd = IBurnFeed(plank);
        paperUsd = IBurnFeed(paper);
        emit FeedsSet(eth, plank, paper);
    }

    // ================================================================ anyone

    /// @notice Spend everything held in `pay` on PAPER and burn it, if the guard allows (trying smaller pieces of a
    ///         backlog). Returns the PAPER burned. Anyone can call it.
    function flush(Pay pay) external nonReentrant returns (uint256) {
        return _flush(pay, MAX_HALVINGS);
    }

    /// @notice The light flush FirePsa runs with every fee: the whole amount or half, no deeper search (so a waiting
    ///         burner costs each case or grade little gas). `flush` drains anything left.
    function flushLight(Pay pay) external nonReentrant returns (uint256) {
        return _flush(pay, 1);
    }

    function _flush(Pay pay, uint256 halvings) internal returns (uint256 out) {
        uint256 held = pay == Pay.ETH ? address(this).balance : IERC20(_token(pay)).balanceOf(address(this));
        if (held == 0) return 0;
        // the whole amount, else the biggest piece (half, a quarter, ...) the guard allows
        uint256 amount = held;
        uint256 minOut;
        uint256 a;
        uint256 b;
        uint256 inA;
        for (uint256 k; ; k++) {
            minOut = _minPaper(pay, amount);
            uint256 quoted;
            if (minOut != 0) (a, b, inA, quoted) = _plan(pay, amount);
            if (minOut != 0 && quoted >= minOut) break;
            if (minOut == 0 || k == halvings || amount < 2) {
                emit Waiting(pay, held);
                return 0;
            }
            amount /= 2;
        }
        address[][] storage rs = _routes[pay];
        uint256 before = PAPER.balanceOf(DEAD);
        uint256 spent;
        uint256 minA = minOut * inA / amount; // each part keeps its share of the guard
        if (_swap(pay, rs[a], inA, minA)) spent = inA;
        if (inA < amount && _swap(pay, rs[b], amount - inA, minOut - minA)) spent += amount - inA;
        out = PAPER.balanceOf(DEAD) - before;
        if (spent < held) emit Waiting(pay, held - spent);
        if (spent > 0) emit Burned(pay, spent, out);
    }

    // ================================================================ views

    /// @notice How much of `pay` a dollar amount (18 decimals) costs right now, rounded up. Reverts with no price.
    function quote(Pay pay, uint256 usd18) external view returns (uint256) {
        if (pay == Pay.USDG) {
            if (address(USDG) == address(0)) revert FeedUnavailable();
            return (usd18 * USDG_UNIT + 1e18 - 1) / 1e18;
        }
        uint256 px = _priceOf(pay); // USD per whole token, 18 decimals
        if (px == 0) revert FeedUnavailable();
        return (usd18 * 1e18 + px - 1) / px;
    }

    function routesOf(Pay pay) external view returns (address[][] memory) {
        return _routes[pay];
    }

    /// @notice The best plan for `amount`: route `a` gets `inA`, route `b` the rest (b = a when not split), and the
    ///         PAPER it quotes in all.
    function planFor(Pay pay, uint256 amount) external view returns (uint256 a, uint256 b, uint256 inA, uint256 quoted) {
        return _plan(pay, amount);
    }

    // ================================================================ internals

    function _plan(Pay pay, uint256 amount) internal view returns (uint256 a, uint256 b, uint256 inA, uint256 best) {
        address[][] storage rs = _routes[pay];
        uint256 n = rs.length;
        inA = amount;
        uint256 half = amount / 2;
        uint256[] memory h1 = new uint256[](n);
        uint256[] memory h2 = new uint256[](n);
        for (uint256 i; i < n; i++) {
            uint256 full = _out(rs[i], amount);
            if (full > best) (best, a, b) = (full, i, i);
            if (half != 0) {
                h1[i] = _out(rs[i], half);
                h2[i] = _out(rs[i], amount - half);
            }
        }
        (uint256 si, uint256 sj, uint256 split) = _bestSplit(rs, h1, h2);
        if (split > best) (best, a, b, inA) = (split, si, sj, half);
    }

    /// @dev The best half-and-half split across two routes that share no pool.
    function _bestSplit(address[][] storage rs, uint256[] memory h1, uint256[] memory h2)
        internal
        view
        returns (uint256 si, uint256 sj, uint256 best)
    {
        for (uint256 i; i < h1.length; i++) {
            for (uint256 j; j < h1.length; j++) {
                if (i == j || h1[i] == 0 || h2[j] == 0 || h1[i] + h2[j] <= best || _sharePool(rs[i], rs[j])) continue;
                (best, si, sj) = (h1[i] + h2[j], i, j);
            }
        }
    }

    /// @dev Two routes through the same pool would move each other's price: never split across them.
    function _sharePool(address[] storage x, address[] storage y) internal view returns (bool) {
        for (uint256 i; i + 1 < x.length; i++) {
            for (uint256 j; j + 1 < y.length; j++) {
                if ((x[i] == y[j] && x[i + 1] == y[j + 1]) || (x[i] == y[j + 1] && x[i + 1] == y[j])) return true;
            }
        }
        return false;
    }

    function _out(address[] storage route, uint256 amountIn) internal view returns (uint256) {
        try ROUTER.getAmountsOut(amountIn, route) returns (uint256[] memory amounts) {
            return amounts[amounts.length - 1];
        } catch {
            return 0;
        }
    }

    function _swap(Pay pay, address[] storage route, uint256 amountIn, uint256 minOut) internal returns (bool ok) {
        if (pay == Pay.ETH) {
            try ROUTER.swapExactETHForTokens{value: amountIn}(minOut, route, DEAD, block.timestamp) {
                return true;
            } catch {
                return false;
            }
        }
        IERC20 token = IERC20(_token(pay));
        token.forceApprove(address(ROUTER), amountIn);
        try ROUTER.swapExactTokensForTokens(amountIn, minOut, route, DEAD, block.timestamp) {
            ok = true;
        } catch {
            ok = false;
        }
        token.forceApprove(address(ROUTER), 0);
    }

    /// @dev Least PAPER the whole buy must get: SWAP_MIN_BPS of the fee's dollar value at the PAPER feed's price.
    ///      0 = a price is missing (wait).
    function _minPaper(Pay pay, uint256 amount) internal view returns (uint256) {
        uint256 paper = _feed18(paperUsd, PAPER_FEED_MAX_AGE);
        if (paper == 0) return 0;
        uint256 usd18;
        if (pay == Pay.USDG) {
            usd18 = amount * 1e18 / USDG_UNIT;
        } else {
            uint256 px = _priceOf(pay);
            if (px == 0) return 0;
            usd18 = amount * px / 1e18;
        }
        return usd18 * 1e18 / paper * SWAP_MIN_BPS / BPS;
    }

    /// @dev USD per whole ETH or PLANK, 18 decimals; 0 if missing or stale.
    function _priceOf(Pay pay) internal view returns (uint256) {
        if (pay == Pay.ETH) {
            uint256 e = _feed18(ethUsd, ETH_FEED_MAX_AGE);
            return e * 1e10; // 8 decimals -> 18
        }
        uint256 p = _feed18(plankUsd, PLANK_FEED_MAX_AGE);
        if (p == 0) return 0;
        (bool ok1, bytes memory r1) = address(plankUsd).staticcall(abi.encodeCall(IBurnTwap.prev, ()));
        (bool ok2, bytes memory r2) = address(plankUsd).staticcall(abi.encodeCall(IBurnTwap.last, ()));
        if (ok1 && ok2 && r1.length >= 64 && r2.length >= 64) {
            (, uint32 t0) = abi.decode(r1, (uint256, uint32));
            (, uint32 t1) = abi.decode(r2, (uint256, uint32));
            if (t1 < t0 || t1 - t0 > PLANK_WINDOW_MAX) return 0;
        }
        return p;
    }

    /// @dev A feed's answer if fresh, else 0 (never reverts).
    function _feed18(IBurnFeed f, uint256 maxAge) internal view returns (uint256) {
        if (address(f) == address(0)) return 0;
        (bool ok, bytes memory ret) = address(f).staticcall(abi.encodeCall(IBurnFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) return 0;
        (, int256 px,, uint256 at,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        if (px <= 0 || at > block.timestamp || block.timestamp - at > maxAge) return 0;
        return uint256(px);
    }

    function _decimals(address feed) internal view returns (uint8) {
        (bool ok, bytes memory ret) = feed.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || ret.length < 32) revert FeedUnavailable();
        return abi.decode(ret, (uint8));
    }

    function _token(Pay pay) internal view returns (address) {
        return pay == Pay.ETH ? WETH : pay == Pay.PLANK ? address(PLANK) : address(USDG);
    }
}
