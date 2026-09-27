// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Profiles
 * @notice A name and a picture for a wallet, shown by the site wherever an address would be.
 *         One profile per address, set only by that address. No owner, no moderation, no fees.
 *
 *         The picture travels in the event log, not in storage: the site indexes ProfileSet events and
 *         renders the bytes. Only its hash is stored, so anyone can check a picture against the chain.
 *         Gas is cheap enough here that a 128x128 WebP (a few KB) costs about a cent.
 *         Names are not unique: the site shows the address on hover, and the address is what wins.
 */
contract Profiles {
    struct Profile { string name; bytes32 imageHash; }

    uint256 public constant MAX_NAME = 24; // bytes
    uint256 public constant MAX_IMAGE = 12_000; // bytes

    mapping(address => Profile) private _profiles;

    event ProfileSet(address indexed who, string name, bytes image);

    error TooLong();
    error BadName();

    /// @notice Set your name and picture. Empty strings/bytes clear.
    function set(string calldata name, bytes calldata image) external {
        bytes memory b = bytes(name);
        if (b.length > MAX_NAME || image.length > MAX_IMAGE) revert TooLong();
        for (uint256 i; i < b.length; i++) {
            // printable ASCII only, no leading/trailing space; keeps names readable and un-spoofable with lookalikes
            if (b[i] < 0x20 || b[i] > 0x7e) revert BadName();
        }
        if (b.length > 0 && (b[0] == 0x20 || b[b.length - 1] == 0x20)) revert BadName();
        _profiles[msg.sender] = Profile(name, image.length == 0 ? bytes32(0) : keccak256(image));
        emit ProfileSet(msg.sender, name, image);
    }

    function get(address who) external view returns (Profile memory) { return _profiles[who]; }

    function getMany(address[] calldata whos) external view returns (Profile[] memory out) {
        out = new Profile[](whos.length);
        for (uint256 i; i < whos.length; i++) out[i] = _profiles[whos[i]];
    }
}
