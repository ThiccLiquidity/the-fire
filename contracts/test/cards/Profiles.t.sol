// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {FireProfiles} from "../../src/cards/FireProfiles.sol";

/// @dev Stands in for FireCards: a plain ERC-721 anyone can mint.
contract ProfileCards is ERC721("Cards", "C") {
    function mint(address to, uint256 id) external {
        _mint(to, id);
    }
}

contract ProfilesTest is Test {
    event ProfileSet(address indexed user, string name, uint256 pfpCard, uint64 crop);
    event ProfileCleared(address indexed user);

    ProfileCards cards;
    FireProfiles prof;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        cards = new ProfileCards();
        prof = new FireProfiles(address(cards));
        cards.mint(alice, 7);
        cards.mint(bob, 8);
    }

    function _set(address who, string memory name, uint256 pfp, uint64 crop) internal {
        vm.prank(who);
        prof.setProfile(name, pfp, crop);
    }

    function _name(address who) internal view returns (string memory n) {
        (n,,,) = prof.profileOf(who);
    }

    function test_constructor() public {
        assertEq(address(prof.CARDS()), address(cards));
        vm.expectRevert();
        new FireProfiles(address(0));
    }

    function test_setAndRead() public {
        vm.warp(1_000_000);
        uint64 crop = uint64(0x0000_8000_4000_C000);
        vm.expectEmit(true, false, false, true, address(prof));
        emit ProfileSet(alice, "Alice", 7, crop);
        _set(alice, "Alice", 7, crop);
        (string memory n, uint256 pfp, uint64 c, uint64 upd) = prof.profileOf(alice);
        assertEq(n, "Alice");
        assertEq(pfp, 7);
        assertEq(c, crop);
        assertEq(upd, 1_000_000);
        assertTrue(prof.pfpValid(alice));
        assertEq(prof.ownerOfName("alice"), alice);
        assertEq(prof.ownerOfName("ALICE"), alice);
        assertEq(prof.ownerOfName("Bob"), address(0));
    }

    function test_noPicture() public {
        _set(alice, "Al", 0, 0);
        assertFalse(prof.pfpValid(alice));
        (, uint256 pfp,,) = prof.profileOf(alice);
        assertEq(pfp, 0);
    }

    function test_emptyProfile() public view {
        (string memory n, uint256 pfp, uint64 c, uint64 upd) = prof.profileOf(bob);
        assertEq(bytes(n).length, 0);
        assertEq(pfp + c + upd, 0);
        assertFalse(prof.pfpValid(bob));
    }

    function test_nameRules() public {
        string[12] memory good = ["a", "A", "12345678901234567890", "Mr Fire", "a b c d", "~!@#$%^&*()", "x_y-z.", "Z Z", "0x", "{}|", "a`b", "Hello World 99"];
        for (uint256 i; i < good.length; i++) {
            assertTrue(prof.validName(good[i]), good[i]);
        }
        string[12] memory bad = ["", " a", "a ", "a  b", "123456789012345678901", "tab\there", "new\nline", unicode"café", " ", "a\x7f", "nul\x00", "  "];
        for (uint256 i; i < bad.length; i++) {
            assertFalse(prof.validName(bad[i]), bad[i]);
            vm.prank(alice);
            vm.expectRevert(FireProfiles.BadName.selector);
            prof.setProfile(bad[i], 0, 0);
            assertEq(prof.ownerOfName(bad[i]), address(0));
        }
    }

    function test_uniqueIgnoringCase() public {
        _set(alice, "Fire Kid", 0, 0);
        vm.prank(bob);
        vm.expectRevert(FireProfiles.NameTaken.selector);
        prof.setProfile("fIRE kID", 0, 0);
        vm.prank(bob);
        vm.expectRevert(FireProfiles.NameTaken.selector);
        prof.setProfile("Fire Kid", 0, 0);
        // a different name that only looks close is fine (no filtering)
        _set(bob, "Fire_Kid", 0, 0);
        assertEq(prof.ownerOfName("fire_kid"), bob);
    }

    function test_ownerChangesCaseOfOwnName() public {
        _set(alice, "fire", 0, 0);
        _set(alice, "FIRE", 7, 1);
        assertEq(_name(alice), "FIRE");
        assertEq(prof.ownerOfName("Fire"), alice);
    }

    function test_renameFreesOldName() public {
        _set(alice, "Old Name", 0, 0);
        _set(alice, "New Name", 0, 0);
        assertEq(prof.ownerOfName("old name"), address(0));
        assertEq(prof.ownerOfName("new name"), alice);
        _set(bob, "OLD NAME", 0, 0);
        assertEq(prof.ownerOfName("Old Name"), bob);
        // and alice can't go back to it
        vm.prank(alice);
        vm.expectRevert(FireProfiles.NameTaken.selector);
        prof.setProfile("old name", 0, 0);
        assertEq(_name(alice), "New Name");
    }

    function test_pfpMustBeOwned() public {
        vm.prank(alice);
        vm.expectRevert(FireProfiles.NotYourCard.selector);
        prof.setProfile("Alice", 8, 0); // bob's
        vm.prank(alice);
        vm.expectRevert(FireProfiles.NotYourCard.selector);
        prof.setProfile("Alice", 99, 0); // doesn't exist
        vm.prank(alice);
        vm.expectRevert(FireProfiles.NotYourCard.selector);
        prof.setProfile("Alice", uint256(type(uint128).max) + 7, 0);
        assertEq(prof.ownerOfName("alice"), address(0)); // nothing changed
    }

    function test_pfpSoldGoesInvalid() public {
        _set(alice, "Alice", 7, 5);
        vm.prank(alice);
        cards.transferFrom(alice, bob, 7);
        assertFalse(prof.pfpValid(alice));
        (, uint256 pfp,,) = prof.profileOf(alice);
        assertEq(pfp, 7); // still stored; the site shows it only while held
        address[] memory us = new address[](1);
        us[0] = alice;
        assertFalse(prof.profilesOf(us)[0].pfpOk);
        // bought back: valid again
        vm.prank(bob);
        cards.transferFrom(bob, alice, 7);
        assertTrue(prof.pfpValid(alice));
    }

    function test_clear() public {
        _set(alice, "Alice", 7, 9);
        vm.expectEmit(true, false, false, true, address(prof));
        emit ProfileCleared(alice);
        vm.prank(alice);
        prof.clear();
        (string memory n, uint256 pfp, uint64 c, uint64 upd) = prof.profileOf(alice);
        assertEq(bytes(n).length, 0);
        assertEq(pfp + c + upd, 0);
        assertEq(prof.ownerOfName("alice"), address(0));
        _set(bob, "ALICE", 0, 0);
        assertEq(prof.ownerOfName("alice"), bob);
        // clearing with no profile is harmless
        vm.prank(alice);
        prof.clear();
        assertEq(prof.ownerOfName("alice"), bob);
    }

    function test_profilesOfBatch() public {
        _set(alice, "Alice", 7, 11);
        _set(bob, "Bob", 0, 0);
        address[] memory us = new address[](3);
        (us[0], us[1], us[2]) = (alice, bob, makeAddr("nobody"));
        FireProfiles.Profile[] memory ps = prof.profilesOf(us);
        assertEq(ps.length, 3);
        assertEq(ps[0].name, "Alice");
        assertEq(ps[0].pfpCard, 7);
        assertEq(ps[0].crop, 11);
        assertTrue(ps[0].pfpOk);
        assertEq(ps[1].name, "Bob");
        assertFalse(ps[1].pfpOk);
        assertEq(bytes(ps[2].name).length, 0);
    }

    function test_gas() public {
        vm.prank(alice);
        uint256 g = gasleft();
        prof.setProfile("Twenty Chars Name 01", 7, type(uint64).max);
        uint256 first = g - gasleft();
        vm.prank(alice);
        g = gasleft();
        prof.setProfile("Twenty Chars Name 01", 7, 1);
        uint256 again = g - gasleft();
        emit log_named_uint("setProfile first (execution gas)", first);
        emit log_named_uint("setProfile again, same name", again);
        assertLt(first, 100_000);
        assertLt(again, 20_000);
    }

    /// Any valid name round-trips and is unique ignoring case; any byte string outside the rules is refused.
    function testFuzz_names(bytes memory raw) public {
        bool expect = _ref(raw);
        string memory name = string(raw);
        assertEq(prof.validName(name), expect);
        vm.prank(alice);
        if (!expect) vm.expectRevert(FireProfiles.BadName.selector);
        prof.setProfile(name, 0, 0);
        if (!expect) return;
        assertEq(_name(alice), name);
        assertEq(prof.ownerOfName(name), alice);
        // the same name in another case is taken
        bytes memory flipped = bytes(raw);
        for (uint256 i; i < flipped.length; i++) {
            uint8 c = uint8(flipped[i]);
            if (c >= 0x41 && c <= 0x5a) flipped[i] = bytes1(c + 32);
            else if (c >= 0x61 && c <= 0x7a) flipped[i] = bytes1(c - 32);
        }
        assertEq(prof.ownerOfName(string(flipped)), alice);
        vm.prank(bob);
        vm.expectRevert(FireProfiles.NameTaken.selector);
        prof.setProfile(string(flipped), 0, 0);
    }

    /// Fuzz from printable bytes, so most inputs are valid and exercise uniqueness, renames and clears.
    function testFuzz_printableNames(uint256 seedA, uint256 seedB, uint8 lenA, uint8 lenB) public {
        string memory a = _printable(seedA, 1 + (lenA % 20));
        string memory b = _printable(seedB, 1 + (lenB % 20));
        bool okA = _ref(bytes(a));
        bool okB = _ref(bytes(b));
        vm.assume(okA && okB);
        _set(alice, a, 0, 0);
        vm.prank(bob);
        if (_same(a, b)) vm.expectRevert(FireProfiles.NameTaken.selector);
        prof.setProfile(b, 0, 0);
        if (_same(a, b)) return;
        // alice renames to something new: a is free, bob can take it
        _set(alice, "zz renamed zz", 0, 0);
        assertEq(prof.ownerOfName(a), address(0));
        _set(bob, a, 0, 0);
        assertEq(prof.ownerOfName(a), bob);
        assertEq(prof.ownerOfName(b), address(0));
        vm.prank(bob);
        prof.clear();
        assertEq(prof.ownerOfName(a), address(0));
    }

    function _printable(uint256 seed, uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i; i < n; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            b[i] = bytes1(uint8(0x20 + (seed % 95)));
        }
        return string(b);
    }

    function _same(string memory a, string memory b) internal pure returns (bool) {
        bytes memory x = bytes(a);
        bytes memory y = bytes(b);
        if (x.length != y.length) return false;
        for (uint256 i; i < x.length; i++) {
            if (_lower(uint8(x[i])) != _lower(uint8(y[i]))) return false;
        }
        return true;
    }

    function _lower(uint8 c) internal pure returns (uint8) {
        return c >= 0x41 && c <= 0x5a ? c + 32 : c;
    }

    /// The rules written the plain way.
    function _ref(bytes memory b) internal pure returns (bool) {
        if (b.length == 0 || b.length > 20) return false;
        if (b[0] == " " || b[b.length - 1] == " ") return false;
        for (uint256 i; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            if (c == 0x20) {
                if (b[i - 1] == " ") return false;
            } else if (c < 0x21 || c > 0x7e) {
                return false;
            }
        }
        return true;
    }
}
