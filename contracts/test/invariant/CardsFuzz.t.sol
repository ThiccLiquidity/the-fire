// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FireSale} from "../../src/cards/FireSale.sol";
import {FireCredits} from "../../src/cards/FireCredits.sol";
import {FireGroups} from "../../src/cards/FireGroups.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {MockERC20, MockUSDG, MockMill, MockFeed, MockRandomness, MockBurner} from "../Mocks.sol";
import {InvRouter} from "./InvRouter.sol";
import {SeriesHelper, RecipeHarness} from "../cards/SeriesHelper.sol";

/// @dev Stateless fuzz tests: pricing math, the burn split, PDA grades and price, and the Standard pool math.
contract CardsFuzzTest is SeriesHelper {
    function _na() internal pure returns (FireGroups.Access memory a) {}

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11CE0);
    address revenue = address(0xBEEF);
    address burnW = address(0xB0B);
    address paperW = address(0xBA9E5);
    address alice = address(0xA1);

    MockERC20 paper;
    MockERC20 plank;
    MockUSDG usdg;
    MockMill press;
    MockFeed ethFeed;
    MockFeed plankFeed;
    MockFeed paperFeed;
    InvRouter router;
    MockRandomness rng;
    FirePacks packs;
    FireCards cards;
    FireSale sale;
    FireCredits credits;
    FirePsa psa;
    RecipeDealer dealer;
    RecipeHarness harness;

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new MockERC20("PAPER", "PAPER");
        plank = new MockERC20("PLANK", "PLANK");
        usdg = new MockUSDG();
        press = new MockMill(address(plank), 0);
        ethFeed = new MockFeed(3_333e8);
        plankFeed = new MockFeed(1e9);
        paperFeed = new MockFeed(0.05e18);
        plankFeed.setDecimals(18);
        paperFeed.setDecimals(18);
        router = new InvRouter(plank, 3_333e9, 1e21);
        rng = new MockRandomness();
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        rng.setFire(address(cards));
        credits = new FireCredits(owner, address(cards), 1e18);
        FireGroups groups = new FireGroups();
        sale = new FireSale(FireSale.Config({
            owner: owner, paper: address(paper), plank: address(plank), usdg: address(usdg), weth: address(0xE7),
            packs: address(packs), cards: address(cards), ethUsd: address(ethFeed),
            plankUsd: address(plankFeed), paperUsd: address(0), router: address(router), revenueWallet: revenue, plankBurner: burnW, paperBurner: paperW, credits: address(credits),
            groups: address(groups)
        }));
        groups.setSale(address(sale));
        psa = new FirePsa(owner, address(cards), address(new MockBurner(address(plank), address(0))));
        vm.startPrank(owner, owner);
        packs.setSeller(address(sale));
        packs.setCards(address(cards));
        cards.setSeller(address(sale));
        credits.setSale(address(sale));
        cards.setRandomness(address(rng));
        cards.setPsa(address(psa));
        vm.stopPrank();
        _standard(cards, dealer, owner, 1, 3);
        harness = new RecipeHarness(address(cards));

        paper.mint(alice, 1e30);
        plank.mint(alice, type(uint128).max);
        usdg.mint(alice, type(uint128).max);
        vm.deal(alice, type(uint128).max);
        vm.startPrank(alice, alice);
        paper.approve(address(sale), type(uint256).max);
        plank.approve(address(sale), type(uint256).max);
        usdg.approve(address(sale), type(uint256).max);
        vm.stopPrank();
    }

    function _drop(uint128 price, uint16 bps) internal returns (uint64 start) {
        start = uint64(block.timestamp + 1);
        vm.prank(owner, owner);
        FireSale.DropConfig memory c;
        c.start = start;
        c.packs = 1_000;
        c.paperCapUsd = 1e8;
        c.regularWalletsFor = 1 hours;
        c.creditsPerPick = 1;
        c.groups = new FireGroups.Group[](1);
        c.groups[0] = FireGroups.Group({packs: 1_000, gate: FireGroups.Gate.OPEN, coins: 7, afterGroup: 255, rollTo: 255,
            startDelay: 0, duration: 0, perWallet: 1_000, limitFor: 0, perNft: 0, taxBps: 0, plankBurnBps: bps, paperBurnBps: 0, priceUsd: price, paper: 1e18, nft: address(0), idle: 0, perTx: 0, unlimited: false, root: 0});
        sale.configureDrop(1, c);
    }

    function _q(uint256 n, FireSale.Pay pay) internal view returns (uint256 cost) {
        (cost,) = sale.quote(1, 0, n, pay);
    }

    function _setFeeds(int256 ethPx, int256 plankPx) internal {
        ethFeed.set(ethPx);
        plankFeed.set(plankPx);
    }

    // ---------------------------------------------------------------- pricing

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_quotesRoundUpAndNeverUnderTheDollarPrice(uint256 price, uint256 n, uint256 ethPx, uint256 plankPx) public {
        price = bound(price, 1, 1e14); // $0.00000001 .. $1M a pack
        n = bound(n, 1, 50);
        ethPx = bound(ethPx, 1, 1e16); // ETH $0.00000001 .. $100M (8 decimals)
        plankPx = bound(plankPx, 1, 1e36); // PLANK 1e-18 .. 1e18 USD (18 decimals)
        _drop(uint128(price), 3_000);
        _setFeeds(int256(ethPx), int256(plankPx));
        uint256 usd8 = n * price;

        uint256 e = _q(n, FireSale.Pay.ETH);
        assertGe(e * ethPx, usd8 * 1e18, "ETH quote covers the price");
        assertLt((e - 1) * ethPx, usd8 * 1e18, "ETH quote is the least that does (rounded up, not more)");

        uint256 p = _q(n, FireSale.Pay.PLANK);
        assertGe(p * plankPx, usd8 * 1e28, "PLANK quote covers the price");
        if (p > 0) assertLt((p - 1) * plankPx, usd8 * 1e28, "PLANK quote is the least that does");

        uint256 u = _q(n, FireSale.Pay.USDG);
        assertGe(u * 1e8, usd8 * 1e6, "USDG quote covers the price");
        assertLt((u - 1) * 1e8, usd8 * 1e6, "USDG quote is the least that does");
        assertEq(_q(n, FireSale.Pay.USDG), (usd8 + 99) / 100, "USDG: 6 decimals, rounded up");
    }

    // ---------------------------------------------------------------- the burn split

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_burnShareAndRevenueSumToTheCost(uint256 price, uint256 n, uint256 bps, uint8 pay, bool routerFails, bool pumped)
        public
    {
        price = bound(price, 1, 1e10); // up to $100 a pack
        n = bound(n, 1, 50);
        bps = bound(bps, 0, 10_000);
        uint64 start = _drop(uint128(price), uint16(bps));
        vm.warp(start);
        _setFeeds(3_333e8, 1e9);
        router.setFail(routerFails);
        if (pumped) router.setRates(3_333e9 * 85 / 100, 1e21 * 85 / 100);
        pay = pay % 3;
        uint256 cost;
        if (pay == 0) {
            cost = _q(n, FireSale.Pay.PLANK);
            uint256 bal = plank.balanceOf(alice);
            vm.prank(alice, alice);
            sale.buy(1, 0, n, FireSale.Pay.PLANK, cost, type(uint256).max, _na());
            assertEq(bal - plank.balanceOf(alice), cost, "paid");
            assertEq(plank.balanceOf(DEAD), cost * bps / 10_000, "burn share burned");
            assertEq(plank.balanceOf(revenue) + plank.balanceOf(DEAD), cost, "revenue + burn == cost");
        } else if (pay == 1) {
            cost = _q(n, FireSale.Pay.ETH);
            uint256 bal = alice.balance;
            vm.prank(alice, alice);
            sale.buy{value: cost + 12345}(1, 0, n, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
            assertEq(bal - alice.balance, cost, "paid (excess refunded)");
            uint256 share = cost * bps / 10_000;
            assertEq(burnW.balance + address(router).balance, share, "burn share: swapped or to the burn wallet");
            assertEq(revenue.balance + burnW.balance + address(router).balance, cost, "revenue + burn == cost");
            bool swapped = address(router).balance > 0;
            if (routerFails) assertFalse(swapped, "no swap when the router fails");
            // The 90% floor is worked out from the USD burn share truncated to 8 decimals, so at dust sizes (a share
            // under $0.00001) the truncation alone can exceed the 15% pump. Only check the pump guard above that.
            if (pumped && n * price * bps / 10_000 >= 1_000) assertFalse(swapped, "no swap when the pool is pumped");
            if (swapped) assertEq(plank.balanceOf(DEAD), share * router.plankPerEthWei(), "swap output burned");
        } else {
            cost = _q(n, FireSale.Pay.USDG);
            uint256 bal = usdg.balanceOf(alice);
            vm.prank(alice, alice);
            sale.buy(1, 0, n, FireSale.Pay.USDG, cost, type(uint256).max, _na());
            assertEq(bal - usdg.balanceOf(alice), cost, "paid");
            uint256 share = cost * bps / 10_000;
            assertEq(usdg.balanceOf(burnW) + usdg.balanceOf(address(router)), share, "burn share");
            assertEq(usdg.balanceOf(revenue) + usdg.balanceOf(burnW) + usdg.balanceOf(address(router)), cost, "revenue + burn == cost");
        }
        assertEq(address(sale).balance + usdg.balanceOf(address(sale)) + plank.balanceOf(address(sale)) + paper.balanceOf(address(sale)), 0, "holds nothing");
        assertEq(usdg.allowance(address(sale), address(router)), 0, "no allowance left");
        assertEq(paper.balanceOf(DEAD), n * 1e18, "1 PAPER per pack burned");
    }

    // ---------------------------------------------------------------- PDA

    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_gradeForAlways1to10(uint256 word, uint256 age, uint256 moves) public view {
        age = bound(age, 0, 200 * 365 days);
        uint256 g = psa.gradeFor(age, moves, word);
        assertGe(g, 1);
        assertLe(g, 10);
        // a fresh card (under a month uncased) never grades below 5, however much it moved
        if (age <= 31 days) assertGe(g, 5);
    }

    /// The odds always add up to one, and wear only ever lowers the average grade.
    /// forge-config: default.fuzz.runs = 300
    function testFuzz_wearOnlyLowersTheAverage(uint256 age, uint256 later, uint256 moves) public view {
        age = bound(age, 0, 60 * 365 days);
        later = bound(later, age, 61 * 365 days);
        moves = bound(moves, 0, 12);
        uint256[10] memory a = psa.oddsFor(age, moves);
        uint256[10] memory b = psa.oddsFor(later, moves);
        uint256[10] memory c = psa.oddsFor(age, moves + 1);
        uint256 ta; uint256 tb; uint256 ma; uint256 mb; uint256 mc;
        for (uint256 g; g < 10; g++) {
            ta += a[g]; tb += b[g];
            ma += (g + 1) * a[g]; mb += (g + 1) * b[g]; mc += (g + 1) * c[g];
        }
        assertApproxEqAbs(ta, 1e18, 1e6);
        assertApproxEqAbs(tb, 1e18, 1e6);
        assertLe(mb, ma + 1e8, "older is never better");
        assertLe(mc, ma + 1e8, "a move is never better");
    }

    function test_freshOddsHitEveryGrade7To10FromHashedWords() public view {
        bool[11] memory seen;
        for (uint256 i; i < 2_000; i++) seen[psa.gradeFor(0, 0, uint256(keccak256(abi.encode(word0, i))))] = true;
        for (uint256 g = 7; g <= 10; g++) assertTrue(seen[g], vm.toString(g));
        for (uint256 g; g < 7; g++) assertFalse(seen[g]);
    }

    uint256 constant word0 = 0xF1E;

    // ---------------------------------------------------------------- dealing (the Standard recipe)

    /// Any seed, any split: Standard cards are one of its six types and three characters, Gold and Full Art full holo,
    /// and a pack dealt in two pieces is the same pack.
    function testFuzz_standardDealAnySeed(uint256 seed, uint256 k) public view {
        uint256[] memory got = dealer.deal(1, seed, 0, 6);
        for (uint256 i; i < 6; i++) {
            uint256 t = uint32(got[i]);
            assertLt(t, 6);
            assertLt(uint32(got[i] >> 32), 3);
            if (t >= 4) assertEq((got[i] >> 64) & 3, 3, "Gold and Full Art: full holo");
        }
        k = bound(k, 1, 5);
        uint256[] memory a = dealer.deal(1, seed, 0, k);
        uint256[] memory b = dealer.deal(1, seed, k, 6 - k);
        for (uint256 i; i < k; i++) assertEq(a[i], got[i]);
        for (uint256 i; i < 6 - k; i++) assertEq(b[i], got[k + i]);
    }
}
