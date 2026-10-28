// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Test.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {MockRandomness} from "../Mocks.sol";
import {SeriesHelper} from "./SeriesHelper.sol";

/// @dev The one-per-character rule (the Standard's Full Art): exactly one of each character per Series, at random
///      packs, each taking the place of a Paper; nothing else about the packs changes.
contract OnePerCharacterTest is SeriesHelper {
    address owner = address(0xA11CE);
    address seller = address(0x5E11);
    FirePacks packs;
    FireCards cards;
    RecipeDealer dealer;
    MockRandomness rng;
    bytes32 constant DEALT = keccak256("CardDealt(uint256,uint256,uint256,uint256,bool,bool,uint256)");
    uint256 constant FA = StandardRecipe.FULL_ART;

    function setUp() public {
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        rng = new MockRandomness();
        rng.setFire(address(cards));
        vm.startPrank(owner);
        packs.setSeller(seller);
        packs.setCards(address(cards));
        cards.setSeller(seller);
        cards.setRandomness(address(rng));
        vm.stopPrank();
    }

    function _holder(uint256 i) internal pure returns (address) { return address(uint160(0x1000 + i)); }

    /// A Standard Series of `nChars` characters and `nPacks` packs, sold to 17 holders and closed.
    function _sold(uint256 fire, uint256 nChars, uint256 nPacks) internal {
        _standard(cards, dealer, owner, fire, nChars);
        vm.startPrank(seller);
        for (uint256 i; i < nPacks; i++) packs.mint(_holder(i % 17), fire, 1);
        cards.closeFire(fire);
        vm.stopPrank();
    }

    struct Pack {
        uint256 paper;
        uint256 fullArts;
        uint256 character; // the Full Art's
    }

    /// Every card dealt since recordLogs, grouped by open (one pack per open here).
    function _packs(uint256 n) internal returns (Pack[] memory out) {
        out = new Pack[](n);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != DEALT) continue;
            (uint256 openIndex, uint256 t,,, uint256 ch) = abi.decode(logs[i].data, (uint256, uint256, bool, bool, uint256));
            if (t == 0) out[openIndex].paper++;
            if (t == FA) { out[openIndex].fullArts++; out[openIndex].character = ch; }
        }
    }

    /// One open per pack, each with its own word, dealt `chunk` cards per process call (packs split across calls).
    function _openEach(uint256 fire, uint256 n, uint256 salt, uint256 chunk) internal returns (Pack[] memory) {
        uint256 first = rng.last() + 1;
        for (uint256 i; i < n; i++) { vm.prank(_holder(i % 17)); cards.open(fire, 1); }
        vm.recordLogs();
        for (uint256 i; i < n; i++) rng.fulfill(first + i, uint256(keccak256(abi.encode(salt, i))));
        while (cards.process(fire, chunk) != 0) {}
        return _packs(n);
    }

    /// The owner's example, scaled: 10 characters, 167 packs (1,002 cards) gives exactly 10 Full Arts, one of each
    /// character, each in place of a Paper, even with packs dealt a few cards at a time.
    function test_exactlyOneOfEachCharacter() public {
        _sold(1, 10, 167);
        Pack[] memory p = _openEach(1, 167, 1, 5);
        uint256[10] memory perChar;
        uint256 total;
        for (uint256 i; i < p.length; i++) {
            assertLe(p[i].fullArts, 1, "at most one a pack");
            assertEq(p[i].paper + p[i].fullArts, 3, "a Full Art takes a Paper's place");
            if (p[i].fullArts == 1) { perChar[p[i].character]++; total++; }
        }
        assertEq(total, 10, "10 Full Arts");
        for (uint256 c; c < 10; c++) assertEq(perChar[c], 1, "one per character");
        assertEq(dealer.onePerCharacterDealt(1), 10);
        assertEq(dealer.onePerCharacterOwed(1).length, 0, "none owed");
    }

    /// Where they land is random: over many Series every part of the Series gets its share (no clumping at the end).
    function test_spreadThroughTheSeries() public {
        uint256[4] memory quarter;
        for (uint256 f = 1; f <= 30; f++) {
            _sold(f, 4, 20);
            Pack[] memory p = _openEach(f, 20, f, type(uint256).max);
            uint256 n;
            for (uint256 i; i < 20; i++) if (p[i].fullArts == 1) { quarter[i / 5]++; n++; }
            assertEq(n, 4, "4 a Series");
        }
        // 120 Full Arts over 4 quarters: about 30 each
        for (uint256 q; q < 4; q++) assertApproxEqAbs(quarter[q], 30, 16, "each quarter its share");
    }

    /// Packs from a cancelled open go back sealed and still count: opened again later, the Series still ends with
    /// exactly one of each.
    function test_cancelledPacksStillCount() public {
        _sold(1, 6, 12);
        vm.prank(_holder(0));
        cards.open(1, 1); // pack 0's open: its randomness never comes
        uint256 lost = rng.last();
        vm.warp(block.timestamp + cards.CANCEL_AFTER());
        cards.cancelOpen(1, 0);
        assertEq(packs.balanceOf(_holder(0), 1), 1, "back, sealed");
        vm.recordLogs();
        uint256 first = rng.last() + 1;
        for (uint256 i; i < 12; i++) { vm.prank(_holder(i % 17)); cards.open(1, 1); }
        for (uint256 i; i < 12; i++) rng.fulfill(first + i, uint256(keccak256(abi.encode("again", i))));
        cards.process(1, type(uint256).max);
        assertTrue(lost != first);
        assertEq(dealer.onePerCharacterDealt(1), 6, "all six");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256[6] memory perChar;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != DEALT) continue;
            (, uint256 t,,, uint256 ch) = abi.decode(logs[i].data, (uint256, uint256, bool, bool, uint256));
            if (t == FA) perChar[ch]++;
        }
        for (uint256 c; c < 6; c++) assertEq(perChar[c], 1);
    }

    /// Fewer packs than characters: every pack carries one, and the rest stay owed (shown by onePerCharacterOwed).
    function test_fewerPacksThanCharacters() public {
        _sold(1, 5, 3);
        Pack[] memory p = _openEach(1, 3, 9, type(uint256).max);
        for (uint256 i; i < 3; i++) assertEq(p[i].fullArts, 1);
        uint256[] memory owed = dealer.onePerCharacterOwed(1);
        assertEq(owed.length, 2);
        bool[5] memory seen;
        for (uint256 i; i < 3; i++) seen[p[i].character] = true;
        for (uint256 i; i < 2; i++) { assertFalse(seen[owed[i]], "owed ones were never dealt"); seen[owed[i]] = true; }
        for (uint256 c; c < 5; c++) assertTrue(seen[c], "every character dealt or owed");
    }

    /// The owed list shrinks as they come out, and is always the characters not yet dealt.
    function test_owedListTracksTheSeries() public {
        _sold(1, 8, 40);
        assertEq(dealer.onePerCharacterOwed(1).length, 8, "all owed before any deal");
        uint256 first = rng.last() + 1;
        for (uint256 i; i < 40; i++) { vm.prank(_holder(i % 17)); cards.open(1, 1); }
        bool[8] memory got;
        for (uint256 i; i < 40; i++) {
            vm.recordLogs();
            rng.fulfill(first + i, uint256(keccak256(abi.encode("owed", i))));
            cards.process(1, type(uint256).max);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            for (uint256 k; k < logs.length; k++) {
                if (logs[k].topics[0] != DEALT) continue;
                (, uint256 t,,, uint256 ch) = abi.decode(logs[k].data, (uint256, uint256, bool, bool, uint256));
                if (t == FA) got[ch] = true;
            }
            uint256[] memory owed = dealer.onePerCharacterOwed(1);
            uint256 dealtSoFar;
            for (uint256 c; c < 8; c++) if (got[c]) dealtSoFar++;
            assertEq(owed.length, 8 - dealtSoFar);
            for (uint256 k; k < owed.length; k++) assertFalse(got[owed[k]], "never owed once dealt");
        }
        assertEq(dealer.onePerCharacterOwed(1).length, 0);
    }

    /// Only FireCards can deal (dealing changes what is owed); anyone can `roll` to check a pack's slot cards.
    function test_onlyCardsDeals() public {
        _standard(cards, dealer, owner, 1, 3);
        vm.expectRevert(RecipeDealer.NotCards.selector);
        dealer.deal(1, 42, 0, 6);
        assertEq(dealer.roll(1, 42, 0, 6).length, 6);
    }

    /// The compiler: the type must exist and be in no slot.
    function test_compilerRules() public {
        RecipeDealer.Recipe memory r = StandardRecipe.build();
        r.onePerCharacter = 7;
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadRecipe.selector, "one per character"));
        dealer.check(r);
        r = StandardRecipe.build();
        r.slots[3].weights[FA] = 1;
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadSlot.selector, 3, "one-per-character type in a slot"));
        dealer.check(r);
        r = StandardRecipe.build();
        r.onePerCharacter = 0; // Full Art then in no slot and not the rule's: refused as before
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadType.selector, FA, "in no slot"));
        dealer.check(r);
    }
}
