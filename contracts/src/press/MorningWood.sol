// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "openzeppelin-contracts/contracts/token/ERC1155/ERC1155.sol";
import {ERC2981} from "openzeppelin-contracts/contracts/token/common/ERC2981.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @notice Chainlink-style ETH/USD feed (8 decimals), the same one FireSale and PaperBurner read.
interface IPressFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

/**
 * @title MorningWood
 * @notice The Morning Wood, a daily satirical newspaper (docs/morning-wood.md). One ERC-1155 token id per issue.
 *
 *         The owner or the editor key publishes an issue the night before (`publish`), with its metadata URI and the
 *         time it goes on sale. Until then the owner can pull it (`unpublish`: the veto). It sells for 24 hours from
 *         `opensAt`, unlimited copies, then never again.
 *
 *         A copy costs `paperPerCopy` PAPER (burned: sent straight to the dead address) plus `usdPerCopy` dollars in
 *         ETH (priced with the ETH/USD feed) or USDG, which goes to PaperBurner to buy PAPER and burn it (the keeper
 *         flushes it, as with FireSale). Both prices are fixed per issue when it is published, so a price change never
 *         touches an issue already announced; `maxCost` covers the ETH price moving. Nothing stays in this contract.
 *
 *         Holders of an issue can send a one-line letter or classified (`submitLetter`) for burning `letterPaper`
 *         PAPER. The text lives only in the `Letter` event, which the paper's pipeline reads.
 */
contract MorningWood is ERC1155, ERC2981, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Pay { ETH, USDG }

    struct Issue {
        string uri; // metadata (IPFS)
        uint64 opensAt; // sale: [opensAt, opensAt + WINDOW)
        uint64 sold; // copies sold
        uint96 paperPerCopy; // PAPER wei per copy, fixed at publish
        uint32 usdPerCopy; // dollars per copy (8 decimals), fixed at publish
    }

    string public constant name = "The Morning Wood";
    string public constant symbol = "WOOD";
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant WINDOW = 24 hours;
    uint256 public constant MAX_LEAD = 7 days; // an issue can be published at most this long before it opens
    /// @notice The editor publishes (and re-publishes) at least this long before an issue opens, so the owner always
    ///         has time to see it and veto it. The owner is exempt.
    uint256 public constant EDITOR_LEAD = 1 hours;
    uint256 public constant MAX_QTY = 1000; // copies per buy
    uint256 public constant MAX_LETTER_BYTES = 200;
    uint256 public constant MAX_PAPER = 10e18; // price bounds: PAPER per copy or letter
    uint256 public constant MAX_USD8 = 1e8; // $1.00 per copy
    uint96 public constant MAX_ROYALTY_BPS = 1000; // 10%
    uint256 public constant ETH_FEED_MAX_AGE = 25 hours;

    IERC20 public immutable PAPER;
    IERC20 public immutable USDG; // address(0) = no USDG
    uint256 public immutable USDG_UNIT;

    address public editor;
    address public paperBurner;
    IPressFeed public ethUsd;
    bool public paused;
    uint96 public paperPerCopy = 1e18;
    uint32 public usdPerCopy = 5e6; // $0.05
    uint96 public letterPaper = 1e18;
    string public contractURI;

    mapping(uint256 => Issue) internal _issues;

    event Published(uint256 indexed issue, string uri, uint64 opensAt, uint256 paperPerCopy, uint256 usdPerCopy);
    event Unpublished(uint256 indexed issue);
    event Bought(uint256 indexed issue, address indexed buyer, uint256 qty, Pay pay, uint256 cost, uint256 paperBurned);
    event Letter(uint256 indexed issue, address indexed from, string text);
    event EditorSet(address editor);
    event PricesSet(uint256 paperPerCopy, uint256 usdPerCopy, uint256 letterPaper);
    event WiringSet(address paperBurner, address ethUsd);
    event PausedSet(bool paused);
    event RoyaltySet(address to, uint96 bps);
    event ContractURIUpdated(); // ERC-7572

    error ZeroAddress();
    error NotEditor();
    error BadIssue();
    error BadTime();
    error AlreadyOpen();
    error NotOnSale();
    error BadQty();
    error OutOfBounds();
    error PriceMoved();
    error FeedUnavailable();
    error IsPaused();
    error NotHolder();
    error BadLetter();
    error TransferFailed();
    error RenounceDisabled();
    error TooLate();

    constructor(address owner_, address paper, address usdg, address paperBurner_, address ethUsd_, address royaltyTo)
        ERC1155("")
        Ownable(owner_)
    {
        if (paper == address(0) || royaltyTo == address(0)) revert ZeroAddress();
        PAPER = IERC20(paper);
        USDG = IERC20(usdg);
        USDG_UNIT = usdg == address(0) ? 0 : 10 ** _decimals(usdg);
        _setWiring(paperBurner_, ethUsd_);
        _setDefaultRoyalty(royaltyTo, 250); // 2.5%
    }

    // ================================================================ owner

    /// @notice Ownership can be handed over (two steps) but never renounced.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice The key the nightly pipeline publishes with (it can only publish and re-publish unopened issues).
    function setEditor(address e) external onlyOwner {
        editor = e;
        emit EditorSet(e);
    }

    /// @notice Prices for issues published from now on (and letters, at once). Within MAX_PAPER and MAX_USD8.
    function setPrices(uint96 paperPer, uint32 usdPer8, uint96 letter) external onlyOwner {
        if (paperPer > MAX_PAPER || usdPer8 > MAX_USD8 || letter > MAX_PAPER) revert OutOfBounds();
        (paperPerCopy, usdPerCopy, letterPaper) = (paperPer, usdPer8, letter);
        emit PricesSet(paperPer, usdPer8, letter);
    }

    /// @notice Where the ETH/USDG goes (PaperBurner) and the ETH/USD feed (8 decimals).
    function setWiring(address paperBurner_, address ethUsd_) external onlyOwner {
        _setWiring(paperBurner_, ethUsd_);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setRoyalty(address to, uint96 bps) external onlyOwner {
        if (bps > MAX_ROYALTY_BPS) revert OutOfBounds();
        _setDefaultRoyalty(to, bps);
        emit RoyaltySet(to, bps);
    }

    function setContractURI(string calldata u) external onlyOwner {
        contractURI = u;
        emit ContractURIUpdated();
    }

    /// @notice Correct an issue's metadata URI (e.g. a broken IPFS pin). The owner only.
    function setUri(uint256 issue, string calldata u) external onlyOwner {
        Issue storage s = _issues[issue];
        if (s.opensAt == 0) revert BadIssue();
        s.uri = u;
        emit URI(u, issue);
    }

    /// @notice The veto: pull an issue that hasn't opened yet. The owner only.
    function unpublish(uint256 issue) external onlyOwner {
        Issue storage s = _issues[issue];
        if (s.opensAt == 0) revert BadIssue();
        if (block.timestamp >= s.opensAt) revert AlreadyOpen();
        delete _issues[issue];
        emit Unpublished(issue);
    }

    // ================================================================ editor

    /// @notice Publish issue `issue` (its number, never 0) to open at `opensAt` (0 = now), at most MAX_LEAD ahead.
    ///         An issue not yet open can be published again (a new URI or time, at the current prices).
    ///         The editor must publish at least EDITOR_LEAD ahead (so never "now"), and can't re-publish an issue
    ///         that opens within EDITOR_LEAD (TooLate): what the owner previewed is what opens. The owner is exempt.
    function publish(uint256 issue, string calldata u, uint64 opensAt) external {
        bool isOwner = msg.sender == owner();
        if (msg.sender != editor && !isOwner) revert NotEditor();
        if (issue == 0 || bytes(u).length == 0) revert BadIssue();
        Issue storage s = _issues[issue];
        if (s.opensAt != 0 && block.timestamp >= s.opensAt) revert AlreadyOpen();
        if (!isOwner && s.opensAt != 0 && s.opensAt < block.timestamp + EDITOR_LEAD) revert TooLate();
        if (opensAt == 0) opensAt = uint64(block.timestamp);
        uint256 earliest = isOwner ? block.timestamp : block.timestamp + EDITOR_LEAD;
        if (opensAt < earliest || opensAt > block.timestamp + MAX_LEAD) revert BadTime();
        (s.uri, s.opensAt, s.paperPerCopy, s.usdPerCopy) = (u, opensAt, paperPerCopy, usdPerCopy);
        emit Published(issue, u, opensAt, paperPerCopy, usdPerCopy);
        emit URI(u, issue);
    }

    // ================================================================ readers

    /// @notice Buy `qty` copies of `issue`. Burns qty * the issue's PAPER price from the buyer (approve PAPER first)
    ///         and takes qty * its dollar price in `pay`: for ETH send at least the quote (the rest comes back), for
    ///         USDG approve it. `maxCost` is the most ETH/USDG the buyer agrees to pay.
    function buy(uint256 issue, uint256 qty, Pay pay, uint256 maxCost) external payable nonReentrant {
        if (paused) revert IsPaused();
        if (qty == 0 || qty > MAX_QTY) revert BadQty();
        Issue storage s = _issues[issue];
        if (!_onSale(s)) revert NotOnSale();
        uint256 paper = qty * s.paperPerCopy;
        uint256 cost = _cost(pay, qty * s.usdPerCopy);
        if (cost > maxCost) revert PriceMoved();
        // forge-lint: disable-next-line(unsafe-typecast)
        s.sold += uint64(qty); // qty <= MAX_QTY
        if (paper != 0) PAPER.safeTransferFrom(msg.sender, DEAD, paper);
        uint256 refund = msg.value;
        if (pay == Pay.ETH) {
            if (msg.value < cost) revert PriceMoved();
            refund -= cost;
            _sendEth(paperBurner, cost);
        } else if (cost != 0) {
            USDG.safeTransferFrom(msg.sender, paperBurner, cost);
        }
        _mint(msg.sender, issue, qty, "");
        emit Bought(issue, msg.sender, qty, pay, cost, paper);
        _sendEth(msg.sender, refund);
    }

    /// @notice A one-line letter or classified (start it with "AD:") for the next paper, from a holder of `issue`.
    ///         Burns `letterPaper` PAPER. 1-200 bytes. The text is only in the event.
    function submitLetter(uint256 issue, string calldata text) external nonReentrant {
        if (paused) revert IsPaused();
        if (balanceOf(msg.sender, issue) == 0) revert NotHolder();
        uint256 n = bytes(text).length;
        if (n == 0 || n > MAX_LETTER_BYTES) revert BadLetter();
        if (letterPaper != 0) PAPER.safeTransferFrom(msg.sender, DEAD, letterPaper);
        emit Letter(issue, msg.sender, text);
    }

    // ================================================================ views

    /// @notice What `qty` copies cost now: `cost` in `pay` (wei / USDG units) and `paper` (PAPER wei, burned).
    function quote(uint256 issue, uint256 qty, Pay pay) external view returns (uint256 cost, uint256 paper) {
        Issue storage s = _issues[issue];
        (uint256 p, uint256 u) = s.opensAt == 0 ? (uint256(paperPerCopy), uint256(usdPerCopy)) : (s.paperPerCopy, s.usdPerCopy);
        return (_cost(pay, qty * u), qty * p);
    }

    function issueOf(uint256 issue) external view returns (Issue memory) {
        return _issues[issue];
    }

    function onSale(uint256 issue) external view returns (bool) {
        return _onSale(_issues[issue]);
    }

    function uri(uint256 issue) public view override returns (string memory) {
        return _issues[issue].uri;
    }

    function supportsInterface(bytes4 id) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }

    // ================================================================ internals

    function _onSale(Issue storage s) internal view returns (bool) {
        return s.opensAt != 0 && block.timestamp >= s.opensAt && block.timestamp < uint256(s.opensAt) + WINDOW;
    }

    /// @dev Dollars (8 decimals) in `pay`, rounded up.
    function _cost(Pay pay, uint256 usd8) internal view returns (uint256) {
        if (usd8 == 0) return 0;
        if (pay == Pay.USDG) {
            if (USDG_UNIT == 0) revert FeedUnavailable();
            return (usd8 * USDG_UNIT + 1e8 - 1) / 1e8;
        }
        (bool ok, bytes memory ret) = address(ethUsd).staticcall(abi.encodeCall(IPressFeed.latestRoundData, ()));
        if (!ok || ret.length < 160) revert FeedUnavailable();
        (, int256 px,, uint256 at,) = abi.decode(ret, (uint80, int256, uint256, uint256, uint80));
        if (px <= 0 || at > block.timestamp || block.timestamp - at > ETH_FEED_MAX_AGE) revert FeedUnavailable();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 p = uint256(px); // px > 0 checked above
        return (usd8 * 1e18 + p - 1) / p;
    }

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _setWiring(address paperBurner_, address ethUsd_) internal {
        if (paperBurner_ == address(0) || ethUsd_ == address(0)) revert ZeroAddress();
        if (_decimals(ethUsd_) != 8) revert FeedUnavailable();
        (paperBurner, ethUsd) = (paperBurner_, IPressFeed(ethUsd_));
        emit WiringSet(paperBurner_, ethUsd_);
    }

    function _decimals(address a) private view returns (uint8) {
        (bool ok, bytes memory ret) = a.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || ret.length < 32) revert ZeroAddress();
        return abi.decode(ret, (uint8));
    }
}
