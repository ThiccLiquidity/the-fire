// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {Deployments} from "./Deployments.sol";
import {DevToken, DevRouter} from "./dev/DevContracts.sol";

/**
 * Testnet only: a new DevRouter on the testnet kit's factory and WETH (DevStack.s.sol), with the exact-output swaps the
 * site's Get PAPER and FireSale.buyWithEthAll use (getAmountsIn, swapETHForExactTokens, swapTokensForExactTokens).
 * Lets it mint the four stand-in tokens and records it as V2_ROUTER, so the card contracts deployed next use it. Run by
 * the wallet that ran DevStack (it owns the stand-in tokens).
 *
 *   forge script script/DevRouter.s.sol --rpc-url $env:RPC --account testnet-deployer --sender <deployer address> --slow --broadcast
 */
contract DevRouterScript is Deployments {
    function run() external returns (DevRouter router) {
        require(block.chainid != 4663, "DevRouter: stand-ins never go on Robinhood Chain mainnet (4663)");
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(46630)), "DevRouter: not the testnet (46630)");
        address weth = deployedInput("WETH");
        address factory = deployedInput("UNIV2_FACTORY");
        require(weth != address(0) && factory != address(0), "run DevStack first (WETH / UNIV2_FACTORY missing)");
        string[4] memory toks = ["PAPER", "PLANK", "USDG", "WETH"];
        vm.startBroadcast();
        router = new DevRouter(weth, factory);
        for (uint256 i; i < 4; i++) DevToken(deployedInput(toks[i])).setMinter(address(router), true);
        vm.stopBroadcast();
        console.log(string.concat("V2_ROUTER=", vm.toString(address(router))));
        string[] memory inNames = new string[](1);
        address[] memory inAddrs = new address[](1);
        (inNames[0], inAddrs[0]) = ("V2_ROUTER", address(router));
        _record(new string[](0), new address[](0), inNames, inAddrs, address(0), address(0));
    }
}
