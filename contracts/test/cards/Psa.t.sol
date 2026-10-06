// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {stdJson} from "forge-std/StdJson.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {CardsRenderer} from "../../src/cards/CardsRenderer.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {MockERC20, MockUSDG, MockRandomness, MockBurner} from "../Mocks.sol";
import {SeriesHelper} from "./SeriesHelper.sol";

/// @dev Cases and PDA grading (docs/grading.md): wear, freezing, payment, the fixed wear table and its parity with
///      contracts/test/cards/wear-model.py.
contract PsaTest is SeriesHelper {
    using stdJson for string;

    address owner = address(0xA11CE0);
    address seller = address(0x5E11);
    address alice = address(0xA1);
    address bob = address(0xB2);

    MockERC20 plank;
    MockUSDG usdg;
    MockRandomness cardRng;
    MockRandomness psaRng;
    MockBurner burner;
    FirePacks packs;
    FireCards cards;
    RecipeDealer dealer;
    CardsRenderer renderer;
    FirePsa psa;

    function setUp() public {
        vm.warp(1_800_000_000);
        plank = new MockERC20("PLANK", "PLANK");
        usdg = new MockUSDG();
        cardRng = new MockRandomness();
        psaRng = new MockRandomness();
        burner = new MockBurner(address(plank), address(usdg));
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        renderer = new CardsRenderer(address(cards));
        cardRng.setFire(address(cards));
        psa = new FirePsa(owner, address(cards), address(burner));
        psaRng.setFire(address(psa));
        vm.startPrank(owner);
        packs.setSeller(seller);
        packs.setCards(address(cards));
        cards.setSeller(seller);
        cards.setRandomness(address(cardRng));
        cards.setPsa(address(psa));
        cards.setRenderer(address(renderer));
        psa.setRandomness(address(psaRng));
        vm.stopPrank();
        _standard(cards, dealer, owner, 1, 2, 1);

        // alice gets 2 packs' worth of cards (serials 1..12)
        vm.startPrank(seller);
        packs.mint(alice, 1, 2);
        cards.closeFire(1);
        vm.stopPrank();
        vm.prank(alice);
        cards.open(1, 2);
        cardRng.fulfill(cardRng.last(), 7);
        cards.process(1, 100);
        assertEq(cards.balanceOf(alice), 12);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        plank.mint(alice, 1_000e18);
        usdg.mint(alice, 1_000e18); // the mock burner quotes 1e18 per dollar in anything
    }

    function _one(uint256 id) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = id;
    }

    function _none() internal pure returns (uint256[] memory) {
        return new uint256[](0);
    }

    function _case(address who, uint256[] memory ids) internal {
        uint256 cost = psa.quote(ids.length, 0, FirePsa.Pay.ETH);
        vm.prank(who);
        psa.protect{value: cost}(ids, _none(), FirePsa.Pay.ETH, cost);
    }

    /// Grade cards and finish with `word`. Returns the grading index.
    function _grade(address who, uint256[] memory ids, uint256 word) internal returns (uint256 index) {
        uint256 cost = psa.quote(0, ids.length, FirePsa.Pay.ETH);
        vm.prank(who);
        index = psa.protect{value: cost}(_none(), ids, FirePsa.Pay.ETH, cost);
        psaRng.fulfill(psaRng.last(), word);
        psa.finish(index);
    }

    // ================================================================ the fixed wear table

    /// The contract's odds are the model's, to the wei, for every vector (ages from a day to 80 years, 0-25 moves,
    /// the Standard odds and a custom one).
    function test_wearOddsMatchTheModel() public {
        string memory json = vm.readFile("test/cards/wear-vectors.json");
        uint256 n;
        while (json.keyExists(string.concat(".cases[", vm.toString(n), "]"))) n++;
        assertGt(n, 90);
        for (uint256 i; i < n; i++) {
            string memory p = string.concat(".cases[", vm.toString(i), "]");
            uint256 age = json.readUint(string.concat(p, ".age"));
            uint256 moves = json.readUint(string.concat(p, ".moves"));
            uint256 fire = 1;
            if (json.keyExists(string.concat(p, ".weights"))) {
                uint256[] memory w = json.readUintArray(string.concat(p, ".weights"));
                uint64[10] memory o;
                for (uint256 g; g < 10; g++) o[g] = uint64(w[g]);
                fire = 50;
                _standard(cards, dealer, owner, fire, 2, 1);
                vm.prank(owner);
                psa.setOdds(fire, o);
            }
            string[] memory want = json.readStringArray(string.concat(p, ".odds"));
            uint256[10] memory got = psa.oddsFor(fire, age, moves);
            for (uint256 g; g < 10; g++) assertEq(got[g], vm.parseUint(want[g]), string.concat("case ", vm.toString(i)));
        }
    }

    function test_freshCardsOnlyGrade5To10() public view {
        uint256[10] memory o = psa.oddsFor(1, 23 hours, 0);
        for (uint256 g; g < 4; g++) assertEq(o[g], 0);
        assertApproxEqAbs(o[9], 0.01e18, 1e10, "PDA 10: 1%");
        assertApproxEqAbs(o[8], 0.17e18, 1e10);
        assertApproxEqAbs(o[4], 0.10e18, 1e10, "PDA 5: 10%");
        // moves alone never go below 5
        o = psa.oddsFor(1, 0, 1_000);
        for (uint256 g; g < 4; g++) assertEq(o[g], 0);
        assertEq(psa.oddsFor(1, 0, 10)[9], psa.oddsFor(1, 0, 25)[9], "moves past 10 add nothing");
    }

    function test_lowGradesFadeInWithTime() public view {
        assertEq(psa.oddsFor(1, 1 days + 29 days, 0)[3], 0, "PDA 4 closed before a month");
        assertGt(psa.oddsFor(1, 1 days + 40 days, 0)[3], 0, "PDA 4 opening");
        assertEq(psa.oddsFor(1, 1 days + 364 days, 0)[1], 0, "PDA 2 closed before a year");
        assertEq(psa.oddsFor(1, 1 days + 2 * 365 days, 0)[0], 0, "PDA 1 closed at two years");
        assertGt(psa.oddsFor(1, 1 days + 3 * 365 days, 0)[0], 0.04e18, "PDA 1 at three years");
        assertGt(psa.oddsFor(1, 1 days + 10 * 365 days, 0)[0], 0.6e18, "PDA 1 likely at ten years");
        // no overnight jumps: at most about half a point a day
        uint256[10] memory prev = psa.oddsFor(1, 0, 0);
        for (uint256 d = 1; d < 5 * 365; d += 1) {
            uint256[10] memory cur = psa.oddsFor(1, d * 1 days, 0);
            for (uint256 g; g < 10; g++) {
                uint256 diff = cur[g] > prev[g] ? cur[g] - prev[g] : prev[g] - cur[g];
                assertLt(diff, 0.006e18, "a day never moves a grade by more than 0.6 points");
            }
            prev = cur;
        }
    }

    function test_oddsSumToOne() public view {
        uint256[6] memory ages = [uint256(0), 3 days, 200 days, 2 * 365 days, 9 * 365 days, 100 * 365 days];
        for (uint256 a; a < 6; a++) {
            for (uint256 m; m < 12; m += 3) {
                uint256[10] memory o = psa.oddsFor(1, ages[a], m);
                uint256 t;
                for (uint256 g; g < 10; g++) t += o[g];
                assertApproxEqAbs(t, 1e18, 1e6);
            }
        }
    }

    // ================================================================ wear on the card

    function test_movesCountUntilCasedAndOnlyBetweenWallets() public {
        (,,,, uint256 age0, uint256 m0) = cards.wearOf(1);
        assertEq(age0, 0);
        assertEq(m0, 0, "dealing isn't a move");
        vm.prank(alice);
        cards.transferFrom(alice, alice, 1);
        (,,,,, uint256 mSelf) = cards.wearOf(1);
        assertEq(mSelf, 0, "sending a card to your own wallet isn't a move");
        for (uint256 i; i < 12; i++) {
            address from = i % 2 == 0 ? alice : bob;
            address to = i % 2 == 0 ? bob : alice;
            vm.prank(from);
            cards.transferFrom(from, to, 1);
        }
        (,,,,, uint256 moves) = cards.wearOf(1);
        assertEq(moves, 10, "capped at 10");
        _case(alice, _one(2));
        vm.prank(alice);
        cards.transferFrom(alice, bob, 2);
        (,,, bool cased,, uint256 m2) = cards.wearOf(2);
        assertTrue(cased);
        assertEq(m2, 0, "a cased card doesn't wear from moves");
    }

    function test_caseFreezesTheClock() public {
        vm.warp(block.timestamp + 10 days);
        _case(alice, _one(3));
        vm.warp(block.timestamp + 400 days);
        (,,, bool cased, uint256 age,) = cards.wearOf(3);
        assertTrue(cased);
        assertEq(age, 10 days, "frozen at casing");
        (,,,, uint256 ageOther,) = cards.wearOf(4);
        assertEq(ageOther, 410 days, "an uncased card keeps ageing");
    }

    function test_caseTwiceRevertsAndCaseThenGradeWorks() public {
        _case(alice, _one(5));
        uint256 cost = psa.quote(1, 0, FirePsa.Pay.ETH);
        vm.prank(alice);
        vm.expectRevert(FireCards.AlreadyCased.selector);
        psa.protect{value: cost}(_one(5), _none(), FirePsa.Pay.ETH, cost);
        vm.warp(block.timestamp + 5 * 365 days); // years later: still graded on its fresh, frozen wear
        _grade(alice, _one(5), 99);
        (,, uint256 grade,,,) = cards.wearOf(5);
        assertGe(grade, 5, "cased within a day: a fresh card");
    }

    function test_gradingFreezesWhileWaiting() public {
        vm.warp(block.timestamp + 3 days);
        uint256 cost = psa.quote(0, 1, FirePsa.Pay.ETH);
        vm.prank(alice);
        uint256 index = psa.protect{value: cost}(_none(), _one(6), FirePsa.Pay.ETH, cost);
        vm.prank(alice);
        vm.expectRevert(FireCards.GradingInProgress.selector);
        cards.transferFrom(alice, bob, 6);
        vm.warp(block.timestamp + 6 days); // randomness late: doesn't count as wear
        (,,,, uint256 age,) = cards.wearOf(6);
        assertEq(age, 3 days);
        psaRng.fulfill(psaRng.last(), 1234);
        psa.finish(index);
        (,, uint256 grade,,,) = cards.wearOf(6);
        assertGe(grade, 5);
        assertFalse(cards.gradePending(6));
        vm.prank(alice);
        cards.transferFrom(alice, bob, 6); // a slab moves freely
    }

    function test_freshGradesAreAlways5To10AndOldOnesLow() public {
        uint256[] memory ids = _ids(1, 12);
        _grade(alice, ids, 4242);
        for (uint256 i = 1; i <= 12; i++) {
            (,, uint256 g,,,) = cards.wearOf(i);
            assertGe(g, 5);
            assertLe(g, 10);
        }
        // a second Series, left uncased for 20 years
        _standard(cards, dealer, owner, 2, 2, 1);
        vm.startPrank(seller);
        packs.mint(bob, 2, 3);
        cards.closeFire(2);
        vm.stopPrank();
        vm.prank(bob);
        cards.open(2, 3);
        cardRng.fulfill(cardRng.last(), 8);
        cards.process(2, 100);
        vm.warp(block.timestamp + 20 * 365 days);
        uint256 low;
        uint256[] memory old = _ids(13, 18);
        uint256 cost = psa.quote(0, 18, FirePsa.Pay.ETH);
        vm.prank(bob);
        uint256 index = psa.protect{value: cost}(_none(), old, FirePsa.Pay.ETH, cost);
        psaRng.fulfill(psaRng.last(), 77);
        psa.finish(index);
        for (uint256 i = 13; i <= 30; i++) {
            (,, uint256 g,,,) = cards.wearOf(i);
            if (g <= 2) low++;
        }
        assertGe(low, 15, "twenty years uncased: almost all PDA 1-2");
    }

    function test_gradeForFollowsOddsFor() public view {
        uint256[10] memory o = psa.oddsFor(1, 400 days, 3);
        uint256[11] memory seen;
        uint256 n = 4_000;
        for (uint256 i; i < n; i++) seen[psa.gradeFor(1, 400 days, 3, uint256(keccak256(abi.encode(i))))]++;
        for (uint256 g = 1; g <= 10; g++) {
            uint256 want = o[g - 1] * n / 1e18;
            assertApproxEqAbs(seen[g], want, 60, string.concat("grade ", vm.toString(g)));
        }
    }

    // ================================================================ images and metadata

    function test_imageAndTraitsFollowTheState() public {
        string memory json = _json(cards.tokenURI(7));
        assertTrue(_contains(json, '-u.webp"'), json);
        assertTrue(_contains(json, '{"trait_type":"PDA","value":"Ungraded"}'), json);
        assertTrue(_contains(json, '{"trait_type":"Cased","value":"No"}'), json);
        assertTrue(_contains(json, '"trait_type":"Moves","value":0'), json);
        vm.prank(alice);
        cards.transferFrom(alice, bob, 7);
        vm.warp(block.timestamp + 3 days + 1);
        json = _json(cards.tokenURI(7));
        assertTrue(_contains(json, '"trait_type":"Moves","value":1'), json);
        assertTrue(_contains(json, '"trait_type":"Uncased Age (days)","value":3'), json);
        vm.deal(bob, 10 ether);
        _case(bob, _one(7));
        json = _json(cards.tokenURI(7));
        assertTrue(_contains(json, '-c.webp"'), json);
        assertTrue(_contains(json, '{"trait_type":"Cased","value":"Yes"}'), json);
        _grade(bob, _one(7), 5);
        (,, uint256 g,,,) = cards.wearOf(7);
        json = _json(cards.tokenURI(7));
        assertTrue(_contains(json, string.concat("-", vm.toString(g), '.webp"')), json);
        assertTrue(_contains(json, string.concat('{"trait_type":"PDA","value":"PDA ', vm.toString(g), '"}')), json);
        assertFalse(_contains(json, "Cased"), "a slab shows only its grade");
        assertFalse(_contains(json, "Moves"), json);
        vm.parseJson(json);
    }

    // ================================================================ paying

    function test_paysInEachCurrencyAndAllOfItGoesToTheBurner() public {
        uint256 c = psa.quote(2, 1, FirePsa.Pay.ETH);
        assertEq(c, 2 * 0.05e18 + 1e18, "case $0.05 + grade $1 (mock burner: 1e18 per dollar)");
        uint256 before = alice.balance;
        vm.prank(alice);
        psa.protect{value: c + 5 ether}(_ids(1, 2), _one(3), FirePsa.Pay.ETH, c);
        assertEq(alice.balance, before - c, "the rest of the ETH comes back");
        assertEq(address(burner).balance, c);
        assertEq(burner.flushes(), 1);
        assertEq(address(psa).balance, 0, "FirePsa keeps nothing");

        uint256 cp = psa.quote(1, 0, FirePsa.Pay.PLANK);
        vm.startPrank(alice);
        plank.approve(address(psa), cp);
        psa.protect(_one(4), _none(), FirePsa.Pay.PLANK, cp);
        uint256 cu = psa.quote(1, 0, FirePsa.Pay.USDG);
        usdg.approve(address(psa), cu);
        psa.protect(_one(5), _none(), FirePsa.Pay.USDG, cu);
        vm.stopPrank();
        assertEq(plank.balanceOf(address(burner)), cp);
        assertEq(usdg.balanceOf(address(burner)), cu);
    }

    function test_paymentGuards() public {
        uint256 c = psa.quote(0, 1, FirePsa.Pay.ETH);
        vm.prank(alice);
        vm.expectRevert(FirePsa.PriceMoved.selector);
        psa.protect{value: c - 1}(_none(), _one(1), FirePsa.Pay.ETH, c);
        vm.prank(alice);
        vm.expectRevert(FirePsa.PriceMoved.selector);
        psa.protect{value: c}(_none(), _one(1), FirePsa.Pay.ETH, c - 1); // the price went up past the most
        vm.prank(bob);
        vm.expectRevert(FirePsa.NotHolder.selector);
        psa.protect{value: c}(_none(), _one(1), FirePsa.Pay.ETH, c);
        vm.prank(alice);
        vm.expectRevert(FirePsa.BadAmount.selector);
        psa.protect(_none(), _none(), FirePsa.Pay.ETH, 0);
        vm.prank(owner);
        psa.setMaxBatch(2);
        vm.prank(alice);
        vm.expectRevert(FirePsa.BadAmount.selector);
        psa.protect{value: 10 ether}(_one(1), _ids(2, 2), FirePsa.Pay.ETH, 10 ether);
        // graded cards can't be graded or cased again
        _grade(alice, _one(9), 3);
        c = psa.quote(0, 1, FirePsa.Pay.ETH);
        vm.prank(alice);
        vm.expectRevert(FirePsa.AlreadyGraded.selector);
        psa.protect{value: c}(_none(), _one(9), FirePsa.Pay.ETH, c);
        c = psa.quote(1, 0, FirePsa.Pay.ETH);
        vm.prank(alice);
        vm.expectRevert(FireCards.AlreadyGraded.selector);
        psa.protect{value: c}(_one(9), _none(), FirePsa.Pay.ETH, c);
    }

    function test_ownerSettings() public {
        vm.startPrank(owner);
        psa.setPrices(0.1e18, 2e18);
        assertEq(psa.caseUsd18(), 0.1e18);
        assertEq(psa.gradeUsd18(), 2e18);
        vm.expectRevert(FirePsa.BadAmount.selector);
        psa.setPrices(0, 1e18);
        vm.expectRevert(FirePsa.BadAmount.selector);
        psa.setPrices(1e18, 101e18);
        vm.expectRevert(FirePsa.BadAmount.selector);
        psa.setMaxBatch(0);
        vm.expectRevert(FirePsa.BadAmount.selector);
        psa.setMaxBatch(101);
        vm.expectRevert(FirePsa.AlreadySet.selector);
        psa.setRandomness(address(1));
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        psa.setPrices(1e18, 1e18);
    }

    function test_freshOddsRules() public {
        _standard(cards, dealer, owner, 3, 2, 1);
        uint64[10] memory o = [uint64(0), 0, 0, 0, 0, 0, 0, 0, 1, 1];
        vm.prank(owner);
        psa.setOdds(3, o);
        (uint64[10] memory got, uint256 total) = psa.oddsOf(3);
        assertEq(got[9], 1);
        assertEq(total, 2);
        o[3] = 1; // grade 4: only wear gives those
        vm.prank(owner);
        vm.expectRevert(FirePsa.BadOdds.selector);
        psa.setOdds(3, o);
        o = [uint64(0), 0, 0, 0, 0, 0, 0, 0, 0, 0];
        vm.prank(owner);
        vm.expectRevert(FirePsa.BadOdds.selector);
        psa.setOdds(3, o);
        // fixed once the Series has packs (Series 1 does)
        o[9] = 1;
        vm.prank(owner);
        vm.expectRevert(FirePsa.FireIsClosed.selector);
        psa.setOdds(1, o);
        // and once it's locked for its drop
        _standard(cards, dealer, owner, 4, 2, 1);
        vm.prank(owner);
        cards.lockFire(4);
        vm.prank(owner);
        vm.expectRevert(FirePsa.FireIsClosed.selector);
        psa.setOdds(4, o);
    }

    // ================================================================ randomness

    function test_cancelAfterAWeekFromTheFirstRequestAndTheClockRunsOn() public {
        vm.warp(block.timestamp + 2 days);
        uint256 cost = psa.quote(0, 1, FirePsa.Pay.ETH);
        vm.prank(alice);
        uint256 index = psa.protect{value: cost}(_none(), _one(8), FirePsa.Pay.ETH, cost);
        vm.expectRevert(FirePsa.NotStuck.selector);
        psa.rerequest(index);
        vm.warp(block.timestamp + 1 days + 1);
        psa.rerequest(index); // asking again doesn't restart the cancel clock
        vm.warp(block.timestamp + 5 days);
        vm.expectRevert(FirePsa.NotStuck.selector);
        psa.cancelGrading(index); // 6 days since the first request
        vm.warp(block.timestamp + 1 days);
        psa.cancelGrading(index);
        assertFalse(cards.gradePending(8));
        (,, uint256 grade, bool cased, uint256 age,) = cards.wearOf(8);
        assertEq(grade, 0);
        assertFalse(cased);
        assertEq(age, 2 days, "the wait didn't count");
        vm.warp(block.timestamp + 1 days);
        (,,,, age,) = cards.wearOf(8);
        assertEq(age, 3 days, "and it runs again");
        vm.prank(alice);
        cards.transferFrom(alice, bob, 8);
    }

    function test_onlyRandomnessDeliversAndFinishOnce() public {
        uint256 cost = psa.quote(0, 1, FirePsa.Pay.ETH);
        vm.prank(alice);
        uint256 index = psa.protect{value: cost}(_none(), _one(10), FirePsa.Pay.ETH, cost);
        vm.expectRevert(FirePsa.NotRandomness.selector);
        psa.onRandomness(1, 5);
        vm.expectRevert(FirePsa.NotReady.selector);
        psa.finish(index);
        psaRng.fulfill(psaRng.last(), 5);
        psa.finish(index);
        vm.expectRevert(FirePsa.NotReady.selector);
        psa.finish(index);
    }

    function test_onlyPsaCasesOrGrades() public {
        vm.expectRevert(FireCards.NotPsa.selector);
        cards.setCased(1);
        vm.expectRevert(FireCards.NotPsa.selector);
        cards.setGrade(1, 5);
        vm.expectRevert(FireCards.NotPsa.selector);
        cards.setGradePending(1, true);
    }
}
