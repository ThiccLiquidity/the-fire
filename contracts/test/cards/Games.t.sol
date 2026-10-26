// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SaleBase} from "./Sale.t.sol";
import {FireGames} from "../../src/cards/FireGames.sol";
import {FireCredits} from "../../src/cards/FireCredits.sol";

/// The game room: run entries (FireGames, paper football is game 1) and the competition prizes (FireCredits.awardPrizes).
contract GamesTest is SaleBase {
    FireGames games;
    address server = address(0x5E4); // the game server's wallet (the prize awarder)
    uint256 signerKey = 0x5161;
    address signerAddr;
    uint256 constant FB = 1; // paper football
    uint256 constant FB_ENTRY = 1e18;
    uint256 deadline;

    function setUp() public override {
        super.setUp();
        signerAddr = vm.addr(signerKey);
        games = new FireGames(owner, address(paper));
        vm.startPrank(owner);
        games.addGame(FB, FB_ENTRY);
        games.setSigner(signerAddr);
        games.setSeries(1);
        credits.setPrizeGame(FB, true);
        vm.stopPrank();
        for (uint256 i; i < 3; i++) {
            address u = i == 0 ? alice : i == 1 ? bob : carol;
            vm.prank(u); paper.approve(address(games), type(uint256).max);
        }
        deadline = block.timestamp + 10 minutes;
    }

    function _sig(uint256 key, uint256 gameId, bytes32 runId, address player, uint256 s, uint256 dl) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(key, games.runDigest(gameId, runId, player, s, dl));
        return abi.encodePacked(r, ss, v);
    }

    function _sig(bytes32 runId, address player) internal view returns (bytes memory) {
        return _sig(signerKey, FB, runId, player, 1, deadline);
    }

    function _pay(address who, bytes32 runId) internal {
        bytes memory sig = _sig(runId, who);
        vm.prank(who); games.payRun(FB, runId, 1, deadline, sig);
    }

    // ---------------------------------------------------------------- entries

    function test_aRunBurnsExactlyTheEntryOnceAndRecordsThePlayer() public {
        uint256 before = paper.balanceOf(alice);
        uint256 dead = paper.balanceOf(DEAD);
        bytes memory sig = _sig(bytes32("run1"), alice);
        vm.expectEmit(true, true, true, true);
        emit FireGames.RunPaid(FB, bytes32("run1"), alice, 1, FB_ENTRY);
        vm.prank(alice); games.payRun(FB, bytes32("run1"), 1, deadline, sig);
        assertEq(paper.balanceOf(alice), before - FB_ENTRY, "exactly the entry");
        assertEq(paper.balanceOf(DEAD), dead + FB_ENTRY, "burned");
        assertEq(paper.balanceOf(address(games)), 0, "holds nothing");
        assertEq(paper.allowance(alice, address(games)), type(uint256).max); // infinite approval untouched (OZ)
        assertEq(games.runBy(bytes32("run1")), alice);
        vm.prank(alice); vm.expectRevert(FireGames.AlreadyPaid.selector); games.payRun(FB, bytes32("run1"), 1, deadline, sig); // replay
        bytes memory zero = _sig(bytes32(0), alice);
        vm.prank(alice); vm.expectRevert(FireGames.AlreadyPaid.selector); games.payRun(FB, bytes32(0), 1, deadline, zero);
    }

    function test_eachGameBurnsItsOwnEntry() public {
        vm.prank(owner); games.addGame(2, 3e18);
        uint256 before = paper.balanceOf(bob);
        bytes memory sig = _sig(signerKey, 2, bytes32("g2"), bob, 1, deadline);
        vm.prank(bob); games.payRun(2, bytes32("g2"), 1, deadline, sig);
        assertEq(paper.balanceOf(bob), before - 3e18);
        _pay(bob, bytes32("g1"));
        assertEq(paper.balanceOf(bob), before - 4e18);
    }

    function test_aPlayerWithoutEnoughPaperOrApprovalPaysNothing() public {
        address dan = address(0xD4);
        bytes memory sig = _sig(bytes32("d"), dan);
        vm.prank(dan); vm.expectRevert(); games.payRun(FB, bytes32("d"), 1, deadline, sig);
        assertEq(games.runBy(bytes32("d")), address(0));
    }

    // ---------------------------------------------------------------- signatures

    function test_theServerMustSignExactlyThisRun() public {
        bytes32 id = bytes32("r");
        // wrong signer
        bytes memory bad = _sig(0xBAD, FB, id, alice, 1, deadline);
        vm.prank(alice); vm.expectRevert(FireGames.BadSignature.selector); games.payRun(FB, id, 1, deadline, bad);
        // someone else using alice's approval
        bytes memory forAlice = _sig(id, alice);
        vm.prank(bob); vm.expectRevert(FireGames.BadSignature.selector); games.payRun(FB, id, 1, deadline, forAlice);
        // another game, Series, run id or deadline than signed
        vm.prank(owner); games.addGame(2, 1e18);
        vm.prank(alice); vm.expectRevert(FireGames.BadSignature.selector); games.payRun(2, id, 1, deadline, forAlice);
        vm.prank(owner); games.setSeries(2);
        vm.prank(alice); vm.expectRevert(FireGames.BadSignature.selector); games.payRun(FB, id, 2, deadline, forAlice);
        vm.prank(owner); games.setSeries(1);
        vm.prank(alice); vm.expectRevert(FireGames.BadSignature.selector); games.payRun(FB, bytes32("other"), 1, deadline, forAlice);
        vm.prank(alice); vm.expectRevert(FireGames.BadSignature.selector); games.payRun(FB, id, 1, deadline + 1, forAlice);
        // garbage and empty signatures
        vm.prank(alice); vm.expectRevert(FireGames.BadSignature.selector); games.payRun(FB, id, 1, deadline, hex"1234");
        vm.prank(alice); vm.expectRevert(FireGames.BadSignature.selector); games.payRun(FB, id, 1, deadline, "");
        // the real one works, once
        vm.prank(alice); games.payRun(FB, id, 1, deadline, forAlice);
        bytes memory forBob = _sig(id, bob);
        vm.prank(bob); vm.expectRevert(FireGames.AlreadyPaid.selector); games.payRun(FB, id, 1, deadline, forBob);
    }

    function test_anApprovalExpires() public {
        bytes memory sig = _sig(bytes32("e"), alice);
        vm.warp(deadline);
        vm.prank(alice); games.payRun(FB, bytes32("e"), 1, deadline, sig); // up to the deadline itself
        bytes memory sig2 = _sig(bytes32("e2"), alice);
        vm.warp(deadline + 1);
        vm.prank(alice); vm.expectRevert(FireGames.Expired.selector); games.payRun(FB, bytes32("e2"), 1, deadline, sig2);
    }

    function test_aNewSignerReplacesTheOldAndNoSignerMeansNoRuns() public {
        bytes memory sig = _sig(bytes32("s"), alice);
        vm.prank(owner); games.setSigner(vm.addr(0x7777));
        vm.prank(alice); vm.expectRevert(FireGames.BadSignature.selector); games.payRun(FB, bytes32("s"), 1, deadline, sig);
        vm.prank(owner); games.setSigner(address(0));
        vm.prank(alice); vm.expectRevert(FireGames.NotOpen.selector); games.payRun(FB, bytes32("s"), 1, deadline, sig);
    }

    // ---------------------------------------------------------------- switches

    function test_theKillSwitchAndEachGamesSwitchStopNewRuns() public {
        bytes memory sig = _sig(bytes32("a"), alice);
        vm.prank(owner); games.setPaused(true);
        vm.prank(alice); vm.expectRevert(FireGames.IsPaused.selector); games.payRun(FB, bytes32("a"), 1, deadline, sig);
        vm.prank(owner); games.setPaused(false);
        vm.prank(owner); games.setGameOpen(FB, false);
        vm.prank(alice); vm.expectRevert(FireGames.NotOpen.selector); games.payRun(FB, bytes32("a"), 1, deadline, sig);
        // another game still runs while this one is closed
        vm.prank(owner); games.addGame(2, 1e18);
        bytes memory sig2 = _sig(signerKey, 2, bytes32("b"), alice, 1, deadline);
        vm.prank(alice); games.payRun(2, bytes32("b"), 1, deadline, sig2);
        vm.prank(owner); games.setGameOpen(FB, true);
        vm.prank(alice); games.payRun(FB, bytes32("a"), 1, deadline, sig);
    }

    function test_theSeriesClosesTheOldCompetition() public {
        bytes memory s2 = _sig(signerKey, FB, bytes32("a"), alice, 2, deadline);
        vm.prank(alice); vm.expectRevert(FireGames.NotOpen.selector); games.payRun(FB, bytes32("a"), 2, deadline, s2); // the wrong one
        vm.prank(owner); games.setSeries(2);
        bytes memory s1 = _sig(bytes32("a"), alice);
        vm.prank(alice); vm.expectRevert(FireGames.NotOpen.selector); games.payRun(FB, bytes32("a"), 1, deadline, s1); // old one closed
        vm.prank(alice); games.payRun(FB, bytes32("a"), 2, deadline, s2);
        vm.prank(owner); games.setSeries(0);
        bytes memory s0 = _sig(signerKey, FB, bytes32("b"), alice, 0, deadline);
        vm.prank(alice); vm.expectRevert(FireGames.NotOpen.selector); games.payRun(FB, bytes32("b"), 0, deadline, s0);
    }

    function test_unknownGamesCantBePlayed() public {
        bytes memory sig = _sig(signerKey, 9, bytes32("x"), alice, 1, deadline);
        vm.prank(alice); vm.expectRevert(FireGames.NoGame.selector); games.payRun(9, bytes32("x"), 1, deadline, sig);
        vm.prank(owner); vm.expectRevert(FireGames.NoGame.selector); games.setGameOpen(9, true);
    }

    function test_aGamesEntryIsFixedForever() public {
        assertEq(games.entryOf(FB), 1e18);
        vm.startPrank(owner);
        vm.expectRevert(FireGames.AlreadyAdded.selector); games.addGame(FB, 2e18);
        vm.expectRevert(FireGames.BadConfig.selector); games.addGame(0, 1e18);
        vm.expectRevert(FireGames.BadConfig.selector); games.addGame(3, 0);
        games.setGameOpen(FB, false);
        games.setGameOpen(FB, true);
        vm.stopPrank();
        assertEq(games.entryOf(FB), 1e18);
    }

    function test_onlyTheOwnerRunsTheSwitchesAndOwnershipCantBeRenounced() public {
        vm.startPrank(alice);
        vm.expectRevert(); games.setPaused(true);
        vm.expectRevert(); games.setSeries(5);
        vm.expectRevert(); games.setSigner(alice);
        vm.expectRevert(); games.addGame(5, 1);
        vm.expectRevert(); games.setGameOpen(FB, false);
        vm.stopPrank();
        vm.prank(owner); vm.expectRevert(FireGames.RenounceDisabled.selector); games.renounceOwnership();
    }

    // ---------------------------------------------------------------- prizes

    function _w(address a, address b, address c) internal pure returns (address[] memory w) { w = new address[](3); (w[0], w[1], w[2]) = (a, b, c); }
    function _n(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory n) { n = new uint256[](3); (n[0], n[1], n[2]) = (a, b, c); }

    function test_theTopThreeGetThreeTwoOneCreditsAndNeverMoreThanSixAGameASeries() public {
        vm.prank(owner); credits.setPrizeAwarder(server);
        vm.warp(start); // Series 1's drop has started
        vm.prank(server); credits.awardPrizes(1, FB, _w(alice, bob, carol), _n(3, 2, 1));
        assertEq(credits.credits(alice), 3); assertEq(credits.credits(bob), 2); assertEq(credits.credits(carol), 1);
        assertEq(credits.prizesOf(1, FB), 6);
        address[] memory one = new address[](1); one[0] = alice; uint256[] memory n1 = new uint256[](1); n1[0] = 1;
        vm.prank(server); vm.expectRevert(FireCredits.BadAmount.selector); credits.awardPrizes(1, FB, one, n1); // the cap, across calls
        vm.prank(owner); vm.expectRevert(FireCredits.BadAmount.selector); credits.awardPrizes(1, FB, one, n1); // the owner too
        // a second enabled game has its own 6
        vm.prank(owner); credits.setPrizeGame(2, true);
        vm.prank(server); credits.awardPrizes(1, 2, _w(alice, bob, carol), _n(1, 1, 1));
        vm.prank(server); credits.awardPrizes(1, 2, _w(alice, bob, carol), _n(1, 1, 1));
        vm.prank(server); vm.expectRevert(FireCredits.BadAmount.selector); credits.awardPrizes(1, 2, one, n1);
        assertEq(credits.prizesOf(1, 2), 6);
        assertEq(credits.credits(alice), 5);
    }

    function test_onlyEnabledGamesGetPrizes() public {
        vm.prank(owner); credits.setPrizeAwarder(server);
        vm.warp(start);
        vm.prank(server); vm.expectRevert(FireCredits.NotPrizeGame.selector); credits.awardPrizes(1, 2, _w(alice, bob, carol), _n(3, 2, 1));
        vm.prank(owner); vm.expectRevert(FireCredits.NotPrizeGame.selector); credits.awardPrizes(1, 0, _w(alice, bob, carol), _n(3, 2, 1));
        vm.prank(server); vm.expectRevert(); credits.setPrizeGame(2, true); // the awarder can't enable games
        vm.prank(owner); vm.expectRevert(FireCredits.BadConfig.selector); credits.setPrizeGame(0, true);
        vm.prank(owner); credits.setPrizeGame(FB, false); // switched off
        vm.prank(server); vm.expectRevert(FireCredits.NotPrizeGame.selector); credits.awardPrizes(1, FB, _w(alice, bob, carol), _n(3, 2, 1));
        assertEq(credits.credits(alice), 0);
    }

    function test_prizesNeedARealStartedSeriesAndTheAwarder() public {
        vm.prank(owner); credits.setPrizeAwarder(server);
        vm.prank(server); vm.expectRevert(FireCredits.BadConfig.selector); credits.awardPrizes(1, FB, _w(alice, bob, carol), _n(3, 2, 1)); // not started yet
        vm.warp(start);
        vm.prank(server); vm.expectRevert(FireCredits.BadConfig.selector); credits.awardPrizes(99, FB, _w(alice, bob, carol), _n(3, 2, 1)); // no such Series
        vm.prank(alice); vm.expectRevert(FireCredits.NotAwarder.selector); credits.awardPrizes(1, FB, _w(alice, bob, carol), _n(3, 2, 1));
        vm.prank(server); vm.expectRevert(FireCredits.BadAmount.selector); credits.awardPrizes(1, FB, _w(alice, bob, carol), _n(4, 2, 1)); // 7 > 6
        vm.prank(server); vm.expectRevert(FireCredits.BadAmount.selector); credits.awardPrizes(1, FB, _w(alice, bob, carol), _n(3, 0, 1));
        vm.prank(server); vm.expectRevert(FireCredits.ZeroAddress.selector); credits.awardPrizes(1, FB, _w(alice, address(0), carol), _n(3, 2, 1));
        vm.prank(owner); credits.setPrizeAwarder(address(0)); // the server's wallet removed: only the owner now
        vm.prank(server); vm.expectRevert(FireCredits.NotAwarder.selector); credits.awardPrizes(1, FB, _w(alice, bob, carol), _n(3, 2, 1));
        vm.prank(owner); credits.awardPrizes(1, FB, _w(alice, bob, carol), _n(3, 2, 1));
        assertEq(credits.prizesOf(1, FB), 6);
    }

    function test_prizeCreditsAreOrdinaryCredits() public {
        vm.prank(owner); credits.setPrizeAwarder(server);
        vm.warp(start);
        vm.prank(server); credits.awardPrizes(1, FB, _w(alice, bob, carol), _n(3, 2, 1));
        // the credits are the same mapping FireCredits.useCredits spends (Sale.t.sol covers spending them)
        assertEq(credits.credits(alice), 3);
    }
}
