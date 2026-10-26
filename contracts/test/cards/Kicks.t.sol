// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SaleBase} from "./Sale.t.sol";
import {MockERC20} from "../Mocks.sol";
import {FireKicks} from "../../src/cards/FireKicks.sol";
import {FireCredits} from "../../src/cards/FireCredits.sol";

/// Paper football: run entries (FireKicks) and the competition prizes (FireCredits.awardPrizes).
contract KicksTest is SaleBase {
    FireKicks kicks;
    address server = address(0x5E4);

    function setUp() public override {
        super.setUp();
        kicks = new FireKicks(owner, address(paper));
        vm.prank(owner); kicks.setSeries(1);
        vm.prank(alice); paper.approve(address(kicks), type(uint256).max);
    }

    // ---------------------------------------------------------------- entries

    function test_aRunBurnsOnePaperOnceAndRecordsThePlayer() public {
        uint256 before = paper.balanceOf(alice);
        uint256 dead = paper.balanceOf(DEAD);
        vm.expectEmit(true, true, true, true);
        emit FireKicks.RunPaid(bytes32("run1"), alice, 1, 1e18);
        vm.prank(alice); kicks.payRun(bytes32("run1"), 1);
        assertEq(paper.balanceOf(alice), before - 1e18);
        assertEq(paper.balanceOf(DEAD), dead + 1e18, "burned");
        assertEq(paper.balanceOf(address(kicks)), 0, "holds nothing");
        assertEq(kicks.runBy(bytes32("run1")), alice);
        vm.prank(alice); vm.expectRevert(FireKicks.AlreadyPaid.selector); kicks.payRun(bytes32("run1"), 1);
        vm.prank(alice); vm.expectRevert(FireKicks.AlreadyPaid.selector); kicks.payRun(bytes32(0), 1);
    }

    function test_theKillSwitchAndTheSeriesStopNewRuns() public {
        vm.prank(owner); kicks.setPaused(true);
        vm.prank(alice); vm.expectRevert(FireKicks.IsPaused.selector); kicks.payRun(bytes32("a"), 1);
        vm.prank(owner); kicks.setPaused(false);
        vm.prank(alice); vm.expectRevert(FireKicks.NotOpen.selector); kicks.payRun(bytes32("a"), 2);  // the wrong competition
        vm.prank(owner); kicks.setSeries(2);
        vm.prank(alice); vm.expectRevert(FireKicks.NotOpen.selector); kicks.payRun(bytes32("a"), 1);  // the old one is closed
        vm.prank(alice); kicks.payRun(bytes32("a"), 2);
        vm.prank(owner); kicks.setSeries(0);
        vm.prank(alice); vm.expectRevert(FireKicks.NotOpen.selector); kicks.payRun(bytes32("b"), 0);
    }

    function test_aRunIsAlwaysOnePaper() public {
        assertEq(kicks.ENTRY(), 1e18);
        vm.prank(alice); kicks.payRun(bytes32("a"), 1);
        vm.prank(alice); kicks.payRun(bytes32("b"), 1);
        assertEq(paper.balanceOf(DEAD) >= 2e18, true);
    }

    function test_onlyTheOwnerRunsTheSwitchesAndOwnershipCantBeRenounced() public {
        vm.startPrank(alice);
        vm.expectRevert(); kicks.setPaused(true);
        vm.expectRevert(); kicks.setSeries(5);
        vm.stopPrank();
        vm.prank(owner); vm.expectRevert(FireKicks.RenounceDisabled.selector); kicks.renounceOwnership();
    }

    // ---------------------------------------------------------------- prizes

    function _w(address a, address b, address c) internal pure returns (address[] memory w) { w = new address[](3); (w[0], w[1], w[2]) = (a, b, c); }
    function _n(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory n) { n = new uint256[](3); (n[0], n[1], n[2]) = (a, b, c); }

    function test_theTopThreeGetThreeTwoOneCreditsAndNeverMoreThanSixASeries() public {
        vm.prank(owner); credits.setPrizeAwarder(server);
        vm.warp(start); // Series 1's drop has started
        vm.prank(server); credits.awardPrizes(1, _w(alice, bob, carol), _n(3, 2, 1));
        assertEq(credits.credits(alice), 3); assertEq(credits.credits(bob), 2); assertEq(credits.credits(carol), 1);
        assertEq(credits.prizesOf(1), 6);
        address[] memory one = new address[](1); one[0] = alice; uint256[] memory n1 = new uint256[](1); n1[0] = 1;
        vm.prank(server); vm.expectRevert(FireCredits.BadAmount.selector); credits.awardPrizes(1, one, n1); // the cap, across calls
        vm.prank(owner); vm.expectRevert(FireCredits.BadAmount.selector); credits.awardPrizes(1, one, n1); // the owner too
    }

    function test_prizesNeedARealStartedSeriesAndTheAwarder() public {
        vm.prank(owner); credits.setPrizeAwarder(server);
        vm.prank(server); vm.expectRevert(FireCredits.BadConfig.selector); credits.awardPrizes(1, _w(alice, bob, carol), _n(3, 2, 1)); // not started yet
        vm.warp(start);
        vm.prank(server); vm.expectRevert(FireCredits.BadConfig.selector); credits.awardPrizes(99, _w(alice, bob, carol), _n(3, 2, 1)); // no such Series
        vm.prank(alice); vm.expectRevert(FireCredits.NotAwarder.selector); credits.awardPrizes(1, _w(alice, bob, carol), _n(3, 2, 1));
        vm.prank(server); vm.expectRevert(FireCredits.BadAmount.selector); credits.awardPrizes(1, _w(alice, bob, carol), _n(4, 2, 1)); // 7 > 6
        vm.prank(server); vm.expectRevert(FireCredits.BadAmount.selector); credits.awardPrizes(1, _w(alice, bob, carol), _n(3, 0, 1));
        vm.prank(server); vm.expectRevert(FireCredits.ZeroAddress.selector); credits.awardPrizes(1, _w(alice, address(0), carol), _n(3, 2, 1));
        vm.prank(owner); credits.setPrizeAwarder(address(0)); // the server's wallet removed: only the owner now
        vm.prank(server); vm.expectRevert(FireCredits.NotAwarder.selector); credits.awardPrizes(1, _w(alice, bob, carol), _n(3, 2, 1));
        vm.prank(owner); credits.awardPrizes(1, _w(alice, bob, carol), _n(3, 2, 1));
        assertEq(credits.prizesOf(1), 6);
    }

    function test_prizeCreditsSpendLikeAnyOtherCredit() public {
        vm.prank(owner); credits.setPrizeAwarder(server);
        vm.warp(start);
        vm.prank(server); credits.awardPrizes(1, _w(alice, bob, carol), _n(3, 2, 1));
        // the credits are the same mapping FireCredits.useCredits spends (Sale.t.sol covers spending them)
        assertEq(credits.credits(alice), 3);
    }
}
