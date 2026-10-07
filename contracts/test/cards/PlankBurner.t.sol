// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PlankBurner} from "../../src/cards/PlankBurner.sol";
import {MockERC20, MockUSDG, MockFeed, MockPlankTwap, MockPair} from "../Mocks.sol";
import {PoolRouter} from "./Burner.t.sol";

/// PlankBurner: holds a sale's PLANK burn share when the sale's swap can't run, and burns it later. No owner, no
/// withdraw; anyone flushes; the TWAP guard and halvings decide how much can go.
contract PlankBurnerTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    MockERC20 plank;
    MockUSDG usdg;
    MockERC20 weth;
    PoolRouter router;
    MockFeed ethUsd;
    MockPlankTwap plankUsd;
    PlankBurner b;

    // ETH $3,333, PLANK $1e-9: 1 ETH = 3.333e12 PLANK.
    function setUp() public {
        vm.warp(1_800_000_000);
        plank = new MockERC20("PLANK", "PLANK");
        usdg = new MockUSDG();
        weth = new MockERC20("WETH", "WETH");
        router = new PoolRouter(address(weth));
        ethUsd = new MockFeed(3_333e8);
        plankUsd = new MockPlankTwap(1e9, address(new MockPair(address(weth), address(plank))));
        b = new PlankBurner(address(plank), address(usdg), 6, address(weth), address(router), address(ethUsd), address(plankUsd));
        router.setPool(address(weth), address(plank), 1_000 ether, 3_333e9 * 1_000 ether);
        router.setPool(address(usdg), address(weth), 3_333_000e6, 1_000 ether);
    }

    function test_noOwnerNoWithdraw() public {
        vm.deal(address(b), 1 ether);
        string[5] memory sigs = ["owner()", "withdraw()", "withdraw(address,uint256)", "transferOwnership(address)", "sweep(address)"];
        for (uint256 i; i < sigs.length; i++) {
            (bool ok,) = address(b).call(abi.encodeWithSignature(sigs[i]));
            assertFalse(ok, sigs[i]);
        }
        assertEq(address(b).balance, 1 ether, "nothing left any other way");
    }

    function test_anyoneFlushesEthIntoAPlankBurn() public {
        vm.deal(address(b), 1 ether);
        vm.prank(address(0xCAFE));
        uint256 out = b.flush(PlankBurner.Pay.ETH);
        assertEq(address(b).balance, 0);
        assertEq(plank.balanceOf(DEAD), out);
        assertGt(out, 3_333e9 * 1 ether * 95 / 100, "at least 95% of the feed's value");
        assertEq(b.flush(PlankBurner.Pay.ETH), 0, "nothing held: nothing to do");
    }

    function test_flushUsdg() public {
        usdg.mint(address(b), 100e6); // $100
        uint256 out = b.flush(PlankBurner.Pay.USDG);
        assertEq(usdg.balanceOf(address(b)), 0);
        assertEq(usdg.allowance(address(b), address(router)), 0);
        assertGt(out, 100e18 * 1e9 * 95 / 100, "$100 of PLANK at $1e-9, less fees");
        assertEq(plank.balanceOf(DEAD), out);
    }

    function test_plankHeldGoesStraightToDead() public {
        plank.mint(address(b), 5e18);
        assertEq(b.flush(PlankBurner.Pay.PLANK), 5e18);
        assertEq(plank.balanceOf(DEAD), 5e18);
    }

    function test_stalePlankPriceWaits() public {
        vm.deal(address(b), 1 ether);
        vm.warp(block.timestamp + 3 hours); // the PLANK average is 3 hours old
        ethUsd.set(3_333e8);
        assertEq(b.minPlank(PlankBurner.Pay.ETH, 1 ether), 0, "no price");
        assertEq(b.flush(PlankBurner.Pay.ETH), 0);
        assertEq(address(b).balance, 1 ether, "the share waits");
        plankUsd.setWindow(1e9, 6 days); // fresh-looking, but a 6-day average
        assertEq(b.flush(PlankBurner.Pay.ETH), 0);
        plankUsd.set(1e9);
        assertGt(b.flush(PlankBurner.Pay.ETH), 0, "a fresh price: it burns");
    }

    function test_pumpedPoolWaits() public {
        vm.deal(address(b), 1 ether);
        router.setPool(address(weth), address(plank), 1_000 ether, 3_333e9 * 900 ether); // PLANK 10% dearer in the pool
        assertEq(b.flush(PlankBurner.Pay.ETH), 0);
        assertEq(address(b).balance, 1 ether);
    }

    function test_backlogDrainsInPieces() public {
        // a shallow pool: the whole 20 ETH would move the price past the guard, a piece wouldn't
        router.setPool(address(weth), address(plank), 100 ether, 3_333e9 * 100 ether);
        vm.deal(address(b), 20 ether);
        uint256 out = b.flush(PlankBurner.Pay.ETH);
        assertGt(out, 0);
        assertLt(address(b).balance, 20 ether, "a piece went");
        assertGt(address(b).balance, 0, "the rest waits");
    }

    function test_brokenRouterWaits() public {
        vm.deal(address(b), 1 ether);
        router.setBroken(true);
        assertEq(b.flush(PlankBurner.Pay.ETH), 0);
        assertEq(address(b).balance, 1 ether);
    }

    function test_noUsdgConfigured() public {
        PlankBurner b2 = new PlankBurner(address(plank), address(0), 0, address(weth), address(router), address(ethUsd), address(plankUsd));
        vm.expectRevert(PlankBurner.BadPay.selector);
        b2.flush(PlankBurner.Pay.USDG);
        vm.expectRevert(PlankBurner.ZeroAddress.selector);
        new PlankBurner(address(plank), address(0), 0, address(weth), address(router), address(ethUsd), address(0));
    }
}
