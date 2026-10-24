// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FireSale} from "../../src/cards/FireSale.sol";
import {FireGroups} from "../../src/cards/FireGroups.sol";
import {SaleBase} from "../cards/Sale.t.sol";

/// @dev Random drop shapes (1 to 4 groups, random sizes, sequences, delays, durations and leftover targets) and random
///      buys over time. After every step: no group sells past its capacity, the groups' sold add up to the packs
///      minted, what can still sell is what the open and upcoming groups have left, the views agree with what buying
///      does, followers open only after the group before them ends, and the Series is closed the moment nothing can
///      still sell (some groups with a rising tax, an idle timeout or a per-purchase limit). At the end the drop can always be closed or ended.
contract GroupsFuzzTest is SaleBase {
    uint256 internal rnd;

    function _r() internal returns (uint256) {
        rnd = uint256(keccak256(abi.encode(rnd)));
        return rnd;
    }

    function _shape() internal returns (FireSale.DropConfig memory c) {
        uint256 count = 1 + _r() % 4;
        FireGroups.Group[] memory gs = new FireGroups.Group[](count);
        uint32[4] memory times = [uint32(0), 30 minutes, 1 hours, 3 hours];
        for (uint256 i; i < count; i++) {
            FireGroups.Group memory g = _g(uint64(_r() % 7));
            if (i == 0 && g.packs == 0) g.packs = 1;
            if (i > 0 && _r() % 2 == 0) g.afterGroup = uint8(_r() % i);
            if (i + 1 < count && _r() % 3 != 0) g.rollTo = uint8(i + 1 + _r() % (count - i - 1));
            g.startDelay = times[_r() % 4];
            g.duration = times[_r() % 4];
            if (_r() % 3 == 0) g.idle = times[1 + _r() % 3]; // ends after no sale for a while
            if (_r() % 4 == 0) g.perTx = uint32(1 + _r() % 3);
            gs[i] = g;
        }
        for (uint256 i; i < count; i++) {
            bool takesLeftovers;
            for (uint256 j; j < i; j++) if (gs[j].rollTo == i) takesLeftovers = true;
            if (!takesLeftovers && _r() % 3 == 0) gs[i].taxBps = uint16(1 + _r() % 5_000); // a rising tax
            if (!takesLeftovers && i > 0 && gs[i].rollTo == NONE && _r() % 4 == 0) {
                gs[i].unlimited = true; // no pack count: ends once it idles out
                (gs[i].packs, gs[i].taxBps, gs[i].idle) = (0, 400, 30 minutes);
            }
        }
        c = _with(_cfg(start, 0), gs);
        c.regularWalletsFor = 0;
        c.creditGroup = uint8(_r() % (count + 1) == count ? NONE : _r() % count);
        if (c.creditGroup != NONE && gs[c.creditGroup].taxBps != 0) c.creditGroup = NONE; // credits: untaxed groups only
    }

    /// forge-config: default.fuzz.runs = 400
    function testFuzz_groupsSellCloseAndEnd(uint256 seed) public {
        rnd = seed;
        FireSale.DropConfig memory c = _shape();
        _set(1, c);
        _check();
        _open();
        for (uint256 step; step < 30 && !sale.dropOf(1).closed; step++) {
            uint256 what = _r() % 3;
            if (what == 0) {
                _warp(block.timestamp + _r() % 2 hours);
            } else {
                uint256 g = _r() % c.groups.length;
                uint256 open = groups.openLeft(1, g);
                if (open == 0) {
                    vm.prank(alice, alice);
                    vm.expectRevert(); // not open, or nothing left in it
                    sale.buy(1, g, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
                } else {
                    uint256 n = 1 + _r() % (open < 4 ? open : 4);
                    uint32 perTx = groups.groupOf(1, g).perTx;
                    if (perTx != 0 && n > perTx) n = perTx;
                    _plank(_r() % 2 == 0 ? alice : bob, 1, g, n);
                    if (groups.remaining(1) == 0) assertTrue(sale.dropOf(1).closed, "closed with the last pack");
                }
            }
            _check();
        }
        // whatever happened, the drop always ends
        if (!sale.dropOf(1).closed) {
            _warp(sale.status(1).endableAt);
            if (groups.remaining(1) == 0) {
                sale.close(1);
            } else {
                vm.prank(owner, owner);
                sale.endDrop(1);
            }
        }
        assertTrue(_closed(1));
        assertEq(sale.activeDrops(), 0);
    }

    function _check() internal view {
        FireGroups.GroupView[] memory v = groups.groupsOf(1);
        FireSale.Drop memory d = sale.dropOf(1);
        uint256 sold;
        uint256 left;
        bool unlimitedOpen;
        for (uint256 i; i < v.length; i++) {
            FireGroups.GroupView memory x = v[i];
            sold += x.sold;
            assertLe(x.sold, x.capacity, "never past capacity");
            if (x.config.unlimited) {
                if (x.state != FireGroups.State.ENDED) unlimitedOpen = true;
                assertEq(x.left, x.state == FireGroups.State.ENDED ? 0 : type(uint256).max);
            } else {
                assertEq(x.left, x.capacity - x.sold);
            }
            if (x.state == FireGroups.State.ENDED) {
                assertLe(x.endsAt, block.timestamp, "ended in the past");
                assertGe(x.endsAt, x.opensAt, "ended after it opened");
                assertGt(x.opensAt, 0);
            } else {
                if (!x.config.unlimited) left += x.left;
                if (x.state == FireGroups.State.OPEN) {
                    assertLe(x.opensAt, block.timestamp);
                    assertTrue(x.opensAt != 0);
                    if (x.endsAt != 0) assertGt(x.endsAt, block.timestamp, "open until its end");
                    assertEq(groups.openLeft(1, i), x.left);
                } else {
                    assertTrue(x.opensAt == 0 || x.opensAt > block.timestamp, "upcoming");
                    assertEq(groups.openLeft(1, i), 0);
                }
            }
            uint8 a = x.config.afterGroup;
            if (a != NONE && x.state != FireGroups.State.UPCOMING) {
                assertTrue(v[a].state == FireGroups.State.ENDED, "a follower opens after its group ends");
                assertGe(x.opensAt, v[a].endsAt);
            }
        }
        uint256 minted = packs.minted(1);
        assertEq(sold, minted, "groups' sold == packs minted");
        assertEq(minted, uint256(d.sold) + d.creditPacks);
        uint256 rem = unlimitedOpen ? type(uint256).max : left;
        assertEq(groups.remaining(1), rem, "remaining == open and upcoming groups' left");
        uint256 extra;
        for (uint256 i; i < v.length; i++) if (v[i].config.unlimited) extra += v[i].sold;
        assertLe(minted - extra + left, d.packs, "made + can still sell <= the drop's packs (unlimited on top)");
        if (!d.closed) assertEq(sale.status(1).left, rem);
    }
}
