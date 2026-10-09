// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1155} from "openzeppelin-contracts/contracts/token/ERC1155/ERC1155.sol";
import {ERC2981} from "openzeppelin-contracts/contracts/token/common/ERC2981.sol";
import {Ownable2Step, Ownable} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

interface IPacksCards {
    function cardsPerPack(uint256 fire) external view returns (uint256);
}

/**
 * @title FirePacks
 * @notice Sealed packs. One stackable token type per Series (token id = Series number), so "Series 7 Sealed Pack x 3"
 *         lists and trades like any item and each Series has its own floor. Contents are not decided until a pack is
 *         opened (FireCards), so a sealed pack carries no hidden information anyone could read.
 *
 *         How many cards a pack holds is up to the Series' recipe (FireCards and its dealer); the description says.
 *         Only the seller (the pack sale contract) mints, and only the card contract burns, when a pack is opened.
 *         The owner sets those two addresses once, the pack art location, and the royalty.
 */
contract FirePacks is ERC1155, ERC2981, Ownable2Step {
    using Strings for uint256;

    address public seller;
    address public cards;
    /// @dev Pack art: <packImageBase>fire<N>.webp, one image per Series (the master graphic with the Series number).
    string public packImageBase;
    /// @notice Collection metadata (ERC-7572), set by the owner.
    string public contractURI;
    mapping(uint256 fire => uint256) public minted;
    mapping(uint256 fire => uint256) public burned;

    event SellerSet(address seller);
    event CardsSet(address cards);
    event PackImageBaseSet(string base);
    event RoyaltySet(address receiver, uint96 bps);
    event ContractURIUpdated(); // ERC-7572

    error AlreadySet();
    error NotSeller();
    error NotCards();
    error ZeroAddress();
    error RoyaltyTooHigh();
    error BadText();
    error TooMany();
    error RenounceDisabled();

    /// @notice Collection name and symbol (ERC-1155 has none; marketplaces read these).
    string public constant name = "Omni Card Packs";
    string public constant symbol = "OMNIPACK";

    constructor(address owner_) ERC1155("") Ownable(owner_) {}

    // ---------- owner setup (each address once) ----------

    /// @notice Ownership can be handed over (two steps) but never renounced, so control can't be lost by mistake.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Collection metadata for marketplaces (ERC-7572).
    function setContractURI(string calldata uri_) external onlyOwner {
        contractURI = uri_;
        emit ContractURIUpdated();
    }

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

    /// @notice Where the pack art lives (ipfs://<CID>/ or ar://<id>/). It goes into JSON as-is: no quotes,
    ///         backslashes or control characters.
    function setPackImageBase(string calldata base) external onlyOwner {
        bytes calldata b = bytes(base);
        for (uint256 i; i < b.length; i++) {
            if (b[i] == '"' || b[i] == "\\" || uint8(b[i]) < 0x20) revert BadText();
        }
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
        // a Series' pack count is kept in 64 bits from here on (a technical ceiling, not a product limit)
        if (minted[fire] + amount > type(uint64).max) revert TooMany();
        minted[fire] += amount;
        _mint(to, fire, amount, "");
    }

    /// @notice Opening a pack: the card contract burns it from the holder (no approval needed: the holder called open).
    function burnForOpen(address from, uint256 fire, uint256 amount) external {
        if (msg.sender != cards) revert NotCards();
        burned[fire] += amount;
        _burn(from, fire, amount);
    }

    /// @notice A cancelled or skipped open gives its packs back, sealed. Only the card contract. The packs are minted
    ///         back without the ERC-1155 receiver hook: a holder whose wallet now refuses them (or reverts on purpose)
    ///         must not be able to block cancelOpen/skipStuck and freeze the Series' opening queue. The packs were
    ///         theirs before the open, so no acceptance check is owed; the usual TransferSingle event is emitted.
    function returnPacks(address to, uint256 fire, uint256 amount) external {
        if (msg.sender != cards) revert NotCards();
        burned[fire] -= amount;
        uint256[] memory ids = new uint256[](1);
        uint256[] memory amounts = new uint256[](1);
        ids[0] = fire;
        amounts[0] = amount;
        _update(address(0), to, ids, amounts);
    }

    // ---------- metadata ----------

    function uri(uint256 fire) public view override returns (string memory) {
        string memory n = fire.toString();
        uint256 per = _cardsPerPack(fire);
        string memory size = "cards";
        if (per == 1) size = "1 card";
        else if (per > 1) size = string.concat(per.toString(), " cards");
        bytes memory json = abi.encodePacked(
            '{"name":"Omni Card Pack \u00b7 Series ', n,
            '","description":"A sealed pack of ', size, " from Series ", n,
            '. What is inside is decided only when it is opened.","image":"', packImageBase, 'fire', n,
            '.webp","attributes":[{"trait_type":"Series","value":', n, ',"display_type":"number"},{"trait_type":"State","value":"Sealed"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(json));
    }

    /// @dev The Series' cards per pack, from the card contract (its dealer decides); 0 if it can't say yet.
    function _cardsPerPack(uint256 fire) internal view returns (uint256) {
        if (cards == address(0)) return 0;
        (bool ok, bytes memory ret) = cards.staticcall(abi.encodeCall(IPacksCards.cardsPerPack, (fire)));
        if (!ok || ret.length < 32) return 0;
        return abi.decode(ret, (uint256));
    }

    function supportsInterface(bytes4 id) public view override(ERC1155, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }
}
