// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {FireSale} from "./FireSale.sol";

interface IPrizePsa {
    function couponIssuer() external view returns (address);
    function addCoupons(address to, uint256 cases, uint256 grades) external;
}

interface ICreditsCards {
    function characterCount(uint256 fire) external view returns (uint256);
    function cardsPerPack(uint256 fire) external view returns (uint256);
}

/**
 * @title FireCredits
 * @notice Free pack credits, card burning and character suggestions (docs/omni-economy.md), split out of FireSale for
 *         contract size. Same rules as before:
 *
 *         - Burn cards: every CARDS_PER_CREDIT (42) burned earns a free pack credit; extras count toward the next one
 *           (a running count per wallet that carries over between Series). Burning never pauses.
 *         - Suggest a character for a future Series, for `suggestionPaper` PAPER (burned; never more than $1 worth at
 *           the PAPER feed's price).
 *         - The owner picks suggestions while setting up a drop: each picked author gets the drop's `creditsPerPick`.
 *         - Spend credits in any live drop while its credit group is open, for that group's PAPER per pack alone
 *           (FireSale.creditPacks checks the drop's caps, takes the packs from the credit group and mints).
 *
 *         PAPER is taken by FireSale (the one PAPER approval a buyer gives), through hooks only this contract can call.
 *         Paid suggestions and credit spending stop while FireSale is paused.
 */
contract FireCredits is Ownable2Step, ReentrancyGuard {
    /// @notice Cards burned per free pack credit. Fixed forever: burn progress carries over from Series to Series, so
    ///         the rate is a promise, not a setting.
    uint256 public constant CARDS_PER_CREDIT = 42;
    /// @dev Longest suggestion text the owner can allow (the text lives only in the event).
    uint256 public constant MAX_SUGGESTION_BYTES = 1_024;
    /// @notice Most suggestions in one `suggestMany` (a theme and an art style together, say).
    uint256 public constant MAX_SUGGESTIONS_PER_TX = 3;
    /// @notice Picks a Series can have beyond its characters: its theme and its art style, suggested and picked too.
    uint256 public constant EXTRA_PICKS = 2;
    /// @notice A suggestion's PAPER never costs more than this many dollars (8 decimals) at the PAPER feed's price.
    uint256 public constant SUGGESTION_PAPER_CAP_USD = 1e8;
    /// @notice The most game prizes a Series can give out in all, across every game in the game room: free pack
    ///         credits, free cases and free gradings. Fixed, so the game server's wallet can never give out more,
    ///         whatever happens to it. Which place wins what is the owner's choice each Series, within these.
    uint256 public constant MAX_PRIZE_CREDITS = 6;
    uint256 public constant MAX_PRIZE_CASES = 50;
    uint256 public constant MAX_PRIZE_GRADES = 20;

    ICreditsCards public immutable CARDS;
    /// @notice The pack sale (set once): it takes the PAPER, burns the cards and mints the credit packs.
    FireSale public sale;

    /// @notice PAPER (wei) burned per character suggestion (0 = free). The owner can change it at any time; `suggest`
    ///         names the most the suggester pays.
    uint256 public suggestionPaper;
    /// @notice Longest suggestion text, in bytes.
    uint256 public suggestionMaxBytes = 280;

    /// @notice Free pack credits (from burning cards, or a picked suggestion). They stack, never expire, and work
    ///         in any live drop while its credit group is open.
    mapping(address => uint256) public credits;
    mapping(address => uint256) public burnCount; // cards burned toward the next credit
    mapping(uint256 fire => uint256) public picksOf;

    struct Suggestion { address by; uint64 at; bool granted; uint32 round; }
    Suggestion[] public suggestions;
    /// @notice The list new suggestions join. A picking session takes everything in the current list and starts a new
    ///         one, so the list clears after every session and unpicked suggestions don't carry over.
    uint32 public currentRound;
    /// @notice The Series being picked for, and the list it picks from.
    uint256 public sessionFire;
    uint32 public sessionRound;
    /// @notice Who may award competition prizes (the game server's wallet); the owner always may.
    address public prizeAwarder;
    /// @notice Game prizes given out in each Series, across all games (at most the MAX_PRIZE_* caps).
    struct Prizes { uint64 packs; uint64 cases; uint64 grades; }
    mapping(uint256 fire => Prizes) public prizesOf;
    /// @notice FirePsa, which holds the case and grading coupons (set once; until then prizes are packs only).
    IPrizePsa public psa;
    /// @notice The games (FireGames ids) the owner allows prizes for, so the awarder can't make up games.
    mapping(uint256 gameId => bool) public prizeGame;

    event SaleSet(address sale);
    event CardsBurned(address indexed holder, uint256 count, uint256 creditsEarned, uint256 burnCount);
    event Suggested(uint256 indexed id, address indexed by, uint32 indexed round, string text);
    event PickingSession(uint256 indexed fire, uint32 round);
    event SuggestionPicked(uint256 indexed fire, uint256 indexed id, address indexed by, uint256 credits);
    event SuggestionRulesSet(uint256 paper, uint256 maxBytes);
    event PrizeAwarderSet(address awarder);
    event PrizeAwarded(uint256 indexed fire, uint256 indexed gameId, address indexed winner, uint256 packs, uint256 cases, uint256 grades);
    event PsaSet(address psa);
    event PrizeGameSet(uint256 indexed gameId, bool on);

    error AlreadySet();
    error ZeroAddress();
    error BadConfig();
    error BadAmount();
    error NoCredits();
    error DropStarted();
    error NotThisRound();
    error AlreadyClaimed();
    error RenounceDisabled();
    error NotAwarder();
    error NotPrizeGame();

    constructor(address owner_, address cards, uint256 paperPerSuggestion) Ownable(owner_) {
        if (cards == address(0)) revert ZeroAddress();
        CARDS = ICreditsCards(cards);
        suggestionPaper = paperPerSuggestion;
    }

    // ================================================================ owner

    /// @notice Ownership can be handed over (two steps) but never renounced, so control can't be lost by mistake.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice The pack sale, once. It must point back here and sell the same cards.
    function setSale(address s) external onlyOwner {
        if (address(sale) != address(0)) revert AlreadySet();
        if (s == address(0)) revert ZeroAddress();
        if (FireSale(s).CREDITS() != address(this) || address(FireSale(s).CARDS()) != address(CARDS)) revert BadConfig();
        sale = FireSale(s);
        emit SaleSet(s);
    }

    /// @notice What a character suggestion costs (PAPER wei, 0 = free) and its longest text (1 to 1,024 bytes).
    ///         Suggestions aren't tied to a drop, so this is one setting for all; each `suggest` names its most PAPER.
    function setSuggestionRules(uint256 paper, uint256 maxBytes) external onlyOwner {
        if (maxBytes == 0 || maxBytes > MAX_SUGGESTION_BYTES) revert BadConfig();
        suggestionPaper = paper;
        suggestionMaxBytes = maxBytes;
        emit SuggestionRulesSet(paper, maxBytes);
    }

    /// @notice Give free pack credits (the drop's `creditsPerPick` each) to each picked suggestion's author. Only while
    ///         setting up a drop (before it opens; with one drop at a time no drop is running then), each suggestion
    ///         once, and no more picks than the Series has characters plus EXTRA_PICKS (its theme and art style).
    function pickSuggestions(uint256 fire, uint256[] calldata ids) external onlyOwner {
        FireSale.Drop memory d = sale.dropOf(fire);
        if (d.start == 0) revert BadConfig();
        if (block.timestamp >= d.start) revert DropStarted();
        if (picksOf[fire] + ids.length > CARDS.characterCount(fire) + EXTRA_PICKS) revert BadAmount();
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

    /// @notice Who may award competition prizes (0 = only the owner).
    function setPrizeAwarder(address a) external onlyOwner {
        prizeAwarder = a;
        emit PrizeAwarderSet(a);
    }

    /// @notice Allow (or stop) prizes for a game (its FireGames id).
    function setPrizeGame(uint256 gameId, bool on) external onlyOwner {
        if (gameId == 0) revert BadConfig();
        prizeGame[gameId] = on;
        emit PrizeGameSet(gameId, on);
    }

    /// @notice FirePsa, for case and grading prizes. Set once; FirePsa must name this contract as its coupon issuer.
    function setPsa(address p) external onlyOwner {
        if (p == address(0)) revert ZeroAddress();
        if (address(psa) != address(0)) revert AlreadySet();
        if (IPrizePsa(p).couponIssuer() != address(this)) revert BadConfig();
        psa = IPrizePsa(p);
        emit PsaSet(p);
    }

    /// @notice Give a game's competition winners for a Series their prizes: free pack credits (`packs`), free cases
    ///         and free gradings (coupons in FirePsa), any mix per winner. Only for a game the owner allows prizes
    ///         for, only for a Series whose drop has started (so made-up games or Series numbers can't add more), and
    ///         at most MAX_PRIZE_CREDITS packs, MAX_PRIZE_CASES cases and MAX_PRIZE_GRADES gradings per Series across
    ///         all games, however many calls.
    function awardPrizes(
        uint256 fire,
        uint256 gameId,
        address[] calldata winners,
        uint256[] calldata packs,
        uint256[] calldata cases,
        uint256[] calldata grades
    ) external {
        if (msg.sender != prizeAwarder && msg.sender != owner()) revert NotAwarder();
        if (!prizeGame[gameId]) revert NotPrizeGame();
        uint256 n = winners.length;
        if (n == 0 || packs.length != n || cases.length != n || grades.length != n) revert BadAmount();
        FireSale.Drop memory d = sale.dropOf(fire);
        if (d.start == 0 || block.timestamp < d.start) revert BadConfig();
        _countPrizes(fire, winners, packs, cases, grades);
        for (uint256 i; i < n; i++) {
            address w = winners[i];
            if (packs[i] > 0) credits[w] += packs[i];
            if (cases[i] + grades[i] > 0) psa.addCoupons(w, cases[i], grades[i]);
            emit PrizeAwarded(fire, gameId, w, packs[i], cases[i], grades[i]);
        }
    }

    /// @dev Checks the winners and adds their prizes to the Series' totals, within the caps (before anything is given).
    function _countPrizes(
        uint256 fire,
        address[] calldata winners,
        uint256[] calldata packs,
        uint256[] calldata cases,
        uint256[] calldata grades
    ) internal {
        Prizes memory t = prizesOf[fire];
        uint256 tp = t.packs;
        uint256 tc = t.cases;
        uint256 tg = t.grades;
        for (uint256 i; i < winners.length; i++) {
            if (winners[i] == address(0)) revert ZeroAddress();
            if (packs[i] + cases[i] + grades[i] == 0) revert BadAmount();
            tp += packs[i];
            tc += cases[i];
            tg += grades[i];
        }
        if (tp > MAX_PRIZE_CREDITS || tc > MAX_PRIZE_CASES || tg > MAX_PRIZE_GRADES) revert BadAmount();
        if (tc + tg > uint256(t.cases) + t.grades && address(psa) == address(0)) revert BadConfig();
        prizesOf[fire] = Prizes(uint64(tp), uint64(tc), uint64(tg));
    }

    // ================================================================ anyone

    /// @notice Spend `n` free pack credits in a live drop, while its credit group is open (the group's gate, price,
    ///         coins and wallet limit, and the regular-wallets rule, don't apply: a credit was earned). The credit
    ///         group's PAPER per pack alone (approve FireSale for it). The drop can cap credit packs in all and per
    ///         wallet.
    function useCredits(uint256 fire, uint256 n, uint256 maxPaper) external nonReentrant {
        // a pack of CARDS_PER_CREDIT or more cards could be burned for a free pack of itself: no credits there
        if (CARDS.cardsPerPack(fire) >= CARDS_PER_CREDIT) revert BadConfig();
        if (credits[msg.sender] < n) revert NoCredits();
        credits[msg.sender] -= n;
        sale.creditPacks(msg.sender, fire, n, maxPaper);
    }

    /// @notice Burn your cards. Every CARDS_PER_CREDIT (42) burned earns a free pack credit; extras count toward the
    ///         next one (a running count per wallet that carries over between Series). Never paused.
    function burnCards(uint256[] calldata ids) external nonReentrant {
        if (ids.length == 0) revert BadAmount();
        sale.burnCardsFor(msg.sender, ids);
        uint256 per = CARDS_PER_CREDIT;
        uint256 total = burnCount[msg.sender] + ids.length;
        uint256 earned = total / per;
        burnCount[msg.sender] = total % per;
        if (earned > 0) credits[msg.sender] += earned;
        emit CardsBurned(msg.sender, ids.length, earned, total % per);
    }

    /// @notice Suggest something for a future Series (a character, a theme or an art style; the site labels which in
    ///         the text). The PAPER (`suggestionPaper`, at most $1 worth) is burned; `maxPaper` is the most the
    ///         suggester agrees to pay (approve FireSale for it).
    function suggest(string calldata text, uint256 maxPaper) external nonReentrant returns (uint256 id) {
        _checkText(text);
        sale.burnPaperFor(msg.sender, suggestionPaper, SUGGESTION_PAPER_CAP_USD, maxPaper);
        id = _add(text);
    }

    /// @notice Several suggestions in one transaction (a theme and an art style together): each its own suggestion,
    ///         picked on its own, each costing `suggestionPaper` (at most $1 worth each). `maxPaper` covers them all.
    ///         Returns the first id; the rest follow in order.
    function suggestMany(string[] calldata texts, uint256 maxPaper) external nonReentrant returns (uint256 firstId) {
        uint256 n = texts.length;
        if (n == 0 || n > MAX_SUGGESTIONS_PER_TX) revert BadAmount();
        for (uint256 i; i < n; i++) _checkText(texts[i]);
        sale.burnPaperFor(msg.sender, suggestionPaper * n, SUGGESTION_PAPER_CAP_USD * n, maxPaper);
        firstId = suggestions.length;
        for (uint256 i; i < n; i++) _add(texts[i]);
    }

    function _checkText(string calldata text) internal view {
        uint256 len = bytes(text).length;
        if (len == 0 || len > suggestionMaxBytes) revert BadAmount();
    }

    function _add(string calldata text) internal returns (uint256 id) {
        id = suggestions.length;
        suggestions.push(Suggestion(msg.sender, uint64(block.timestamp), false, currentRound));
        emit Suggested(id, msg.sender, currentRound, text);
    }

    // ================================================================ views

    function suggestionCount() external view returns (uint256) {
        return suggestions.length;
    }
}
