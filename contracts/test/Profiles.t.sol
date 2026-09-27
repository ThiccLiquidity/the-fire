// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {Profiles} from "../src/Profiles.sol";
import {MockERC20, MockMill} from "./Mocks.sol";

contract ProfilesTest is Test {
    Profiles p; MockMill mill; MockERC20 plank;
    address alice = address(0xA11CE); address bob = address(0xB0B);

    function setUp() public {
        plank = new MockERC20("PLANK", "PLANK");
        mill = new MockMill(address(plank), 1e18);
        p = new Profiles(IERC721(address(mill)));
        plank.mint(address(this), 10e18); plank.approve(address(mill), 10e18);
        mill.mint(alice); // tokenId 1
    }

    function test_setAndGet() public {
        vm.prank(alice); p.set("plankdaddy", "https://x.y/z.png");
        Profiles.Profile memory pr = p.get(alice);
        assertEq(pr.name, "plankdaddy"); assertEq(pr.pfp, "https://x.y/z.png");
        assertEq(p.get(bob).name, "");
    }

    function test_onlySelf() public {
        vm.prank(alice); p.set("a", "");
        vm.prank(bob); p.set("b", "");
        assertEq(p.get(alice).name, "a"); assertEq(p.get(bob).name, "b");
    }

    function test_millPfp() public {
        vm.prank(alice); p.setWithMill("miller", 1);
        assertEq(p.get(alice).pfp, "mill:1");
        vm.prank(bob); vm.expectRevert(Profiles.NotYourMill.selector); p.setWithMill("thief", 1);
    }

    function test_limits() public {
        vm.startPrank(alice);
        vm.expectRevert(Profiles.TooLong.selector); p.set("this name is far too long to fit", "");
        vm.expectRevert(Profiles.BadName.selector); p.set(" lead", "");
        vm.expectRevert(Profiles.BadName.selector); p.set(unicode"zero​width", "");
        p.set("", ""); // clearing is fine
        vm.stopPrank();
    }

    function test_getMany() public {
        vm.prank(alice); p.set("a", "");
        address[] memory w = new address[](2); w[0] = alice; w[1] = bob;
        Profiles.Profile[] memory out = p.getMany(w);
        assertEq(out[0].name, "a"); assertEq(out[1].name, "");
    }
}
