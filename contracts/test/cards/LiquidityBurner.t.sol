// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LiquidityBurner} from "../../src/cards/LiquidityBurner.sol";
import {V2Token, V2Weth, V2Pair, V2Factory, V2Router} from "./V2Lite.sol";

/// A price feed with the TWAP feeds' window (prev/last) and Chainlink's latestRoundData.
contract LiqFeed {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public at;
    constructor(uint8 d, int256 a) { decimals = d; answer = a; at = block.timestamp; }
    function set(int256 a) external { answer = a; at = block.timestamp; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) { return (1, answer, at, at, 1); }
    function prev() external view returns (uint256, uint32) { return (0, uint32(at - 30 minutes)); }
    function last() external view returns (uint256, uint32) { return (0, uint32(at)); }
}

/// docs/liquidity-burn.md: everything that used to burn pairs into PAPER/PLANK liquidity, the pool tokens to the
/// dead address; each side waits on its own; only a side over $100 burns outright. On a real-math V2 pool.
contract LiquidityBurnerTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11CE);
    address keeper = address(0xBEEF);
    V2Token paper;
    V2Token plank;
    V2Token usdg;
    V2Weth weth;
    V2Factory factory;
    V2Router router;
    V2Pair pp; // PAPER/PLANK
    LiquidityBurner lb;
    LiqFeed ethFeed;
    LiqFeed plankFeed;
    LiqFeed paperFeed;

    // prices: PAPER $0.08, PLANK $0.001, ETH $2,500, USDG $1
    uint256 constant P = 0.08e18;
    uint256 constant K = 0.001e18;
    uint256 constant E = 2_500e18;

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new V2Token("PAPER", 18);
        plank = new V2Token("PLANK", 18);
        usdg = new V2Token("USDG", 6);
        weth = new V2Weth();
        factory = new V2Factory();
        router = new V2Router(factory, weth);
        // pools at the feeds' prices: PAPER/PLANK $20k a side, WETH/PLANK $100k, WETH/PAPER $10k, USDG/WETH $50k
        _pool(address(paper), address(plank), _amt(20_000e18, P), _amt(20_000e18, K));
        vm.deal(address(this), 1_000 ether);
        weth.deposit{value: 100 ether}();
        _pool(address(weth), address(plank), _amt(100_000e18, E), _amt(100_000e18, K));
        _pool(address(weth), address(paper), _amt(10_000e18, E), _amt(10_000e18, P));
        _pool(address(usdg), address(weth), 50_000e6, _amt(50_000e18, E));
        pp = V2Pair(factory.getPair(address(paper), address(plank)));

        ethFeed = new LiqFeed(8, 2_500e8);
        plankFeed = new LiqFeed(18, int256(K));
        paperFeed = new LiqFeed(18, int256(P));
        lb = new LiquidityBurner(owner, address(paper), address(plank), address(usdg), 6, address(weth), address(router), address(pp));
        vm.startPrank(owner);
        lb.setFeeds(address(ethFeed), address(plankFeed), address(paperFeed));
        lb.setKeeper(keeper, true);
        lb.setRoutes(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PAPER, _r2(address(weth), address(paper)));
        lb.setRoutes(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PLANK, _r2(address(weth), address(plank)));
        lb.setRoutes(LiquidityBurner.Pay.USDG, LiquidityBurner.Side.PAPER, _r3(address(usdg), address(weth), address(paper)));
        lb.setRoutes(LiquidityBurner.Pay.USDG, LiquidityBurner.Side.PLANK, _r3(address(usdg), address(weth), address(plank)));
        lb.setRoutes(LiquidityBurner.Pay.PLANK, LiquidityBurner.Side.PAPER, _r2(address(plank), address(paper)));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _amt(uint256 usd18, uint256 px) internal pure returns (uint256) { return usd18 * 1e18 / px; }
    function _r2(address a, address b) internal pure returns (address[][] memory r) { r = new address[][](1); r[0] = new address[](2); r[0][0] = a; r[0][1] = b; }
    function _r3(address a, address b, address c) internal pure returns (address[][] memory r) { r = new address[][](1); r[0] = new address[](3); r[0][0] = a; r[0][1] = b; r[0][2] = c; }

    function _pool(address a, address b, uint256 amtA, uint256 amtB) internal {
        if (a != address(weth)) V2Token(a).mint(address(this), amtA);
        if (b != address(weth)) V2Token(b).mint(address(this), amtB);
        IERC20(a).approve(address(router), type(uint256).max);
        IERC20(b).approve(address(router), type(uint256).max);
        router.addLiquidity(a, b, amtA, amtB, 0, 0, address(this), block.timestamp);
    }

    function _paperIn(uint256 usd18) internal { paper.mint(address(lb), _amt(usd18, P)); }
    function _plankIn(uint256 usd18) internal { plank.mint(address(lb), _amt(usd18, K)); }
    function _ethIn(uint256 usd18) internal { vm.deal(address(this), address(this).balance + _amt(usd18, E)); (bool ok,) = address(lb).call{value: _amt(usd18, E)}(""); require(ok); }
    function _usdgIn(uint256 usd18) internal { usdg.mint(address(lb), usd18 / 1e12); }
    function _run() internal { vm.prank(keeper); lb.run(); }
    function _sides() internal view returns (uint256 vp, uint256 vk, uint256 vs) { return lb.held(); }
    function _near(uint256 a, uint256 b, uint256 bps) internal pure returns (bool) { return a * 10_000 <= b * (10_000 + bps) && b * 10_000 <= a * (10_000 + bps); }

    /// Ten times the liquidity in every pool (same prices).
    function _deepen() internal {
        vm.deal(address(this), address(this).balance + 2_000 ether);
        weth.deposit{value: 2_000 ether}();
        _pool(address(paper), address(plank), _amt(180_000e18, P), _amt(180_000e18, K));
        _pool(address(weth), address(plank), _amt(900_000e18, E), _amt(900_000e18, K));
        _pool(address(weth), address(paper), _amt(90_000e18, E), _amt(90_000e18, P));
    }

    /// The feeds follow the market (as the 30-minute averages do): PAPER and PLANK priced off their WETH pools.
    function _followMarket() internal {
        uint256 ethPerPaper = router.getAmountsOut(1e15, _r2(address(paper), address(weth))[0])[1] * 1000 * 1000 / 997;
        uint256 ethPerPlank = router.getAmountsOut(1e18, _r2(address(plank), address(weth))[0])[1] * 1000 / 997;
        paperFeed.set(int256(ethPerPaper * E / 1e18));
        plankFeed.set(int256(ethPerPlank * E / 1e18));
        ethFeed.set(2_500e8);
    }

    // ---------------------------------------------------------------- the owner's example

    /// $20 of PAPER waits; two $5 PLANK payments come in: $10 of each pairs and burns, $10 of PAPER keeps waiting.
    function test_ownersExample() public {
        _paperIn(20e18);
        _run();
        (uint256 vp, uint256 vk,) = _sides();
        assertTrue(_near(vp, 20e18, 1), "PAPER waits for PLANK");
        assertEq(vk, 0);
        assertEq(lb.lpBurned(), 0, "nothing to pair yet");

        _plankIn(5e18);
        _plankIn(5e18);
        _run();
        (vp, vk,) = _sides();
        assertTrue(_near(vp, 10e18, 100), "$10 of PAPER still waiting");
        assertLt(vk, 0.2e18, "the PLANK all paired");
        assertGt(lb.lpBurned(), 0, "liquidity burned");
        assertEq(pp.balanceOf(DEAD), lb.lpBurned() + pp.MINIMUM_LIQUIDITY(), "the pool tokens went to the dead address");
        assertEq(pp.balanceOf(address(lb)), 0, "it keeps none");
        assertTrue(_near(lb.paperToLiquidity() * P / 1e18, 10e18, 300), "$10 of PAPER into the pool");
    }

    // ---------------------------------------------------------------- spending

    /// ETH with the PAPER side under $50: 60% buys PAPER, the rest evens out the sides; then they pair.
    function test_ethBuysPaperFirstThenShortSide() public {
        uint256 deadPaperBefore = paper.balanceOf(DEAD);
        _ethIn(40e18);
        _run();
        (uint256 vp, uint256 vk, uint256 vs) = _sides();
        assertEq(vs, 0, "all the ETH spent");
        assertGt(lb.lpBurned(), 0);
        // $24 bought PAPER, $16 PLANK: $16 a side pairs, about $8 of PAPER waits
        assertTrue(_near(lb.plankToLiquidity() * K / 1e18, 16e18, 300), "about $16 of PLANK paired");
        assertTrue(_near(vp, 8e18, 600), "about $8 of PAPER waiting");
        assertLt(vk, 0.2e18);
        assertEq(paper.balanceOf(DEAD), deadPaperBefore, "nothing burned outright");
    }

    /// Once the PAPER side holds $50+, spendable money goes to the short side (PLANK) only.
    function test_paperFullSoSpendBuysPlank() public {
        _paperIn(80e18);
        _usdgIn(30e18);
        _run();
        (uint256 vp, uint256 vk, uint256 vs) = _sides();
        assertEq(vs, 0);
        assertTrue(_near(lb.plankToLiquidity() * K / 1e18, 30e18, 400), "the USDG bought about $30 of PLANK, all paired");
        assertTrue(_near(vp, 50e18, 300), "$50 of PAPER left waiting");
        assertLt(vk, 0.2e18);
    }

    /// PLANK heavier than PAPER: PLANK is sold for PAPER until they're even, then paired. PAPER is never sold.
    function test_plankHeavySellsPlankNeverPaper() public {
        _plankIn(60e18); // group 2's PLANK, say
        _paperIn(10e18);
        _run();
        (uint256 vp, uint256 vk,) = _sides();
        assertLt(vp + vk, 1.5e18, "evened out and paired");
        assertTrue(_near(lb.paperToLiquidity() * P / 1e18, 35e18, 400), "$10 + $25 bought: about $35 of PAPER paired");
    }

    // ---------------------------------------------------------------- the cap

    /// A side over $100 burns its excess outright; $100 keeps waiting.
    function test_overCapBurnsExcess() public {
        _paperIn(250e18);
        _run();
        (uint256 vp,,) = _sides();
        assertTrue(_near(vp, 100e18, 1), "$100 waits");
        assertTrue(_near(lb.paperBurned() * P / 1e18, 150e18, 1), "$150 burned outright");
        _plankIn(130e18);
        _run();
        assertEq(lb.plankBurned(), 0, "the PLANK evened out against the PAPER instead of spilling");
    }

    // ---------------------------------------------------------------- guards

    /// Someone pushes the pool's price before a run: no liquidity is added, the coins wait (and the cap still holds).
    function test_pushedPoolNoLiquidity() public {
        _paperIn(30e18);
        _plankIn(30e18);
        // dump PAPER into the PAPER/PLANK pool: its price drops ~10% against the feeds
        paper.mint(address(this), _amt(2_000e18, P));
        router.swapExactTokensForTokens(_amt(2_000e18, P), 0, _r2(address(paper), address(plank))[0], address(this), block.timestamp);
        _run();
        assertEq(lb.lpBurned(), 0, "no liquidity into a pushed pool");
        (uint256 vp,,) = _sides();
        assertTrue(_near(vp, 30e18, 1), "PAPER waits (and is never sold)");
    }

    /// A buy that would get under 95% of the coins' worth is refused (a smaller piece, else it waits).
    function test_badBuyWaits() public {
        // the WETH/PAPER and WETH/PLANK pools pushed against the buyer
        weth.deposit{value: 30 ether}();
        weth.approve(address(router), type(uint256).max);
        router.swapExactTokensForTokens(15 ether, 0, _r2(address(weth), address(paper))[0], address(this), block.timestamp);
        router.swapExactTokensForTokens(15 ether, 0, _r2(address(weth), address(plank))[0], address(this), block.timestamp);
        ethFeed.set(5_000e8); // and the feed says ETH is worth twice what the pools now give
        _ethIn(100e18);
        uint256 ethBefore = address(lb).balance;
        _run();
        assertEq(address(lb).balance, ethBefore, "the ETH waits: no buy under 95% of its worth");
    }

    /// A missing or stale price: nothing happens at all.
    function test_stalePriceWaits() public {
        _paperIn(20e18);
        _plankIn(20e18);
        vm.warp(block.timestamp + 3 days);
        _run();
        assertEq(lb.lpBurned(), 0);
        assertEq(lb.paperBurned() + lb.plankBurned(), 0);
    }

    /// run() says whether anything moved, so the keeper can simulate and skip a run that would do nothing.
    function test_runSaysWhetherAnythingMoved() public {
        vm.prank(keeper);
        assertFalse(lb.run(), "empty");
        _paperIn(20e18);
        vm.prank(keeper);
        assertFalse(lb.run(), "PAPER alone waits for PLANK");
        _plankIn(10e18);
        vm.prank(keeper);
        assertTrue(lb.run(), "paired and burned");
        assertGt(lb.lpBurned(), 0);
        _plankIn(10e18);
        vm.warp(block.timestamp + 3 days);
        vm.prank(keeper);
        assertFalse(lb.run(), "no price: everything waits");
    }

    // ---------------------------------------------------------------- who can do what

    function test_onlyKeepersRun() public {
        vm.expectRevert(LiquidityBurner.NotKeeper.selector);
        lb.run();
        vm.prank(owner);
        vm.expectRevert(LiquidityBurner.NotKeeper.selector);
        lb.run();
    }

    function test_feedsOnceRoutesLocked() public {
        vm.startPrank(owner);
        vm.expectRevert(LiquidityBurner.FeedsAlreadySet.selector);
        lb.setFeeds(address(ethFeed), address(plankFeed), address(paperFeed));
        // PLANK only buys PAPER; PAPER is never an input
        vm.expectRevert(LiquidityBurner.BadRoute.selector);
        lb.setRoutes(LiquidityBurner.Pay.PLANK, LiquidityBurner.Side.PLANK, _r2(address(plank), address(plank)));
        // a route through someone else's token
        address other = address(new V2Token("X", 18));
        vm.expectRevert(LiquidityBurner.BadRoute.selector);
        lb.setRoutes(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PAPER, _r3(address(weth), other, address(paper)));
        vm.expectRevert(LiquidityBurner.RenounceDisabled.selector);
        lb.renounceOwnership();
        vm.stopPrank();
    }

    function test_rejectsWrongPair() public {
        V2Pair other = V2Pair(factory.getPair(address(weth), address(paper)));
        vm.expectRevert(LiquidityBurner.BadPair.selector);
        new LiquidityBurner(owner, address(paper), address(plank), address(usdg), 6, address(weth), address(router), address(other));
    }

    /// FirePsa prices fees through quote().
    function test_quoteForFirePsa() public view {
        assertEq(lb.quote(LiquidityBurner.Pay.USDG, 1e18), 1e6);
        assertEq(lb.quote(LiquidityBurner.Pay.PLANK, 1e18), 1_000e18);
        assertEq(lb.quote(LiquidityBurner.Pay.ETH, 2_500e18), 1 ether);
    }

    // ---------------------------------------------------------------- a long mixed run

    /// Inflows of every kind in random order, a run after each few: every run ends with each side at most $100
    /// (plus rounding), no ETH/USDG left, no pool tokens kept, and PAPER only ever leaving into the pool or over the cap.
    function testFuzz_mixedFlows(uint256 seed) public {
        _deepen(); // markets the size of the real ones: the contract's own buys barely move them
        for (uint256 i; i < 40; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 usd = (seed % 3_000) * 1e16 + 0.05e18; // $0.05 .. $30
            uint256 kind = (seed >> 128) % 4;
            if (kind == 0) _paperIn(usd);
            else if (kind == 1) _plankIn(usd);
            else if (kind == 2) _ethIn(usd);
            else _usdgIn(usd);
            if (i % 3 == 2) {
                _followMarket();
                _run();
                (uint256 vp, uint256 vk, uint256 vs) = _sides();
                assertLe(vp, 100.01e18, "PAPER side over the cap");
                assertLe(vk, 100.01e18, "PLANK side over the cap");
                assertLt(vs, 0.01e18, "spendable left over");
                assertEq(pp.balanceOf(address(lb)), 0, "kept pool tokens");
            }
        }
    }

    receive() external payable {}
}
