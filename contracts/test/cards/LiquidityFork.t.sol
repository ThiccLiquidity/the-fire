// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {LiquidityBurner} from "../../src/cards/LiquidityBurner.sol";
import {PlankUsdTwap} from "../../src/PlankUsdTwap.sol";
import {PaperUsdTwap} from "../../src/PaperUsdTwap.sol";

interface IForkFactory {
    function getPair(address a, address b) external view returns (address);
}

interface IForkFeed {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}

/// LiquidityBurner against the REAL PAPER/PLANK pool on a copy of Robinhood Chain: the price feeds warmed up on the
/// real pools, then a keeper run pairs PAPER with PLANK, adds it to the real pool and burns the pool tokens.
/// Skipped unless FORK_RPC is set (PowerShell, from contracts/):
///   $env:FORK_RPC = "https://rpc.mainnet.chain.robinhood.com"
///   forge test --match-path test/cards/LiquidityFork.t.sol -vv
/// Chainlink ETH/USD doesn't update while the copy's clock is moved on, so its last answer is replayed as fresh.
contract LiquidityForkTest is Test {
    address constant PAPER = 0x06420168Ed7e368dd8dcB30C79CdD0D8F4ccb3e6;
    address constant PLANK = 0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant ROUTER = 0x89e5DB8B5aA49aA85AC63f691524311AEB649eba;
    address constant FACTORY = 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f;
    address constant PLANK_WETH = 0x01b1BEf6fBA02c846eA5c4Ff59193988B5f86F73;
    address constant ETH_USD = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    PlankUsdTwap plankTwap;
    PaperUsdTwap paperTwap;
    LiquidityBurner lb;
    address pool;
    int256 ethPx;

    function _freshEth() internal {
        vm.mockCall(ETH_USD, abi.encodeWithSelector(IForkFeed.latestRoundData.selector), abi.encode(uint80(1), ethPx, block.timestamp, block.timestamp, uint80(1)));
    }

    function _wait(uint256 sec) internal {
        vm.warp(block.timestamp + sec);
        vm.roll(block.number + sec / 2);
        _freshEth();
    }

    function _path(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        (r[0], r[1]) = (a, b);
    }

    function _path(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3);
        (r[0], r[1], r[2]) = (a, b, c);
    }

    function _setUp() internal returns (bool) {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return false;
        vm.createSelectFork(rpc);
        (, ethPx,,,) = IForkFeed(ETH_USD).latestRoundData();
        _freshEth();
        pool = IForkFactory(FACTORY).getPair(PAPER, PLANK);
        require(pool != address(0), "no PAPER/PLANK pool on this chain");

        plankTwap = new PlankUsdTwap(PLANK_WETH, PLANK, ETH_USD);
        paperTwap = new PaperUsdTwap(FACTORY, PAPER, WETH, USDG, 6, ETH_USD, PLANK, address(plankTwap));
        // warm up: the PAPER feed adopts a pool after 20 h, its first price a window later
        for (uint256 i; i < 3; i++) {
            _wait(20 hours + 1 minutes);
            plankTwap.checkpoint();
            paperTwap.checkpoint();
        }
        _wait(31 minutes);
        plankTwap.checkpoint(); // a short PLANK window again

        lb = new LiquidityBurner(address(this), PAPER, PLANK, USDG, 6, WETH, ROUTER, pool);
        lb.setFeeds(ETH_USD, address(plankTwap), address(paperTwap));
        lb.setKeeper(address(this), true);
        address[][] memory two = new address[][](2);
        two[0] = _path(WETH, PAPER);
        two[1] = _path(WETH, PLANK, PAPER);
        lb.setRoutes(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PAPER, two);
        two[0] = _path(PLANK, PAPER);
        two[1] = _path(PLANK, WETH, PAPER);
        lb.setRoutes(LiquidityBurner.Pay.PLANK, LiquidityBurner.Side.PAPER, two);
        address[][] memory one = new address[][](1);
        one[0] = _path(WETH, PLANK);
        lb.setRoutes(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PLANK, one);
        // its own short PAPER average: two checkpoints 31 minutes apart
        lb.checkpoint();
        _wait(31 minutes);
        plankTwap.checkpoint();
        lb.checkpoint();
        return true;
    }

    /// The owner's example on the real pool: $20 of PAPER waits, $10 of PLANK arrives, a run pairs $10 of each and
    /// burns the pool tokens; then ETH from sales is spent and paired too.
    function test_fork_pairsAndBurnsOnTheRealPool() public {
        if (!_setUp()) {
            vm.skip(true);
            return;
        }
        (uint256 p, uint256 k) = lb.prices();
        console.log("PAPER $ (x1e18)", p);
        console.log("PLANK $ (x1e18)", k);
        assertGt(p, 0, "a PAPER price");
        assertGt(k, 0, "a PLANK price");

        deal(PAPER, address(lb), 20e18 * 1e18 / p);
        deal(PLANK, address(lb), 10e18 * 1e18 / k);
        uint256 dead0 = IERC20(pool).balanceOf(DEAD);
        assertTrue(lb.run(), "the run moved something");
        uint256 lp = lb.lpBurned();
        assertGt(lp, 0, "liquidity added");
        assertEq(IERC20(pool).balanceOf(DEAD) - dead0, lp, "every pool token went to the dead address");
        assertEq(IERC20(pool).balanceOf(address(lb)), 0, "it keeps no pool tokens");
        (uint256 vp, uint256 vk,) = lb.held();
        console.log("left: PAPER side $", vp / 1e18, "PLANK side $", vk / 1e18);
        assertLt(vk, 1e18, "the PLANK paired up");
        assertGt(vp, 8e18, "about $10 of PAPER still waits");

        // ETH from sales: about $15
        _wait(15 minutes);
        vm.deal(address(lb), 15e18 * 1e8 / uint256(ethPx));
        assertTrue(lb.run(), "spent and paired");
        (,, uint256 vs) = lb.held();
        assertLt(vs, 1e17, "the ETH was spent");
        assertGt(lb.lpBurned(), lp, "more liquidity burned");
        console.log("pool tokens burned in all", lb.lpBurned());
    }
}
