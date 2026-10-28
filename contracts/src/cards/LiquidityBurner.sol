// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface ILiqFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

interface ILiqTwap {
    function prev() external view returns (uint256 cum, uint32 ts);
    function last() external view returns (uint256 cum, uint32 ts);
}

interface ILiqRouter {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        returns (uint256[] memory amounts);
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
}

interface ILiqPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112, uint112, uint32);
    function price0CumulativeLast() external view returns (uint256);
    function price1CumulativeLast() external view returns (uint256);
}

/**
 * @title LiquidityBurner
 * @notice Turns everything the site used to burn into PAPER/PLANK liquidity that is locked for good
 *         (docs/liquidity-burn.md). Pack sales (their liquidity share, in the coin paid, and each pack's PAPER),
 *         the Extra packs' rising price, case and grading fees, suggestions and game entries all arrive here.
 *         The keepers `run` it: the PAPER and PLANK it holds pair up, go into the PAPER/PLANK Uniswap V2 pool, and
 *         the pool tokens go straight to the dead address. Each side waits for the other on its own; only a side
 *         worth more than CAP_USD ($100) burns its excess outright.
 *
 *         A run, in order:
 *         1. ETH and USDG held are spent: while the PAPER side is worth under SOFT_USD ($50), PAPER_FIRST_BPS (60%)
 *            buys PAPER; the rest buys whichever side is short, and what's left after evening them splits half and
 *            half.
 *         2. If the PLANK side is worth more than the PAPER side, PLANK is sold for PAPER until they're even.
 *            PAPER is never sold.
 *         3. The matching dollar amount of each side (at least MIN_PAIR_USD, $1) is added to the pool, the pool
 *            tokens to the dead address.
 *         4. A side worth more than CAP_USD burns the excess.
 *
 *         Prices: PLANK is the 30-minute PlankUsdTwap average, ETH is Chainlink ETH/USD. PAPER is a short average
 *         this contract keeps itself: the PAPER/PLANK pool's own time-weighted price (Uniswap V2 cumulative prices)
 *         over the last MIN_WINDOW (30 min) to MAX_WINDOW (2 h), ending now, times the PLANK price. Anyone can
 *         `checkpoint()` it (the keepers do whenever `due()`, and every run does). PaperUsdTwap averages 20 h or more,
 *         far too slow to guard a trade, so it is only a sanity bound: a run waits while the short price is more than
 *         MAX_DRIFT (2x) away from it either way, or while it is missing. No short price (just deployed, or no
 *         checkpoint for over 2 h): the run waits.
 *
 *         Guards: every buy must get at least SWAP_MIN_BPS (95%) of what those prices say it is worth, else a smaller
 *         piece is tried (half, a quarter, ...) and otherwise the coins wait; liquidity is added only while the pool's
 *         spot price is within POOL_BPS (3%) of its own short average. A price pushed in the run's block doesn't reach
 *         the average at all; holding it there costs the arbitrage for as long as it's held. Only the keepers can run
 *         it: an open run could be wrapped (push the price, run, push back).
 *
 *         Locked so the coins can only ever end as burned liquidity or burned PAPER/PLANK: no withdraw, the router,
 *         tokens and pool are fixed at deploy, the price feeds are set once, and buy routes may only pass through
 *         WETH, PLANK, USDG or PAPER. The owner can name keepers and choose among such routes, nothing else.
 *         `quote` is what FirePsa charges for a dollar amount (as PaperBurner did).
 */
contract LiquidityBurner is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Pay { PLANK, ETH, USDG }
    enum Side { PAPER, PLANK }

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BPS = 10_000;
    uint256 public constant SWAP_MIN_BPS = 9_500;
    uint256 public constant POOL_BPS = 300;
    uint256 public constant PAPER_FIRST_BPS = 6_000;
    uint256 public constant SOFT_USD = 50e18;
    uint256 public constant CAP_USD = 100e18;
    uint256 public constant MIN_PAIR_USD = 1e18;
    uint256 public constant MAX_HALVINGS = 6; // smallest piece tried: 1/64
    uint256 public constant MAX_ROUTES = 4;
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours;
    uint256 public constant PLANK_FEED_MAX_AGE = 2 hours;
    uint256 public constant PLANK_WINDOW_MAX = 2 hours;
    uint256 public constant PAPER_FEED_MAX_AGE = 2 days;
    uint256 public constant PAPER_WINDOW_MAX = 30 hours;
    /// @notice The short PAPER average (the PAPER/PLANK pool's own) spans MIN_WINDOW to MAX_WINDOW, ending now.
    uint256 public constant MIN_WINDOW = 30 minutes;
    uint256 public constant MAX_WINDOW = 2 hours;
    /// @notice A run waits while the short PAPER price is more than MAX_DRIFT times off PaperUsdTwap's, either way.
    uint256 public constant MAX_DRIFT = 2;

    IERC20 public immutable PAPER;
    IERC20 public immutable PLANK;
    IERC20 public immutable USDG; // address(0) = no USDG
    uint256 public immutable USDG_UNIT;
    uint256 public immutable PAPER_UNIT;
    uint256 public immutable PLANK_UNIT;
    address public immutable WETH;
    ILiqRouter public immutable ROUTER;
    /// @notice The PAPER/PLANK Uniswap V2 pool the liquidity goes into.
    ILiqPair public immutable PAIR;
    bool public immutable PAPER_IS_TOKEN0;

    ILiqFeed public ethUsd; // 8 decimals (Chainlink)
    ILiqFeed public plankUsd; // 18 decimals (PlankUsdTwap)
    ILiqFeed public paperUsd; // 18 decimals (PaperUsdTwap)

    /// @dev Buy routes by what is paid (ETH or USDG; PLANK only to PAPER) and what is bought.
    mapping(Pay => mapping(Side => address[][])) internal _routes;
    /// @notice Who may run it (the keepers), set by the owner.
    mapping(address => bool) public keeper;

    /// @notice All-time totals: PAPER and PLANK added as liquidity (and its pool tokens burned), and burned outright
    ///         (a side over the cap).
    uint256 public paperToLiquidity;
    uint256 public plankToLiquidity;
    uint256 public lpBurned;
    uint256 public paperBurned;
    uint256 public plankBurned;

    /// @notice The short PAPER average's checkpoints: the pool's cumulative PLANK-per-PAPER price (UQ112x112, raw
    ///         units) and when. The average runs from `last` (or `prev`, while `last` is under MIN_WINDOW old) to now.
    struct Obs {
        uint256 cum;
        uint32 ts;
    }

    Obs public prev;
    Obs public last;

    event RoutesSet(Pay indexed pay, Side indexed side, address[][] routes);
    event FeedsSet(address ethUsd, address plankUsd, address paperUsd);
    event KeeperSet(address indexed who, bool allowed);
    event Bought(Pay indexed pay, Side indexed side, uint256 spent, uint256 got);
    event LiquidityBurned(uint256 paper, uint256 plank, uint256 lp);
    event OverCap(Side indexed side, uint256 amount);
    event Waiting(uint256 paperUsd18, uint256 plankUsd18, uint256 spendUsd18);
    event Checkpoint(uint32 ts);

    error ZeroAddress();
    error BadRoute();
    error BadPair();
    error FeedUnavailable();
    error FeedsAlreadySet();
    error RenounceDisabled();
    error NotKeeper();

    constructor(
        address owner_,
        address paper,
        address plank,
        address usdg,
        uint8 usdgDecimals,
        address weth,
        address router,
        address pair
    ) Ownable(owner_) {
        if (paper == address(0) || plank == address(0) || weth == address(0) || router == address(0) || pair == address(0)) {
            revert ZeroAddress();
        }
        address t0 = ILiqPair(pair).token0();
        address t1 = ILiqPair(pair).token1();
        if (!((t0 == paper && t1 == plank) || (t0 == plank && t1 == paper))) revert BadPair();
        PAPER = IERC20(paper);
        PLANK = IERC20(plank);
        USDG = IERC20(usdg);
        USDG_UNIT = 10 ** usdgDecimals;
        PAPER_UNIT = 10 ** _tokenDecimals(paper);
        PLANK_UNIT = 10 ** _tokenDecimals(plank);
        WETH = weth;
        ROUTER = ILiqRouter(router);
        PAIR = ILiqPair(pair);
        PAPER_IS_TOKEN0 = t0 == paper;
        (uint256 cum, uint32 ts) = _current();
        prev = Obs(cum, ts);
        last = Obs(cum, ts);
    }

    receive() external payable {}

    // ================================================================ owner

    /// @notice Ownership can be handed over (two steps) but never renounced, so control can't be lost by mistake.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Allow or stop an address running it (the keepers). Stopping every keeper only makes coins wait.
    function setKeeper(address who, bool allowed) external onlyOwner {
        if (who == address(0)) revert ZeroAddress();
        keeper[who] = allowed;
        emit KeeperSet(who, allowed);
    }

    /// @notice The routes tried to buy `side` with `pay`: each starts at it (WETH for ETH) and ends at PAPER or
    ///         PLANK, 2-4 tokens, at most MAX_ROUTES; in between only WETH, PLANK, USDG or PAPER. PLANK only buys
    ///         PAPER (PAPER is never sold).
    function setRoutes(Pay pay, Side side, address[][] calldata routes) external onlyOwner {
        if (routes.length == 0 || routes.length > MAX_ROUTES) revert BadRoute();
        if (pay == Pay.PLANK && side != Side.PAPER) revert BadRoute();
        address input = _token(pay);
        address output = side == Side.PAPER ? address(PAPER) : address(PLANK);
        if (input == address(0)) revert BadRoute();
        for (uint256 i; i < routes.length; i++) {
            address[] calldata r = routes[i];
            if (r.length < 2 || r.length > 4 || r[0] != input || r[r.length - 1] != output) revert BadRoute();
            for (uint256 j = 1; j < r.length - 1; j++) {
                address t = r[j];
                if (t == input || t == output) revert BadRoute();
                if (t != WETH && t != address(PLANK) && t != address(PAPER) && (t != address(USDG) || t == address(0))) {
                    revert BadRoute();
                }
            }
        }
        address[][] storage rs = _routes[pay][side];
        while (rs.length != 0) rs.pop();
        for (uint256 i; i < routes.length; i++) {
            address[] storage r = rs.push();
            for (uint256 j; j < routes[i].length; j++) r.push(routes[i][j]);
        }
        emit RoutesSet(pay, side, routes);
    }

    /// @notice The price feeds: ETH/USD (8 decimals), PlankUsdTwap and PaperUsdTwap (18 decimals each). Set once:
    ///         a feed the owner could swap later could also turn off the guards.
    function setFeeds(address eth, address plank, address paper) external onlyOwner {
        if (address(paperUsd) != address(0)) revert FeedsAlreadySet();
        if (eth == address(0) || plank == address(0) || paper == address(0)) revert ZeroAddress();
        if (_decimals(eth) != 8 || _decimals(plank) != 18 || _decimals(paper) != 18) revert FeedUnavailable();
        ethUsd = ILiqFeed(eth);
        plankUsd = ILiqFeed(plank);
        paperUsd = ILiqFeed(paper);
        emit FeedsSet(eth, plank, paper);
    }

    // ================================================================ keepers

    /// @notice Spend, even out, pair and burn (see the contract notes). Keepers only. `moved`: whether anything it
    ///         holds changed (false: everything waited), so a keeper can simulate first and skip a run that does nothing.
    function run() external nonReentrant returns (bool moved) {
        if (!keeper[msg.sender]) revert NotKeeper();
        _checkpoint();
        bytes32 before = _holdings();
        (uint256 p, uint256 k) = _prices();
        if (p == 0) {
            emit Waiting(0, 0, 0); // no price: everything waits
            return false;
        }
        // pair what's already here first, while the pool's price is the one the guard checked; then spend, even out
        // and pair again (this run's own buys can move a thin pool past the 3% band: then that part waits)
        _pair(p, k);
        _spend(p, k);
        _evenOut(p, k);
        _pair(p, k);
        _cap(p, k);
        (uint256 vp, uint256 vk) = _sides(p, k);
        uint256 vs = _spendable();
        if (vp != 0 || vk != 0 || vs != 0) emit Waiting(vp, vk, vs);
        moved = _holdings() != before;
    }

    /// @dev What it holds (ETH, PAPER, PLANK, USDG), as one hash to compare before and after a run.
    function _holdings() internal view returns (bytes32) {
        uint256 u = address(USDG) == address(0) ? 0 : USDG.balanceOf(address(this));
        return keccak256(abi.encode(address(this).balance, PAPER.balanceOf(address(this)), PLANK.balanceOf(address(this)), u));
    }

    // ================================================================ the short PAPER average

    /// @notice Anyone. Moves the short PAPER average on once the last checkpoint is at least MIN_WINDOW old; earlier
    ///         calls do nothing. The average always spans at least MIN_WINDOW, so calling often can't shorten it.
    function checkpoint() external {
        _checkpoint();
    }

    /// @notice True when checkpoint() would move the average on (the keepers' cue).
    function due() external view returns (bool) {
        return block.timestamp - last.ts >= MIN_WINDOW;
    }

    /// @notice The prices a run would use (USD per whole coin, 18 decimals): PAPER (the short PAPER/PLANK average
    ///         times PLANK) and PLANK. Both 0 while a run would wait for a price.
    function prices() external view returns (uint256 paperUsd18, uint256 plankUsd18) {
        return _prices();
    }

    function _checkpoint() internal {
        (uint256 cum, uint32 ts) = _current();
        if (ts - last.ts < MIN_WINDOW) return;
        prev = last;
        last = Obs(cum, ts);
        emit Checkpoint(ts);
    }

    /// @dev The pool's cumulative PLANK-per-PAPER price (UQ112x112, raw units), synced to now as the pool would.
    function _current() internal view returns (uint256 cum, uint32 ts) {
        (uint112 r0, uint112 r1, uint32 tLast) = PAIR.getReserves();
        cum = PAPER_IS_TOKEN0 ? PAIR.price0CumulativeLast() : PAIR.price1CumulativeLast();
        ts = uint32(block.timestamp);
        if (tLast != ts && r0 != 0 && r1 != 0) {
            uint256 px = PAPER_IS_TOKEN0 ? (uint256(r1) << 112) / r0 : (uint256(r0) << 112) / r1;
            unchecked {
                cum += px * (ts - tLast); // V2 cumulatives are meant to wrap
            }
        }
    }

    /// @dev The short average, PLANK raw units per PAPER raw unit (UQ112x112), from `last` (or `prev` while `last`
    ///      is under MIN_WINDOW old) to now; 0 if that's under MIN_WINDOW or over MAX_WINDOW.
    function _shortPaperInPlank() internal view returns (uint256 avg) {
        (uint256 cum, uint32 ts) = _current();
        Obs memory start = ts - last.ts >= MIN_WINDOW ? last : prev;
        uint256 dt = ts - start.ts;
        if (dt < MIN_WINDOW || dt > MAX_WINDOW) return 0;
        unchecked {
            avg = (cum - start.cum) / dt;
        }
    }

    /// @dev The prices for a run (see the contract notes), or (0, 0) when it must wait: PLANK missing, stale or over
    ///      a long window; the short PAPER average missing; or PaperUsdTwap missing, stale, over a long window or
    ///      more than MAX_DRIFT away from the short price.
    function _prices() internal view returns (uint256 p, uint256 k) {
        k = _feed18(plankUsd, PLANK_FEED_MAX_AGE);
        if (k == 0 || _longWindow(address(plankUsd), PLANK_WINDOW_MAX)) return (0, 0);
        uint256 q = _shortPaperInPlank();
        if (q == 0) return (0, 0);
        // USD per whole PAPER = (PLANK raw per PAPER raw) * (USD per whole PLANK) * PAPER_UNIT / PLANK_UNIT
        p = Math.mulDiv(Math.mulDiv(q, k, 1 << 112), PAPER_UNIT, PLANK_UNIT);
        uint256 longP = _feed18(paperUsd, PAPER_FEED_MAX_AGE);
        if (p == 0 || longP == 0 || _longWindow(address(paperUsd), PAPER_WINDOW_MAX)) return (0, 0);
        if (p / MAX_DRIFT > longP || longP / MAX_DRIFT > p) return (0, 0);
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
        uint256 unit = pay == Pay.PLANK ? PLANK_UNIT : 1e18;
        return (usd18 * unit + px - 1) / px;
    }

    function routesOf(Pay pay, Side side) external view returns (address[][] memory) {
        return _routes[pay][side];
    }

    /// @notice What it holds now, in dollars (18 decimals): the PAPER side and the PLANK side (both 0 while a run
    ///         would wait for a price, exactly as run() sees the prices), and ETH + USDG still to spend (its ETH counts
    ///         0 while ETH/USD is stale).
    function held() external view returns (uint256 paperSide, uint256 plankSide, uint256 toSpend) {
        (uint256 p, uint256 k) = _prices();
        (paperSide, plankSide) = _sides(p, k);
        toSpend = _spendable();
    }

    // ================================================================ the run

    /// @dev Step 1: ETH and USDG buy PAPER first (while that side is under SOFT_USD), then the short side.
    function _spend(uint256 p, uint256 k) internal {
        uint256 e = _priceOf(Pay.ETH);
        uint256 ethBal = e == 0 ? 0 : address(this).balance;
        uint256 usdgBal = address(USDG) == address(0) ? 0 : USDG.balanceOf(address(this));
        uint256 total = ethBal * e / 1e18 + usdgBal * 1e18 / USDG_UNIT;
        if (total == 0) return;
        (uint256 vp, uint256 vk) = _sides(p, k);
        uint256 toPaper = paperShare(total, vp, vk);
        // each coin buys PAPER and PLANK in the same proportion
        if (ethBal != 0) _buySplit(Pay.ETH, ethBal, toPaper, total, p, k, e);
        if (usdgBal != 0) _buySplit(Pay.USDG, usdgBal, toPaper, total, p, k, 1e18);
    }

    /// @notice Of `total` dollars to spend, how many buy PAPER (the rest buys PLANK), given the PAPER and PLANK
    ///         sides now (`vp`, `vk`): PAPER_FIRST_BPS while the PAPER side is under SOFT_USD, then the short side
    ///         until they're even, then half and half.
    function paperShare(uint256 total, uint256 vp, uint256 vk) public pure returns (uint256 toPaper) {
        toPaper = vp < SOFT_USD ? total * PAPER_FIRST_BPS / BPS : 0;
        uint256 rest = total - toPaper;
        uint256 afterPaper = vp + toPaper;
        if (afterPaper > vk) {
            rest -= _min(rest, afterPaper - vk); // that much evens out the PLANK side
        } else {
            uint256 x = _min(rest, vk - afterPaper);
            toPaper += x;
            rest -= x;
        }
        toPaper += rest / 2;
    }

    function _buySplit(Pay pay, uint256 amount, uint256 toPaperUsd, uint256 totalUsd, uint256 p, uint256 k, uint256 px) internal {
        uint256 forPaper = amount * toPaperUsd / totalUsd;
        if (forPaper != 0) _buy(pay, Side.PAPER, forPaper, p, px);
        if (amount - forPaper != 0) _buy(pay, Side.PLANK, amount - forPaper, k, px);
    }

    /// @dev Step 2: PLANK heavier than PAPER sells PLANK for PAPER until they're even (half the difference).
    function _evenOut(uint256 p, uint256 k) internal {
        (uint256 vp, uint256 vk) = _sides(p, k);
        if (vk <= vp + MIN_PAIR_USD) return;
        uint256 sellUsd = (vk - vp) / 2;
        uint256 amount = sellUsd * PLANK_UNIT / k;
        if (amount != 0) _buy(Pay.PLANK, Side.PAPER, amount, p, k);
    }

    /// @dev Step 3: the matching dollar amount of each side into the pool, the pool tokens to the dead address.
    function _pair(uint256 p, uint256 k) internal {
        (uint256 vp, uint256 vk) = _sides(p, k);
        uint256 m = _min(vp, vk);
        if (m < MIN_PAIR_USD || !_poolPriceOk(p, k)) return;
        uint256 paperAmt = _min(m * PAPER_UNIT / p, PAPER.balanceOf(address(this)));
        uint256 plankAmt = _min(m * PLANK_UNIT / k, PLANK.balanceOf(address(this)));
        if (paperAmt == 0 || plankAmt == 0) return;
        PAPER.forceApprove(address(ROUTER), paperAmt);
        PLANK.forceApprove(address(ROUTER), plankAmt);
        try ROUTER.addLiquidity(
            address(PAPER),
            address(PLANK),
            paperAmt,
            plankAmt,
            paperAmt * (BPS - POOL_BPS) / BPS,
            plankAmt * (BPS - POOL_BPS) / BPS,
            DEAD,
            block.timestamp
        ) returns (uint256 a, uint256 b, uint256 lp) {
            _added(a, b, lp);
        } catch {}
        PAPER.forceApprove(address(ROUTER), 0);
        PLANK.forceApprove(address(ROUTER), 0);
    }

    function _added(uint256 a, uint256 b, uint256 lp) internal {
        paperToLiquidity += a;
        plankToLiquidity += b;
        lpBurned += lp;
        emit LiquidityBurned(a, b, lp);
    }

    /// @dev Step 4: a side worth more than CAP_USD burns the excess.
    function _cap(uint256 p, uint256 k) internal {
        uint256 pb = PAPER.balanceOf(address(this));
        uint256 capPaper = CAP_USD * PAPER_UNIT / p;
        if (pb > capPaper) {
            PAPER.safeTransfer(DEAD, pb - capPaper);
            paperBurned += pb - capPaper;
            emit OverCap(Side.PAPER, pb - capPaper);
        }
        uint256 kb = PLANK.balanceOf(address(this));
        uint256 capPlank = CAP_USD * PLANK_UNIT / k;
        if (kb > capPlank) {
            PLANK.safeTransfer(DEAD, kb - capPlank);
            plankBurned += kb - capPlank;
            emit OverCap(Side.PLANK, kb - capPlank);
        }
    }

    // ================================================================ buying

    /// @dev Buy `side` with `amount` of `pay` (worth `payPx` USD a whole coin) by the best route, if it gets at least
    ///      SWAP_MIN_BPS of its worth at the feeds (`outPx`, USD a whole coin bought); else a smaller piece, else
    ///      nothing (it waits).
    function _buy(Pay pay, Side side, uint256 amount, uint256 outPx, uint256 payPx) internal {
        address[][] storage rs = _routes[pay][side];
        if (rs.length == 0) return;
        uint256 inUnit = pay == Pay.ETH ? 1e18 : pay == Pay.PLANK ? PLANK_UNIT : USDG_UNIT;
        uint256 outUnit = side == Side.PAPER ? PAPER_UNIT : PLANK_UNIT;
        for (uint256 h; h <= MAX_HALVINGS && amount != 0; h++) {
            uint256 usd18 = amount * payPx / inUnit;
            uint256 minOut = usd18 * outUnit / outPx * SWAP_MIN_BPS / BPS;
            (uint256 best, uint256 at) = _bestRoute(rs, amount);
            if (minOut != 0 && best >= minOut) {
                uint256 got = _swap(pay, rs[at], amount, minOut);
                if (got != 0) emit Bought(pay, side, amount, got);
                return;
            }
            amount /= 2;
        }
    }

    function _bestRoute(address[][] storage rs, uint256 amount) internal view returns (uint256 best, uint256 at) {
        for (uint256 i; i < rs.length; i++) {
            uint256 out;
            try ROUTER.getAmountsOut(amount, rs[i]) returns (uint256[] memory a) {
                out = a[a.length - 1];
            } catch {}
            if (out > best) (best, at) = (out, i);
        }
    }

    function _swap(Pay pay, address[] storage route, uint256 amountIn, uint256 minOut) internal returns (uint256 got) {
        IERC20 out = IERC20(route[route.length - 1]);
        uint256 before = out.balanceOf(address(this));
        if (pay == Pay.ETH) {
            try ROUTER.swapExactETHForTokens{value: amountIn}(minOut, route, address(this), block.timestamp) {} catch {}
        } else {
            IERC20 token = IERC20(_token(pay));
            token.forceApprove(address(ROUTER), amountIn);
            try ROUTER.swapExactTokensForTokens(amountIn, minOut, route, address(this), block.timestamp) {} catch {}
            token.forceApprove(address(ROUTER), 0);
        }
        got = out.balanceOf(address(this)) - before;
    }

    // ================================================================ internals

    /// @dev The PAPER and PLANK sides in dollars (18 decimals).
    function _sides(uint256 p, uint256 k) internal view returns (uint256 vp, uint256 vk) {
        vp = PAPER.balanceOf(address(this)) * p / PAPER_UNIT;
        vk = PLANK.balanceOf(address(this)) * k / PLANK_UNIT;
    }

    function _spendable() internal view returns (uint256) {
        uint256 e = _priceOf(Pay.ETH);
        uint256 v = address(this).balance * e / 1e18;
        if (address(USDG) != address(0)) v += USDG.balanceOf(address(this)) * 1e18 / USDG_UNIT;
        return v;
    }

    /// @dev The pool's spot PLANK-per-PAPER within POOL_BPS of p / k (its own short average): nobody has pushed it
    ///      before an add.
    function _poolPriceOk(uint256 p, uint256 k) internal view returns (bool) {
        (uint112 r0, uint112 r1,) = PAIR.getReserves();
        if (r0 == 0 || r1 == 0) return false;
        (uint256 rp, uint256 rk) = PAIR.token0() == address(PAPER) ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        // pool: whole PLANK per whole PAPER = (rk / PLANK_UNIT) / (rp / PAPER_UNIT); feeds: p / k
        uint256 pool = rk * PAPER_UNIT * 1e18 / (rp * PLANK_UNIT);
        uint256 feeds = p * 1e18 / k;
        uint256 lo = feeds * (BPS - POOL_BPS) / BPS;
        uint256 hi = feeds * (BPS + POOL_BPS) / BPS;
        return pool >= lo && pool <= hi;
    }

    /// @dev USD per whole ETH or PLANK, 18 decimals; 0 if missing or stale.
    function _priceOf(Pay pay) internal view returns (uint256) {
        if (pay == Pay.ETH) return _feed18(ethUsd, ETH_FEED_MAX_AGE) * 1e10; // 8 decimals -> 18
        if (pay == Pay.USDG) return 1e18;
        uint256 k = _feed18(plankUsd, PLANK_FEED_MAX_AGE);
        if (k == 0 || _longWindow(address(plankUsd), PLANK_WINDOW_MAX)) return 0;
        return k;
    }

    /// @dev True if a TWAP feed's current window (prev -> last) is longer than `max` (or reads backwards).
    function _longWindow(address twap, uint256 max) internal view returns (bool) {
        (bool ok1, bytes memory r1) = twap.staticcall(abi.encodeCall(ILiqTwap.prev, ()));
        (bool ok2, bytes memory r2) = twap.staticcall(abi.encodeCall(ILiqTwap.last, ()));
        if (!ok1 || !ok2 || r1.length < 64 || r2.length < 64) return false;
        (, uint32 t0) = abi.decode(r1, (uint256, uint32));
        (, uint32 t1) = abi.decode(r2, (uint256, uint32));
        return t1 < t0 || t1 - t0 > max;
    }

    /// @dev A feed's answer if fresh, else 0 (never reverts).
    function _feed18(ILiqFeed f, uint256 maxAge) internal view returns (uint256) {
        if (address(f) == address(0)) return 0;
        (bool ok, bytes memory ret) = address(f).staticcall(abi.encodeCall(ILiqFeed.latestRoundData, ()));
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

    function _tokenDecimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || ret.length < 32) return 18;
        return abi.decode(ret, (uint8));
    }

    function _token(Pay pay) internal view returns (address) {
        return pay == Pay.ETH ? WETH : pay == Pay.PLANK ? address(PLANK) : address(USDG);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
