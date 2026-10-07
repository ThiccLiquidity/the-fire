// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Test} from "forge-std/Test.sol";
import {OpenDrandRouter} from "../src/OpenDrandRouter.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";

/// A minimal consumer: one pending request, stale answers refused (FireCards and FirePsa ignore them instead).
contract DrandConsumer {
    OpenVRFAdapter public adapter;
    uint256 public pending;
    uint256 public answers;
    uint256 public word;
    bool public burnGas;
    error BadRequest();
    error NotRandomness();

    function setAdapter(address a) external { adapter = OpenVRFAdapter(payable(a)); }
    function setBurnGas(bool b) external { burnGas = b; }
    function ask() external returns (uint256 id) { id = adapter.request(); pending = id; }

    function onRandomness(uint256 id, uint256 w) external {
        if (msg.sender != address(adapter)) revert NotRandomness();
        if (id == 0 || id != pending) revert BadRequest();
        if (burnGas) { uint256 i; while (gasleft() > 1000) i++; }
        pending = 0; word = w; answers++;
    }
}

/// Our adapter + our open drand router (OpenVRF minus owner/fees/allowlists), with a real drand evmnet proof
/// (round 1000).
contract RealRouterTest is Test {
    uint256 constant ROUND_TIME = 1727521075 + 999 * 3;
    bytes constant SIG = hex"06fd5996329504d3a56b482d9222bf7205857d0a9559ddd216ca31a286f6a8cc0a120f021aac2f13553fb164f62bc3a5ca32c76dea88a777b39bcf3cac5fdbd6";
    address relayer = address(0x1234);
    OpenDrandRouter router; OpenVRFAdapter adapter; DrandConsumer consumer;

    function setUp() public {
        vm.warp(ROUND_TIME - 90); // request 90 s (MIN_DELAY) before round 1000
        router = new OpenDrandRouter();
        consumer = new DrandConsumer();
        adapter = new OpenVRFAdapter(address(router), address(consumer));
        consumer.setAdapter(address(adapter));
    }

    function _ask() internal returns (uint256 id) {
        id = consumer.ask();
        (, uint64 round,,,,,) = router.requests(id);
        assertEq(round, 1000, "request committed to drand round 1000");
    }

    function test_real_proof_is_delivered() public {
        uint256 id = _ask();
        vm.warp(ROUND_TIME);
        vm.prank(relayer); router.fulfill(id, SIG);
        (,,,, bool delivered, uint256 w,) = router.requests(id);
        assertTrue(delivered, "callback landed");
        assertEq(consumer.answers(), 1); assertEq(consumer.pending(), 0); assertEq(consumer.word(), w);
    }

    function test_failed_callback_settles_with_the_same_number() public {
        uint256 id = _ask();
        consumer.setBurnGas(true); // the consumer eats the callback's gas -> delivery fails
        vm.warp(ROUND_TIME);
        vm.prank(relayer); router.fulfill(id, SIG);
        (,,, bool fulfilled, bool delivered, uint256 w,) = router.requests(id);
        assertTrue(fulfilled); assertFalse(delivered, "callback failed");
        assertEq(consumer.answers(), 0);
        consumer.setBurnGas(false);
        vm.prank(address(0xCAFE)); adapter.settle(id); // anyone
        assertEq(consumer.answers(), 1); assertEq(consumer.word(), w, "the number the router stored");
    }

    function test_stale_answer_after_a_new_request_is_ignored() public {
        uint256 id = _ask();
        vm.warp(ROUND_TIME + 2 hours);
        uint256 id2 = consumer.ask();
        assertTrue(id2 != id);
        vm.prank(relayer); router.fulfill(id, SIG); // late answer for the old request
        (,,,, bool delivered,,) = router.requests(id);
        assertFalse(delivered, "consumer rejected the stale request");
        assertEq(consumer.answers(), 0); assertEq(consumer.pending(), id2);
    }

    function test_settle_rejects_unfulfilled() public {
        uint256 id = _ask();
        vm.expectRevert(OpenVRFAdapter.NotFulfilled.selector);
        adapter.settle(id);
    }

    function test_only_the_consumer_requests() public {
        vm.expectRevert(OpenVRFAdapter.OnlyFire.selector);
        adapter.request();
    }

    function test_stray_eth_does_not_break_requests() public {
        payable(address(adapter)).transfer(1 ether); // anyone can do this
        _ask(); // adapter pays requestFee() = 0, not its balance
        assertEq(address(adapter).balance, 1 ether);
    }

    /// A withheld number can be delivered by anyone, so nobody can hold it back to force a new draw.
    function test_anyone_delivers_a_withheld_number() public {
        uint256 id = _ask();
        vm.warp(ROUND_TIME); // drand has published; our relayer stays silent
        vm.prank(address(0x5712A)); router.fulfill(id, SIG);
        assertEq(consumer.answers(), 1, "stranger's submission delivered the number");
    }

    function test_forged_signature_rejected() public {
        uint256 id = _ask();
        vm.warp(ROUND_TIME);
        bytes memory bad = SIG; bad[5] ^= 0x01;
        vm.expectRevert();
        router.fulfill(id, bad);
        assertEq(consumer.pending(), id, "still pending");
    }

    function test_too_little_gas_cannot_sabotage_delivery() public {
        uint256 id = _ask();
        vm.warp(ROUND_TIME);
        // a griefer sends just enough gas to verify the proof but not to run the callback
        (bool ok,) = address(router).call{gas: 450_000}(abi.encodeCall(OpenDrandRouter.fulfill, (id, SIG)));
        assertFalse(ok, "reverts instead of recording a failed delivery");
        (,,, bool fulfilled,,,) = router.requests(id);
        assertFalse(fulfilled);
        router.fulfill(id, SIG); // an honest submission still works
        assertEq(consumer.answers(), 1);
    }

    function test_request_with_eth_rejected() public {
        vm.prank(address(adapter)); // a contract, so only the fee check can fail
        vm.deal(address(adapter), 1 ether);
        vm.expectRevert(OpenDrandRouter.IncorrectFee.selector);
        router.requestRandomness{value: 1}(100_000);
    }

    function test_min_delay_is_90_seconds() public {
        assertEq(router.MIN_DELAY(), 90);
        uint256 id = _ask();
        (, uint64 round,,,,,) = router.requests(id);
        uint256 publishedAt = router.GENESIS() + (uint256(round) - 1) * router.PERIOD();
        assertGe(publishedAt, block.timestamp + 90, "the round is at least 90 s in the future");
        assertLt(publishedAt, block.timestamp + 94);
    }

    /// A second request on an already-proven round skips the BLS check (cheaper) and gets its own word.
    function test_proven_round_skips_the_signature_check() public {
        uint256 id = _ask();
        DrandConsumer c2 = new DrandConsumer();
        OpenVRFAdapter a2 = new OpenVRFAdapter(address(router), address(c2));
        c2.setAdapter(address(a2));
        uint256 id2 = c2.ask();
        (, uint64 round2,,,,,) = router.requests(id2);
        assertEq(round2, 1000);
        vm.warp(ROUND_TIME);
        uint256 g = gasleft();
        router.fulfill(id, SIG);
        uint256 first = g - gasleft();
        g = gasleft();
        router.fulfill(id2, ""); // no signature needed: round 1000 is stored
        uint256 second = g - gasleft();
        assertLt(second * 2, first, "no pairing check the second time");
        (,,,,, uint256 w1,) = router.requests(id);
        (,,,,, uint256 w2,) = router.requests(id2);
        assertTrue(w1 != w2, "each request gets its own word");
        assertEq(c2.answers(), 1);
        emit log_named_uint("fulfill with BLS check", first);
        emit log_named_uint("fulfill, round already proven", second);
    }

    /// fulfillMany delivers several at once and skips ones someone else already delivered.
    function test_fulfill_many() public {
        uint256 id = _ask();
        DrandConsumer c2 = new DrandConsumer();
        OpenVRFAdapter a2 = new OpenVRFAdapter(address(router), address(c2));
        c2.setAdapter(address(a2));
        uint256 id2 = c2.ask();
        vm.warp(ROUND_TIME);
        router.fulfill(id2, SIG); // front-run one of them
        uint256[] memory ids = new uint256[](2);
        (ids[0], ids[1]) = (id, id2);
        bytes[] memory sigs = new bytes[](2);
        (sigs[0], sigs[1]) = (bytes(""), SIG);
        router.fulfillMany(ids, sigs);
        assertEq(consumer.answers(), 1);
        assertEq(c2.answers(), 1, "not delivered twice");
        vm.expectRevert(OpenDrandRouter.InvalidRequest.selector);
        router.fulfillMany(ids, new bytes[](1)); // lengths must match
        ids[0] = 99; // a request that doesn't exist
        vm.expectRevert(OpenDrandRouter.InvalidRequest.selector);
        router.fulfillMany(ids, sigs);
    }

    function test_unproven_round_still_needs_a_valid_signature() public {
        uint256 id = _ask();
        vm.warp(ROUND_TIME);
        vm.expectRevert();
        router.fulfill(id, "");
    }
}
