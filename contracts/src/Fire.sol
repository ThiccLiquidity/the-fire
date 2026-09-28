// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @notice Randomness adapter. Fire calls request(); the adapter later calls Fire.onRandomness().
///         answered(id) is true once the provider has a final result for that request (even if it hasn't
///         been delivered yet), which is what makes a re-roll safe: an answered request can't be redrawn.
interface IRandomness {
    function request() external returns (uint256 requestId);
    function answered(uint256 requestId) external view returns (bool);
}

/// @notice Chainlink-style USD price feed (8 decimals).
interface IPriceFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/// @notice Plank Press (the mills). burn() is payable (burnFee), only after mintingSunset, caller must own it;
///         returns plankPerNFT PLANK to the caller.
interface IMill is IERC721 {
    function burn(uint256 tokenId) external payable;
    function burnFee() external view returns (uint256);
    function mintingSunset() external view returns (uint256);
}

/// @notice Minimal Seaport 1.6 surface for filling an ETH listing. Deployed on Robinhood Chain at the canonical
///         0x0000000000000068F116a894984e2DB1123eB395 (checked Sep 27 2026). Uses fulfillAdvancedOrder so restricted
///         listings (a zone such as OpenSea's SignedZone that needs extraData) can be filled as well as open ones.
interface ISeaport {
    struct OfferItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; }
    struct ConsiderationItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; address payable recipient; }
    struct OrderParameters { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 totalOriginalConsiderationItems; }
    struct Order { OrderParameters parameters; bytes signature; }
    struct AdvancedOrder { OrderParameters parameters; uint120 numerator; uint120 denominator; bytes signature; bytes extraData; }
    struct CriteriaResolver { uint256 orderIndex; uint8 side; uint256 index; uint256 identifier; bytes32[] criteriaProof; }
    function fulfillAdvancedOrder(
        AdvancedOrder calldata advancedOrder,
        CriteriaResolver[] calldata criteriaResolvers,
        bytes32 fulfillerConduitKey,
        address recipient
    ) external payable returns (bool fulfilled);
}

/**
 * @title The Fire
 * @notice Buy tickets with PAPER + PLANK. PAPER burns. Half the PLANK burns, half feeds the fire.
 *         Every night a storm rolls in; a big fire survives, a small one dies. When the fire goes
 *         out, one ticket wins 40% of the pot, 25% burns, 5% goes to the Paper Mill royalty pool, 30% relights
 *         the next fire.
 *
 *         There is no owner and no function that withdraws the pot or the mill fund. Funds only leave through
 *         the rules below. Every buy names the most it will pay, so a buyer is never charged more than they saw.
 *         If randomness ever stops for ABANDON_AFTER, the fire ends for good and its pot is refunded to the
 *         ticket holders pro rata.
 */
contract Fire is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BPS = 10_000;
    uint256 public constant WINNER_BPS = 4_000; // all of it to the winner
    uint256 public constant BURN_BPS = 2_500;
    uint256 public constant ROYALTY_BPS = 500; // to the Paper Mill royalty pool (PulpPool)
    uint256 public constant CARRY_BPS = 3_000; // relights the next fire (the remainder, so rounding dust stays in)
    uint256 public constant PLANK_BURN_BPS = 5_000; // of every PLANK feed
    uint256 public constant MAX_NIGHTS = 24; // the night-24 storm is infinite
    uint256 public constant KEEP_BPS = 6_000; // the fire keeps 60% of its size overnight
    /// @dev The fire is measured in thousandths of a ticket, so a small fire isn't rounded away overnight.
    uint256 public constant MILLI = 1_000;
    uint256 public constant TRAILING = 7;
    uint256 public constant BID_RISE_BPS_PER_DAY = 2_500; // mill bid climbs 25% of its start per day, linearly
    uint256 public constant BID_RESTART_BPS = 9_000; // after a buy the bid restarts at 90% of the price paid
    uint256 public constant BID_MAX_MULT = 3; // and never climbs past 3x its restart point
    uint256 public constant DAILY_CAP = 500; // tickets per wallet per day
    uint256 public constant TX_CAP = 10; // tickets paid for per transaction
    uint256 public constant FREE_WITH_FULL_BUY = 1; // buy 10, get 1 free
    uint256 public constant PLANK_RATCHET_BPS = 500; // PLANK leg moves at most 5% per night toward target
    /// @dev A roll normally resolves ~35s after it's requested. The wait before a re-roll is long on purpose: drand's
    ///      number is public ~30s after the roll, so a short wait would let someone who dislikes it re-roll whenever
    ///      nobody has delivered it yet. Two hours gives the keeper's alarm (and anyone on the site) time to deliver.
    uint256 public constant REROLL_AFTER = 2 hours;
    /// @dev Last resort: if a roll has been stuck this long (randomness gone for good, or a result that can't be
    ///      delivered), anyone can end the game and every ticket holder of the current fire claims their share.
    uint256 public constant ABANDON_AFTER = 7 days;
    /// @dev Chainlink ETH/USD updates on price deviation plus a 24h heartbeat; on Robinhood Chain gaps of 3-6h are
    ///      normal (observed Sep 2026). A quiet feed is still accurate, so only a missed heartbeat counts as stale.
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours;

    // ---------------------------------------------------------------- immutables
    IERC20 public immutable PAPER;
    IERC20 public immutable PLANK;
    IMill public immutable MILL;
    ISeaport public immutable SEAPORT; // address(0) disables mill buying entirely
    address public immutable ROYALTY_POOL;
    uint256 public immutable PAPER_PER_TICKET; // the most PAPER a ticket ever takes, in PAPER wei (1 PAPER)
    uint256 public immutable PAPER_USD_CAP; // the PAPER leg never costs more than this, USD 8 decimals ($0.33)
    IPriceFeed public immutable PAPER_USD; // PAPER/USD, **18 decimals** (PaperUsdTwap); 0 until PAPER has a market
    uint256 public paperPerTicket; // PAPER wei per ticket: PAPER_PER_TICKET, or less once PAPER is worth > the cap
    uint256 public immutable ETH_USD_PER_TICKET; // price of the PAPER part when paid in ETH or USDG, USD 8 decimals (1e8 = $1)
    uint256 public immutable PLANK_USD_PER_TICKET; // PLANK leg target, USD 8-decimals
    IPriceFeed public immutable ETH_USD; // Chainlink ETH/USD
    IPriceFeed public immutable PLANK_USD; // PLANK/USD, **18 decimals** (our TWAP adapter)
    uint256 public plankPerTicket; // in PLANK wei; ratchets nightly toward the USD target
    uint256 public immutable MILL_BID_BASE; // starting bid for a mill, USD 8 decimals (mill listings are priced in USDG or ETH)
    IERC20 public immutable USDG; // dollar stablecoin mills are listed in on OpenSea; address(0) disables the USDG paths
    uint256 public immutable USDG_UNIT; // 10 ** USDG decimals
    uint256 public immutable ROLL_TIME_OF_DAY; // seconds after 00:00 UTC (8pm Phoenix = 03:00 UTC = 10800)

    IRandomness public randomness;

    // ---------------------------------------------------------------- fire state
    struct Entry {
        address buyer;
        uint128 cumEnd; // cumulative ticket count after this entry
    }

    uint256 public fireId;
    uint256 public night; // nights this fire has survived (0 = lit today)
    uint256 public pot; // PLANK wei
    uint256 public nextRollAt;
    uint256 public ticketsToday;
    uint256 public fireSizeMilli; // in thousandths of a ticket. Buys add, storms subtract, burns down 40% each night
    uint256 public ticketsTotal;
    address public lastWinner;

    mapping(uint256 => Entry[]) internal _entries; // fireId -> entries
    mapping(uint256 => mapping(address => uint256)) public ticketsOf; // fireId -> buyer -> tickets
    mapping(uint256 => mapping(address => uint256)) public boughtOnDay; // dayIndex -> buyer -> tickets
    uint256 public dayIndex; // increments every roll

    uint256[TRAILING] internal _trail;
    uint256 internal _trailCount;
    uint256 internal _trailIdx;

    uint256 public millBidStart; // where the current mill bid restarted (USD, 8 dec); the rate and cap are relative to it
    uint256 public millBidBanked; // the bid as of millBidSince
    uint256 public millBidSince; // when the bid was last brought up to date
    uint256 public millFundUsdAt; // what the fund could pay then (USD, 8 dec): the bid only climbs below this

    uint256 public pendingRequest; // randomness request in flight (0 = none)
    uint256 public pendingSince; // when it was requested

    /// @notice PLANK a winner is owed because the transfer to them failed when the fire went out. Claim with claim().
    mapping(address => uint256) public unclaimed;
    uint256 public unclaimedTotal;

    /// @notice Set once, by abandon(): the game is over and the last fire's pot is refunded pro rata.
    bool public abandoned;
    uint256 public refundPot; // PLANK set aside for refunds
    uint256 public refundTickets; // tickets in the abandoned fire
    mapping(address => bool) public refunded;

    // ---------------------------------------------------------------- events
    /// @param tickets tickets received, including the free one on a full buy of 10
    /// @param paperFromFire true when the PAPER part was paid $1 a ticket in ETH or USDG
    event TicketsBought(uint256 indexed fireId, address indexed buyer, uint256 tickets, bool paperFromFire, string note);
    event RollRequested(uint256 indexed fireId, uint256 night, uint256 requestId);
    event Rerolled(uint256 indexed fireId, uint256 night, uint256 oldRequestId, uint256 newRequestId);
    event PayoutCarried(address indexed to, uint256 amount); // a pool/burn transfer failed; its PLANK stays in the next pot
    event PayoutOwed(address indexed winner, uint256 amount); // the winner's transfer failed; they claim() it later
    event Claimed(address indexed winner, address to, uint256 amount);
    event Abandoned(uint256 indexed fireId, uint256 pot, uint256 tickets);
    event Refunded(address indexed holder, uint256 amount);
    /// @dev fireSizeMilli and stormMilli are in thousandths of a ticket.
    event Survived(uint256 indexed fireId, uint256 night, uint256 fireSizeMilli, uint256 stormMilli);
    event WentOut(uint256 indexed fireId, uint256 night, uint256 fireSizeMilli, uint256 stormMilli, address winner, uint256 paid);
    event Lit(uint256 indexed fireId, uint256 carried);
    /// @param currency address(0) for ETH, else the USDG address; paid is in that currency's units; paidUsd has 8 decimals
    event MillEaten(uint256 indexed tokenId, address seller, address currency, uint256 paid, uint256 paidUsd, uint256 plankToRoyalty);
    event MillBidUpdated(uint256 bid, uint256 fundUsd);

    error NotYet();
    error RollPending();
    error BadAmount();
    error NotRandomness();
    error BadRequest();
    error FundTooSmall();
    error TooExpensive();
    error NotBurnableYet();
    error NoSeaport();
    error NotWinner();
    error DailyCap();
    error TxCap();
    error StaleFeed();
    error Answered();
    error PriceMoved();
    error Over();
    error Nothing();

    struct Config {
        address paper;
        address plank;
        address mill;
        address seaport;
        address royaltyPool;
        address randomness;
        address ethUsdFeed;
        address plankUsdFeed;
        address paperUsdFeed;
        address usdg;
        uint256 paperPerTicket;
        uint256 paperUsdCap;
        uint256 plankPerTicket0;
        uint256 plankUsdPerTicket;
        uint256 ethUsdPerTicket;
        uint256 millBidBase;
        uint256 rollTimeOfDay;
    }

    constructor(Config memory c) {
        // Everything is immutable, so a bad address or a zero price would be permanent. Refuse them here.
        if (c.paper.code.length == 0 || c.plank.code.length == 0 || c.randomness.code.length == 0) revert BadRequest();
        if (c.ethUsdFeed.code.length == 0 || c.plankUsdFeed.code.length == 0) revert BadRequest();
        if (c.paperUsdFeed != address(0) && c.paperUsdFeed.code.length == 0) revert BadRequest();
        if (c.paperPerTicket == 0 || c.plankPerTicket0 == 0 || c.plankUsdPerTicket == 0 || c.ethUsdPerTicket == 0) revert BadAmount();
        if (c.millBidBase == 0 || c.rollTimeOfDay >= 1 days) revert BadAmount();
        PAPER = IERC20(c.paper);
        PLANK = IERC20(c.plank);
        MILL = IMill(c.mill);
        SEAPORT = ISeaport(c.seaport);
        ROYALTY_POOL = c.royaltyPool;
        randomness = IRandomness(c.randomness);
        ETH_USD = IPriceFeed(c.ethUsdFeed);
        PLANK_USD = IPriceFeed(c.plankUsdFeed);
        PAPER_PER_TICKET = c.paperPerTicket;
        paperPerTicket = c.paperPerTicket;
        PAPER_USD_CAP = c.paperUsdCap;
        PAPER_USD = IPriceFeed(c.paperUsdFeed);
        plankPerTicket = c.plankPerTicket0;
        PLANK_USD_PER_TICKET = c.plankUsdPerTicket;
        ETH_USD_PER_TICKET = c.ethUsdPerTicket;
        MILL_BID_BASE = c.millBidBase;
        USDG = IERC20(c.usdg);
        USDG_UNIT = c.usdg == address(0) ? 0 : 10 ** IERC20Metadata(c.usdg).decimals();
        ROLL_TIME_OF_DAY = c.rollTimeOfDay;
        // The randomness adapter is deployed first and must name this contract, or no roll could ever resolve.
        (bool ok, bytes memory ret) = c.randomness.staticcall(abi.encodeWithSignature("FIRE()"));
        if (ok && ret.length >= 32 && abi.decode(ret, (address)) != address(this)) revert BadRequest();
        millBidStart = c.millBidBase;
        millBidBanked = c.millBidBase;
        millBidSince = block.timestamp;
        _light(0);
    }

    // ---------------------------------------------------------------- pricing
    /// @notice Buy 10, get 1 free: a full buy of TX_CAP pays for TX_CAP tickets and gets TX_CAP + 1. That's the only
    ///         discount. The free ticket counts like any other (odds, fire size, the daily cap) but adds no PLANK.
    function ticketsFor(uint256 n) public pure returns (uint256) {
        return n == TX_CAP ? n + FREE_WITH_FULL_BUY : n;
    }

    /// @notice ETH per ticket right now, from the ETH/USD feed. Reverts if the feed has missed its heartbeat.
    function ethPerTicket() public view returns (uint256) {
        uint256 px = _ethUsd();
        return (ETH_USD_PER_TICKET * 1e18 + px - 1) / px; // rounded up: never under the $1
    }

    /// @dev ETH/USD, 8 decimals. Reverts if the feed has missed its heartbeat.
    function _ethUsd() internal view returns (uint256) {
        (, int256 px,, uint256 updatedAt,) = ETH_USD.latestRoundData();
        if (px <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > ETH_FEED_MAX_AGE) revert StaleFeed();
        return uint256(px);
    }

    /// @notice Cost of n tickets. ethCost is 0 while the ETH/USD feed is stale (the ETH path is closed then);
    ///         the PAPER path never depends on the ETH feed.
    function quote(uint256 n) public view returns (uint256 paperCost, uint256 plankCost, uint256 ethCost) {
        (paperCost, plankCost) = _legs(n);
        (int256 px, uint256 updatedAt) = _feed(ETH_USD);
        if (px > 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= ETH_FEED_MAX_AGE) ethCost = _ethCost(n);
    }

    function _legs(uint256 n) internal view returns (uint256 paperCost, uint256 plankCost) {
        paperCost = n * paperPerTicket;
        plankCost = n * plankPerTicket;
    }

    function _ethCost(uint256 n) internal view returns (uint256) {
        return n * ethPerTicket();
    }

    /// @notice Tickets this wallet can still buy today.
    function remainingToday(address who) public view returns (uint256) {
        uint256 b = boughtOnDay[dayIndex][who];
        return b >= DAILY_CAP ? 0 : DAILY_CAP - b;
    }

    // ---------------------------------------------------------------- buying
    /// @dev Buying is closed while a roll is in flight: the drand beacon is public a few seconds before the
    ///      callback lands, and a buy in that gap could pick the winning ticket (or rescue the fire).
    /// @param maxPaper,maxPlank the most PAPER / PLANK (wei) the buyer agrees to pay for these n tickets. The legs move
    ///        a little each night; if they moved after the buyer saw the price, the buy reverts instead of charging more.
    function buyTickets(uint256 n, uint256 maxPaper, uint256 maxPlank, string calldata note) external nonReentrant {
        _open();
        if (n == 0) revert BadAmount();
        (uint256 paperCost, uint256 plankCost) = _legs(n);
        if (paperCost > maxPaper || plankCost > maxPlank) revert PriceMoved();
        PAPER.safeTransferFrom(msg.sender, DEAD, paperCost);
        _takePlank(msg.sender, plankCost);
        uint256 got = _addTickets(msg.sender, n);
        emit TicketsBought(fireId, msg.sender, got, false, note);
    }

    /// @notice No PAPER? Pay $1 a ticket in ETH instead. The ETH feeds the mill fund. Send a little over the
    ///         quote (the feed can tick before the tx lands); anything above the price comes straight back.
    ///         msg.value is the most ETH the buyer pays; maxPlank the most PLANK.
    function buyTicketsWithEth(uint256 n, uint256 maxPlank, string calldata note) external payable nonReentrant {
        _open();
        if (n == 0) revert BadAmount();
        (, uint256 plankCost) = _legs(n);
        if (plankCost > maxPlank) revert PriceMoved();
        uint256 ethCost = _ethCost(n); // reverts StaleFeed if the ETH/USD feed is stale
        if (msg.value < ethCost) revert BadAmount();
        _takePlank(msg.sender, plankCost);
        uint256 got = _addTickets(msg.sender, n);
        emit TicketsBought(fireId, msg.sender, got, true, note);
        if (msg.value > ethCost) {
            (bool ok,) = msg.sender.call{value: msg.value - ethCost}("");
            if (!ok) revert BadAmount();
        }
        _pokeMillBid();
    }

    /// @notice Same as buyTicketsWithEth, but the PAPER leg is paid in USDG (no price feed involved). It feeds the mill
    ///         fund's USDG side, which pays for mills listed in USDG.
    ///         The USDG price is fixed ($1 a ticket); maxPlank is the most PLANK the buyer pays.
    function buyTicketsWithUsdg(uint256 n, uint256 maxPlank, string calldata note) external nonReentrant {
        _open();
        if (n == 0) revert BadAmount();
        if (address(USDG) == address(0)) revert BadRequest();
        (, uint256 plankCost) = _legs(n);
        if (plankCost > maxPlank) revert PriceMoved();
        USDG.safeTransferFrom(msg.sender, address(this), usdgCost(n));
        _takePlank(msg.sender, plankCost);
        uint256 got = _addTickets(msg.sender, n);
        emit TicketsBought(fireId, msg.sender, got, true, note);
        _pokeMillBid();
    }

    /// @notice USDG for the PAPER part of n tickets, paid in dollars.
    function usdgCost(uint256 n) public view returns (uint256) {
        return n * ETH_USD_PER_TICKET * USDG_UNIT / 1e8;
    }

    function _open() internal view {
        if (abandoned) revert Over();
        if (pendingRequest != 0) revert RollPending();
    }

    function _takePlank(address from, uint256 amount) internal {
        uint256 burn = amount * PLANK_BURN_BPS / BPS;
        PLANK.safeTransferFrom(from, DEAD, burn);
        PLANK.safeTransferFrom(from, address(this), amount - burn);
        pot += amount - burn;
    }

    /// @dev n = tickets paid for; returns tickets received (n, or n + 1 for a full buy of 10).
    function _addTickets(address buyer, uint256 n) internal returns (uint256 got) {
        if (n > TX_CAP) revert TxCap();
        got = ticketsFor(n);
        if (boughtOnDay[dayIndex][buyer] + got > DAILY_CAP) revert DailyCap();
        boughtOnDay[dayIndex][buyer] += got;
        ticketsTotal += got;
        ticketsToday += got;
        fireSizeMilli += got * MILLI;
        ticketsOf[fireId][buyer] += got;
        _entries[fireId].push(Entry({buyer: buyer, cumEnd: uint128(ticketsTotal)}));
    }

    // ---------------------------------------------------------------- the nightly storm
    /// @notice Anyone can call once the roll time has passed. Requests randomness; the adapter
    ///         calls back onRandomness() to resolve the night.
    function roll() external {
        if (abandoned) revert Over();
        if (block.timestamp < nextRollAt) revert NotYet();
        if (pendingRequest != 0) revert RollPending();
        uint256 id = randomness.request();
        pendingRequest = id;
        pendingSince = block.timestamp;
        emit RollRequested(fireId, night + 1, id);
    }

    /// @notice Anyone, if a roll has had no answer for REROLL_AFTER: ask for a fresh random number.
    ///         Only possible while the provider has no result for the pending request. Once it has one, that
    ///         result is final — deliver it with the adapter's settle() instead — so a known number can't be
    ///         thrown away for a new draw.
    function reroll() external {
        uint256 old = pendingRequest;
        if (old == 0) revert BadRequest();
        if (block.timestamp < pendingSince + REROLL_AFTER) revert NotYet();
        if (randomness.answered(old)) revert Answered();
        uint256 id = randomness.request();
        pendingRequest = id;
        pendingSince = block.timestamp;
        emit Rerolled(fireId, night + 1, old, id);
    }

    /// @notice Anyone, last resort: a roll has been stuck for ABANDON_AFTER (randomness gone for good, or a result
    ///         that can't be delivered). Ends the game for good. The current fire's pot is set aside and each of its
    ///         ticket holders claims their share with refund(). Buying and rolling stop; the mill fund keeps buying
    ///         mills as before. With no tickets in the fire, the pot is burned.
    function abandon() external nonReentrant {
        if (pendingRequest == 0 || abandoned) revert BadRequest();
        if (block.timestamp < pendingSince + ABANDON_AFTER) revert NotYet();
        abandoned = true;
        pendingRequest = 0;
        uint256 p = pot;
        pot = 0;
        emit Abandoned(fireId, p, ticketsTotal);
        if (ticketsTotal == 0) {
            if (!_trySend(DEAD, p)) refundPot = p; // unreachable in practice; kept rather than lost
            return;
        }
        refundPot = p;
        refundTickets = ticketsTotal;
    }

    /// @notice After abandon(): your share of the last fire's pot, by tickets held. Once per wallet.
    function refund() external nonReentrant {
        if (!abandoned || refundTickets == 0) revert BadRequest();
        uint256 mine = ticketsOf[fireId][msg.sender];
        if (mine == 0 || refunded[msg.sender]) revert Nothing();
        refunded[msg.sender] = true;
        uint256 amount = refundPot * mine / refundTickets;
        PLANK.safeTransfer(msg.sender, amount);
        emit Refunded(msg.sender, amount);
    }

    /// @notice A winner whose prize couldn't be sent when the fire went out claims it here, to any address.
    function claim(address to) external nonReentrant {
        uint256 amount = unclaimed[msg.sender];
        if (amount == 0) revert Nothing();
        unclaimed[msg.sender] = 0;
        unclaimedTotal -= amount;
        PLANK.safeTransfer(to, amount);
        emit Claimed(msg.sender, to, amount);
    }

    function onRandomness(uint256 requestId, uint256 rnd) external nonReentrant {
        if (msg.sender != address(randomness)) revert NotRandomness();
        if (requestId != pendingRequest || requestId == 0) revert BadRequest();
        pendingRequest = 0;

        night += 1;
        uint256 storm = stormStrength(night, rnd);
        uint256 sizeBefore = fireSizeMilli;

        _pushTrail(ticketsToday);
        ticketsToday = 0;
        dayIndex += 1;
        nextRollAt = _nextRollTime(block.timestamp);
        _ratchetPlankLeg();
        _ratchetPaperLeg();
        _pokeMillBid();

        // The storm takes a bite. What's left burns down to 60% overnight and is tomorrow's starting size.
        // Night 1 has no storm. Night 24 is infinite. A fire with nothing in it goes out.
        if (night == 1 || (night < MAX_NIGHTS && sizeBefore > storm)) {
            fireSizeMilli = (sizeBefore - storm) * KEEP_BPS / BPS;
            emit Survived(fireId, night, sizeBefore, storm);
            return;
        }
        _goOut(sizeBefore, storm, rnd);
    }

    /// @notice Storm on a given night for a given random word, in thousandths of a ticket (checked night for night
    ///         against sim/fire_sim.py by test/FireSimParity.t.sol):
    ///         storm = trailingAvg x ((night-1)/8)^1.5 x L, with L ~ lognormal(0, 1.5).
    ///         Night 1: no storm. Night 24+: infinite.
    function stormStrength(uint256 n, uint256 rnd) public view returns (uint256) {
        if (n >= MAX_NIGHTS) return type(uint256).max;
        if (n <= 1) return 0;
        return _trailingMilli() * _ageBps(n) * _luckBps(rnd) / (BPS * BPS);
    }

    /// @dev ((n-1)/8)^1.5 in bps, n = 2..23.
    function _ageBps(uint256 n) internal pure returns (uint256) {
        uint24[22] memory a = [
            uint24(442), 1250, 2296, 3536, 4941, 6495, 8185, 10000, 11932, 13975, 16123,
            18371, 20715, 23150, 25674, 28284, 30977, 33750, 36601, 39528, 42530, 45604
        ];
        return a[n - 2];
    }

    /// @dev 32-point quantile table of e^(1.5 z), picked by the low 5 bits of the random word. Wide on purpose: most
    ///      nights are mild, but now and then a storm is many times the usual, so a young fire can go out early.
    function _luckBps(uint256 rnd) internal pure returns (uint256) {
        uint24[32] memory q = [
            uint24(395), 810, 1192, 1581, 1986, 2417, 2877, 3373, 3910, 4493, 5129, 5826, 6593, 7440, 8381, 9429,
            10605, 11932, 13440, 15167, 17163, 19496, 22258, 25578, 29647, 34756, 41378, 50343, 63268, 83871, 123531, 253002
        ];
        return q[rnd & 31];
    }

    /// @dev The trailing average in thousandths of a ticket (exact to the thousandth, so 1.4 a day stays 1.4).
    function _trailingMilli() internal view returns (uint256) {
        if (_trailCount == 0) return ticketsToday * MILLI;
        uint256 sum;
        uint256 c = _trailCount < TRAILING ? _trailCount : TRAILING;
        for (uint256 i; i < c; i++) sum += _trail[i];
        return sum * MILLI / c;
    }

    /// @notice Tickets per night over the last (up to) 7 nights, whole tickets. The storm uses the exact value.
    function trailingAverage() public view returns (uint256) {
        if (_trailCount == 0) return ticketsToday;
        uint256 sum;
        uint256 c = _trailCount < TRAILING ? _trailCount : TRAILING;
        for (uint256 i; i < c; i++) sum += _trail[i];
        return sum / c;
    }

    function _pushTrail(uint256 v) internal {
        _trail[_trailIdx] = v;
        _trailIdx = (_trailIdx + 1) % TRAILING;
        _trailCount += 1;
    }

    function _nextRollTime(uint256 ts) internal view returns (uint256) {
        uint256 dayStart = ts - (ts % 1 days);
        uint256 t = dayStart + ROLL_TIME_OF_DAY;
        if (t <= ts) t += 1 days;
        return t;
    }

    // ---------------------------------------------------------------- going out
    function _goOut(uint256 sizeBefore, uint256 storm, uint256 rnd) internal {
        address winner = _pickWinner(rnd);
        uint256 p = pot;
        uint256 winnerSlice = p * WINNER_BPS / BPS;
        uint256 burnSlice = p * BURN_BPS / BPS;
        uint256 royaltySlice = p * ROYALTY_BPS / BPS;
        uint256 carry = p - winnerSlice - burnSlice - royaltySlice;

        pot = 0;
        uint256 paid;
        // A payout that fails (e.g. the token refuses a recipient) must not revert the night — that would leave the
        // roll pending forever. The winner's prize is kept for them to claim(); a failed pool or burn transfer stays
        // in the contract and relights the next fire.
        if (winner != address(0)) {
            if (_trySend(winner, winnerSlice)) paid = winnerSlice;
            else {
                unclaimed[winner] += winnerSlice;
                unclaimedTotal += winnerSlice;
                emit PayoutOwed(winner, winnerSlice);
            }
            if (!_trySend(ROYALTY_POOL, royaltySlice)) carry += royaltySlice;
        } else {
            // Nobody had a ticket: nothing burns, nothing is paid; the whole pot waits for the next fire.
            carry = p;
            burnSlice = 0;
        }
        if (!_trySend(DEAD, burnSlice)) carry += burnSlice;
        lastWinner = winner;
        emit WentOut(fireId, night, sizeBefore, storm, winner, paid);
        _light(carry);
    }

    /// @dev PLANK transfer that reports failure instead of reverting (handles tokens with or without a bool return).
    function _trySend(address to, uint256 amount) internal returns (bool ok) {
        if (amount == 0) return true;
        bytes memory ret;
        (ok, ret) = address(PLANK).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        ok = ok && (ret.length == 0 ? address(PLANK).code.length > 0 : ret.length >= 32 && uint256(bytes32(ret)) == 1);
        if (!ok) emit PayoutCarried(to, amount);
    }

    function _pickWinner(uint256 rnd) internal view returns (address) {
        Entry[] storage e = _entries[fireId];
        if (ticketsTotal == 0 || e.length == 0) return address(0);
        uint256 target = (uint256(keccak256(abi.encode(rnd, "winner"))) % ticketsTotal) + 1;
        uint256 lo;
        uint256 hi = e.length - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (e[mid].cumEnd >= target) hi = mid;
            else lo = mid + 1;
        }
        return e[lo].buyer;
    }

    function _light(uint256 carried) internal {
        fireId += 1;
        night = 0;
        pot = carried;
        ticketsTotal = 0;
        ticketsToday = 0;
        fireSizeMilli = 0;
        nextRollAt = _nextRollTime(block.timestamp);
        emit Lit(fireId, carried);
    }

    // ---------------------------------------------------------------- the mill fund
    /// @notice The most the fire will pay for a mill right now, in USD (8 decimals). A reverse auction that follows the
    ///         floor: while nobody sells, the bid climbs 25% of its restart point per day (about 1% an hour) — but only
    ///         while the fund could actually pay it, and never above what the fund held when last counted, nor past 3x
    ///         its restart point. An empty fund doesn't build up a high bid for the next dollar to be sold into. After
    ///         each purchase the bid restarts at 90% of the price paid. Listings in USDG are taken at face value and ETH
    ///         listings are converted at the ETH/USD feed; the fire pays the listing's own price in its own currency, so
    ///         any listing at or under the bid is swept at its price. The fire only ever buys on the open market.
    function millBid() public view returns (uint256) {
        uint256 banked = millBidBanked;
        uint256 ceiling = millFundUsdAt;
        if (ceiling <= banked) return banked; // the fund can't pay more than this: hold
        uint256 start = millBidStart;
        uint256 cap = start * BID_MAX_MULT;
        if (cap < ceiling) ceiling = cap;
        uint256 bid = banked + start * BID_RISE_BPS_PER_DAY * (block.timestamp - millBidSince) / BPS / 1 days;
        return bid > ceiling ? (ceiling > banked ? ceiling : banked) : bid;
    }

    /// @notice Anyone: bring the mill bid up to date with the fund (e.g. after someone sent the fund USDG or ETH
    ///         directly). Ticket buys, mill purchases and every roll do this already.
    function pokeMillBid() external nonReentrant {
        _pokeMillBid();
    }

    function _pokeMillBid() internal {
        millBidBanked = millBid();
        millBidSince = block.timestamp;
        millFundUsdAt = _fundUsd();
        emit MillBidUpdated(millBidBanked, millFundUsdAt);
    }

    /// @dev What the fund could pay for one mill, in USD (8 dec): the larger side, since a listing is paid in one
    ///      currency. A stale or broken ETH feed counts the ETH side as 0 (never reverts; called from the nightly roll).
    function _fundUsd() internal view returns (uint256 usd) {
        if (address(USDG) != address(0)) {
            (bool okb, bytes memory rb) = address(USDG).staticcall(abi.encodeCall(IERC20.balanceOf, (address(this))));
            if (okb && rb.length >= 32) usd = abi.decode(rb, (uint256)) * 1e8 / USDG_UNIT;
        }
        (int256 px, uint256 updatedAt) = _feed(ETH_USD);
        if (px <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > ETH_FEED_MAX_AGE) return usd;
        uint256 ethSide = address(this).balance * uint256(px) / 1e18;
        if (ethSide > usd) usd = ethSide;
    }

    /// @dev A price feed read that never reverts (no code, a revert, or a short/garbled answer all read as 0), so a
    ///      broken feed can only make a leg hold — never block the nightly roll.
    function _feed(IPriceFeed f) internal view returns (int256 px, uint256 updatedAt) {
        (bool ok, bytes memory ret) = address(f).staticcall(abi.encodeCall(IPriceFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) return (0, 0);
        (, px,, updatedAt,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
    }

    /// @dev Move plankPerTicket at most 5% per night toward the USD target. A thin pool can be pushed for
    ///      minutes, not for days, so the leg can't be gamed inside a night. If the feed is stale, hold.
    function _ratchetPlankLeg() internal {
        (int256 px, uint256 updatedAt) = _feed(PLANK_USD); // a broken feed must not revert the night; the leg holds
        if (px <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > 2 days) return;
        // plank wei per ticket = (USD per ticket, 8 dec) * 1e18 wei/PLANK * 1e10 / (USD per PLANK, 18 dec)
        uint256 target = PLANK_USD_PER_TICKET * 1e28 / uint256(px);
        uint256 cur = plankPerTicket;
        uint256 maxUp = cur * (BPS + PLANK_RATCHET_BPS) / BPS;
        uint256 maxDown = cur * (BPS - PLANK_RATCHET_BPS) / BPS;
        plankPerTicket = target > maxUp ? maxUp : target < maxDown ? maxDown : target;
    }

    /// @dev Keep the PAPER leg worth at most PAPER_USD_CAP: 1 PAPER while PAPER is cheap, fewer once it trades above
    ///      the cap, so a PAPER rally never makes tickets expensive (the prize is PLANK). Moves at most 5% a night, from
    ///      a >= 20h average price. No price (no PAPER market yet, stale or broken feed): hold.
    function _ratchetPaperLeg() internal {
        if (address(PAPER_USD) == address(0)) return;
        (int256 px, uint256 updatedAt) = _feed(PAPER_USD);
        if (px <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > 2 days) return;
        // PAPER wei worth the cap = (USD cap, 8 dec) * 1e28 / (USD per PAPER, 18 dec); never more than PAPER_PER_TICKET
        uint256 target = PAPER_USD_CAP * 1e28 / uint256(px);
        if (target > PAPER_PER_TICKET) target = PAPER_PER_TICKET;
        uint256 cur = paperPerTicket;
        uint256 maxUp = cur * (BPS + PLANK_RATCHET_BPS) / BPS;
        uint256 maxDown = cur * (BPS - PLANK_RATCHET_BPS) / BPS;
        uint256 next = target > maxUp ? maxUp : target < maxDown ? maxDown : target;
        paperPerTicket = next > PAPER_PER_TICKET ? PAPER_PER_TICKET : next;
    }

    /// @notice The mill fund's USDG side.
    function millFundUsdg() public view returns (uint256) {
        return address(USDG) == address(0) ? 0 : USDG.balanceOf(address(this));
    }

    /// @notice The mill fund's ETH side.
    function millFund() public view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Anyone: fill a Seaport listing for a mill (priced in ETH or USDG) at or under the fire's bid, then burn
    ///         it. Anyone may call this with any signed listing, including their own: the bid is a standing offer.
    ///         A caller may attach the mill's ETH burn fee; anything attached above it is refunded.
    /// @param extraData the listing's zone data, if its zone needs any (OpenSea supplies it with the listing's
    ///        fulfillment data for this fire as the fulfiller); empty for an open listing.
    function eatMillFromSeaport(ISeaport.Order calldata order, bytes calldata extraData) external payable nonReentrant {
        if (address(SEAPORT) == address(0)) revert NoSeaport();
        ISeaport.OrderParameters calldata p = order.parameters;
        if (p.offer.length != 1 || p.offer[0].token != address(MILL) || p.offer[0].itemType != 2) revert BadRequest();
        // No fulfiller "tips": Seaport pays consideration items beyond totalOriginalConsiderationItems without the
        // seller's signature covering them, so a caller could fill a cheap listing and tip itself up to millBid.
        if (p.consideration.length != p.totalOriginalConsiderationItems || p.consideration.length == 0) revert BadRequest();
        // Every item in one currency: all native ETH, or all USDG.
        bool inEth = p.consideration[0].itemType == 0;
        uint256 tokenId = p.offer[0].identifierOrCriteria;
        uint256 total;
        for (uint256 i; i < p.consideration.length; i++) {
            ISeaport.ConsiderationItem calldata c = p.consideration[i];
            if (inEth ? c.itemType != 0 : (c.itemType != 1 || c.token != address(USDG) || address(USDG) == address(0))) {
                revert BadRequest();
            }
            total += c.startAmount > c.endAmount ? c.startAmount : c.endAmount; // worst case of a timed price
        }
        uint256 usd = inEth ? total * _ethUsd() / 1e18 : total * 1e8 / USDG_UNIT;
        if (usd > millBid()) revert TooExpensive();
        uint256 fee = MILL.burnFee(); // always ETH; a caller may attach it (up to fee; the rest comes back below)
        if (address(this).balance < (inEth ? total : 0) + fee) revert FundTooSmall();
        if (!inEth) {
            if (USDG.balanceOf(address(this)) < total) revert FundTooSmall();
            USDG.forceApprove(address(SEAPORT), total);
        }
        bool ok = SEAPORT.fulfillAdvancedOrder{value: inEth ? total : 0}(
            ISeaport.AdvancedOrder({parameters: p, numerator: 1, denominator: 1, signature: order.signature, extraData: extraData}),
            new ISeaport.CriteriaResolver[](0),
            bytes32(0),
            address(this)
        );
        if (!inEth) USDG.forceApprove(address(SEAPORT), 0);
        require(ok && MILL.ownerOf(tokenId) == address(this), "fill failed");
        uint256 released = _burnMill(tokenId, fee);
        uint256 restart = usd * BID_RESTART_BPS / BPS;
        uint256 minStart = MILL_BID_BASE / 10; // a free or near-free listing can't park the bid at ~0
        millBidStart = restart > minStart ? restart : minStart;
        millBidBanked = millBidStart;
        millBidSince = block.timestamp;
        millFundUsdAt = _fundUsd();
        emit MillBidUpdated(millBidBanked, millFundUsdAt);
        emit MillEaten(tokenId, p.offerer, inEth ? address(0) : address(USDG), total, usd, released);
        if (msg.value > fee) {
            (bool sent,) = msg.sender.call{value: msg.value - fee}("");
            if (!sent) revert BadAmount();
        }
    }

    function _burnMill(uint256 tokenId, uint256 fee) internal returns (uint256 released) {
        if (block.timestamp < MILL.mintingSunset()) revert NotBurnableYet();
        uint256 before = PLANK.balanceOf(address(this));
        MILL.burn{value: fee}(tokenId);
        released = PLANK.balanceOf(address(this)) - before;
        if (released > 0) PLANK.safeTransfer(ROYALTY_POOL, released);
    }

    // No onERC721Received: Seaport moves the mill with transferFrom, and a mill "safe-sent" here by mistake bounces
    // instead of being stuck forever.

    // ---------------------------------------------------------------- views
    /// @notice What the wallet can claim: an unpaid prize, and (after abandon) its refund share.
    function claimable(address who) external view returns (uint256 prize, uint256 refundShare) {
        prize = unclaimed[who];
        if (abandoned && refundTickets > 0 && !refunded[who]) refundShare = refundPot * ticketsOf[fireId][who] / refundTickets;
    }

    function entriesLength() external view returns (uint256) {
        return _entries[fireId].length;
    }

    function odds(address who) external view returns (uint256 mine, uint256 total) {
        return (ticketsOf[fireId][who], ticketsTotal);
    }

    receive() external payable {}
}
