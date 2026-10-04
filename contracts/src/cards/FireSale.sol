// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

interface ISalePacks {
    function mint(address to, uint256 fire, uint256 amount) external;
}

interface ISaleCards {
    function closeFire(uint256 fire) external;
    function burnFor(address from, uint256[] calldata ids) external;
    function fires(uint256 fire)
        external
        view
        returns (bool closed, bool locked, uint8 characterCount, uint32, uint32, uint32, uint32, uint32, uint32, uint32);
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
}

/**
 * @title FireSale
 * @notice Sells the Omni packs (docs/omni-economy.md). The owner sets up each drop before it opens: pack count, price,
 *         PAPER per pack, PLANK burn share, PLANK-only packs, starter packs and window, wallet limit and when it
 *         lifts. Nothing about a drop can change once it opens.
 *
 *         - Every pack takes PAPER (the minter needs paper). It is burned.
 *         - Paid packs cost a dollar price in PLANK, ETH or USDG, never PAPER. The first packs are PLANK-only.
 *           Of each sale, the burn share buys PLANK and burns it (PLANK payments burn directly); the rest goes to the
 *           revenue wallet. If the PLANK swap can't go through, the burn share goes to the burn wallet instead, so a
 *           purchase never fails because of PLANK.
 *         - Starter packs: press holders, 1 per wallet, each press once per drop, only PAPER. Leftovers join the
 *           paid supply when the starter window ends.
 *         - Free pack credits: earned by burning 42 cards (a running count per wallet) or by having a character
 *           suggestion picked. They stack and are spent in any live drop for the PAPER alone.
 *
 *         The contract never holds funds between transactions: everything paid is burned or forwarded in the same
 *         transaction, and there is no withdraw function.
 */
contract FireSale is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BPS = 10_000;
    /// @dev Cards burned per free pack credit. Shown on the site as "42.0".
    uint256 public constant CARDS_PER_CREDIT = 42;
    /// @dev The PLANK swap must get at least this share of what the 30-minute average price says, or it's skipped
    ///      (the burn share then goes to the burn wallet). Guards against a pumped or manipulated pool.
    uint256 public constant SWAP_MIN_BPS = 9_000;
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours; // Chainlink ETH/USD: deviation updates + 24h heartbeat
    /// @dev The PLANK price must be recent: its window must have ended within PLANK_FEED_MAX_AGE and be no longer than
    ///      PLANK_WINDOW_MAX (a long window after a keeper gap would hide a recent move). Otherwise PLANK purchases pause
    ///      and the burn share of ETH/USDG sales goes to the burn wallet until the keeper checkpoints again.
    uint256 public constant PLANK_FEED_MAX_AGE = 2 hours;
    uint256 public constant PLANK_WINDOW_MAX = 2 hours;
    uint256 public constant MAX_WINDOW = 30 days; // longest starter window / wallet-limit period
    uint256 public constant MAX_PER_TX = 50;

    IERC20 public immutable PAPER;
    IERC20 public immutable PLANK;
    IERC20 public immutable USDG; // address(0) disables USDG
    uint256 public immutable USDG_UNIT;
    address public immutable WETH;
    IERC721 public immutable PRESS;
    ISalePacks public immutable PACKS;
    ISaleCards public immutable CARDS;
    ISaleFeed public immutable ETH_USD;
    ISaleFeed public immutable PLANK_USD;
    IV2Router public immutable ROUTER;
    /// @notice PAPER burned per character suggestion.
    uint256 public immutable PAPER_PER_SUGGESTION;

    address public revenueWallet;
    address public burnWallet;

    enum Pay { PLANK, ETH, USDG }

    struct Drop {
        // set by the owner before the drop opens
        uint64 start;
        uint32 packs; // paid packs (starters come on top)
        uint32 starters;
        uint32 plankOnly; // the first this-many paid packs are PLANK-only
        uint32 walletLimit; // paid packs per wallet until liftAfter
        uint32 starterWindow; // seconds
        uint32 liftAfter; // seconds after start when the wallet limit lifts
        uint16 plankBurnBps;
        uint128 priceUsd; // per pack, 8 decimals ($2.50 = 250_000_000)
        uint128 paperPerPack; // PAPER wei
        // running
        uint32 paidSold; // paid packs sold (all currencies)
        uint32 startersClaimed;
        uint32 creditPacks; // packs minted with credits
        bool closed;
    }

    mapping(uint256 fire => Drop) internal drops;
    mapping(uint256 fire => mapping(address => uint256)) public paidBought;
    mapping(uint256 fire => mapping(address => bool)) public starterClaimedBy;
    mapping(uint256 fire => mapping(uint256 pressId => bool)) public pressUsed;

    /// @notice Free pack credits from burning cards: usable in any drop.
    mapping(address => uint256) public credits;
    /// @notice Free pack credits from a picked suggestion: usable in that Fire's drop.
    mapping(uint256 fire => mapping(address => uint256)) public pickCredits;
    mapping(uint256 fire => uint256) public picksOf;
    /// @notice Drops configured and not yet closed. Wallets can only change while this is 0.
    uint256 public activeDrops;
    mapping(address => uint256) public burnCount; // cards burned toward the next credit (0..41)

    struct Suggestion { address by; uint64 at; bool granted; uint32 round; }
    Suggestion[] public suggestions;
    /// @notice The list new suggestions join. A picking session takes everything in the current list and starts a new
    ///         one, so the list clears after every session and unpicked suggestions don't carry over.
    uint32 public currentRound;
    /// @notice The Fire being picked for, and the list it picks from.
    uint256 public sessionFire;
    uint32 public sessionRound;

    event DropConfigured(uint256 indexed fire, DropConfig config);
    event PacksBought(uint256 indexed fire, address indexed buyer, uint256 count, Pay pay, uint256 paid, uint256 burnShare, bool plankBurned);
    event StarterClaimed(uint256 indexed fire, address indexed buyer, uint256 indexed pressId);
    event CreditsUsed(uint256 indexed fire, address indexed buyer, uint256 count);
    event CardsBurned(address indexed holder, uint256 count, uint256 creditsEarned, uint256 burnCount);
    event Suggested(uint256 indexed id, address indexed by, uint32 indexed round, string text);
    event PickingSession(uint256 indexed fire, uint32 round);
    event SuggestionPicked(uint256 indexed fire, uint256 indexed id, address indexed by);
    event DropClosed(uint256 indexed fire, uint256 packs);
    event WalletsSet(address revenue, address burn);

    error BadConfig();
    error DropStarted();
    error NotLive();
    error SoldOut();
    error PlankOnly();
    error WalletLimit();
    error PriceMoved();
    error FeedUnavailable();
    error NotPressOwner();
    error AlreadyClaimed();
    error PressUsed();
    error StarterWindowClosed();
    error NoCredits();
    error BadAmount();
    error NotSoldOut();
    error TransferFailed();
    error ZeroAddress();
    error DropsActive();
    error TooEarly();
    error NotThisRound();

    struct Config {
        address owner;
        address paper;
        address plank;
        address usdg;
        address weth;
        address press;
        address packs;
        address cards;
        address ethUsd;
        address plankUsd;
        address router;
        address revenueWallet;
        address burnWallet;
        uint256 paperPerSuggestion;
    }

    constructor(Config memory c) Ownable(c.owner) {
        if (c.paper == address(0) || c.plank == address(0) || c.weth == address(0) || c.press == address(0)
            || c.packs == address(0) || c.cards == address(0) || c.ethUsd == address(0) || c.plankUsd == address(0)
            || c.router == address(0)) revert ZeroAddress();
        if (c.router.code.length == 0) revert BadConfig(); // a swap to an address with no code would revert uncaught
        PAPER = IERC20(c.paper);
        PLANK = IERC20(c.plank);
        USDG = IERC20(c.usdg);
        USDG_UNIT = c.usdg == address(0) ? 0 : 10 ** _decimals(c.usdg);
        WETH = c.weth;
        PRESS = IERC721(c.press);
        PACKS = ISalePacks(c.packs);
        CARDS = ISaleCards(c.cards);
        ETH_USD = ISaleFeed(c.ethUsd);
        PLANK_USD = ISaleFeed(c.plankUsd);
        ROUTER = IV2Router(c.router);
        PAPER_PER_SUGGESTION = c.paperPerSuggestion;
        _setWallets(c.revenueWallet, c.burnWallet);
    }

    // ================================================================ owner

    /// @notice Change the revenue and burn wallets. Only while no drop is set up or running, so a drop's money always
    ///      goes where it did when it was announced.
    function setWallets(address revenue, address burn) external onlyOwner {
        if (activeDrops != 0) revert DropsActive();
        _setWallets(revenue, burn);
    }

    /// @notice What the owner sets per drop. Every number can differ from drop to drop.
    struct DropConfig {
        uint64 start; // when it opens (unix seconds); everything locks then
        uint32 packs; // paid packs (167)
        uint32 starters; // press-holder starter packs on top (50)
        uint32 plankOnly; // first paid packs that only PLANK can buy (50)
        uint32 walletLimit; // paid packs per wallet (5)
        uint32 starterWindow; // seconds the starter claim is open (24h); leftovers then join the paid supply
        uint32 liftAfter; // seconds after start when the wallet limit lifts (48h)
        uint16 plankBurnBps; // share of each sale that burns PLANK (3000 = 30%)
        uint128 priceUsd; // per pack, 8 decimals ($2.50 = 250_000_000)
        uint128 paperPerPack; // PAPER wei per pack (1e18)
    }

    /// @notice Set up a drop. Allowed until it opens (`start`); after that nothing about it can change.
    function configureDrop(uint256 fire, DropConfig calldata c) external onlyOwner {
        Drop storage d = drops[fire];
        if (d.start != 0 && block.timestamp >= d.start) revert DropStarted();
        if (fire > type(uint32).max || c.start <= block.timestamp || c.packs == 0 || c.plankOnly > c.packs
            || c.walletLimit == 0 || c.plankBurnBps > BPS || c.priceUsd == 0 || c.paperPerPack == 0) revert BadConfig();
        // the wallet limit (and the PLANK-only safety valve) needs a real period, the starter window fits inside it
        if (c.liftAfter == 0 || c.liftAfter > MAX_WINDOW || c.starterWindow > c.liftAfter
            || (c.starters > 0 && c.starterWindow == 0)) revert BadConfig();
        // The Fire's characters must be set in the card contract first, or the sale that sells it out couldn't close it.
        (bool closed,, uint8 characters,,,,,,,) = CARDS.fires(fire);
        if (closed || characters == 0) revert BadConfig();
        if (d.start == 0) activeDrops += 1;
        d.start = c.start;
        d.packs = c.packs;
        d.starters = c.starters;
        d.plankOnly = c.plankOnly;
        d.walletLimit = c.walletLimit;
        d.starterWindow = c.starterWindow;
        d.liftAfter = c.liftAfter;
        d.plankBurnBps = c.plankBurnBps;
        d.priceUsd = c.priceUsd;
        d.paperPerPack = c.paperPerPack;
        emit DropConfigured(fire, c);
    }

    /// @notice Give a free pack credit to each picked suggestion's author, for this Fire's drop. Only while setting up
    ///         the drop (before it opens), each suggestion once, and no more picks than the Fire has characters. The
    ///         credit can only be used in this Fire's drop, so picks can't be used to take packs from another drop.
    function pickSuggestions(uint256 fire, uint256[] calldata ids) external onlyOwner {
        Drop storage d = drops[fire];
        if (d.start == 0) revert BadConfig();
        if (block.timestamp >= d.start) revert DropStarted();
        (,, uint8 characters,,,,,,,) = CARDS.fires(fire);
        if (picksOf[fire] + ids.length > characters) revert BadAmount();
        picksOf[fire] += ids.length;
        // The first pick for a new Fire starts a session: it picks from the current list, and new suggestions from
        // now on go into a fresh list for the next session. Unpicked ones from older lists can't be picked again.
        if (sessionFire != fire || currentRound == 0) {
            sessionFire = fire;
            sessionRound = currentRound;
            currentRound += 1;
            emit PickingSession(fire, sessionRound);
        }
        for (uint256 i; i < ids.length; i++) {
            Suggestion storage s = suggestions[ids[i]];
            if (s.round != sessionRound) revert NotThisRound();
            if (s.granted) revert AlreadyClaimed();
            s.granted = true;
            pickCredits[fire][s.by] += 1;
            emit SuggestionPicked(fire, ids[i], s.by);
        }
    }

    /// @notice End a drop that hasn't sold out, once its wallet limit has lifted (so the starter window and the
    ///         limited phase always run in full). No more packs are sold; the Fire closes with what was minted.
    function endDrop(uint256 fire) external onlyOwner {
        Drop storage d = drops[fire];
        if (d.start == 0 || d.closed) revert NotLive();
        if (block.timestamp < uint256(d.start) + d.liftAfter) revert TooEarly();
        _close(fire, d);
    }

    // ================================================================ buying

    /// @notice Buy `n` packs, paying the price in PLANK. `maxPlank` is the most PLANK the buyer agrees to pay.
    function buyWithPlank(uint256 fire, uint256 n, uint256 maxPlank) external nonReentrant {
        Drop storage d = _takePaid(fire, n, Pay.PLANK);
        uint256 cost = _plankFor(n * d.priceUsd);
        if (cost > maxPlank) revert PriceMoved();
        uint256 burnShare = cost * d.plankBurnBps / BPS;
        if (burnShare > 0) PLANK.safeTransferFrom(msg.sender, DEAD, burnShare);
        PLANK.safeTransferFrom(msg.sender, revenueWallet, cost - burnShare);
        _finish(fire, d, n, Pay.PLANK, cost, burnShare, true);
    }

    /// @notice Buy `n` packs, paying the price in ETH. Send at least `quoteEth(fire, n)`; anything above comes back.
    function buyWithEth(uint256 fire, uint256 n) external payable nonReentrant {
        Drop storage d = _takePaid(fire, n, Pay.ETH);
        uint256 usd = n * d.priceUsd;
        uint256 cost = _ethFor(usd);
        if (msg.value < cost) revert PriceMoved();
        uint256 burnShare = cost * d.plankBurnBps / BPS;
        bool burned = burnShare > 0 && _swapEthToPlank(burnShare, usd * d.plankBurnBps / BPS);
        if (burnShare > 0 && !burned) _sendEth(burnWallet, burnShare);
        _sendEth(revenueWallet, cost - burnShare);
        _finish(fire, d, n, Pay.ETH, cost, burnShare, burned);
        if (msg.value > cost) _sendEth(msg.sender, msg.value - cost);
    }

    /// @notice Buy `n` packs, paying the price in USDG (face value). `maxUsdg` is the most USDG the buyer agrees to pay.
    function buyWithUsdg(uint256 fire, uint256 n, uint256 maxUsdg) external nonReentrant {
        if (address(USDG) == address(0)) revert BadConfig();
        Drop storage d = _takePaid(fire, n, Pay.USDG);
        uint256 usd = n * d.priceUsd;
        uint256 cost = _usdgFor(usd);
        if (cost > maxUsdg) revert PriceMoved();
        uint256 burnShare = cost * d.plankBurnBps / BPS;
        USDG.safeTransferFrom(msg.sender, revenueWallet, cost - burnShare);
        bool burned;
        if (burnShare > 0) {
            USDG.safeTransferFrom(msg.sender, address(this), burnShare);
            burned = _swapUsdgToPlank(burnShare, usd * d.plankBurnBps / BPS);
            if (!burned) USDG.safeTransfer(burnWallet, burnShare);
        }
        _finish(fire, d, n, Pay.USDG, cost, burnShare, burned);
    }

    /// @notice A press holder's starter pack: the PAPER alone. 1 per wallet, each press once per drop, during the
    ///         starter window.
    function claimStarter(uint256 fire, uint256 pressId) external nonReentrant {
        Drop storage d = _live(fire);
        if (block.timestamp >= uint256(d.start) + d.starterWindow) revert StarterWindowClosed();
        if (d.startersClaimed >= d.starters) revert SoldOut();
        if (PRESS.ownerOf(pressId) != msg.sender) revert NotPressOwner();
        if (starterClaimedBy[fire][msg.sender]) revert AlreadyClaimed();
        if (pressUsed[fire][pressId]) revert PressUsed();
        starterClaimedBy[fire][msg.sender] = true;
        pressUsed[fire][pressId] = true;
        d.startersClaimed += 1;
        _burnPaper(d, 1);
        PACKS.mint(msg.sender, fire, 1);
        emit StarterClaimed(fire, msg.sender, pressId);
        _closeIfSoldOut(fire, d);
    }

    /// @notice Spend `n` free pack credits in a live drop: the PAPER alone. Packs come out of the paid supply.
    ///         Credits from a suggestion picked for this Fire are used first, then credits from burning cards.
    function useCredits(uint256 fire, uint256 n) external nonReentrant {
        if (n == 0 || n > MAX_PER_TX) revert BadAmount();
        uint256 picked = pickCredits[fire][msg.sender];
        if (picked + credits[msg.sender] < n) revert NoCredits();
        Drop storage d = _live(fire);
        if (n > _paidLeft(d)) revert SoldOut();
        uint256 fromPicked = picked < n ? picked : n;
        if (fromPicked > 0) pickCredits[fire][msg.sender] = picked - fromPicked;
        if (n > fromPicked) credits[msg.sender] -= n - fromPicked;
        d.creditPacks += uint32(n);
        _burnPaper(d, n);
        PACKS.mint(msg.sender, fire, n);
        emit CreditsUsed(fire, msg.sender, n);
        _closeIfSoldOut(fire, d);
    }

    // ================================================================ cards and suggestions

    /// @notice Burn your cards. Every 42 burned earns a free pack credit; extras count toward the next one.
    function burnCards(uint256[] calldata ids) external nonReentrant {
        if (ids.length == 0) revert BadAmount();
        CARDS.burnFor(msg.sender, ids);
        uint256 total = burnCount[msg.sender] + ids.length;
        uint256 earned = total / CARDS_PER_CREDIT;
        burnCount[msg.sender] = total % CARDS_PER_CREDIT;
        if (earned > 0) credits[msg.sender] += earned;
        emit CardsBurned(msg.sender, ids.length, earned, total % CARDS_PER_CREDIT);
    }

    /// @notice Suggest a character for a future Fire. The PAPER is burned.
    function suggest(string calldata text) external returns (uint256 id) {
        uint256 len = bytes(text).length;
        if (len == 0 || len > 280) revert BadAmount();
        PAPER.safeTransferFrom(msg.sender, DEAD, PAPER_PER_SUGGESTION);
        id = suggestions.length;
        suggestions.push(Suggestion(msg.sender, uint64(block.timestamp), false, currentRound));
        emit Suggested(id, msg.sender, currentRound, text);
    }

    /// @notice Anyone can close a sold-out drop (normally the last purchase does it).
    function close(uint256 fire) external {
        Drop storage d = drops[fire];
        if (d.start == 0 || d.closed || _left(d) != 0) revert NotSoldOut();
        _close(fire, d);
    }

    // ================================================================ views

    /// @notice Credits this wallet can spend in `fire`'s drop (picked-for-this-Fire plus burn credits).
    function creditsFor(uint256 fire, address who) external view returns (uint256) {
        return pickCredits[fire][who] + credits[who];
    }

    function phase(uint256 fire) external view returns (bool live, bool plankOnly, bool limitLifted, bool startersOpen, uint256 paidLeft, uint256 startersLeft) {
        Drop storage d = drops[fire];
        live = d.start != 0 && block.timestamp >= d.start && !d.closed;
        plankOnly = d.paidSold < d.plankOnly;
        limitLifted = block.timestamp >= uint256(d.start) + d.liftAfter;
        startersOpen = live && block.timestamp < uint256(d.start) + d.starterWindow && d.startersClaimed < d.starters;
        paidLeft = _paidLeft(d);
        startersLeft = startersOpen ? d.starters - d.startersClaimed : 0;
    }

    function dropOf(uint256 fire) external view returns (Drop memory) { return drops[fire]; }
    function quotePlank(uint256 fire, uint256 n) external view returns (uint256) { return _plankFor(n * drops[fire].priceUsd); }
    function quoteEth(uint256 fire, uint256 n) external view returns (uint256) { return _ethFor(n * drops[fire].priceUsd); }
    function quoteUsdg(uint256 fire, uint256 n) external view returns (uint256) { return _usdgFor(n * drops[fire].priceUsd); }
    function paperFor(uint256 fire, uint256 n) external view returns (uint256) { return n * drops[fire].paperPerPack; }
    function suggestionCount() external view returns (uint256) { return suggestions.length; }

    // ================================================================ internals

    function _live(uint256 fire) internal view returns (Drop storage d) {
        d = drops[fire];
        if (d.start == 0 || block.timestamp < d.start || d.closed) revert NotLive();
    }

    /// @dev Paid packs still for sale: the paid supply, plus starters nobody claimed once the window has ended.
    function _paidLeft(Drop storage d) internal view returns (uint256) {
        uint256 supply = d.packs;
        if (block.timestamp >= uint256(d.start) + d.starterWindow) supply += d.starters - d.startersClaimed;
        uint256 used = uint256(d.paidSold) + d.creditPacks;
        return supply > used ? supply - used : 0;
    }

    /// @dev Everything not yet minted, starters included.
    function _left(Drop storage d) internal view returns (uint256) {
        uint256 total = uint256(d.packs) + d.starters;
        uint256 used = uint256(d.paidSold) + d.creditPacks + d.startersClaimed;
        return total > used ? total - used : 0;
    }

    /// @dev Checks shared by every paid purchase, then takes the PAPER and counts the packs.
    function _takePaid(uint256 fire, uint256 n, Pay pay) internal returns (Drop storage d) {
        if (n == 0 || n > MAX_PER_TX) revert BadAmount();
        d = _live(fire);
        if (n > _paidLeft(d)) revert SoldOut();
        // PLANK lights the forge: the first plankOnly paid packs are PLANK-only. If they haven't sold by the time the
        // wallet limit lifts (e.g. the PLANK price feed is down), ETH and USDG open anyway so a drop can't get stuck.
        if (pay != Pay.PLANK && d.paidSold < d.plankOnly && block.timestamp < uint256(d.start) + d.liftAfter) revert PlankOnly();
        if (block.timestamp < uint256(d.start) + d.liftAfter) {
            if (paidBought[fire][msg.sender] + n > d.walletLimit) revert WalletLimit();
        }
        paidBought[fire][msg.sender] += n;
        d.paidSold += uint32(n);
        _burnPaper(d, n);
    }

    function _finish(uint256 fire, Drop storage d, uint256 n, Pay pay, uint256 paid, uint256 burnShare, bool plankBurned) internal {
        PACKS.mint(msg.sender, fire, n);
        emit PacksBought(fire, msg.sender, n, pay, paid, burnShare, plankBurned);
        _closeIfSoldOut(fire, d);
    }

    function _burnPaper(Drop storage d, uint256 n) internal {
        PAPER.safeTransferFrom(msg.sender, DEAD, n * d.paperPerPack);
    }

    function _closeIfSoldOut(uint256 fire, Drop storage d) internal {
        if (_left(d) == 0) _close(fire, d);
    }

    function _close(uint256 fire, Drop storage d) internal {
        if (d.closed) revert NotLive();
        d.closed = true;
        activeDrops -= 1;
        CARDS.closeFire(fire);
        emit DropClosed(fire, uint256(d.paidSold) + d.creditPacks + d.startersClaimed);
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

    /// @dev Least PLANK the swap must return: SWAP_MIN_BPS of what `usd8` buys at the 30-minute average. 0 = no price.
    function _minPlank(uint256 usd8) internal view returns (uint256) {
        uint256 px = _plankUsd();
        if (px == 0) return 0;
        return usd8 * 1e28 / px * SWAP_MIN_BPS / BPS;
    }

    // ---------- the PLANK burn ----------

    /// @dev Buys PLANK with `amount` ETH straight to the dead address. False (nothing spent) if it can't.
    function _swapEthToPlank(uint256 amount, uint256 usd8) internal returns (bool) {
        uint256 minOut = _minPlank(usd8);
        if (minOut == 0) return false;
        address[] memory path = new address[](2);
        path[0] = WETH;
        path[1] = address(PLANK);
        try ROUTER.swapExactETHForTokens{value: amount}(minOut, path, DEAD, block.timestamp) {
            return true;
        } catch {
            return false;
        }
    }

    /// @dev Buys PLANK with `amount` USDG (held for this transaction only) via WETH, straight to the dead address.
    function _swapUsdgToPlank(uint256 amount, uint256 usd8) internal returns (bool ok) {
        uint256 minOut = _minPlank(usd8);
        if (minOut == 0) return false;
        address[] memory path = new address[](3);
        path[0] = address(USDG);
        path[1] = WETH;
        path[2] = address(PLANK);
        USDG.forceApprove(address(ROUTER), amount);
        try ROUTER.swapExactTokensForTokens(amount, minOut, path, DEAD, block.timestamp) {
            ok = true;
        } catch {
            ok = false;
        }
        USDG.forceApprove(address(ROUTER), 0);
    }

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _setWallets(address revenue, address burn) internal {
        if (revenue == address(0) || burn == address(0) || revenue == burn) revert ZeroAddress();
        revenueWallet = revenue;
        burnWallet = burn;
        emit WalletsSet(revenue, burn);
    }

    function _decimals(address token) private view returns (uint8) {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || ret.length < 32) revert BadConfig();
        return abi.decode(ret, (uint8));
    }
}
