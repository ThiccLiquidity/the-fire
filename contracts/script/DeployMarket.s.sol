// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {Deployments} from "./Deployments.sol";
import {FireMarket} from "../src/cards/FireMarket.sol";

/// FireMarket on its own, for a deployment made before it existed (DeployCards deploys it with everything else). It
/// has no owner and nothing to wire: it only reads FireCards and FirePacks (from deployments/<chainId>.json, or
/// FIRE_CARDS / FIRE_PACKS).
/// Writes FireMarket to the deployments file when it broadcasts (then node ops/deploy/record.mjs, then VerifyDeploy).
///   forge script script/DeployMarket.s.sol --rpc-url $RPC --account deployer --sender <deployer address> --broadcast \
///     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
contract DeployMarket is Deployments {
    function run() external returns (FireMarket market) {
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(4663)), "not Robinhood Chain (4663; EXPECTED_CHAIN_ID for a rehearsal)");
        address cards = _addr("FIRE_CARDS", "FireCards");
        address packs = _addr("FIRE_PACKS", "FirePacks");
        require(cards.code.length > 0 && packs.code.length > 0, "FireCards / FirePacks have no code on this chain");
        require(deployed("FireMarket") == address(0) || vm.envOr("REPLACE_MARKET", false),
            "FireMarket is already in the deployments file (REPLACE_MARKET=true to deploy a new one: every listing starts over)");
        vm.startBroadcast();
        market = new FireMarket(cards, packs);
        vm.stopBroadcast();
        require(address(market.CARDS()) == cards && address(market.PACKS()) == packs, "market wiring");
        console.log("FireMarket", address(market));
        _record(_one("FireMarket"), _oneA(address(market)), new string[](0), new address[](0), address(0), address(0));
    }
}
