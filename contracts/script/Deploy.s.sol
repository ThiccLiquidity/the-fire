// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Fire} from "../src/Fire.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";

/**
 * Deploy: fill the env vars, then
 *   forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --verify
 *
 * PAPER, PLANK, MILL, ROYALTY_POOL, VRF_ROUTER = addresses on Robinhood Chain
 * PAPER_PER_TICKET  = 1e18 (1 PAPER, assuming 18 decimals — verify)
 * PLANK_PER_TICKET  = 10_000_000e18 (10M PLANK — verify decimals)
 * ETH_PER_TICKET    = wei worth ~$1.00 on launch day
 * MILL_BID_BASE     = wei, just under the mill floor on launch day
 * ROLL_TIME_OF_DAY  = 10800 (03:00 UTC = 8:00 PM Phoenix)
 */
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        // The adapter needs the Fire address and vice versa: predict the Fire address (nonce+1).
        address deployer = msg.sender;
        uint64 nonce = vm.getNonce(deployer);
        address predictedFire = vm.computeCreateAddress(deployer, nonce + 1);

        OpenVRFAdapter adapter = new OpenVRFAdapter(vm.envAddress("VRF_ROUTER"), predictedFire);
        Fire fire = new Fire(
            vm.envAddress("PAPER"),
            vm.envAddress("PLANK"),
            vm.envAddress("MILL"),
            vm.envAddress("ROYALTY_POOL"),
            address(adapter),
            vm.envUint("PAPER_PER_TICKET"),
            vm.envUint("PLANK_PER_TICKET"),
            vm.envUint("ETH_PER_TICKET"),
            vm.envUint("MILL_BID_BASE"),
            vm.envUint("ROLL_TIME_OF_DAY")
        );
        require(address(fire) == predictedFire, "address prediction failed");
        console.log("Fire:", address(fire));
        console.log("Adapter:", address(adapter));
        vm.stopBroadcast();
    }
}
