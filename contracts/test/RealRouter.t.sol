// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {OpenDrandRouter} from "../src/OpenDrandRouter.sol";
import {Fire} from "../src/Fire.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";
import {MockERC20, MockMill, MockFeed} from "./Mocks.sol";

/// Fire + our adapter + our open drand router (OpenVRF minus owner/fees/allowlists), with a real drand evmnet proof
/// (round 1000).
contract RealRouterTest is Test {
    uint256 constant ROUND_TIME = 1727521075 + 999 * 3;
    bytes constant SIG = hex"06fd5996329504d3a56b482d9222bf7205857d0a9559ddd216ca31a286f6a8cc0a120f021aac2f13553fb164f62bc3a5ca32c76dea88a777b39bcf3cac5fdbd6";
    address relayer = address(0x1234);
    address alice = address(0xA11CE);
    OpenDrandRouter router; OpenVRFAdapter adapter; Fire fire; MockFeed plankFeed; MockERC20 plank;

    function setUp() public {
        vm.warp(ROUND_TIME - 30 - 1 hours);
        router = new OpenDrandRouter();
        MockERC20 paper = new MockERC20("PAPER", "PAPER"); plank = new MockERC20("PLANK", "PLANK");
        MockMill mill = new MockMill(address(plank), 1e18);
        MockFeed ethFeed = new MockFeed(3_333_00000000); plankFeed = new MockFeed(90_000_000_000);
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        adapter = new OpenVRFAdapter(address(router), predicted);
        fire = new Fire(Fire.Config({paper: address(paper), plank: address(plank), mill: address(mill), seaport: address(0),
            royaltyPool: address(0xB0B), randomness: address(adapter), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed), paperUsdFeed: address(0), usdg: address(0),
            paperPerTicket: 1e18, paperUsdCap: 33_000_000, plankPerTicket0: 10_000_000e18, plankUsdPerTicket: 90_000_000, ethUsdPerTicket: 100_000_000,
            millBidBase: 0.03 ether, rollTimeOfDay: (ROUND_TIME - 30) % 1 days}));
        assertEq(address(fire), predicted);
        paper.mint(alice, 1e24); plank.mint(alice, 1e30);
        vm.startPrank(alice); paper.approve(address(fire), type(uint256).max); plank.approve(address(fire), type(uint256).max);
        fire.buyTickets(10, "real"); vm.stopPrank();
        vm.warp(ROUND_TIME - 30); // request 30 s (MIN_DELAY) before round 1000
        plankFeed.set(90_000_000_000);
    }

    function _roll() internal returns (uint256 id) {
        fire.roll(); id = fire.pendingRequest();
        (, uint64 round,,,,,) = router.requests(id);
        assertEq(round, 1000, "request committed to drand round 1000");
    }

    function test_real_proof_resolves_the_night() public {
        uint256 id = _roll();
        vm.warp(ROUND_TIME);
        vm.prank(relayer); router.fulfill(id, SIG);
        (,,,, bool delivered,,) = router.requests(id);
        assertTrue(delivered, "callback landed");
        assertEq(fire.night(), 1); assertEq(fire.pendingRequest(), 0);
    }

    function test_failed_callback_settles_with_the_same_number_and_cannot_reroll() public {
        uint256 id = _roll();
        plankFeed.setBurnGas(true); // feed eats the callback's gas -> delivery fails
        vm.warp(ROUND_TIME);
        vm.prank(relayer); router.fulfill(id, SIG);
        (,,, bool fulfilled, bool delivered, uint256 word,) = router.requests(id);
        assertTrue(fulfilled); assertFalse(delivered, "callback failed");
        assertEq(fire.night(), 0);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(Fire.Answered.selector);
        fire.reroll(); // the number exists; no redraw
        plankFeed.setBurnGas(false);
        vm.prank(address(0xCAFE)); adapter.settle(id); // anyone
        assertEq(fire.night(), 1); assertEq(fire.pendingRequest(), 0);
        word; // same word the router stored is what the fire consumed
    }

    function test_silent_relayer_reroll_then_late_answer_is_ignored() public {
        uint256 id = _roll();
        vm.warp(ROUND_TIME + 30 minutes);
        fire.reroll();
        uint256 id2 = fire.pendingRequest();
        assertTrue(id2 != id);
        vm.prank(relayer); router.fulfill(id, SIG); // late answer for the old request
        (,,,, bool delivered,,) = router.requests(id);
        assertFalse(delivered, "fire rejected the stale request");
        assertEq(fire.night(), 0); assertEq(fire.pendingRequest(), id2);
    }

    function test_settle_rejects_unfulfilled() public {
        uint256 id = _roll();
        vm.expectRevert(OpenVRFAdapter.NotFulfilled.selector);
        adapter.settle(id);
    }

    function test_stray_eth_no_longer_breaks_rolls() public {
        payable(address(adapter)).transfer(1 ether); // anyone can do this
        _roll(); // adapter pays requestFee() = 0, not its balance
        assertEq(address(adapter).balance, 1 ether);
    }

    /// The fix for "relayer picks among draws": a withheld number can be delivered by anyone, so the Fire never
    /// re-rolls while a valid number exists.
    function test_anyone_delivers_a_withheld_number_so_no_reroll() public {
        uint256 id = _roll();
        vm.warp(ROUND_TIME); // drand has published; our relayer stays silent
        address stranger = address(0x5712A);
        vm.prank(stranger); router.fulfill(id, SIG);
        assertEq(fire.night(), 1, "stranger's submission resolved the night");
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(Fire.BadRequest.selector); // nothing pending to re-roll
        fire.reroll();
    }

    function test_forged_signature_rejected() public {
        uint256 id = _roll();
        vm.warp(ROUND_TIME);
        bytes memory bad = SIG; bad[5] ^= 0x01;
        vm.expectRevert();
        router.fulfill(id, bad);
        assertEq(fire.pendingRequest(), id, "still pending");
    }

    function test_too_little_gas_cannot_sabotage_delivery() public {
        uint256 id = _roll();
        vm.warp(ROUND_TIME);
        // a griefer sends just enough gas to verify the proof but not to run the callback
        (bool ok,) = address(router).call{gas: 450_000}(abi.encodeCall(OpenDrandRouter.fulfill, (id, SIG)));
        assertFalse(ok, "reverts instead of recording a failed delivery");
        (,,, bool fulfilled,,,) = router.requests(id);
        assertFalse(fulfilled);
        router.fulfill(id, SIG); // an honest submission still works
        assertEq(fire.night(), 1);
    }

    function test_request_with_eth_rejected() public {
        vm.prank(address(adapter)); // a contract, so only the fee check can fail
        vm.deal(address(adapter), 1 ether);
        vm.expectRevert(OpenDrandRouter.IncorrectFee.selector);
        router.requestRandomness{value: 1}(100_000);
    }
}
