// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Fire} from "../src/Fire.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";
import {OpenDrandRouter} from "../src/OpenDrandRouter.sol";
import {PaperUsdTwap} from "../src/PaperUsdTwap.sol";

/**
 * Deploy order (see ../docs/deploy.md):
 *   1. PlankUsdTwap (script/DeployTwap.s.sol), >= 24h before step 2; call checkpoint() 20h+ after deploy, then daily.
 *   2. This script: OpenDrandRouter + OpenVRFAdapter + Fire. None of them has an owner; nothing to configure after.
 *   3. Start ops/keeper (rolls, delivers drand proofs, recovers stuck rolls, checkpoints, sweeps the mill floor).
 *   4. Ask Plank Press admin: PulpPool.addRewardToken(PLANK).
 *
 *   forge script script/Deploy.s.sol --rpc-url $RPC --account deployer --broadcast --verify
 *
 * PAPER, PLANK, MILL, ROYALTY_POOL = addresses on Robinhood Chain
 * ETH_USD_FEED   = Chainlink ETH/USD (8 decimals).
 * PLANK_USD_FEED = our PlankUsdTwap (**18 decimals** — an 8-decimal feed here would misprice the PLANK leg by 1e10).
 * PAPER_PER_TICKET     = 1e18 (1 PAPER, assuming 18 decimals — verify): the most PAPER a ticket ever takes
 * PAPER_USD_CAP        = 33000000 ($0.33, default): once PAPER trades above this, a ticket takes less than 1 PAPER
 * UNIV2_FACTORY, WETH  = Uniswap V2 factory + WETH on Robinhood Chain (the PAPER feed finds PAPER's pool there)
 * PLANK_PER_TICKET0    = starting PLANK per ticket in wei (~$0.90 of PLANK on launch day)
 * PLANK_USD_PER_TICKET = 90000000 ($0.90, 8 decimals) — the leg ratchets toward this
 * ETH_USD_PER_TICKET   = 100000000 ($1.00) — "paper from the fire" price
 * MILL_BID_BASE     = starting mill bid in USD, 8 decimals (e.g. 50000000000 = $500). It climbs ~1%/hour until a mill
 *                     sells, so start at or below where you expect the floor. Listings may be in USDG or ETH.
 * USDG              = the USDG token on Robinhood Chain (mill listings are priced in it)
 * ROLL_TIME_OF_DAY  = 10800 (03:00 UTC = 8:00 PM Phoenix)
 */
contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        // PAPER feed, router, adapter, then Fire. The adapter needs the Fire's address and vice versa: predict it (nonce+3).
        address deployer = msg.sender;
        uint64 nonce = vm.getNonce(deployer);
        address predictedFire = vm.computeCreateAddress(deployer, nonce + 3);

        // PAPER has no market yet: this feed finds the PAPER/WETH or PAPER/USDG pool once someone creates it.
        PaperUsdTwap paperTwap = new PaperUsdTwap(
            vm.envAddress("UNIV2_FACTORY"), vm.envAddress("PAPER"), vm.envAddress("WETH"), vm.envAddress("USDG"), 6,
            vm.envAddress("ETH_USD_FEED")
        );
        OpenDrandRouter router = new OpenDrandRouter();
        OpenVRFAdapter adapter = new OpenVRFAdapter(address(router), predictedFire);
        Fire fire = new Fire(Fire.Config({
            paper: vm.envAddress("PAPER"),
            plank: vm.envAddress("PLANK"),
            mill: vm.envAddress("MILL"),
            seaport: vm.envAddress("SEAPORT"), // required: without it, ETH from ETH tickets could never leave the Fire
            royaltyPool: vm.envAddress("ROYALTY_POOL"),
            randomness: address(adapter),
            ethUsdFeed: vm.envAddress("ETH_USD_FEED"),
            plankUsdFeed: vm.envAddress("PLANK_USD_FEED"),
            paperUsdFeed: address(paperTwap),
            usdg: vm.envAddress("USDG"),
            paperPerTicket: vm.envUint("PAPER_PER_TICKET"),
            paperUsdCap: vm.envOr("PAPER_USD_CAP", uint256(33_000_000)), // $0.33
            plankPerTicket0: vm.envUint("PLANK_PER_TICKET0"),
            plankUsdPerTicket: vm.envUint("PLANK_USD_PER_TICKET"),
            ethUsdPerTicket: vm.envUint("ETH_USD_PER_TICKET"),
            millBidBase: vm.envUint("MILL_BID_BASE"),
            rollTimeOfDay: vm.envUint("ROLL_TIME_OF_DAY")
        }));
        require(address(fire) == predictedFire, "address prediction failed");
        console.log("Fire:", address(fire));
        console.log("Adapter:", address(adapter));
        console.log("Router:", address(router));
        console.log("PaperUsdTwap:", address(paperTwap));
        vm.stopBroadcast();
    }
}
