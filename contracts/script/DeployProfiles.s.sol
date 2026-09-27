// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Profiles} from "../src/Profiles.sol";

/// forge script script/DeployProfiles.s.sol --rpc-url $RPC --account deployer --broadcast --verify
/// Standalone, no constructor args, no owner. Can go up any time. Set VITE_PROFILES_ADDRESS on the site.
contract DeployProfiles is Script {
    function run() external {
        vm.startBroadcast();
        Profiles p = new Profiles();
        vm.stopBroadcast();
        console.log("Profiles", address(p));
    }
}
