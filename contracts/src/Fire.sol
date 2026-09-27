// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "openzeppelin-contracts/contracts/token/ERC721/IERC721Receiver.sol";
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

/// @notice Minimal Seaport 1.6 surface for filling a fixed-price ETH listing.
interface ISeaport {
    struct OfferItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; }
    struct ConsiderationItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; address payable recipient; }
    struct OrderParameters { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 totalOriginalConsiderationItems; }
    struct Order { OrderParameters parameters; bytes signature; }
    function fulfillOrder(Order calldata order, bytes32 fulfillerConduitKey) external payable returns (bool fulfilled);
}

/**
 * @title The Fire
 * @notice Buy tickets with PAPER + PLANK. PAPER burns. Half the PLANK burns, half feeds the fire.
 *         Every night a storm rolls in; a big fire survives, a small one dies. When the fire goes
 *         out, one ticket wins 40% of the pot, 30% burns, 30% relights the next fire.
 *
 *         There is no function that withdraws the pot or the ETH fund. Funds only leave through
 *         the rules below.
 */
contract Fire is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- constants
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BPS = 10_000;
    uint256 public constant WINNER_BPS = 4_000;
    uint256 public constant BURN_BPS = 3_000;
    uint256 public constant CARRY_BPS = 3_000;
    uint256 public constant TITHE_BPS = 500; // of the winner slice -> royalty pool
    uint256 public constant PLANK_BURN_BPS = 5_000; // of every PLANK feed
    uint256 public constant MAX_NIGHTS = 24; // the night-24 storm is infinite
    uint256 public constant KEEP_BPS = 6_000; // the fire keeps 60% of its size overnight
    uint256 public constant TRAILING = 7;
    uint256 public constant BID_STEP_BPS = 500; // mill bid +5% per unfilled night
    uint256 public constant DAILY_CAP = 500; // tickets per wallet per day
    uint256 public constant TX_CAP = 10; // tickets per transaction
    uint256 public constant PLANK_RATCHET_BPS = 500; // PLANK leg moves at most 5% per night toward target
    uint256 public constant REROLL_AFTER = 30 minutes; // a roll normally resolves in ~10s
    /// @dev Chainlink ETH/USD updates on price deviation plus a 24h heartbeat; on Robinhood Chain gaps of 3-6h are
    ///      normal (observed Sep 2026). A quiet feed is still accurate, so only a missed heartbeat counts as stale.
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours;

    // ---------------------------------------------------------------- immutables
    IERC20 public immutable PAPER;
    IERC20 public immutable PLANK;
    IMill public immutable MILL;
    ISeaport public immutable SEAPORT; // address(0) disables mill buying entirely
    address public immutable ROYALTY_POOL;
    uint256 public immutable PAPER_PER_TICKET; // in PAPER wei (1 PAPER)
    uint256 public immutable ETH_USD_PER_TICKET; // "paper from the fire" price, USD 8-decimals (e.g. 1e8 = $1)
    uint256 public immutable PLANK_USD_PER_TICKET; // PLANK leg target, USD 8-decimals
    IPriceFeed public immutable ETH_USD; // Chainlink ETH/USD
    IPriceFeed public immutable PLANK_USD; // PLANK/USD, **18 decimals** (our TWAP adapter)
    uint256 public plankPerTicket; // in PLANK wei; ratchets nightly toward the USD target
    uint256 public immutable MILL_BID_BASE; // starting ETH bid for a mill, in wei
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
    uint256 public fireSize; // persistent: buys add, storms subtract, burns down 40% each night
    uint256 public ticketsTotal;
    address public lastWinner;

    mapping(uint256 => Entry[]) internal _entries; // fireId -> entries
    mapping(uint256 => mapping(address => uint256)) public ticketsOf; // fireId -> buyer -> tickets
    mapping(uint256 => mapping(address => uint256)) public boughtOnDay; // dayIndex -> buyer -> tickets
    uint256 public dayIndex; // increments every roll

    uint256[TRAILING] internal _trail;
    uint256 internal _trailCount;
    uint256 internal _trailIdx;

    uint256 public millBid; // current ETH bid for one mill
    bool internal _millBoughtSinceRoll;

    uint256 public pendingRequest; // randomness request in flight (0 = none)
    uint256 public pendingSince; // when it was requested

    // ---------------------------------------------------------------- events
    event TicketsBought(uint256 indexed fireId, address indexed buyer, uint256 tickets, bool withEth, string note);
    event RollRequested(uint256 indexed fireId, uint256 night, uint256 requestId);
    event Rerolled(uint256 indexed fireId, uint256 night, uint256 oldRequestId, uint256 newRequestId);
    event PayoutCarried(address indexed to, uint256 amount); // a payout transfer failed; its PLANK stays in the next pot
    event Survived(uint256 indexed fireId, uint256 night, uint256 fireSize, uint256 storm);
    event WentOut(uint256 indexed fireId, uint256 night, uint256 fireSize, uint256 storm, address winner, uint256 paid);
    event Lit(uint256 indexed fireId, uint256 carried);
    event MillEaten(uint256 indexed tokenId, address seller, uint256 paidEth, uint256 plankToRoyalty);

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

    struct Config {
        address paper;
        address plank;
        address mill;
        address seaport;
        address royaltyPool;
        address randomness;
        address ethUsdFeed;
        address plankUsdFeed;
        uint256 paperPerTicket;
        uint256 plankPerTicket0;
        uint256 plankUsdPerTicket;
        uint256 ethUsdPerTicket;
        uint256 millBidBase;
        uint256 rollTimeOfDay;
    }

    constructor(Config memory c) {
        PAPER = IERC20(c.paper);
        PLANK = IERC20(c.plank);
        MILL = IMill(c.mill);
        SEAPORT = ISeaport(c.seaport);
        ROYALTY_POOL = c.royaltyPool;
        randomness = IRandomness(c.randomness);
        ETH_USD = IPriceFeed(c.ethUsdFeed);
        PLANK_USD = IPriceFeed(c.plankUsdFeed);
        PAPER_PER_TICKET = c.paperPerTicket;
        plankPerTicket = c.plankPerTicket0;
        PLANK_USD_PER_TICKET = c.plankUsdPerTicket;
        ETH_USD_PER_TICKET = c.ethUsdPerTicket;
        MILL_BID_BASE = c.millBidBase;
        ROLL_TIME_OF_DAY = c.rollTimeOfDay;
        millBid = c.millBidBase;
        _light(0);
    }

    // ---------------------------------------------------------------- pricing
    /// @notice Bundle discount in bps of full price: a full 10 -> 97%, else 100%.
    function priceBps(uint256 n) public pure returns (uint256) {
        return n >= TX_CAP ? 9_700 : BPS;
    }

    /// @notice ETH per ticket right now, from the ETH/USD feed. Reverts if the feed has missed its heartbeat.
    function ethPerTicket() public view returns (uint256) {
        (, int256 px,, uint256 updatedAt,) = ETH_USD.latestRoundData();
        if (px <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > ETH_FEED_MAX_AGE) revert StaleFeed();
        return ETH_USD_PER_TICKET * 1e18 / uint256(px);
    }

    /// @notice Cost of n tickets. ethCost is 0 while the ETH/USD feed is stale (the ETH path is closed then);
    ///         the PAPER path never depends on the ETH feed.
    function quote(uint256 n) public view returns (uint256 paperCost, uint256 plankCost, uint256 ethCost) {
        (paperCost, plankCost) = _legs(n);
        (, int256 px,, uint256 updatedAt,) = ETH_USD.latestRoundData();
        if (px > 0 && updatedAt <= block.timestamp && block.timestamp - updatedAt <= ETH_FEED_MAX_AGE) ethCost = _ethCost(n);
    }

    function _legs(uint256 n) internal view returns (uint256 paperCost, uint256 plankCost) {
        uint256 bps = priceBps(n);
        paperCost = n * PAPER_PER_TICKET * bps / BPS;
        plankCost = n * plankPerTicket * bps / BPS;
    }

    function _ethCost(uint256 n) internal view returns (uint256) {
        return n * ethPerTicket() * priceBps(n) / BPS;
    }

    /// @notice Tickets this wallet can still buy today.
    function remainingToday(address who) public view returns (uint256) {
        uint256 b = boughtOnDay[dayIndex][who];
        return b >= DAILY_CAP ? 0 : DAILY_CAP - b;
    }

    // ---------------------------------------------------------------- buying
    /// @dev Buying is closed while a roll is in flight: the drand beacon is public a few seconds before the
    ///      callback lands, and a buy in that gap could pick the winning ticket (or rescue the fire).
    function buyTickets(uint256 n, string calldata note) external nonReentrant {
        if (pendingRequest != 0) revert RollPending();
        if (n == 0) revert BadAmount();
        (uint256 paperCost, uint256 plankCost) = _legs(n);
        PAPER.safeTransferFrom(msg.sender, DEAD, paperCost);
        _takePlank(msg.sender, plankCost);
        _addTickets(msg.sender, n);
        emit TicketsBought(fireId, msg.sender, n, false, note);
    }

    /// @notice No PAPER? Buy it from the fire with ETH. The ETH feeds the mill fund. Send a little over the
    ///         quote (the feed can tick before the tx lands); anything above the price comes straight back.
    function buyTicketsWithEth(uint256 n, string calldata note) external payable nonReentrant {
        if (pendingRequest != 0) revert RollPending();
        if (n == 0) revert BadAmount();
        (, uint256 plankCost) = _legs(n);
        uint256 ethCost = _ethCost(n); // reverts StaleFeed if the ETH/USD feed is stale
        if (msg.value < ethCost) revert BadAmount();
        _takePlank(msg.sender, plankCost);
        _addTickets(msg.sender, n);
        emit TicketsBought(fireId, msg.sender, n, true, note);
        if (msg.value > ethCost) {
            (bool ok,) = msg.sender.call{value: msg.value - ethCost}("");
            if (!ok) revert BadAmount();
        }
    }

    function _takePlank(address from, uint256 amount) internal {
        uint256 burn = amount * PLANK_BURN_BPS / BPS;
        PLANK.safeTransferFrom(from, DEAD, burn);
        PLANK.safeTransferFrom(from, address(this), amount - burn);
        pot += amount - burn;
    }

    function _addTickets(address buyer, uint256 n) internal {
        if (n > TX_CAP) revert TxCap();
        if (boughtOnDay[dayIndex][buyer] + n > DAILY_CAP) revert DailyCap();
        boughtOnDay[dayIndex][buyer] += n;
        ticketsTotal += n;
        ticketsToday += n;
        fireSize += n;
        ticketsOf[fireId][buyer] += n;
        _entries[fireId].push(Entry({buyer: buyer, cumEnd: uint128(ticketsTotal)}));
    }

    // ---------------------------------------------------------------- the nightly storm
    /// @notice Anyone can call once the roll time has passed. Requests randomness; the adapter
    ///         calls back onRandomness() to resolve the night.
    function roll() external {
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

    function onRandomness(uint256 requestId, uint256 rnd) external nonReentrant {
        if (msg.sender != address(randomness)) revert NotRandomness();
        if (requestId != pendingRequest || requestId == 0) revert BadRequest();
        pendingRequest = 0;

        night += 1;
        uint256 storm = stormStrength(night, rnd);
        uint256 sizeBefore = fireSize;

        _pushTrail(ticketsToday);
        ticketsToday = 0;
        dayIndex += 1;
        nextRollAt = _nextRollTime(block.timestamp);
        _ratchetMillBid();
        _ratchetPlankLeg();

        // The storm takes a bite. What's left burns down to 60% overnight and is tomorrow's starting size.
        // Night 1 has no storm. Night 24 is infinite. A fire with nothing in it goes out.
        if (night == 1 || (night < MAX_NIGHTS && sizeBefore > storm)) {
            fireSize = (sizeBefore - storm) * KEEP_BPS / BPS;
            emit Survived(fireId, night, sizeBefore, storm);
            return;
        }
        _goOut(sizeBefore, storm, rnd);
    }

    /// @notice Storm on a given night for a given random word (tuned in sim/storm_v3.py):
    ///         storm = trailingAvg x ((night-1)/8)^1.5 x L, with L ~ lognormal(0, 0.9).
    ///         Night 1: no storm. Night 24+: infinite.
    function stormStrength(uint256 n, uint256 rnd) public view returns (uint256) {
        if (n >= MAX_NIGHTS) return type(uint256).max;
        if (n <= 1) return 0;
        return trailingAverage() * _ageBps(n) / BPS * _luckBps(rnd) / BPS;
    }

    /// @dev ((n-1)/8)^1.5 in bps, n = 2..23.
    function _ageBps(uint256 n) internal pure returns (uint256) {
        uint24[22] memory a = [
            uint24(442), 1250, 2296, 3536, 4941, 6495, 8185, 10000, 11932, 13975, 16123,
            18371, 20715, 23150, 25674, 28284, 30977, 33750, 36601, 39528, 42530, 45604
        ];
        return a[n - 2];
    }

    /// @dev 32-point quantile table of e^(0.9 z), picked by the low 5 bits of the random word.
    function _luckBps(uint256 rnd) internal pure returns (uint256) {
        uint24[32] memory q = [
            uint24(1439), 2213, 2791, 3306, 3792, 4265, 4736, 5210, 5692, 6187, 6699, 7232, 7789, 8375, 8994, 9654,
            10359, 11118, 11941, 12839, 13828, 14927, 16162, 17568, 19195, 21116, 23446, 26373, 30249, 35823, 45192, 69482
        ];
        return q[rnd & 31];
    }

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
        uint256 carry = p - winnerSlice - burnSlice;
        uint256 tithe = winnerSlice * TITHE_BPS / BPS;

        pot = 0;
        uint256 paid;
        // A payout that fails (e.g. the token refuses a recipient) must not revert the night — that would leave the
        // roll pending forever. Whatever can't be sent stays in the contract and relights the next fire.
        if (winner != address(0)) {
            if (_trySend(winner, winnerSlice - tithe)) paid = winnerSlice - tithe;
            else carry += winnerSlice - tithe;
            if (!_trySend(ROYALTY_POOL, tithe)) carry += tithe;
        } else {
            // no tickets at all: winner slice rolls into the carry
            carry += winnerSlice;
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
        fireSize = 0;
        nextRollAt = _nextRollTime(block.timestamp);
        emit Lit(fireId, carried);
    }

    // ---------------------------------------------------------------- the mill fund
    /// @notice The most the fire will pay for a floor mill on OpenSea. Ticks up 5% every night it doesn't
    ///         manage to buy one, resets to base when it does. The fire only ever buys on the open market;
    ///         nobody hands the fire a mill.
    function _ratchetMillBid() internal {
        if (_millBoughtSinceRoll) {
            millBid = MILL_BID_BASE;
            _millBoughtSinceRoll = false;
        } else {
            millBid = millBid * (BPS + BID_STEP_BPS) / BPS;
        }
    }

    /// @dev Move plankPerTicket at most 5% per night toward the USD target. A thin pool can be pushed for
    ///      minutes, not for days, so the leg can't be gamed inside a night. If the feed is stale, hold.
    function _ratchetPlankLeg() internal {
        int256 px;
        uint256 updatedAt;
        // A broken feed must not revert the night; the leg just holds.
        try PLANK_USD.latestRoundData() returns (uint80, int256 a, uint256, uint256 u, uint80) { (px, updatedAt) = (a, u); }
        catch { return; }
        if (px <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > 2 days) return;
        // plank wei per ticket = (USD per ticket, 8 dec) * 1e18 wei/PLANK * 1e10 / (USD per PLANK, 18 dec)
        uint256 target = PLANK_USD_PER_TICKET * 1e28 / uint256(px);
        uint256 cur = plankPerTicket;
        uint256 maxUp = cur * (BPS + PLANK_RATCHET_BPS) / BPS;
        uint256 maxDown = cur * (BPS - PLANK_RATCHET_BPS) / BPS;
        plankPerTicket = target > maxUp ? maxUp : target < maxDown ? maxDown : target;
    }

    function millFund() public view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Anyone: fill an OpenSea (Seaport) fixed-price ETH listing for a mill at or under the fire's bid,
    ///         then burn it. The listing's total ETH consideration must be <= millBid.
    function eatMillFromSeaport(ISeaport.Order calldata order) external nonReentrant {
        if (address(SEAPORT) == address(0)) revert NoSeaport();
        ISeaport.OrderParameters calldata p = order.parameters;
        if (p.offer.length != 1 || p.offer[0].token != address(MILL) || p.offer[0].itemType != 2) revert BadRequest();
        // No fulfiller "tips": Seaport pays consideration items beyond totalOriginalConsiderationItems without the
        // seller's signature covering them, so a caller could fill a cheap listing and tip itself up to millBid.
        if (p.consideration.length != p.totalOriginalConsiderationItems) revert BadRequest();
        uint256 tokenId = p.offer[0].identifierOrCriteria;
        uint256 total;
        for (uint256 i; i < p.consideration.length; i++) {
            ISeaport.ConsiderationItem calldata c = p.consideration[i];
            if (c.itemType != 0) revert BadRequest(); // native ETH only
            total += c.startAmount > c.endAmount ? c.startAmount : c.endAmount; // worst case of a timed price
        }
        uint256 fee = MILL.burnFee();
        if (total > millBid) revert TooExpensive();
        if (address(this).balance < total + fee) revert FundTooSmall();
        bool ok = SEAPORT.fulfillOrder{value: total}(order, bytes32(0));
        require(ok && MILL.ownerOf(tokenId) == address(this), "fill failed");
        uint256 released = _burnMill(tokenId, fee);
        _millBoughtSinceRoll = true;
        emit MillEaten(tokenId, p.offerer, total, released);
    }

    function _burnMill(uint256 tokenId, uint256 fee) internal returns (uint256 released) {
        if (block.timestamp < MILL.mintingSunset()) revert NotBurnableYet();
        uint256 before = PLANK.balanceOf(address(this));
        MILL.burn{value: fee}(tokenId);
        released = PLANK.balanceOf(address(this)) - before;
        if (released > 0) PLANK.safeTransfer(ROYALTY_POOL, released);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ---------------------------------------------------------------- views
    function entriesLength() external view returns (uint256) {
        return _entries[fireId].length;
    }

    function odds(address who) external view returns (uint256 mine, uint256 total) {
        return (ticketsOf[fireId][who], ticketsTotal);
    }

    receive() external payable {}
}
