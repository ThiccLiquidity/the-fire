// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PlankUsdTwap} from "../src/PlankUsdTwap.sol";

/// Step 1 of deploy: the PLANK/USD TWAP feed. Deploy this at least 24h before the Fire so it has a window.
///   forge script script/DeployTwap.s.sol --rpc-url $RPC --account deployer --broadcast --verify
contract DeployTwap is Script {
    function run() external {
        vm.startBroadcast();
        PlankUsdTwap twap = new PlankUsdTwap(
            vm.envAddress("PLANK_WETH_V2_PAIR"), vm.envAddress("PLANK"), vm.envAddress("ETH_USD_FEED")
        );
        console.log("PlankUsdTwap:", address(twap));
        vm.stopBroadcast();
    }
}
