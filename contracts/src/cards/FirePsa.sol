// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";

interface IPsaCards is IERC721 {
    function setGrade(uint256 serial, uint256 grade) external;
    function setGradePending(uint256 serial, bool pending) external;
    function PACKS() external view returns (address);
    function gradeInfo(uint256 serial) external view returns (bool exists, uint256 fire, uint256 grade);
    function fires(uint256 fire)
        external
        view
        returns (bool closed, bool locked, uint8 characterCount, uint32, uint32, uint32, uint32, uint32, uint32, uint32);
}

interface IPsaPacks {
    function minted(uint256 fire) external view returns (uint256);
}

interface IPsaRandomness {
    function request() external returns (uint256 requestId);
    function answered(uint256 requestId) external view returns (bool);
}

interface IPsaFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/**
 * @title FirePsa
 * @notice The PDA reveal (docs/omni-economy.md). A card holder pays PAPER (burned) to reveal a card's grade, 1 to 10,
 *         once. The grade comes from drand randomness requested after payment, so nobody can know it in advance; the
 *         card then shows that grade's wear frame and seal colour.
 *
 *         Price, from the PAPER price feed: the most whole PAPER that stays at or under $0.25. If 1 PAPER is worth
 *         more than $0.25, 1 PAPER, up to a hard cap of $1: past $1 a PAPER, $1 worth (part of a PAPER). Until PAPER
 *         has a market (no price), a set number of PAPER the owner chooses.
 *
 *         Odds by default, out of 10,000: 10: 1%, 9: 17%, 8: 24%, 7: 25%, 6: 18%, 5: 7%, 4: 3.5%, 3: 2%, 2: 1.5%,
 *         1: 1%. Most cards land 6-9; a 10 is rare. The owner can set different odds for a Series before it closes,
 *         so they're fixed before any of its cards exist.
 */
contract FirePsa is Ownable2Step {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MAX_REVEAL = 10;
    /// @dev Same reasoning as FireCards: drand's number is public ~30s before delivery, so a reveal can only be asked
    ///      for again after a full day with no answer (anyone can deliver; the keeper does it within seconds).
    uint256 public constant REREQUEST_AFTER = 1 days;
    uint256 public constant PRICE_USD18 = 0.25e18; // $0.25
    uint256 public constant CAP_USD18 = 1e18; // $1, the most a reveal ever costs
    uint256 public constant PAPER_FEED_MAX_AGE = 2 days;
    uint256 public constant ODDS_TOTAL = 10_000;
    /// @dev Last resort if randomness is gone for good: a reveal with no answer this long can be cancelled, unlocking
    ///      its cards (still unrevealed). The PAPER was burned and can't come back.
    uint256 public constant CANCEL_AFTER = 7 days;

    IPsaCards public immutable CARDS;
    IERC20 public immutable PAPER;
    /// @notice PAPER/USD, 18 decimals (PaperUsdTwap). Can be left empty at deploy and set once later.
    IPsaFeed public PAPER_USD;

    IPsaRandomness public randomness;
    /// @notice Whole PAPER per reveal before PAPER has ever had a price.
    uint256 public fallbackPaper = 5;
    /// @notice The last price-based cost seen (PAPER wei per card). Used whenever the feed has a gap, so a gap
    ///         can't make reveals cheap (or let the owner's fallback number apply again).
    uint256 public lastCost;

    /// @dev Chance of each grade 1..10, out of ODDS_TOTAL, for Series the owner gave their own odds.
    mapping(uint256 fire => uint16[10]) internal _odds;
    mapping(uint256 fire => bool) public customOdds;

    struct Reveal {
        address by;
        uint64 requestedAt;
        bool ready;
        bool done;
        uint256 requestId;
        uint256 word;
        uint256[] ids;
    }

    Reveal[] internal _reveals;
    mapping(uint256 requestId => uint256) internal _revealOf; // index + 1
    mapping(uint256 serial => bool) public pending;

    event RandomnessSet(address source);
    event FallbackPaperSet(uint256 paper);
    event OddsSet(uint256 indexed fire, uint16[10] odds);
    event RevealRequested(uint256 indexed index, address indexed by, uint256[] ids, uint256 paper, uint256 requestId);
    event RevealReady(uint256 indexed index, uint256 word);
    event Graded(uint256 indexed serial, uint256 grade);
    event Rerequested(uint256 indexed index, uint256 requestId);
    event RevealCancelled(uint256 indexed index);
    event PaperFeedSet(address feed);
    event LastCostSet(uint256 paperWei);

    error AlreadySet();
    error ZeroAddress();
    error BadAmount();
    error NotHolder();
    error AlreadyGraded();
    error Pending();
    error NotRandomness();
    error NotReady();
    error NotStuck();
    error BadOdds();
    error FireIsClosed();
    error PriceMoved();

    constructor(address owner_, address cards, address paper, address paperUsd) Ownable(owner_) {
        if (cards == address(0) || paper == address(0)) revert ZeroAddress();
        CARDS = IPsaCards(cards);
        PAPER = IERC20(paper);
        PAPER_USD = IPsaFeed(paperUsd);
    }

    // ================================================================ owner

    function setRandomness(address source) external onlyOwner {
        if (address(randomness) != address(0)) revert AlreadySet();
        if (source == address(0)) revert ZeroAddress();
        randomness = IPsaRandomness(source);
        emit RandomnessSet(source);
    }

    /// @notice Set the PAPER price feed, once, if it was left empty at deploy.
    function setPaperFeed(address feed) external onlyOwner {
        if (address(PAPER_USD) != address(0)) revert AlreadySet();
        if (feed == address(0)) revert ZeroAddress();
        PAPER_USD = IPsaFeed(feed);
        emit PaperFeedSet(feed);
    }

    /// @notice Whole PAPER per reveal while PAPER has no price.
    function setFallbackPaper(uint256 paper) external onlyOwner {
        if (paper == 0 || paper > 1_000_000) revert BadAmount();
        fallbackPaper = paper;
        emit FallbackPaperSet(paper);
    }

    /// @notice Odds for a Series' cards, grade 1 first, out of 10,000. Only before any of its packs exist, so
    ///         everyone who buys a pack knows the odds.
    function setOdds(uint256 fire, uint16[10] calldata odds) external onlyOwner {
        (bool closed,,,,,,,,,) = CARDS.fires(fire);
        if (closed || IPsaPacks(CARDS.PACKS()).minted(fire) != 0) revert FireIsClosed();
        uint256 sum;
        for (uint256 i; i < 10; i++) sum += odds[i];
        if (sum != ODDS_TOTAL) revert BadOdds();
        _odds[fire] = odds;
        customOdds[fire] = true;
        emit OddsSet(fire, odds);
    }

    // ================================================================ revealing

    /// @notice Reveal up to 10 of your cards. The PAPER is burned now; grades are set when the randomness arrives
    ///         (anyone can then call finish; the site does it right away). Until then the cards can't be transferred.
    ///         `maxPaper` is the most PAPER (wei, for all the cards) the holder agrees to pay.
    function reveal(uint256[] calldata ids, uint256 maxPaper) external returns (uint256 index) {
        uint256 n = ids.length;
        if (n == 0 || n > MAX_REVEAL) revert BadAmount();
        for (uint256 i; i < n; i++) {
            uint256 id = ids[i];
            if (CARDS.ownerOf(id) != msg.sender) revert NotHolder();
            (, , uint256 grade) = CARDS.gradeInfo(id);
            if (grade != 0) revert AlreadyGraded();
            if (pending[id]) revert Pending();
            pending[id] = true;
            CARDS.setGradePending(id, true);
        }
        uint256 per = _priceNow();
        uint256 paper = n * per;
        if (paper > maxPaper) revert PriceMoved();
        PAPER.safeTransferFrom(msg.sender, DEAD, paper);
        uint256 rid = randomness.request();
        index = _reveals.length;
        _reveals.push(Reveal(msg.sender, uint64(block.timestamp), false, false, rid, 0, ids));
        _revealOf[rid] = index + 1;
        emit RevealRequested(index, msg.sender, ids, paper, rid);
    }

    /// @dev Randomness callback: only stores the word (cheap, can't fail).
    function onRandomness(uint256 requestId, uint256 word) external {
        if (msg.sender != address(randomness)) revert NotRandomness();
        uint256 i = _revealOf[requestId];
        if (i == 0) return;
        Reveal storage r = _reveals[i - 1];
        if (r.ready) return;
        r.word = word;
        r.ready = true;
        delete _revealOf[requestId];
        emit RevealReady(i - 1, word);
    }

    /// @notice Anyone: set the grades of a reveal whose randomness has arrived. The result depends only on the word.
    function finish(uint256 index) external {
        Reveal storage r = _reveals[index];
        if (!r.ready || r.done) revert NotReady();
        r.done = true;
        for (uint256 i; i < r.ids.length; i++) {
            uint256 id = r.ids[i];
            delete pending[id];
            (bool exists, uint256 fire, uint256 grade) = CARDS.gradeInfo(id);
            if (!exists || grade != 0) continue; // burned in the meantime (a burned card's pending mark doesn't matter)
            uint256 g = gradeFor(fire, uint256(keccak256(abi.encode(r.word, id))));
            CARDS.setGrade(id, g);
            emit Graded(id, g);
        }
    }

    /// @notice Anyone (the keeper): remember the current price-based cost, so a later gap in the feed uses it.
    function pokePrice() external {
        _priceNow();
    }

    /// @notice If a reveal's randomness has had no answer for CANCEL_AFTER (randomness gone for good), anyone can
    ///         cancel it: its cards unlock, still unrevealed, and can be revealed again later.
    function cancelReveal(uint256 index) external {
        Reveal storage r = _reveals[index];
        if (r.ready || r.done || block.timestamp < r.requestedAt + CANCEL_AFTER || randomness.answered(r.requestId)) revert NotStuck();
        r.done = true;
        delete _revealOf[r.requestId];
        for (uint256 i; i < r.ids.length; i++) {
            uint256 id = r.ids[i];
            delete pending[id];
            (bool exists,,) = CARDS.gradeInfo(id);
            if (exists) CARDS.setGradePending(id, false);
        }
        emit RevealCancelled(index);
    }

    /// @notice If a reveal's randomness never arrived (a day on, and the router has no answer), anyone can ask again.
    function rerequest(uint256 index) external {
        Reveal storage r = _reveals[index];
        if (r.ready || block.timestamp < r.requestedAt + REREQUEST_AFTER || randomness.answered(r.requestId)) revert NotStuck();
        delete _revealOf[r.requestId];
        uint256 rid = randomness.request();
        r.requestId = rid;
        r.requestedAt = uint64(block.timestamp);
        _revealOf[rid] = index + 1;
        emit Rerequested(index, rid);
    }

    // ================================================================ views

    /// @notice PAPER (wei) per card right now: the most whole PAPER at or under $0.25; 1 PAPER while a PAPER is worth
    ///         $0.25 to $1; $1 worth past that. During a gap in the price feed, the last price-based cost; before
    ///         PAPER has ever had a price, the set number.
    function paperPerReveal() public view returns (uint256) {
        uint256 px = _paperUsd();
        if (px == 0) return lastCost != 0 ? lastCost : fallbackPaper * 1e18;
        return _costAt(px);
    }

    /// @dev paperPerReveal, remembering a fresh price-based cost for later gaps.
    function _priceNow() internal returns (uint256) {
        uint256 px = _paperUsd();
        if (px == 0) return lastCost != 0 ? lastCost : fallbackPaper * 1e18;
        uint256 cost = _costAt(px);
        if (lastCost != cost) {
            lastCost = cost;
            emit LastCostSet(cost);
        }
        return cost;
    }

    /// @dev Cost in PAPER wei at a PAPER/USD price (18 decimals, nonzero).
    function _costAt(uint256 px) internal pure returns (uint256) {
        uint256 whole = PRICE_USD18 / px;
        if (whole != 0) return whole * 1e18;
        if (px <= CAP_USD18) return 1e18;
        return CAP_USD18 * 1e18 / px; // $1 worth, under 1 PAPER
    }

    function oddsOf(uint256 fire) public view returns (uint16[10] memory o) {
        if (customOdds[fire]) return _odds[fire];
        o = [uint16(100), 150, 200, 350, 700, 1800, 2500, 2400, 1700, 100];
    }

    /// @notice The grade a random number gives for a Series' odds.
    function gradeFor(uint256 fire, uint256 rnd) public view returns (uint256) {
        uint16[10] memory o = oddsOf(fire);
        uint256 x = rnd % ODDS_TOTAL;
        for (uint256 g; g < 10; g++) {
            if (x < o[g]) return g + 1;
            x -= o[g];
        }
        return 10;
    }

    function revealOf(uint256 index) external view returns (Reveal memory) {
        return _reveals[index];
    }

    function revealCount() external view returns (uint256) {
        return _reveals.length;
    }

    function _paperUsd() internal view returns (uint256) {
        if (address(PAPER_USD) == address(0)) return 0;
        (bool ok, bytes memory ret) = address(PAPER_USD).staticcall(abi.encodeCall(IPsaFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) return 0;
        (, int256 px,, uint256 at,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        if (px <= 0 || at > block.timestamp || block.timestamp - at > PAPER_FEED_MAX_AGE) return 0;
        return uint256(px);
    }
}
