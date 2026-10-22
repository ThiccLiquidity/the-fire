// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IProfileCards {
    function ownerOf(uint256 id) external view returns (address);
}

/**
 * @title FireProfiles
 * @notice A wallet's public profile on Omni Cardworks: a name and a profile picture cut from one of its own cards.
 *         No owner, no fees, no admin, no upgrade: each wallet writes only its own profile.
 *
 *         Name: 1 to 20 bytes of printable ASCII (0x21-0x7E), plus single spaces between words (none leading, trailing
 *         or doubled). Unique ignoring case (A-Z = a-z), so nobody can take a name that only differs in case. Changing
 *         your name or clearing your profile frees the old one for anyone. No word filter.
 *
 *         Picture: `pfpCard` is a FireCards token id the caller holds when setting it (0 = none). The card can be sold
 *         later; `pfpValid` / `profilesOf` say whether the wallet still holds it, and the site shows the picture only
 *         while it does. `crop` is the site's framing of the card's art, packed into 64 bits: x (bits 0-15) and y
 *         (16-31) of the circle's centre as 0..65535 = 0..1 across the art, zoom (32-47) as 0..65535 = 1x..4x, and 16
 *         reserved bits. The contract stores it as given.
 */
contract FireProfiles {
    uint256 public constant MAX_NAME = 20;

    IProfileCards public immutable CARDS;

    /// @dev One slot per profile, plus its name (a short string: one slot) and the name's owner by its key.
    struct Packed {
        uint128 pfp;
        uint64 crop;
        uint64 updated;
    }

    /// @notice What `profilesOf` returns per wallet. `pfpOk`: the wallet still holds `pfpCard`.
    struct Profile {
        string name;
        uint256 pfpCard;
        uint64 crop;
        uint64 updated;
        bool pfpOk;
    }

    mapping(address => Packed) internal _packed;
    mapping(address => string) internal _name;
    /// @dev Lower-cased name, left-aligned in a word (names are at most 20 nonzero bytes, so this is one-to-one).
    mapping(bytes32 => address) internal _byKey;

    event ProfileSet(address indexed user, string name, uint256 pfpCard, uint64 crop);
    event ProfileCleared(address indexed user);

    error BadName();
    error NameTaken();
    error NotYourCard();

    constructor(address cards) {
        require(cards != address(0));
        CARDS = IProfileCards(cards);
    }

    /// @notice Set (or change) your name, picture and its framing, in one go.
    function setProfile(string calldata name, uint256 pfpCard, uint64 crop) external {
        (bytes32 key, bool ok) = _key(bytes(name));
        if (!ok) revert BadName();
        address taken = _byKey[key];
        if (taken != msg.sender) {
            if (taken != address(0)) revert NameTaken();
            _byKey[key] = msg.sender;
            string storage old = _name[msg.sender];
            if (bytes(old).length != 0) {
                (bytes32 oldKey,) = _key(bytes(old));
                delete _byKey[oldKey];
            }
        }
        if (pfpCard != 0 && (pfpCard > type(uint128).max || _holder(pfpCard) != msg.sender)) revert NotYourCard();
        _name[msg.sender] = name;
        // forge-lint: disable-next-line(unsafe-typecast)
        _packed[msg.sender] = Packed({pfp: uint128(pfpCard), crop: crop, updated: uint64(block.timestamp)}); // pfpCard checked above
        emit ProfileSet(msg.sender, name, pfpCard, crop);
    }

    /// @notice Remove your profile; your name is free for anyone again.
    function clear() external {
        string storage old = _name[msg.sender];
        if (bytes(old).length != 0) {
            (bytes32 key,) = _key(bytes(old));
            delete _byKey[key];
        }
        delete _name[msg.sender];
        delete _packed[msg.sender];
        emit ProfileCleared(msg.sender);
    }

    /// @notice A wallet's profile (empty name and 0s when it has none). The picture may since have left the wallet:
    ///         see `pfpValid`.
    function profileOf(address user) external view returns (string memory name, uint256 pfpCard, uint64 crop, uint64 updated) {
        Packed memory p = _packed[user];
        return (_name[user], p.pfp, p.crop, p.updated);
    }

    /// @notice Does `user` have a picture set and still hold that card?
    function pfpValid(address user) public view returns (bool) {
        uint256 id = _packed[user].pfp;
        return id != 0 && _holder(id) == user;
    }

    /// @notice Many profiles in one call, each with whether its picture is still held.
    function profilesOf(address[] calldata users) external view returns (Profile[] memory out) {
        out = new Profile[](users.length);
        for (uint256 i; i < users.length; i++) {
            Packed memory p = _packed[users[i]];
            out[i] = Profile({
                name: _name[users[i]], pfpCard: p.pfp, crop: p.crop, updated: p.updated, pfpOk: p.pfp != 0 && _holder(p.pfp) == users[i]
            });
        }
    }

    /// @notice Who holds this name (any case), or address(0).
    function ownerOfName(string calldata name) external view returns (address) {
        (bytes32 key, bool ok) = _key(bytes(name));
        return ok ? _byKey[key] : address(0);
    }

    /// @notice Is this a valid name (not whether it's free: `ownerOfName`)?
    function validName(string calldata name) external pure returns (bool ok) {
        (, ok) = _key(bytes(name));
    }

    /// @dev The name's key (lower-cased, left-aligned) and whether it follows the rules.
    function _key(bytes memory b) internal pure returns (bytes32 key, bool ok) {
        uint256 n = b.length;
        if (n == 0 || n > MAX_NAME) return (0, false);
        uint256 w;
        uint256 prev;
        for (uint256 i; i < n; i++) {
            uint256 c = uint8(b[i]);
            if (c == 0x20) {
                if (i == 0 || i == n - 1 || prev == 0x20) return (0, false);
            } else if (c < 0x21 || c > 0x7e) {
                return (0, false);
            } else if (c >= 0x41 && c <= 0x5a) {
                c += 0x20;
            }
            w |= c << (248 - 8 * i);
            prev = c;
        }
        return (bytes32(w), true);
    }

    /// @dev The card's holder, or address(0) when it doesn't exist (ownerOf reverts).
    function _holder(uint256 id) internal view returns (address who) {
        (bool success, bytes memory ret) = address(CARDS).staticcall(abi.encodeCall(IProfileCards.ownerOf, (id)));
        if (success && ret.length >= 32) who = abi.decode(ret, (address));
    }
}
