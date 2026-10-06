// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PaperBurner} from "../../src/cards/PaperBurner.sol";
import {MockERC20, MockUSDG, MockFeed, MockPlankTwap, MockPair} from "../Mocks.sol";

/// @dev A Uniswap V2 router over constant-product pools (0.3% fee). The output token is minted to `to`; inputs are
///      taken from the caller. Enough to test routing, splitting and the guard.
contract PoolRouter {
    struct Pool { uint256 a; uint256 b; } // reserves of (lower address, higher address)
    mapping(bytes32 => Pool) public pools;
    address public WETH;
    bool public broken;

    constructor(address weth) { WETH = weth; }

    function setBroken(bool b) external { broken = b; }

    function _key(address x, address y) internal pure returns (bytes32) {
        return x < y ? keccak256(abi.encode(x, y)) : keccak256(abi.encode(y, x));
    }

    function setPool(address x, address y, uint256 rx, uint256 ry) external {
        pools[_key(x, y)] = x < y ? Pool(rx, ry) : Pool(ry, rx);
    }

    function reserves(address x, address y) public view returns (uint256 rx, uint256 ry) {
        Pool memory p = pools[_key(x, y)];
        (rx, ry) = x < y ? (p.a, p.b) : (p.b, p.a);
    }

    function _hop(address x, address y, uint256 amountIn) internal view returns (uint256) {
        (uint256 rx, uint256 ry) = reserves(x, y);
        require(rx > 0 && ry > 0, "no pool");
        uint256 inFee = amountIn * 997;
        return inFee * ry / (rx * 1000 + inFee);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path) public view returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i + 1 < path.length; i++) amounts[i + 1] = _hop(path[i], path[i + 1], amounts[i]);
    }

    function _run(uint256 amountIn, uint256 minOut, address[] calldata path, address to) internal returns (uint256[] memory a) {
        require(!broken, "router down");
        a = getAmountsOut(amountIn, path);
        require(a[a.length - 1] >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
        for (uint256 i; i + 1 < path.length; i++) {
            (uint256 rx, uint256 ry) = reserves(path[i], path[i + 1]);
            bytes32 k = _key(path[i], path[i + 1]);
            (rx, ry) = (rx + a[i], ry - a[i + 1]);
            pools[k] = path[i] < path[i + 1] ? Pool(rx, ry) : Pool(ry, rx);
        }
        MockERC20(path[path.length - 1]).mint(to, a[a.length - 1]);
    }

    function swapExactETHForTokens(uint256 minOut, address[] calldata path, address to, uint256)
        external
        payable
        returns (uint256[] memory)
    {
        require(path[0] == WETH, "path");
        return _run(msg.value, minOut, path, to);
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256)
        external
        returns (uint256[] memory)
    {
        MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        return _run(amountIn, minOut, path, to);
    }
}

contract BurnerTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11CE);
    MockERC20 paper;
    MockERC20 plank;
    MockUSDG usdg;
    MockERC20 weth;
    PoolRouter router;
    MockFeed ethUsd;
    MockPlankTwap plankUsd;
    MockFeed paperUsd;
    PaperBurner b;

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new MockERC20("PAPER", "PAPER");
        plank = new MockERC20("PLANK", "PLANK");
        usdg = new MockUSDG();
        weth = new MockERC20("WETH", "WETH");
        router = new PoolRouter(address(weth));
        ethUsd = new MockFeed(2_500e8); // $2,500
        plankUsd = new MockPlankTwap(1e9, address(new MockPair(address(weth), address(plank)))); // $1e-9
        paperUsd = new MockFeed(0.08e18); // $0.08
        paperUsd.setDecimals(18);
        b = new PaperBurner(owner, address(paper), address(plank), address(usdg), 6, address(weth), address(router));
        vm.startPrank(owner);
        b.setFeeds(address(ethUsd), address(plankUsd), address(paperUsd));
        address[][] memory r = new address[][](2);
        r[0] = _p(address(weth), address(paper));
        r[1] = _p3(address(weth), address(plank), address(paper));
        b.setRoutes(PaperBurner.Pay.ETH, r);
        r[0] = _p(address(plank), address(paper));
        r[1] = _p3(address(plank), address(weth), address(paper));
        b.setRoutes(PaperBurner.Pay.PLANK, r);
        vm.stopPrank();
        // pools priced consistently with the feeds: PAPER $0.08, ETH $2,500, PLANK $1e-9
        router.setPool(address(paper), address(plank), 1_000_000e18, 80_000_000_000_000e18); // $80k a side
        router.setPool(address(weth), address(plank), 40e18, 100_000_000_000_000e18); // $100k a side
        router.setPool(address(weth), address(paper), 0.04e18, 1_250e18); // a thin $100 pool
    }

    function _p(address x, address y) internal pure returns (address[] memory r) {
        r = new address[](2);
        (r[0], r[1]) = (x, y);
    }

    function _p3(address x, address y, address z) internal pure returns (address[] memory r) {
        r = new address[](3);
        (r[0], r[1], r[2]) = (x, y, z);
    }

    function test_quotes() public view {
        assertEq(b.quote(PaperBurner.Pay.ETH, 1e18), uint256(1e18) / 2_500, "$1 of ETH");
        assertEq(b.quote(PaperBurner.Pay.ETH, 1), 1, "never rounds down to 0");
        assertEq(b.quote(PaperBurner.Pay.PLANK, 1e18), 1e27, "$1 of PLANK");
        assertEq(b.quote(PaperBurner.Pay.USDG, 1e18), 1e6, "$1 of USDG");
    }

    /// The deep route through PLANK beats the thin direct pool, and the whole fee is burned.
    function test_ethBurnsThroughTheBestRoute() public {
        uint256 fee = b.quote(PaperBurner.Pay.ETH, 1e18);
        vm.deal(address(this), fee);
        (bool ok,) = address(b).call{value: fee}("");
        assertTrue(ok);
        (uint256 a,,, uint256 quoted) = b.planFor(PaperBurner.Pay.ETH, fee);
        assertEq(a, 1, "through PLANK");
        uint256 out = b.flush(PaperBurner.Pay.ETH);
        assertEq(out, quoted);
        assertEq(paper.balanceOf(DEAD), out);
        assertApproxEqRel(out, 12.5e18, 0.01e18, "$1 buys about 12.5 PAPER at $0.08");
        assertEq(address(b).balance, 0, "nothing left");
    }

    /// A bigger fee splits half and half when that gives more.
    function test_bigFeesSplitAcrossRoutes() public {
        router.setPool(address(weth), address(paper), 40e18, 1_250_000e18); // now both deep
        uint256 fee = b.quote(PaperBurner.Pay.ETH, 3_000e18); // $3k: moves either pool on its own
        (uint256 a, uint256 c, uint256 inA,) = b.planFor(PaperBurner.Pay.ETH, fee);
        assertTrue(a != c, "split");
        assertEq(inA, fee / 2);
        vm.deal(address(b), fee);
        uint256 out = b.flush(PaperBurner.Pay.ETH);
        assertGt(out, 0);
        assertEq(address(b).balance, 0);
    }

    function test_plankAndUsdg() public {
        plank.mint(address(b), 1e27); // $1
        uint256 out = b.flush(PaperBurner.Pay.PLANK);
        assertApproxEqRel(out, 12.5e18, 0.01e18);
        assertEq(plank.balanceOf(address(b)), 0);
        assertEq(plank.allowance(address(b), address(router)), 0, "no allowance left");
        // no USDG routes yet: the fee waits
        usdg.mint(address(b), 1e6);
        assertEq(b.flush(PaperBurner.Pay.USDG), 0);
        assertEq(usdg.balanceOf(address(b)), 1e6, "waiting");
        vm.startPrank(owner);
        address[][] memory r = new address[][](1);
        r[0] = new address[](4);
        (r[0][0], r[0][1], r[0][2], r[0][3]) = (address(usdg), address(weth), address(plank), address(paper));
        b.setRoutes(PaperBurner.Pay.USDG, r);
        vm.stopPrank();
        router.setPool(address(usdg), address(weth), 100_000e6, 40e18);
        out = b.flush(PaperBurner.Pay.USDG);
        assertApproxEqRel(out, 12.5e18, 0.02e18);
        assertEq(usdg.balanceOf(address(b)), 0);
    }

    /// A pumped pool (PAPER dear against its 20-hour price) fails the guard: nothing is spent, the fee waits, and a
    /// later flush burns it once the pool is back.
    function test_guardWaitsOnAPumpedPool() public {
        router.setPool(address(paper), address(plank), 500_000e18, 80_000_000_000_000e18); // PAPER at 2x
        router.setPool(address(weth), address(paper), 0.04e18, 600e18);
        uint256 fee = b.quote(PaperBurner.Pay.ETH, 1e18);
        vm.deal(address(b), fee);
        assertEq(b.flush(PaperBurner.Pay.ETH), 0);
        assertEq(address(b).balance, fee, "waiting, not spent");
        assertEq(paper.balanceOf(DEAD), 0);
        router.setPool(address(paper), address(plank), 1_000_000e18, 80_000_000_000_000e18);
        assertGt(b.flush(PaperBurner.Pay.ETH), 0, "anyone can flush later");
        assertEq(address(b).balance, 0);
    }

    function test_waitsWithoutAPriceOrWhenTheRouterFails() public {
        vm.deal(address(b), 1e15);
        vm.warp(block.timestamp + 3 days); // PAPER feed stale
        ethUsd.set(2_500e8);
        assertEq(b.flush(PaperBurner.Pay.ETH), 0);
        assertEq(address(b).balance, 1e15);
        paperUsd.set(0.08e18);
        router.setBroken(true);
        assertEq(b.flush(PaperBurner.Pay.ETH), 0, "a failing swap keeps the fee");
        assertEq(address(b).balance, 1e15);
        router.setBroken(false);
        assertGt(b.flush(PaperBurner.Pay.ETH), 0);
    }

    function test_routesMustEndInPaperAndOnlyTheOwnerSetsThem() public {
        address[][] memory r = new address[][](1);
        r[0] = _p(address(weth), address(plank)); // doesn't end in PAPER
        vm.prank(owner);
        vm.expectRevert(PaperBurner.BadRoute.selector);
        b.setRoutes(PaperBurner.Pay.ETH, r);
        r[0] = _p(address(plank), address(paper)); // starts at the wrong token
        vm.prank(owner);
        vm.expectRevert(PaperBurner.BadRoute.selector);
        b.setRoutes(PaperBurner.Pay.ETH, r);
        r[0] = _p(address(weth), address(paper));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        b.setRoutes(PaperBurner.Pay.ETH, r);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        b.setFeeds(address(1), address(2), address(3));
        vm.prank(owner);
        vm.expectRevert(PaperBurner.FeedsAlreadySet.selector); // set once: the owner can't swap a feed later
        b.setFeeds(address(ethUsd), address(plankUsd), address(paperUsd));
        PaperBurner fresh = new PaperBurner(owner, address(paper), address(plank), address(usdg), 6, address(weth), address(router));
        vm.prank(owner);
        vm.expectRevert(PaperBurner.FeedUnavailable.selector);
        fresh.setFeeds(address(paperUsd), address(plankUsd), address(ethUsd)); // ETH and PAPER feeds swapped
    }

    /// The owner can't route fees through a pool of their own token: only WETH, PLANK or USDG may sit in between.
    function test_routesOnlyThroughKnownTokens() public {
        MockERC20 own = new MockERC20("X", "X");
        address[][] memory r = new address[][](1);
        r[0] = _p3(address(weth), address(own), address(paper));
        vm.prank(owner);
        vm.expectRevert(PaperBurner.BadRoute.selector);
        b.setRoutes(PaperBurner.Pay.ETH, r);
        r[0] = _p3(address(weth), address(weth), address(paper)); // back through its own input
        vm.prank(owner);
        vm.expectRevert(PaperBurner.BadRoute.selector);
        b.setRoutes(PaperBurner.Pay.ETH, r);
        r[0] = _p3(address(weth), address(usdg), address(paper));
        vm.prank(owner);
        b.setRoutes(PaperBurner.Pay.ETH, r);
    }

    /// The light flush (what FirePsa runs with each fee) only tries the whole amount and half.
    function test_flushLightTriesLittle() public {
        vm.deal(address(b), 8e18); // too big for the pools at once or in half
        assertEq(b.flushLight(PaperBurner.Pay.ETH), 0, "waits");
        assertEq(address(b).balance, 8e18);
        assertGt(b.flush(PaperBurner.Pay.ETH), 0, "the full flush finds a piece that fits");
    }

    /// A backlog too big for the pools at once is bought in pieces (half, a quarter, ...) instead of waiting forever.
    function test_backlogDrainsInPieces() public {
        vm.deal(address(b), 8e18); // $20k against ~$80k-a-side pools
        uint256 out = b.flush(PaperBurner.Pay.ETH);
        assertGt(out, 0, "a piece burned");
        assertLt(address(b).balance, 8e18);
        assertGt(address(b).balance, 0, "the rest waits");
        uint256 left = address(b).balance;
        // the pools' price now sits below the 20-hour average; once arbitrage restores it, the next piece goes
        router.setPool(address(paper), address(plank), 1_000_000e18, 80_000_000_000_000e18);
        router.setPool(address(weth), address(plank), 40e18, 100_000_000_000_000e18);
        assertGt(b.flush(PaperBurner.Pay.ETH), 0, "the next flush burns another piece");
        assertLt(address(b).balance, left);
    }
}
