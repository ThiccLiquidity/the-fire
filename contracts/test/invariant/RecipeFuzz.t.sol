// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {SeriesHelper} from "../cards/SeriesHelper.sol";

contract RigPacks {
    function minted(uint256) external pure returns (uint256) { return 0; }
}

/// @dev Stands in for FireCards (never locked or closed), so the dealer can be driven directly.
contract RigCards {
    address public PACKS;

    constructor() { PACKS = address(new RigPacks()); }

    function fires(uint256) external pure returns (address, bool, bool, uint32, uint64, uint64) {
        return (address(0), false, false, 0, 0, 0);
    }
}

/// @dev Random slot recipes (any number of types and slots, any weights with gaps, both holo modes, any pack size) and
///      random character weights, dealt from random seeds in random pieces. Every card is a type its slot can deal and a
///      character of the Series, holo only as its type allows, the same however a pack is split, and the views read
///      back the slots and weights.
contract RecipeFuzzTest is SeriesHelper {
    RigCards rig;
    RecipeDealer dealer;
    uint256 nextFire = 1;

    function setUp() public {
        rig = new RigCards();
        dealer = new RecipeDealer(address(this), address(rig), address(new RecipeCompiler()));
    }

    function _r(uint256 seed, uint256 i) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, i)));
    }

    /// A random recipe: 1-12 types with random holo; 1-6 slots of 1-8 cards, each with random weights (up to
    ///    2^64 - 1, some 0) over the types, every slot with some weight and every type in some slot.
    function _randomRecipe(uint256 seed) internal pure returns (RecipeDealer.Recipe memory r) {
        uint256 T = 1 + _r(seed, 0) % 12;
        r.types = new RecipeDealer.CardType[](T);
        uint256 S = 1 + _r(seed, 1) % 6;
        r.slots = new RecipeDealer.Slot[](S);
        bool[] memory used = new bool[](T);
        for (uint256 s; s < S; s++) {
            r.slots[s].count = uint32(1 + _r(seed, 50 + s) % 8);
            uint64[] memory w = new uint64[](T);
            bool any;
            for (uint256 t; t < T; t++) {
                uint256 x = _r(seed, 1000 + s * 100 + t);
                if (x % 3 == 0) continue; // not in this slot
                w[t] = x % 4 == 1 ? uint64(1 + (x >> 8) % type(uint64).max) : uint64(1 + (x >> 8) % 1000);
                used[t] = any = true;
            }
            if (!any) { w[s % T] = 1; used[s % T] = true; }
            r.slots[s].weights = w;
        }
        for (uint256 t; t < T; t++) if (!used[t]) r.slots[t % S].weights[t] = 7; // every type in some slot
        for (uint256 t; t < T; t++) {
            uint256 x = _r(seed, 100 + t);
            RecipeDealer.CardType memory c = _type(string.concat("T", vm.toString(t)), string.concat("t", vm.toString(t)), uint32(x >> 80));
            uint256 h = (x >> 100) % 4;
            if (h == 0) c = _holoChances(c, 0, 0); // never holo
            else if (h == 1) c = _holoWeights(c, 0, 0, 0, 1); // always full
            else if (h == 2) c = _holoChances(c, uint64((x >> 120) % 1e18), uint64((x >> 180) % 1e18));
            else c = _holoWeights(c, uint64((x >> 120) % 5), uint64((x >> 130) % 5), uint64((x >> 140) % 5), 1);
            r.types[t] = c;
        }
    }

    function _setUp(uint256 seed) internal returns (uint256 fire, RecipeDealer.Recipe memory r, uint256 chars) {
        fire = nextFire++;
        r = _randomRecipe(seed);
        chars = 1 + _r(seed, 2) % 30;
        (string[] memory names, string[] memory cats) = _chars(chars);
        dealer.setRecipe(fire, r);
        dealer.setCharacters(fire, names, cats);
        if (_r(seed, 3) % 2 == 0) {
            uint64[] memory w = new uint64[](chars);
            for (uint256 i; i < chars; i++) w[i] = uint64(1 + _r(seed, 300 + i) % 50);
            dealer.setCharacterWeights(fire, w);
        }
    }

    function _perPack(RecipeDealer.Recipe memory r) internal pure returns (uint256 n) {
        for (uint256 s; s < r.slots.length; s++) n += r.slots[s].count;
    }

    /// The slot position `i` is in.
    function _slotAt(RecipeDealer.Recipe memory r, uint256 i) internal pure returns (uint256 s) {
        uint256 end = r.slots[0].count;
        while (i >= end) end += r.slots[++s].count;
    }

    function testFuzz_everyCardIsValid(uint256 seed) public {
        (uint256 fire, RecipeDealer.Recipe memory r, uint256 chars) = _setUp(seed);
        assertTrue(dealer.ready(fire));
        uint256 per = _perPack(r);
        assertEq(dealer.cardsPerPack(fire), per);
        for (uint256 p; p < 5; p++) {
            uint256 s = _r(seed, 1000 + p);
            uint256[] memory got = dealer.deal(fire, s, 0, per);
            assertEq(got.length, per);
            for (uint256 i; i < per; i++) {
                uint256 a = got[i];
                uint256 t = uint32(a);
                assertLt(t, r.types.length, "a type of the recipe");
                assertGt(r.slots[_slotAt(r, i)].weights[t], 0, "a type its slot can deal");
                assertLt(uint32(a >> 32), chars, "a character of the Series");
                assertEq(a >> 66, 0, "nothing else set");
                RecipeDealer.CardType memory c = r.types[t];
                bool hf = (a >> 64) & 1 == 1;
                bool hp = (a >> 65) & 1 == 1;
                if (c.holoMode == RecipeDealer.HoloMode.Independent) {
                    if (c.holo[0] == 0) assertFalse(hf);
                    if (c.holo[1] == 0) assertFalse(hp);
                } else {
                    if (c.holo[1] == 0 && c.holo[3] == 0) assertFalse(hf);
                    if (c.holo[2] == 0 && c.holo[3] == 0) assertFalse(hp);
                    if (c.holo[0] == 0 && c.holo[1] == 0 && c.holo[2] == 0) assertTrue(hf && hp, "always full");
                }
            }
            // split anywhere: the same cards
            uint256 k = _r(s, 7) % per;
            if (k > 0) {
                uint256[] memory a1 = dealer.deal(fire, s, 0, k);
                uint256[] memory a2 = dealer.deal(fire, s, k, per - k);
                for (uint256 i; i < k; i++) assertEq(a1[i], got[i]);
                for (uint256 i; i < per - k; i++) assertEq(a2[i], got[k + i]);
            }
        }
    }

    function testFuzz_oddsViewsReadBackTheWeights(uint256 seed) public {
        (uint256 fire, RecipeDealer.Recipe memory r, uint256 chars) = _setUp(seed);
        (uint256[] memory counts, uint256[][] memory w, uint256[] memory totals) = dealer.slotsOf(fire);
        assertEq(counts.length, r.slots.length);
        for (uint256 s; s < r.slots.length; s++) {
            assertEq(counts[s], r.slots[s].count);
            assertEq(w[s].length, r.types.length);
            uint256 sum;
            for (uint256 t; t < r.types.length; t++) {
                assertEq(w[s][t], r.slots[s].weights[t]);
                sum += r.slots[s].weights[t];
            }
            assertEq(totals[s], sum);
        }
        (uint256[] memory cw, uint256 ctotal) = dealer.characterOddsOf(fire);
        assertEq(cw.length, chars);
        uint256 csum;
        for (uint256 i; i < chars; i++) { assertGt(cw[i], 0); csum += cw[i]; }
        assertEq(ctotal, csum);
        RecipeDealer.Recipe memory back = dealer.recipeOf(fire);
        assertEq(keccak256(abi.encode(back)), keccak256(abi.encode(r)));
    }

    /// A type that is the only one with any weight is always dealt; a heavy type dominates a light one.
    function testFuzz_heavyTypeDominates(uint256 seed) public {
        RecipeDealer.CardType[] memory ts = new RecipeDealer.CardType[](2);
        ts[0] = _type("Heavy", "heavy", 0);
        ts[1] = _type("Light", "light", 1);
        uint256 fire = nextFire++;
        (string[] memory names, string[] memory cats) = _chars(1);
        dealer.setRecipe(fire, _recipe(ts, _w(1_000_000, 1), 50));
        dealer.setCharacters(fire, names, cats);
        uint256[] memory got = dealer.deal(fire, seed, 0, 50);
        uint256 light;
        for (uint256 i; i < 50; i++) if (uint32(got[i]) == 1) light++;
        assertLe(light, 2, "1 in a million");
    }

    /// The Standard recipe compiles to exactly its slots (3 Paper, 1 Wood, Wood or better out of 1,000, Fire or better
    /// out of 10,000) and 6 cards a pack.
    function test_standardCompiles() public {
        uint256 fire = nextFire++;
        (string[] memory names, string[] memory cats) = _chars(3);
        dealer.setRecipe(fire, StandardRecipe.build());
        dealer.setCharacters(fire, names, cats);
        (uint256[] memory counts, uint256[][] memory w, uint256[] memory totals) = dealer.slotsOf(fire);
        assertEq(counts[0], StandardRecipe.PAPER_COUNT);
        assertEq(totals[StandardRecipe.SLOT_WOOD_UP], StandardRecipe.WOOD_UP_TOTAL);
        assertEq(totals[StandardRecipe.SLOT_FIRE_UP], StandardRecipe.FIRE_UP_TOTAL);
        assertEq(w[StandardRecipe.SLOT_FIRE_UP][StandardRecipe.FULL_ART], 750);
        assertEq(w[StandardRecipe.SLOT_WOOD_UP][StandardRecipe.FULL_ART], 45);
        assertEq(dealer.cardsPerPack(fire), 6);
    }
}
