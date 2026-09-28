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

    function test_weth_pool_adopted_then_priced_after_a_window() public {
        MockPair p = new MockPair(paper, weth);
        p.set(1_000_000e18, 40e18); // 1M PAPER / 40 WETH -> $0.10 per PAPER
        factory.add(paper, weth, address(p));
        twap.checkpoint();
        assertEq(address(twap.pair()), address(p));
        assertEq(_price(), 0, "no price until a full window");
        _day();
        assertApproxEqRel(_price(), 0.1e18, 1e15);
    }

    function test_usdg_pool_priced_with_6_decimals() public {
        MockPair p = new MockPair(usdg, paper); // USDG is token0 here
        p.set(5_000e6, 1_000e18); // $5,000 / 1,000 PAPER -> $5 per PAPER
        factory.add(paper, usdg, address(p));
        twap.checkpoint(); _day();
        assertApproxEqRel(_price(), 5e18, 1e15);
    }

    function test_tiny_first_pool_is_replaced_by_the_real_market() public {
        MockPair tiny = new MockPair(paper, weth);
        tiny.set(1_000e18, 0.001e18); // $2.50 of WETH, priced at $0.0025
        factory.add(paper, weth, address(tiny));
        twap.checkpoint(); _day();
        MockPair real = new MockPair(paper, usdg);
        real.set(100_000e18, 20_000e6); // $20,000 of USDG, $0.20 per PAPER
        factory.add(paper, usdg, address(real));
        twap.checkpoint();
        assertEq(address(twap.pair()), address(real), "switched to the pool with the liquidity");
        assertEq(_price(), 0, "window restarts on the new pool");
        _day();
        assertApproxEqRel(_price(), 0.2e18, 1e15);
    }

    function test_a_slightly_bigger_pool_does_not_flip_the_reference() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $10,000 of WETH
        factory.add(paper, weth, address(a));
        twap.checkpoint(); _day();
        MockPair b = new MockPair(paper, usdg);
        b.set(100_000e18, 15_000e6); // $15,000: bigger, but not 2x
        factory.add(paper, usdg, address(b));
        _day();
        assertEq(address(twap.pair()), address(a));
    }

    function test_frequent_checkpoints_cannot_shorten_the_window() public {
        MockPair p = new MockPair(paper, weth);
        p.set(1_000_000e18, 40e18);
        factory.add(paper, weth, address(p));
        twap.checkpoint();
        vm.warp(block.timestamp + 1 hours); twap.checkpoint();
        assertEq(_price(), 0, "1h is not a window");
    }

    function test_due_only_when_there_is_work() public {
        assertFalse(twap.due(), "no pool: nothing to do");
        MockPair p = new MockPair(paper, weth);
        p.set(1_000_000e18, 40e18);
        factory.add(paper, weth, address(p));
        assertTrue(twap.due(), "a pool to adopt");
        twap.checkpoint();
        assertFalse(twap.due(), "just adopted");
        vm.warp(block.timestamp + 21 hours); eth.set(eth.answer());
        assertTrue(twap.due(), "window to roll");
    }
}
