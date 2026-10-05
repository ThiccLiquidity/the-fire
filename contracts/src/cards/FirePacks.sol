// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "openzeppelin-contracts/contracts/token/ERC1155/ERC1155.sol";
import {ERC2981} from "openzeppelin-contracts/contracts/token/common/ERC2981.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

/**
 * @notice Sealed packs. One stackable token type per Series (token id = Series number), so "Series 7 Sealed Pack x 3"
 *         lists and trades like any item and each Series has its own floor. Contents are not decided until a pack is
 *         opened (FireCards), so a sealed pack carries no hidden information anyone could read.
 *
 *         Only the seller (the pack sale contract) mints, and only the card contract burns, when a pack is opened.
 *         The owner sets those two addresses once, the pack art location, and the royalty.
 */
contract FirePacks is ERC1155, ERC2981, Ownable2Step {
    using Strings for uint256;

    address public seller;
    address public cards;
    /// @dev Pack art: <packImageBase>fire<N>.webp, one image per Series (the master graphic with the Series number).
    string public packImageBase;
    mapping(uint256 fire => uint256) public minted;
    mapping(uint256 fire => uint256) public burned;

    event SellerSet(address seller);
    event CardsSet(address cards);
    event PackImageBaseSet(string base);
    event RoyaltySet(address receiver, uint96 bps);

    error AlreadySet();
    error NotSeller();
    error NotCards();
    error ZeroAddress();
    error RoyaltyTooHigh();

    /// @notice Collection name and symbol (ERC-1155 has none; marketplaces read these).
    string public constant name = "Omni Card Packs";
    string public constant symbol = "OMNIPACK";

    constructor(address owner_) ERC1155("") Ownable(owner_) {}

    // ---------- owner setup (each address once) ----------

    function setSeller(address s) external onlyOwner {
        if (seller != address(0)) revert AlreadySet();
        if (s == address(0)) revert ZeroAddress();
        seller = s;
        emit SellerSet(s);
    }

    function setCards(address c) external onlyOwner {
        if (cards != address(0)) revert AlreadySet();
        if (c == address(0)) revert ZeroAddress();
        cards = c;
        emit CardsSet(c);
    }

    function setPackImageBase(string calldata base) external onlyOwner {
        packImageBase = base;
        emit PackImageBaseSet(base);
    }

    function setDefaultRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (bps > 1_000) revert RoyaltyTooHigh(); // 10% at most
        emit RoyaltySet(receiver, bps);
        _setDefaultRoyalty(receiver, bps);
    }

    // ---------- seller / cards ----------

    function mint(address to, uint256 fire, uint256 amount) external {
        if (msg.sender != seller) revert NotSeller();
        minted[fire] += amount;
        _mint(to, fire, amount, "");
    }

    /// @notice Opening a pack: the card contract burns it from the holder (no approval needed: the holder called open).
    function burnForOpen(address from, uint256 fire, uint256 amount) external {
        if (msg.sender != cards) revert NotCards();
        burned[fire] += amount;
        _burn(from, fire, amount);
    }

    /// @notice A cancelled open (randomness gone for good) gives its packs back, sealed. Only the card contract.
    function returnPacks(address to, uint256 fire, uint256 amount) external {
        if (msg.sender != cards) revert NotCards();
        burned[fire] -= amount;
        _mint(to, fire, amount, "");
    }

    // ---------- metadata ----------

    function uri(uint256 fire) public view override returns (string memory) {
        string memory n = fire.toString();
        bytes memory json = abi.encodePacked(
            '{"name":"Omni Card Pack \u00b7 Series ', n,
            '","description":"A sealed pack of 6 cards from Series ', n,
            '. What is inside is decided only when it is opened.","image":"', packImageBase, 'fire', n,
            '.webp","attributes":[{"trait_type":"Series","value":', n, ',"display_type":"number"},{"trait_type":"State","value":"Sealed"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    function supportsInterface(bytes4 id) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }
}
