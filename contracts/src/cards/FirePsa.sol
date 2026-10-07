// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

interface IPsaCards is IERC721 {
    function setGrade(uint256 serial, uint256 grade) external;
    function setGradePending(uint256 serial, bool pending) external;
    function setCased(uint256 serial) external;
    function gradeInfo(uint256 serial) external view returns (bool exists, uint256 fire, uint256 grade);
    function wearOf(uint256 serial)
        external
        view
        returns (bool exists, uint256 fire, uint256 grade, bool cased, uint256 age, uint256 moves);
}

interface IPsaRandomness {
    function request() external returns (uint256 requestId);
    function answered(uint256 requestId) external view returns (bool);
}

interface IPsaBurner {
    function quote(uint8 pay, uint256 usd18) external view returns (uint256);
    function flushLight(uint8 pay) external returns (uint256);
    function PLANK() external view returns (address);
    function USDG() external view returns (address);
}

/**
 * @title FirePsa
 * @notice Cases and PDA grading (docs/grading.md).
 *
 *         - **Case** a card: its wear freezes for good (no more wear from time or moves). Any time before grading.
 *         - **Grade** a card: its condition is rolled from drand randomness asked for after payment, so nobody can
 *           know it in advance, and it is slabbed at that grade (1-10), once, for good.
 *         Both in one transaction (`protect`), up to `maxBatch` cards. Prices are in dollars (`caseUsd18`,
 *         `gradeUsd18`), paid in ETH, PLANK or USDG; every cent goes to PaperBurner, which buys PAPER and burns it.
 *
 *         The odds: a fresh grade (5-10) from the fresh odds, then wear (moves and time uncased). Both are fixed
 *         here forever, the same for every Series (FRESH_* and WEAR_* constants, `oddsFor`); nobody can change them.
 *         Fresh: 10: 1%, 9: 17%, 8: 25%, 7: 27%, 6: 20%, 5: 10%. Only the case and grading prices can change.
 *
 *         The owner can pause case and grading payments (`setPaused`); finishing and cancelling gradings never pause.
 *         The randomness source can be switched at any time (only new gradings use it; each grading remembers its
 *         source, and only that source can answer it). A grading stores a hash of its cards; `finish` and
 *         `cancelGrading` take the list (from the `Protected` event).
 */
contract FirePsa is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Most cards one batch can hold (gas guard: `finish` grades them all in one transaction).
    uint256 public constant MAX_BATCH_CAP = 100;
    /// @dev Highest dollar price the owner can set per card (a typo guard; every purchase names its most anyway).
    uint256 public constant MAX_PRICE_USD18 = 100e18;
    /// @dev Last resort if randomness is gone for good: a grading with no answer this long after it was asked for
    ///      can be cancelled, unlocking its cards (still ungraded). The fee was burned and can't come back.
    uint256 public constant CANCEL_AFTER = 7 days;

    // ---------------------------------------------------------------- fresh odds (fixed forever, every Series)
    /// @dev A fresh card's grade weights, out of ODDS_TOTAL. Grades 1-4 come only from wear.
    uint256 public constant ODDS_TOTAL = 10_000;
    uint64 public constant FRESH_5 = 1000;
    uint64 public constant FRESH_6 = 2000;
    uint64 public constant FRESH_7 = 2700;
    uint64 public constant FRESH_8 = 2500;
    uint64 public constant FRESH_9 = 1700;
    uint64 public constant FRESH_10 = 100;

    // ---------------------------------------------------------------- wear rules (fixed forever)
    /// @dev The first day after a card is dealt is free.
    uint256 public constant FREE_TIME = 1 days;
    uint256 public constant YEAR = 365 days;
    /// @dev Each move (uncased) takes a grade off with chance 1/5; only the first 10 count; never below 5.
    uint256 public constant MOVE_CAP = 10;
    /// @dev Time uncased takes D grades off, D's distribution read from this table (ages in seconds past the free
    ///      day; at each age, the chance D <= 0..8 out of 2^23) and blended linearly between neighbouring ages. Made
    ///      by contracts/test/cards/wear-model.py from D ~ Poisson(1.45 * years^0.68).
    uint256 internal constant DMAX = 9;
    uint256 internal constant SCALE = 1 << 23;
    uint256 internal constant WEAR_BREAKS = 32;
    bytes internal constant WEAR_TIMES = hex"00000000000151800002a3000005460000093a80000d2f0000127500001baf8000278d00003b5380004f1a000076a700009e340000ed4e00013c6800018b820001e1338002592c0002d2760003c2670004b3a98005a39a800784ce00096601800b4735000d2868800f099c0012cc0300168e6a001c3204802598060038640900";
    bytes internal constant WEAR_CDFS = hex"8000008000008000008000008000008000008000008000008000007caf447ff4ea7fffe78000008000008000008000008000008000007abad97fe3d67fff9b7fffff80000080000080000080000080000077a9697fb8ea7ffe6a7ffff980000080000080000080000080000073fc9c7f6af17ffb257fffe27fffff80000080000080000080000070e4277f122c7ff6267fffb17ffffe8000008000008000008000006d4dd07e90137fece57fff407ffffa80000080000080000080000067f5b47d960d7fd5e77ffdd57fffe97fffff8000008000008000006230a77c39047fac777ffa8a7fffb77ffffd8000008000008000005a437c79cad57f4c7a7ff09b7ffef07ffff07fffff80000080000053b3b37741807ece947fe0487ffd587fffd07ffffd80000080000049247b7213167d871c7faa0c7ff6917fff227fffee7fffff80000040cfe76ceb517bed6f7f55007fe9497ffd787fffc27ffffb8000003437f96309937806a97e4c7b7fb46c7ff4f77ffe9c7fffd97ffffc2b05a859ee0773807d7ccbba7f54427fe1ae7ffb617fff617fffed23fbc651a53d6e9e087adf427ec2857fbf1c7ff4887ffe377fffc11e0666498fae69200178617f7de93d7f83cd7fe7067ffb937fff4d17b0be3fa7b8615d597451f77c50827f02fe7fc5227ff3eb7ffdc912ece9371a1359ad8a6fb5777a3cae7e43127f8b577fe4fc7ffa670c8a4129ac004b828f65b68f74ee687c007e7ebd557fa5eb7fe976088fbb1fb7d63f08e45b44f76e5c8578b0747d58527f24da7fc08e05ff74185ae6347287511b7f67096d7475da7b4ecb7e4d3c7f72750318900e9e6f24100c3eaab5576bea69d9407547857b5b6e7e2f4f01aeb408f86918c1582f8c2d483afd5d9d596d0da6769b707bc7c500f325059b6a11069923b0963a91df51022b6358c070315678110f008d6c038f870bc0521a9e532edbae44e6a858e81868782d731012005448024ad908254513c7aa251fc039cf0d4e5dbf5fe0dc6cee7e001fb900fbe403f7e40adf5016d9d9277a473ab5a64dc6ea5e517f000cb100706901f81b05f9d90dd8731a35dd2a668b3c92294e6a2600038100238a00b5fd0274570670a50dba7718d5cd2757c937ec9e00007c0005e30023ec00933d01c8ab0478c80973fb115d8e1c5cde0000040000390001c00009360024870074920137fd02d0f105bdcc";

    IPsaCards public immutable CARDS;
    IPsaBurner public immutable BURNER;
    IERC20 public immutable PLANK;
    IERC20 public immutable USDG;

    IPsaRandomness public randomness;
    /// @notice Most cards per batch (cases and grades together; 1 to MAX_BATCH_CAP).
    uint256 public maxBatch = 20;
    /// @notice Price per card in dollars (18 decimals).
    uint256 public caseUsd18 = 0.05e18;
    uint256 public gradeUsd18 = 1e18;
    /// @notice While true, cases and grading can't be paid for (`protect`). Finishing and cancelling never pause.
    bool public paused;

    enum Pay { PLANK, ETH, USDG }

    struct Grading {
        address by;
        uint64 requestedAt;
        bool ready;
        bool done;
        address source; // the randomness source that took the request (only it can answer)
        uint96 requestId;
        uint256 word;
        bytes32 idsHash; // keccak256(abi.encode(ids)) of the cards sent (the list is in the Protected event)
    }

    Grading[] internal _gradings;
    mapping(uint256 request => uint256) internal _gradingOf; // (source << 96 | requestId) -> index + 1
    mapping(uint256 serial => bool) public pending;

    event RandomnessSet(address source);
    event PricesSet(uint256 caseUsd18, uint256 gradeUsd18);
    event MaxBatchSet(uint256 cards);
    event Protected(address indexed by, uint256[] cased, uint256[] graded, Pay pay, uint256 paid, uint256 gradingIndex);
    event GradingReady(uint256 indexed index, uint256 word);
    event Graded(uint256 indexed serial, uint256 grade);
    event GradingCancelled(uint256 indexed index);
    event PausedSet(bool paused);

    error ZeroAddress();
    error BadAmount();
    error NotHolder();
    error AlreadyGraded();
    error Pending();
    error NotRandomness();
    error NotReady();
    error NotStuck();
    error PriceMoved();
    error TransferFailed();
    error IsPaused();
    error BadIds();
    error BadRequest();
    error RenounceDisabled();

    constructor(address owner_, address cards, address burner) Ownable(owner_) {
        if (cards == address(0) || burner == address(0)) revert ZeroAddress();
        CARDS = IPsaCards(cards);
        BURNER = IPsaBurner(burner);
        PLANK = IERC20(IPsaBurner(burner).PLANK());
        USDG = IERC20(IPsaBurner(burner).USDG());
    }

    // ================================================================ owner

    /// @notice Ownership can be handed over (two steps) but never renounced, so control can't be lost by mistake.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice The randomness source for new gradings. The owner can switch it at any time (no delay; announced
    ///         publicly first). Gradings already waiting keep their own source.
    function setRandomness(address source) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        randomness = IPsaRandomness(source);
        emit RandomnessSet(source);
    }

    /// @notice Pause or unpause case and grading payments (`protect`). No expiry.
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    /// @notice Most cards per batch, 1 to MAX_BATCH_CAP (100).
    function setMaxBatch(uint256 n) external onlyOwner {
        if (n == 0 || n > MAX_BATCH_CAP) revert BadAmount();
        maxBatch = n;
        emit MaxBatchSet(n);
    }

    /// @notice Case and grading prices per card, in dollars (18 decimals, above 0, at most $100). From the next batch;
    ///         every batch names the most it pays.
    function setPrices(uint256 caseUsd, uint256 gradeUsd) external onlyOwner {
        if (caseUsd == 0 || gradeUsd == 0 || caseUsd > MAX_PRICE_USD18 || gradeUsd > MAX_PRICE_USD18) revert BadAmount();
        caseUsd18 = caseUsd;
        gradeUsd18 = gradeUsd;
        emit PricesSet(caseUsd, gradeUsd);
    }

    // ================================================================ cases and grading

    /// @notice What a batch costs in `pay` right now (rounded up).
    function quote(uint256 cases, uint256 grades, Pay pay) public view returns (uint256) {
        return BURNER.quote(uint8(pay), cases * caseUsd18 + grades * gradeUsd18);
    }

    /// @notice Case `caseIds` and send `gradeIds` for grading, in one transaction: up to `maxBatch` cards, all yours,
    ///         none graded or being graded. Pay in `pay`: `maxCost` is the most PLANK/USDG, or send ETH (the rest comes
    ///         back). Grades are set when the randomness arrives (anyone can then call `finish`; the site does it right
    ///         away); until then those cards can't move. Returns the grading's index (type(uint256).max: no grading).
    function protect(uint256[] calldata caseIds, uint256[] calldata gradeIds, Pay pay, uint256 maxCost)
        external
        payable
        nonReentrant
        returns (uint256 index)
    {
        if (paused) revert IsPaused();
        uint256 nc = caseIds.length;
        uint256 ng = gradeIds.length;
        if (nc + ng == 0 || nc + ng > maxBatch) revert BadAmount();
        for (uint256 i; i < nc; i++) {
            if (CARDS.ownerOf(caseIds[i]) != msg.sender) revert NotHolder();
            CARDS.setCased(caseIds[i]); // ungraded, uncased and not being graded, or it reverts
        }
        for (uint256 i; i < ng; i++) {
            uint256 id = gradeIds[i];
            if (CARDS.ownerOf(id) != msg.sender) revert NotHolder();
            (,, uint256 grade) = CARDS.gradeInfo(id);
            if (grade != 0) revert AlreadyGraded();
            if (pending[id]) revert Pending();
            pending[id] = true;
            CARDS.setGradePending(id, true); // freezes its wear where it is
        }
        uint256 cost = _pay(pay, nc * caseUsd18 + ng * gradeUsd18, maxCost);
        index = type(uint256).max;
        if (ng > 0) {
            IPsaRandomness src = randomness;
            uint256 rid = src.request();
            if (rid > type(uint96).max) revert BadRequest();
            index = _gradings.length;
            _gradings.push(
                Grading(msg.sender, uint64(block.timestamp), false, false, address(src), uint96(rid), 0, keccak256(abi.encode(gradeIds)))
            );
            _gradingOf[_reqKey(address(src), rid)] = index + 1;
        }
        emit Protected(msg.sender, caseIds, gradeIds, pay, cost, index);
    }

    /// @dev Takes the dollar amount in `pay`, sends all of it to PaperBurner and burns it; refunds unspent ETH.
    function _pay(Pay pay, uint256 usd18, uint256 maxCost) internal returns (uint256 cost) {
        cost = BURNER.quote(uint8(pay), usd18);
        if (cost > maxCost) revert PriceMoved();
        uint256 spentEth;
        if (pay == Pay.ETH) {
            if (msg.value < cost) revert PriceMoved();
            spentEth = cost;
            _sendEth(address(BURNER), cost);
        } else {
            (pay == Pay.PLANK ? PLANK : USDG).safeTransferFrom(msg.sender, address(BURNER), cost);
        }
        BURNER.flushLight(uint8(pay));
        if (msg.value > spentEth) _sendEth(msg.sender, msg.value - spentEth);
    }

    /// @dev Randomness callback: only stores the word (cheap, can't fail). Only the source that took a request can
    ///      answer it.
    function onRandomness(uint256 requestId, uint256 word) external {
        uint256 rk = requestId > type(uint96).max ? 0 : _reqKey(msg.sender, requestId);
        uint256 i = _gradingOf[rk];
        if (i == 0) revert NotRandomness(); // not this source's request, or the grading was cancelled
        Grading storage g = _gradings[i - 1];
        delete _gradingOf[rk];
        g.word = word;
        g.ready = true;
        emit GradingReady(i - 1, word);
    }

    /// @notice Anyone: set the grades of a batch whose randomness has arrived. `ids` is the batch's list of cards sent
    ///         for grading, in order (from its `Protected` event). The result depends only on the word and each card's
    ///         frozen wear.
    function finish(uint256 index, uint256[] calldata ids) external nonReentrant {
        Grading storage g = _gradings[index];
        if (!g.ready || g.done) revert NotReady();
        if (keccak256(abi.encode(ids)) != g.idsHash) revert BadIds();
        g.done = true;
        for (uint256 i; i < ids.length; i++) {
            uint256 id = ids[i];
            delete pending[id];
            (bool exists,, uint256 grade,, uint256 age, uint256 moves) = CARDS.wearOf(id);
            if (!exists || grade != 0) continue; // burned in the meantime
            uint256 got = gradeFor(age, moves, uint256(keccak256(abi.encode(g.word, id))));
            CARDS.setGrade(id, got);
            emit Graded(id, got);
        }
    }

    /// @notice If a grading's randomness has had no answer for CANCEL_AFTER since it was asked for, anyone can cancel
    ///         it (`ids` as for `finish`): its cards unlock, still ungraded, and their wear clock runs again from where
    ///         it stopped.
    function cancelGrading(uint256 index, uint256[] calldata ids) external nonReentrant {
        Grading storage g = _gradings[index];
        if (g.ready || g.done || block.timestamp < g.requestedAt + CANCEL_AFTER || _answered(g.source, g.requestId)) {
            revert NotStuck();
        }
        if (keccak256(abi.encode(ids)) != g.idsHash) revert BadIds();
        g.done = true;
        delete _gradingOf[_reqKey(g.source, g.requestId)];
        for (uint256 i; i < ids.length; i++) {
            uint256 id = ids[i];
            delete pending[id];
            (bool exists,,) = CARDS.gradeInfo(id);
            if (exists) CARDS.setGradePending(id, false);
        }
        emit GradingCancelled(index);
    }

    function _reqKey(address source, uint256 id) private pure returns (uint256) {
        return (uint256(uint160(source)) << 96) | id;
    }

    /// @dev Whether `source` holds an answer for `id`; a source that can't say counts as no answer.
    function _answered(address source, uint256 id) private view returns (bool) {
        (bool ok, bytes memory ret) = source.staticcall(abi.encodeCall(IPsaRandomness.answered, (id)));
        return ok && ret.length >= 32 && abi.decode(ret, (bool));
    }

    // ================================================================ odds

    /// @notice The fresh weights, grade 1 first, and their total: fixed forever, the same for every Series.
    function freshOdds() public pure returns (uint64[10] memory o, uint256 total) {
        o = [uint64(0), 0, 0, 0, FRESH_5, FRESH_6, FRESH_7, FRESH_8, FRESH_9, FRESH_10];
        total = ODDS_TOTAL;
    }

    /// @notice The chance of each grade (1 first, out of 1e18 less rounding) for a card that spent `age` seconds
    ///         uncased since it was dealt and moved `moves` times uncased. The same for every Series. The site shows
    ///         these.
    function oddsFor(uint256 age, uint256 moves) public pure returns (uint256[10] memory out) {
        (uint64[10] memory w, uint256 total) = freshOdds();
        uint256 t = age > FREE_TIME ? age - FREE_TIME : 0;
        uint256 m = moves > MOVE_CAP ? MOVE_CAP : moves;
        uint256[10] memory tp = _timePmf(t);
        uint256[11] memory raw;
        for (uint256 g0 = 5; g0 <= 10; g0++) {
            uint256 wt = w[g0 - 1];
            if (wt == 0) continue;
            uint256 kmax = m < g0 - 5 ? m : g0 - 5;
            // moves: Binomial(m, 1/5) weights C(m,k) * 4^(m-k), cut at kmax (re-drawn above it)
            uint256[6] memory bw;
            uint256 bsum;
            uint256 c = 1;
            for (uint256 k; k <= kmax; k++) {
                bw[k] = c * uint256(4) ** (m - k);
                bsum += bw[k];
                c = c * (m - k) / (k + 1);
            }
            for (uint256 k; k <= kmax; k++) {
                uint256 pm = 1e18 * wt / total * bw[k] / bsum;
                uint256 g1 = g0 - k;
                for (uint256 d; d <= DMAX; d++) raw[g1 > d ? g1 - d : 1] += pm * tp[d] / SCALE;
            }
        }
        // grades below 5 fade in with time: a card can't land on a grade that isn't open yet, it lands higher
        uint256 carry;
        for (uint256 g = 1; g <= 10; g++) {
            uint256 mass = raw[g] + carry;
            uint256 keep = mass * _open(g, t) / 1e18;
            out[g - 1] = keep;
            carry = mass - keep;
        }
    }

    /// @notice The grade a random number gives a card with this wear.
    function gradeFor(uint256 age, uint256 moves, uint256 rnd) public pure returns (uint256) {
        uint256[10] memory o = oddsFor(age, moves);
        uint256 total;
        for (uint256 g; g < 10; g++) total += o[g];
        uint256 x = rnd % total;
        for (uint256 g; g < 10; g++) {
            if (x < o[g]) return g + 1;
            x -= o[g];
        }
        return 10;
    }

    /// @dev Share of grade g open at time t (out of 1e18): 1-4 open from 1 month, 6 months, 1 year, 2 years
    ///      (by grade 4, 3, 2, 1), fully open at twice that.
    function _open(uint256 g, uint256 t) internal pure returns (uint256) {
        if (g >= 5) return 1e18;
        uint256 u = g == 4 ? YEAR / 12 : g == 3 ? YEAR / 2 : g == 2 ? YEAR : 2 * YEAR;
        if (t <= u) return 0;
        if (t >= 2 * u) return 1e18;
        return (t - u) * 1e18 / u;
    }

    /// @dev Distribution of the time damage D at t (index 9 = 9 or more), out of SCALE.
    function _timePmf(uint256 t) internal pure returns (uint256[10] memory pmf) {
        bytes memory times = WEAR_TIMES;
        bytes memory cdfs = WEAR_CDFS;
        uint256[9] memory cdf;
        uint256 last = WEAR_BREAKS - 1;
        if (t >= _time(times, last)) {
            for (uint256 k; k < DMAX; k++) cdf[k] = _cdf(cdfs, last, k);
        } else {
            uint256 i;
            while (_time(times, i + 1) <= t) i++;
            uint256 t0 = _time(times, i);
            uint256 span = _time(times, i + 1) - t0;
            uint256 into = t - t0;
            for (uint256 k; k < DMAX; k++) cdf[k] = (_cdf(cdfs, i, k) * (span - into) + _cdf(cdfs, i + 1, k) * into) / span;
        }
        pmf[0] = cdf[0];
        for (uint256 k = 1; k < DMAX; k++) pmf[k] = cdf[k] - cdf[k - 1];
        pmf[DMAX] = SCALE - cdf[DMAX - 1];
    }

    function _time(bytes memory times, uint256 i) internal pure returns (uint256 v) {
        assembly {
            v := shr(224, mload(add(add(times, 32), mul(i, 4))))
        }
    }

    function _cdf(bytes memory cdfs, uint256 row, uint256 k) internal pure returns (uint256 v) {
        assembly {
            v := shr(232, mload(add(add(cdfs, 32), add(mul(row, 27), mul(k, 3)))))
        }
    }

    // ================================================================ views

    function gradingOf(uint256 index) external view returns (Grading memory) {
        return _gradings[index];
    }

    function gradingCount() external view returns (uint256) {
        return _gradings.length;
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
