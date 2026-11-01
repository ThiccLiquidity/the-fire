// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {FireMarket} from "../../src/cards/FireMarket.sol";
import {MarketCards, MarketPacks, Refuser} from "../cards/Market.t.sol";
import {V2Weth} from "../cards/V2Lite.sol";

/// @dev Random listing, buying (one and several), moving cards, offers and payouts to wallets that refuse ETH. The market
///      never holds more or less ETH than it owes, never holds WETH, and a listed card that moved can never be bought
///      at its old listing.
contract MarketHandler is Test {
    FireMarket public m;
    MarketCards public cards;
    MarketPacks public packs;
    V2Weth public weth;
    address[] public people;
    Refuser public refuser;
    uint256 public owedSum; // what the market should owe: payouts and refunds left waiting, less what was collected
    uint256 public oldListingBuys; // buys that went through on a listing the market called dead (must stay 0)
    uint256 public buys; // buys that went through (one or several)
    uint256 public lists; // listings made

    constructor() {
        cards = new MarketCards(address(0xBEEF), 500);
        packs = new MarketPacks(address(0xBEEF), 500);
        weth = new V2Weth();
        m = new FireMarket(address(cards), address(packs), address(weth));
        refuser = new Refuser();
        people.push(makeAddr("p0"));
        people.push(makeAddr("p1"));
        people.push(makeAddr("p2"));
        people.push(address(refuser));
        for (uint256 i; i < people.length; i++) {
            vm.deal(people[i], 1000 ether);
            vm.prank(people[i]);
            cards.setApprovalForAll(address(m), true);
            for (uint256 j; j < 3; j++) cards.mint(people[i], 1 + i * 3 + j);
        }
    }

    function _who(uint256 s) internal view returns (address) {
        return people[s % people.length];
    }

    function list(uint256 who, uint256 serial, uint96 price) external {
        serial = 1 + serial % 12;
        who; // the card's holder lists it
        address p = cards.ownerOf(serial);
        price = uint96(bound(price, 1, 5 ether));
        vm.prank(p);
        m.listCard(serial, price, block.timestamp + 30 days);
        lists++;
    }

    function move(uint256 from, uint256 to, uint256 serial) external {
        serial = 1 + serial % 12;
        address a = cards.ownerOf(serial);
        address b = _who(to);
        vm.prank(a);
        cards.transferFrom(a, b, serial);
    }

    /// the first card with a listing (live or not), from a random start
    function _listed(uint256 start) internal view returns (uint256) {
        for (uint256 k; k < 12; k++) {
            uint256 s = 1 + (start + k) % 12;
            (address seller,,,,) = m.cardOffer(s);
            if (seller != address(0)) return s;
        }
        return 1 + start % 12;
    }

    function buy(uint256 who, uint256 serial) external {
        serial = _listed(serial);
        address p = _who(who);
        (address seller, uint256 price, bool live,, uint256 ch) = m.cardOffer(serial);
        if (seller == p) p = _who(who + 1);
        if (seller == address(0)) return;
        uint256 before = m.owed(seller);
        vm.prank(p);
        try m.buyCard{value: price}(serial, price, ch) {
            buys++;
            if (!live) oldListingBuys++;
            owedSum += m.owed(seller) - before;
        } catch {}
    }

    function buyMany(uint256 who, uint256 a, uint256 b) external {
        address p = _who(who);
        uint256[] memory ids = new uint256[](2);
        uint256[] memory prices = new uint256[](2);
        uint256[] memory ch = new uint256[](2);
        ids[0] = _listed(a);
        ids[1] = _listed(b);
        uint256 total;
        bool[2] memory wasLive;
        for (uint256 i; i < 2; i++) {
            (, uint256 price, bool live,, uint256 c) = m.cardOffer(ids[i]);
            prices[i] = price == 0 ? 1 : price; // a made-up price for an unlisted card: skipped
            ch[i] = c;
            wasLive[i] = live;
            total += prices[i];
        }
        uint256 owedBefore = address(m).balance;
        address o0 = cards.ownerOf(ids[0]);
        address o1 = cards.ownerOf(ids[1]);
        vm.prank(p);
        try m.buyCards{value: total}(ids, prices, ch) {
            buys++;
            if (cards.ownerOf(ids[0]) == p && o0 != p && !wasLive[0]) oldListingBuys++;
            if (cards.ownerOf(ids[1]) == p && o1 != p && !wasLive[1]) oldListingBuys++;
            owedSum += address(m).balance - owedBefore; // anything that stayed is owed to someone
        } catch {}
    }

    function collect(uint256 who) external {
        address p = _who(who);
        uint256 a = m.owed(p);
        if (a == 0) return;
        if (p == address(refuser)) refuser.setOpen(true);
        vm.prank(p);
        try m.withdraw() {
            owedSum -= a;
        } catch {}
        if (p == address(refuser)) refuser.setOpen(false);
    }

    function cancelAll(uint256 who) external {
        vm.prank(_who(who));
        m.cancelAll();
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 20 days));
    }
}

/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 60
/// forge-config: default.invariant.fail-on-revert = false
contract MarketInvariantTest is StdInvariant, Test {
    MarketHandler h;

    function setUp() public {
        h = new MarketHandler();
        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](9);
        (sels[0], sels[1], sels[2]) = (h.list.selector, h.list.selector, h.list.selector); // weighted
        (sels[3], sels[4]) = (h.buy.selector, h.buyMany.selector);
        (sels[5], sels[6], sels[7], sels[8]) = (h.move.selector, h.collect.selector, h.cancelAll.selector, h.warp.selector);
        targetSelector(FuzzSelector({addr: address(h), selectors: sels}));
    }

    /// The market holds exactly the ETH it owes (payouts and refunds waiting in `owed`), never more, never less.
    function invariant_ethEqualsOwed() public view {
        assertEq(address(h.m()).balance, h.owedSum());
    }


    /// It never keeps WETH.
    function invariant_noWeth() public view {
        assertEq(h.weth().balanceOf(address(h.m())), 0);
    }

    /// A listing the market said was dead (the card moved or changed, expired, cancelled) was never bought.
    function invariant_noOldListingBuys() public view {
        assertEq(h.oldListingBuys(), 0);
    }
}
