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

/// @dev A token that refuses transfers to blocked addresses (like a blacklist or max-wallet rule).
contract BlockingERC20 is MockERC20 {
    mapping(address => bool) public blocked;
    constructor() MockERC20("PLANK", "PLANK") {}
    function block_(address a, bool b) external { blocked[a] = b; }
    function _update(address from, address to, uint256 v) internal override {
        require(!blocked[to], "blocked");
        super._update(from, to, v);
    }
}

/// @dev USDG stand-in: 6 decimals.
contract MockUSDG is MockERC20 {
    constructor() MockERC20("Global Dollar", "USDG") {}
    function decimals() public pure override returns (uint8) { return 6; }
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
    mapping(uint256 => bool) public answered;
    function request() external returns (uint256) { last += 1; return last; }
    function fulfill(uint256 id, uint256 value) external { answered[id] = true; IFireCallback(fire).onRandomness(id, value); }
    /// @dev The provider has a result for `id` but the callback never landed.
    function answerSilently(uint256 id) external { answered[id] = true; }
}

contract MockFeed {
    int256 public answer; uint256 public updatedAt; bool public broken;
    uint8 public decimals = 8; function setDecimals(uint8 d) external { decimals = d; }
    function setBroken(bool b) external { broken = b; }
    bool public burnGas; function setBurnGas(bool b) external { burnGas = b; }
    constructor(int256 a) { answer = a; updatedAt = block.timestamp; }
    function set(int256 a) external { answer = a; updatedAt = block.timestamp; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!broken, "feed down");
        if (burnGas) { uint256 i; while (gasleft() > 1000) i++; }
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

    bytes public lastExtraData;
    function fulfillAdvancedOrder(ISeaport.AdvancedOrder calldata order, ISeaport.CriteriaResolver[] calldata, bytes32, address recipient)
        external payable returns (bool)
    {
        require(order.numerator == 1 && order.denominator == 1, "full fill");
        lastExtraData = order.extraData;
        ISeaport.OrderParameters calldata p = order.parameters;
        uint256 total;
        for (uint256 i; i < p.consideration.length; i++) if (p.consideration[i].itemType == 0) total += p.consideration[i].endAmount;
        require(msg.value == total, "price");
        nft.transferFrom(p.offerer, recipient, p.offer[0].identifierOrCriteria);
        for (uint256 i; i < p.consideration.length; i++) {
            ISeaport.ConsiderationItem calldata c = p.consideration[i];
            if (c.itemType == 1) { IERC20(c.token).transferFrom(msg.sender, c.recipient, c.endAmount); continue; }
            (bool ok,) = c.recipient.call{value: c.endAmount}("");
            require(ok);
        }
        return true;
    }
}

/// @dev A PLANK/USD feed shaped like PlankUsdTwap: price, its pool, and the two checkpoints of its window.
contract MockPlankTwap {
    int256 public answer; uint256 public updatedAt; address public PAIR;
    struct Obs { uint256 cum; uint32 ts; }
    Obs public prev; Obs public last;
    constructor(int256 a, address pair) { answer = a; PAIR = pair; set(a); }
    function decimals() external pure returns (uint8) { return 18; }
    /// A normal 30-minute window ending now.
    function set(int256 a) public { answer = a; updatedAt = block.timestamp; prev = Obs(0, uint32(block.timestamp - 30 minutes)); last = Obs(0, uint32(block.timestamp)); }
    /// A window of `len` seconds ending now (what a checkpoint after a keeper gap produces).
    function setWindow(int256 a, uint256 len) external { answer = a; updatedAt = block.timestamp; prev = Obs(0, uint32(block.timestamp - len)); last = Obs(0, uint32(block.timestamp)); }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) { return (0, answer, 0, updatedAt, 0); }
}

contract MockPair {
    address public token0; address public token1;
    constructor(address a, address b) { token0 = a; token1 = b; }
}

/// @dev Just enough of a Uniswap V2 router and factory for the deploy checks.
contract MockV2Factory {
    address public pair;
    constructor(address p) { pair = p; }
    function getPair(address, address) external view returns (address) { return pair; }
}

contract MockRouterInfo {
    address public WETH; address public factory;
    constructor(address w, address f) { WETH = w; factory = f; }
}
