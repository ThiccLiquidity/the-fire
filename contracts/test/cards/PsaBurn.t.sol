// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {PaperBurner} from "../../src/cards/PaperBurner.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {CardsRenderer} from "../../src/cards/CardsRenderer.sol";
import {MockERC20, MockUSDG, MockRandomness, MockFeed, MockPlankTwap, MockPair} from "../Mocks.sol";
import {SeriesHelper} from "./SeriesHelper.sol";
import {PoolRouter} from "./Burner.t.sol";

/// @dev FirePsa against the real PaperBurner: a fee burns only itself (the backlog can't be sandwiched through
///      `protect`), PAPER payments at the burner's PAPER feed, and gas for the biggest batches (docs/grading.md).
contract PsaBurnTest is SeriesHelper {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11CE0);
    address seller = address(0x5E11);
    address alice = address(0xA1);
    address keeper = address(0xEE);

    MockERC20 paper;
    MockERC20 plank;
    MockUSDG usdg;
    MockERC20 weth;
    PoolRouter router;
    MockFeed ethUsd;
    MockPlankTwap plankUsd;
    MockFeed paperUsd;
    PaperBurner burner;
    MockRandomness cardRng;
    MockRandomness psaRng;
    FirePacks packs;
    FireCards cards;
    RecipeDealer dealer;
    FirePsa psa;

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new MockERC20("PAPER", "PAPER");
        plank = new MockERC20("PLANK", "PLANK");
        usdg = new MockUSDG();
        weth = new MockERC20("WETH", "WETH");
        router = new PoolRouter(address(weth));
        ethUsd = new MockFeed(2_500e8);
        plankUsd = new MockPlankTwap(1e9, address(new MockPair(address(weth), address(plank))));
        paperUsd = new MockFeed(0.08e18);
        paperUsd.setDecimals(18);
        burner = new PaperBurner(owner, address(paper), address(plank), address(usdg), 6, address(weth), address(router));
        cardRng = new MockRandomness();
        psaRng = new MockRandomness();
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        cardRng.setFire(address(cards));
        psa = new FirePsa(owner, address(cards), address(burner));
        psaRng.setFire(address(psa));
        vm.startPrank(owner);
        burner.setFeeds(address(ethUsd), address(plankUsd), address(paperUsd));
        address[][] memory r = new address[][](1);
        r[0] = new address[](2);
        r[0][0] = address(weth);
        r[0][1] = address(paper);
        burner.setRoutes(PaperBurner.Pay.ETH, r);
        burner.setFlusher(address(psa), true);
        burner.setFlusher(keeper, true);
        packs.setSeller(seller);
        packs.setCards(address(cards));
        cards.setSeller(seller);
        cards.setRandomness(address(cardRng));
        cards.setPsa(address(psa));
        cards.setRenderer(address(new CardsRenderer(address(cards))));
        psa.setRandomness(address(psaRng));
        vm.stopPrank();
        _standard(cards, dealer, owner, 1, 2, 1);
        vm.startPrank(seller);
        packs.mint(alice, 1, 20);
        cards.closeFire(1);
        vm.stopPrank();
        vm.prank(alice);
        cards.open(1, 20);
        cardRng.fulfill(cardRng.last(), 7);
        cards.process(1, 1000);
        vm.deal(alice, 1_000 ether);
        // PAPER $0.08, ETH $2,500: a $250k-a-side WETH/PAPER pool, spot = the feed
        router.setPool(address(weth), address(paper), 100e18, 3_125_000e18);
    }

    function _one(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function _none() internal pure returns (uint256[] memory) {
        return new uint256[](0);
    }

    function _first(uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; i++) ids[i] = i + 1;
    }

    /// Buy `x` ETH of PAPER, case one card (fee in ETH), sell the PAPER back. Returns the net and what's left.
    function _attack(uint256 x, uint256 backlog) internal returns (int256 profit, uint256 left, uint256 burned) {
        vm.deal(address(burner), backlog);
        address[] memory buy = new address[](2);
        buy[0] = address(weth);
        buy[1] = address(paper);
        uint256 got;
        if (x > 0) {
            vm.prank(alice);
            got = router.swapExactETHForTokens{value: x}(0, buy, alice, block.timestamp)[1];
        }
        uint256 cost = psa.quote(1, 0, FirePsa.Pay.ETH);
        vm.prank(alice);
        psa.protect{value: cost}(_one(1), _none(), FirePsa.Pay.ETH, cost);
        left = address(burner).balance;
        burned = paper.balanceOf(DEAD);
        uint256 back;
        if (got > 0) {
            address[] memory sell = new address[](2);
            sell[0] = address(paper);
            sell[1] = address(weth);
            vm.startPrank(alice);
            paper.approve(address(router), type(uint256).max);
            back = router.swapExactTokensForTokens(got, 0, sell, alice, block.timestamp)[1];
            vm.stopPrank();
        }
        profit = int256(back) - int256(x + cost);
    }

    /// Regression (audit 2026-10, medium): `protect` used to flush the burner's whole balance, so anyone could wrap
    /// a $0.05 case in a buy and a sell and burn the backlog (sale PAPER shares waiting for the keeper) at a price
    /// they had pushed up. Now it burns only its own fee: no front-run size makes a profit, and the backlog stays
    /// for the keeper, whose flush still burns it.
    function test_protectCantBeUsedToSandwichTheBacklog() public {
        uint256 backlog = 2 ether; // $5,000 of sale PAPER shares waiting for the keeper
        uint256 snap = vm.snapshotState();
        (int256 p0, uint256 left0, uint256 b0) = _attack(0, backlog);
        assertLt(p0, 0, "a case costs its fee");
        assertEq(left0, backlog, "only the fee was burned");
        assertGt(b0, 0, "the fee was burned");
        vm.revertToState(snap);
        for (uint256 x = 0.1 ether; x <= 4 ether; x += 0.1 ether) {
            uint256 s2 = vm.snapshotState();
            (int256 p, uint256 left,) = _attack(x, backlog);
            assertLe(p, 0, "no profit");
            assertGe(left, backlog, "the backlog is never spent inside protect");
            vm.revertToState(s2);
        }
        // the keeper's own flush burns the backlog as before
        vm.deal(address(burner), backlog);
        vm.prank(keeper);
        uint256 out = burner.flush(PaperBurner.Pay.ETH);
        assertGt(out, 0);
        assertLt(address(burner).balance, backlog);
    }

    /// PAPER payments against the real burner's feed: $1 at $0.08 = 12.5 PAPER burned to DEAD; a stale feed: refused.
    function test_paperPaymentAtTheFeedPrice() public {
        paper.mint(alice, 1_000e18);
        uint256 c = psa.quote(0, 1, FirePsa.Pay.PAPER);
        assertEq(c, 12.5e18);
        vm.startPrank(alice);
        paper.approve(address(psa), type(uint256).max);
        psa.protect(_none(), _one(2), FirePsa.Pay.PAPER, c);
        vm.stopPrank();
        assertEq(paper.balanceOf(DEAD), c);
        assertEq(paper.balanceOf(address(burner)), 0);
        vm.warp(block.timestamp + 2 days + 1); // the PAPER feed goes stale
        ethUsd.set(2_500e8);
        vm.expectRevert(FirePsa.FeedUnavailable.selector);
        psa.quote(1, 0, FirePsa.Pay.PAPER);
        vm.prank(alice);
        vm.expectRevert(FirePsa.FeedUnavailable.selector);
        psa.protect(_one(3), _none(), FirePsa.Pay.PAPER, type(uint256).max);
        // ETH still works (its fee waits in the burner while PAPER's price is missing)
        uint256 ce = psa.quote(1, 0, FirePsa.Pay.ETH);
        vm.prank(alice);
        psa.protect{value: ce}(_one(3), _none(), FirePsa.Pay.ETH, ce);
        assertEq(address(burner).balance, ce);
    }

    /// Unnaming FirePsa as a flusher stops case and grading payments in ETH, PLANK and USDG (a pause in effect);
    /// PAPER payments don't touch the burner and still work.
    function test_unflushingPsaStopsCoinPaymentsOnly() public {
        vm.prank(owner);
        burner.setFlusher(address(psa), false);
        uint256 c = psa.quote(1, 0, FirePsa.Pay.ETH);
        vm.prank(alice);
        vm.expectRevert(PaperBurner.NotFlusher.selector);
        psa.protect{value: c}(_one(1), _none(), FirePsa.Pay.ETH, c);
        paper.mint(alice, 10e18);
        uint256 cp = psa.quote(1, 0, FirePsa.Pay.PAPER);
        vm.startPrank(alice);
        paper.approve(address(psa), cp);
        psa.protect(_one(1), _none(), FirePsa.Pay.PAPER, cp);
        vm.stopPrank();
        assertEq(paper.balanceOf(DEAD), cp);
    }

    /// Gas for a 100-card grading, worst wear (3+ years uncased, 10 moves), with a price set per rank.
    function test_gas_finish100Worn() public {
        vm.startPrank(owner);
        psa.setMaxBatch(100);
        psa.setGradePrice(1, 2e18);
        vm.stopPrank();
        uint256[] memory ids = _first(100);
        address bob = address(0xB0B);
        for (uint256 i; i < 100; i++) {
            for (uint256 k; k < 5; k++) {
                vm.prank(alice);
                cards.transferFrom(alice, bob, i + 1);
                vm.prank(bob);
                cards.transferFrom(bob, alice, i + 1);
            }
        }
        vm.warp(block.timestamp + 3 * 365 days + 17 days);
        ethUsd.set(2_500e8);
        paperUsd.set(0.08e18);
        uint256 cost = psa.quoteFor(_none(), ids, FirePsa.Pay.ETH);
        vm.prank(alice);
        uint256 g0 = gasleft();
        uint256 index = psa.protect{value: cost}(_none(), ids, FirePsa.Pay.ETH, cost);
        emit log_named_uint("protect 100 (rank prices) gas", g0 - gasleft());
        psaRng.fulfill(psaRng.last(), 12345);
        g0 = gasleft();
        psa.finish(index, ids);
        uint256 used = g0 - gasleft();
        emit log_named_uint("finish 100 worn gas", used);
        assertLt(used, 20_000_000);
    }

    /// Gas for a 100-card grading of fresh cards.
    function test_gas_finish100Fresh() public {
        vm.prank(owner);
        psa.setMaxBatch(100);
        uint256[] memory ids = _first(100);
        uint256 cost = psa.quote(0, 100, FirePsa.Pay.ETH);
        vm.prank(alice);
        uint256 g0 = gasleft();
        uint256 index = psa.protect{value: cost}(_none(), ids, FirePsa.Pay.ETH, cost);
        emit log_named_uint("protect 100 gas", g0 - gasleft());
        psaRng.fulfill(psaRng.last(), 12345);
        g0 = gasleft();
        psa.finish(index, ids);
        uint256 used = g0 - gasleft();
        emit log_named_uint("finish 100 fresh gas", used);
        assertLt(used, 10_000_000);
    }
}
