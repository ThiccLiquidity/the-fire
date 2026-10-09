// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {Deployments} from "./Deployments.sol";
import {DevToken, DevFeed, DevFactory, DevPair, DevRouter, DevPress} from "./dev/DevContracts.sol";

/**
 * The testnet kit (Robinhood Chain testnet, 46630; also the rehearsal on a local anvil): deploys the stand-ins for
 * what mainnet already has (script/dev/DevContracts.sol), so the real deploy scripts can run on top of them.
 *   - PAPER, PLANK, USDG (6 decimals) and WETH tokens
 *   - an ETH/USD feed at $3,333 that never goes stale
 *   - a Uniswap V2 factory with a PLANK/WETH pool ($0.000000001 PLANK) and a PAPER/WETH pool ($0.01 PAPER), and a
 *     router that trades on their reserves (it mints what it pays out, so it's a minter of every token)
 *   - a Paper Press NFT (press packs)
 * Every setter is the deployer's only (mint, set, setReserves, setFail, createPair). The randomness is NOT a stand-in:
 * DeployInfra deploys the real OpenDrandRouter (real drand).
 *
 * It refuses chain 4663, and any chain but EXPECTED_CHAIN_ID (default 46630). With --broadcast it leaves the inputs
 * for deployments/<chainId>.json in the .pending file (ops/deploy/record.mjs records them after the broadcast), and
 * prints them for .env (DeployTwap, DeployInfra and DeployCards read their inputs from the environment).
 *
 *   $env:EXPECTED_CHAIN_ID = "46630"
 *   forge script script/DevStack.s.sol --rpc-url $env:RPC --account deployer --sender <deployer address> --slow --broadcast
 *   node ..\ops\deploy\record.mjs --rpc $env:RPC
 *
 * Optional: DEV_ETH_USD (8 decimals, default 3333e8).
 */
contract DevStack is Deployments {
    struct Stack {
        DevToken paper;
        DevToken plank;
        DevToken usdg;
        DevToken weth;
        DevFeed ethUsd;
        DevFactory factory;
        address plankPair;
        address paperPair;
        DevRouter router;
        DevPress press;
    }

    function run() external returns (Stack memory s) {
        require(block.chainid != 4663, "DevStack: stand-ins never go on Robinhood Chain mainnet (4663)");
        require(block.chainid == vm.envOr("EXPECTED_CHAIN_ID", uint256(46630)), "DevStack: not the testnet (46630; EXPECTED_CHAIN_ID for a rehearsal)");
        int256 ethUsd = int256(vm.envOr("DEV_ETH_USD", uint256(3333e8)));

        vm.startBroadcast();
        s.paper = new DevToken("PAPER (test)", "PAPER", 18);
        s.plank = new DevToken("PLANK (test)", "PLANK", 18);
        s.usdg = new DevToken("Global Dollar (test)", "USDG", 6);
        s.weth = new DevToken("Wrapped Ether (test)", "WETH", 18);
        s.ethUsd = new DevFeed(ethUsd);
        s.factory = new DevFactory();
        s.plankPair = s.factory.createPair(address(s.plank), address(s.weth));
        s.paperPair = s.factory.createPair(address(s.paper), address(s.weth));
        // PLANK $0.000000001 (28 WETH : 93.3T PLANK at $3,333 ETH); PAPER $0.01 (1 WETH : 333,300 PAPER)
        DevPair(s.plankPair).setReserves(address(s.weth), 28 ether, 28 ether * 3_333_000_000_000);
        DevPair(s.paperPair).setReserves(address(s.weth), 1 ether, 333_300 ether);
        s.router = new DevRouter(address(s.weth), address(s.factory));
        s.paper.setMinter(address(s.router), true);
        s.plank.setMinter(address(s.router), true);
        s.usdg.setMinter(address(s.router), true);
        s.weth.setMinter(address(s.router), true);
        s.press = new DevPress();
        vm.stopBroadcast();

        string[9] memory n =
            ["PAPER", "PLANK", "USDG", "WETH", "MILL", "ETH_USD_FEED", "PLANK_WETH_V2_PAIR", "UNIV2_FACTORY", "V2_ROUTER"];
        address[9] memory a = [
            address(s.paper), address(s.plank), address(s.usdg), address(s.weth), address(s.press), address(s.ethUsd),
            s.plankPair, address(s.factory), address(s.router)
        ];
        string[] memory inNames = new string[](9);
        address[] memory inAddrs = new address[](9);
        console.log("Stand-ins (owner %s). For contracts/.env:", msg.sender);
        for (uint256 i; i < 9; i++) {
            (inNames[i], inAddrs[i]) = (n[i], a[i]);
            console.log(string.concat(n[i], "=", vm.toString(a[i])));
        }
        _record(new string[](0), new address[](0), inNames, inAddrs, address(0), address(0));
    }
}
