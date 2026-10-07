// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {FireSale} from "./FireSale.sol";

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
 *         - Spend credits in any live drop, at any time, for the drop's PAPER per pack alone (FireSale.creditPacks
 *           checks the drop's caps and mints).
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
    /// @notice A suggestion's PAPER never costs more than this many dollars (8 decimals) at the PAPER feed's price.
    uint256 public constant SUGGESTION_PAPER_CAP_USD = 1e8;

    ICreditsCards public immutable CARDS;
    /// @notice The pack sale (set once): it takes the PAPER, burns the cards and mints the credit packs.
    FireSale public sale;

    /// @notice PAPER (wei) burned per character suggestion (0 = free). The owner can change it at any time; `suggest`
    ///         names the most the suggester pays.
    uint256 public suggestionPaper;
    /// @notice Longest suggestion text, in bytes.
    uint256 public suggestionMaxBytes = 280;

    /// @notice Free pack credits (from burning cards, or a picked suggestion). They stack, never expire, and work
    ///         at any time in any live drop.
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

    event SaleSet(address sale);
    event CardsBurned(address indexed holder, uint256 count, uint256 creditsEarned, uint256 burnCount);
    event Suggested(uint256 indexed id, address indexed by, uint32 indexed round, string text);
    event PickingSession(uint256 indexed fire, uint32 round);
    event SuggestionPicked(uint256 indexed fire, uint256 indexed id, address indexed by, uint256 credits);
    event SuggestionRulesSet(uint256 paper, uint256 maxBytes);

    error AlreadySet();
    error ZeroAddress();
    error BadConfig();
    error BadAmount();
    error NoCredits();
    error DropStarted();
    error NotThisRound();
    error AlreadyClaimed();
    error RenounceDisabled();

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
    ///         once, and no more picks than the Series has characters.
    function pickSuggestions(uint256 fire, uint256[] calldata ids) external onlyOwner {
        FireSale.Drop memory d = sale.dropOf(fire);
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

    // ================================================================ anyone

    /// @notice Spend `n` free pack credits in a live drop, at any time (holder window, PLANK-only phase, wallet
    ///         limit and regular-wallets rule don't apply: a credit was earned). The drop's PAPER per pack alone
    ///         (approve FireSale for it). The drop can cap credit packs in all and per wallet.
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

    /// @notice Suggest a character for a future Series. The PAPER (`suggestionPaper`, at most $1 worth) is burned;
    ///         `maxPaper` is the most the suggester agrees to pay (approve FireSale for it).
    function suggest(string calldata text, uint256 maxPaper) external nonReentrant returns (uint256 id) {
        uint256 len = bytes(text).length;
        if (len == 0 || len > suggestionMaxBytes) revert BadAmount();
        sale.burnPaperFor(msg.sender, suggestionPaper, SUGGESTION_PAPER_CAP_USD, maxPaper);
        id = suggestions.length;
        suggestions.push(Suggestion(msg.sender, uint64(block.timestamp), false, currentRound));
        emit Suggested(id, msg.sender, currentRound, text);
    }

    // ================================================================ views

    function suggestionCount() external view returns (uint256) {
        return suggestions.length;
    }
}
