// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {Deployments} from "./Deployments.sol";
import {FireProfiles} from "../src/cards/FireProfiles.sol";

/// FireProfiles on its own, for a deployment made before it existed (DeployCards deploys it with everything else). It
/// has no owner and nothing to wire: it only reads FireCards (from deployments/<chainId>.json, or FIRE_CARDS).
/// Writes FireProfiles to the deployments file when it broadcasts (then node ops/deploy/record.mjs, then VerifyDeploy).
///   forge script script/DeployProfiles.s.sol --rpc-url $RPC --account deployer --sender <deployer address> --broadcast \
///     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
contract DeployProfiles is Deployments {
    function run() external returns (FireProfiles profiles) {
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(4663)), "not Robinhood Chain (4663; EXPECTED_CHAIN_ID for a rehearsal)");
        address cards = _addr("FIRE_CARDS", "FireCards");
        require(cards.code.length > 0, "FireCards has no code on this chain");
        require(deployed("FireProfiles") == address(0) || vm.envOr("REPLACE_PROFILES", false),
            "FireProfiles is already in the deployments file (REPLACE_PROFILES=true to deploy a new one: every profile starts empty)");
        vm.startBroadcast();
        profiles = new FireProfiles(cards);
        vm.stopBroadcast();
        require(address(profiles.CARDS()) == cards, "profiles wiring");
        console.log("FireProfiles", address(profiles));
        _record(_one("FireProfiles"), _oneA(address(profiles)), new string[](0), new address[](0), address(0), address(0));
    }
}
