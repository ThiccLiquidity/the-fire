// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "../Mocks.sol";

/// @dev Copy of Sale.t.sol's MockV2Router (fixed PLANK price, can fail, enforces amountOutMin), plus a counter of the
///      PLANK it minted, so the invariant tests can tell swap burns from direct PLANK burns at the dead address.
contract InvRouter {
    MockERC20 public plank;
    uint256 public plankPerEthWei; // PLANK wei out per ETH wei in
    uint256 public plankPerUsdgUnit; // PLANK wei out per USDG unit in
    bool public fail;
    uint256 public plankOut; // total PLANK minted to swap recipients
    uint256 public ethSwapped;
    uint256 public usdgSwapped;

    constructor(MockERC20 p, uint256 perEth, uint256 perUsdg) { plank = p; plankPerEthWei = perEth; plankPerUsdgUnit = perUsdg; }
    function setFail(bool f) external { fail = f; }
    function setRates(uint256 perEth, uint256 perUsdg) external { plankPerEthWei = perEth; plankPerUsdgUnit = perUsdg; }

    function swapExactETHForTokens(uint256 minOut, address[] calldata, address to, uint256) external payable returns (uint256[] memory a) {
        require(!fail, "router down");
        uint256 out = msg.value * plankPerEthWei;
        require(out >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
        plank.mint(to, out);
        plankOut += out;
        ethSwapped += msg.value;
        a = new uint256[](2);
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256)
        external
        returns (uint256[] memory a)
    {
        require(!fail, "router down");
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        uint256 out = amountIn * plankPerUsdgUnit;
        require(out >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
        plank.mint(to, out);
        plankOut += out;
        usdgSwapped += amountIn;
        a = new uint256[](3);
    }
}
