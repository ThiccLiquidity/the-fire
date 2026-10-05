// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {MockERC20, MockFeed, MockRandomness} from "../Mocks.sol";
import {SeriesHelper} from "./SeriesHelper.sol";

contract PsaTest is SeriesHelper {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11CE0);
    address seller = address(0x5E11);
    address alice = address(0xA1);
    address bob = address(0xB2);

    MockERC20 paper;
    MockFeed paperFeed;
    MockRandomness cardRng;
    MockRandomness psaRng;
    FirePacks packs;
    FireCards cards;
    RecipeDealer dealer;
    FirePsa psa;
    FirePsa psaNoFeed;

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new MockERC20("PAPER", "PAPER");
        paperFeed = new MockFeed(0.05e18); // PAPER at $0.05
        cardRng = new MockRandomness();
        psaRng = new MockRandomness();
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards));
        cardRng.setFire(address(cards));
        psa = new FirePsa(owner, address(cards), address(paper), address(paperFeed));
        psaRng.setFire(address(psa));
        psaNoFeed = new FirePsa(owner, address(cards), address(paper), address(0));
        vm.startPrank(owner);
        packs.setSeller(seller);
        packs.setCards(address(cards));
        cards.setSeller(seller);
        cards.setRandomness(address(cardRng));
        cards.setPsa(address(psa));
        psa.setRandomness(address(psaRng));
        vm.stopPrank();

        string[] memory names = new string[](2);
        string[] memory cats = new string[](2);
        for (uint256 k; k < cats.length; k++) cats[k] = "Person";
        names[0] = "Ember Fox"; names[1] = "Ash Wolf";
        vm.startPrank(owner);
        dealer.setRecipe(1, StandardRecipe.build(1));
        dealer.setCharacters(1, names, cats);
        cards.setDealer(1, address(dealer));
        cards.setImagesBase(1, "ipfs://x/");
        vm.stopPrank();

        // alice gets 2 packs' worth of cards (serials 1..12)
        vm.startPrank(seller);
        packs.mint(alice, 1, 2);
        cards.closeFire(1);
        vm.stopPrank();
        vm.prank(alice);
        cards.open(1, 2);
        cardRng.fulfill(cardRng.last(), 7);
        cards.process(100);
        assertEq(cards.balanceOf(alice), 12);

        paper.mint(alice, 1_000e18);
        vm.prank(alice);
        paper.approve(address(psa), type(uint256).max);
    }

    function _reveal(uint256 from, uint256 n, uint256 word) internal returns (uint256 index) {
        vm.prank(alice);
        index = psa.reveal(_ids(from, n), type(uint256).max);
        psaRng.fulfill(psaRng.last(), word);
        psa.finish(index);
    }

    function test_revealSetsAGradeAndBurnsPaper() public {
        uint256 before = paper.balanceOf(DEAD);
        _reveal(1, 3, 42);
        assertEq(paper.balanceOf(DEAD) - before, 15e18, "5 PAPER each at $0.05");
        for (uint256 id = 1; id <= 3; id++) {
            FireCards.Card memory c = cards.cardOf(id);
            assertGe(c.grade, 1);
            assertLe(c.grade, 10);
            assertFalse(psa.pending(id));
        }
        FireCards.Card memory c4 = cards.cardOf(4);
        assertEq(c4.grade, 0, "untouched");
    }

    function test_imageSwitchesToTheGradesImage() public {
        assertTrue(_contains(cards.imageFile(1), "-u.webp"));
        _reveal(1, 1, 99);
        uint256 g = cards.cardOf(1).grade;
        assertTrue(_contains(cards.imageFile(1), string.concat("-", vm.toString(g), ".webp")));
        cards.tokenURI(1); // still renders
    }

    function test_priceFollowsPaper() public {
        assertEq(psa.paperPerReveal(), 5e18); // $0.05 -> 5
        paperFeed.set(0.03e18);
        assertEq(psa.paperPerReveal(), 8e18); // $0.03 -> 8 ($0.24)
        paperFeed.set(0.2e18);
        assertEq(psa.paperPerReveal(), 1e18);
        paperFeed.set(0.3e18);
        assertEq(psa.paperPerReveal(), 1e18, "at least 1");
        paperFeed.set(1e18);
        assertEq(psa.paperPerReveal(), 1e18, "1 PAPER up to $1");
        paperFeed.set(4e18);
        assertEq(psa.paperPerReveal(), 0.25e18, "past $1: $1 worth");
        paperFeed.set(3e18);
        assertEq(psa.paperPerReveal(), uint256(1e36) / 3e18, "past $1: $1 worth, rounded down");
        vm.warp(block.timestamp + 3 days);
        assertEq(psa.paperPerReveal(), 5e18, "stale feed: the set number");
        assertEq(psaNoFeed.paperPerReveal(), 5e18, "no market yet: the set number");
        vm.prank(owner);
        psaNoFeed.setFallbackPaper(3);
        assertEq(psaNoFeed.paperPerReveal(), 3e18);
    }

    function test_onlyYourCards_onceEach() public {
        vm.prank(bob);
        vm.expectRevert(FirePsa.NotHolder.selector);
        psa.reveal(_ids(1, 1), type(uint256).max);
        vm.prank(alice);
        psa.reveal(_ids(1, 1), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(FirePsa.Pending.selector);
        psa.reveal(_ids(1, 1), type(uint256).max);
        psaRng.fulfill(psaRng.last(), 5);
        psa.finish(0);
        vm.prank(alice);
        vm.expectRevert(FirePsa.AlreadyGraded.selector);
        psa.reveal(_ids(1, 1), type(uint256).max);
        vm.expectRevert(FirePsa.NotReady.selector);
        psa.finish(0); // can't finish twice
        vm.prank(alice);
        vm.expectRevert(FirePsa.BadAmount.selector);
        psa.reveal(_ids(1, 11), type(uint256).max);
    }

    function test_finishWaitsForRandomness() public {
        vm.prank(alice);
        uint256 i = psa.reveal(_ids(1, 1), type(uint256).max);
        vm.expectRevert(FirePsa.NotReady.selector);
        psa.finish(i);
    }

    function test_onlyPsaSetsGrades() public {
        vm.expectRevert(FireCards.NotPsa.selector);
        cards.setGrade(1, 10);
        vm.startPrank(address(psa));
        cards.setGrade(1, 10);
        vm.expectRevert(FireCards.AlreadyGraded.selector);
        cards.setGrade(1, 9);
        vm.expectRevert(FireCards.BadGrade.selector);
        cards.setGrade(2, 11);
        vm.stopPrank();
        vm.prank(owner);
        vm.expectRevert(FireCards.AlreadySet.selector);
        cards.setPsa(address(0xBAD));
    }

    function test_cardBurnedBeforeFinishIsSkipped() public {
        vm.prank(alice);
        uint256 i = psa.reveal(_ids(1, 2), type(uint256).max);
        vm.prank(seller);
        cards.burnFor(alice, _ids(1, 1));
        psaRng.fulfill(psaRng.last(), 1);
        psa.finish(i);
        assertGt(cards.cardOf(2).grade, 0);
    }

    function test_rerequestWhenStuck() public {
        vm.prank(alice);
        uint256 i = psa.reveal(_ids(1, 1), type(uint256).max);
        vm.expectRevert(FirePsa.NotStuck.selector);
        psa.rerequest(i);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(FirePsa.NotStuck.selector);
        psa.rerequest(i); // an hour isn't enough: a keeper outage must not let the holder re-roll a grade they can see
        vm.warp(block.timestamp + 1 days);
        psa.rerequest(i);
        psaRng.fulfill(psaRng.last(), 3);
        psa.finish(i);
        assertGt(cards.cardOf(1).grade, 0);
    }

    function test_defaultOddsTable() public view {
        (uint64[10] memory o, uint256 total) = psa.oddsOf(1);
        uint64[10] memory want = [uint64(100), 150, 200, 350, 700, 1800, 2500, 2400, 1700, 100];
        uint256 sum;
        for (uint256 i; i < 10; i++) {
            assertEq(o[i], want[i], vm.toString(i + 1));
            sum += o[i];
        }
        assertEq(sum, psa.ODDS_TOTAL());
        assertEq(total, sum);
        assertFalse(psa.customOdds(1));
    }

    /// Each grade's slice of 0..9,999: first and last number of every slice, plus the wrap at 10,000.
    function test_defaultOddsBoundaries() public view {
        // grade:        1    2    3    4    5     6     7     8     9    10
        uint256[11] memory start = [uint256(0), 100, 250, 450, 800, 1500, 3300, 5800, 8200, 9900, 10_000];
        for (uint256 g = 1; g <= 10; g++) {
            assertEq(psa.gradeFor(1, start[g - 1]), g, string.concat("start of ", vm.toString(g)));
            assertEq(psa.gradeFor(1, start[g] - 1), g, string.concat("end of ", vm.toString(g)));
        }
        assertEq(psa.gradeFor(1, 10_000), 1, "wraps");
        assertEq(psa.gradeFor(1, 19_999), 10, "wraps");
        assertEq(psa.gradeFor(1, type(uint256).max), psa.gradeFor(1, type(uint256).max % 10_000));
    }

    function test_defaultOddsCurveFromHashedWords() public view {
        uint256[11] memory n;
        uint256 runs = 40_000;
        for (uint256 i; i < runs; i++) n[psa.gradeFor(1, uint256(keccak256(abi.encode(i))))]++;
        // expected per grade: 1: 1%, 2: 1.5%, 3: 2%, 4: 3.5%, 5: 7%, 6: 18%, 7: 25%, 8: 24%, 9: 17%, 10: 1%
        uint256[11] memory pct = [uint256(0), 100, 150, 200, 350, 700, 1800, 2500, 2400, 1700, 100];
        for (uint256 g = 1; g <= 10; g++) {
            uint256 expected = runs * pct[g] / 10_000;
            // ~3 standard deviations, or 5% for the common grades
            assertApproxEqRel(n[g], expected, pct[g] < 1000 ? 0.16e18 : 0.05e18, vm.toString(g));
        }
        assertGt(n[6] + n[7] + n[8] + n[9], runs * 80 / 100, "most cards land 6-9");
    }

    function test_customOdds_onlyBeforeTheFireCloses() public {
        uint64[10] memory odds = [uint64(1000), 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
        vm.prank(owner);
        vm.expectRevert(FirePsa.FireIsClosed.selector);
        psa.setOdds(1, odds);
        vm.prank(owner);
        psa.setOdds(2, odds);
        (uint64[10] memory o2,) = psa.oddsOf(2);
        (uint64[10] memory o1,) = psa.oddsOf(1);
        assertEq(o2[0], 1000);
        assertEq(o1[0], 100, "default");
        uint64[10] memory zero;
        vm.prank(owner);
        vm.expectRevert(FirePsa.BadOdds.selector);
        psa.setOdds(3, zero);
    }

    /// Any distribution: weights with any total (here only 10s, and a fine-grained one out of 1e18).
    function test_customOdds_anyDistribution() public {
        uint64[10] memory allTens;
        allTens[9] = 1;
        vm.prank(owner);
        psa.setOdds(4, allTens);
        for (uint256 i; i < 50; i++) assertEq(psa.gradeFor(4, uint256(keccak256(abi.encode(i)))), 10);
        uint64[10] memory fine = [uint64(1), 0, 0, 0, 0, 0, 0, 0, 0, 1e18 - 1];
        vm.prank(owner);
        psa.setOdds(5, fine);
        (, uint256 total) = psa.oddsOf(5);
        assertEq(total, 1e18);
        assertEq(psa.gradeFor(5, 0), 1);
        assertEq(psa.gradeFor(5, 1), 10);
        assertEq(psa.gradeFor(5, 1e18), 1, "wraps at the total");
    }


    // ---------- audit fixes ----------

    function test_audit_maxPaper() public {
        vm.prank(alice);
        vm.expectRevert(FirePsa.PriceMoved.selector);
        psa.reveal(_ids(1, 2), 9e18); // 2 cards x 5 PAPER = 10
    }

    function test_audit_cardCantMoveWhileGrading() public {
        vm.prank(alice);
        uint256 i = psa.reveal(_ids(1, 1), type(uint256).max);
        assertTrue(cards.gradePending(1));
        vm.prank(alice);
        vm.expectRevert(FireCards.GradingInProgress.selector);
        cards.transferFrom(alice, bob, 1); // can't dump a card whose public drand number says it grades badly
        psaRng.fulfill(psaRng.last(), 11);
        psa.finish(i);
        assertFalse(cards.gradePending(1));
        vm.prank(alice);
        cards.transferFrom(alice, bob, 1);
        assertEq(cards.ownerOf(1), bob);
    }

    function test_audit_feedGapKeepsTheLastPrice() public {
        paperFeed.set(0.005e18); // PAPER at half a cent: 50 PAPER a card
        _reveal(1, 1, 1);
        assertEq(psa.lastCost(), 50e18);
        vm.warp(block.timestamp + 3 days); // feed gap
        assertEq(psa.paperPerReveal(), 50e18, "not the fallback 5");
    }

    function test_audit_oddsLockOncePacksExist() public {
        _standard(cards, dealer, owner, 2, 1, 1);
        vm.prank(seller);
        packs.mint(bob, 2, 1); // a sealed pack of Fire 2 exists
        uint64[10] memory odds = [uint64(1000), 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
        vm.prank(owner);
        vm.expectRevert(FirePsa.FireIsClosed.selector);
        psa.setOdds(2, odds);
    }


    // ---------- audit round 2 ----------

    function test_audit2_stuckRevealCanBeCancelledAfterAWeek() public {
        vm.prank(alice);
        uint256 i = psa.reveal(_ids(1, 1), type(uint256).max);
        vm.warp(block.timestamp + 6 days);
        vm.expectRevert(FirePsa.NotStuck.selector);
        psa.cancelReveal(i);
        vm.warp(block.timestamp + 1 days);
        psa.cancelReveal(i); // randomness gone for good: the card unlocks, still unrevealed
        assertFalse(cards.gradePending(1));
        assertFalse(psa.pending(1));
        vm.prank(alice);
        cards.transferFrom(alice, bob, 1);
        psaRng.fulfill(psaRng.last(), 3); // a late answer is ignored
        vm.expectRevert(FirePsa.NotReady.selector);
        psa.finish(i);
    }

    event PaperFeedSet(address feed);

    function test_audit2_paperFeedCanBeSetLater() public {
        paperFeed.setIds(address(paper), address(0));
        vm.prank(owner);
        psaNoFeed.setPaperFeed(address(paperFeed));
        assertEq(psaNoFeed.paperPerReveal(), 5e18); // from the feed now ($0.05)
    }

    function test_audit3_paperFeedCanBeReplaced() public {
        paperFeed.set(0.01e18); // 25 PAPER
        psa.pokePrice();
        MockFeed next = new MockFeed(0);
        next.setIds(address(paper), address(0));
        vm.expectEmit(address(psa));
        emit PaperFeedSet(address(next));
        vm.prank(owner);
        psa.setPaperFeed(address(next));
        assertEq(address(psa.PAPER_USD()), address(next));
        assertEq(psa.paperPerReveal(), 25e18, "no price yet on the new feed: lastCost carries over");
        next.set(0.05e18);
        assertEq(psa.paperPerReveal(), 5e18, "then the new feed's price");
    }

    function test_audit3_paperFeedMustPriceThisPaper() public {
        MockFeed other = new MockFeed(0.05e18);
        other.setIds(address(0xBEEF), address(0));
        vm.prank(owner);
        vm.expectRevert(FirePsa.WrongFeed.selector);
        psa.setPaperFeed(address(other));
        vm.prank(owner);
        vm.expectRevert(FirePsa.ZeroAddress.selector);
        psa.setPaperFeed(address(0));
        other.setIds(address(paper), address(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        psa.setPaperFeed(address(other));
    }

    function test_audit3_costNeverZero() public {
        paperFeed.set(1e40); // absurd price: $1 worth rounds to 0 wei
        assertEq(psa.paperPerReveal(), 1, "at least 1 wei");
        psa.pokePrice();
        assertEq(psa.lastCost(), 1);
    }

    function test_audit3_noRerequestAfterCancelOrFinish() public {
        vm.prank(alice);
        uint256 i = psa.reveal(_ids(1, 1), type(uint256).max);
        vm.warp(block.timestamp + 7 days);
        psa.cancelReveal(i);
        vm.expectRevert(FirePsa.NotStuck.selector);
        psa.rerequest(i); // cancelled: done for good

        uint256 j = _reveal(2, 1, 5);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(FirePsa.NotStuck.selector);
        psa.rerequest(j); // finished
    }

    function test_capGapKeepsTheFractionalCost() public {
        paperFeed.set(2e18); // $2 a PAPER: half a PAPER a card
        psa.pokePrice();
        assertEq(psa.lastCost(), 0.5e18);
        vm.warp(block.timestamp + 3 days);
        assertEq(psa.paperPerReveal(), 0.5e18, "gap keeps the capped cost");
    }


    function test_audit2_keeperPokeRemembersThePrice() public {
        paperFeed.set(0.01e18); // 25 PAPER
        psa.pokePrice();
        assertEq(psa.lastCost(), 25e18);
        vm.warp(block.timestamp + 3 days); // gap with no reveals in between
        assertEq(psa.paperPerReveal(), 25e18);
    }
}
