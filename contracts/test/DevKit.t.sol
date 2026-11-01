// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DevToken, DevPress, DevKit} from "../script/dev/DevContracts.sol";
import {ERC1155} from "openzeppelin-contracts/contracts/token/ERC1155/ERC1155.sol";

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
        vm.prank(alice, alice);
        kit.claim();
        assertEq(paper.balanceOf(alice), 25 ether);
        assertEq(plank.balanceOf(alice), 1e30);
        assertEq(usdg.balanceOf(alice), 50e6);
        assertEq(press.balanceOf(alice), 1);
        assertEq(kit.nextClaim(alice), block.timestamp + 1 days);
        vm.prank(alice, alice);
        vm.expectRevert(bytes("DevKit: once a day"));
        kit.claim();
        vm.warp(block.timestamp + 1 days);
        assertEq(kit.nextClaim(alice), 0);
        vm.prank(alice, alice);
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

contract TestPacks is ERC1155 {
    constructor() ERC1155("") {}

    function mint(address to, uint256 id, uint256 n) external {
        _mint(to, id, n, "");
    }
}

/// The kit's packs: 2 sealed packs per wallet, once, while they last; only the deployer sets or takes them.
contract DevKitPacksTest is Test {
    DevToken paper;
    DevToken plank;
    DevToken usdg;
    DevPress press;
    DevKit kit;
    TestPacks packs;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

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
        packs = new TestPacks();
    }

    function test_packs_twoPerWallet_once_whileTheyLast() public {
        // alice claims before there are packs: tokens only
        vm.prank(alice, alice);
        kit.claim();
        assertEq(kit.packsFor(alice), 0);
        packs.mint(address(kit), 1, 5);
        kit.setPacks(packs, 1, 2);
        // the packs came: alice gets them the same day (no tokens again)
        assertEq(kit.nextClaim(alice), 0);
        assertEq(kit.packsFor(alice), 2);
        vm.prank(alice, alice);
        kit.claim();
        assertEq(packs.balanceOf(alice, 1), 2);
        assertEq(paper.balanceOf(alice), 25 ether, "no second day of tokens");
        vm.prank(alice, alice);
        vm.expectRevert(bytes("DevKit: once a day"));
        kit.claim();
        // bob: tokens, press and packs in one claim
        vm.prank(bob, bob);
        kit.claim();
        assertEq(packs.balanceOf(bob, 1), 2);
        assertEq(press.balanceOf(bob), 1);
        // 1 left: carol gets tokens, no packs
        assertEq(kit.packsLeft(), 1);
        assertEq(kit.packsFor(carol), 0);
        vm.prank(carol, carol);
        kit.claim();
        assertEq(packs.balanceOf(carol, 1), 0);
        assertEq(paper.balanceOf(carol), 25 ether);
        // a day later alice gets tokens but never packs again
        vm.warp(block.timestamp + 1 days);
        packs.mint(address(kit), 1, 10);
        vm.prank(alice, alice);
        kit.claim();
        assertEq(packs.balanceOf(alice, 1), 2, "packs once per wallet");
    }

    function test_claim_fromWalletsOnly() public {
        packs.mint(address(kit), 1, 4);
        kit.setPacks(packs, 1, 2);
        vm.expectRevert(bytes("DevKit: from your own wallet"));
        kit.claim(); // this test contract is not tx.origin
        vm.prank(alice, alice);
        kit.claim();
        assertEq(packs.balanceOf(alice, 1), 2);
        // a friend's smart wallet, let in by the deployer
        address smart = makeAddr("smart");
        vm.prank(smart);
        vm.expectRevert(bytes("DevKit: from your own wallet"));
        kit.claim();
        vm.prank(alice);
        vm.expectRevert(bytes("dev: owner only"));
        kit.setSmartWallet(smart, true);
        kit.setSmartWallet(smart, true);
        vm.prank(smart);
        kit.claim();
        assertEq(packs.balanceOf(smart, 1), 2);
    }

    function test_packs_onlyTheDeployer() public {
        packs.mint(address(kit), 1, 4);
        vm.startPrank(alice);
        vm.expectRevert(bytes("dev: owner only"));
        kit.setPacks(packs, 1, 4);
        vm.stopPrank();
        kit.setPacks(packs, 1, 2);
        vm.prank(alice);
        vm.expectRevert(bytes("dev: owner only"));
        kit.takePacks(alice, 4);
        kit.takePacks(address(this), 4);
        assertEq(packs.balanceOf(address(this), 1), 4);
        assertEq(kit.packsLeft(), 0);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
}
