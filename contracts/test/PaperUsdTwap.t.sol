// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PaperUsdTwap} from "../src/PaperUsdTwap.sol";
import {MockFeed} from "./Mocks.sol";
import {MockPair} from "./PlankUsdTwap.t.sol";

contract MockFactory {
    mapping(address => mapping(address => address)) public pairs;
    function add(address a, address b, address p) external { pairs[a][b] = p; pairs[b][a] = p; }
    function getPair(address a, address b) external view returns (address) { return pairs[a][b]; }
}

contract PaperUsdTwapTest is Test {
    address paper = address(0xAA); address weth = address(0xBB); address usdg = address(0xCC);
    MockFactory factory; MockFeed eth; PaperUsdTwap twap;

    function setUp() public {
        vm.warp(1_800_000_000);
        factory = new MockFactory();
        eth = new MockFeed(2_500_00000000); // $2,500
        twap = new PaperUsdTwap(address(factory), paper, weth, usdg, 6, address(eth));
    }

    function _price() internal view returns (uint256) { (, int256 a,,,) = twap.latestRoundData(); return uint256(a); }
    function _day() internal { vm.warp(block.timestamp + 21 hours); eth.set(eth.answer()); twap.checkpoint(); }

    function test_no_pool_reports_zero() public {
        twap.checkpoint(); _day(); _day();
        assertEq(address(twap.pair()), address(0));
        assertEq(_price(), 0);
    }

    /// @dev A pool that qualifies is recorded as the candidate, then adopted once it has qualified for a full window.
    function _adopt() internal { twap.checkpoint(); _day(); }

    function test_weth_pool_adopted_then_priced_after_a_window() public {
        MockPair p = new MockPair(paper, weth);
        p.set(1_000_000e18, 40e18); // 1M PAPER / 40 WETH -> $0.10 per PAPER ($100k of WETH)
        factory.add(paper, weth, address(p));
        twap.checkpoint();
        assertEq(twap.candidate(), address(p), "candidate first");
        assertEq(address(twap.pair()), address(0), "not adopted on sight");
        _day();
        assertEq(address(twap.pair()), address(p));
        assertEq(_price(), 0, "no price until a full window");
        _day();
        assertApproxEqRel(_price(), 0.1e18, 1e15);
    }

    function test_usdg_pool_priced_with_6_decimals() public {
        MockPair p = new MockPair(usdg, paper); // USDG is token0 here
        p.set(5_000e6, 1_000e18); // $5,000 / 1,000 PAPER -> $5 per PAPER
        factory.add(paper, usdg, address(p));
        _adopt(); _day();
        assertApproxEqRel(_price(), 5e18, 1e15);
    }

    function test_dust_pool_is_never_the_reference() public {
        MockPair tiny = new MockPair(paper, weth);
        tiny.set(1_000e18, 0.001e18); // $2.50 of WETH
        factory.add(paper, weth, address(tiny));
        _adopt(); _day();
        assertEq(address(twap.pair()), address(0), "under the liquidity floor");
        assertEq(_price(), 0);
    }

    function test_small_first_pool_is_replaced_by_the_real_market() public {
        MockPair small = new MockPair(paper, weth);
        small.set(1_000_000e18, 0.8e18); // $2,000 of WETH, $0.002 per PAPER
        factory.add(paper, weth, address(small));
        _adopt();
        assertEq(address(twap.pair()), address(small));
        MockPair real = new MockPair(paper, usdg);
        real.set(100_000e18, 20_000e6); // $20,000 of USDG, $0.20 per PAPER
        factory.add(paper, usdg, address(real));
        _adopt();
        assertEq(address(twap.pair()), address(real), "switched to the pool with the liquidity");
        assertEq(_price(), 0, "window restarts on the new pool");
        _day();
        assertApproxEqRel(_price(), 0.2e18, 1e15);
    }

    function test_flash_liquidity_cannot_force_a_switch() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $10,000 of WETH
        factory.add(paper, weth, address(a));
        _adopt();
        MockPair b = new MockPair(paper, usdg);
        factory.add(paper, usdg, address(b));
        b.set(1e18, 1_000_000e6); // flash: $1M appears...
        twap.checkpoint();
        assertEq(twap.candidate(), address(b));
        b.set(1e18, 10e6); // ...and leaves in the same transaction
        assertTrue(twap.due(), "keeper sees the candidate stopped qualifying");
        twap.checkpoint();
        assertEq(twap.candidate(), address(0), "dropped");
        vm.warp(block.timestamp + 21 hours); eth.set(eth.answer());
        b.set(1e18, 1_000_000e6); // flash again a window later
        twap.checkpoint();
        assertEq(address(twap.pair()), address(a), "still the real pool: the clock restarted");
        assertEq(twap.candidate(), address(b));
    }

    function test_no_switch_while_the_eth_feed_is_stale() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18);
        factory.add(paper, weth, address(a));
        _adopt();
        MockPair b = new MockPair(paper, usdg);
        b.set(100_000e18, 1_000e6); // $1,000 of USDG: would win if WETH counted as $0
        factory.add(paper, usdg, address(b));
        vm.warp(block.timestamp + 26 hours); // ETH feed now stale
        twap.checkpoint();
        assertEq(twap.candidate(), address(0));
        vm.warp(block.timestamp + 21 hours); twap.checkpoint();
        assertEq(address(twap.pair()), address(a));
    }

    function test_a_slightly_bigger_pool_does_not_flip_the_reference() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $10,000 of WETH
        factory.add(paper, weth, address(a));
        _adopt(); _day();
        MockPair b = new MockPair(paper, usdg);
        b.set(100_000e18, 15_000e6); // $15,000: bigger, but not 2x
        factory.add(paper, usdg, address(b));
        _day(); _day();
        assertEq(address(twap.pair()), address(a));
    }

    function test_frequent_checkpoints_cannot_shorten_the_window() public {
        MockPair p = new MockPair(paper, weth);
        p.set(1_000_000e18, 40e18);
        factory.add(paper, weth, address(p));
        _adopt();
        vm.warp(block.timestamp + 1 hours); twap.checkpoint();
        assertEq(_price(), 0, "1h is not a window");
    }

    function test_due_only_when_there_is_work() public {
        assertFalse(twap.due(), "no pool: nothing to do");
        MockPair p = new MockPair(paper, weth);
        p.set(1_000_000e18, 40e18);
        factory.add(paper, weth, address(p));
        assertTrue(twap.due(), "a candidate to record");
        twap.checkpoint();
        assertFalse(twap.due(), "candidate waiting out its window");
        vm.warp(block.timestamp + 21 hours); eth.set(eth.answer());
        assertTrue(twap.due(), "candidate to adopt");
        twap.checkpoint();
        assertFalse(twap.due(), "just adopted");
        vm.warp(block.timestamp + 21 hours); eth.set(eth.answer());
        assertTrue(twap.due(), "window to roll");
    }
}
