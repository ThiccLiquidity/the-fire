// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "openzeppelin-contracts/contracts/utils/cryptography/MerkleProof.sol";

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
}

/**
 * @title FireSale
 * @notice Sells the Omni packs (docs/omni-economy.md). Every product rule is a per-drop setting the owner picks before
 *         the drop opens (`DropConfig`): pack counts, prices, PAPER per pack, the PLANK burn share, the PLANK-only
 *         packs and how long they stay PLANK-only, press packs (how many per press and per wallet, and what they cost),
 *         the holder window, the wallet limit and when it lifts, how long only regular wallets can buy, most packs per
 *         purchase, credits per picked suggestion and caps on free (credit) packs. Nothing about a drop can
 *         change once it opens. What a pack holds is the Series' recipe (FireCards and its dealer), fixed from the
 *         first pack minted.
 *
 *         - Paid packs cost a dollar price in PLANK, ETH or USDG, plus the drop's PAPER per pack (burned). The first
 *           packs can be PLANK-only. Of each sale, the burn share buys PLANK and burns it (PLANK payments burn
 *           directly); the rest goes to the revenue wallet. If the PLANK swap can't go through, the burn share goes to
 *           the burn wallet instead, so a purchase never fails because of PLANK.
 *         - Press packs ("starters"): press holders claim up to `starterPerPress` per press per drop and up to
 *           `starterWalletLimit` per wallet, during the starter window. Free, a PAPER amount, a dollar price (paid like
 *           a paid pack), or a dollar price plus PAPER. Leftovers join the paid supply when the window ends.
 *         - Free pack credits: earned by burning cards (a running count per wallet; a credit every 42 cards,
 *           CARDS_PER_CREDIT, fixed forever because progress carries over between Series) or by having a character
 *           suggestion picked. They stack and are spent in
 *           any live drop for that drop's PAPER per pack alone.
 *
 *         Safety guards stay fixed: settings lock at the drop's start, every purchase names its most PLANK/USDG/ETH and
 *         PAPER, the PLANK swap's 90% floor, price-feed freshness, one drop at a time, and a stalled drop can always be
 *         ended. The contract never holds funds between transactions: everything paid is burned or forwarded in the
 *         same transaction, and there is no withdraw function.
 */
contract FireSale is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BPS = 10_000;
    /// @notice Cards burned per free pack credit. Fixed forever: burn progress carries over from Series to Series, so
    ///         the rate is a promise, not a setting.
    uint256 public constant CARDS_PER_CREDIT = 42;
    /// @dev Most packs in one purchase for a drop that sets 0.
    uint256 public constant DEFAULT_MAX_PER_TX = 50;
    /// @dev The PLANK swap must get at least this share of what the 30-minute average price says, or it's skipped
    ///      (the burn share then goes to the burn wallet). Guards against a pumped or manipulated pool.
    uint256 public constant SWAP_MIN_BPS = 9_000;
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours; // Chainlink ETH/USD: deviation updates + 24h heartbeat
    /// @dev The PLANK price must be recent: its window must have ended within PLANK_FEED_MAX_AGE and be no longer than
    ///      PLANK_WINDOW_MAX (a long window after a keeper gap would hide a recent move). Otherwise PLANK purchases pause
    ///      and the burn share of ETH/USDG sales goes to the burn wallet until the keeper checkpoints again.
    uint256 public constant PLANK_FEED_MAX_AGE = 2 hours;
    uint256 public constant PLANK_WINDOW_MAX = 2 hours;
    /// @dev Longest of any drop phase (starter, holder, PLANK-only, wallet-limit, regular-wallets windows). A drop's
    ///      phases always end within a month, so `endDrop` is always reachable.
    uint256 public constant MAX_WINDOW = 30 days;
    /// @dev A drop that hasn't sold out can be ended by the owner once its phases are over, and by anyone this long
    ///      after that, so its packs can always be opened even if the owner never acts.
    uint256 public constant END_GRACE = 7 days;
    /// @dev Longest suggestion text the owner can allow (the text lives only in the event).
    uint256 public constant MAX_SUGGESTION_BYTES = 1_024;
    /// @notice A pack's PAPER never costs more than this many dollars (18 decimals): past $1 a PAPER, a pack takes
    ///         $1 worth (part of a PAPER) instead of its full PAPER. Fixed forever.
    uint256 public constant PACK_PAPER_CAP_USD18 = 1e18;
    /// @notice The last pack PAPER cap the PAPER feed gave: holds while the feed has no price, so packs never take
    ///         more than about $1 of PAPER just because a price is late.
    uint256 public lastPaperCap;
    uint256 public constant PAPER_FEED_MAX_AGE = 2 days;
    /// @dev The owner can end a drop that hasn't sold out only this long after it opens at the earliest.
    uint256 public constant MIN_DROP_TIME = 1 days;

    IERC20 public immutable PAPER;
    IERC20 public immutable PLANK;
    IERC20 public immutable USDG; // address(0) disables USDG
    uint256 public immutable USDG_UNIT;
    address public immutable WETH;
    IERC721 public immutable PRESS;
    ISalePacks public immutable PACKS;
    ISaleCards public immutable CARDS;
    /// @dev The price feeds and the router can be replaced while no drop is set up (a retired Chainlink feed, a new
    ///      PLANK pool or router); never during a drop.
    ISaleFeed public ETH_USD;
    ISaleFeed public PLANK_USD;
    /// @notice PAPER/USD (PaperUsdTwap, 18 decimals), for the pack PAPER cap; none = no cap until it's set.
    ISaleFeed public PAPER_USD;
    IV2Router public ROUTER;
    /// @notice PAPER (wei) burned per character suggestion (0 = free). The owner can change it at any time; `suggest`
    ///         names the most the suggester pays.
    uint256 public suggestionPaper;
    /// @notice Longest suggestion text, in bytes.
    uint256 public suggestionMaxBytes = 280;

    address public revenueWallet;
    address public burnWallet;

    enum Pay { PLANK, ETH, USDG }

    struct Drop {
        // set by the owner before the drop opens
        uint64 start;
        uint64 packs; // paid packs (press packs come on top)
        uint64 starters; // press packs in all
        uint64 plankOnly; // the first this-many paid packs are PLANK-only
        uint64 walletLimit; // paid packs per wallet until liftAfter (0 = no limit)
        // running
        uint64 paidSold; // paid packs sold (all currencies)
        uint64 startersClaimed;
        uint64 creditPacks; // packs minted with credits
        // set by the owner; times are seconds after start
        uint32 starterWindow; // press packs can be claimed until then
        uint32 liftAfter; // the wallet limit lifts
        uint32 holderWindow; // only holders can buy paid packs until then
        uint32 maxPerTx; // most packs in one purchase or credit spend
        uint32 plankOnlyFor; // the PLANK-only packs open to ETH and USDG then, sold or not
        uint32 regularWalletsFor; // only regular wallets (not contracts) can buy paid packs until then
        uint32 starterPerPress; // press packs per press
        uint32 starterWalletLimit; // press packs per wallet
        uint16 creditsPerPick; // credits per picked suggestion
        uint16 plankBurnBps;
        uint64 creditPacksMax; // most credit packs in this drop in all (0 = no limit)
        uint64 creditPacksPerWallet; // most credit packs per wallet in this drop (0 = no limit)
        bool closed;
        uint128 priceUsd; // per paid pack, 8 decimals ($2.50 = 250_000_000)
        uint128 paperPerPack; // PAPER wei per paid or credit pack
        uint128 starterPriceUsd; // per press pack, 8 decimals (0 = no dollar price)
        uint128 starterPaper; // PAPER wei per press pack (0 = none)
        bytes32 holderRoot; // Merkle root of the PLANK-holder snapshot (wallets that held the minimum)
    }

    mapping(uint256 fire => Drop) internal drops;
    mapping(uint256 fire => mapping(address => uint256)) public paidBought;
    /// @notice Credit packs a wallet minted in a drop.
    mapping(uint256 fire => mapping(address => uint256)) public creditPacksBy;
    /// @notice Press packs a wallet claimed in a drop.
    mapping(uint256 fire => mapping(address => uint256)) public startersClaimedBy;
    /// @notice Press packs claimed with a press in a drop (passing a press around never gets more).
    mapping(uint256 fire => mapping(uint256 pressId => uint256)) public startersClaimedWith;
    /// @notice During a drop's holder window, the one wallet each press let in (a press can't be passed around).
    mapping(uint256 fire => mapping(uint256 pressId => address)) public pressBuyer;

    /// @notice How a wallet shows it may buy during the holder window: a press it owns, or a proof that it was in the
    ///         PLANK-holder snapshot. Ignored outside the window (pass pressId 0 and an empty proof).
    struct Access {
        uint256 pressId;
        bytes32[] proof;
    }

    /// @notice Free pack credits (from burning cards, or a picked suggestion). They stack, never expire, and work
    ///         at any time in any live drop.
    mapping(address => uint256) public credits;
    mapping(uint256 fire => uint256) public picksOf;
    /// @notice Drops configured and not yet closed (0 or 1). Wallets and feeds can only change while this is 0.
    uint256 public activeDrops;
    mapping(address => uint256) public burnCount; // cards burned toward the next credit

    struct Suggestion { address by; uint64 at; bool granted; uint32 round; }
    Suggestion[] public suggestions;
    /// @notice The list new suggestions join. A picking session takes everything in the current list and starts a new
    ///         one, so the list clears after every session and unpicked suggestions don't carry over.
    uint32 public currentRound;
    /// @notice The Series being picked for, and the list it picks from.
    uint256 public sessionFire;
    uint32 public sessionRound;

    event DropConfigured(uint256 indexed fire, DropConfig config);
    event PacksBought(uint256 indexed fire, address indexed buyer, uint256 count, Pay pay, uint256 paid, uint256 burnShare, bool plankBurned);
    event StarterClaimed(
        uint256 indexed fire, address indexed buyer, uint256 indexed pressId, uint256 count, Pay pay, uint256 paid,
        uint256 burnShare, bool plankBurned
    );
    event CreditsUsed(uint256 indexed fire, address indexed buyer, uint256 count);
    event CardsBurned(address indexed holder, uint256 count, uint256 creditsEarned, uint256 burnCount);
    event Suggested(uint256 indexed id, address indexed by, uint32 indexed round, string text);
    event PickingSession(uint256 indexed fire, uint32 round);
    event SuggestionPicked(uint256 indexed fire, uint256 indexed id, address indexed by, uint256 credits);
    event DropClosed(uint256 indexed fire, uint256 packs);
    event WalletsSet(address revenue, address burn);
    event FeedsSet(address ethUsd, address plankUsd, address paperUsd, address router);
    event SuggestionRulesSet(uint256 paper, uint256 maxBytes);

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
    error AnotherDropActive();
    error HoldersOnly();
    error NoContracts();
    error CreditCapReached();
    error CreditWalletLimit();

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
        address paperUsd; // may be 0 (no pack PAPER cap until set)
        address router;
        address revenueWallet;
        address burnWallet;
        uint256 paperPerSuggestion; // the starting suggestion cost (the owner can change it)
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
        PAPER_USD = ISaleFeed(c.paperUsd);
        ROUTER = IV2Router(c.router);
        suggestionPaper = c.paperPerSuggestion;
        _setWallets(c.revenueWallet, c.burnWallet);
    }

    // ================================================================ owner

    /// @notice Change the revenue and burn wallets. Only while no drop is set up or running, so a drop's money always
    ///      goes where it did when it was announced.
    function setWallets(address revenue, address burn) external onlyOwner {
        if (activeDrops != 0) revert DropsActive();
        _setWallets(revenue, burn);
    }

    /// @notice Replace the price feeds and the router. Only while no drop is set up or running.
    function setFeeds(address ethUsd, address plankUsd, address paperUsd, address router) external onlyOwner {
        if (activeDrops != 0) revert DropsActive();
        if (ethUsd == address(0) || plankUsd == address(0) || router.code.length == 0) revert BadConfig();
        if (paperUsd != address(0) && _decimals(paperUsd) != 18) revert BadConfig(); // PaperUsdTwap
        ETH_USD = ISaleFeed(ethUsd);
        PLANK_USD = ISaleFeed(plankUsd);
        if (paperUsd != address(PAPER_USD)) lastPaperCap = 0; // a new (or no) PAPER feed starts its own cap
        PAPER_USD = ISaleFeed(paperUsd);
        ROUTER = IV2Router(router);
        emit FeedsSet(ethUsd, plankUsd, paperUsd, router);
    }

    /// @notice What a character suggestion costs (PAPER wei, 0 = free) and its longest text (1 to 1,024 bytes).
    ///         Suggestions aren't tied to a drop, so this is one setting for all; each `suggest` names its most PAPER.
    function setSuggestionRules(uint256 paper, uint256 maxBytes) external onlyOwner {
        if (maxBytes == 0 || maxBytes > MAX_SUGGESTION_BYTES) revert BadConfig();
        suggestionPaper = paper;
        suggestionMaxBytes = maxBytes;
        emit SuggestionRulesSet(paper, maxBytes);
    }

    /// @notice What the owner sets per drop. Every number can differ from drop to drop. Times are seconds after
    ///         `start`; every phase is at most MAX_WINDOW (30 days).
    struct DropConfig {
        uint64 start; // when it opens (unix seconds); everything locks then
        uint64 packs; // paid packs (117 for a 167-pack drop with 50 press packs); 0 = press packs only
        uint64 starters; // press packs on top (50); 0 = none
        uint64 plankOnly; // first paid packs that only PLANK can buy (50)
        uint64 walletLimit; // paid packs per wallet until liftAfter (5); 0 = no limit (then liftAfter must be 0 too)
        uint32 starterWindow; // how long press packs can be claimed (24h); leftovers then join the paid supply
        uint32 liftAfter; // when the wallet limit lifts (48h)
        uint16 plankBurnBps; // share of each sale that burns PLANK (3000 = 30%)
        uint128 priceUsd; // per paid pack, 8 decimals ($2.50 = 250_000_000); required (unclaimed press packs sell at it)
        uint128 paperPerPack; // PAPER wei per paid or credit pack (1e18); 0 = none
        uint32 holderWindow; // only holders can buy paid packs until then (24h); 0 = open to all
        bytes32 holderRoot; // Merkle root of the secret PLANK-holder snapshot ($69+), from ops/snapshot; 0 = presses only
        uint32 maxPerTx; // most packs in one purchase or credit spend; 0 = DEFAULT_MAX_PER_TX (50)
        uint32 plankOnlyFor; // the PLANK-only packs open to ETH and USDG then, sold or not (48h); needed if plankOnly > 0
        uint32 regularWalletsFor; // only regular wallets can buy paid packs until then (48h); 0 = off
        uint32 starterPerPress; // press packs per press (1); needed if starters > 0
        uint32 starterWalletLimit; // press packs per wallet (1); needed if starters > 0
        uint128 starterPriceUsd; // dollar price per press pack, paid like a paid pack (0 = none)
        uint128 starterPaper; // PAPER wei per press pack (1e18; 0 = none). Both 0 = free press packs
        uint16 creditsPerPick; // credits per picked suggestion (1); 0 = none
        uint64 creditPacksMax; // most free (credit) packs in this drop in all; 0 = no limit
        uint64 creditPacksPerWallet; // most free (credit) packs per wallet in this drop; 0 = no limit
    }

    /// @notice Set up a drop. Allowed until it opens (`start`); after that nothing about it can change.
    function configureDrop(uint256 fire, DropConfig calldata c) external onlyOwner {
        Drop storage d = drops[fire];
        if (d.start != 0 && block.timestamp >= d.start) revert DropStarted();
        if (fire > type(uint64).max || c.start <= block.timestamp || uint256(c.packs) + c.starters == 0) revert BadConfig();
        // paid packs need a price (a $0 typo would give them away; free packs are press packs or credits), and so do
        // press-pack-only drops: unclaimed press packs join the paid supply when the window ends
        if (c.priceUsd == 0 || c.plankOnly > c.packs || c.plankBurnBps > BPS) revert BadConfig();
        // the PLANK-only packs need a time they open up, so a drop can't get stuck on a PLANK feed outage
        if (c.plankOnly > 0 && c.plankOnlyFor == 0) revert BadConfig();
        // a wallet limit needs a lift time, and the other way round (both 0 = no limit)
        if ((c.walletLimit == 0) != (c.liftAfter == 0)) revert BadConfig();
        if (c.starters > 0 && (c.starterWindow == 0 || c.starterPerPress == 0 || c.starterWalletLimit == 0)) revert BadConfig();
        if (_longest(c.starterWindow, c.liftAfter, c.holderWindow, c.plankOnlyFor, c.regularWalletsFor) > MAX_WINDOW) {
            revert BadConfig();
        }
        // The Series must be set up in the card contract first (its dealer, recipe and characters), or the sale that
        // sells it out couldn't close it.
        if (!CARDS.ready(fire)) revert BadConfig();
        CARDS.lockForSale(fire); // the Series (recipe, characters, odds, art) is fixed from here
        // One drop at a time: the next drop can only be set up once the current one has closed.
        if (d.start == 0) {
            if (activeDrops != 0) revert AnotherDropActive();
            activeDrops = 1;
        }
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
        d.holderWindow = c.holderWindow;
        d.holderRoot = c.holderRoot;
        d.maxPerTx = c.maxPerTx == 0 ? uint32(DEFAULT_MAX_PER_TX) : c.maxPerTx;
        d.plankOnlyFor = c.plankOnlyFor;
        d.regularWalletsFor = c.regularWalletsFor;
        d.starterPerPress = c.starterPerPress;
        d.starterWalletLimit = c.starterWalletLimit;
        d.starterPriceUsd = c.starterPriceUsd;
        d.starterPaper = c.starterPaper;
        d.creditsPerPick = c.creditsPerPick;
        d.creditPacksMax = c.creditPacksMax;
        d.creditPacksPerWallet = c.creditPacksPerWallet;
        DropConfig memory e = c;
        e.maxPerTx = d.maxPerTx; // what applies (0 means the default)
        emit DropConfigured(fire, e);
    }

    /// @notice Give free pack credits (the drop's `creditsPerPick` each) to each picked suggestion's author. Only while
    ///         setting up a drop (before it opens; with one drop at a time no drop is running then), each suggestion
    ///         once, and no more picks than the Series has characters.
    function pickSuggestions(uint256 fire, uint256[] calldata ids) external onlyOwner {
        Drop storage d = drops[fire];
        if (d.start == 0) revert BadConfig();
        if (block.timestamp >= d.start) revert DropStarted();
        if (picksOf[fire] + ids.length > CARDS.characterCount(fire)) revert BadAmount();
        picksOf[fire] += ids.length;
        // The first pick for a new Series starts a session: it picks from the current list, and new suggestions from
        // now on go into a fresh list for the next session. Unpicked ones from older lists can't be picked again.
        if (sessionFire != fire || currentRound == 0) {
            sessionFire = fire;
            sessionRound = currentRound;
            currentRound += 1;
            emit PickingSession(fire, sessionRound);
        }
        uint256 each = d.creditsPerPick;
        for (uint256 i; i < ids.length; i++) {
            Suggestion storage s = suggestions[ids[i]];
            if (s.round != sessionRound) revert NotThisRound();
            if (s.granted) revert AlreadyClaimed();
            s.granted = true;
            credits[s.by] += each;
            emit SuggestionPicked(fire, ids[i], s.by, each);
        }
    }

    /// @notice End a drop that hasn't sold out. The owner can once all its phases are over (starter, holder,
    ///         PLANK-only, wallet-limit and regular-wallets windows, so each always runs in full); anyone can END_GRACE
    ///         after that, so packs never get stranded. No more packs are sold; the Series closes with what was minted.
    function endDrop(uint256 fire) external {
        Drop storage d = drops[fire];
        if (d.start == 0 || d.closed) revert NotLive();
        uint256 over = _phasesOver(d);
        if (over < uint256(d.start) + MIN_DROP_TIME) over = uint256(d.start) + MIN_DROP_TIME;
        if (block.timestamp < (msg.sender == owner() ? over : over + END_GRACE)) revert TooEarly();
        _close(fire, d);
    }

    // ================================================================ buying

    /// @notice Buy `n` packs, paying the price in PLANK. `maxPlank` is the most PLANK the buyer agrees to pay.
    ///         `maxPaper` is the most PAPER (wei) the buyer agrees to burn for these packs.
    ///         During the holder window, `access` shows the buyer holds a press or was in the PLANK snapshot.
    function buyWithPlank(uint256 fire, uint256 n, uint256 maxPlank, uint256 maxPaper, Access calldata access) external nonReentrant {
        Drop storage d = _takePaid(fire, n, Pay.PLANK, maxPaper, access);
        (uint256 cost, uint256 burnShare, bool burned) = _collect(d, Pay.PLANK, n * d.priceUsd, maxPlank);
        _finish(fire, d, n, Pay.PLANK, cost, burnShare, burned);
    }

    /// @notice Buy `n` packs, paying the price in ETH. Send at least `quoteEth(fire, n)`; anything above comes back.
    function buyWithEth(uint256 fire, uint256 n, uint256 maxPaper, Access calldata access) external payable nonReentrant {
        Drop storage d = _takePaid(fire, n, Pay.ETH, maxPaper, access);
        (uint256 cost, uint256 burnShare, bool burned) = _collect(d, Pay.ETH, n * d.priceUsd, type(uint256).max);
        _finish(fire, d, n, Pay.ETH, cost, burnShare, burned);
        _refund(Pay.ETH, cost);
    }

    /// @notice Buy `n` packs, paying the price in USDG (face value). `maxUsdg` is the most USDG the buyer agrees to pay.
    function buyWithUsdg(uint256 fire, uint256 n, uint256 maxUsdg, uint256 maxPaper, Access calldata access) external nonReentrant {
        if (address(USDG) == address(0)) revert BadConfig();
        Drop storage d = _takePaid(fire, n, Pay.USDG, maxPaper, access);
        (uint256 cost, uint256 burnShare, bool burned) = _collect(d, Pay.USDG, n * d.priceUsd, maxUsdg);
        _finish(fire, d, n, Pay.USDG, cost, burnShare, burned);
    }

    /// @notice Claim `n` press packs with a press you hold, during the starter window: at most the drop's
    ///         `starterPerPress` per press and `starterWalletLimit` per wallet. They cost the drop's press-pack PAPER
    ///         (burned) and, if it has one, its press-pack dollar price paid in `pay` (PLANK, ETH or USDG, split and
    ///         burned like a paid pack; `maxCost` is the most PLANK/USDG, or send ETH and the rest comes back). With
    ///         no dollar price, `pay` and `maxCost` are ignored and any ETH sent comes back.
    function claimStarter(uint256 fire, uint256 pressId, uint256 n, Pay pay, uint256 maxCost, uint256 maxPaper)
        external
        payable
        nonReentrant
    {
        Drop storage d = _live(fire);
        if (block.timestamp >= uint256(d.start) + d.starterWindow) revert StarterWindowClosed();
        if (n == 0) revert BadAmount();
        if (uint256(d.startersClaimed) + n > d.starters) revert SoldOut();
        if (PRESS.ownerOf(pressId) != msg.sender) revert NotPressOwner();
        uint256 mine = startersClaimedBy[fire][msg.sender] + n;
        if (mine > d.starterWalletLimit) revert AlreadyClaimed();
        uint256 used = startersClaimedWith[fire][pressId] + n;
        if (used > d.starterPerPress) revert PressUsed();
        startersClaimedBy[fire][msg.sender] = mine;
        startersClaimedWith[fire][pressId] = used;
        d.startersClaimed += uint64(n);
        _burnPaper(n, d.starterPaper, maxPaper);
        uint256 cost;
        uint256 burnShare;
        bool burned;
        if (d.starterPriceUsd != 0) (cost, burnShare, burned) = _collect(d, pay, n * d.starterPriceUsd, maxCost);
        PACKS.mint(msg.sender, fire, n);
        emit StarterClaimed(fire, msg.sender, pressId, n, pay, cost, burnShare, burned);
        _closeIfSoldOut(fire, d);
        _refund(pay, cost);
    }

    /// @notice Spend `n` free pack credits in a live drop, at any time (holder window, PLANK-only phase, wallet
    ///         limit and regular-wallets rule don't apply: a credit was earned). The drop's PAPER per pack alone.
    ///         Packs come out of the paid supply. The drop can cap credit packs in all (`creditPacksMax`) and per
    ///         wallet (`creditPacksPerWallet`); 0 = no cap.
    function useCredits(uint256 fire, uint256 n, uint256 maxPaper) external nonReentrant {
        Drop storage d = _live(fire);
        if (n == 0 || n > d.maxPerTx) revert BadAmount();
        // a pack of CARDS_PER_CREDIT or more cards could be burned for a free pack of itself: no credits there
        if (CARDS.cardsPerPack(fire) >= CARDS_PER_CREDIT) revert BadConfig();
        if (credits[msg.sender] < n) revert NoCredits();
        if (n > _paidLeft(d)) revert SoldOut();
        if (d.creditPacksMax != 0 && uint256(d.creditPacks) + n > d.creditPacksMax) revert CreditCapReached();
        uint256 mine = creditPacksBy[fire][msg.sender] + n;
        if (d.creditPacksPerWallet != 0 && mine > d.creditPacksPerWallet) revert CreditWalletLimit();
        creditPacksBy[fire][msg.sender] = mine;
        credits[msg.sender] -= n;
        d.creditPacks += uint64(n);
        _burnPaper(n, d.paperPerPack, maxPaper);
        PACKS.mint(msg.sender, fire, n);
        emit CreditsUsed(fire, msg.sender, n);
        _closeIfSoldOut(fire, d);
    }

    // ================================================================ cards and suggestions

    /// @notice Burn your cards. Every CARDS_PER_CREDIT (42) burned earns a free pack credit; extras count toward the
    ///         next one (a running count per wallet that carries over between Series).
    function burnCards(uint256[] calldata ids) external nonReentrant {
        if (ids.length == 0) revert BadAmount();
        CARDS.burnFor(msg.sender, ids);
        uint256 per = CARDS_PER_CREDIT;
        uint256 total = burnCount[msg.sender] + ids.length;
        uint256 earned = total / per;
        burnCount[msg.sender] = total % per;
        if (earned > 0) credits[msg.sender] += earned;
        emit CardsBurned(msg.sender, ids.length, earned, total % per);
    }

    /// @notice Suggest a character for a future Series. The PAPER (`suggestionPaper`) is burned; `maxPaper` is the
    ///         most the suggester agrees to pay.
    function suggest(string calldata text, uint256 maxPaper) external returns (uint256 id) {
        uint256 len = bytes(text).length;
        if (len == 0 || len > suggestionMaxBytes) revert BadAmount();
        _burnPaper(1, suggestionPaper, maxPaper); // a suggestion is PAPER too: same $1 cap
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

    /// @notice Everything the site needs to show a drop's state.
    struct Phase {
        bool configured;
        bool live; // open and not closed
        bool closed;
        bool plankOnly; // only PLANK can buy right now (the first packs, until plankOnlyFor at the latest)
        bool limitLifted;
        bool startersOpen;
        bool plankPriceOk; // the PLANK price is fresh: PLANK purchases work and the burn swap runs
        bool holdersOnly; // the holder window: only press holders and snapshot PLANK holders can buy
        bool regularWalletsOnly; // contracts can't buy paid packs right now
        uint256 paidLeft;
        uint256 startersLeft;
        uint256 phasesOver; // when the owner can end the drop if it hasn't sold out (anyone END_GRACE later)
        uint256 creditPacksLeft; // free (credit) packs still available in this drop (cap and supply)
    }

    function phase(uint256 fire) external view returns (Phase memory p) {
        Drop storage d = drops[fire];
        uint256 s = d.start;
        p.configured = s != 0;
        p.closed = d.closed;
        p.live = p.configured && block.timestamp >= s && !d.closed;
        p.limitLifted = p.configured && block.timestamp >= s + d.liftAfter;
        p.plankOnly = p.configured && !d.closed && d.paidSold < d.plankOnly && block.timestamp < s + d.plankOnlyFor;
        p.startersOpen = p.live && block.timestamp < s + d.starterWindow && d.startersClaimed < d.starters;
        p.plankPriceOk = _plankUsd() != 0;
        p.holdersOnly = p.live && block.timestamp < s + d.holderWindow;
        p.regularWalletsOnly = p.live && block.timestamp < s + d.regularWalletsFor;
        p.paidLeft = d.closed ? 0 : _paidLeft(d);
        p.startersLeft = p.startersOpen ? d.starters - d.startersClaimed : 0;
        p.phasesOver = p.configured ? _phasesOver(d) : 0;
        p.creditPacksLeft = p.paidLeft;
        if (d.creditPacksMax != 0) {
            uint256 cap = d.creditPacksMax > d.creditPacks ? d.creditPacksMax - d.creditPacks : 0;
            if (cap < p.creditPacksLeft) p.creditPacksLeft = cap;
        }
    }

    function dropOf(uint256 fire) external view returns (Drop memory) { return drops[fire]; }
    function quotePlank(uint256 fire, uint256 n) external view returns (uint256) { return _plankFor(n * drops[fire].priceUsd); }
    function quoteEth(uint256 fire, uint256 n) external view returns (uint256) { return _ethFor(n * drops[fire].priceUsd); }
    function quoteUsdg(uint256 fire, uint256 n) external view returns (uint256) { return _usdgFor(n * drops[fire].priceUsd); }
    function paperFor(uint256 fire, uint256 n) external view returns (uint256) { return n * _packPaper(drops[fire].paperPerPack); }
    /// @notice A press pack claim's dollar price in each currency (0 if press packs have no dollar price) and PAPER.
    function quoteStarter(uint256 fire, uint256 n, Pay pay) external view returns (uint256 cost, uint256 paper) {
        Drop storage d = drops[fire];
        paper = n * _packPaper(d.starterPaper);
        uint256 usd8 = n * d.starterPriceUsd;
        if (usd8 == 0) return (0, paper);
        cost = pay == Pay.PLANK ? _plankFor(usd8) : pay == Pay.ETH ? _ethFor(usd8) : _usdgFor(usd8);
    }
    function suggestionCount() external view returns (uint256) { return suggestions.length; }

    // ================================================================ internals

    function _live(uint256 fire) internal view returns (Drop storage d) {
        d = drops[fire];
        if (d.start == 0 || block.timestamp < d.start || d.closed) revert NotLive();
    }

    function _longest(uint256 a, uint256 b, uint256 c, uint256 d, uint256 e) internal pure returns (uint256 m) {
        m = a;
        if (b > m) m = b;
        if (c > m) m = c;
        if (d > m) m = d;
        if (e > m) m = e;
    }

    /// @dev When every timed phase of a drop is over.
    function _phasesOver(Drop storage d) internal view returns (uint256) {
        return uint256(d.start) + _longest(d.starterWindow, d.liftAfter, d.holderWindow, d.plankOnlyFor, d.regularWalletsFor);
    }

    /// @dev Paid packs still for sale: the paid supply, plus press packs nobody claimed once the window has ended.
    function _paidLeft(Drop storage d) internal view returns (uint256) {
        uint256 supply = d.packs;
        if (block.timestamp >= uint256(d.start) + d.starterWindow) supply += d.starters - d.startersClaimed;
        uint256 used = uint256(d.paidSold) + d.creditPacks;
        return supply > used ? supply - used : 0;
    }

    /// @dev Everything not yet minted, press packs included.
    function _left(Drop storage d) internal view returns (uint256) {
        uint256 total = uint256(d.packs) + d.starters;
        uint256 used = uint256(d.paidSold) + d.creditPacks + d.startersClaimed;
        return total > used ? total - used : 0;
    }

    /// @dev Checks shared by every paid purchase, then takes the PAPER and counts the packs.
    function _takePaid(uint256 fire, uint256 n, Pay pay, uint256 maxPaper, Access calldata access)
        internal
        returns (Drop storage d)
    {
        d = _live(fire);
        if (n == 0 || n > d.maxPerTx) revert BadAmount();
        if (n > _paidLeft(d)) revert SoldOut();
        uint256 t = block.timestamp - d.start; // seconds since the drop opened
        // While this is on, only regular wallets (MetaMask, Rabby, OKX...) can buy: a bot contract can't spin up
        // throwaway wallets to sweep a drop in one transaction.
        if (t < d.regularWalletsFor && msg.sender != tx.origin) revert NoContracts();
        if (t < d.holderWindow) _checkHolder(fire, d, access);
        // PLANK lights the forge: the first plankOnly paid packs are PLANK-only. If they haven't sold by plankOnlyFor
        // (e.g. the PLANK price feed is down), ETH and USDG open anyway so a drop can't get stuck.
        if (pay != Pay.PLANK && d.paidSold < d.plankOnly && t < d.plankOnlyFor) revert PlankOnly();
        if (t < d.liftAfter && paidBought[fire][msg.sender] + n > d.walletLimit) revert WalletLimit();
        paidBought[fire][msg.sender] += n;
        d.paidSold += uint64(n);
        _burnPaper(n, d.paperPerPack, maxPaper);
    }

    /// @dev The holder window: the buyer owns a press (each press lets in one wallet per drop) or was in the
    ///      PLANK-holder snapshot.
    function _checkHolder(uint256 fire, Drop storage d, Access calldata a) internal {
        if (a.proof.length > 0) {
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
            if (d.holderRoot == bytes32(0) || !MerkleProof.verifyCalldata(a.proof, d.holderRoot, leaf)) revert HoldersOnly();
            return;
        }
        (bool ok, bytes memory ret) = address(PRESS).staticcall(abi.encodeCall(IERC721.ownerOf, (a.pressId)));
        if (!ok || ret.length < 32 || abi.decode(ret, (address)) != msg.sender) revert HoldersOnly();
        address prior = pressBuyer[fire][a.pressId];
        if (prior == address(0)) pressBuyer[fire][a.pressId] = msg.sender;
        else if (prior != msg.sender) revert PressUsed();
    }

    /// @dev Takes a dollar amount in `pay` and sends it on in this transaction: the burn share burns PLANK (or goes to
    ///      the burn wallet if the swap can't go through), the rest to the revenue wallet. ETH comes from msg.value
    ///      (the caller refunds the rest).
    function _collect(Drop storage d, Pay pay, uint256 usd8, uint256 maxCost)
        internal
        returns (uint256 cost, uint256 burnShare, bool burned)
    {
        uint256 bps = d.plankBurnBps;
        if (pay == Pay.PLANK) {
            cost = _plankFor(usd8);
            if (cost > maxCost) revert PriceMoved();
            burnShare = cost * bps / BPS;
            if (burnShare > 0) PLANK.safeTransferFrom(msg.sender, DEAD, burnShare);
            PLANK.safeTransferFrom(msg.sender, revenueWallet, cost - burnShare);
            burned = true;
        } else if (pay == Pay.ETH) {
            cost = _ethFor(usd8);
            if (msg.value < cost || cost > maxCost) revert PriceMoved();
            burnShare = cost * bps / BPS;
            burned = burnShare > 0 && _swapEthToPlank(burnShare, usd8 * bps / BPS);
            if (burnShare > 0 && !burned) _sendEth(burnWallet, burnShare);
            _sendEth(revenueWallet, cost - burnShare);
        } else {
            if (address(USDG) == address(0)) revert BadConfig();
            cost = _usdgFor(usd8);
            if (cost > maxCost) revert PriceMoved();
            burnShare = cost * bps / BPS;
            USDG.safeTransferFrom(msg.sender, revenueWallet, cost - burnShare);
            if (burnShare > 0) {
                USDG.safeTransferFrom(msg.sender, address(this), burnShare);
                burned = _swapUsdgToPlank(burnShare, usd8 * bps / BPS);
                if (!burned) USDG.safeTransfer(burnWallet, burnShare);
            }
        }
    }

    /// @dev Sends back any ETH not spent (all of it unless `pay` was ETH).
    function _refund(Pay pay, uint256 cost) internal {
        uint256 spent = pay == Pay.ETH ? cost : 0;
        if (msg.value > spent) _sendEth(msg.sender, msg.value - spent);
    }

    function _finish(uint256 fire, Drop storage d, uint256 n, Pay pay, uint256 paid, uint256 burnShare, bool plankBurned) internal {
        PACKS.mint(msg.sender, fire, n);
        emit PacksBought(fire, msg.sender, n, pay, paid, burnShare, plankBurned);
        _closeIfSoldOut(fire, d);
    }

    /// @dev A pack's PAPER: `per`, but never more than PACK_PAPER_CAP_USD18 worth at the PAPER feed's price. While the
    ///      feed has no price, the last cap it gave holds (none yet: `per`). The cap is at least 1 wei.
    function _packPaper(uint256 per) internal view returns (uint256) {
        (uint256 cap,) = _paperCap();
        return cap != 0 && cap < per ? cap : per;
    }

    function _paperCap() internal view returns (uint256 cap, bool live) {
        (int256 px, uint256 at) = _feed(PAPER_USD);
        if (px <= 0 || at > block.timestamp || block.timestamp - at > PAPER_FEED_MAX_AGE) return (lastPaperCap, false);
        cap = PACK_PAPER_CAP_USD18 * 1e18 / uint256(px);
        return (cap == 0 ? 1 : cap, true);
    }

    function _burnPaper(uint256 n, uint256 per, uint256 maxPaper) internal {
        (uint256 cap, bool live) = _paperCap();
        if (live && cap != lastPaperCap) lastPaperCap = cap;
        uint256 paper = n * (cap != 0 && cap < per ? cap : per);
        if (paper > maxPaper) revert PriceMoved();
        if (paper > 0) PAPER.safeTransferFrom(msg.sender, DEAD, paper);
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
