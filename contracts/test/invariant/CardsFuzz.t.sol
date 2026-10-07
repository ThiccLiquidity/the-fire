// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FireSale} from "../../src/cards/FireSale.sol";
import {FireCredits} from "../../src/cards/FireCredits.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {MockERC20, MockUSDG, MockMill, MockFeed, MockRandomness, MockBurner} from "../Mocks.sol";
import {InvRouter} from "./InvRouter.sol";
import {SeriesHelper, RecipeHarness} from "../cards/SeriesHelper.sol";

/// @dev Stateless fuzz tests: pricing math, the burn split, PDA grades and price, and the Standard pool math.
contract CardsFuzzTest is SeriesHelper {
    function _na() internal pure returns (FireSale.Access memory a) {
        a.proof = new bytes32[](0);
    }

    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11CE0);
    address revenue = address(0xBEEF);
    address burnW = address(0xB0B);
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
        router = new InvRouter(plank, 3_333e9, 1e21);
        rng = new MockRandomness();
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        rng.setFire(address(cards));
        credits = new FireCredits(owner, address(cards), 1e18);
        sale = new FireSale(FireSale.Config({
            owner: owner, paper: address(paper), plank: address(plank), usdg: address(usdg), weth: address(0xE7),
            press: address(press), packs: address(packs), cards: address(cards), ethUsd: address(ethFeed),
            plankUsd: address(plankFeed), paperUsd: address(0), router: address(router), revenueWallet: revenue, plankBurner: burnW, credits: address(credits)
        }));
        psa = new FirePsa(owner, address(cards), address(new MockBurner(address(plank), address(0))));
        vm.startPrank(owner, owner);
        packs.setSeller(address(sale));
        packs.setCards(address(cards));
        cards.setSeller(address(sale));
        credits.setSale(address(sale));
        cards.setRandomness(address(rng));
        cards.setPsa(address(psa));
        vm.stopPrank();
        _standard(cards, dealer, owner, 1, 3, 1);
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
        sale.configureDrop(1, FireSale.DropConfig({start: start, packs: 1_000, starters: 0, plankOnly: 0, walletLimit: 1_000,
            starterWindow: 0, liftAfter: 1 hours, plankBurnBps: bps, priceUsd: price, paperPerPack: 1e18, paperCapUsd: 1e8, holderWindow: 0, holderRoot: bytes32(0), maxPerTx: 0, plankOnlyFor: 1 hours, regularWalletsFor: 1 hours, starterPerPress: 1, starterWalletLimit: 1, starterPriceUsd: 0, starterPaper: 1e18, creditsPerPick: 1, creditPacksMax: 0, creditPacksPerWallet: 0}));
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

        uint256 e = sale.quoteEth(1, n);
        assertGe(e * ethPx, usd8 * 1e18, "ETH quote covers the price");
        assertLt((e - 1) * ethPx, usd8 * 1e18, "ETH quote is the least that does (rounded up, not more)");

        uint256 p = sale.quotePlank(1, n);
        assertGe(p * plankPx, usd8 * 1e28, "PLANK quote covers the price");
        if (p > 0) assertLt((p - 1) * plankPx, usd8 * 1e28, "PLANK quote is the least that does");

        uint256 u = sale.quoteUsdg(1, n);
        assertGe(u * 1e8, usd8 * 1e6, "USDG quote covers the price");
        assertLt((u - 1) * 1e8, usd8 * 1e6, "USDG quote is the least that does");
        assertEq(sale.quoteUsdg(1, n), (usd8 + 99) / 100, "USDG: 6 decimals, rounded up");
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
            cost = sale.quotePlank(1, n);
            uint256 bal = plank.balanceOf(alice);
            vm.prank(alice, alice);
            sale.buyWithPlank(1, n, cost, type(uint256).max, _na());
            assertEq(bal - plank.balanceOf(alice), cost, "paid");
            assertEq(plank.balanceOf(DEAD), cost * bps / 10_000, "burn share burned");
            assertEq(plank.balanceOf(revenue) + plank.balanceOf(DEAD), cost, "revenue + burn == cost");
        } else if (pay == 1) {
            cost = sale.quoteEth(1, n);
            uint256 bal = alice.balance;
            vm.prank(alice, alice);
            sale.buyWithEth{value: cost + 12345}(1, n, type(uint256).max, _na());
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
            cost = sale.quoteUsdg(1, n);
            uint256 bal = usdg.balanceOf(alice);
            vm.prank(alice, alice);
            sale.buyWithUsdg(1, n, cost, type(uint256).max, _na());
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
    function testFuzz_gradeForAlways1to10(uint256 word, uint256 fire, uint256 age, uint256 moves) public view {
        age = bound(age, 0, 200 * 365 days);
        uint256 g = psa.gradeFor(fire, age, moves, word);
        assertGe(g, 1);
        assertLe(g, 10);
        // a fresh card (under a month uncased) never grades below 5, however much it moved
        if (age <= 31 days) assertGe(g, 5);
    }

    /// Custom fresh odds (any weights on 5..10, zeros allowed) only give grades with odds > 0 on a fresh card.
    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_gradeForCustomOdds(uint256 seed, uint256 word) public {
        uint64[10] memory odds;
        uint256 left = 10_000;
        for (uint256 g = 4; g < 9; g++) {
            uint256 o = uint256(keccak256(abi.encode(seed, g))) % (left + 1);
            odds[g] = uint64(o);
            left -= o;
        }
        odds[9] = uint64(left);
        vm.prank(owner, owner);
        psa.setOdds(7, odds);
        uint256 grade = psa.gradeFor(7, 0, 0, word);
        assertGe(grade, 5);
        assertLe(grade, 10);
        assertGt(odds[grade - 1], 0, "a grade with no odds never comes up");
    }

    /// The odds always add up to one, and wear only ever lowers the average grade.
    /// forge-config: default.fuzz.runs = 300
    function testFuzz_wearOnlyLowersTheAverage(uint256 age, uint256 later, uint256 moves) public view {
        age = bound(age, 0, 60 * 365 days);
        later = bound(later, age, 61 * 365 days);
        moves = bound(moves, 0, 12);
        uint256[10] memory a = psa.oddsFor(1, age, moves);
        uint256[10] memory b = psa.oddsFor(1, later, moves);
        uint256[10] memory c = psa.oddsFor(1, age, moves + 1);
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

    function test_freshOddsHitEveryGrade5To10FromHashedWords() public view {
        bool[11] memory seen;
        for (uint256 i; i < 2_000; i++) seen[psa.gradeFor(1, 0, 0, uint256(keccak256(abi.encode(word0, i))))] = true;
        for (uint256 g = 5; g <= 10; g++) assertTrue(seen[g], vm.toString(g));
        for (uint256 g; g < 5; g++) assertFalse(seen[g]);
    }

    uint256 constant word0 = 0xF1E;

    // ---------------------------------------------------------------- pool math (the Standard recipe)

    function _pool(uint256 n, uint256 d) internal view returns (uint256[5] memory c) {
        uint256[] memory got = harness.pool(harness.compile(StandardRecipe.classic(d)), n);
        for (uint256 m; m < 5; m++) c[m] = got[m];
    }

    function _checkPool(uint256 n, uint256 d, uint256[5] memory c) internal pure {
        assertEq(c[0] + c[1] + c[2] + c[3] + c[4], 6 * n, "counts sum to 6 x packs");
        assertEq(c[0], 3 * n, "Paper == 3 x packs");
        assertGe(c[1], n, "Wood >= packs");
        uint256 bp = c[2] + c[3] + c[4];
        assertGe(bp, n, "Fire-or-better >= packs");
        assertLe(bp, 2 * n, "Fire-or-better <= 2 x packs");
        if (n == 0) {
            assertEq(c[4], 0, "no packs, no Diamond");
        } else {
            assertGe(c[4], 1, "at least one Diamond");
            assertEq(c[4], (d == 0 ? 1 : d) < n ? (d == 0 ? 1 : d) : n, "Diamond == min(setting, packs)");
        }
        // Fire and Coal are their rounded shares unless the pack floor had to move cards
        uint256 fire = (15_000 * 6 * n + 50_000) / 100_000;
        uint256 charcoal = (4_900 * 6 * n + 50_000) / 100_000;
        uint256 raw = fire + charcoal + c[4];
        if (raw >= n && raw <= 2 * n) {
            assertEq(c[2], fire, "Fire share");
            assertEq(c[3], charcoal, "Coal share");
        } else if (raw > 2 * n) {
            assertEq(bp, 2 * n, "over the floor: trimmed to 2 x packs");
            assertLe(c[2], fire);
            assertLe(c[3], charcoal);
            if (c[3] < charcoal) assertEq(c[2], 0, "Coal only trimmed once Fire is gone");
        } else {
            assertEq(bp, n, "under the floor: topped up to packs");
            assertEq(c[3], charcoal);
        }
    }

    /// The rule's invariants over any pack count and any Diamond setting up to the pack count (and beyond: capped).
    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_computePool(uint256 n, uint256 d) public view {
        n = bound(n, 0, type(uint64).max);
        d = n == 0 ? bound(d, 1, 1000) : bound(d, 1, n + 1000);
        _checkPool(n, d, _pool(n, d));
    }

    /// Small Series, where the floor and the Diamond cap bite.
    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_computePoolSmall(uint256 n, uint256 d) public view {
        n = bound(n, 0, 60);
        d = bound(d, 1, 1000);
        _checkPool(n, d, _pool(n, d));
    }

    /// Each Series stands alone: the same inputs always give the same pool, and more Diamonds only take from Wood
    /// (or, at tiny sizes, from Fire/Coal through the floor), never change Paper.
    /// forge-config: default.fuzz.runs = 500
    function testFuzz_computePoolMoreDiamonds(uint256 n, uint256 d) public view {
        n = bound(n, 1, 100_000);
        d = bound(d, 1, 999);
        uint256[5] memory a = _pool(n, d);
        uint256[5] memory b = _pool(n, d + 1);
        assertEq(a[0], b[0]);
        assertGe(b[4], a[4]);
        assertLe(b[1], a[1]);
        assertEq(a[1] + a[2] + a[3] + a[4], b[1] + b[2] + b[3] + b[4]);
    }

    /// No product ceiling on Series size: the pool works out for 2^64 - 1 packs.
    function test_computePoolHugeSeries() public view {
        uint256 n = type(uint64).max;
        _checkPool(n, 1, _pool(n, 1));
    }
}
