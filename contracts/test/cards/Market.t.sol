// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {ERC1155} from "openzeppelin-contracts/contracts/token/ERC1155/ERC1155.sol";
import {ERC2981} from "openzeppelin-contracts/contracts/token/common/ERC2981.sol";
import {IERC721Receiver} from "openzeppelin-contracts/contracts/token/ERC721/IERC721Receiver.sol";
import {FireMarket, MarketCardView} from "../../src/cards/FireMarket.sol";
import {V2Weth} from "./V2Lite.sol";

/// @dev Stands in for FireCards: an ERC-721 with a royalty, and a card can be locked (being graded: can't move).
contract MarketCards is ERC721("Cards", "C"), ERC2981 {
    mapping(uint256 => bool) public locked;
    /// as FireCards.changes: every move to another wallet and every case or grade change
    mapping(uint256 => uint256) public changes;

    function bump(uint256 id) external {
        changes[id]++;
    }

    constructor(address royaltyTo, uint96 bps) {
        _setDefaultRoyalty(royaltyTo, bps);
    }

    mapping(uint256 => MarketCardView) internal _view;

    function mint(address to, uint256 id) external {
        _mint(to, id);
    }

    /// what cardOf says about a card (Series, type, character, holo, grade); setCase / setMoves for the rest
    function setCase(uint256 id, bool cased_, uint256 moves_) external {
        _view[id].cased = cased_;
        _view[id].moves = moves_;
    }

    function setView(uint256 id, uint256 fire, uint256 cardType, uint256 character, bool frame, bool picture, uint256 grade) external {
        MarketCardView storage v = _view[id];
        v.fire = fire;
        v.cardType = cardType;
        v.character = character;
        v.holoFrame = frame;
        v.holoPicture = picture;
        v.grade = grade;
    }

    function cardOf(uint256 id) external view returns (MarketCardView memory) {
        _requireOwned(id);
        return _view[id];
    }

    function burn(uint256 id) external {
        _burn(id);
    }

    function lock(uint256 id, bool on) external {
        locked[id] = on;
        changes[id]++; // a grading starting or ending is a change (FireCards.setGradePending)
    }

    function setRoyalty(address to, uint96 bps) external {
        _setDefaultRoyalty(to, bps);
    }

    function _update(address to, uint256 id, address auth) internal override returns (address from) {
        from = super._update(to, id, auth);
        if (from != address(0) && to != address(0)) {
            require(!locked[id], "GradingInProgress");
            if (from != to) changes[id]++;
        }
    }

    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }
}

/// @dev Stands in for FirePacks: an ERC-1155 (id = Series) with a royalty.
contract MarketPacks is ERC1155(""), ERC2981 {
    constructor(address royaltyTo, uint96 bps) {
        _setDefaultRoyalty(royaltyTo, bps);
    }

    function mint(address to, uint256 series, uint256 n) external {
        _mint(to, series, n, "");
    }

    function supportsInterface(bytes4 id) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }
}

/// @dev A seller wallet that refuses ETH (its payout waits in `owed`), and can later take it.
contract Refuser is IERC721Receiver {
    bool public open;

    function setOpen(bool o) external {
        open = o;
    }

    function call(address to, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory r) = to.call(data);
        require(ok, "call failed");
        return r;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {
        require(open, "no ETH");
    }
}

/// @dev A buyer that tries to buy again from inside the card's arrival.
contract Reenterer is IERC721Receiver {
    FireMarket m;
    uint256 serial;
    uint256 price;
    bool public tried;
    bool public blocked;

    constructor(FireMarket m_) {
        m = m_;
    }

    function buy(uint256 s, uint256 p) external payable {
        serial = s;
        price = p;
        m.buyCard{value: p}(s, p, 0);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!tried) {
            tried = true;
            try m.buyCard{value: 0}(serial, price, 0) {} catch { blocked = true; }
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract MarketTest is Test {
    event CardListed(uint256 indexed serial, address indexed seller, uint256 price, uint256 expiry, uint256 changes);
    event CardSold(uint256 indexed serial, address indexed seller, address indexed buyer, uint256 price, uint256 royalty);
    event PacksSold(uint256 indexed id, address indexed seller, address indexed buyer, uint256 series, uint256 amount, uint256 pricePer, uint256 royalty);

    MarketCards cards;
    MarketPacks packs;
    V2Weth weth;
    FireMarket m;
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        cards = new MarketCards(treasury, 500); // 5%
        packs = new MarketPacks(treasury, 500);
        weth = new V2Weth();
        m = new FireMarket(address(cards), address(packs), address(weth));
        cards.mint(alice, 1);
        cards.mint(alice, 2);
        packs.mint(alice, 7, 10);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.startPrank(alice);
        cards.setApprovalForAll(address(m), true);
        packs.setApprovalForAll(address(m), true);
        vm.stopPrank();
    }

    function _list(uint256 serial, uint256 price) internal {
        vm.prank(alice);
        m.listCard(serial, price, block.timestamp + 30 days);
    }

    // ---------- cards

    function test_constructor() public {
        assertEq(address(m.CARDS()), address(cards));
        assertEq(address(m.PACKS()), address(packs));
        assertEq(address(m.WETH()), address(weth));
        vm.expectRevert(FireMarket.ZeroAddress.selector);
        new FireMarket(address(0), address(packs), address(weth));
        vm.expectRevert(FireMarket.ZeroAddress.selector);
        new FireMarket(address(cards), address(packs), address(0));
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(m).call{value: 1}(""); // only WETH sends ETH here
        assertFalse(ok);
    }

    function test_listAndBuyCard() public {
        vm.expectEmit(address(m));
        emit CardListed(1, alice, 1 ether, block.timestamp + 30 days, 0);
        _list(1, 1 ether);
        (address s, uint256 p, bool live,,) = m.cardOffer(1);
        assertEq(s, alice);
        assertEq(p, 1 ether);
        assertTrue(live);

        uint256 ch1 = cards.changes(1);
        vm.expectEmit(address(m));
        emit CardSold(1, alice, bob, 1 ether, 0.05 ether);
        vm.prank(bob);
        m.buyCard{value: 1 ether}(1, 1 ether, ch1);
        assertEq(cards.ownerOf(1), bob);
        assertEq(alice.balance, 0.95 ether);
        assertEq(treasury.balance, 0.05 ether);
        assertEq(address(m).balance, 0, "the market keeps nothing");
        (s,,,,) = m.cardOffer(1);
        assertEq(s, address(0), "sold: listing gone");
    }

    function test_listCard_checks() public {
        vm.prank(bob);
        vm.expectRevert(FireMarket.NotYours.selector);
        m.listCard(1, 1 ether, block.timestamp + 30 days);
        vm.startPrank(alice);
        vm.expectRevert(FireMarket.BadPrice.selector);
        m.listCard(1, 0, block.timestamp + 30 days);
        vm.expectRevert(FireMarket.BadPrice.selector);
        m.listCard(1, uint256(type(uint96).max) + 1, block.timestamp + 30 days);
        cards.setApprovalForAll(address(m), false);
        vm.expectRevert(FireMarket.NotApproved.selector);
        m.listCard(1, 1 ether, block.timestamp + 30 days);
        cards.approve(address(m), 1); // one card's approval is enough
        m.listCard(1, 1 ether, block.timestamp + 30 days);
        vm.stopPrank();
    }

    function test_relistChangesPrice() public {
        _list(1, 1 ether);
        _list(1, 2 ether);
        uint256 ch2 = cards.changes(1);
        vm.prank(bob);
        vm.expectRevert(FireMarket.PriceChanged.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, ch2);
        uint256 ch3 = cards.changes(1);
        vm.prank(bob);
        m.buyCard{value: 2 ether}(1, 2 ether, ch3);
        assertEq(cards.ownerOf(1), bob);
    }

    function test_buyCard_checks() public {
        uint256 ch4 = cards.changes(1);
        vm.prank(bob);
        vm.expectRevert(FireMarket.NotListed.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, ch4);
        _list(1, 1 ether);
        vm.startPrank(bob);
        uint256 ch5 = cards.changes(1);
        vm.expectRevert(FireMarket.WrongPayment.selector);
        m.buyCard{value: 0.9 ether}(1, 1 ether, ch5);
        uint256 ch6 = cards.changes(1);
        vm.expectRevert(FireMarket.WrongPayment.selector);
        m.buyCard{value: 1.1 ether}(1, 1 ether, ch6);
        uint256 ch7 = cards.changes(1);
        vm.expectRevert(FireMarket.PriceChanged.selector);
        m.buyCard{value: 0.5 ether}(1, 0.5 ether, ch7);
        vm.stopPrank();
        vm.deal(alice, 1 ether);
        uint256 ch8 = cards.changes(1);
        vm.prank(alice);
        vm.expectRevert(FireMarket.OwnListing.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, ch8);
    }

    function test_staleCard_movedAway() public {
        _list(1, 1 ether);
        vm.prank(alice);
        cards.transferFrom(alice, carol, 1);
        (,, bool live,,) = m.cardOffer(1);
        assertFalse(live);
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, 0);
        // the new holder can't be made to sell: alice's listing is alice's, and anyone may clear it
        vm.prank(bob);
        m.cancelCard(1);
        (address s,,,,) = m.cardOffer(1);
        assertEq(s, address(0));
    }

    function test_staleCard_approvalTakenBack() public {
        _list(1, 1 ether);
        vm.prank(alice);
        cards.setApprovalForAll(address(m), false);
        uint256 ch10 = cards.changes(1);
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, ch10);
    }

    function test_staleCard_burned() public {
        _list(1, 1 ether);
        cards.burn(1);
        (,, bool live,,) = m.cardOffer(1);
        assertFalse(live);
        uint256 ch11 = cards.changes(1);
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, ch11);
        vm.prank(bob);
        m.cancelCard(1);
    }

    function test_cancelCard() public {
        _list(1, 1 ether);
        vm.prank(bob);
        vm.expectRevert(FireMarket.NotStale.selector);
        m.cancelCard(1);
        vm.prank(alice);
        m.cancelCard(1);
        vm.prank(alice);
        vm.expectRevert(FireMarket.NotListed.selector);
        m.cancelCard(1);
        uint256 ch12 = cards.changes(1);
        vm.prank(bob);
        vm.expectRevert(FireMarket.NotListed.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, ch12);
    }

    function test_gradingCard_endsTheListing() public {
        _list(1, 1 ether);
        cards.lock(1, true); // sent for grading: a change
        (,, bool live,,) = m.cardOffer(1);
        assertFalse(live, "sent for grading: the listing is dead");
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, 0);
        cards.lock(1, false); // graded (or the grading cancelled): still dead, never at the old price
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, 0);
        vm.prank(bob);
        m.cancelCard(1); // anyone may clear it
        _list(1, 2 ether); // listed again as it is now
        uint256 ch13 = cards.changes(1);
        vm.prank(bob);
        m.buyCard{value: 2 ether}(1, 2 ether, ch13);
        assertEq(cards.ownerOf(1), bob);
    }

    /// The bug OpenSea paid ~750 ETH for (Jan 2022): a card that leaves and comes back must not bring its old price back.
    function test_cardComesBack_oldListingStaysDead() public {
        _list(1, 1 ether);
        vm.prank(alice);
        cards.transferFrom(alice, carol, 1);
        vm.prank(carol);
        cards.transferFrom(carol, alice, 1);
        (,, bool live,,) = m.cardOffer(1);
        assertFalse(live, "back with its seller: the old listing stays dead");
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, 0);
        uint256 ch14 = cards.changes(1);
        vm.prank(bob);
        vm.expectRevert(FireMarket.CardChanged.selector); // with today's count: the listing remembers the old one
        m.buyCard{value: 1 ether}(1, 1 ether, ch14);
        _list(1, 3 ether); // a new listing works
        uint256 ch15 = cards.changes(1);
        vm.prank(bob);
        m.buyCard{value: 3 ether}(1, 3 ether, ch15);
        assertEq(cards.ownerOf(1), bob);
    }

    function test_cancelAll_endsCardListings() public {
        _list(1, 1 ether);
        _list(2, 1 ether);
        vm.prank(alice);
        m.cancelAll();
        (,, bool live,,) = m.cardOffer(1);
        assertFalse(live);
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyCard{value: 1 ether}(2, 1 ether, 0);
        vm.prank(bob);
        m.cancelCard(2); // anyone may clear it
    }

    function test_approvalRevokedAndRegranted_listingStaysDeadAfterExpiry() public {
        _list(1, 1 ether);
        vm.prank(alice);
        cards.setApprovalForAll(address(m), false);
        (,, bool live,,) = m.cardOffer(1);
        assertFalse(live);
        vm.warp(block.timestamp + 30 days); // the listing's end
        vm.prank(alice);
        cards.setApprovalForAll(address(m), true);
        (,, live,,) = m.cardOffer(1);
        assertFalse(live, "approval back on, but the listing has ended");
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, 0);
    }

    function test_listingExpiry() public {
        vm.startPrank(alice);
        vm.expectRevert(FireMarket.BadExpiry.selector);
        m.listCard(1, 1 ether, block.timestamp);
        vm.expectRevert(FireMarket.BadExpiry.selector);
        m.listCard(1, 1 ether, block.timestamp + 181 days);
        vm.expectRevert(FireMarket.BadExpiry.selector);
        m.listPacks(7, 1, 1 ether, block.timestamp + 181 days);
        m.listCard(1, 1 ether, block.timestamp + 1 days);
        m.listPacks(7, 2, 1 ether, block.timestamp + 1 days);
        vm.stopPrank();
        vm.warp(block.timestamp + 1 days);
        (,, bool live, uint256 expiry,) = m.cardOffer(1);
        assertFalse(live, "ended");
        assertEq(expiry, block.timestamp);
        (, uint256 packsLive) = m.packOffer(1);
        assertEq(packsLive, 0);
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyCard{value: 1 ether}(1, 1 ether, 0);
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyPacks{value: 1 ether}(1, 1, 1 ether);
        vm.startPrank(bob); // anyone may clear them
        m.cancelCard(1);
        m.cancelPacks(1);
        vm.stopPrank();
    }

    function test_buyerSawAnOlderCard() public {
        _list(1, 1 ether);
        cards.bump(1); // e.g. cased by its seller after the buyer looked
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector); // the listing is dead
        m.buyCard{value: 1 ether}(1, 1 ether, 0);
        _list(1, 1 ether); // and listed again at the same price, as the changed card
        vm.prank(bob);
        vm.expectRevert(FireMarket.CardChanged.selector); // the buyer looked at the card before: no sale
        m.buyCard{value: 1 ether}(1, 1 ether, 0);
    }

    function test_listCards_cancelCards_bulk() public {
        uint256[] memory ids = new uint256[](2);
        ids[0] = 1;
        ids[1] = 2;
        uint256[] memory prices = new uint256[](2);
        prices[0] = 1 ether;
        prices[1] = 2 ether;
        vm.prank(alice);
        m.listCards(ids, prices, block.timestamp + 7 days);
        (, uint256 p2, bool live,,) = m.cardOffer(2);
        assertTrue(live);
        assertEq(p2, 2 ether);
        vm.prank(alice);
        m.cancelCards(ids);
        (address s,,,,) = m.cardOffer(1);
        assertEq(s, address(0));
        uint256[] memory one = new uint256[](1);
        vm.prank(alice);
        vm.expectRevert(FireMarket.BadAmount.selector);
        m.listCards(ids, one, block.timestamp + 7 days);
        uint256[] memory many = new uint256[](21);
        vm.prank(alice);
        vm.expectRevert(FireMarket.TooMany.selector);
        m.listCards(many, many, block.timestamp + 7 days);
    }

    function test_buyCards_skipsGone_refundsTheRest() public {
        cards.mint(alice, 3);
        _list(1, 1 ether);
        _list(2, 2 ether);
        _list(3, 3 ether);
        vm.prank(alice);
        cards.transferFrom(alice, carol, 2); // card 2 gone before bob's buy lands
        uint256[] memory ids = new uint256[](3);
        uint256[] memory prices = new uint256[](3);
        uint256[] memory ch = new uint256[](3);
        (ids[0], ids[1], ids[2]) = (1, 2, 3);
        (prices[0], prices[1], prices[2]) = (1 ether, 2 ether, 3 ether);
        uint256 before = bob.balance;
        vm.prank(bob);
        vm.expectRevert(FireMarket.WrongPayment.selector);
        m.buyCards{value: 5 ether}(ids, prices, ch);
        vm.prank(bob);
        uint256 n = m.buyCards{value: 6 ether}(ids, prices, ch);
        assertEq(n, 2);
        assertEq(cards.ownerOf(1), bob);
        assertEq(cards.ownerOf(3), bob);
        assertEq(cards.ownerOf(2), carol);
        assertEq(before - bob.balance, 4 ether, "card 2's ETH came back");
        assertEq(address(m).balance, 0);
        // nothing left to buy: the whole thing fails, nothing charged
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyCards{value: 6 ether}(ids, prices, ch);
    }

    function test_buyCards_refundToARefusingWallet_waitsInOwed() public {
        Refuser r = new Refuser();
        vm.deal(address(r), 3 ether);
        _list(1, 1 ether);
        _list(2, 2 ether);
        vm.prank(alice);
        m.cancelCard(2);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory prices = new uint256[](2);
        uint256[] memory ch = new uint256[](2);
        (ids[0], ids[1]) = (1, 2);
        (prices[0], prices[1]) = (1 ether, 2 ether);
        vm.prank(address(r));
        m.buyCards{value: 3 ether}(ids, prices, ch);
        assertEq(cards.ownerOf(1), address(r));
        assertEq(m.owed(address(r)), 2 ether, "its refund waits");
        assertEq(address(m).balance, 2 ether, "the market holds exactly what is owed");
    }

    function test_royalty_noneAndCapped() public {
        cards.setRoyalty(treasury, 0);
        _list(1, 1 ether);
        uint256 ch16 = cards.changes(1);
        vm.prank(bob);
        m.buyCard{value: 1 ether}(1, 1 ether, ch16);
        assertEq(alice.balance, 1 ether);
        assertEq(treasury.balance, 0);
        // a royalty over 10% is paid at 10%
        cards.setRoyalty(treasury, 5000);
        _list(2, 1 ether);
        uint256 ch17 = cards.changes(2);
        vm.prank(bob);
        m.buyCard{value: 1 ether}(2, 1 ether, ch17);
        assertEq(treasury.balance, 0.1 ether);
        assertEq(alice.balance, 1.9 ether);
    }

    function test_refusedPayout_waitsInOwed() public {
        Refuser r = new Refuser();
        cards.mint(address(r), 9);
        r.call(address(cards), abi.encodeCall(cards.setApprovalForAll, (address(m), true)));
        r.call(address(m), abi.encodeCall(m.listCard, (9, 1 ether, block.timestamp + 30 days)));
        uint256 ch18 = cards.changes(9);
        vm.prank(bob);
        m.buyCard{value: 1 ether}(9, 1 ether, ch18);
        assertEq(cards.ownerOf(9), bob, "the sale went through");
        assertEq(m.owed(address(r)), 0.95 ether);
        assertEq(address(m).balance, 0.95 ether);
        vm.expectRevert(); // still refusing: withdraw fails, nothing lost
        r.call(address(m), abi.encodeCall(m.withdraw, ()));
        r.setOpen(true);
        r.call(address(m), abi.encodeCall(m.withdraw, ()));
        assertEq(address(r).balance, 0.95 ether);
        assertEq(m.owed(address(r)), 0);
        vm.prank(bob);
        vm.expectRevert(FireMarket.NothingOwed.selector);
        m.withdraw();
    }

    function test_reentrantBuy_blocked() public {
        Reenterer e = new Reenterer(m);
        vm.deal(address(e), 1 ether);
        _list(1, 1 ether);
        e.buy{value: 1 ether}(1, 1 ether);
        assertTrue(e.tried() && e.blocked());
        assertEq(cards.ownerOf(1), address(e));
        assertEq(address(m).balance, 0);
    }

    // ---------- packs

    function test_listAndBuyPacks_partly() public {
        vm.prank(alice);
        uint256 id = m.listPacks(7, 5, 0.01 ether, block.timestamp + 30 days);
        assertEq(id, 1);
        vm.expectEmit(address(m));
        emit PacksSold(1, alice, bob, 7, 2, 0.01 ether, 0.001 ether);
        vm.prank(bob);
        m.buyPacks{value: 0.02 ether}(1, 2, 0.01 ether);
        assertEq(packs.balanceOf(bob, 7), 2);
        assertEq(packs.balanceOf(alice, 7), 8);
        assertEq(alice.balance, 0.019 ether);
        assertEq(treasury.balance, 0.001 ether);
        (FireMarket.PackListing memory l, uint256 live) = m.packOffer(1);
        assertEq(l.amount, 3);
        assertEq(live, 3);
        vm.prank(carol);
        m.buyPacks{value: 0.03 ether}(1, 3, 0.01 ether);
        (l,) = m.packOffer(1);
        assertEq(l.seller, address(0), "sold out: listing gone");
        assertEq(address(m).balance, 0);
    }

    function test_packs_checks() public {
        vm.startPrank(alice);
        vm.expectRevert(FireMarket.BadPrice.selector);
        m.listPacks(7, 1, 0, block.timestamp + 30 days);
        vm.expectRevert(FireMarket.BadAmount.selector);
        m.listPacks(7, 0, 1 ether, block.timestamp + 30 days);
        vm.expectRevert(FireMarket.NotYours.selector);
        m.listPacks(7, 11, 1 ether, block.timestamp + 30 days);
        vm.expectRevert(FireMarket.NotYours.selector);
        m.listPacks(8, 1, 1 ether, block.timestamp + 30 days);
        packs.setApprovalForAll(address(m), false);
        vm.expectRevert(FireMarket.NotApproved.selector);
        m.listPacks(7, 1, 1 ether, block.timestamp + 30 days);
        packs.setApprovalForAll(address(m), true);
        m.listPacks(7, 4, 1 ether, block.timestamp + 30 days);
        vm.stopPrank();
        vm.startPrank(bob);
        vm.expectRevert(FireMarket.BadAmount.selector);
        m.buyPacks{value: 5 ether}(1, 5, 1 ether);
        vm.expectRevert(FireMarket.BadAmount.selector);
        m.buyPacks{value: 0}(1, 0, 1 ether);
        vm.expectRevert(FireMarket.PriceChanged.selector);
        m.buyPacks{value: 1}(1, 1, 1);
        vm.expectRevert(FireMarket.WrongPayment.selector);
        m.buyPacks{value: 1 ether}(1, 2, 1 ether);
        vm.expectRevert(FireMarket.NotListed.selector);
        m.buyPacks{value: 1 ether}(2, 1, 1 ether);
        vm.stopPrank();
    }

    function test_packs_sellerSpentSome() public {
        vm.prank(alice);
        m.listPacks(7, 8, 1 ether, block.timestamp + 30 days);
        vm.prank(alice);
        packs.safeTransferFrom(alice, carol, 7, 7, ""); // 3 left with alice
        (, uint256 live) = m.packOffer(1);
        assertEq(live, 3);
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyPacks{value: 4 ether}(1, 4, 1 ether);
        vm.prank(bob);
        vm.expectRevert(FireMarket.NotStale.selector); // some still buyable
        m.cancelPacks(1);
        vm.prank(bob);
        m.buyPacks{value: 3 ether}(1, 3, 1 ether);
        (, live) = m.packOffer(1);
        assertEq(live, 0);
        vm.prank(bob);
        m.cancelPacks(1); // nothing left to buy: anyone may clear it
    }

    function test_packs_cancelAll() public {
        vm.startPrank(alice);
        m.listPacks(7, 2, 1 ether, block.timestamp + 30 days);
        m.cancelAll();
        vm.stopPrank();
        (, uint256 live) = m.packOffer(1);
        assertEq(live, 0);
        vm.prank(bob);
        vm.expectRevert(FireMarket.Stale.selector);
        m.buyPacks{value: 1 ether}(1, 1, 1 ether);
        vm.prank(alice);
        m.cancelPacks(1);
    }

    // ---------- every sale: the buyer pays exactly the price, the seller and the royalty split it, the market keeps 0
    function testFuzz_cardPayout(uint96 price, uint16 bps) public {
        price = uint96(bound(price, 1, 1e24));
        bps = uint16(bound(bps, 0, 10_000));
        cards.setRoyalty(treasury, bps);
        _list(1, price);
        vm.deal(bob, price);
        uint256 ch19 = cards.changes(1);
        vm.prank(bob);
        m.buyCard{value: price}(1, price, ch19);
        uint256 cap = uint256(price) * 1000 / 10_000;
        uint256 roy = uint256(price) * bps / 10_000;
        if (roy > cap) roy = cap;
        assertEq(treasury.balance, roy);
        assertEq(alice.balance, price - roy);
        assertEq(bob.balance, 0);
        assertEq(address(m).balance, 0);
    }

    function testFuzz_packPayout(uint96 pricePer, uint8 n) public {
        pricePer = uint96(bound(pricePer, 1, 1e22));
        n = uint8(bound(n, 1, 10));
        vm.prank(alice);
        m.listPacks(7, 10, pricePer, block.timestamp + 30 days);
        uint256 total = uint256(pricePer) * n;
        vm.deal(bob, total);
        vm.prank(bob);
        m.buyPacks{value: total}(1, n, pricePer);
        assertEq(treasury.balance + alice.balance, total);
        assertEq(address(m).balance, 0);
        assertEq(packs.balanceOf(bob, 7), n);
    }

    // ---------- offers (paid in WETH, which stays in the buyer's wallet until accepted)

    function _fund(address who, uint256 amount) internal {
        vm.deal(who, amount);
        vm.startPrank(who);
        weth.deposit{value: amount}();
        weth.approve(address(m), amount);
        vm.stopPrank();
    }

    function _offer(address who, uint8 kind, uint256 target, uint256 price, uint256 qty) internal returns (uint256) {
        vm.prank(who);
        return m.makeOffer(kind, target, price, qty, block.timestamp + 7 days);
    }

    function test_offerOnACard_accepted() public {
        _fund(carol, 1 ether);
        uint256 id = _offer(carol, 0, 2, 0.4 ether, 1);
        (FireMarket.Offer memory o, bool live) = m.offerOf(id);
        assertTrue(live);
        assertEq(o.buyer, carol);
        assertEq(weth.balanceOf(carol), 1 ether, "nothing moves until accepted");
        uint256 before = alice.balance;
        vm.prank(alice);
        m.acceptOffer(id, 2, 1, 0.4 ether);
        assertEq(cards.ownerOf(2), carol);
        assertEq(weth.balanceOf(carol), 0.6 ether);
        assertEq(alice.balance - before, 0.38 ether, "the seller gets ETH, less the 5% royalty");
        assertEq(treasury.balance, 0.02 ether);
        assertEq(address(m).balance, 0);
        assertEq(weth.balanceOf(address(m)), 0, "the market keeps nothing");
        (o,) = m.offerOf(id);
        assertEq(o.buyer, address(0), "filled: gone");
    }

    function test_offer_checks() public {
        _fund(carol, 1 ether);
        vm.startPrank(carol);
        vm.expectRevert(FireMarket.BadPrice.selector);
        m.makeOffer(0, 2, 0, 1, block.timestamp + 1 days);
        vm.expectRevert(FireMarket.BadOffer.selector);
        m.makeOffer(0, 2, 1 ether, 2, block.timestamp + 1 days); // one card is one card
        vm.expectRevert(FireMarket.BadOffer.selector);
        m.makeOffer(3, 2, 1 ether, 1, block.timestamp + 1 days);
        vm.expectRevert(FireMarket.BadExpiry.selector);
        m.makeOffer(0, 2, 1 ether, 1, block.timestamp);
        vm.expectRevert(FireMarket.BadExpiry.selector);
        m.makeOffer(0, 2, 1 ether, 1, block.timestamp + 181 days);
        vm.expectRevert(FireMarket.BadOffer.selector);
        m.makeOffer(2, 0, 1 ether, 1, block.timestamp + 1 days); // packs of no Series
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(FireMarket.OwnListing.selector);
        m.makeOffer(0, 2, 1 ether, 1, block.timestamp + 1 days); // an offer on your own card
        uint256 id = _offer(carol, 0, 2, 0.4 ether, 1);
        vm.startPrank(alice);
        vm.expectRevert(FireMarket.PriceChanged.selector);
        m.acceptOffer(id, 2, 1, 0.5 ether);
        vm.expectRevert(FireMarket.NoMatch.selector);
        m.acceptOffer(id, 1, 1, 0.4 ether); // another card
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(FireMarket.NotYours.selector);
        m.acceptOffer(id, 2, 1, 0.4 ether);
        vm.prank(carol);
        vm.expectRevert(FireMarket.OwnListing.selector);
        m.acceptOffer(id, 2, 1, 0.4 ether);
        vm.prank(alice);
        vm.expectRevert(FireMarket.OfferGone.selector);
        m.acceptOffer(99, 2, 1, 0.4 ether);
    }

    function test_offer_buyerCantPay_staleAndClearable() public {
        _fund(carol, 0.4 ether);
        uint256 id = _offer(carol, 0, 2, 0.4 ether, 1);
        vm.prank(carol);
        weth.transfer(bob, 0.1 ether); // spent some of it
        (, bool live) = m.offerOf(id);
        assertFalse(live);
        vm.prank(alice);
        vm.expectRevert(FireMarket.Stale.selector);
        m.acceptOffer(id, 2, 1, 0.4 ether);
        vm.prank(bob);
        m.cancelOffer(id); // anyone may clear it
        // approval taken back: same
        _fund(carol, 0.4 ether);
        id = _offer(carol, 0, 2, 0.4 ether, 1);
        vm.prank(bob);
        vm.expectRevert(FireMarket.NotStale.selector);
        m.cancelOffer(id);
        vm.prank(carol);
        weth.approve(address(m), 0);
        vm.prank(alice);
        vm.expectRevert(FireMarket.Stale.selector);
        m.acceptOffer(id, 2, 1, 0.4 ether);
    }

    function test_offer_expiresAndCancelAll() public {
        _fund(carol, 2 ether);
        uint256 a = _offer(carol, 0, 2, 0.4 ether, 1);
        vm.warp(block.timestamp + 7 days);
        (, bool live) = m.offerOf(a);
        assertFalse(live, "expired");
        uint256 b = _offer(carol, 0, 2, 0.4 ether, 1);
        uint256 c = _offer(carol, 2, 7, 0.01 ether, 3);
        vm.prank(carol);
        m.cancelAll();
        (, live) = m.offerOf(b);
        assertFalse(live);
        (, live) = m.offerOf(c);
        assertFalse(live);
        vm.prank(carol);
        m.cancelOffer(b);
        vm.prank(bob);
        vm.expectRevert(FireMarket.OfferGone.selector);
        m.cancelOffer(b);
    }

    function test_matchOffer_criteria() public {
        // card 1: Series 3, type 4 (Gold), character 2, full holo, PDA 9; card 2: Series 3, type 1, character 2, no holo
        cards.setView(1, 3, 4, 2, true, true, 9);
        cards.setView(2, 3, 1, 2, false, false, 0);
        _fund(carol, 2 ether);
        uint256 goldNine = _offer(carol, 1, m.matchKey(3, 5, 0, 4, 9, 0, 0), 0.5 ether, 2); // any Series 3 Gold, full holo, PDA 9+
        vm.prank(alice);
        vm.expectRevert(FireMarket.NoMatch.selector);
        m.acceptOffer(goldNine, 2, 1, 0.5 ether);
        vm.prank(alice);
        m.acceptOffer(goldNine, 1, 99, 0.5 ether); // amount ignored for a card: one
        assertEq(cards.ownerOf(1), carol);
        (FireMarket.Offer memory o, bool live) = m.offerOf(goldNine);
        assertEq(o.qty, 1, "one more wanted");
        assertTrue(live);
        // the holo rules and "any"
        assertTrue(m.matches(m.matchKey(0, 0, 0, 0, 0, 0, 0), 2), "any card");
        assertTrue(m.matches(m.matchKey(0, 0, 3, 1, 0, 0, 0), 2), "character 2, no holo");
        assertFalse(m.matches(m.matchKey(0, 0, 3, 5, 0, 0, 0), 2), "any holo: not a plain card");
        assertFalse(m.matches(m.matchKey(4, 0, 0, 0, 0, 0, 0), 2), "another Series");
        assertFalse(m.matches(m.matchKey(0, 0, 0, 0, 1, 0, 0), 2), "graded: an ungraded card isn't");
        cards.setView(2, 3, 1, 2, true, false, 0);
        assertTrue(m.matches(m.matchKey(0, 0, 0, 2, 0, 0, 0), 2), "frame only");
        assertFalse(m.matches(m.matchKey(0, 0, 0, 3, 0, 0, 0), 2), "not picture only");
        assertFalse(m.matches(m.matchKey(0, 0, 0, 4, 0, 0, 0), 2), "not full");
        vm.expectRevert(FireMarket.BadOffer.selector);
        m.matchKey(0, 0, 0, 6, 0, 0, 0);
        vm.expectRevert(FireMarket.BadOffer.selector);
        m.matchKey(0, 0, 0, 0, 11, 0, 0);
    }

    function test_offer_minimumPrice() public {
        _fund(carol, 1 ether);
        uint256 min = m.MIN_OFFER();
        vm.prank(carol);
        vm.expectRevert(FireMarket.BadPrice.selector);
        m.makeOffer(2, 7, min - 1, 1, block.timestamp + 1 days);
        _offer(carol, 2, 7, min, 1);
    }

    function test_cardOffer_isForTheCardAsItWas() public {
        _fund(carol, 1 ether);
        uint256 id = _offer(carol, 0, 2, 0.4 ether, 1); // card 2: ungraded, uncased
        cards.setView(2, 0, 0, 0, false, false, 3); // graded a 3 since
        vm.prank(alice);
        vm.expectRevert(FireMarket.CardChanged.selector);
        m.acceptOffer(id, 2, 1, 0.4 ether);
        cards.setView(2, 0, 0, 0, false, false, 0);
        cards.setCase(2, true, 0); // cased since
        vm.prank(alice);
        vm.expectRevert(FireMarket.CardChanged.selector);
        m.acceptOffer(id, 2, 1, 0.4 ether);
        cards.setCase(2, false, 0);
        vm.prank(alice);
        m.acceptOffer(id, 2, 1, 0.4 ether);
        assertEq(cards.ownerOf(2), carol);
        assertEq(weth.balanceOf(carol), 0.6 ether, "nothing taken while it didn't match");
    }

    function test_matchOffer_movesAndCased() public {
        cards.setView(1, 3, 4, 2, false, false, 0);
        cards.setCase(1, false, 4); // uncased, moved 4 times
        assertTrue(m.matches(m.matchKey(0, 0, 0, 0, 0, 5, 0), 1), "at most 4 moves");
        assertFalse(m.matches(m.matchKey(0, 0, 0, 0, 0, 4, 0), 1), "at most 3 moves");
        assertFalse(m.matches(m.matchKey(0, 0, 0, 0, 0, 1, 0), 1), "never moved");
        assertTrue(m.matches(m.matchKey(0, 0, 0, 0, 0, 0, 2), 1), "uncased only");
        assertFalse(m.matches(m.matchKey(0, 0, 0, 0, 0, 0, 1), 1), "cased only");
        cards.setCase(1, true, 0);
        assertTrue(m.matches(m.matchKey(0, 0, 0, 0, 0, 1, 1), 1), "cased, never moved");
        vm.expectRevert(FireMarket.BadOffer.selector);
        m.matchKey(0, 0, 0, 0, 0, 17, 0);
        vm.expectRevert(FireMarket.BadOffer.selector);
        m.matchKey(0, 0, 0, 0, 0, 0, 3);
    }

    /// An unfunded offer can't be accepted, but it comes back when its buyer has WETH again (until it expires or is
    /// cancelled): the site lists such offers in Mine so they can be cancelled. Pinned here so it never surprises us.
    function test_offer_unfundedComesBackWhenFundedAgain() public {
        _fund(carol, 0.4 ether);
        uint256 id = _offer(carol, 0, 2, 0.4 ether, 1);
        vm.prank(carol);
        weth.transfer(bob, 0.4 ether);
        (, bool live) = m.offerOf(id);
        assertFalse(live);
        _fund(carol, 0.4 ether);
        (, live) = m.offerOf(id);
        assertTrue(live, "funded again: live again");
        vm.prank(carol);
        m.cancelOffer(id);
    }

    function test_packOffer_partly() public {
        _fund(carol, 1 ether);
        uint256 id = _offer(carol, 2, 7, 0.01 ether, 5);
        vm.prank(alice);
        vm.expectRevert(FireMarket.BadAmount.selector);
        m.acceptOffer(id, 0, 6, 0.01 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        m.acceptOffer(id, 0, 3, 0.01 ether);
        assertEq(packs.balanceOf(carol, 7), 3);
        assertEq(alice.balance - before, 0.0285 ether);
        assertEq(treasury.balance, 0.0015 ether);
        (FireMarket.Offer memory o,) = m.offerOf(id);
        assertEq(o.qty, 2);
        vm.prank(alice);
        m.acceptOffer(id, 0, 2, 0.01 ether);
        (o,) = m.offerOf(id);
        assertEq(o.buyer, address(0));
        assertEq(weth.balanceOf(carol), 0.95 ether);
    }

    function test_offer_cardBeingGraded_cantBeSold() public {
        _fund(carol, 1 ether);
        uint256 id = _offer(carol, 0, 2, 0.4 ether, 1);
        cards.lock(2, true);
        vm.prank(alice);
        vm.expectRevert(bytes("GradingInProgress"));
        m.acceptOffer(id, 2, 1, 0.4 ether);
        assertEq(weth.balanceOf(carol), 1 ether, "nothing taken");
    }

    function test_offer_sellerRefusesEth_waitsInOwed() public {
        Refuser r = new Refuser();
        cards.mint(address(r), 9);
        r.call(address(cards), abi.encodeCall(cards.setApprovalForAll, (address(m), true)));
        _fund(carol, 1 ether);
        uint256 id = _offer(carol, 0, 9, 1 ether, 1);
        r.call(address(m), abi.encodeCall(m.acceptOffer, (id, 9, 1, 1 ether)));
        assertEq(cards.ownerOf(9), carol);
        assertEq(m.owed(address(r)), 0.95 ether);
    }

    function testFuzz_offerPayout(uint96 price, uint8 n) public {
        price = uint96(bound(price, m.MIN_OFFER(), 1e22));
        n = uint8(bound(n, 1, 10));
        uint256 total = uint256(price) * n;
        _fund(carol, total);
        uint256 id = _offer(carol, 2, 7, price, n);
        uint256 before = alice.balance;
        vm.prank(alice);
        m.acceptOffer(id, 0, n, price);
        assertEq(alice.balance - before + treasury.balance, total);
        assertEq(weth.balanceOf(carol), 0);
        assertEq(address(m).balance + weth.balanceOf(address(m)), 0);
    }
}
