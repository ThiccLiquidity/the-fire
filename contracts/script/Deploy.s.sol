// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Fire} from "../src/Fire.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";

/**
 * Deploy order (see ../docs/deploy.md):
 *   0. OpenVRF router: from the OpenVRF repo with THEIR script (pnpm run deploy:mainnet). Owner = our deployer.
 *   1. PlankUsdTwap (script/DeployTwap.s.sol), >= 24h before step 2; call checkpoint() 20h+ after deploy, then daily.
 *   2. This script: OpenVRFAdapter + Fire.
 *   3. On the router: setConsumerAuthorization(adapter, true). Fund the adapter with a little ETH if requestFee > 0.
 *   4. Ask Plank Press admin: PulpPool.addRewardToken(PLANK).
 *
 *   forge script script/Deploy.s.sol --rpc-url $RPC --account deployer --broadcast --verify
 *
 * PAPER, PLANK, MILL, ROYALTY_POOL, VRF_ROUTER = addresses on Robinhood Chain
 * ETH_USD_FEED   = Chainlink ETH/USD (8 decimals).
 * PLANK_USD_FEED = our PlankUsdTwap (**18 decimals** — an 8-decimal feed here would misprice the PLANK leg by 1e10).
 * PAPER_PER_TICKET     = 1e18 (1 PAPER, assuming 18 decimals — verify)
 * PLANK_PER_TICKET0    = starting PLANK per ticket in wei (~$0.90 of PLANK on launch day)
 * PLANK_USD_PER_TICKET = 90000000 ($0.90, 8 decimals) — the leg ratchets toward this
 * ETH_USD_PER_TICKET   = 100000000 ($1.00) — "paper from the fire" price
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
        Fire fire = new Fire(Fire.Config({
            paper: vm.envAddress("PAPER"),
            plank: vm.envAddress("PLANK"),
            mill: vm.envAddress("MILL"),
            seaport: vm.envAddress("SEAPORT"), // required: without it, ETH from ETH tickets could never leave the Fire
            royaltyPool: vm.envAddress("ROYALTY_POOL"),
            randomness: address(adapter),
            ethUsdFeed: vm.envAddress("ETH_USD_FEED"),
            plankUsdFeed: vm.envAddress("PLANK_USD_FEED"),
            paperPerTicket: vm.envUint("PAPER_PER_TICKET"),
            plankPerTicket0: vm.envUint("PLANK_PER_TICKET0"),
            plankUsdPerTicket: vm.envUint("PLANK_USD_PER_TICKET"),
            ethUsdPerTicket: vm.envUint("ETH_USD_PER_TICKET"),
            millBidBase: vm.envUint("MILL_BID_BASE"),
            rollTimeOfDay: vm.envUint("ROLL_TIME_OF_DAY")
        }));
        require(address(fire) == predictedFire, "address prediction failed");
        console.log("Fire:", address(fire));
        console.log("Adapter:", address(adapter));
        vm.stopBroadcast();
    }
}
