// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PlankUsdTwap} from "../src/PlankUsdTwap.sol";
import {MockFeed} from "./Mocks.sol";

/// @dev Uniswap V2 pair mock: cumulative prices accrue like the real pair.
contract MockPair {
    address public token0; address public token1;
    uint112 r0; uint112 r1; uint32 tLast;
    uint256 public price0CumulativeLast; uint256 public price1CumulativeLast;
    constructor(address t0, address t1) { token0 = t0; token1 = t1; }
    function set(uint112 a, uint112 b) external { _sync(); r0 = a; r1 = b; }
    function _sync() internal {
        uint32 now_ = uint32(block.timestamp);
        if (tLast != 0 && now_ != tLast && r0 > 0 && r1 > 0) {
            uint32 dt = now_ - tLast;
            price0CumulativeLast += ((uint256(r1) << 112) / r0) * dt;
            price1CumulativeLast += ((uint256(r0) << 112) / r1) * dt;
        }
        tLast = now_;
    }
    function getReserves() external view returns (uint112, uint112, uint32) { return (r0, r1, tLast); }
}

contract PlankUsdTwapTest is Test {
    address plank = address(0xA1); address weth = address(0xB2);
    MockPair pair; MockFeed eth; PlankUsdTwap twap;
    // real pool: 88.7T PLANK / 28.1 WETH; ETH $3,333 -> PLANK = 1.0558e-9 USD -> 18-dec = 1_055_800_000
    uint112 constant R_PLANK = 88_700_000_000_000e18; // fits uint112 (max ~5.19e33)
    uint112 constant R_WETH = 28.1e18;

    function setUp() public {
        vm.warp(1_800_000_000);
        pair = new MockPair(plank, weth);
        pair.set(R_PLANK, R_WETH);
        eth = new MockFeed(3_333_00000000);
        twap = new PlankUsdTwap(address(pair), plank, address(eth));
    }

    function _price() internal view returns (uint256) { (, int256 a,,,) = twap.latestRoundData(); return uint256(a); }

    function test_reports_real_scale_price_after_window() public {
        assertEq(_price(), 0, "no window yet");
        vm.warp(block.timestamp + 24 hours); eth.set(3_333_00000000);
        twap.checkpoint();
        uint256 p = _price();
        assertApproxEqRel(p, 1_055_800_000, 1e15, "~1.0558e-9 USD per PLANK, 18 dec");
        // $0.90 of PLANK at this price ~= 852M PLANK
        uint256 plankPerTicket = 90_000_000 * 1e28 / p;
        assertApproxEqRel(plankPerTicket, 852_000_000e18, 5e15);
    }

    function test_short_spike_barely_moves_the_average() public {
        vm.warp(block.timestamp + 24 hours); eth.set(3_333_00000000); twap.checkpoint();
        uint256 before = _price();
        // someone pumps PLANK 10x for 30 minutes inside the next window
        vm.warp(block.timestamp + 23 hours); pair.set(R_PLANK, R_WETH * 10);
        vm.warp(block.timestamp + 30 minutes); pair.set(R_PLANK, R_WETH);
        vm.warp(block.timestamp + 30 minutes); eth.set(3_333_00000000); twap.checkpoint();
        uint256 after_ = _price();
        assertLt(after_, before * 125 / 100, "30 min of 10x adds < 25% to a 24h average");
        assertGt(after_, before, "but it does move a little");
    }

    function test_sustained_move_shows_up_next_window() public {
        vm.warp(block.timestamp + 24 hours); eth.set(3_333_00000000); twap.checkpoint();
        uint256 before = _price();
        pair.set(R_PLANK, R_WETH * 2); // PLANK doubles and stays
        vm.warp(block.timestamp + 24 hours); eth.set(3_333_00000000); twap.checkpoint();
        vm.warp(block.timestamp + 24 hours); eth.set(3_333_00000000); twap.checkpoint();
        assertApproxEqRel(_price(), before * 2, 1e15);
    }

    function test_stale_eth_feed_reports_zero() public {
        vm.warp(block.timestamp + 24 hours); twap.checkpoint(); // eth feed now 24h old
        assertEq(_price(), 0);
    }
}
