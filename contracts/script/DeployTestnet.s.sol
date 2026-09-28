// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Fire} from "../src/Fire.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";
import {OpenDrandRouter} from "../src/OpenDrandRouter.sol";
import {PlankUsdTwap} from "../src/PlankUsdTwap.sol";
import {MockMill} from "../test/Mocks.sol";
import {TestToken, TestFeed, TestPair} from "../testnet/TestnetKit.sol";

/**
 * TESTNET REHEARSAL (Robinhood Chain testnet, chain 46630). The real Fire, router, adapter and PLANK price feed, on
 * play tokens with a faucet, a play PLANK pool and an always-fresh ETH/USD feed. Same settings as mainnet ($0.90 of PLANK
 * a log at today's price, 8 PM MST storms, a $250 seed). Only the deployer's testnet ETH is spent.
 *
 *   forge script script/DeployTestnet.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com/rpc --account deployer --slow --broadcast
 */
contract DeployTestnet is Script {
    // Today's real pool: 88.7T PLANK / 28.1 WETH at $3,333 ETH -> $0.0000000010558 per PLANK
    uint112 constant R_PLANK = 88_700_000_000_000e18;
    uint112 constant R_WETH = 28.1e18;
    uint256 constant PLANK_PER_TICKET0 = 852_425_838e18; // $0.90 at that price
    uint256 constant SEED = 236_787_000_000e18; // ~$250 of PLANK

    function run() external {
        require(block.chainid == 46630, "testnet only (chain 46630)");
        vm.startBroadcast();
        address me = msg.sender;
        TestToken paper = new TestToken("PAPER (test)", "PAPER", 18, 100e18);
        TestToken plank = new TestToken("PLANK (test)", "PLANK", 18, 200_000_000_000e18); // ~$210, about 230 logs
        TestToken usdg = new TestToken("Global Dollar (test)", "USDG", 6, 100e6);
        TestToken weth = new TestToken("Wrapped Ether (test)", "WETH", 18, 0);
        TestFeed ethUsd = new TestFeed(3_333_00000000, 8);
        TestPair pair = new TestPair(address(plank), address(weth), R_PLANK, R_WETH);
        PlankUsdTwap plankUsd = new PlankUsdTwap(address(pair), address(plank), address(ethUsd));
        MockMill press = new MockMill(address(plank), 88_842_006_942e18);

        uint64 nonce = vm.getNonce(me);
        address predictedFire = vm.computeCreateAddress(me, nonce + 2);
        OpenDrandRouter router = new OpenDrandRouter();
        OpenVRFAdapter adapter = new OpenVRFAdapter(address(router), predictedFire);
        Fire fire = new Fire(Fire.Config({
            paper: address(paper), plank: address(plank), mill: address(press), seaport: address(0), royaltyPool: me,
            randomness: address(adapter), ethUsdFeed: address(ethUsd), plankUsdFeed: address(plankUsd), paperUsdFeed: address(0),
            usdg: address(usdg), paperPerTicket: 1e18, paperUsdCap: 33_000_000, plankPerTicket0: PLANK_PER_TICKET0,
            plankUsdPerTicket: 90_000_000, ethUsdPerTicket: 100_000_000, millBidBase: 300e8, rollTimeOfDay: 10800
        }));
        require(address(fire) == predictedFire, "address prediction failed");
        require(adapter.FIRE() == address(fire), "adapter points elsewhere");

        plank.mint(me, SEED);
        plank.approve(address(fire), SEED);
        fire.seed(SEED);
        vm.stopBroadcast();

        console.log("FIRE=%s", address(fire));
        console.log("PAPER=%s", address(paper));
        console.log("PLANK=%s", address(plank));
        console.log("USDG=%s", address(usdg));
        console.log("PLANK_USD_FEED=%s", address(plankUsd));
        console.log("PLANK_POOL=%s", address(pair));
        console.log("ETH_USD_FEED=%s", address(ethUsd));
        console.log("ROUTER=%s ADAPTER=%s", address(router), address(adapter));
        console.log("FROM_BLOCK=%s", block.number);
    }
}
