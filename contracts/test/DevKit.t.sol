// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DevToken, DevPress, DevKit} from "../script/dev/DevContracts.sol";

/// The testnet's test kit: test tokens once a day, a Paper Press once per wallet, nobody else can mint.
contract DevKitTest is Test {
    DevToken paper;
    DevToken plank;
    DevToken usdg;
    DevPress press;
    DevKit kit;
    address alice = makeAddr("alice");

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new DevToken("PAPER (test)", "PAPER", 18);
        plank = new DevToken("PLANK (test)", "PLANK", 18);
        usdg = new DevToken("Global Dollar (test)", "USDG", 6);
        press = new DevPress();
        kit = new DevKit(paper, plank, usdg, press);
        paper.setMinter(address(kit), true);
        plank.setMinter(address(kit), true);
        usdg.setMinter(address(kit), true);
        press.setMinter(address(kit), true);
    }

    function test_claim_onceADay_pressOnce() public {
        vm.prank(alice);
        kit.claim();
        assertEq(paper.balanceOf(alice), 25 ether);
        assertEq(plank.balanceOf(alice), 1e30);
        assertEq(usdg.balanceOf(alice), 50e6);
        assertEq(press.balanceOf(alice), 1);
        assertEq(kit.nextClaim(alice), block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(bytes("DevKit: once a day"));
        kit.claim();
        vm.warp(block.timestamp + 1 days);
        assertEq(kit.nextClaim(alice), 0);
        vm.prank(alice);
        kit.claim();
        assertEq(paper.balanceOf(alice), 50 ether);
        assertEq(press.balanceOf(alice), 1, "one Paper Press per wallet");
    }

    function test_nobodyElseMints() public {
        vm.startPrank(alice);
        vm.expectRevert(bytes("dev: owner only"));
        paper.mint(alice, 1);
        vm.expectRevert(bytes("dev: owner only"));
        press.mint(alice);
        vm.expectRevert(bytes("dev: owner only"));
        press.setMinter(alice, true);
        vm.stopPrank();
    }
}
