// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";

/**
 * @title Profiles
 * @notice A name and a picture for a wallet, shown by the site wherever an address would be.
 *         One profile per address, set only by that address. No owner, no moderation, no fees.
 *
 *         `pfp` is either an image URL (https:// or ipfs://) or "mill:<tokenId>" — a Paper Mill the wallet
 *         held when it set the picture (checked at set time; the site re-checks ownership when it renders).
 *         Names are not unique: the site shows the address on hover, and the address is what wins.
 */
contract Profiles {
    struct Profile { string name; string pfp; }

    uint256 public constant MAX_NAME = 24; // bytes
    uint256 public constant MAX_PFP = 256; // bytes

    IERC721 public immutable MILL;
    mapping(address => Profile) private _profiles;

    event ProfileSet(address indexed who, string name, string pfp);

    error TooLong();
    error NotYourMill();
    error BadName();

    constructor(IERC721 mill) { MILL = mill; }

    /// @notice Set your name and picture. Empty strings clear.
    function set(string calldata name, string calldata pfp) external {
        _check(name, pfp);
        _profiles[msg.sender] = Profile(name, pfp);
        emit ProfileSet(msg.sender, name, pfp);
    }

    /// @notice Set your name and use a mill you hold as the picture.
    function setWithMill(string calldata name, uint256 tokenId) external {
        if (MILL.ownerOf(tokenId) != msg.sender) revert NotYourMill();
        string memory pfp = string.concat("mill:", _u(tokenId));
        _check(name, pfp);
        _profiles[msg.sender] = Profile(name, pfp);
        emit ProfileSet(msg.sender, name, pfp);
    }

    function get(address who) external view returns (Profile memory) { return _profiles[who]; }

    function getMany(address[] calldata whos) external view returns (Profile[] memory out) {
        out = new Profile[](whos.length);
        for (uint256 i; i < whos.length; i++) out[i] = _profiles[whos[i]];
    }

    function _check(string memory name, string memory pfp) internal pure {
        bytes memory b = bytes(name);
        if (b.length > MAX_NAME || bytes(pfp).length > MAX_PFP) revert TooLong();
        for (uint256 i; i < b.length; i++) {
            // printable ASCII only, no leading/trailing space; keeps names readable and un-spoofable with lookalikes
            if (b[i] < 0x20 || b[i] > 0x7e) revert BadName();
        }
        if (b.length > 0 && (b[0] == 0x20 || b[b.length - 1] == 0x20)) revert BadName();
    }

    function _u(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 n = v; uint256 len; while (n != 0) { len++; n /= 10; }
        bytes memory out = new bytes(len);
        while (v != 0) { out[--len] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(out);
    }
}
