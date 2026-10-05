// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {SeriesHelper} from "../cards/SeriesHelper.sol";

contract RigPacks {
    function minted(uint256) external pure returns (uint256) { return 0; }
}

/// @dev Stands in for FireCards: closes Series and calls the dealer, so the dealer can be driven directly.
contract RigCards {
    address public PACKS;
    mapping(uint256 => bool) internal _closed;
    mapping(uint256 => uint64) internal _packs;

    constructor() { PACKS = address(new RigPacks()); }

    function fires(uint256 f) external view returns (address, bool, bool, uint32, uint64, uint64) {
        return (address(0), _closed[f], false, 0, _packs[f], 0);
    }

    function close(uint256 f, uint64 p) external {
        _closed[f] = true;
        _packs[f] = p;
    }

    function deal(RecipeDealer d, uint256 f, uint256 seed, uint256 from, uint256 n) external returns (uint256[] memory) {
        return d.deal(f, seed, from, n);
    }
}

/// @dev Random recipes (nested slot sets of every shape, every supply rule, caps, holo modes, must-be-holo slots),
///      random Series sizes, dealt in random pieces. Every card must fit its slot, a must-be-holo slot's card is holo,
///      totals come out exactly as the pool, nothing is dealt beyond it, and every slot set always has enough.
contract RecipeFuzzTest is SeriesHelper {
    RigCards rig;
    RecipeDealer dealer;
    uint256 nextFire = 1;

    function setUp() public {
        rig = new RigCards();
        dealer = new RecipeDealer(address(this), address(rig));
    }

    function _r(uint256 seed, uint256 i) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, i)));
    }

    /// A random recipe: types with random ranks and rules, slot sets cut from a random order of the types as nested
    /// or disjoint intervals.
    function _recipe(uint256 seed) internal pure returns (RecipeDealer.Recipe memory r, bool[][] memory sets) {
        uint256 T = 1 + _r(seed, 0) % 8;
        r.types = new RecipeDealer.CardType[](T);
        uint256 filler = _r(seed, 1) % T;
        for (uint256 t; t < T; t++) r.types[t] = _randomType(_r(seed, 100 + t), t, t == filler);
        (uint256[] memory lo, uint256[] memory hi) = _intervals(seed, T);
        uint256[] memory perm = _perm(seed, T);
        r.slots = new RecipeDealer.Slot[](lo.length);
        sets = new bool[][](lo.length);
        for (uint256 g; g < lo.length; g++) (r.slots[g], sets[g]) = _slot(r, perm, lo[g], hi[g], _r(seed, 500 + g));
    }

    function _randomType(uint256 x, uint256 t, bool filler) internal pure returns (RecipeDealer.CardType memory c) {
        RecipeDealer.Supply sup = filler ? RecipeDealer.Supply.Filler : RecipeDealer.Supply(1 + x % 3);
        uint128 amount;
        if (sup == RecipeDealer.Supply.Share) amount = uint128((x >> 8) % 600_000_001);
        else if (sup == RecipeDealer.Supply.PerPack) amount = uint128((x >> 8) % 3);
        else if (sup == RecipeDealer.Supply.Count) amount = uint128((x >> 8) % 25);
        c = _type(string.concat("T", vm.toString(t)), string.concat("t", vm.toString(t)), uint32((x >> 40) % 6), sup, amount);
        if ((x >> 48) % 4 == 0) c.maxPerPack = uint64(1 + (x >> 56) % 2);
        if ((x >> 64) % 2 == 0) {
            c = _holoChances(c, uint64((x >> 72) % 1e18), uint64((x >> 136) % 1e18));
        } else {
            uint64 w0 = uint64((x >> 72) % 4);
            c = _holoWeights(c, w0, uint64((x >> 80) % 4), uint64((x >> 88) % 4), uint64((x >> 96) % 4 + (w0 == 0 ? 1 : 0)));
        }
    }

    function _perm(uint256 seed, uint256 T) internal pure returns (uint256[] memory perm) {
        perm = new uint256[](T);
        for (uint256 i; i < T; i++) perm[i] = i;
        for (uint256 i = T; i > 1; i--) {
            uint256 j = _r(seed, 200 + i) % i;
            (perm[i - 1], perm[j]) = (perm[j], perm[i - 1]);
        }
    }

    /// Up to 6 intervals of [0, T), any two nested or disjoint; plus all of [0, T) if they leave a type out.
    function _intervals(uint256 seed, uint256 T) internal pure returns (uint256[] memory lo, uint256[] memory hi) {
        uint256[] memory l = new uint256[](7);
        uint256[] memory h = new uint256[](7);
        uint256 n;
        for (uint256 k; k < 12 && n < 6; k++) {
            uint256 a = _r(seed, 300 + k) % T;
            uint256 b = a + _r(seed, 400 + k) % (T - a); // [a, b]
            bool ok = true;
            for (uint256 m; m < n && ok; m++) {
                bool disjoint = b < l[m] || a > h[m];
                bool inside = a >= l[m] && b <= h[m];
                bool around = l[m] >= a && h[m] <= b;
                if (!(disjoint || inside || around)) ok = false;
            }
            if (!ok) continue;
            l[n] = a;
            h[n] = b;
            n++;
        }
        bool[] memory covered = new bool[](T);
        for (uint256 m; m < n; m++) for (uint256 i = l[m]; i <= h[m]; i++) covered[i] = true;
        for (uint256 i; i < T; i++) {
            if (!covered[i]) {
                (l[n], h[n]) = (0, T - 1);
                n++;
                break;
            }
        }
        lo = new uint256[](n);
        hi = new uint256[](n);
        for (uint256 m; m < n; m++) (lo[m], hi[m]) = (l[m], h[m]);
    }

    function _slot(RecipeDealer.Recipe memory r, uint256[] memory perm, uint256 a, uint256 b, uint256 x)
        internal
        pure
        returns (RecipeDealer.Slot memory s, bool[] memory set)
    {
        uint32[] memory ts = new uint32[](b - a + 1);
        set = new bool[](r.types.length);
        bool canHolo = true;
        for (uint256 i = a; i <= b; i++) {
            ts[i - a] = uint32(perm[i]);
            set[perm[i]] = true;
            RecipeDealer.CardType memory c = r.types[perm[i]];
            bool h = c.holoMode == RecipeDealer.HoloMode.Independent
                ? (c.holo[0] > 0 || c.holo[1] > 0)
                : (c.holo[1] + c.holo[2] + c.holo[3] > 0);
            if (!h) canHolo = false;
        }
        s = _slotTypes(uint32(1 + x % 3), ts);
        s.mustHolo = canHolo && (x >> 8) % 3 == 0;
    }

    function _k(RecipeDealer.Recipe memory r, bool[][] memory sets, uint256 a) internal pure returns (uint256 k) {
        // slots whose set is inside set `a`
        for (uint256 g; g < sets.length; g++) {
            bool inside = true;
            for (uint256 t; t < sets[g].length; t++) if (sets[g][t] && !sets[a][t]) inside = false;
            if (inside) k += r.slots[g].count;
        }
    }

    /// The pool fills every slot set for any Series size.
    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_poolAlwaysFillsEverySlot(uint256 seed, uint256 packs) public view {
        (RecipeDealer.Recipe memory r, bool[][] memory sets) = _recipe(seed);
        packs = packs % 5 == 0 ? bound(packs, 0, type(uint64).max) : bound(packs, 0, 50);
        uint256[] memory pool = dealer.previewPool(r, packs);
        uint256 per = dealer.check(r);
        uint256 sum;
        for (uint256 t; t < pool.length; t++) sum += pool[t];
        assertEq(sum, per * packs, "cards == packs x cards per pack");
        for (uint256 g; g < sets.length; g++) {
            uint256 have;
            for (uint256 t; t < pool.length; t++) if (sets[g][t]) have += pool[t];
            assertGe(have, packs * _k(r, sets, g), "a slot set is short");
        }
    }

    /// Dealt in random pieces, every card fits its slot and the Series' totals are exact.
    /// forge-config: default.fuzz.runs = 200
    function testFuzz_everyCardFitsItsSlot(uint256 seed, uint256 packs) public {
        (RecipeDealer.Recipe memory r, bool[][] memory sets) = _recipe(seed);
        packs = bound(packs, 1, 25);
        uint256 fire = nextFire++;
        (string[] memory names, string[] memory cats) = _chars(1 + seed % 4);
        dealer.setRecipe(fire, r);
        dealer.setCharacters(fire, names, cats);
        rig.close(fire, uint64(packs));
        Run memory run = Run(fire, dealer.poolOf(fire), dealer.dealOrder(fire), new uint256[](r.types.length), names.length);
        for (uint256 p; p < packs; p++) _dealPack(run, r, sets, _r(seed, 1000 + p));
        (uint256[] memory left, uint256 packsLeft) = dealer.remainingOf(fire);
        assertEq(packsLeft, 0);
        for (uint256 t; t < run.got.length; t++) {
            assertEq(run.got[t], run.pool[t], "totals exact");
            assertEq(left[t], 0);
        }
        vm.expectRevert(RecipeDealer.NothingLeft.selector);
        rig.deal(dealer, fire, 1, 0, 1);
    }

    struct Run {
        uint256 fire;
        uint256[] pool;
        uint256[] order;
        uint256[] got;
        uint256 chars;
    }

    function _dealPack(Run memory run, RecipeDealer.Recipe memory r, bool[][] memory sets, uint256 seedP) internal {
        uint256 per = run.order.length;
        uint256 k;
        while (k < per) {
            uint256 n = 1 + _r(seedP, k) % per;
            if (n > per - k) n = per - k;
            uint256[] memory cards = rig.deal(dealer, run.fire, seedP, k, n);
            for (uint256 i; i < n; i++) {
                uint256 slot = run.order[k + i];
                uint256 t = uint32(cards[i]);
                assertTrue(sets[slot][t], "card outside its slot's set");
                if (r.slots[slot].mustHolo) assertTrue((cards[i] >> 64) & 3 != 0, "must-be-holo slot not holo");
                assertLt(uint32(cards[i] >> 32), run.chars, "character in range");
                run.got[t]++;
                assertLe(run.got[t], run.pool[t], "more than the pool");
            }
            k += n;
        }
    }

    // ---------------------------------------------------------------- odds parity with the previous contract

    /// The previous FireCards' dealing of one pack's slots 5 and 6 (CardRules materials), on an in-memory pool.
    function _oldPack(uint256[5] memory left, uint256 packsLeft, uint256 seed) internal pure returns (uint256 s5, uint256 s6, uint256) {
        s6 = _oldBP(left, _r(seed, 6));
        packsLeft--;
        uint256 flexBP = left[2] + left[3] + left[4] - packsLeft;
        uint256 flexWood = left[1] - packsLeft - 1; // Wood beyond the slot-4 Wood of this and later packs
        if (_r(seed, 5) % (flexBP + flexWood) < flexBP) {
            s5 = _oldBP(left, _r(seed, 7));
        } else {
            s5 = 1;
        }
        left[1] -= 1 + (s5 == 1 ? 1 : 0);
        return (s5, s6, packsLeft);
    }

    function _oldBP(uint256[5] memory left, uint256 r) internal pure returns (uint256) {
        uint256 x = r % (left[2] + left[3] + left[4]);
        if (x < left[2]) { left[2]--; return 2; }
        x -= left[2];
        if (x < left[3]) { left[3]--; return 3; }
        left[4]--;
        return 4;
    }

    /// Pack kinds by their two upper cards (slot 5 and 6, unordered): 0 W+F, 1 W+C, 2 W+D, 3 F+F, 4 F+C, 5 F+D,
    /// 6 C+C, 7 C+D, 8 D+D.
    function _kind(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a > b) (a, b) = (b, a);
        if (a == 1) return b - 2;
        if (a == 2) return 3 + (b - 2);
        if (a == 3) return 6 + (b - 3);
        return 8;
    }

    /// Small Standard Series (where one pack's two upper cards depend on each other most): the new dealer's pack
    /// kinds come up as often as the previous contract's, within 5 standard deviations.
    function test_standardOddsMatchTheOldDeal() public {
        uint256 series = 150;
        uint256 P = 4;
        uint256[9] memory oldN;
        uint256[9] memory newN;
        RecipeDealer.Recipe memory r = StandardRecipe.build(2);
        (string[] memory names, string[] memory cats) = _chars(1);
        for (uint256 f; f < series; f++) {
            // old
            uint256[] memory pool = dealer.previewPool(r, P);
            uint256[5] memory left = [pool[0], pool[1], pool[2], pool[3], pool[4]];
            uint256 packsLeft = P;
            for (uint256 p; p < P; p++) {
                (uint256 s5, uint256 s6, uint256 pl) = _oldPack(left, packsLeft, _r(f, p));
                packsLeft = pl;
                oldN[_kind(s5, s6)]++;
            }
            // new
            uint256 fire = nextFire++;
            dealer.setRecipe(fire, r);
            dealer.setCharacters(fire, names, cats);
            rig.close(fire, uint64(P));
            for (uint256 p; p < P; p++) {
                uint256[] memory c = rig.deal(dealer, fire, _r(f + 7_000, p), 0, 6);
                uint256 a;
                uint256 b;
                uint256 woods;
                for (uint256 i; i < 6; i++) {
                    uint256 t = uint32(c[i]);
                    if (t == 0) continue;
                    if (t == 1 && woods++ == 0) continue; // the slot-4 Wood
                    if (a == 0) a = t; else b = t;
                }
                newN[_kind(a, b)]++;
            }
        }
        uint256 n = series * P;
        for (uint256 k; k < 9; k++) {
            // |a - b| < 5 sqrt(2 n q (1 - q)), q from both runs together
            uint256 sum = oldN[k] + newN[k];
            uint256 q1e6 = sum * 1e6 / (2 * n);
            uint256 diff = oldN[k] > newN[k] ? oldN[k] - newN[k] : newN[k] - oldN[k];
            assertLe(diff * diff * 1e12, 25 * 2 * n * q1e6 * (1e6 - q1e6) + 1e12, string.concat("pack kind ", vm.toString(k)));
        }
        // the kinds that can happen at this size do happen
        assertGt(newN[0], 0);
        assertGt(newN[5] + newN[3], 0);
    }
}
