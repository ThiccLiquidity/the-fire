// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FireSale} from "../../src/cards/FireSale.sol";
import {FireGroups} from "../../src/cards/FireGroups.sol";
import {SaleBase} from "./Sale.t.sol";

/// @dev Exposes the rising-tax maths on a stored group.
contract TaxHarness is FireGroups {
    function price(uint128 p, uint16 t, uint256 sold, uint256 n) external returns (uint256, uint256) {
        Group storage G = groups[0][0];
        G.priceUsd = p;
        G.taxBps = t;
        return _price(G, sold, n);
    }
}

/// @dev Drop groups (docs/drop-groups.md): timing, capacity and leftovers, closing, gates, coins, free groups, the
///      config checks, and the views the site reads.
contract GroupsTest is SaleBase {
    event PacksBought(
        uint256 indexed fire, uint256 indexed group, address indexed buyer, uint256 count, FireSale.Pay pay, uint256 paid,
        uint256 burnShare, bool plankBurned
    );
    event DropClosed(uint256 indexed fire, uint256 packs);

    function _state(uint256 fire, uint256 g) internal view returns (FireGroups.State) {
        return _view(fire, g).state;
    }

    /// The Standard preset (docs/drop-groups.md): Press holders 50 (1 PAPER, 1 per press, up to 6h, leftovers to the
    /// Everyone group), PLANK holders 40 (snapshot, $2.50 + 1 PAPER, PLANK only, 5 per wallet, up to 24h, leftovers to
    /// Everyone), Everyone 77 ($2.50 + 1 PAPER, any coin, 5 per wallet for its first 24h then no limit, after group 2, until
    /// sold). Sizes scaled by
    /// `press`, `snap`, `all` so tests can sell them out.
    function _standardDrop(uint64 pressN, uint64 snapN, uint64 allN, bytes32 root) internal {
        FireGroups.Group memory p = _pressGroup(pressN, 1);
        p.duration = 6 hours;
        p.rollTo = 2;
        FireGroups.Group memory s = _snapGroup(snapN, root);
        s.coins = 1;
        s.perWallet = 5;
        s.duration = 24 hours;
        s.rollTo = 2;
        FireGroups.Group memory e = _g(allN);
        e.perWallet = 5;
        e.limitFor = 24 hours;
        e.afterGroup = 1;
        FireSale.DropConfig memory c = _with(_cfg(start, 0), _three(p, s, e));
        _shares(c, 1_000, 2_000);
        c.creditPacksMax = 16;
        c.creditPacksPerWallet = 3;
        c.creditGroup = 2;
        _set(1, c);
    }

    // ---------------------------------------------------------------- timing

    /// One after the other: the next group opens the moment the first sells out.
    function test_sequential_nextOpensTheMomentTheFirstSellsOut() public {
        FireGroups.Group memory a = _g(5);
        a.duration = 6 hours;
        a.rollTo = 1;
        FireGroups.Group memory b = _g(5);
        b.afterGroup = 0;
        _set(1, _with(_cfg(start, 0), _two(a, b)));
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.UPCOMING));
        assertEq(_view(1, 0).opensAt, start);
        assertEq(_view(1, 0).endsAt, start + 6 hours);
        assertEq(_view(1, 1).opensAt, start + 6 hours, "at the latest");
        assertEq(_view(1, 1).endsAt, 0, "until sold");
        _open();
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.OPEN));
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.UPCOMING));
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.GroupNotOpen.selector);
        sale.buy(1, 1, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _warp(start + 1 hours);
        _plank(alice, 1, 0, 5);
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.ENDED));
        assertEq(_view(1, 0).endsAt, start + 1 hours, "ended when its last pack went");
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.OPEN));
        assertEq(_view(1, 1).opensAt, start + 1 hours, "opened at once");
        _plank(bob, 1, 1, 5);
        assertTrue(_closed(1));
    }

    /// One after the other: the next group opens when the first's time runs out (+ its delay), with the leftovers.
    function test_sequential_nextOpensWhenTheTimeRunsOut() public {
        FireGroups.Group memory a = _g(5);
        a.duration = 2 hours;
        a.rollTo = 1;
        FireGroups.Group memory b = _g(5);
        b.afterGroup = 0;
        b.startDelay = 30 minutes;
        b.duration = 1 hours;
        _set(1, _with(_cfg(start, 0), _two(a, b)));
        assertEq(_view(1, 1).opensAt, start + 2.5 hours);
        assertEq(_view(1, 1).endsAt, start + 3.5 hours);
        _open();
        _plank(alice, 1, 0, 2);
        _warp(start + 2 hours);
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.ENDED));
        assertEq(_view(1, 0).endsAt, start + 2 hours);
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.UPCOMING));
        assertEq(_view(1, 1).capacity, 8, "3 rolled in");
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.GroupNotOpen.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _warp(start + 2.5 hours);
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.OPEN));
        _plank(bob, 1, 1, 8);
        assertTrue(_closed(1), "every pack made");
        assertEq(packs.minted(1), 10);
    }

    /// Side by side: groups that open with the drop (one a little later) sell at the same time.
    function test_parallelGroups() public {
        FireGroups.Group memory a = _g(5);
        a.coins = 1;
        FireGroups.Group memory b = _g(5);
        b.coins = 2;
        b.startDelay = 1 hours;
        _set(1, _with(_cfg(start, 0), _two(a, b)));
        _open();
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.UPCOMING));
        _warp(start + 1 hours);
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.OPEN));
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.OPEN));
        _plank(alice, 1, 0, 2);
        _eth(bob, 1, 1, 2);
        _plank(alice, 1, 0, 3);
        assertFalse(_closed(1));
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.ENDED));
        _eth(bob, 1, 1, 3);
        assertTrue(_closed(1));
    }

    /// A group after one that runs until sold opens only when that one sells out; the drop's schedule (endDrop) is
    /// over once every group has opened at the latest.
    function test_afterAnUntilSoldGroup() public {
        FireGroups.Group memory a = _g(5);
        FireGroups.Group memory b = _g(5);
        b.afterGroup = 0;
        b.duration = 2 hours;
        _set(1, _with(_cfg(start, 0), _two(a, b)));
        assertEq(_view(1, 1).opensAt, 0, "when group 0 sells out");
        assertEq(groups.scheduleEnd(1), start + 2 hours);
        _warp(start + 30 days);
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.UPCOMING), "still waiting");
        _plank(alice, 1, 0, 5);
        assertEq(_view(1, 1).opensAt, start + 30 days);
        assertEq(_view(1, 1).endsAt, start + 30 days + 2 hours);
        _plank(alice, 1, 1, 1);
        _warp(start + 30 days + 2 hours);
        assertEq(sale.status(1).left, 0, "group 1's 4 leftovers roll nowhere");
        sale.close(1); // anyone
        assertTrue(_closed(1));
        assertEq(packs.minted(1), 6);
    }

    // ---------------------------------------------------------------- capacity and leftovers

    /// Leftovers of every group that ends add to its target's capacity (two groups into one; a chain).
    function test_leftoversRollAndAddCapacity() public {
        FireGroups.Group memory a = _g(5);
        a.duration = 1 hours;
        a.rollTo = 2;
        FireGroups.Group memory b = _g(4);
        b.duration = 2 hours;
        b.rollTo = 2;
        FireGroups.Group memory c = _g(3);
        c.afterGroup = 1;
        _set(1, _with(_cfg(start, 0), _three(a, b, c)));
        _open();
        _plank(alice, 1, 0, 1);
        _plank(alice, 1, 1, 1);
        _warp(start + 1 hours);
        assertEq(_view(1, 2).capacity, 7, "4 from group 0");
        assertEq(_view(1, 0).left, 4, "an ended group shows what it passed on");
        _warp(start + 2 hours);
        assertEq(_view(1, 2).capacity, 10, "and 3 from group 1");
        assertEq(sale.status(1).left, 10);
        assertEq(groups.openLeft(1, 2), 10);
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.SoldOut.selector);
        sale.buy(1, 2, 11, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _plank(bob, 1, 2, 10);
        assertTrue(_closed(1));
        assertEq(packs.minted(1), 12, "every pack made");
    }

    /// Unsold packs that roll nowhere (255) are never made: the Series closes smaller, when the group's time runs
    /// out (anyone calls close; the keeper does).
    function test_rollToNowhere_seriesClosesSmaller() public {
        FireGroups.Group memory a = _g(5);
        a.duration = 1 hours;
        FireGroups.Group memory b = _g(5);
        _set(1, _with(_cfg(start, 0), _two(a, b)));
        _open();
        _plank(alice, 1, 1, 5); // group 1 sold out; group 0 still has 5 that can sell
        assertFalse(_closed(1));
        _plank(alice, 1, 0, 2);
        assertEq(sale.status(1).left, 3);
        vm.expectRevert(FireSale.NotSoldOut.selector);
        sale.close(1);
        _warp(start + 1 hours);
        assertEq(sale.status(1).left, 0, "3 never made");
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.GroupNotOpen.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        vm.expectEmit(address(sale));
        emit DropClosed(1, 7);
        vm.prank(bob, bob);
        sale.close(1);
        (, bool closed,,, uint64 packCount,) = cards.fires(1);
        assertTrue(closed);
        assertEq(packCount, 7);
        assertEq(sale.activeDrops(), 0);
    }

    /// A group passed by: its time ran out before a group rolling into it ended. Packs that arrive later pass straight
    /// on to where it rolls.
    function test_leftoversPassThroughAnEndedGroup() public {
        FireGroups.Group memory a = _g(5);
        a.duration = 3 hours;
        a.rollTo = 1;
        FireGroups.Group memory b = _g(2);
        b.duration = 1 hours;
        b.rollTo = 2;
        FireGroups.Group memory c = _g(1);
        c.afterGroup = 0;
        _set(1, _with(_cfg(start, 0), _three(a, b, c)));
        _open();
        _warp(start + 1 hours);
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.ENDED));
        assertEq(_view(1, 2).capacity, 3, "group 1's 2");
        _warp(start + 3 hours);
        assertEq(_view(1, 1).capacity, 7, "group 0's 5 reached group 1 after it ended");
        assertEq(_view(1, 2).capacity, 8, "and went on to group 2");
        assertEq(uint8(_state(1, 2)), uint8(FireGroups.State.OPEN));
        _plank(alice, 1, 2, 8);
        assertTrue(_closed(1));
    }

    // ---------------------------------------------------------------- closing: the hype case

    /// The Series closes the instant the last pack that can still be made is minted: here a 1-hour sell-out of every
    /// group (press packs all claimed), with 5 hours of the press group's time unused.
    function test_closesTheInstantTheLastPackGoes() public {
        bytes32 root = _pair(_leaf(alice, 5), _leaf(bob, 5));
        _standardDrop(2, 4, 3, root);
        uint256 p1 = press.mint(carol);
        uint256 p2 = press.mint(carol);
        _open();
        vm.prank(carol, carol);
        sale.buy(1, 0, 2, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1, p2));
        vm.prank(alice, alice);
        sale.buy(1, 1, 4, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(5, _leaf(bob, 5)));
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.ENDED), "the snapshot group sold out");
        assertEq(uint8(_state(1, 2)), uint8(FireGroups.State.OPEN), "Everyone opened at once");
        _warp(start + 1 hours);
        _eth(bob, 1, 2, 3);
        assertTrue(_closed(1), "closed in the first hour");
        assertEq(packs.minted(1), 9);
    }

    /// The hype case: the press group is partly claimed and Everyone sells out in the first hour. The Series stays
    /// open: the press group can still sell its packs, and whatever it hasn't sold when its 6 hours run out rolls
    /// into Everyone, which reopens and sells them. The Series closes when the last of those goes.
    function test_hypeCase_pressLeftoversStillSell() public {
        bytes32 root = _pair(_leaf(alice, 5), _leaf(bob, 5));
        _standardDrop(4, 2, 3, root);
        uint256 p1 = press.mint(carol);
        _open();
        vm.prank(carol, carol);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1)); // 1 of 4 press packs
        vm.prank(alice, alice);
        sale.buy(1, 1, 2, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(5, _leaf(bob, 5)));
        _warp(start + 1 hours);
        _eth(bob, 1, 2, 3); // Everyone sells out
        assertFalse(_closed(1), "3 press packs can still be made");
        assertEq(sale.status(1).left, 3);
        assertEq(uint8(_state(1, 2)), uint8(FireGroups.State.OPEN), "Everyone waits for the press leftovers");
        assertEq(groups.openLeft(1, 2), 0);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.SoldOut.selector);
        sale.buy(1, 2, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _warp(start + 6 hours); // the press group's time is up: its 3 roll into Everyone
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.ENDED));
        assertEq(_view(1, 2).capacity, 6);
        assertEq(groups.openLeft(1, 2), 3);
        _plank(alice, 1, 2, 3);
        assertTrue(_closed(1), "closed with the last rolled pack");
        assertEq(packs.minted(1), 9, "every pack made");
        assertEq(_view(1, 2).endsAt, start + 6 hours);
    }

    /// The hype case where the press holders claim the rest before their time is up: the Series closes then.
    function test_hypeCase_pressFinishesFirst() public {
        _standardDrop(2, 2, 3, _pair(_leaf(alice, 5), _leaf(bob, 5)));
        uint256 p1 = press.mint(carol);
        uint256 p2 = press.mint(bob);
        _open();
        vm.prank(alice, alice);
        sale.buy(1, 1, 2, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(5, _leaf(bob, 5)));
        _eth(alice, 1, 2, 3); // Everyone sells out
        vm.prank(carol, carol);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1));
        assertFalse(_closed(1));
        _warp(start + 2 hours);
        vm.prank(bob, bob);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p2));
        assertTrue(_closed(1), "the last press pack closed it, 2 hours in");
        assertEq(_view(1, 2).endsAt, start + 2 hours, "Everyone ended with nothing more to come");
    }

    /// A sold-out group waiting on leftovers holds back the group after it until nothing more can arrive.
    function test_soldOutGroupWaitingOnLeftoversHoldsItsFollower() public {
        FireGroups.Group memory a = _g(3);
        a.duration = 2 hours;
        a.rollTo = 1;
        FireGroups.Group memory b = _g(2);
        FireGroups.Group memory c = _g(2);
        c.afterGroup = 1;
        _set(1, _with(_cfg(start, 0), _three(a, b, c)));
        _open();
        _plank(alice, 1, 1, 2);
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.OPEN), "more may roll in");
        assertEq(uint8(_state(1, 2)), uint8(FireGroups.State.UPCOMING));
        _plank(alice, 1, 0, 3); // group 0 sells out: nothing more for group 1
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.ENDED));
        assertEq(uint8(_state(1, 2)), uint8(FireGroups.State.OPEN));
        _plank(alice, 1, 2, 2);
        assertTrue(_closed(1));
    }

    // ---------------------------------------------------------------- gates

    /// NFT gate: `perNft` packs per NFT id per drop, live ownership, ids spent whoever holds them later.
    function test_nftGate_perIdAllowance() public {
        FireGroups.Group memory g = _pressGroup(10, 2);
        _set(1, _with(_cfg(start, 0), _two(g, _g(5))));
        uint256 p1 = press.mint(alice);
        uint256 p2 = press.mint(alice);
        uint256 p3 = press.mint(bob);
        _open();
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.NotAllowed.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _na()); // no NFT named
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.NotAllowed.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1)); // not bob's
        vm.prank(alice, alice);
        sale.buy(1, 0, 3, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1, p2)); // 2 + 1
        assertEq(groups.usedWith(1, 0, p1), 2);
        assertEq(groups.usedWith(1, 0, p2), 1);
        assertEq(packs.balanceOf(alice, 1), 3);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.NftUsed.selector);
        sale.buy(1, 0, 2, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1, p2)); // only 1 left on them
        // passing the press on doesn't buy again
        vm.prank(alice, alice);
        press.transferFrom(alice, bob, p1);
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.NftUsed.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1));
        vm.prank(bob, bob);
        sale.buy(1, 0, 2, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1, p3)); // p1 skipped, p3 used
        assertEq(groups.usedWith(1, 0, p3), 2);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.NotAllowed.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1, p2)); // p1 isn't hers any more
        assertEq(groups.boughtBy(1, alice)[0], 3);
        assertEq(groups.boughtBy(1, bob)[0], 2);
    }

    /// NFT gate on top of a wallet limit; a group's own allowance per id is per group.
    function test_nftGate_withWalletLimit() public {
        FireGroups.Group memory g = _pressGroup(10, 3);
        g.perWallet = 2;
        _set(1, _with(_cfg(start, 0), _two(g, _g(5))));
        uint256 p1 = press.mint(alice);
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 0, 3, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1));
        vm.prank(alice, alice);
        sale.buy(1, 0, 2, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1));
        vm.prank(alice, alice);
        press.transferFrom(alice, bob, p1);
        vm.prank(bob, bob);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1)); // the press's third pack
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.NftUsed.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1));
    }

    /// An NFT whose ownerOf reverts (burned, or not an ERC-721) lets nobody in.
    function test_nftGate_burnedNft() public {
        _set(1, _with(_cfg(start, 0), _two(_pressGroup(5, 1), _g(5))));
        uint256 p1 = press.mint(alice);
        _open();
        vm.prank(alice, alice);
        press.burn{value: 0.0003 ether}(p1);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.NotAllowed.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(p1));
    }

    /// Snapshot gate: each leaf carries the wallet's own allowance (tiers); perWallet still caps it.
    function test_snapshotGate_perLeafAllowanceAndWalletCap() public {
        bytes32 la = _leaf(alice, 2);
        bytes32 lb = _leaf(bob, 5);
        FireGroups.Group memory g = _snapGroup(20, _pair(la, lb));
        g.perWallet = 3;
        _set(1, _with(_cfg(start, 0), _two(g, _g(5))));
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.NotAllowed.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(5, lb)); // claims 5: no
        vm.prank(alice, alice);
        sale.buy(1, 0, 2, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(2, lb));
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(2, lb)); // her 2 used
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 0, 4, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(5, la)); // perWallet 3
        vm.prank(bob, bob);
        sale.buy(1, 0, 3, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(5, la));
        vm.prank(carol, carol);
        vm.expectRevert(FireGroups.NotAllowed.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(5, la)); // not in it
        vm.prank(carol, carol);
        vm.expectRevert(FireGroups.NotAllowed.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _plank(carol, 1, 1, 1); // the open group takes anyone
        assertEq(groups.boughtIn(1, 0, bob), 3);
    }

    /// The leaf is the OpenZeppelin StandardMerkleTree leaf of ["address","uint256"]: keccak(keccak(abi.encode(...))).
    function test_snapshotGate_leafEncoding() public {
        bytes32 leaf = _leaf(alice, 7);
        assertEq(leaf, keccak256(bytes.concat(keccak256(abi.encode(alice, uint256(7))))));
        _set(1, _with(_cfg(start, 0), _two(_snapGroup(10, leaf), _g(5)))); // a one-leaf tree: the root is the leaf
        _open();
        FireGroups.Access memory a;
        a.allowance = 7;
        a.proof = new bytes32[](0);
        vm.prank(alice, alice);
        sale.buy(1, 0, 7, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, a);
        assertEq(packs.balanceOf(alice, 1), 7);
    }

    // ---------------------------------------------------------------- coins, free and PAPER-only groups

    function test_coinsMask() public {
        FireGroups.Group memory a = _g(10);
        a.coins = 1 | 4; // PLANK and USDG
        _set(1, _with(_cfg(start, 0), _two(a, _g(5))));
        _open();
        uint256 cost = _cost(1, 0, 1, FireSale.Pay.ETH);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.CoinNotAccepted.selector);
        sale.buy{value: cost}(1, 0, 1, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        _plank(alice, 1, 0, 1);
        _usdg(alice, 1, 0, 1);
        _eth(alice, 1, 1, 1); // the other group takes ETH
        assertEq(packs.balanceOf(alice, 1), 3);
    }

    /// A free group (no price, no PAPER): holders' claims. Nothing is paid; ETH sent comes back.
    function test_freeGroup() public {
        FireGroups.Group memory g = _pressGroup(5, 1);
        g.paper = 0;
        _set(1, _with(_cfg(start, 0), _two(g, _g(5))));
        uint256 p1 = press.mint(alice);
        _open();
        uint256 eth = alice.balance;
        vm.expectEmit(address(sale));
        emit PacksBought(1, 0, alice, 1, FireSale.Pay.ETH, 0, 0, false);
        vm.prank(alice, alice);
        sale.buy{value: 1 ether}(1, 0, 1, FireSale.Pay.ETH, 0, 0, _nfts(p1));
        assertEq(packs.balanceOf(alice, 1), 1);
        assertEq(alice.balance, eth, "ETH back");
        assertEq(paper.balanceOf(DEAD), 0);
        assertEq(revenue.balance, 0);
        _assertHoldsNothing();
    }

    /// A PAPER-only group: only its PAPER is burned (capped like any pack), whatever coin is named.
    function test_paperOnlyGroup() public {
        FireGroups.Group memory g = _pressGroup(5, 3);
        g.paper = 2e18;
        _set(1, _with(_cfg(start, 0), _two(g, _g(5))));
        uint256 p1 = press.mint(alice);
        _open();
        (uint256 cost, uint256 pp) = sale.quote(1, 0, 3, FireSale.Pay.USDG);
        assertEq(cost, 0);
        assertEq(pp, 6e18);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.buy(1, 0, 3, FireSale.Pay.USDG, 0, 6e18 - 1, _nfts(p1));
        vm.prank(alice, alice);
        sale.buy(1, 0, 3, FireSale.Pay.USDG, 0, 6e18, _nfts(p1));
        assertEq(paper.balanceOf(DEAD), 6e18);
        assertEq(usdg.balanceOf(revenue), 0);
        _assertHoldsNothing();
    }

    /// A group can have its own dollar price: a cheaper holders' price.
    function test_groupsHaveTheirOwnPrices() public {
        FireGroups.Group memory a = _g(5);
        a.priceUsd = 100_000_000; // $1
        a.paper = 0;
        _set(1, _with(_cfg(start, 0), _two(a, _g(5))));
        _open();
        (uint256 c0,) = sale.quote(1, 0, 1, FireSale.Pay.USDG);
        (uint256 c1, uint256 p1) = sale.quote(1, 1, 1, FireSale.Pay.USDG);
        assertEq(c0, 1e6);
        assertEq(c1, 2.5e6);
        assertEq(p1, 1e18);
        vm.expectEmit(address(sale));
        emit PacksBought(1, 0, alice, 2, FireSale.Pay.USDG, 2e6, 2e6 * 3_000 / 10_000, true);
        _usdg(alice, 1, 0, 2);
    }

    // ---------------------------------------------------------------- the config checks

    function _bad(FireSale.DropConfig memory c, bytes memory err) internal {
        vm.prank(owner, owner);
        vm.expectRevert(err);
        sale.configureDrop(1, c);
    }

    function _badGroup(FireGroups.Group[] memory gs, uint256 i) internal {
        _bad(_with(_cfg(start, 0), gs), abi.encodeWithSelector(FireGroups.BadGroup.selector, i));
    }

    function test_validation_dropWide() public {
        bytes memory bad = abi.encodeWithSelector(FireGroups.BadConfig.selector);
        FireSale.DropConfig memory c = _cfg(start, 10);
        c.packs = 11;
        _bad(c, bad); // the groups' packs don't add up to the total
        c = _cfg(start, 0);
        c.groups[0].priceUsd = PRICE;
        _bad(c, bad); // no packs at all
        c = _cfg(start, 10);
        c.groups = new FireGroups.Group[](0);
        _bad(c, bad); // no groups
        FireGroups.Group[] memory seven = new FireGroups.Group[](7);
        for (uint256 i; i < 7; i++) seven[i] = _g(1);
        _bad(_with(_cfg(start, 0), seven), bad); // more than 6
        FireGroups.Group[] memory six = new FireGroups.Group[](6);
        for (uint256 i; i < 6; i++) six[i] = _g(1);
        _set(1, _with(_cfg(start, 0), six)); // 6 is fine
        c = _cfg(start, 10);
        c.creditGroup = 1;
        _bad(c, bad); // the credit group isn't a group
        c.creditGroup = NONE;
        _set(1, c); // 255 = no credit packs
    }

    /// Free (credit) packs come from a fixed, untaxed group: never a taxed one (it would raise later buyers' price)
    /// nor an unlimited one (it would mint on top of the total and keep the Series open).
    function test_validation_creditGroupNotTaxedOrUnlimited() public {
        bytes memory bad = abi.encodeWithSelector(FireGroups.BadConfig.selector);
        FireGroups.Group memory a = _g(5);
        FireGroups.Group memory o = _g(10);
        o.taxBps = 400;
        o.afterGroup = 0;
        o.duration = 12 hours;
        FireSale.DropConfig memory c = _with(_cfg(start, 0), _two(a, o));
        c.creditGroup = 1;
        _bad(c, bad); // taxed
        FireGroups.Group memory u = _g(0);
        u.unlimited = true;
        u.priceUsd = PRICE;
        u.taxBps = 400;
        u.idle = 15 minutes;
        u.afterGroup = 0;
        c = _with(_cfg(start, 0), _two(a, u));
        c.creditGroup = 1;
        _bad(c, bad); // unlimited
        c.creditGroup = 0;
        _set(1, c); // the fixed, untaxed group is fine
    }

    function test_validation_indicesAndCycles() public {
        FireGroups.Group memory a = _g(5);
        FireGroups.Group memory b = _g(5);
        b.afterGroup = 1; // itself
        _badGroup(_two(a, b), 1);
        b.afterGroup = 2; // later / missing
        _badGroup(_two(a, b), 1);
        b.afterGroup = NONE;
        a.afterGroup = 1; // a later group: would be a cycle
        _badGroup(_two(a, b), 0);
        a.afterGroup = NONE;
        b.rollTo = 0; // back to an earlier group: could cycle
        _badGroup(_two(a, b), 1);
        b.rollTo = 1; // itself
        _badGroup(_two(a, b), 1);
        b.rollTo = NONE;
        a.rollTo = 2; // past the last group
        _badGroup(_two(a, b), 0);
        a.rollTo = 1;
        b.afterGroup = 0;
        _set(1, _with(_cfg(start, 0), _two(a, b))); // fine
    }

    function test_validation_timesBounded() public {
        FireGroups.Group memory a = _g(5);
        a.duration = 30 days + 1;
        _badGroup(_two(a, _g(5)), 0);
        a.duration = 30 days;
        a.startDelay = 30 days + 1;
        _badGroup(_two(a, _g(5)), 0);
        a.startDelay = 30 days;
        _set(1, _with(_cfg(start, 0), _two(a, _g(5))));
    }

    function test_validation_pricesAndCoins() public {
        FireGroups.Group memory a = _g(5);
        a.coins = 0; // a price with no coin
        _badGroup(_two(_g(5), a), 1);
        a.coins = 8; // no such coin
        _badGroup(_two(_g(5), a), 1);
        a = _g(5);
        a.priceUsd = 0;
        a.paper = 0; // free packs open to everyone
        _badGroup(_two(_g(5), a), 1);
        a.paper = 1; // PAPER only, open to everyone: fine
        a.coins = 0;
        _set(1, _with(_cfg(start, 0), _two(_g(5), a)));
    }

    function test_validation_gates() public {
        FireGroups.Group memory n = _pressGroup(5, 1);
        n.nft = address(0x1234); // no code
        _badGroup(_two(n, _g(5)), 0);
        n = _pressGroup(5, 0); // no allowance per NFT
        _badGroup(_two(n, _g(5)), 0);
        n = _pressGroup(5, 1);
        n.root = bytes32(uint256(1)); // a root on an NFT group
        _badGroup(_two(n, _g(5)), 0);
        FireGroups.Group memory s = _snapGroup(5, 0); // no root
        _badGroup(_two(s, _g(5)), 0);
        s = _snapGroup(5, bytes32(uint256(1)));
        s.nft = address(press);
        _badGroup(_two(s, _g(5)), 0);
        s = _snapGroup(5, bytes32(uint256(1)));
        s.perNft = 1;
        _badGroup(_two(s, _g(5)), 0);
        FireGroups.Group memory o = _g(5);
        o.nft = address(press); // stray gate data on an open group
        _badGroup(_two(o, _g(5)), 0);
        o = _g(5);
        o.root = bytes32(uint256(1));
        _badGroup(_two(o, _g(5)), 0);
        o = _g(5);
        o.perNft = 1;
        _badGroup(_two(o, _g(5)), 0);
        // a gate number that doesn't exist doesn't decode
        FireSale.DropConfig memory c = _cfg(start, 5);
        bytes memory data = abi.encodeCall(FireSale.configureDrop, (1, c));
        // the gate is the 2nd word of the first group; find it by its value 0 after the packs (5)
        bytes memory bad = _setGate(data, 3);
        vm.prank(owner, owner);
        (bool ok,) = address(sale).call(bad);
        assertFalse(ok, "gate 3 refused");
    }

    /// Replaces the first group's gate (the word after its packs, 5) in configureDrop calldata.
    function _setGate(bytes memory data, uint8 gate) internal pure returns (bytes memory) {
        for (uint256 i = 4; i + 64 <= data.length; i += 32) {
            uint256 w;
            uint256 next;
            assembly {
                w := mload(add(add(data, 32), i))
                next := mload(add(add(data, 32), add(i, 32)))
            }
            if (w == 5 && next == 0) {
                // the group's packs; the drop's packs (also 5) is followed by paperCapUsd (1e8), not 0
                assembly { mstore(add(add(data, 32), add(i, 32)), gate) }
                return data;
            }
        }
        revert("gate word not found");
    }

    /// Before the drop opens it can be set again with fewer groups; what the old config had is gone from the views.
    function test_reconfigureWithFewerGroups() public {
        _set(1, _with(_cfg(start, 0), _three(_g(1), _g(2), _g(3))));
        assertEq(groups.groupCount(1), 3);
        _drop(1, start, 4);
        assertEq(groups.groupCount(1), 1);
        assertEq(groups.groupsOf(1).length, 1);
        vm.expectRevert(abi.encodeWithSelector(FireGroups.BadGroup.selector, 1));
        groups.groupOf(1, 1);
        assertEq(groups.scheduleEnd(1), start);
        _open();
        _plank(alice, 1, 0, 4);
        assertTrue(_closed(1));
    }

    // ---------------------------------------------------------------- views

    function test_views() public {
        bytes32 root = _pair(_leaf(alice, 5), _leaf(bob, 5));
        _standardDrop(50, 40, 77, root);
        FireSale.Status memory st = sale.status(1);
        assertTrue(st.configured);
        assertFalse(st.live);
        assertEq(st.left, 167);
        assertEq(st.endableAt, start + 24 hours);
        assertEq(st.creditPacksLeft, 0);
        FireGroups.GroupView[] memory v = groups.groupsOf(1);
        assertEq(uint8(v[0].state), uint8(FireGroups.State.UPCOMING));
        assertEq(v[0].opensAt, start);
        assertEq(v[0].endsAt, start + 6 hours);
        assertEq(v[1].endsAt, start + 24 hours);
        assertEq(v[2].opensAt, start + 24 hours);
        assertEq(v[2].endsAt, 0);
        _open();
        vm.prank(alice, alice);
        sale.buy(1, 1, 5, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(5, _leaf(bob, 5)));
        uint256[] memory mine = groups.boughtBy(1, alice);
        assertEq(mine.length, 3);
        assertEq(mine[1], 5);
        st = sale.status(1);
        assertTrue(st.live);
        assertEq(st.left, 162);
        assertEq(groups.remaining(1), 162);
        assertEq(groups.openLeft(1, 1), 35);
        assertEq(groups.openLeft(1, 2), 0, "not open yet");
        _warp(start + 6 hours);
        v = groups.groupsOf(1);
        assertEq(uint8(v[0].state), uint8(FireGroups.State.ENDED));
        assertEq(v[2].capacity, 127, "the 50 press packs rolled in");
        assertEq(v[0].left, 50, "what it passed on");
        _warp(start + 24 hours);
        st = sale.status(1);
        assertEq(st.creditPacksLeft, 16, "the credit cap");
        assertEq(groups.openLeft(1, 2), 162);
        assertEq(uint8(groups.groupsOf(1)[2].state), uint8(FireGroups.State.OPEN));
    }

    /// The Standard preset end to end: press claims, the snapshot group, Everyone after it, credits from Everyone.
    function test_standardPreset() public {
        bytes32 root = _pair(_leaf(alice, 5), _leaf(bob, 5));
        _standardDrop(50, 40, 77, root);
        uint256 p1 = press.mint(carol);
        _open();
        vm.prank(carol, carol);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, 1e18, _nfts(p1));
        vm.prank(carol, carol);
        vm.expectRevert(FireGroups.NftUsed.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, 1e18, _nfts(p1)); // 1 per press
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.CoinNotAccepted.selector);
        sale.buy{value: 1 ether}(1, 1, 1, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _proof(5, _leaf(bob, 5)));
        uint256 cost = _cost(1, 1, 5, FireSale.Pay.PLANK);
        vm.prank(alice, alice);
        sale.buy(1, 1, 5, FireSale.Pay.PLANK, cost, 5e18, _proof(5, _leaf(bob, 5)));
        assertEq(plank.balanceOf(DEAD), cost / 10, "10% PLANK burned");
        assertEq(plank.balanceOf(paperW), cost / 5, "20% to PaperBurner");
        assertEq(plank.balanceOf(revenue), cost - cost / 10 - cost / 5, "70% revenue");
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.GroupNotOpen.selector);
        sale.buy(1, 2, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _warp(start + 24 hours);
        assertEq(groups.openLeft(1, 2), 77 + 49 + 35);
        _eth(bob, 1, 2, 5);
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 2, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        assertEq(sale.status(1).left, 167 - 11);
        _warp(start + 48 hours); // Everyone's limit lifts 24h after it opened
        _eth(bob, 1, 2, 10);
        assertEq(groups.boughtIn(1, 2, bob), 15);
        _assertHoldsNothing();
    }

    // ---------------------------------------------------------------- the rising tax

    /// Packs k = sold+1 .. sold+n at P * (1 + t/10000)^k, summed pack by pack at 27 decimals.
    function _ref(uint256 p, uint256 t, uint256 sold, uint256 n) internal pure returns (uint256 sum) {
        uint256 f = 1e27;
        for (uint256 k = 1; k <= sold + n; k++) {
            f = f * (10_000 + t) / 10_000;
            if (k > sold) sum += p * f / 1e27;
        }
    }

    /// An "after sell-out" group: opens when group 0 sells out, `n` packs at $2.50 rising `t` bps a pack, ETH only,
    /// 12 hours, unsold packs never made.
    function _taxDrop(uint64 first, uint64 n, uint16 t, uint8 coins) internal {
        FireGroups.Group memory a = _g(first);
        FireGroups.Group memory o = _g(n);
        o.taxBps = t;
        o.coins = coins;
        o.afterGroup = 0;
        o.duration = 12 hours;
        FireSale.DropConfig memory c = _with(_cfg(start, 0), _two(a, o));
        _shares(c, 1_000, 2_000);
        _set(1, c);
    }

    function test_tax_pricesMatchTheReference() public {
        _taxDrop(1, 20, 400, 7);
        _open();
        _plank(alice, 1, 0, 1); // group 0 sells out: the taxed group opens
        uint256[3] memory buys = [uint256(1), 3, 5];
        uint256 sold;
        for (uint256 i; i < 3; i++) {
            uint256 n = buys[i];
            (uint256 usd8, uint256 tax8) = groups.priceOf(1, 1, n);
            uint256 ref = _ref(PRICE, 400, sold, n);
            // the reference rounds each pack down to 1e-8 dollars; the closed form rounds the total up
            assertGe(usd8, ref, "never under the pack-by-pack price");
            assertLe(usd8, ref + n + 1, "within a 1e-8 dollar per pack of it");
            assertEq(tax8, usd8 - n * PRICE, "the tax is what's above the base price");
            (uint256 cost,) = sale.quote(1, 1, n, FireSale.Pay.USDG);
            assertEq(cost, (usd8 * 1e6 + 1e8 - 1) / 1e8, "the quote includes the tax");
            sold += n;
            _usdg(bob, 1, 1, n);
        }
        // 9 sold so far
        (uint256 next,) = groups.priceOf(1, 1, 1);
        assertApproxEqAbs(next, PRICE * 104 ** 10 / 100 ** 10, 2); // the 10th taxed pack: $2.50 * 1.04^10
    }

    /// The base price splits as any sale (70% revenue, 10% PLANK burn, 20% PaperBurner); the whole tax goes to
    /// PaperBurner, in the coin paid.
    function test_tax_allToPaperBurner() public {
        _taxDrop(1, 20, 400, 7);
        _open();
        _plank(alice, 1, 0, 1);
        (uint256 usd8, uint256 tax8) = groups.priceOf(1, 1, 4);
        uint256 cost = _cost(1, 1, 4, FireSale.Pay.USDG);
        uint256 tax = cost * tax8 / usd8;
        uint256 base = cost - tax;
        assertApproxEqAbs(base, 4 * 2.5e6, 1, "the base is 4 x $2.50");
        _usdg(bob, 1, 1, 4);
        assertEq(usdg.balanceOf(paperW), base * 2_000 / 10_000 + tax, "20% of the base + all the tax");
        assertEq(usdg.balanceOf(address(router)), base * 1_000 / 10_000, "10% of the base burns PLANK");
        assertEq(usdg.balanceOf(revenue), base - base * 1_000 / 10_000 - base * 2_000 / 10_000, "70% of the base");
        // in ETH too
        uint256 ethCost = _cost(1, 1, 2, FireSale.Pay.ETH);
        (usd8, tax8) = groups.priceOf(1, 1, 2);
        uint256 ethTax = ethCost * tax8 / usd8;
        _eth(carol, 1, 1, 2);
        assertEq(paperW.balance, (ethCost - ethTax) * 2_000 / 10_000 + ethTax);
        assertEq(revenue.balance, (ethCost - ethTax) - (ethCost - ethTax) * 1_000 / 10_000 - (ethCost - ethTax) * 2_000 / 10_000);
        // and the most the buyer named still guards it
        uint256 c = _cost(1, 1, 1, FireSale.Pay.USDG);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.buy(1, 1, 1, FireSale.Pay.USDG, c - 1, type(uint256).max, _na());
        _assertHoldsNothing();
    }

    /// The overflow group opens the moment the main group sells out and keeps the Series open until its packs sell or
    /// its 12 hours run out; unsold extras are never made and the Series then closes (anyone calls close).
    function test_tax_overflowGroupAfterSellOut() public {
        _taxDrop(3, 5, 400, 2); // ETH only
        _open();
        assertEq(_view(1, 1).opensAt, 0, "when group 0 sells out");
        _warp(start + 2 hours);
        _plank(alice, 1, 0, 3);
        assertFalse(_closed(1), "5 more can still be made");
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.OPEN));
        assertEq(_view(1, 1).opensAt, start + 2 hours, "opened at once");
        assertEq(_view(1, 1).endsAt, start + 14 hours);
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.CoinNotAccepted.selector);
        sale.buy(1, 1, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _eth(bob, 1, 1, 2);
        _warp(start + 14 hours);
        assertEq(sale.status(1).left, 0, "3 extras never made");
        sale.close(1);
        assertTrue(_closed(1));
        assertEq(packs.minted(1), 5);
    }

    /// Sold out: the overflow group's last pack closes the Series.
    function test_tax_overflowGroupSellsOut() public {
        _taxDrop(1, 2, 400, 7);
        _open();
        _plank(alice, 1, 0, 1);
        _eth(bob, 1, 1, 2);
        assertTrue(_closed(1));
    }

    function test_tax_bounds() public {
        FireGroups.Group memory o = _g(10);
        o.taxBps = 5_001; // over 50% a pack
        _badGroup(_two(_g(5), o), 1);
        o.taxBps = 400;
        o.priceUsd = 0; // a tax on nothing
        o.coins = 0;
        _badGroup(_two(_g(5), o), 1);
        o = _g(600); // 1.04^600 = 1.6e10: past the 1e9 growth bound
        o.taxBps = 400;
        _badGroup(_two(_g(5), o), 1);
        o.packs = 500; // 1.04^500 = 3.3e8
        _set(1, _with(_cfg(start, 0), _two(_g(5), o)));
        o = _g(type(uint64).max); // huge: refused without overflowing
        o.taxBps = 1;
        _badGroup(_two(_g(5), o), 1);
        FireGroups.Group memory a = _g(5);
        a.duration = 1 hours;
        a.rollTo = 1; // leftovers into a taxed group: its packs are fixed
        o = _g(5);
        o.taxBps = 400;
        _badGroup(_two(a, o), 0);
    }

    /// The closed form agrees with pack-by-pack pricing for any tax, start and count.
    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_taxMatchesReference(uint128 p, uint16 t, uint256 sold, uint256 n) public {
        p = uint128(bound(p, 1, 1e12));
        t = uint16(bound(t, 1, 5_000));
        sold = bound(sold, 0, 20);
        n = bound(n, 1, 20);
        TaxHarness h = new TaxHarness();
        (uint256 usd8, uint256 tax8) = h.price(p, t, sold, n);
        uint256 ref = _ref(p, t, sold, n);
        uint256 slack = n + 1 + ref / 1e15; // the reference's per-pack rounding, and 18-decimal fixed point
        assertApproxEqAbs(usd8, ref, slack);
        assertEq(usd8, n * p + tax8);
    }

    // ---------------------------------------------------------------- idle and perTx

    /// A group with `idle` ends once nothing has sold in it for that long (from opening, then from each sale): its
    /// leftovers roll on and the group after it opens right then.
    function test_idle_endsAfterNoSalesAndResets() public {
        FireGroups.Group memory a = _g(10);
        a.idle = 1 hours;
        a.rollTo = 1;
        FireGroups.Group memory b = _g(5);
        b.afterGroup = 0;
        _set(1, _with(_cfg(start, 0), _two(a, b)));
        _open();
        assertEq(_view(1, 0).endsAt, start + 1 hours, "an hour from opening if nothing sells");
        _warp(start + 50 minutes);
        _plank(alice, 1, 0, 2); // resets the clock
        assertEq(_view(1, 0).endsAt, start + 110 minutes);
        assertEq(_view(1, 1).opensAt, start + 110 minutes, "the next group, at the latest");
        _warp(start + 109 minutes);
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.OPEN), "still open an hour after opening");
        _plank(alice, 1, 0, 1); // and again
        _warp(start + 169 minutes);
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.ENDED), "an hour without a sale");
        assertEq(_view(1, 0).endsAt, start + 169 minutes);
        assertEq(_view(1, 1).capacity, 12, "its 7 left rolled on");
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.OPEN), "the next group opened then");
        assertEq(_view(1, 1).opensAt, start + 169 minutes);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.GroupNotOpen.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _plank(bob, 1, 1, 12);
        assertTrue(_closed(1));
    }

    /// With no sale at all it ends `idle` after opening; with a duration too, whichever comes first.
    function test_idle_withoutSalesAndWithADuration() public {
        FireGroups.Group memory a = _g(10);
        a.idle = 2 hours;
        a.duration = 3 hours;
        a.rollTo = 1;
        _set(1, _with(_cfg(start, 0), _two(a, _g(5))));
        assertEq(groups.scheduleEnd(1), start + 3 hours, "idle only ends a group sooner: the latest is its duration");
        _open();
        _warp(start + 2 hours);
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.ENDED));
        assertEq(_view(1, 0).endsAt, start + 2 hours);
        assertEq(_view(1, 1).capacity, 15);
    }

    function test_idle_durationStillCaps() public {
        FireGroups.Group memory a = _g(10);
        a.idle = 2 hours;
        a.duration = 3 hours;
        _set(1, _with(_cfg(start, 0), _two(a, _g(5))));
        _open();
        _warp(start + 2 hours - 1);
        _plank(alice, 1, 0, 1); // the idle clock would run to 4h; the duration ends it at 3h
        assertEq(_view(1, 0).endsAt, start + 3 hours);
        _warp(start + 3 hours);
        assertEq(uint8(_state(1, 0)), uint8(FireGroups.State.ENDED));
    }

    /// The Standard overflow group: one pack per purchase, and the Series closes 15 minutes after the last extra sold
    /// (unsold extras are never made; anyone calls close).
    function test_idle_overflowSeriesClosesAfterTheLastExtraSale() public {
        FireGroups.Group memory a = _g(2);
        FireGroups.Group memory o = _g(50);
        o.taxBps = 400;
        o.coins = 2;
        o.perWallet = 5;
        o.afterGroup = 0;
        o.duration = 12 hours;
        o.idle = 15 minutes;
        o.perTx = 1;
        _set(1, _with(_cfg(start, 0), _two(a, o)));
        _open();
        _warp(start + 1 hours);
        _plank(alice, 1, 0, 2); // the main group sells out: the extras open
        assertEq(_view(1, 1).endsAt, start + 75 minutes, "15 minutes to the first extra sale");
        uint256 cost = _cost(1, 1, 2, FireSale.Pay.ETH);
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.PerTxLimit.selector);
        sale.buy{value: cost}(1, 1, 2, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        _warp(start + 70 minutes);
        _eth(bob, 1, 1, 1);
        _warp(start + 84 minutes);
        _eth(carol, 1, 1, 1);
        _warp(start + 99 minutes - 1);
        assertEq(sale.status(1).left, 48, "still open");
        _warp(start + 99 minutes);
        assertEq(sale.status(1).left, 0, "15 minutes since the last extra: done");
        vm.prank(alice, alice);
        sale.close(1); // anyone
        assertTrue(_closed(1));
        assertEq(packs.minted(1), 4, "the 48 unsold extras are never made");
    }

    /// perTx 0 falls back to the drop's maxPerTx; credits ignore a group's perTx.
    function test_perTx() public {
        FireGroups.Group memory a = _g(20);
        a.perTx = 2;
        FireSale.DropConfig memory c = _with(_cfg(start, 0), _two(a, _g(20)));
        c.maxPerTx = 3;
        _set(1, c);
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.PerTxLimit.selector);
        sale.buy(1, 0, 3, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _plank(alice, 1, 0, 2);
        _plank(alice, 1, 0, 2); // per purchase, not per wallet
        _plank(alice, 1, 1, 3); // perTx 0: the drop's maxPerTx
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.BadAmount.selector);
        sale.buy(1, 1, 4, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
    }

    function test_perTx_creditsIgnoreIt() public {
        FireGroups.Group memory a = _g(20);
        a.perTx = 1;
        _aliceGetsCards(14); // closes fire 1
        vm.prank(alice, alice);
        credits.burnCards(_ids(1, 84)); // 2 credits
        uint64 s2 = uint64(block.timestamp + 1 hours);
        FireSale.DropConfig memory c = _with(_cfg(s2, 0), _two(a, _g(5)));
        _set(2, c);
        _warp(s2);
        vm.prank(alice, alice);
        credits.useCredits(2, 2, type(uint256).max);
        assertEq(packs.balanceOf(alice, 2), 2);
    }

    // ---------------------------------------------------------------- the per-wallet limit lifting on a timer

    /// 5 per wallet for the first 24 hours after the group opens; from that second on, as many as a wallet likes
    /// (perTx and maxPerTx still apply).
    function test_limitFor_enforcedThenLifted() public {
        FireGroups.Group memory a = _g(100);
        a.perWallet = 5;
        a.limitFor = 24 hours;
        a.perTx = 20;
        FireGroups.Group memory b = _g(100); // limitFor 0: the limit holds for good
        b.perWallet = 5;
        _set(1, _with(_cfg(start, 0), _two(a, b)));
        _open();
        _plank(alice, 1, 0, 5);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _warp(start + 24 hours - 1); // the last second of the limit
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _plank(bob, 1, 0, 5); // a fresh wallet still gets its 5
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _warp(start + 24 hours); // lifted, to the second
        _plank(alice, 1, 0, 20);
        _plank(alice, 1, 0, 20);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.PerTxLimit.selector);
        sale.buy(1, 0, 21, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na()); // perTx still holds
        assertEq(groups.boughtIn(1, 0, alice), 45, "still counted");
        assertEq(packs.balanceOf(alice, 1), 45);
        _plank(alice, 1, 1, 5);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 1, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
    }

    /// The timer runs from when the group actually opened: for one that opens when the group before it sells out,
    /// from that moment, not from the drop's start. The views show it (limitUntil 0 until it is known).
    function test_limitFor_countsFromWhenTheGroupOpened() public {
        FireGroups.Group memory a = _g(5);
        FireGroups.Group memory e = _g(100);
        e.perWallet = 5;
        e.limitFor = 2 hours;
        e.afterGroup = 0;
        _set(1, _with(_cfg(start, 0), _two(a, e)));
        FireGroups.GroupView[] memory v = groups.groupsOf(1);
        assertEq(v[1].config.limitFor, 2 hours);
        assertEq(v[1].limitUntil, 0, "opens when group 0 sells out: not known yet");
        assertEq(v[0].limitUntil, 0, "no timer");
        _open();
        _warp(start + 10 hours);
        _plank(carol, 1, 0, 5); // group 0 sells out: Everyone opens now
        uint256 opened = block.timestamp;
        v = groups.groupsOf(1);
        assertEq(v[1].opensAt, opened);
        assertEq(v[1].limitUntil, opened + 2 hours);
        _plank(alice, 1, 1, 5);
        _warp(opened + 2 hours - 1);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 1, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _warp(opened + 2 hours);
        _plank(alice, 1, 1, 10);
        assertEq(groups.boughtIn(1, 1, alice), 15);
    }

    /// A snapshot gate's own allowance still applies after the per-wallet limit lifts.
    function test_limitFor_gateStillApplies() public {
        bytes32 la = _leaf(alice, 8);
        bytes32 root = _pair(la, _leaf(bob, 8));
        FireGroups.Group memory g = _snapGroup(20, root);
        g.perWallet = 3;
        g.limitFor = 1 hours;
        _set(1, _with(_cfg(start, 0), _two(g, _g(5))));
        _open();
        vm.prank(alice, alice);
        sale.buy(1, 0, 3, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(8, _leaf(bob, 8)));
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(8, _leaf(bob, 8)));
        _warp(start + 1 hours);
        vm.prank(alice, alice);
        sale.buy(1, 0, 5, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(8, _leaf(bob, 8)));
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.WalletLimit.selector); // her allowance of 8
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(8, _leaf(bob, 8)));
    }

    /// limitFor needs a perWallet to lift, and is bounded like every other time.
    function test_validation_limitFor() public {
        FireGroups.Group memory a = _g(5);
        a.limitFor = 1 hours; // perWallet 0: nothing to lift
        _badGroup(_two(a, _g(5)), 0);
        a.perWallet = 5;
        a.limitFor = 30 days + 1;
        _badGroup(_two(a, _g(5)), 0);
        a.limitFor = 30 days;
        _set(1, _with(_cfg(start, 0), _two(a, _g(5))));
        assertEq(groups.groupOf(1, 0).limitFor, 30 days);
        assertEq(_view(1, 0).limitUntil, start + 30 days);
    }

    function test_validation_idleBounded() public {
        FireGroups.Group memory a = _g(5);
        a.idle = 30 days + 1;
        _badGroup(_two(a, _g(5)), 0);
        a.idle = 30 days;
        _set(1, _with(_cfg(start, 0), _two(a, _g(5))));
    }

    // ---------------------------------------------------------------- unlimited groups

    /// An "after sell-out" group with no pack count: `n`-pack main group, then unlimited at `price` rising `t`.
    function _unlimitedDrop(uint64 n, uint128 price, uint16 t) internal {
        FireGroups.Group memory a = _g(n);
        FireGroups.Group memory o = _g(0);
        o.unlimited = true;
        o.priceUsd = price;
        o.taxBps = t;
        o.idle = 15 minutes;
        o.afterGroup = 0;
        _set(1, _with(_cfg(start, 0), _two(a, o)));
    }

    /// It sells past any fixed count, keeps the Series open while it does, ends 15 minutes after its last sale, and
    /// the Series closes and deals with more packs than its base total.
    function test_unlimited_sellsPastAnyCountThenIdlesOut() public {
        _unlimitedDrop(2, PRICE, 400);
        assertEq(sale.dropOf(1).packs, 2, "the base total");
        _open();
        _plank(alice, 1, 0, 2); // the main group sells out: the unlimited one opens
        assertFalse(_closed(1));
        assertEq(sale.status(1).left, type(uint256).max, "no end to what can still sell");
        assertEq(groups.openLeft(1, 1), type(uint256).max);
        for (uint256 i; i < 4; i++) {
            _warp(start + (i + 1) * 10 minutes); // a sale every 10 minutes keeps it open
            _plank(i % 2 == 0 ? bob : carol, 1, 1, 15);
        }
        assertEq(_view(1, 1).sold, 60);
        assertEq(groups.scheduleEnd(1), start + 55 minutes, "it ends 15 minutes after its last sale, if nothing more sells");
        _warp(start + 55 minutes - 1);
        assertFalse(sale.status(1).left == 0);
        _warp(start + 55 minutes);
        assertEq(uint8(_state(1, 1)), uint8(FireGroups.State.ENDED));
        assertEq(sale.status(1).left, 0);
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.GroupNotOpen.selector);
        sale.buy(1, 1, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        sale.close(1); // anyone
        (, bool closed,,, uint64 packCount,) = cards.fires(1);
        assertTrue(closed);
        assertEq(packCount, 62, "the Series is what was minted: 60 more than its base total");
        // an overflow pack opens and deals like any other (same odds: nothing depends on the pack count)
        vm.prank(bob, bob);
        cards.open(1, 15);
        rng.fulfill(rng.last(), 77);
        cards.process(1, type(uint256).max);
        assertEq(cards.balanceOf(bob), 90);
    }

    /// The owner can't end a drop while its unlimited group is open; once it idles out, the drop can end.
    function test_unlimited_endDropWaitsForIt() public {
        _unlimitedDrop(2, PRICE, 400);
        _open();
        _warp(start + 1 days - 10 minutes);
        _plank(alice, 1, 0, 2); // the main group sells out late: the unlimited group opens
        _warp(start + 1 days - 5 minutes);
        _plank(bob, 1, 1, 1);
        assertEq(sale.status(1).endableAt, start + 1 days + 10 minutes);
        _warp(start + 1 days);
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.TooEarly.selector);
        sale.endDrop(1);
        _warp(start + 1 days + 10 minutes); // idled out: nothing left, so close (endDrop works too)
        vm.prank(owner, owner);
        sale.endDrop(1);
        assertTrue(_closed(1));
    }

    /// Past the price safety bound (any pack at most 1e9 times the base) buys are refused and the group idles out.
    function test_unlimited_priceSafetyBound() public {
        _unlimitedDrop(1, 1, 5_000); // $0.00000001 rising 50% a pack: 1.5^51 < 1e9 < 1.5^52
        _open();
        _plank(alice, 1, 0, 1);
        _plank(bob, 1, 1, 50);
        _plank(bob, 1, 1, 1); // the 51st
        vm.expectRevert(FireGroups.PriceTooHigh.selector);
        sale.quote(1, 1, 1, FireSale.Pay.PLANK);
        vm.prank(bob, bob);
        vm.expectRevert(FireGroups.PriceTooHigh.selector);
        sale.buy(1, 1, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _warp(block.timestamp + 15 minutes);
        sale.close(1);
        assertEq(packs.minted(1), 52);
    }

    function test_unlimited_refusals() public {
        FireGroups.Group memory o = _g(0);
        o.unlimited = true;
        o.taxBps = 400;
        o.idle = 15 minutes;
        _set(1, _with(_cfg(start, 0), _two(_g(5), o))); // fine
        o.idle = 0; // could sell forever
        _badGroup(_two(_g(5), o), 1);
        o.idle = 15 minutes;
        o.taxBps = 0; // an untaxed unlimited group would mint forever
        _badGroup(_two(_g(5), o), 1);
        o.taxBps = 400;
        o.packs = 5; // unlimited has no pack count
        _badGroup(_two(_g(5), o), 1);
        o.packs = 0;
        FireGroups.Group memory b = _g(5);
        o.rollTo = 2; // endless leftovers to pass on
        _badGroup(_three(_g(5), o, b), 1);
    }
}
