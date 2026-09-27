// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {ISeaport} from "../src/Fire.sol";

interface IFireCallback {
    function onRandomness(uint256 requestId, uint256 rnd) external;
}

contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// @dev Stand-in for the Paper Mill NFT: holds PLANK per mill, burn() releases it to the owner.
contract MockMill is ERC721 {
    IERC20 public plank;
    uint256 public plankPerMill;
    uint256 public next = 1;
    constructor(address plank_, uint256 plankPerMill_) ERC721("Paper Mill", "MILL") {
        plank = IERC20(plank_); plankPerMill = plankPerMill_;
    }
    function mint(address to) external returns (uint256 id) {
        id = next++;
        plank.transferFrom(msg.sender, address(this), plankPerMill);
        _mint(to, id);
    }
    uint256 public constant burnFee = 0.0003 ether;
    uint256 public mintingSunset;
    function setSunset(uint256 t) external { mintingSunset = t; }
    function burn(uint256 id) external payable {
        require(block.timestamp >= mintingSunset, "Burning not allowed yet");
        require(msg.value == burnFee, "Incorrect fee");
        require(ownerOf(id) == msg.sender, "not owner");
        _burn(id);
        plank.transfer(msg.sender, plankPerMill);
    }
}

/// @dev Test randomness: request() returns an id; fulfill(id, value) delivers it to the fire.
contract MockRandomness {
    address public fire;
    uint256 public last;
    function setFire(address f) external { fire = f; }
    function request() external returns (uint256) { last += 1; return last; }
    function fulfill(uint256 id, uint256 value) external { IFireCallback(fire).onRandomness(id, value); }
}

contract MockFeed {
    int256 public answer; uint256 public updatedAt;
    constructor(int256 a) { answer = a; updatedAt = block.timestamp; }
    function set(int256 a) external { answer = a; updatedAt = block.timestamp; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, answer, 0, updatedAt, 0);
    }
}

/// @dev Stand-in for Seaport: a fixed-price ETH listing that transfers the NFT to the caller and pays the offerer.
contract MockSeaport {
    ERC721 public nft;
    constructor(address nft_) { nft = ERC721(nft_); }
    function listing(address offerer, uint256 tokenId, uint256 priceWei) external view returns (ISeaport.Order memory o) {
        ISeaport.OfferItem[] memory offer = new ISeaport.OfferItem[](1);
        offer[0] = ISeaport.OfferItem({itemType: 2, token: address(nft), identifierOrCriteria: tokenId, startAmount: 1, endAmount: 1});
        ISeaport.ConsiderationItem[] memory cons = new ISeaport.ConsiderationItem[](1);
        cons[0] = ISeaport.ConsiderationItem({itemType: 0, token: address(0), identifierOrCriteria: 0, startAmount: priceWei, endAmount: priceWei, recipient: payable(offerer)});
        o.parameters.offerer = offerer; o.parameters.offer = offer; o.parameters.consideration = cons;
        o.parameters.totalOriginalConsiderationItems = 1;
    }
    /// @dev Like Seaport, pays every consideration item — including fulfiller-appended "tips" past the original count.

    function fulfillOrder(ISeaport.Order calldata order, bytes32) external payable returns (bool) {
        ISeaport.OrderParameters calldata p = order.parameters;
        uint256 total;
        for (uint256 i; i < p.consideration.length; i++) total += p.consideration[i].endAmount;
        require(msg.value == total, "price");
        nft.transferFrom(p.offerer, msg.sender, p.offer[0].identifierOrCriteria);
        for (uint256 i; i < p.consideration.length; i++) {
            (bool ok,) = p.consideration[i].recipient.call{value: p.consideration[i].endAmount}("");
            require(ok);
        }
        return true;
    }
}
