// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "openzeppelin-contracts/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @notice Randomness adapter. Fire calls request(); the adapter later calls Fire.onRandomness().
interface IRandomness {
    function request() external returns (uint256 requestId);
}

/// @notice Chainlink-style USD price feed (8 decimals).
interface IPriceFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/// @notice The Paper Mill contract's burn. Exact signature TBD once the contract is read.
interface IMill is IERC721 {
    function burn(uint256 tokenId) external;
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
    uint256 public constant STORM_SCALE_NIGHT = 8; // storm ~ trailing avg at this age
    uint256 public constant TRAILING = 7;
    uint256 public constant BID_STEP_BPS = 500; // mill bid +5% per unfilled night
    uint256 public constant DAILY_CAP = 500; // tickets per wallet per day
    uint256 public constant PLANK_RATCHET_BPS = 500; // PLANK leg moves at most 5% per night toward target
    uint256 public constant NAME_COUNT = 48;

    // ---------------------------------------------------------------- immutables
    IERC20 public immutable PAPER;
    IERC20 public immutable PLANK;
    IMill public immutable MILL;
    address public immutable ROYALTY_POOL;
    uint256 public immutable PAPER_PER_TICKET; // in PAPER wei (1 PAPER)
    uint256 public immutable ETH_USD_PER_TICKET; // "paper from the fire" price, USD 8-decimals (e.g. 1e8 = $1)
    uint256 public immutable PLANK_USD_PER_TICKET; // PLANK leg target, USD 8-decimals
    IPriceFeed public immutable ETH_USD; // Chainlink ETH/USD
    IPriceFeed public immutable PLANK_USD; // PLANK/USD (TWAP adapter, may be a slow-moving source)
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
    uint256 public ticketsTotal;
    address public lastWinner;

    mapping(uint256 => Entry[]) internal _entries; // fireId -> entries
    mapping(uint256 => mapping(address => uint256)) public ticketsOf; // fireId -> buyer -> tickets
    mapping(uint256 => mapping(address => uint256)) public boughtOnDay; // dayIndex -> buyer -> tickets
    uint256 public dayIndex; // increments every roll
    uint8 public fireNameId; // index into the name list (0 = unnamed)

    uint256[TRAILING] internal _trail;
    uint256 internal _trailCount;
    uint256 internal _trailIdx;

    uint256 public millBid; // current ETH bid for one mill
    bool internal _millBoughtSinceRoll;

    uint256 public pendingRequest; // randomness request in flight (0 = none)

    // ---------------------------------------------------------------- events
    event TicketsBought(uint256 indexed fireId, address indexed buyer, uint256 tickets, bool withEth, string note);
    event Stoked(uint256 indexed fireId, address indexed who, uint256 plank);
    event RollRequested(uint256 indexed fireId, uint256 night, uint256 requestId);
    event Survived(uint256 indexed fireId, uint256 night, uint256 fireSize, uint256 storm);
    event WentOut(uint256 indexed fireId, uint256 night, uint256 fireSize, uint256 storm, address winner, uint256 paid);
    event Lit(uint256 indexed fireId, uint256 carried);
    event MillEaten(uint256 indexed tokenId, address seller, uint256 paidEth, uint256 plankToRoyalty);
    event Named(uint256 indexed fireId, uint8 nameId);

    error NotYet();
    error RollPending();
    error BadAmount();
    error NotRandomness();
    error BadRequest();
    error FundTooSmall();
    error NotWinner();
    error DailyCap();
    error BadName();
    error StaleFeed();

    struct Config {
        address paper;
        address plank;
        address mill;
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
    /// @notice Bundle discount in bps of full price: 500 -> 92%, 100+ -> 95%, 10+ -> 97%, else 100%.
    function priceBps(uint256 n) public pure returns (uint256) {
        if (n >= 500) return 9_200;
        if (n >= 100) return 9_500;
        if (n >= 10) return 9_700;
        return BPS;
    }

    /// @notice ETH per ticket right now, from the ETH/USD feed. Reverts if the feed is stale (>1h).
    function ethPerTicket() public view returns (uint256) {
        (, int256 px,, uint256 updatedAt,) = ETH_USD.latestRoundData();
        if (px <= 0 || block.timestamp - updatedAt > 1 hours) revert StaleFeed();
        return ETH_USD_PER_TICKET * 1e18 / uint256(px);
    }

    function quote(uint256 n) public view returns (uint256 paperCost, uint256 plankCost, uint256 ethCost) {
        uint256 bps = priceBps(n);
        paperCost = n * PAPER_PER_TICKET * bps / BPS;
        plankCost = n * plankPerTicket * bps / BPS;
        ethCost = n * ethPerTicket() * bps / BPS;
    }

    /// @notice Tickets this wallet can still buy today.
    function remainingToday(address who) public view returns (uint256) {
        uint256 b = boughtOnDay[dayIndex][who];
        return b >= DAILY_CAP ? 0 : DAILY_CAP - b;
    }

    // ---------------------------------------------------------------- buying
    function buyTickets(uint256 n, string calldata note) external nonReentrant {
        if (n == 0) revert BadAmount();
        (uint256 paperCost, uint256 plankCost,) = quote(n);
        PAPER.safeTransferFrom(msg.sender, DEAD, paperCost);
        _takePlank(msg.sender, plankCost);
        _addTickets(msg.sender, n);
        emit TicketsBought(fireId, msg.sender, n, false, note);
    }

    /// @notice No PAPER? Buy it from the fire with ETH. The ETH feeds the mill fund.
    function buyTicketsWithEth(uint256 n, string calldata note) external payable nonReentrant {
        if (n == 0) revert BadAmount();
        (, uint256 plankCost, uint256 ethCost) = quote(n);
        if (msg.value != ethCost) revert BadAmount();
        _takePlank(msg.sender, plankCost);
        _addTickets(msg.sender, n);
        emit TicketsBought(fireId, msg.sender, n, true, note);
    }

    /// @notice Throw PLANK in with no ticket. Half burns, half feeds the pot.
    function stoke(uint256 plankAmount) external nonReentrant {
        if (plankAmount == 0) revert BadAmount();
        _takePlank(msg.sender, plankAmount);
        emit Stoked(fireId, msg.sender, plankAmount);
    }

    function _takePlank(address from, uint256 amount) internal {
        uint256 burn = amount * PLANK_BURN_BPS / BPS;
        PLANK.safeTransferFrom(from, DEAD, burn);
        PLANK.safeTransferFrom(from, address(this), amount - burn);
        pot += amount - burn;
    }

    function _addTickets(address buyer, uint256 n) internal {
        if (boughtOnDay[dayIndex][buyer] + n > DAILY_CAP) revert DailyCap();
        boughtOnDay[dayIndex][buyer] += n;
        ticketsTotal += n;
        ticketsToday += n;
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
        emit RollRequested(fireId, night + 1, id);
    }

    function onRandomness(uint256 requestId, uint256 rnd) external nonReentrant {
        if (msg.sender != address(randomness)) revert NotRandomness();
        if (requestId != pendingRequest || requestId == 0) revert BadRequest();
        pendingRequest = 0;

        night += 1;
        uint256 fireSize = ticketsToday;
        uint256 storm = stormStrength(night, rnd);

        _pushTrail(fireSize);
        ticketsToday = 0;
        dayIndex += 1;
        nextRollAt = _nextRollTime(block.timestamp);
        _ratchetMillBid();
        _ratchetPlankLeg();

        // night 1 always survives; after that a fire with no fuel goes out, and a fire beats the storm only if it's at least as big
        if (night == 1 || (fireSize > 0 && fireSize >= storm && night < MAX_NIGHTS)) {
            emit Survived(fireId, night, fireSize, storm);
            return;
        }
        _goOut(fireSize, storm, rnd);
    }

    /// @notice Storm on a given night for a given random word. Base = trailingAvg x night / 8,
    ///         times a lognormal-ish multiplier (sigma~0.55) drawn from the random word.
    ///         Night 24+ is infinite. Night 1 never rolls a storm (handled by caller).
    function stormStrength(uint256 n, uint256 rnd) public view returns (uint256) {
        if (n >= MAX_NIGHTS) return type(uint256).max;
        uint256 base = trailingAverage() * n / STORM_SCALE_NIGHT;
        return base * _noiseBps(rnd) / BPS;
    }

    /// @dev 16-point table of e^(0.55·z) at evenly spaced quantiles; picks by the low 4 bits.
    function _noiseBps(uint256 rnd) internal pure returns (uint256) {
        uint16[16] memory table = [
            uint16(3900), 5000, 5800, 6500, 7200, 7900, 8600, 9300,
            10700, 11600, 12700, 13900, 15400, 17200, 19900, 25600
        ];
        return table[rnd & 15];
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
    function _goOut(uint256 fireSize, uint256 storm, uint256 rnd) internal {
        address winner = _pickWinner(rnd);
        uint256 p = pot;
        uint256 winnerSlice = p * WINNER_BPS / BPS;
        uint256 burnSlice = p * BURN_BPS / BPS;
        uint256 carry = p - winnerSlice - burnSlice;
        uint256 tithe = winnerSlice * TITHE_BPS / BPS;

        pot = 0;
        if (winner != address(0)) {
            PLANK.safeTransfer(winner, winnerSlice - tithe);
            PLANK.safeTransfer(ROYALTY_POOL, tithe);
        } else {
            // no tickets at all: winner slice rolls into the carry
            carry += winnerSlice;
        }
        PLANK.safeTransfer(DEAD, burnSlice);
        lastWinner = winner;
        emit WentOut(fireId, night, fireSize, storm, winner, winner == address(0) ? 0 : winnerSlice - tithe);
        _light(carry);
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
        fireNameId = 0;
        nextRollAt = _nextRollTime(block.timestamp);
        emit Lit(fireId, carried);
    }

    /// @notice The last winner names the fire their win lit, picking from the list (1..NAME_COUNT).
    ///         The list itself lives on the site; the chain stores the index.
    function nameFire(uint8 nameId) external {
        if (msg.sender != lastWinner) revert NotWinner();
        if (nameId == 0 || nameId > NAME_COUNT || fireNameId != 0) revert BadName();
        fireNameId = nameId;
        emit Named(fireId, nameId);
    }

    // ---------------------------------------------------------------- the mill fund
    /// @notice The fire's standing ETH bid for a mill. Ticks up 5% every night nobody sells,
    ///         resets to base when one does.
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
        (, int256 px,, uint256 updatedAt,) = PLANK_USD.latestRoundData();
        if (px <= 0 || block.timestamp - updatedAt > 2 days) return;
        uint256 target = PLANK_USD_PER_TICKET * 1e18 / uint256(px);
        uint256 cur = plankPerTicket;
        uint256 maxUp = cur * (BPS + PLANK_RATCHET_BPS) / BPS;
        uint256 maxDown = cur * (BPS - PLANK_RATCHET_BPS) / BPS;
        plankPerTicket = target > maxUp ? maxUp : target < maxDown ? maxDown : target;
    }

    function millFund() public view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Sell a mill to the fire at its current bid. The fire burns it in the same
    ///         transaction and sends the PLANK inside to the royalty pool.
    ///         STUB: depends on the Paper Mill contract's real burn semantics.
    function sellMillToFire(uint256 tokenId) external nonReentrant {
        uint256 bid = millBid;
        if (address(this).balance < bid) revert FundTooSmall();
        MILL.transferFrom(msg.sender, address(this), tokenId);
        uint256 before = PLANK.balanceOf(address(this));
        MILL.burn(tokenId);
        uint256 released = PLANK.balanceOf(address(this)) - before;
        if (released > 0) PLANK.safeTransfer(ROYALTY_POOL, released);
        _millBoughtSinceRoll = true;
        (bool ok,) = msg.sender.call{value: bid}("");
        require(ok, "pay failed");
        emit MillEaten(tokenId, msg.sender, bid, released);
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
