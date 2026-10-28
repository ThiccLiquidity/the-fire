// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {LiquidityBurner} from "../../src/cards/LiquidityBurner.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {CardsRenderer} from "../../src/cards/CardsRenderer.sol";
import {MockRandomness} from "../Mocks.sol";
import {SeriesHelper} from "./SeriesHelper.sol";
import {V2Token, V2Weth, V2Pair, V2Factory, V2Router} from "./V2Lite.sol";
import {LiqFeed} from "./LiquidityBurner.t.sol";

/// @dev FirePsa against the real LiquidityBurner on a real-math V2 pool (docs/grading.md, docs/liquidity-burn.md):
///      case and grading fees land in the burner in the coin paid and nothing else happens inside `protect` (nothing
///      to sandwich); a keeper's `run` then turns them into PAPER/PLANK liquidity whose pool tokens go to the dead
///      address. Plus gas for the biggest batches.
contract PsaBurnTest is SeriesHelper {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11CE0);
    address seller = address(0x5E11);
    address alice = address(0xA1);
    address keeper = address(0xEE);

    // prices: PAPER $0.08, PLANK $0.001, ETH $2,500, USDG $1
    uint256 constant P = 0.08e18;
    uint256 constant K = 0.001e18;
    uint256 constant E = 2_500e18;

    V2Token paper;
    V2Token plank;
    V2Token usdg;
    V2Weth weth;
    V2Factory factory;
    V2Router router;
    V2Pair pp; // PAPER/PLANK
    LiqFeed ethUsd;
    LiqFeed plankUsd;
    LiqFeed paperUsd;
    LiquidityBurner burner;
    MockRandomness cardRng;
    MockRandomness psaRng;
    FirePacks packs;
    FireCards cards;
    RecipeDealer dealer;
    FirePsa psa;

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new V2Token("PAPER", 18);
        plank = new V2Token("PLANK", 18);
        usdg = new V2Token("USDG", 6);
        weth = new V2Weth();
        factory = new V2Factory();
        router = new V2Router(factory, weth);
        vm.deal(address(this), 1_000 ether);
        weth.deposit{value: 100 ether}();
        _pool(address(paper), address(plank), _amt(20_000e18, P), _amt(20_000e18, K));
        _pool(address(weth), address(plank), _amt(100_000e18, E), _amt(100_000e18, K));
        _pool(address(weth), address(paper), _amt(10_000e18, E), _amt(10_000e18, P));
        _pool(address(usdg), address(weth), 50_000e6, _amt(50_000e18, E));
        pp = V2Pair(factory.getPair(address(paper), address(plank)));

        ethUsd = new LiqFeed(8, 2_500e8);
        plankUsd = new LiqFeed(18, int256(K));
        paperUsd = new LiqFeed(18, int256(P));
        burner = new LiquidityBurner(owner, address(paper), address(plank), address(usdg), 6, address(weth), address(router), address(pp));
        cardRng = new MockRandomness();
        psaRng = new MockRandomness();
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        cardRng.setFire(address(cards));
        psa = new FirePsa(owner, address(cards), address(burner));
        psaRng.setFire(address(psa));
        vm.startPrank(owner);
        burner.setFeeds(address(ethUsd), address(plankUsd), address(paperUsd));
        burner.setKeeper(keeper, true);
        burner.setRoutes(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PAPER, _r2(address(weth), address(paper)));
        burner.setRoutes(LiquidityBurner.Pay.ETH, LiquidityBurner.Side.PLANK, _r2(address(weth), address(plank)));
        burner.setRoutes(LiquidityBurner.Pay.USDG, LiquidityBurner.Side.PAPER, _r3(address(usdg), address(weth), address(paper)));
        burner.setRoutes(LiquidityBurner.Pay.USDG, LiquidityBurner.Side.PLANK, _r3(address(usdg), address(weth), address(plank)));
        burner.setRoutes(LiquidityBurner.Pay.PLANK, LiquidityBurner.Side.PAPER, _r2(address(plank), address(paper)));
        packs.setSeller(seller);
        packs.setCards(address(cards));
        cards.setSeller(seller);
        cards.setRandomness(address(cardRng));
        cards.setPsa(address(psa));
        cards.setRenderer(address(new CardsRenderer(address(cards))));
        psa.setRandomness(address(psaRng));
        vm.stopPrank();
        _standard(cards, dealer, owner, 1, 2);
        vm.startPrank(seller);
        packs.mint(alice, 1, 20);
        cards.closeFire(1);
        vm.stopPrank();
        vm.prank(alice);
        cards.open(1, 20);
        cardRng.fulfill(cardRng.last(), 7);
        cards.process(1, 1000);
        vm.deal(alice, 1_000 ether);
        plank.mint(alice, 1e30);
        usdg.mint(alice, 1_000e6);
        vm.startPrank(alice);
        plank.approve(address(psa), type(uint256).max);
        usdg.approve(address(psa), type(uint256).max);
        vm.stopPrank();
        // LiquidityBurner's short PAPER average needs 30 minutes of the pool's prices
        vm.warp(block.timestamp + 31 minutes);
        _freshFeeds();
    }

    function _freshFeeds() internal {
        ethUsd.set(2_500e8);
        plankUsd.set(int256(K));
        paperUsd.set(int256(P));
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

    function _none() internal pure returns (uint256[] memory) {
        return new uint256[](0);
    }

    function _first(uint256 n) internal pure returns (uint256[] memory) {
        return _ids(1, n);
    }

    function _reserves() internal view returns (uint112 r0, uint112 r1) {
        (r0, r1,) = pp.getReserves();
    }

    // ---------------------------------------------------------------- fees

    /// Each fee lands in LiquidityBurner in the coin paid, exactly the quote, and FirePsa keeps nothing.
    function test_feesLandInTheBurnerInTheCoinPaid() public {
        uint256 ce = psa.quote(0, 20, FirePsa.Pay.ETH);
        assertEq(ce, 20e18 * 1e18 / E, "$20 in ETH at $2,500");
        uint256 eth = alice.balance;
        vm.prank(alice);
        psa.protect{value: ce + 1 ether}(_none(), _ids(1, 20), FirePsa.Pay.ETH, ce);
        assertEq(address(burner).balance, ce, "ETH fee to the burner");
        assertEq(eth - alice.balance, ce, "the rest back");

        uint256 cp = psa.quote(20, 0, FirePsa.Pay.PLANK);
        assertEq(cp, 1_000e18, "20 cases = $1 = 1,000 PLANK");
        vm.prank(alice);
        psa.protect(_ids(21, 20), _none(), FirePsa.Pay.PLANK, cp);
        assertEq(plank.balanceOf(address(burner)), cp, "PLANK fee to the burner");

        uint256 cu = psa.quote(0, 10, FirePsa.Pay.USDG);
        assertEq(cu, 10e6);
        vm.prank(alice);
        psa.protect(_none(), _ids(41, 10), FirePsa.Pay.USDG, cu);
        assertEq(usdg.balanceOf(address(burner)), cu, "USDG fee to the burner");

        assertEq(address(psa).balance + plank.balanceOf(address(psa)) + usdg.balanceOf(address(psa)), 0, "FirePsa holds nothing");
        assertEq(burner.lpBurned(), 0, "nothing runs inside protect");
    }

    /// Regression (audit 2026-10, medium, was: `protect` flushed the burner's whole balance and could be wrapped in
    /// a buy and a sell): `protect` now only deposits its fee. A backlog waiting for the keeper is untouched and the
    /// pools don't move, so there is nothing to sandwich; only a keeper's run spends it.
    function test_protectOnlyDepositsTheFee() public {
        vm.deal(address(burner), 2 ether); // $5,000 waiting for the keeper
        (uint112 a0, uint112 a1) = _reserves();
        uint256 c = psa.quote(1, 0, FirePsa.Pay.ETH);
        vm.prank(alice);
        psa.protect{value: c}(_ids(1, 1), _none(), FirePsa.Pay.ETH, c);
        assertEq(address(burner).balance, 2 ether + c, "the backlog plus this fee, nothing spent");
        (uint112 b0, uint112 b1) = _reserves();
        assertEq(uint256(a0), uint256(b0), "the PAPER/PLANK pool didn't move");
        assertEq(uint256(a1), uint256(b1));
        assertEq(paper.balanceOf(address(burner)) + plank.balanceOf(address(burner)), 0, "nothing bought");
        vm.expectRevert(LiquidityBurner.NotKeeper.selector);
        vm.prank(alice);
        burner.run(); // and nobody but a keeper can make it spend
    }

    /// A keeper's run turns the fees (ETH, PLANK, USDG) into PAPER/PLANK liquidity, its pool tokens to the dead
    /// address; the burner keeps no pool tokens and no ETH or USDG.
    function test_keeperRunTurnsFeesIntoBurnedLiquidity() public {
        uint256 ce = psa.quote(0, 20, FirePsa.Pay.ETH);
        vm.prank(alice);
        psa.protect{value: ce}(_none(), _ids(1, 20), FirePsa.Pay.ETH, ce); // $20
        uint256 cp = psa.quote(20, 0, FirePsa.Pay.PLANK);
        vm.prank(alice);
        psa.protect(_ids(21, 20), _none(), FirePsa.Pay.PLANK, cp); // $1
        uint256 cu = psa.quote(0, 10, FirePsa.Pay.USDG);
        vm.prank(alice);
        psa.protect(_none(), _ids(41, 10), FirePsa.Pay.USDG, cu); // $10
        uint256 deadLp = pp.balanceOf(DEAD);

        vm.prank(keeper);
        burner.run();
        assertGt(burner.lpBurned(), 0, "liquidity added");
        assertEq(pp.balanceOf(DEAD), deadLp + burner.lpBurned(), "its pool tokens at the dead address");
        assertEq(pp.balanceOf(address(burner)), 0, "keeps none");
        assertEq(address(burner).balance, 0, "the ETH fees spent");
        assertEq(usdg.balanceOf(address(burner)), 0, "the USDG fees spent");
        assertGt(burner.paperToLiquidity(), 0);
        assertGt(burner.plankToLiquidity(), cp, "more PLANK paired than the PLANK fees alone: the ETH/USDG bought some");
        (uint256 vp, uint256 vk, uint256 vs) = burner.held();
        assertEq(vs, 0);
        assertLt(vk, 0.5e18, "the PLANK side paired");
        assertLt(vp + vk, 31e18, "what waits is less than what came in");
    }

    /// A stale PAPER feed: case and grading in ETH still work (priced off ETH/USD), the fee waits in the burner;
    /// a run does nothing until the price is fresh, then pairs it.
    function test_staleFeedFeeWaits() public {
        vm.warp(block.timestamp + 2 days + 1); // the PAPER feed goes stale
        ethUsd.set(2_500e8);
        plankUsd.set(int256(K));
        uint256 ce = psa.quote(0, 20, FirePsa.Pay.ETH);
        vm.prank(alice);
        psa.protect{value: ce}(_none(), _ids(1, 20), FirePsa.Pay.ETH, ce);
        assertEq(address(burner).balance, ce);
        vm.prank(keeper);
        burner.run();
        assertEq(address(burner).balance, ce, "no PAPER price: the fee waits");
        assertEq(burner.lpBurned(), 0);
        vm.warp(block.timestamp + 31 minutes); // and a short window again (the first run checkpointed)
        _freshFeeds();
        vm.prank(keeper);
        burner.run();
        assertEq(address(burner).balance, 0, "spent once the price is back");
        assertGt(burner.lpBurned(), 0, "and paired");
    }

    // ---------------------------------------------------------------- gas

    /// Gas for a 100-card grading, worst wear (3+ years uncased, 10 moves).
    function test_gas_finish100Worn() public {
        vm.prank(owner);
        psa.setMaxBatch(100);
        uint256[] memory ids = _first(100);
        address bob = address(0xB0B);
        for (uint256 i; i < 100; i++) {
            for (uint256 k; k < 5; k++) {
                vm.prank(alice);
                cards.transferFrom(alice, bob, i + 1);
                vm.prank(bob);
                cards.transferFrom(bob, alice, i + 1);
            }
        }
        vm.warp(block.timestamp + 3 * 365 days + 17 days);
        ethUsd.set(2_500e8);
        paperUsd.set(int256(P));
        uint256 cost = psa.quote(0, 100, FirePsa.Pay.ETH);
        vm.prank(alice);
        uint256 g0 = gasleft();
        uint256 index = psa.protect{value: cost}(_none(), ids, FirePsa.Pay.ETH, cost);
        emit log_named_uint("protect 100 (worn) gas", g0 - gasleft());
        psaRng.fulfill(psaRng.last(), 12345);
        g0 = gasleft();
        psa.finish(index, ids);
        uint256 used = g0 - gasleft();
        emit log_named_uint("finish 100 worn gas", used);
        assertLt(used, 20_000_000);
    }

    /// Gas for a 100-card grading of fresh cards.
    function test_gas_finish100Fresh() public {
        vm.prank(owner);
        psa.setMaxBatch(100);
        uint256[] memory ids = _first(100);
        uint256 cost = psa.quote(0, 100, FirePsa.Pay.ETH);
        vm.prank(alice);
        uint256 g0 = gasleft();
        uint256 index = psa.protect{value: cost}(_none(), ids, FirePsa.Pay.ETH, cost);
        emit log_named_uint("protect 100 gas", g0 - gasleft());
        psaRng.fulfill(psaRng.last(), 12345);
        g0 = gasleft();
        psa.finish(index, ids);
        uint256 used = g0 - gasleft();
        emit log_named_uint("finish 100 fresh gas", used);
        assertLt(used, 10_000_000);
    }

    receive() external payable {}
}
