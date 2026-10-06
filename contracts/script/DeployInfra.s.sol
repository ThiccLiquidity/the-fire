// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {OpenDrandRouter} from "../src/OpenDrandRouter.sol";
import {PaperUsdTwap} from "../src/PaperUsdTwap.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IInfraFeed {
    function decimals() external view returns (uint8);
}

/**
 * Step 2 of the deploy (see ../docs/deploy.md): the shared pieces the card contracts are wired to.
 *   - OpenDrandRouter: drand randomness for card opens and PDA reveals. No owner, no fee.
 *   - PaperUsdTwap: the PAPER/USD feed (the pack PAPER cap, and PaperBurner's guard). It finds the PAPER/WETH,
 *     PAPER/USDG or PAPER/PLANK pool itself (one holding >= $1,000 on its other side) and reports 0 until it has a
 *     price, about 40h after the keeper's first checkpoint (20h as candidate, then one 20h window). PAPER_USD_FEED is
 *     this contract, not the pool.
 * Neither has an owner; nothing to configure after. Step 1 is PlankUsdTwap (DeployTwap.s.sol), step 3 the cards
 * (DeployCards.s.sol, with DRAND_ROUTER and PAPER_USD_FEED set to the addresses printed here).
 *
 *   forge script script/DeployInfra.s.sol --rpc-url $RPC --account deployer --sender <deployer address> --slow --broadcast \
 *     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
 *
 * Settings (.env): PAPER, USDG, WETH, UNIV2_FACTORY, ETH_USD_FEED, PLANK, PLANK_USD_FEED (step 1's PlankUsdTwap).
 */
contract DeployInfra is Script {
    function run() external returns (OpenDrandRouter router, PaperUsdTwap paperTwap) {
        require(block.chainid == 4663, "not Robinhood Chain (4663)");
        string[7] memory names = ["PAPER", "USDG", "WETH", "UNIV2_FACTORY", "ETH_USD_FEED", "PLANK", "PLANK_USD_FEED"];
        for (uint256 i; i < names.length; i++) {
            require(vm.envAddress(names[i]).code.length > 0, string.concat(names[i], " has no contract code"));
        }
        require(IERC20Metadata(vm.envAddress("PAPER")).decimals() == 18, "PAPER is not 18 decimals");
        require(IInfraFeed(vm.envAddress("ETH_USD_FEED")).decimals() == 8, "ETH_USD_FEED must have 8 decimals");
        require(IERC20Metadata(vm.envAddress("PLANK")).decimals() == 18, "PLANK is not 18 decimals");
        require(IInfraFeed(vm.envAddress("PLANK_USD_FEED")).decimals() == 18, "PLANK_USD_FEED must be the 18-decimal PlankUsdTwap");

        vm.startBroadcast();
        router = new OpenDrandRouter();
        paperTwap = new PaperUsdTwap(
            vm.envAddress("UNIV2_FACTORY"), vm.envAddress("PAPER"), vm.envAddress("WETH"), vm.envAddress("USDG"),
            IERC20Metadata(vm.envAddress("USDG")).decimals(), vm.envAddress("ETH_USD_FEED"), vm.envAddress("PLANK"),
            vm.envAddress("PLANK_USD_FEED")
        );
        vm.stopBroadcast();

        console.log("OpenDrandRouter (DRAND_ROUTER):", address(router));
        console.log("PaperUsdTwap (PAPER_USD_FEED): ", address(paperTwap));
    }
}
