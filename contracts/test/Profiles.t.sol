// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Profiles} from "../src/Profiles.sol";

contract ProfilesTest is Test {
    Profiles p;
    address alice = address(0xA11CE); address bob = address(0xB0B);

    event ProfileSet(address indexed who, string name, bytes image);

    function setUp() public { p = new Profiles(); }

    function test_setAndGet() public {
        bytes memory img = hex"52494646deadbeef57454250";
        vm.expectEmit(true, false, false, true); emit ProfileSet(alice, "plankdaddy", img);
        vm.prank(alice); p.set("plankdaddy", img);
        Profiles.Profile memory pr = p.get(alice);
        assertEq(pr.name, "plankdaddy"); assertEq(pr.imageHash, keccak256(img));
        assertEq(p.get(bob).name, ""); assertEq(p.get(bob).imageHash, bytes32(0));
    }

    function test_onlySelf() public {
        vm.prank(alice); p.set("a", "");
        vm.prank(bob); p.set("b", "");
        assertEq(p.get(alice).name, "a"); assertEq(p.get(bob).name, "b");
    }

    function test_limits() public {
        vm.startPrank(alice);
        vm.expectRevert(Profiles.TooLong.selector); p.set("this name is far too long to fit", "");
        vm.expectRevert(Profiles.TooLong.selector); p.set("x", new bytes(12_001));
        vm.expectRevert(Profiles.BadName.selector); p.set(" lead", "");
        vm.expectRevert(Profiles.BadName.selector); p.set(unicode"zero​width", "");
        p.set("x", new bytes(12_000));
        p.set("", ""); // clearing is fine
        assertEq(p.get(alice).imageHash, bytes32(0));
        vm.stopPrank();
    }

    function test_getMany() public {
        vm.prank(alice); p.set("a", "");
        address[] memory w = new address[](2); w[0] = alice; w[1] = bob;
        Profiles.Profile[] memory out = p.getMany(w);
        assertEq(out[0].name, "a"); assertEq(out[1].name, "");
    }

    function test_gas_typical_image() public {
        vm.prank(alice); uint256 g = gasleft(); p.set("plankdaddy", new bytes(6_000)); g -= gasleft();
        assertLt(g, 400_000); // ~cents at 0.02 gwei
    }
}
