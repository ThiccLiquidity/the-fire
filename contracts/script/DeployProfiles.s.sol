// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";
import {Profiles} from "../src/Profiles.sol";

/// forge script script/DeployProfiles.s.sol --rpc-url $RPC --account deployer --broadcast --verify
/// Standalone: needs only MILL. Can go up any time, before or after Fire. Set VITE_PROFILES_ADDRESS on the site.
contract DeployProfiles is Script {
    function run() external {
        vm.startBroadcast();
        Profiles p = new Profiles(IERC721(vm.envAddress("MILL")));
        vm.stopBroadcast();
        console.log("Profiles", address(p));
    }
}
