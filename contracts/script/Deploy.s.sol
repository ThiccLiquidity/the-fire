// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Fire} from "../src/Fire.sol";
import {OpenVRFAdapter} from "../src/OpenVRFAdapter.sol";
import {OpenDrandRouter} from "../src/OpenDrandRouter.sol";
import {PaperUsdTwap} from "../src/PaperUsdTwap.sol";
import {IERC20Metadata} from "openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IFeed18 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

interface IPlankTwap {
    function PAIR() external view returns (address);
}

interface IPair2 {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/**
 * Deploy order (see ../docs/deploy.md):
 *   1. PlankUsdTwap (script/DeployTwap.s.sol), >= 30 min before step 2; call checkpoint() 30+ min after deploy, then every 30 min (keeper).
 *   2. This script: PaperUsdTwap + OpenDrandRouter + OpenVRFAdapter + Fire (four contracts). None has an owner;
 *      nothing to configure after. Everything is immutable, so the script checks every input first and refuses to
 *      deploy on a mistake. Deploy just after 21:00 UTC so fire #1 gets a full first day.
 *   3. Start ops/keeper (rolls, delivers drand proofs, recovers stuck rolls, checkpoints, sweeps the mill floor).
 *   4. Ask Plank Press admin: PulpPool.addRewardToken(PLANK).
 *
 *   forge script script/Deploy.s.sol --rpc-url $RPC --account deployer --sender <deployer address> --slow --broadcast \
 *     --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
 *   (--slow sends one transaction at a time, so the Fire's predicted address holds. Use the deployer key for nothing
 *   else while this runs. Afterwards, check adapter.FIRE() == Fire on the explorer before announcing.)
 *
 * PAPER, PLANK, MILL, ROYALTY_POOL = addresses on Robinhood Chain
 * ETH_USD_FEED   = Chainlink ETH/USD (8 decimals).
 * PLANK_USD_FEED = our PlankUsdTwap (**18 decimals** — an 8-decimal feed here would misprice the PLANK leg by 1e10).
 * PAPER_PER_TICKET     = 1e18 (1 PAPER, assuming 18 decimals — verify): the most PAPER a ticket ever takes
 * PAPER_USD_CAP        = 33000000 ($0.33, default): once PAPER trades above this, a ticket takes less than 1 PAPER
 * UNIV2_FACTORY, WETH  = Uniswap V2 factory + WETH on Robinhood Chain (the PAPER feed finds PAPER's pool there)
 * PLANK_PER_TICKET0    = starting PLANK per ticket in wei (~$0.90 of PLANK on launch day)
 * PLANK_USD_PER_TICKET = 90000000 ($0.90, 8 decimals) — logs cost this much PLANK at the live (~30-min average) price
 * ETH_USD_PER_TICKET   = 100000000 ($1.00) — price of the PAPER part when paid in ETH or USDG
 * MILL_BID_BASE     = starting mill bid in USD, 8 decimals (e.g. 50000000000 = $500). It climbs ~1%/hour until a mill
 *                     sells, so start at or below where you expect the floor. Listings may be in USDG or ETH.
 * USDG              = the USDG token on Robinhood Chain (mill listings are priced in it)
 * ROLL_TIME_OF_DAY  = 75600 (21:00 UTC = 2:00 PM MST)
 */
contract Deploy is Script {
    function run() external {
        _checkInputs();
        vm.startBroadcast();
        // PAPER feed, router, adapter, then Fire. The adapter needs the Fire's address and vice versa: predict it (nonce+3).
        address deployer = msg.sender;
        uint64 nonce = vm.getNonce(deployer);
        address predictedFire = vm.computeCreateAddress(deployer, nonce + 3);

        // PAPER has no market yet: this feed finds the PAPER/WETH or PAPER/USDG pool once someone creates it.
        PaperUsdTwap paperTwap = new PaperUsdTwap(
            vm.envAddress("UNIV2_FACTORY"), vm.envAddress("PAPER"), vm.envAddress("WETH"), vm.envAddress("USDG"),
            IERC20Metadata(vm.envAddress("USDG")).decimals(),
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
        // Optional launch seed: SEED_PLANK (wei) of the deployer's PLANK into fire #1's pot. Only the deployer can do this,
        // once, before the first storm (Fire.seed). It can also be done later by hand: approve, then fire.seed(amount).
        uint256 seedAmount = vm.envOr("SEED_PLANK", uint256(0));
        if (seedAmount > 0) {
            IERC20Metadata(vm.envAddress("PLANK")).approve(address(fire), seedAmount);
            fire.seed(seedAmount);
            console.log("Seeded pot (PLANK wei):", seedAmount);
        }
        console.log("Fire:", address(fire));
        console.log("Adapter:", address(adapter));
        console.log("Router:", address(router));
        console.log("PaperUsdTwap:", address(paperTwap));
        vm.stopBroadcast();
    }

    /// @dev Everything the Fire is built from is permanent. Stop here rather than deploy a mistake.
    function _checkInputs() internal view {
        require(block.chainid == 4663, "not Robinhood Chain (4663)");
        string[9] memory names = ["PAPER", "PLANK", "MILL", "SEAPORT", "ETH_USD_FEED", "PLANK_USD_FEED", "USDG", "UNIV2_FACTORY", "WETH"];
        for (uint256 i; i < names.length; i++) {
            require(vm.envAddress(names[i]).code.length > 0, string.concat(names[i], " has no contract code"));
        }
        require(vm.envAddress("ROYALTY_POOL").code.length > 0, "ROYALTY_POOL has no contract code");
        require(IERC20Metadata(vm.envAddress("PAPER")).decimals() == 18, "PAPER is not 18 decimals: the PAPER leg math assumes 18");
        require(IERC20Metadata(vm.envAddress("PLANK")).decimals() == 18, "PLANK is not 18 decimals");
        require(vm.envUint("PAPER_PER_TICKET") == 1e18, "PAPER_PER_TICKET should be 1e18 (1 PAPER)");

        IFeed18 plankFeed = IFeed18(vm.envAddress("PLANK_USD_FEED"));
        require(plankFeed.decimals() == 18, "PLANK_USD_FEED must be the 18-decimal PlankUsdTwap");
        address pair = IPlankTwap(address(plankFeed)).PAIR();
        address plank = vm.envAddress("PLANK");
        require(IPair2(pair).token0() == plank || IPair2(pair).token1() == plank, "PLANK_USD_FEED is not on a PLANK pool");
        (, int256 px,, uint256 upd,) = plankFeed.latestRoundData();
        require(px > 0 && block.timestamp - upd < 2 days, "PLANK_USD_FEED has no fresh price yet: checkpoint it 30+ min after its deploy");
        (, int256 eth,, uint256 eupd,) = IFeed18(vm.envAddress("ETH_USD_FEED")).latestRoundData();
        require(eth > 0 && block.timestamp - eupd < 25 hours, "ETH_USD_FEED is stale");

        uint256 usdPerTicket = vm.envUint("PLANK_USD_PER_TICKET");
        uint256 target = usdPerTicket * 1e28 / uint256(px);
        uint256 start = vm.envUint("PLANK_PER_TICKET0");
        require(start * 10 >= target * 9 && start * 10 <= target * 11,
            string.concat("PLANK_PER_TICKET0 should be within 10% of ", vm.toString(target), " (today's $ target)"));
        require(vm.envUint("ETH_USD_PER_TICKET") == 1e8, "ETH_USD_PER_TICKET should be 100000000 ($1)");
        uint256 bid = vm.envUint("MILL_BID_BASE");
        require(bid >= 10e8 && bid <= 5_000e8, "MILL_BID_BASE looks wrong (8 decimals: $300 = 30000000000)");
        require(vm.envUint("ROLL_TIME_OF_DAY") < 1 days, "ROLL_TIME_OF_DAY must be seconds after 00:00 UTC");
    }
}
