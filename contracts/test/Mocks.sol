// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

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
    function burn(uint256 id) external {
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
