// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/Script.sol";
import {PlankUsdTwap} from "../src/PlankUsdTwap.sol";
import {Deployments} from "./Deployments.sol";

/// Step 1 of deploy: the PLANK/USD TWAP feed (FireSale prices PLANK with it). Deploy it at least 30 minutes before the
/// card contracts, then checkpoint() it 30+ min after deploy and every 30 min after that (keeper).
/// Writes PlankUsdTwap (and its inputs) to deployments/<chainId>.json when it broadcasts.
///   forge script script/DeployTwap.s.sol --rpc-url $RPC --account deployer --broadcast \
///     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
contract DeployTwap is Deployments {
    function run() external {
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(4663)), "not Robinhood Chain (4663; EXPECTED_CHAIN_ID for a rehearsal)");
        vm.startBroadcast();
        PlankUsdTwap twap = new PlankUsdTwap(
            vm.envAddress("PLANK_WETH_V2_PAIR"), vm.envAddress("PLANK"), vm.envAddress("ETH_USD_FEED")
        );
        console.log("PlankUsdTwap:", address(twap));
        vm.stopBroadcast();
        string[] memory inNames = new string[](3);
        address[] memory inAddrs = new address[](3);
        (inNames[0], inNames[1], inNames[2]) = ("PLANK_WETH_V2_PAIR", "PLANK", "ETH_USD_FEED");
        (inAddrs[0], inAddrs[1], inAddrs[2]) = (vm.envAddress("PLANK_WETH_V2_PAIR"), vm.envAddress("PLANK"), vm.envAddress("ETH_USD_FEED"));
        _record(_one("PlankUsdTwap"), _oneA(address(twap)), inNames, inAddrs, address(0), address(0));
    }
}
