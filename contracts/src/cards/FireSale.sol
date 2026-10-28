// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {FireGroups} from "./FireGroups.sol";

interface ISalePacks {
    function mint(address to, uint256 fire, uint256 amount) external;
}

interface ISaleCards {
    function closeFire(uint256 fire) external;
    function burnFor(address from, uint256[] calldata ids) external;
    function ready(uint256 fire) external view returns (bool);
    function characterCount(uint256 fire) external view returns (uint256);
    function cardsPerPack(uint256 fire) external view returns (uint256);
    function lockForSale(uint256 fire) external;
}

/// @notice Chainlink-style feed. ETH/USD has 8 decimals; PLANK/USD (PlankUsdTwap) has 18.
interface ISaleFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/// @notice PlankUsdTwap's two checkpoints: the reported price is the average between them.
interface ISaleTwap {
    function prev() external view returns (uint256 cum, uint32 ts);
    function last() external view returns (uint256 cum, uint32 ts);
}

/// @notice Uniswap V2 router (Robinhood Chain: 0x89e5DB8B5aA49aA85AC63f691524311AEB649eba).
interface IV2Router {
    function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        payable
        returns (uint256[] memory amounts);
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline)
        external
        returns (uint256[] memory amounts);
    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory amounts);
}

/**
 * @title FireSale
 * @notice Sells the Omni packs (docs/omni-economy.md, docs/drop-groups.md). Every product rule is a per-drop setting the
 *         owner picks before the drop opens (`DropConfig`): the total packs split into 1 to 6 groups (FireGroups: who
 *         can buy each, how many, at what price and PAPER, in which coins, when, where unsold packs go, and its PLANK
 *         and PAPER burn shares), the PAPER dollar ceiling, most packs per purchase, how long only regular wallets can
 *         buy, credits per picked suggestion and caps on free (credit) packs. Nothing about a drop can change once it
 *         opens. What a pack holds is the Series' recipe (FireCards and its dealer), fixed from the first pack minted.
 *
 *         - A purchase names its group (`buy`). The group's dollar price is paid in a coin it accepts (PLANK, ETH or
 *           USDG; or ETH alone with `buyWithEthAll`, which also buys the packs' PAPER on the market), plus the group's
 *           PAPER per pack (sent to LiquidityBurner, never more than the drop's dollar ceiling worth). A group can
 *           have no dollar price (PAPER only) or neither (free holders' claims). Of each dollar payment, the group's
 *           PLANK and PAPER shares and the whole rising tax go to LiquidityBurner in the coin paid (it pairs PAPER
 *           with PLANK and burns the liquidity, docs/liquidity-burn.md); the rest goes to the revenue wallet. No swap
 *           happens at sale time, so a purchase never fails because of a pool.
 *         - The Series closes the moment nothing can still sell (every group that hasn't ended is empty), however
 *           early; `close` does it for anyone when the last packs were left unsold by a group whose time ran out.
 *         - Free pack credits, card burning and character suggestions live in FireCredits (split out for contract
 *           size). It spends credits here through `creditPacks`: packs from the drop's credit group while it is open,
 *           for that group's PAPER alone.
 *
 *         Safety guards stay fixed: settings lock at the drop's start, every purchase names its most PLANK/USDG/ETH and
 *         PAPER, price-feed freshness, one drop at a time, and a stalled drop can always be
 *         ended. The owner can pause buying and credit spending (`setPaused`); ending a drop, closing it and burning
 *         cards never pause. The contract never holds funds between transactions: everything paid is
 *         forwarded in the same transaction, and there is no withdraw function.
 */
contract FireSale is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @dev Most packs in one purchase for a drop that sets 0.
    uint256 public constant DEFAULT_MAX_PER_TX = 50;
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours; // Chainlink ETH/USD: deviation updates + 24h heartbeat
    /// @dev The PLANK price must be recent: its window must have ended within PLANK_FEED_MAX_AGE and be no longer than
    ///      PLANK_WINDOW_MAX (a long window after a keeper gap would hide a recent move). Otherwise PLANK purchases pause
    ///      until the PLANK price is fresh again.
    uint256 public constant PLANK_FEED_MAX_AGE = 2 hours;
    uint256 public constant PLANK_WINDOW_MAX = 2 hours;
    /// @dev Longest the regular-wallets rule may run (each group's delay and duration have the same bound in
    ///      FireGroups), so `endDrop` is always reachable.
    uint256 public constant MAX_WINDOW = 30 days;
    /// @dev A drop that hasn't sold out can be ended by the owner once its schedule is over, and by anyone this long
    ///      after that, so its packs can always be opened even if the owner never acts.
    uint256 public constant END_GRACE = 7 days;
    /// @notice The last good PAPER price (USD per PAPER, 18 decimals) the PAPER feed gave: holds while the feed has no
    ///         price, so a pack never takes more than about its drop's dollar ceiling of PAPER just because a price is
    ///         late. 0 = none yet (no ceiling applies until the feed's first price).
    uint256 public lastPaperUsd;
    uint256 public constant PAPER_FEED_MAX_AGE = 2 days;
    /// @dev Gas the PLANK price refresh (PlankUsdTwap.checkpoint) may use inside a purchase; a failure is ignored.
    uint256 internal constant CHECKPOINT_GAS = 150_000;
    /// @dev The owner can end a drop that hasn't sold out only this long after it opens at the earliest.
    uint256 public constant MIN_DROP_TIME = 1 days;

    IERC20 public immutable PAPER;
    IERC20 public immutable PLANK;
    IERC20 public immutable USDG; // address(0) disables USDG
    uint256 public immutable USDG_UNIT;
    address public immutable WETH;
    ISalePacks public immutable PACKS;
    ISaleCards public immutable CARDS;
    /// @notice FireCredits: free pack credits, card burning and suggestions. The only caller of the credit hooks.
    address public immutable CREDITS;
    /// @notice FireGroups: each drop's groups (config, timing, gates, counts). Only this contract writes to it.
    FireGroups public immutable GROUPS;
    /// @dev The price feeds and the router can be replaced while no drop is set up (a retired Chainlink feed, a new
    ///      PLANK pool or router); never during a drop.
    ISaleFeed public ETH_USD;
    ISaleFeed public PLANK_USD;
    /// @notice PAPER/USD (PaperUsdTwap, 18 decimals), for the PAPER dollar ceilings; none = no ceiling until it's set.
    ISaleFeed public PAPER_USD;
    IV2Router public ROUTER;

    address public revenueWallet;
    /// @notice LiquidityBurner: gets every sale's liquidity share (in the coin paid) and every pack's PAPER, and turns
    ///         them into burned PAPER/PLANK liquidity.
    address public liquidity;
    /// @notice While true, buying, credit spending and paid suggestions stop. Never ending or closing a drop, or
    ///         burning cards.
    bool public paused;

    enum Pay { PLANK, ETH, USDG }

    /// @notice A drop's drop-wide settings and counts (the groups live in FireGroups).
    struct Drop {
        uint64 start;
        uint64 packs; // total packs (the groups' packs add up to it); fewer are made if unsold packs roll nowhere
        uint64 sold; // packs bought (paid and free), all groups
        uint64 creditPacks; // packs minted with credits
        uint32 maxPerTx; // most packs in one purchase or credit spend
        uint32 regularWalletsFor; // only regular wallets (not contracts) can buy until then (seconds after start)
        uint16 creditsPerPick; // credits per picked suggestion
        uint8 creditGroup; // the group credit packs come from (FireGroups.NONE = no credit packs)
        bool closed;
        uint64 creditPacksMax; // most credit packs in this drop in all (0 = no limit)
        uint64 creditPacksPerWallet; // most credit packs per wallet in this drop (0 = no limit)
        uint128 paperCapUsd; // most a pack's PAPER may be worth, 8 decimals (0 = no ceiling)
    }

    mapping(uint256 fire => Drop) internal drops;
    /// @notice Credit packs a wallet minted in a drop.
    mapping(uint256 fire => mapping(address => uint256)) public creditPacksBy;

    /// @notice Drops configured and not yet closed (0 or 1). Wallets and feeds can only change while this is 0.
    uint256 public activeDrops;

    event DropConfigured(uint256 indexed fire, DropConfig config);
    event PacksBought(
        uint256 indexed fire, uint256 indexed group, address indexed buyer, uint256 count, Pay pay, uint256 paid,
        uint256 toLiquidity
    );
    event CreditsUsed(uint256 indexed fire, address indexed buyer, uint256 count);
    event DropClosed(uint256 indexed fire, uint256 packs);
    event WalletsSet(address revenue, address liquidity);
    event FeedsSet(address ethUsd, address plankUsd, address paperUsd, address router);
    event PausedSet(bool paused);

    error BadConfig();
    error DropStarted();
    error NotLive();
    error PriceMoved();
    error FeedUnavailable();
    error BadAmount();
    error NotSoldOut();
    error TransferFailed();
    error ZeroAddress();
    error DropsActive();
    error TooEarly();
    error AnotherDropActive();
    error NoContracts();
    error CreditCapReached();
    error CreditWalletLimit();
    error IsPaused();
    error NotCredits();
    error RenounceDisabled();

    struct Config {
        address owner;
        address paper;
        address plank;
        address usdg;
        address weth;
        address packs;
        address cards;
        address ethUsd;
        address plankUsd;
        address paperUsd; // may be 0 (no PAPER dollar ceiling until set)
        address router;
        address revenueWallet;
        address liquidity; // LiquidityBurner
        address credits; // FireCredits
        address groups; // FireGroups
    }

    constructor(Config memory c) Ownable(c.owner) {
        if (c.paper == address(0) || c.plank == address(0) || c.weth == address(0) || c.packs == address(0)
            || c.cards == address(0) || c.ethUsd == address(0) || c.plankUsd == address(0) || c.router == address(0)
            || c.credits == address(0) || c.groups == address(0)) revert ZeroAddress();
        if (c.router.code.length == 0) revert BadConfig(); // a swap to an address with no code would revert uncaught
        _checkFeeds(c.ethUsd, c.plankUsd, c.paperUsd);
        PAPER = IERC20(c.paper);
        PLANK = IERC20(c.plank);
        USDG = IERC20(c.usdg);
        USDG_UNIT = c.usdg == address(0) ? 0 : 10 ** _decimals(c.usdg);
        WETH = c.weth;
        PACKS = ISalePacks(c.packs);
        CARDS = ISaleCards(c.cards);
        CREDITS = c.credits;
        GROUPS = FireGroups(c.groups);
        ETH_USD = ISaleFeed(c.ethUsd);
        PLANK_USD = ISaleFeed(c.plankUsd);
        PAPER_USD = ISaleFeed(c.paperUsd);
        ROUTER = IV2Router(c.router);
        _setWallets(c.revenueWallet, c.liquidity);
    }

    // ================================================================ owner

    /// @notice Ownership can be handed over (two steps) but never renounced, so control can't be lost by mistake.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Pause or unpause buying (`buy`, `buyWithEthAll`), credit spending and paid suggestions. Opening,
    ///         dealing, transfers, ending and closing drops and burning cards never pause. No expiry.
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Change the revenue wallet and LiquidityBurner. Only while no drop is set up or running,
    ///      so a drop's money always goes where it did when it was announced.
    function setWallets(address revenue, address liquidity_) external onlyOwner {
        if (activeDrops != 0) revert DropsActive();
        _setWallets(revenue, liquidity_);
    }

    /// @notice Replace the price feeds and the router. Only while no drop is set up or running.
    function setFeeds(address ethUsd, address plankUsd, address paperUsd, address router) external onlyOwner {
        if (activeDrops != 0) revert DropsActive();
        if (ethUsd == address(0) || plankUsd == address(0) || router.code.length == 0) revert BadConfig();
        _checkFeeds(ethUsd, plankUsd, paperUsd);
        ETH_USD = ISaleFeed(ethUsd);
        PLANK_USD = ISaleFeed(plankUsd);
        if (paperUsd != address(PAPER_USD)) lastPaperUsd = 0; // a new (or no) PAPER feed starts from its own price
        PAPER_USD = ISaleFeed(paperUsd);
        ROUTER = IV2Router(router);
        emit FeedsSet(ethUsd, plankUsd, paperUsd, router);
    }

    /// @notice What the owner sets per drop. Every number can differ from drop to drop.
    struct DropConfig {
        uint64 start; // when it opens (unix seconds); everything locks then
        uint64 packs; // total packs (167); the groups' packs must add up to it
        uint128 paperCapUsd; // most a pack's PAPER may be worth, 8 decimals ($1 = 100_000_000), at the PAPER feed's
        // price: every group's packs and credit packs alike. 0 = no ceiling
        uint32 maxPerTx; // most packs in one purchase or credit spend; 0 = DEFAULT_MAX_PER_TX (50)
        uint32 regularWalletsFor; // only regular wallets can buy until then (48h); 0 = off; <= 30 days
        uint16 creditsPerPick; // credits per picked suggestion (1); 0 = none
        uint64 creditPacksMax; // most free (credit) packs in this drop in all; 0 = no limit
        uint64 creditPacksPerWallet; // most free (credit) packs per wallet in this drop; 0 = no limit
        uint8 creditGroup; // the group credit packs come from (its packs and timing); 255 = no credit packs
        FireGroups.Group[] groups; // 1 to 6 (docs/drop-groups.md), each with its own PLANK and PAPER burn shares
    }

    /// @notice Set up a drop. Allowed until it opens (`start`); after that nothing about it can change.
    function configureDrop(uint256 fire, DropConfig calldata c) external onlyOwner {
        Drop storage d = drops[fire];
        if (d.start != 0 && block.timestamp >= d.start) revert DropStarted();
        if (fire > type(uint64).max || c.start <= block.timestamp || c.regularWalletsFor > MAX_WINDOW) revert BadConfig();
        // The Series must be set up in the card contract first (its dealer, recipe and characters), or the sale that
        // sells it out couldn't close it.
        if (!CARDS.ready(fire)) revert BadConfig();
        CARDS.lockForSale(fire); // the Series (recipe, characters, odds, art) is fixed from here
        // One drop at a time: the next drop can only be set up once the current one has closed.
        if (d.start == 0) {
            if (activeDrops != 0) revert AnotherDropActive();
            activeDrops = 1;
        }
        GROUPS.configure(fire, c.start, c.packs, c.groups, c.creditGroup); // checks the groups
        d.start = c.start;
        d.packs = c.packs;
        d.paperCapUsd = c.paperCapUsd;
        d.maxPerTx = c.maxPerTx == 0 ? uint32(DEFAULT_MAX_PER_TX) : c.maxPerTx;
        d.regularWalletsFor = c.regularWalletsFor;
        d.creditsPerPick = c.creditsPerPick;
        d.creditPacksMax = c.creditPacksMax;
        d.creditPacksPerWallet = c.creditPacksPerWallet;
        d.creditGroup = c.creditGroup;
        DropConfig memory e = c;
        e.maxPerTx = d.maxPerTx; // what applies (0 means the default)
        emit DropConfigured(fire, e);
    }

    /// @notice End a drop that hasn't sold out. The owner can once its schedule is over (every timed group has run
    ///         its full time and every until-sold group has opened; at least MIN_DROP_TIME after the start); anyone
    ///         can END_GRACE after that, so packs never get stranded. No more packs are sold; the Series closes with
    ///         what was minted.
    function endDrop(uint256 fire) external {
        Drop storage d = drops[fire];
        if (d.start == 0 || d.closed) revert NotLive();
        if (block.timestamp < _endableAt(d, fire) + (msg.sender == owner() ? 0 : END_GRACE)) revert TooEarly();
        _close(fire, d);
    }

    // ================================================================ buying

    /// @notice Buy `n` packs from group `group`, paying its dollar price in `pay` (a coin the group accepts):
    ///         `maxCost` is the most PLANK/USDG the buyer agrees to pay; for ETH send at least the quote and the rest
    ///         comes back. `maxPaper` is the most PAPER (wei) the buyer agrees to pay. `access` shows the buyer may
    ///         buy in a gated group (NFT ids it holds, or its snapshot allowance and proof). A group with no dollar
    ///         price takes only its PAPER (`pay` and `maxCost` are ignored; any ETH sent comes back).
    function buy(uint256 fire, uint256 group, uint256 n, Pay pay, uint256 maxCost, uint256 maxPaper, FireGroups.Access calldata access)
        external
        payable
        nonReentrant
    {
        (Drop storage d, Taken memory t) = _take(fire, group, n, pay, maxPaper, access, false);
        uint256 cost;
        uint256 toLiq;
        if (t.usd8 != 0) (cost, toLiq) = _collect(t, pay, maxCost);
        _finish(fire, d, group, n, pay, cost, toLiq, t.left);
        _refund(pay, cost);
    }

    /// @notice Buy `n` packs from group `group` with ETH alone: the price, and the packs' PAPER too, which this buys
    ///         on the market (the cheaper of ETH -> PAPER and ETH -> PLANK -> PAPER) for LiquidityBurner. Send at least
    ///         `quote(fire, group, n, Pay.ETH)`'s cost plus `quotePaperInEth` of its PAPER; anything above comes back.
    ///         `maxPaperEth`: the most ETH the PAPER may cost (`quotePaperInEth` plus a little slippage); if the market
    ///         wants more, it reverts PriceMoved rather than buying at whatever msg.value covers. One transaction, no
    ///         approval. The group must accept ETH (if it has a dollar price).
    function buyWithEthAll(uint256 fire, uint256 group, uint256 n, uint256 maxPaperEth, FireGroups.Access calldata access)
        external
        payable
        nonReentrant
    {
        (Drop storage d, Taken memory t) = _take(fire, group, n, Pay.ETH, maxPaperEth, access, true);
        uint256 cost;
        uint256 toLiq;
        if (t.usd8 != 0) (cost, toLiq) = _collect(t, Pay.ETH, type(uint256).max);
        _finish(fire, d, group, n, Pay.ETH, cost, toLiq, t.left);
        _sendEth(msg.sender, address(this).balance); // what's left of msg.value (this never holds ETH otherwise)
    }

    /// @notice ETH that buys `paper` PAPER wei on the cheaper route (what buyWithEthAll spends on it). Reverts with no route.
    function quotePaperInEth(uint256 paper) external view returns (uint256 eth) {
        (eth,) = _paperRoute(paper);
    }

    // ================================================================ FireCredits hooks

    /// @notice FireCredits spends `n` of `to`'s free pack credits in a live drop: packs from the drop's credit group
    ///         while it is open (its gate, price, coins and wallet limit, and the regular-wallets rule, don't apply: a
    ///         credit was earned), for the group's PAPER per pack alone (from `to`, who approved this contract). The
    ///         drop can cap credit packs in all (`creditPacksMax`) and per wallet (`creditPacksPerWallet`); 0 = no cap.
    function creditPacks(address to, uint256 fire, uint256 n, uint256 maxPaper) external nonReentrant {
        _onlyCredits();
        Drop storage d = _live(fire);
        if (n == 0 || n > d.maxPerTx) revert BadAmount();
        if (d.creditPacksMax != 0 && uint256(d.creditPacks) + n > d.creditPacksMax) revert CreditCapReached();
        uint256 mine = creditPacksBy[fire][to] + n;
        if (d.creditPacksPerWallet != 0 && mine > d.creditPacksPerWallet) revert CreditWalletLimit();
        (uint256 per, uint256 left) = GROUPS.takeCredit(fire, d.creditGroup, n);
        creditPacksBy[fire][to] = mine;
        d.creditPacks += uint64(n);
        _burnPaper(to, n, per, d.paperCapUsd, maxPaper);
        PACKS.mint(to, fire, n);
        emit CreditsUsed(fire, to, n);
        if (left == 0) _close(fire, d);
    }

    /// @notice FireCredits sends `from`'s PAPER to LiquidityBurner for a suggestion: `per`, at most `capUsd8` worth (0 = no ceiling).
    function burnPaperFor(address from, uint256 per, uint256 capUsd8, uint256 maxPaper) external nonReentrant {
        _onlyCredits();
        _burnPaper(from, 1, per, capUsd8, maxPaper);
    }

    /// @notice FireCredits burns `from`'s cards (FireCards takes burns from the seller only). Never paused.
    function burnCardsFor(address from, uint256[] calldata ids) external {
        if (msg.sender != CREDITS) revert NotCredits();
        CARDS.burnFor(from, ids);
    }

    /// @notice Anyone can close a drop once nothing can still sell (normally the last purchase does it; this is for
    ///         when a group's time ran out with its leftovers rolling nowhere).
    function close(uint256 fire) external {
        Drop storage d = drops[fire];
        if (d.start == 0 || d.closed || block.timestamp < d.start || GROUPS.remaining(fire) != 0) revert NotSoldOut();
        _close(fire, d);
    }

    // ================================================================ views

    /// @notice A drop's drop-wide state for the site (each group's own state: FireGroups.groupsOf).
    struct Status {
        bool configured;
        bool live; // open and not closed
        bool closed;
        bool paused; // the owner paused buying and credits
        bool plankPriceOk; // the PLANK price is fresh: PLANK payments work
        bool regularWalletsOnly; // contracts can't buy right now
        uint256 left; // packs that can still sell, all groups (0 once closed)
        uint256 endableAt; // when the owner can end the drop if it hasn't sold out (anyone END_GRACE later)
        uint256 creditPacksLeft; // credit packs that can be minted right now (credit group open, caps)
    }

    function status(uint256 fire) external view returns (Status memory p) {
        Drop storage d = drops[fire];
        uint256 s = d.start;
        p.configured = s != 0;
        p.closed = d.closed;
        p.live = p.configured && block.timestamp >= s && !d.closed;
        p.paused = paused;
        p.plankPriceOk = _plankUsd() != 0;
        p.regularWalletsOnly = p.live && block.timestamp < s + d.regularWalletsFor;
        if (!p.configured) return p;
        p.endableAt = _endableAt(d, fire);
        if (d.closed) return p;
        p.left = GROUPS.remaining(fire);
        if (d.creditGroup == 255) return p; // FireGroups.NONE: no credit packs
        p.creditPacksLeft = GROUPS.openLeft(fire, d.creditGroup);
        if (d.creditPacksMax != 0) {
            uint256 cap = d.creditPacksMax > d.creditPacks ? d.creditPacksMax - d.creditPacks : 0;
            if (cap < p.creditPacksLeft) p.creditPacksLeft = cap;
        }
    }

    function dropOf(uint256 fire) external view returns (Drop memory) { return drops[fire]; }

    /// @notice `n` packs from group `group` right now: the dollar price in `pay` (0 if the group has none; a rising
    ///         tax included) and the PAPER.
    function quote(uint256 fire, uint256 group, uint256 n, Pay pay) external view returns (uint256 cost, uint256 paper) {
        paper = n * _perPaper(GROUPS.groupOf(fire, group).paper, drops[fire].paperCapUsd, _paperUsd());
        (uint256 usd8,) = GROUPS.priceOf(fire, group, n);
        if (usd8 == 0) return (0, paper);
        cost = pay == Pay.PLANK ? _plankFor(usd8) : pay == Pay.ETH ? _ethFor(usd8) : _usdgFor(usd8);
    }

    /// @notice PAPER (wei) `n` packs from group `group` burn right now (its PAPER per pack, under the drop's ceiling).
    function paperFor(uint256 fire, uint256 group, uint256 n) external view returns (uint256) {
        return n * _perPaper(GROUPS.groupOf(fire, group).paper, drops[fire].paperCapUsd, _paperUsd());
    }

    // ================================================================ internals

    function _notPaused() internal view {
        if (paused) revert IsPaused();
    }

    function _onlyCredits() internal view {
        if (msg.sender != CREDITS) revert NotCredits();
        _notPaused();
    }

    function _live(uint256 fire) internal view returns (Drop storage d) {
        d = drops[fire];
        if (d.start == 0 || block.timestamp < d.start || d.closed) revert NotLive();
    }

    /// @dev When the owner can end a drop: its schedule over, and at least MIN_DROP_TIME after the start.
    function _endableAt(Drop storage d, uint256 fire) internal view returns (uint256 over) {
        over = GROUPS.scheduleEnd(fire);
        uint256 min = uint256(d.start) + MIN_DROP_TIME;
        if (over < min) over = min;
    }

    /// @dev What a purchase took from its group: the dollar total (8 decimals, the group's rising tax included:
    ///      `tax8` of it), what can still sell after these packs, and the group's burn shares (basis points).
    struct Taken {
        uint256 usd8;
        uint256 tax8;
        uint256 left;
        uint256 plankBps;
        uint256 paperBps;
    }

    /// @dev Checks shared by every purchase, takes the packs from the group (FireGroups checks it's open, has them,
    ///      takes this coin and lets the buyer in), then takes the PAPER (`max`: as _burnPaper).
    function _take(uint256 fire, uint256 group, uint256 n, Pay pay, uint256 max, FireGroups.Access calldata access, bool buyPaper)
        internal
        returns (Drop storage d, Taken memory t)
    {
        _notPaused();
        d = _live(fire);
        if (n == 0 || n > d.maxPerTx) revert BadAmount();
        // While this is on, only regular wallets (MetaMask, Rabby, OKX...) can buy: a bot contract can't spin up
        // throwaway wallets to sweep a drop in one transaction.
        if (block.timestamp - d.start < d.regularWalletsFor && msg.sender != tx.origin) revert NoContracts();
        uint256 per;
        (t.usd8, t.tax8, per, t.left, t.plankBps, t.paperBps) =
            GROUPS.take(fire, group, msg.sender, n, uint8(1 << uint8(pay)), access);
        d.sold += uint64(n);
        _burnPaper(buyPaper ? address(this) : msg.sender, n, per, d.paperCapUsd, max);
    }

    /// @dev Takes a dollar amount `t.usd8` (of which `t.tax8` is a group's rising tax) in `pay` and sends it on in
    ///      this transaction: the group's PLANK and PAPER shares of the base price and the whole tax go to
    ///      LiquidityBurner (`toLiq`), the rest to the revenue wallet. Exactly `cost` is taken from the buyer, whatever
    ///      the shares. ETH comes from msg.value (the caller refunds the rest). First it refreshes the PLANK price
    ///      (PlankUsdTwap.checkpoint: a cheap no-op when not due; a failure is ignored), so buyers don't depend on the
    ///      keeper for a fresh price.
    function _collect(Taken memory t, Pay pay, uint256 maxCost) internal returns (uint256 cost, uint256 toLiq) {
        (bool poked,) = address(PLANK_USD).call{gas: CHECKPOINT_GAS}(abi.encodeWithSignature("checkpoint()"));
        poked; // a feed without checkpoint(), or one that fails, just keeps its price
        uint256 usd8 = t.usd8;
        if (pay == Pay.USDG && address(USDG) == address(0)) revert BadConfig();
        cost = pay == Pay.PLANK ? _plankFor(usd8) : pay == Pay.ETH ? _ethFor(usd8) : _usdgFor(usd8);
        // ETH: what's left of msg.value (buyWithEthAll has already bought the packs' PAPER with part of it)
        if (cost > maxCost || (pay == Pay.ETH && address(this).balance < cost)) revert PriceMoved();
        // the base price splits by the group's shares (FireGroups keeps them at most 100% together); the tax is all
        // liquidity, so the two parts are exactly `cost`
        uint256 tax = cost * t.tax8 / usd8;
        toLiq = (cost - tax) * (t.plankBps + t.paperBps) / BPS + tax;
        uint256 rest = cost - toLiq;
        if (pay == Pay.ETH) {
            _sendEth(liquidity, toLiq);
            _sendEth(revenueWallet, rest);
        } else {
            IERC20 coin = pay == Pay.PLANK ? PLANK : USDG;
            if (toLiq > 0) coin.safeTransferFrom(msg.sender, liquidity, toLiq);
            if (rest > 0) coin.safeTransferFrom(msg.sender, revenueWallet, rest);
        }
    }

    /// @dev Sends back any ETH not spent (all of it unless `pay` was ETH).
    function _refund(Pay pay, uint256 cost) internal {
        uint256 spent = pay == Pay.ETH ? cost : 0;
        if (msg.value > spent) _sendEth(msg.sender, msg.value - spent);
    }

    function _finish(
        uint256 fire, Drop storage d, uint256 group, uint256 n, Pay pay, uint256 paid, uint256 toLiq, uint256 left
    ) internal {
        PACKS.mint(msg.sender, fire, n);
        emit PacksBought(fire, group, msg.sender, n, pay, paid, toLiq);
        if (left == 0) _close(fire, d); // nothing can still sell: the Series closes now
    }

    /// @dev USD per PAPER (18 decimals) from the PAPER feed if fresh, else the last good one (0 = none yet).
    function _paperUsd() internal view returns (uint256) {
        (int256 px, uint256 at) = _feed(PAPER_USD);
        if (px <= 0 || at > block.timestamp || block.timestamp - at > PAPER_FEED_MAX_AGE) return lastPaperUsd;
        return uint256(px);
    }

    /// @dev PAPER per pack: `per`, but never more than `capUsd8` dollars worth at `px` (at least 1 wei). No ceiling
    ///      (`capUsd8` 0) or no price yet: `per`.
    function _perPaper(uint256 per, uint256 capUsd8, uint256 px) internal pure returns (uint256) {
        if (capUsd8 == 0 || px == 0) return per;
        uint256 cap = capUsd8 * 1e28 / px; // dollars (8 decimals) -> 18 decimals, then PAPER wei at px
        if (cap == 0) cap = 1;
        return cap < per ? cap : per;
    }

    /// @dev Sends `n` packs' PAPER to LiquidityBurner: from `from` (at most `max` PAPER), or, `from` being this
    ///      contract (buyWithEthAll), bought on the market with the buyer's ETH for at most `max` ETH.
    function _burnPaper(address from, uint256 n, uint256 per, uint256 capUsd8, uint256 max) internal {
        if (per == 0) return;
        uint256 px = _paperUsd();
        if (px != lastPaperUsd && px != 0) lastPaperUsd = px; // a fresh price: remember it for when the feed is late
        uint256 paper = n * _perPaper(per, capUsd8, px);
        if (from != address(this)) {
            if (paper > max) revert PriceMoved();
            return PAPER.safeTransferFrom(from, liquidity, paper);
        }
        // buyWithEthAll: buy the PAPER with the buyer's ETH for LiquidityBurner (a real market buy)
        (uint256 eth, address[] memory path) = _paperRoute(paper);
        if (eth > max) revert PriceMoved();
        ROUTER.swapExactETHForTokens{value: eth}(paper, path, liquidity, block.timestamp);
    }

    /// @dev The cheaper way to buy `paper` PAPER wei with ETH: straight, or through PLANK (where PAPER mostly trades).
    function _paperRoute(uint256 paper) internal view returns (uint256 eth, address[] memory path) {
        address[] memory a = new address[](2);
        (a[0], a[1]) = (WETH, address(PAPER));
        address[] memory b = new address[](3);
        (b[0], b[1], b[2]) = (WETH, address(PLANK), address(PAPER));
        uint256 ea = _ethIn(paper, a);
        uint256 eb = _ethIn(paper, b);
        (eth, path) = eb < ea ? (eb, b) : (ea, a);
        if (eth == type(uint256).max) revert FeedUnavailable(); // no pool to buy PAPER from
    }

    function _ethIn(uint256 out, address[] memory path) internal view returns (uint256) {
        try ROUTER.getAmountsIn(out, path) returns (uint256[] memory amounts) {
            return amounts[0];
        } catch {
            return type(uint256).max;
        }
    }

    function _close(uint256 fire, Drop storage d) internal {
        if (d.closed) revert NotLive();
        d.closed = true;
        activeDrops -= 1;
        CARDS.closeFire(fire);
        emit DropClosed(fire, uint256(d.sold) + d.creditPacks);
    }

    // ---------- prices ----------

    function _ethUsd() internal view returns (uint256) {
        (int256 px, uint256 at) = _feed(ETH_USD);
        if (px <= 0 || at > block.timestamp || block.timestamp - at > ETH_FEED_MAX_AGE) revert FeedUnavailable();
        return uint256(px);
    }

    /// @dev USD per PLANK, 18 decimals; 0 if the average is missing, stale, or spans too long a window.
    function _plankUsd() internal view returns (uint256) {
        (int256 px, uint256 at) = _feed(PLANK_USD);
        if (px <= 0 || at > block.timestamp || block.timestamp - at > PLANK_FEED_MAX_AGE) return 0;
        (bool ok1, bytes memory r1) = address(PLANK_USD).staticcall(abi.encodeCall(ISaleTwap.prev, ()));
        (bool ok2, bytes memory r2) = address(PLANK_USD).staticcall(abi.encodeCall(ISaleTwap.last, ()));
        if (ok1 && ok2 && r1.length >= 64 && r2.length >= 64) {
            (, uint32 t0) = abi.decode(r1, (uint256, uint32));
            (, uint32 t1) = abi.decode(r2, (uint256, uint32));
            if (t1 < t0 || t1 - t0 > PLANK_WINDOW_MAX) return 0;
        }
        return uint256(px);
    }

    function _plankFor(uint256 usd8) internal view returns (uint256) {
        uint256 px = _plankUsd();
        if (px == 0) revert FeedUnavailable();
        return (usd8 * 1e28 + px - 1) / px; // rounded up
    }

    function _ethFor(uint256 usd8) internal view returns (uint256) {
        uint256 px = _ethUsd();
        return (usd8 * 1e18 + px - 1) / px; // rounded up: never under the price
    }

    function _usdgFor(uint256 usd8) internal view returns (uint256) {
        return (usd8 * USDG_UNIT + 1e8 - 1) / 1e8;
    }

    /// @dev A feed read that never reverts (no code, a revert, or a garbled answer all read as 0).
    function _feed(ISaleFeed f) internal view returns (int256 px, uint256 at) {
        (bool ok, bytes memory ret) = address(f).staticcall(abi.encodeCall(ISaleFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) return (0, 0);
        (, px,, at,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
    }

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @dev The revenue wallet and LiquidityBurner must differ, so the owner's money can never land in the burner.
    function _setWallets(address revenue, address liquidity_) internal {
        if (revenue == address(0) || liquidity_ == address(0)) revert ZeroAddress();
        if (revenue == liquidity_) revert ZeroAddress();
        revenueWallet = revenue;
        liquidity = liquidity_;
        emit WalletsSet(revenue, liquidity_);
    }

    /// @dev The prices assume ETH/USD has 8 decimals and PLANK/USD and PAPER/USD (the TWAPs) 18: a wrong feed would
    ///      misprice packs by up to 1e10, so refuse it.
    function _checkFeeds(address ethUsd, address plankUsd, address paperUsd) private view {
        if (_decimals(ethUsd) != 8 || _decimals(plankUsd) != 18) revert BadConfig();
        if (paperUsd != address(0) && _decimals(paperUsd) != 18) revert BadConfig(); // PaperUsdTwap
    }

    function _decimals(address token) private view returns (uint8) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || ret.length < 32) revert BadConfig();
        return abi.decode(ret, (uint8));
    }
}
