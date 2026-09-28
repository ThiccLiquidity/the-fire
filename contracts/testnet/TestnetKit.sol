// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// TESTNET ONLY (Robinhood Chain testnet, 46630). Play-money stand-ins for the tokens, price feeds and PLANK pool the
// real Fire uses, so the whole game (contracts, keeper, site) can be rehearsed for free. Never deployed to mainnet.

import {ERC20} from "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";

/// @notice A play token anyone can get from the faucet.
contract TestToken is ERC20 {
    uint8 internal immutable DEC;
    uint256 public immutable FAUCET_AMOUNT;
    constructor(string memory n, string memory s, uint8 d, uint256 faucetAmount) ERC20(n, s) { DEC = d; FAUCET_AMOUNT = faucetAmount; }
    function decimals() public view override returns (uint8) { return DEC; }
    /// @notice Free play tokens to the caller.
    function faucet() external { _mint(msg.sender, FAUCET_AMOUNT); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice A Chainlink-style feed that's always fresh; anyone can move the price (it's a rehearsal).
contract TestFeed {
    int256 public answer;
    uint8 public immutable decimals;
    constructor(int256 a, uint8 d) { answer = a; decimals = d; }
    function set(int256 a) external { answer = a; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, answer, block.timestamp, block.timestamp, 0);
    }
}

/// @notice A Uniswap V2 pair stand-in: reserves anyone can set, cumulative prices that accrue like the real pair, so
///         the real PlankUsdTwap and the keeper's checkpoints run unchanged.
contract TestPair {
    address public immutable token0;
    address public immutable token1;
    uint112 internal r0;
    uint112 internal r1;
    uint32 internal tLast;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;
    constructor(address t0, address t1, uint112 a, uint112 b) { token0 = t0; token1 = t1; r0 = a; r1 = b; tLast = uint32(block.timestamp); }
    /// @notice Move the pool (e.g. set reserve1 x2 to double token0's price).
    function set(uint112 a, uint112 b) external {
        uint32 t = uint32(block.timestamp);
        if (t != tLast) {
            unchecked {
                price0CumulativeLast += ((uint256(r1) << 112) / r0) * (t - tLast);
                price1CumulativeLast += ((uint256(r0) << 112) / r1) * (t - tLast);
            }
        }
        (r0, r1, tLast) = (a, b, t);
    }
    function getReserves() external view returns (uint112, uint112, uint32) { return (r0, r1, tLast); }
}
