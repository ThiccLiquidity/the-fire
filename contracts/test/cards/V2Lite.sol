// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Uniswap V2 for tests, in 0.8: the same pool math (x*y=k, 0.3% fee, sqrt first mint, MINIMUM_LIQUIDITY locked),
/// the same router quoting (getAmountsOut, addLiquidity's optimal amounts) and the same swaps, so LiquidityBurner is
/// tested against how a real V2 pool behaves, including V2's cumulative prices (price0CumulativeLast,
/// price1CumulativeLast, blockTimestampLast) that time-weighted averages read. No flash swaps, no protocol fee.

contract V2Token is ERC20 {
    uint8 internal immutable _dec;
    constructor(string memory n, uint8 d) ERC20(n, n) { _dec = d; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract V2Weth is ERC20("WETH", "WETH") {
    function deposit() external payable { _mint(msg.sender, msg.value); }
    function withdraw(uint256 a) external { _burn(msg.sender, a); payable(msg.sender).transfer(a); }
    receive() external payable { _mint(msg.sender, msg.value); }
}

contract V2Pair is ERC20("UNI-V2", "UNI-V2") {
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public token0;
    address public token1;
    uint112 internal r0;
    uint112 internal r1;
    uint32 internal blockTimestampLast;
    uint256 public price0CumulativeLast;
    uint256 public price1CumulativeLast;

    constructor(address a, address b) { (token0, token1) = a < b ? (a, b) : (b, a); }

    function getReserves() external view returns (uint112, uint112, uint32) { return (r0, r1, blockTimestampLast); }

    function mint(address to) external returns (uint256 liquidity) {
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 a0 = b0 - r0;
        uint256 a1 = b1 - r1;
        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = _sqrt(a0 * a1) - MINIMUM_LIQUIDITY;
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
        } else {
            uint256 l0 = a0 * supply / r0;
            uint256 l1 = a1 * supply / r1;
            liquidity = l0 < l1 ? l0 : l1;
        }
        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);
        _update(b0, b1);
    }

    function swap(uint256 out0, uint256 out1, address to) external {
        require(out0 > 0 || out1 > 0, "INSUFFICIENT_OUTPUT");
        require(out0 < r0 && out1 < r1, "INSUFFICIENT_LIQUIDITY");
        if (out0 > 0) IERC20(token0).transfer(to, out0);
        if (out1 > 0) IERC20(token1).transfer(to, out1);
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 in0 = b0 > r0 - out0 ? b0 - (r0 - out0) : 0;
        uint256 in1 = b1 > r1 - out1 ? b1 - (r1 - out1) : 0;
        require(in0 > 0 || in1 > 0, "INSUFFICIENT_INPUT");
        uint256 adj0 = b0 * 1000 - in0 * 3;
        uint256 adj1 = b1 * 1000 - in1 * 3;
        require(adj0 * adj1 >= uint256(r0) * r1 * 1_000_000, "K");
        _update(b0, b1);
    }

    /// @dev As UniswapV2Pair._update: the cumulative prices grow by the OLD reserves' price times the time since the
    ///      last update (UQ112x112, wrapping), then the reserves change.
    function _update(uint256 b0, uint256 b1) internal {
        uint32 ts = uint32(block.timestamp);
        unchecked {
            uint32 dt = ts - blockTimestampLast;
            if (dt > 0 && r0 != 0 && r1 != 0) {
                price0CumulativeLast += ((uint256(r1) << 112) / r0) * dt;
                price1CumulativeLast += ((uint256(r0) << 112) / r1) * dt;
            }
        }
        r0 = uint112(b0);
        r1 = uint112(b1);
        blockTimestampLast = ts;
    }

    /// @dev As UniswapV2Pair.sync: reserves to the balances (a donation shows in the price).
    function sync() external { _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this))); }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } } else if (y != 0) { z = 1; }
    }
}

contract V2Factory {
    mapping(address => mapping(address => address)) public getPair;
    function createPair(address a, address b) external returns (address p) {
        p = address(new V2Pair(a, b));
        getPair[a][b] = p;
        getPair[b][a] = p;
    }
}

contract V2Router {
    V2Factory public immutable factory;
    V2Weth public immutable WETH;
    constructor(V2Factory f, V2Weth w) { factory = f; WETH = w; }
    receive() external payable {}

    function getAmountOut(uint256 amountIn, uint256 rIn, uint256 rOut) public pure returns (uint256) {
        uint256 inFee = amountIn * 997;
        return inFee * rOut / (rIn * 1000 + inFee);
    }

    function _reserves(address a, address b) internal view returns (uint256 ra, uint256 rb) {
        V2Pair p = V2Pair(factory.getPair(a, b));
        require(address(p) != address(0), "NO_PAIR");
        (uint112 r0, uint112 r1,) = p.getReserves();
        (ra, rb) = a == p.token0() ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    function getAmountsOut(uint256 amountIn, address[] memory path) public view returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 ra, uint256 rb) = _reserves(path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], ra, rb);
        }
    }

    function _swap(uint256[] memory amounts, address[] memory path, address to) internal {
        for (uint256 i; i < path.length - 1; i++) {
            V2Pair p = V2Pair(factory.getPair(path[i], path[i + 1]));
            uint256 out = amounts[i + 1];
            (uint256 o0, uint256 o1) = path[i] == p.token0() ? (uint256(0), out) : (out, uint256(0));
            address dest = i < path.length - 2 ? factory.getPair(path[i + 1], path[i + 2]) : to;
            p.swap(o0, o1, dest);
        }
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256)
        external returns (uint256[] memory amounts)
    {
        amounts = getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
        IERC20(path[0]).transferFrom(msg.sender, factory.getPair(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactETHForTokens(uint256 minOut, address[] calldata path, address to, uint256)
        external payable returns (uint256[] memory amounts)
    {
        require(path[0] == address(WETH), "INVALID_PATH");
        amounts = getAmountsOut(msg.value, path);
        require(amounts[amounts.length - 1] >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
        WETH.deposit{value: msg.value}();
        WETH.transfer(factory.getPair(path[0], path[1]), msg.value);
        _swap(amounts, path, to);
    }

    function addLiquidity(address a, address b, uint256 aDesired, uint256 bDesired, uint256 aMin, uint256 bMin, address to, uint256)
        external returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        if (factory.getPair(a, b) == address(0)) factory.createPair(a, b);
        (uint256 ra, uint256 rb) = _reserves(a, b);
        if (ra == 0 && rb == 0) {
            (amountA, amountB) = (aDesired, bDesired);
        } else {
            uint256 bOpt = aDesired * rb / ra;
            if (bOpt <= bDesired) {
                require(bOpt >= bMin, "INSUFFICIENT_B_AMOUNT");
                (amountA, amountB) = (aDesired, bOpt);
            } else {
                uint256 aOpt = bDesired * ra / rb;
                require(aOpt <= aDesired && aOpt >= aMin, "INSUFFICIENT_A_AMOUNT");
                (amountA, amountB) = (aOpt, bDesired);
            }
        }
        address pair = factory.getPair(a, b);
        IERC20(a).transferFrom(msg.sender, pair, amountA);
        IERC20(b).transferFrom(msg.sender, pair, amountB);
        liquidity = V2Pair(pair).mint(to);
    }
}
