// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FireSale} from "../../src/cards/FireSale.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {ConfigureSeries} from "../../script/ConfigureSeries.s.sol";
import {SeriesHelper} from "./SeriesHelper.sol";
import {MockERC20, MockUSDG, MockMill, MockFeed, MockRandomness, MockPlankTwap, MockPair, MockBurner} from "../Mocks.sol";

/// @dev A Uniswap V2 router stand-in with a fixed PLANK price (it holds PLANK and pays it out). It can be told to fail,
///      and it enforces amountOutMin like the real one.
contract MockV2Router {
    MockERC20 public plank;
    uint256 public plankPerEthWei; // PLANK wei out per ETH wei in
    uint256 public plankPerUsdgUnit; // PLANK wei out per USDG unit in
    bool public fail;

    constructor(MockERC20 p, uint256 perEth, uint256 perUsdg) { plank = p; plankPerEthWei = perEth; plankPerUsdgUnit = perUsdg; }
    function setFail(bool f) external { fail = f; }
    function setRates(uint256 perEth, uint256 perUsdg) external { plankPerEthWei = perEth; plankPerUsdgUnit = perUsdg; }

    function swapExactETHForTokens(uint256 minOut, address[] calldata, address to, uint256) external payable returns (uint256[] memory a) {
        require(!fail, "router down");
        uint256 out = msg.value * plankPerEthWei;
        require(out >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
        plank.mint(to, out);
        a = new uint256[](2);
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 minOut, address[] calldata path, address to, uint256)
        external
        returns (uint256[] memory a)
    {
        require(!fail, "router down");
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        uint256 out = amountIn * plankPerUsdgUnit;
        require(out >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
        plank.mint(to, out);
        a = new uint256[](3);
    }
}

contract SaleTest is SeriesHelper {
    function _na() internal pure returns (FireSale.Access memory a) {
        a.proof = new bytes32[](0);
    }


    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11CE0);
    address revenue = address(0xBEEF);
    address burnW = address(0xB0B);
    address alice = address(0xA1);
    address bob = address(0xB2);

    MockERC20 paper;
    MockERC20 plank;
    MockUSDG usdg;
    MockMill press;
    MockFeed ethFeed;
    MockFeed plankFeed;
    MockV2Router router;
    MockRandomness rng;
    FirePacks packs;
    FireCards cards;
    RecipeDealer dealer;
    FireSale sale;

    // ETH $3,333; PLANK $1e-9 (18-decimal feed: 1e9); the router trades at the same prices.
    int256 constant ETH_USD = 3_333e8;
    int256 constant PLANK_USD = 1e9;
    uint256 constant PER_ETH = 3_333e9; // PLANK wei per ETH wei
    uint256 constant PER_USDG = 1e21; // PLANK wei per USDG unit ($1e-6 / 1e-9 PLANK = 1e3 PLANK = 1e21 wei)
    uint128 constant PRICE = 250_000_000; // $2.50
    uint64 start;

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new MockERC20("PAPER", "PAPER");
        plank = new MockERC20("PLANK", "PLANK");
        usdg = new MockUSDG();
        press = new MockMill(address(plank), 0);
        ethFeed = new MockFeed(ETH_USD);
        plankFeed = new MockFeed(PLANK_USD);
        router = new MockV2Router(plank, PER_ETH, PER_USDG);
        rng = new MockRandomness();
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        rng.setFire(address(cards));
        sale = new FireSale(FireSale.Config({
            owner: owner, paper: address(paper), plank: address(plank), usdg: address(usdg), weth: address(0xE7),
            press: address(press), packs: address(packs), cards: address(cards), ethUsd: address(ethFeed),
            plankUsd: address(plankFeed), paperUsd: address(0), router: address(router), revenueWallet: revenue, burnWallet: burnW,
            paperPerSuggestion: 1e18
        }));
        vm.startPrank(owner, owner);
        packs.setSeller(address(sale));
        packs.setCards(address(cards));
        cards.setSeller(address(sale));
        cards.setRandomness(address(rng));
        vm.stopPrank();
        _configureCards(1);
        _configureCards(2);
        start = uint64(block.timestamp + 1 hours);
        _drop(1, start, 10, 3, 4, 5);

        for (uint256 i; i < 2; i++) {
            address u = i == 0 ? alice : bob;
            paper.mint(u, 1_000e18);
            plank.mint(u, 1e33);
            usdg.mint(u, 1_000e6);
            vm.deal(u, 10 ether);
            vm.startPrank(u, u);
            paper.approve(address(sale), type(uint256).max);
            plank.approve(address(sale), type(uint256).max);
            usdg.approve(address(sale), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ---------------------------------------------------------------- helpers

    function _configureCards(uint256 fire) internal {
        _standard(cards, dealer, owner, fire, 3, 1);
    }

    function _cfg(uint64 s, uint32 n, uint32 starters, uint32 plankOnly, uint32 limit) internal pure returns (FireSale.DropConfig memory) {
        return FireSale.DropConfig({start: s, packs: n, starters: starters, plankOnly: plankOnly, walletLimit: limit,
            starterWindow: 24 hours, liftAfter: 48 hours, plankBurnBps: 3_000, priceUsd: PRICE, paperPerPack: 1e18, holderWindow: 0, holderRoot: bytes32(0), maxPerTx: 0, plankOnlyFor: 48 hours, regularWalletsFor: 48 hours, starterPerPress: 1, starterWalletLimit: 1, starterPriceUsd: 0, starterPaper: 1e18, creditsPerPick: 1, creditPacksMax: 0, creditPacksPerWallet: 0});
    }

    function _drop(uint256 fire, uint64 s, uint32 n, uint32 starters, uint32 plankOnly, uint32 limit) internal {
        vm.prank(owner, owner);
        sale.configureDrop(fire, _cfg(s, n, starters, plankOnly, limit));
    }

    /// Move time and keep the price feeds fresh (they'd go stale over a 48h warp).
    function _warp(uint256 t) internal {
        vm.warp(t);
        ethFeed.set(ETH_USD);
        plankFeed.set(PLANK_USD);
    }

    function _open() internal { _warp(start); }

    function _plankOnlyDone(address who) internal {
        vm.prank(who, who);
        sale.buyWithPlank(1, 4, type(uint256).max, type(uint256).max, _na());
    }

    function _assertHoldsNothing() internal view {
        assertEq(address(sale).balance, 0, "eth");
        assertEq(usdg.balanceOf(address(sale)), 0, "usdg");
        assertEq(plank.balanceOf(address(sale)), 0, "plank");
        assertEq(paper.balanceOf(address(sale)), 0, "paper");
        assertEq(usdg.allowance(address(sale), address(router)), 0, "allowance");
    }

    // ---------------------------------------------------------------- setup and locking

    function test_notLiveBeforeStart() public {
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.NotLive.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
    }

    function test_configLocksWhenTheDropOpens() public {
        _drop(1, start, 20, 3, 4, 5); // changing before it opens is fine
        assertEq(sale.dropOf(1).packs, 20);
        _open();
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropStarted.selector);
        sale.configureDrop(1, _cfg(uint64(block.timestamp + 1), 99, 0, 0, 5));
    }

    function test_onlyOwnerConfigures() public {
        vm.prank(alice, alice);
        vm.expectRevert();
        sale.configureDrop(3, _cfg(start, 10, 0, 0, 5));
    }

    function test_badConfigRejected() public {
        vm.startPrank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, _cfg(uint64(block.timestamp), 10, 0, 0, 5)); // start in the past
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, _cfg(start, 10, 0, 11, 5)); // more PLANK-only packs than packs
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(3, _cfg(start, 10, 0, 0, 5)); // Fire 3's characters aren't set in the card contract
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- PLANK lights the forge

    function test_firstPacksArePlankOnly() public {
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PlankOnly.selector);
        sale.buyWithEth{value: 1 ether}(1, 1, type(uint256).max, _na());
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PlankOnly.selector);
        sale.buyWithUsdg(1, 1, type(uint256).max, type(uint256).max, _na());
        _plankOnlyDone(alice);
        vm.prank(bob, bob);
        sale.buyWithEth{value: 1 ether}(1, 1, type(uint256).max, _na()); // open to ETH now
        assertEq(packs.balanceOf(bob, 1), 1);
    }

    function test_plankBuy_splitsAndBurns() public {
        _open();
        uint256 cost = sale.quotePlank(1, 2);
        assertEq(cost, 5e27, "2 packs = $5 = 5e9 PLANK");
        uint256 before = plank.balanceOf(alice);
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 2, cost, type(uint256).max, _na());
        assertEq(before - plank.balanceOf(alice), cost);
        assertEq(plank.balanceOf(DEAD), cost * 3_000 / 10_000, "30% burned");
        assertEq(plank.balanceOf(revenue), cost - cost * 3_000 / 10_000, "70% revenue");
        assertEq(paper.balanceOf(DEAD), 2e18, "1 PAPER per pack burned");
        assertEq(packs.balanceOf(alice, 1), 2);
        _assertHoldsNothing();
    }

    function test_plankPriceMoved() public {
        _open();
        uint256 cost = sale.quotePlank(1, 1);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.buyWithPlank(1, 1, cost - 1, type(uint256).max, _na());
    }

    function test_paperIsRequired() public {
        _open();
        vm.prank(alice, alice);
        paper.approve(address(sale), 0);
        vm.prank(alice, alice);
        vm.expectRevert();
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
    }

    // ---------------------------------------------------------------- ETH and USDG

    function test_ethBuy_burnsPlankAndRefunds() public {
        _open();
        _plankOnlyDone(bob);
        uint256 cost = sale.quoteEth(1, 2);
        assertEq(cost, (500_000_000 * uint256(1e18) + uint256(ETH_USD) - 1) / uint256(ETH_USD));
        uint256 burnShare = cost * 3_000 / 10_000;
        uint256 deadBefore = plank.balanceOf(DEAD);
        uint256 balBefore = alice.balance;
        vm.prank(alice, alice);
        sale.buyWithEth{value: cost + 0.01 ether}(1, 2, type(uint256).max, _na());
        assertEq(balBefore - alice.balance, cost, "excess refunded");
        assertEq(revenue.balance, cost - burnShare, "70% revenue");
        assertEq(plank.balanceOf(DEAD) - deadBefore, burnShare * PER_ETH, "30% bought PLANK, burned");
        assertEq(burnW.balance, 0);
        _assertHoldsNothing();
    }

    function test_ethSwapFails_burnShareToBurnWallet() public {
        _open();
        _plankOnlyDone(bob);
        router.setFail(true);
        uint256 cost = sale.quoteEth(1, 1);
        vm.prank(alice, alice);
        sale.buyWithEth{value: cost}(1, 1, type(uint256).max, _na());
        assertEq(burnW.balance, cost * 3_000 / 10_000, "burn wallet");
        assertEq(revenue.balance, cost - cost * 3_000 / 10_000);
        assertEq(packs.balanceOf(alice, 1), 1, "the purchase still went through");
        _assertHoldsNothing();
    }

    function test_pumpedPool_skipsSwap() public {
        _open();
        _plankOnlyDone(bob);
        router.setRates(PER_ETH * 85 / 100, PER_USDG * 85 / 100); // pool 15% worse than the 30-minute average
        uint256 cost = sale.quoteEth(1, 1);
        vm.prank(alice, alice);
        sale.buyWithEth{value: cost}(1, 1, type(uint256).max, _na());
        assertEq(burnW.balance, cost * 3_000 / 10_000, "falls back instead of overpaying");
        _assertHoldsNothing();
    }

    function test_usdgBuy() public {
        _open();
        _plankOnlyDone(bob);
        uint256 cost = sale.quoteUsdg(1, 2);
        assertEq(cost, 5e6, "$5.00");
        uint256 deadBefore = plank.balanceOf(DEAD);
        vm.prank(alice, alice);
        sale.buyWithUsdg(1, 2, cost, type(uint256).max, _na());
        assertEq(usdg.balanceOf(revenue), 3_500_000, "70%");
        assertEq(usdg.balanceOf(address(router)), 1_500_000, "30% swapped");
        assertEq(plank.balanceOf(DEAD) - deadBefore, 1_500_000 * PER_USDG);
        _assertHoldsNothing();
    }

    function test_usdgSwapFails_burnShareToBurnWallet() public {
        _open();
        _plankOnlyDone(bob);
        router.setFail(true);
        vm.prank(alice, alice);
        sale.buyWithUsdg(1, 1, type(uint256).max, type(uint256).max, _na());
        assertEq(usdg.balanceOf(burnW), 750_000);
        assertEq(usdg.balanceOf(revenue), 1_750_000);
        _assertHoldsNothing();
    }

    function test_ethFeedStale_reverts() public {
        _open();
        _plankOnlyDone(bob);
        vm.warp(block.timestamp + 26 hours);
        plankFeed.set(PLANK_USD);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.FeedUnavailable.selector);
        sale.buyWithEth{value: 1 ether}(1, 1, type(uint256).max, _na());
    }

    function test_plankFeedDown_drop_doesNotGetStuck() public {
        _open();
        plankFeed.setBroken(true);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.FeedUnavailable.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PlankOnly.selector);
        sale.buyWithEth{value: 1 ether}(1, 1, type(uint256).max, _na());
        vm.warp(start + 48 hours);
        ethFeed.set(ETH_USD);
        uint256 cost = sale.quoteEth(1, 1);
        vm.prank(alice, alice);
        sale.buyWithEth{value: cost}(1, 1, type(uint256).max, _na()); // ETH opens when the limit lifts; no price → burn share to burn wallet
        assertEq(burnW.balance, cost * 3_000 / 10_000);
    }

    // ---------------------------------------------------------------- limits

    function test_walletLimit_thenLifts() public {
        _drop(1, start, 20, 0, 0, 5);
        _open();
        vm.startPrank(alice, alice);
        sale.buyWithPlank(1, 5, type(uint256).max, type(uint256).max, _na());
        vm.expectRevert(FireSale.WalletLimit.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        vm.stopPrank();
        _warp(start + 48 hours);
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 6, type(uint256).max, type(uint256).max, _na());
        assertEq(packs.balanceOf(alice, 1), 11);
    }

    // ---------------------------------------------------------------- starters

    function test_starters() public {
        uint256 p1 = press.mint(alice);
        uint256 p2 = press.mint(alice);
        uint256 p3 = press.mint(bob);
        _open();
        uint256 deadPaper = paper.balanceOf(DEAD);
        vm.prank(alice, alice);
        sale.claimStarter(1, p1, 1, FireSale.Pay.PLANK, 0, type(uint256).max);
        assertEq(packs.balanceOf(alice, 1), 1);
        assertEq(paper.balanceOf(DEAD) - deadPaper, 1e18, "only the PAPER");
        assertEq(plank.balanceOf(revenue), 0);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.AlreadyClaimed.selector);
        sale.claimStarter(1, p2, 1, FireSale.Pay.PLANK, 0, type(uint256).max); // 1 per wallet
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.NotPressOwner.selector);
        sale.claimStarter(1, p1, 1, FireSale.Pay.PLANK, 0, type(uint256).max); // not bob's press
        vm.prank(alice, alice);
        press.transferFrom(alice, bob, p1);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.PressUsed.selector);
        sale.claimStarter(1, p1, 1, FireSale.Pay.PLANK, 0, type(uint256).max); // each press once per drop
        vm.prank(bob, bob);
        sale.claimStarter(1, p3, 1, FireSale.Pay.PLANK, 0, type(uint256).max);
        _warp(start + 24 hours);
        address carol = address(0xC3);
        uint256 p4 = press.mint(carol);
        vm.prank(carol, carol);
        vm.expectRevert(FireSale.StarterWindowClosed.selector);
        sale.claimStarter(1, p4, 1, FireSale.Pay.PLANK, 0, type(uint256).max);
    }

    function test_leftoverStartersJoinPaidSupply() public {
        _open();
        uint256 paidLeft = sale.phase(1).paidLeft;
        uint256 startersLeft = sale.phase(1).startersLeft;
        assertEq(paidLeft, 10);
        assertEq(startersLeft, 3);
        _warp(start + 24 hours);
        paidLeft = sale.phase(1).paidLeft;
        startersLeft = sale.phase(1).startersLeft;
        assertEq(paidLeft, 13, "3 unclaimed starters added");
        assertEq(startersLeft, 0);
    }

    function test_startersAreTradeable() public {
        uint256 p1 = press.mint(alice);
        _open();
        vm.prank(alice, alice);
        sale.claimStarter(1, p1, 1, FireSale.Pay.PLANK, 0, type(uint256).max);
        vm.prank(alice, alice);
        packs.safeTransferFrom(alice, bob, 1, 1, "");
        assertEq(packs.balanceOf(bob, 1), 1);
    }

    // ---------------------------------------------------------------- selling out

    function test_soldOut_closesTheFire() public {
        _drop(1, start, 10, 0, 0, 10);
        _open();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 10, type(uint256).max, type(uint256).max, _na());
        (, bool closed,,,,) = cards.fires(1);
        assertTrue(closed, "the last purchase closed the Fire");
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.NotLive.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
    }

    function test_cantOversell() public {
        _drop(1, start, 3, 0, 0, 10);
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.SoldOut.selector);
        sale.buyWithPlank(1, 4, type(uint256).max, type(uint256).max, _na());
    }

    function test_close_needsSoldOutAndAConfiguredDrop() public {
        vm.expectRevert(FireSale.NotSoldOut.selector);
        sale.close(7); // never configured
        _open();
        vm.expectRevert(FireSale.NotSoldOut.selector);
        sale.close(1);
    }

    function test_ownerCanEndADrop_onlyAfterTheLimitLifts() public {
        _open();
        _plankOnlyDone(alice);
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.TooEarly.selector);
        sale.endDrop(1); // the starter window and the limited phase always run in full
        _warp(start + 48 hours);
        vm.prank(owner, owner);
        sale.endDrop(1);
        (, bool closed,,, uint64 packCount,) = cards.fires(1);
        assertTrue(closed);
        assertEq(packCount, 4);
    }

    // ---------------------------------------------------------------- burning cards and credits

    /// Alice ends up with `n` packs' worth of cards (6 each) from fire 1.
    function _aliceGetsCards(uint256 nPacks) internal {
        _drop(1, start, uint32(nPacks), 0, 0, uint32(nPacks));
        _open();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, nPacks, type(uint256).max, type(uint256).max, _na()); // sells out, closes the Fire
        uint256 opened;
        while (opened < nPacks) {
            uint256 c = nPacks - opened > 10 ? 10 : nPacks - opened;
            vm.prank(alice, alice);
            cards.open(1, c);
            rng.fulfill(rng.last(), uint256(keccak256(abi.encode(opened))));
            opened += c;
        }
        cards.process(1, type(uint256).max);
        assertEq(cards.balanceOf(alice), nPacks * 6);
    }

    function test_burn42_earnsACredit_runningCount() public {
        _aliceGetsCards(9); // 54 cards, serials 1..54
        vm.startPrank(alice, alice);
        sale.burnCards(_ids(1, 3));
        sale.burnCards(_ids(4, 2));
        assertEq(sale.burnCount(alice), 5, "3 one day + 2 the next");
        assertEq(sale.credits(alice), 0);
        sale.burnCards(_ids(6, 45)); // 50 total
        vm.stopPrank();
        assertEq(sale.credits(alice), 1);
        assertEq(sale.burnCount(alice), 8, "extras carry over");
        assertEq(cards.balanceOf(alice), 4);
    }

    function test_cantBurnSomeoneElsesCards() public {
        _aliceGetsCards(1);
        vm.prank(bob, bob);
        vm.expectRevert(FireCards.NotHolder.selector);
        sale.burnCards(_ids(1, 1));
        vm.prank(bob, bob);
        vm.expectRevert(FireCards.NotSeller.selector);
        cards.burnFor(alice, _ids(1, 1));
    }

    function test_creditsStackAndMintForPaperOnly() public {
        _aliceGetsCards(14); // 84 cards
        vm.prank(alice, alice);
        sale.burnCards(_ids(1, 84));
        assertEq(sale.credits(alice), 2);
        // her suggestion gets picked for the next drop: a third credit
        vm.prank(alice, alice);
        uint256 id = sale.suggest("A fox made of embers", type(uint256).max);
        uint64 s2 = uint64(block.timestamp + 1 hours);
        _drop(2, s2, 10, 0, 0, 5);
        uint256[] memory picked = new uint256[](1);
        picked[0] = id;
        vm.prank(owner, owner);
        sale.pickSuggestions(2, picked);
        assertEq(sale.credits(alice), 3, "2 from burning + 1 picked: one pool, any drop");

        vm.prank(alice, alice);
        vm.expectRevert(FireSale.NotLive.selector);
        sale.useCredits(2, 1, type(uint256).max); // no drop live: credits wait

        _warp(s2);
        uint256 deadPaper = paper.balanceOf(DEAD);
        uint256 revBefore = plank.balanceOf(revenue);
        vm.prank(alice, alice);
        sale.useCredits(2, 3, type(uint256).max);
        assertEq(packs.balanceOf(alice, 2), 3);
        assertEq(sale.credits(alice), 0);
        assertEq(paper.balanceOf(DEAD) - deadPaper, 3e18, "1 PAPER each");
        assertEq(plank.balanceOf(revenue), revBefore, "nothing else paid");
        uint256 paidLeft = sale.phase(2).paidLeft;
        assertEq(paidLeft, 7, "out of the drop's supply");
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.NoCredits.selector);
        sale.useCredits(2, 1, type(uint256).max);
    }

    // ---------------------------------------------------------------- suggestions

    /// Most packs per purchase is a per-drop setting (default 50).
    function test_maxPerTxIsPerDrop() public {
        _drop(1, start, 300, 0, 0, 300);
        assertEq(sale.dropOf(1).maxPerTx, 50, "default");
        FireSale.DropConfig memory c = _cfg(start, 300, 0, 0, 300);
        c.maxPerTx = 120;
        vm.prank(owner, owner);
        sale.configureDrop(1, c);
        assertEq(sale.dropOf(1).maxPerTx, 120);
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.BadAmount.selector);
        sale.buyWithPlank(1, 121, type(uint256).max, type(uint256).max, _na());
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 120, type(uint256).max, type(uint256).max, _na());
        assertEq(packs.balanceOf(alice, 1), 120);
    }

    /// Cards per free pack credit is fixed forever at 42 (burn progress carries over between Series): no setter.
    function test_cardsPerCreditIsFixedAt42() public {
        assertEq(sale.CARDS_PER_CREDIT(), 42);
        (bool ok,) = address(sale).call(abi.encodeWithSignature("setCardsPerCredit(uint256)", uint256(10)));
        assertFalse(ok, "no setter");
        _aliceGetsCards(7); // 42 cards; fire 1 closes
        vm.prank(alice, alice);
        sale.burnCards(_ids(1, 41));
        assertEq(sale.credits(alice), 0);
        // a new drop doesn't change the rate: progress carries over and the 42nd card earns the credit
        _drop(2, uint64(block.timestamp + 1 hours), 10, 0, 0, 5);
        vm.prank(alice, alice);
        sale.burnCards(_ids(42, 1));
        assertEq(sale.credits(alice), 1);
        assertEq(sale.burnCount(alice), 0);
    }

    function test_suggestions() public {
        uint256 before = paper.balanceOf(DEAD);
        vm.prank(bob, bob);
        uint256 id = sale.suggest("Captain Kindling", type(uint256).max);
        assertEq(paper.balanceOf(DEAD) - before, 1e18);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(owner, owner);
        sale.pickSuggestions(1, ids);
        assertEq(sale.credits(bob), 1);
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.AlreadyClaimed.selector);
        sale.pickSuggestions(1, ids); // once each
        vm.prank(bob, bob);
        uint256 id2 = sale.suggest("Ash Wolf", type(uint256).max);
        ids[0] = id2;
        _open();
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropStarted.selector);
        sale.pickSuggestions(1, ids); // only while setting up a drop
        vm.prank(alice, alice);
        vm.expectRevert();
        sale.pickSuggestions(1, ids); // only the owner
    }

    // ---------------------------------------------------------------- gas

    function test_gas() public {
        _drop(1, start, 100, 0, 0, 50);
        _open();
        vm.prank(bob, bob);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na()); // warm the counters
        uint256 g = gasleft();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        emit log_named_uint("PLANK, 1 pack", g - gasleft());
        g = gasleft();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 5, type(uint256).max, type(uint256).max, _na());
        emit log_named_uint("PLANK, 5 packs", g - gasleft());
        uint256 cost = sale.quoteEth(1, 1);
        g = gasleft();
        vm.prank(bob, bob);
        sale.buyWithEth{value: cost}(1, 1, type(uint256).max, _na());
        emit log_named_uint("ETH, 1 pack (with PLANK swap)", g - gasleft());
        cost = sale.quoteEth(1, 5);
        g = gasleft();
        vm.prank(bob, bob);
        sale.buyWithEth{value: cost}(1, 5, type(uint256).max, _na());
        emit log_named_uint("ETH, 5 packs (with PLANK swap)", g - gasleft());
    }


    /// The suggestion list clears after every picking session: unpicked suggestions don't carry over.
    function test_suggestionListClearsAfterEachPickingSession() public {
        _drop(1, start, 4, 0, 0, 5);
        vm.startPrank(bob, bob);
        uint256 a = sale.suggest("Ember Fox", type(uint256).max);
        uint256 b = sale.suggest("Ash Wolf", type(uint256).max);
        vm.stopPrank();
        uint256[] memory one = new uint256[](1);
        one[0] = a;
        vm.prank(owner, owner);
        sale.pickSuggestions(1, one); // session for Fire 1: picks from the list a and b are in
        assertEq(sale.currentRound(), 1, "new suggestions now go into a fresh list");
        vm.prank(alice, alice);
        uint256 c = sale.suggest("Cinder Owl", type(uint256).max); // made after the session started: next list

        _open();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 4, type(uint256).max, type(uint256).max, _na()); // drop 1 sells out
        // next session, for Fire 2
        vm.prank(owner, owner);
        sale.configureDrop(2, _cfg(uint64(block.timestamp + 2 hours), 10, 0, 0, 5));
        one[0] = b;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.NotThisRound.selector);
        sale.pickSuggestions(2, one); // b wasn't picked last time: it's gone
        one[0] = c;
        vm.prank(owner, owner);
        sale.pickSuggestions(2, one);
        assertEq(sale.credits(alice), 1);
        assertEq(sale.currentRound(), 2);
    }



    // ---------------------------------------------------------------- holder window + regular wallets

    function _leaf(address a) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a))));
    }

    function _pair(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return x < y ? keccak256(abi.encode(x, y)) : keccak256(abi.encode(y, x));
    }

    /// A drop whose first 24h is for press holders and the PLANK snapshot (alice and carol are in it).
    function _holderDrop() internal returns (address carol) {
        carol = address(0xC3);
        FireSale.DropConfig memory c = _cfg(start, 20, 0, 0, 5);
        c.holderWindow = 24 hours;
        c.holderRoot = _pair(_leaf(alice), _leaf(carol));
        vm.prank(owner);
        sale.configureDrop(1, c);
    }

    function _proof(address other) internal pure returns (FireSale.Access memory a) {
        a.proof = new bytes32[](1);
        a.proof[0] = _leaf(other);
    }

    function _press(uint256 id) internal pure returns (FireSale.Access memory a) {
        a.pressId = id;
        a.proof = new bytes32[](0);
    }

    function test_holderWindow_snapshotAndPressHoldersOnly() public {
        address carol = _holderDrop();
        uint256 bobPress = press.mint(bob);
        _open();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 2, type(uint256).max, type(uint256).max, _proof(carol)); // in the PLANK snapshot
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.HoldersOnly.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na()); // neither
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.HoldersOnly.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _proof(carol)); // someone else's proof
        vm.prank(bob, bob);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _press(bobPress)); // a press holder
        assertTrue(sale.phase(1).holdersOnly);
    }

    function test_holderWindow_onePressLetsInOneWallet() public {
        _holderDrop();
        uint256 p1 = press.mint(bob);
        _open();
        vm.prank(bob, bob);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _press(p1));
        vm.prank(bob, bob);
        press.transferFrom(bob, address(0xD4), p1);
        vm.prank(address(0xD4), address(0xD4));
        vm.expectRevert(FireSale.PressUsed.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _press(p1)); // passing the press around
    }

    function test_holderWindow_opensToEveryoneAfter24h() public {
        _holderDrop();
        _open();
        _warp(start + 24 hours);
        assertFalse(sale.phase(1).holdersOnly);
        vm.prank(bob, bob);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        assertEq(packs.balanceOf(bob, 1), 1);
    }

    function test_noBotContractsWhileTheLimitIsOn() public {
        _drop(1, start, 20, 0, 0, 5);
        _open();
        vm.prank(alice); // called from a contract: msg.sender isn't the wallet that signed
        vm.expectRevert(FireSale.NoContracts.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        vm.prank(alice, alice); // a regular wallet
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        _warp(start + 48 hours);
        vm.prank(alice); // after the limit lifts, anyone
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
    }


    /// The snapshot script's tree (ops/snapshot, `node snapshot.mjs --selftest`) is the one FireSale accepts.
    function test_snapshotScriptRootMatches() public {
        FireSale.DropConfig memory c = _cfg(start, 20, 0, 0, 5);
        c.holderWindow = 24 hours;
        c.holderRoot = 0xe2b6b2b847fb36972d28459f0c10cab62aad455b685174c663177bfd1d64d5b4;
        vm.prank(owner);
        sale.configureDrop(1, c);
        _open();
        address w = address(0xA1); // alice
        FireSale.Access memory a;
        a.proof = new bytes32[](2);
        a.proof[0] = 0xbea9d456be3e983fd032b953e38319dfe71bae5aa4d1bbd9a4400bf1a6fe6519;
        a.proof[1] = 0xe88e4e6f8c904d033c47645fa7a3297960e6a90e65d21020310421bbcee804d8;
        vm.prank(w, w);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, a);
        address d4 = address(0xD4);
        plank.mint(d4, 1e33); paper.mint(d4, 10e18);
        vm.startPrank(d4, d4);
        plank.approve(address(sale), type(uint256).max); paper.approve(address(sale), type(uint256).max);
        FireSale.Access memory b;
        b.proof = new bytes32[](1);
        b.proof[0] = 0x6b26bb8031a3037f2f1f3f6b7494dc83cda7c11f95b041e391b45c1db0d893d2;
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, b);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- audit round 2

    function test_audit2_anyoneCanEndAStalledDropAfterAGracePeriod() public {
        _open();
        _plankOnlyDone(alice);
        _warp(start + 48 hours);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.TooEarly.selector);
        sale.endDrop(1); // the owner's turn first
        _warp(start + 48 hours + 7 days);
        vm.prank(bob, bob);
        sale.endDrop(1); // the owner never acted: anyone can, so the packs can be opened
        assertTrue(sale.phase(1).closed);
    }

    function test_audit2_buyerNamesTheMostPaper() public {
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.buyWithPlank(1, 2, type(uint256).max, 1e18, _na()); // 2 packs need 2 PAPER
    }

    function test_audit2_feedsReplaceableOnlyBetweenDrops() public {
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropsActive.selector);
        sale.setFeeds(address(ethFeed), address(plankFeed), address(0), address(router));
        _drop(1, start, 4, 0, 0, 5);
        _open();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 4, type(uint256).max, type(uint256).max, _na());
        MockFeed newEth = new MockFeed(ETH_USD);
        vm.prank(owner, owner);
        sale.setFeeds(address(newEth), address(plankFeed), address(0), address(router));
        assertEq(address(sale.ETH_USD()), address(newEth));
    }

    /// Credits work at any time in any live drop: holder window, PLANK-only phase and wallet limit don't apply.
    function test_creditsWorkAnyTimeInAnyDrop() public {
        _aliceGetsCards(14); // closes Fire 1
        vm.prank(alice, alice);
        sale.burnCards(_ids(1, 84)); // 2 credits
        uint64 s2 = uint64(block.timestamp + 1 hours);
        FireSale.DropConfig memory c = _cfg(s2, 20, 0, 4, 1);
        c.holderWindow = 24 hours;
        vm.prank(owner);
        sale.configureDrop(2, c);
        _warp(s2);
        vm.prank(alice, alice);
        sale.useCredits(2, 2, type(uint256).max); // right at the start, during the holder window, past a limit of 1
        assertEq(packs.balanceOf(alice, 2), 2);
        assertEq(sale.credits(alice), 0);
    }

    function test_audit2_phaseShowsTheValveAndState() public {
        assertTrue(sale.phase(1).configured);
        assertFalse(sale.phase(7).configured);
        assertFalse(sale.phase(7).limitLifted);
        _open();
        assertTrue(sale.phase(1).plankOnly);
        assertTrue(sale.phase(1).plankPriceOk);
        _warp(start + 48 hours);
        assertFalse(sale.phase(1).plankOnly, "ETH and USDG are open after the valve");
    }

    // ---------------------------------------------------------------- audit fixes

    /// Only one drop at a time: picks only happen while no drop is running.
    function test_audit_oneDropAtATime() public {
        vm.prank(owner);
        vm.expectRevert(FireSale.AnotherDropActive.selector);
        sale.configureDrop(2, _cfg(uint64(block.timestamp + 365 days), 10, 0, 0, 5));
    }

    function test_audit_picksCappedByCharacters() public {
        uint256[] memory ids = new uint256[](4);
        for (uint256 i; i < 4; i++) { vm.prank(bob, bob); ids[i] = sale.suggest("x", type(uint256).max); }
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadAmount.selector);
        sale.pickSuggestions(1, ids); // Fire 1 has 3 characters
    }

    function test_audit_fireNumberFitsIn64Bits() public {
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(uint256(type(uint64).max) + 8, _cfg(start, 10, 0, 0, 5));
        vm.prank(owner, owner);
        vm.expectRevert(FireCards.BadLength.selector);
        cards.setDealer(uint256(type(uint64).max) + 8, address(dealer));
    }

    function test_audit_timingsChecked() public {
        FireSale.DropConfig memory c = _cfg(start, 10, 3, 0, 5);
        c.liftAfter = 0;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, c); // a wallet limit with no lift time
        c = _cfg(start, 10, 3, 0, 5);
        c.starterWindow = 30 days + 1; // longer than any phase may be
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, c);
        c = _cfg(start, 10, 3, 0, 5);
        c.starterWindow = 0; // press packs with no window
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, c);
        c = _cfg(start, 10, 3, 0, 5);
        c.starterWindow = 72 hours; // longer than the wallet limit: fine now, phases are independent
        vm.prank(owner, owner);
        sale.configureDrop(1, c);
    }

    function test_audit_walletsLockedWhileADropIsSetUp() public {
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropsActive.selector);
        sale.setWallets(address(0x1111), address(0x2222));
        _drop(1, start, 4, 0, 0, 5);
        _open();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 4, type(uint256).max, type(uint256).max, _na()); // sells out, closes
        assertEq(sale.activeDrops(), 0);
        vm.prank(owner, owner);
        sale.setWallets(address(0x1111), address(0x2222));
        assertEq(sale.revenueWallet(), address(0x1111));
    }

    function test_audit_stalePlankPricePausesPlankAndSkipsTheSwap() public {
        _open();
        _plankOnlyDone(bob);
        vm.warp(block.timestamp + 3 hours); // keeper down: the average is 3 hours old
        ethFeed.set(ETH_USD);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.FeedUnavailable.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        uint256 cost = sale.quoteEth(1, 1);
        vm.prank(alice, alice);
        sale.buyWithEth{value: cost}(1, 1, type(uint256).max, _na());
        assertEq(burnW.balance, cost * 3_000 / 10_000, "no swap on an old price");
    }

    function test_audit_longWindowAfterAKeeperGapRejected() public {
        MockPlankTwap twap = new MockPlankTwap(PLANK_USD, address(new MockPair(address(0xE7), address(plank))));
        FireSale s2 = new FireSale(FireSale.Config({
            owner: owner, paper: address(paper), plank: address(plank), usdg: address(usdg), weth: address(0xE7),
            press: address(press), packs: address(packs), cards: address(cards), ethUsd: address(ethFeed),
            plankUsd: address(twap), paperUsd: address(0), router: address(router), revenueWallet: revenue, burnWallet: burnW,
            paperPerSuggestion: 1e18
        }));
        s2.quotePlank(1, 1); // a normal 30-minute window: fine
        twap.setWindow(PLANK_USD, 6 days); // a checkpoint after a 6-day gap: fresh-looking, but a 6-day average
        vm.expectRevert(FireSale.FeedUnavailable.selector);
        s2.quotePlank(1, 1);
    }

    // ---------------------------------------------------------------- per-drop settings

    function _set(uint256 fire, FireSale.DropConfig memory c) internal {
        vm.prank(owner, owner);
        sale.configureDrop(fire, c);
    }

    function _claim(address who, uint256 pid, uint256 n) internal {
        vm.prank(who, who);
        sale.claimStarter(1, pid, n, FireSale.Pay.PLANK, 0, type(uint256).max);
    }

    /// A giant drop: 10,000 packs, 100 per wallet, 100 per purchase. One purchase of 100 costs about what 1 does.
    function test_giantDrop_buy100InOneTx() public {
        FireSale.DropConfig memory c = _cfg(start, 10_000, 0, 0, 100);
        c.maxPerTx = 100;
        _set(1, c);
        _open();
        vm.prank(bob, bob);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na()); // warm the counters
        uint256 g = gasleft();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 100, type(uint256).max, type(uint256).max, _na());
        emit log_named_uint("PLANK, 100 packs", g - gasleft());
        assertEq(packs.balanceOf(alice, 1), 100);
        assertEq(paper.balanceOf(DEAD), 101e18, "1 PAPER a pack");
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.WalletLimit.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        uint256 cost = sale.quoteEth(1, 99);
        g = gasleft();
        vm.prank(bob, bob);
        sale.buyWithEth{value: cost}(1, 99, type(uint256).max, _na());
        emit log_named_uint("ETH, 99 packs (with PLANK swap)", g - gasleft());
        assertEq(packs.balanceOf(bob, 1), 100);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.BadAmount.selector);
        sale.buyWithPlank(1, 101, type(uint256).max, type(uint256).max, _na()); // over maxPerTx
        _assertHoldsNothing();
    }

    /// A wallet limit in the thousands, matched by maxPerTx.
    function test_bigWalletLimitAndMaxPerTx() public {
        FireSale.DropConfig memory c = _cfg(start, 5_000, 0, 0, 2_500);
        c.maxPerTx = 2_500;
        _set(1, c);
        paper.mint(alice, 2_000e18);
        _open();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 2_500, type(uint256).max, type(uint256).max, _na());
        assertEq(packs.balanceOf(alice, 1), 2_500);
    }

    /// No wallet limit at all: walletLimit 0 with liftAfter 0 (one without the other is refused).
    function test_noWalletLimit() public {
        FireSale.DropConfig memory c = _cfg(start, 100, 0, 0, 0);
        c.liftAfter = 0;
        _set(1, c);
        _open();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 50, type(uint256).max, type(uint256).max, _na());
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 50, type(uint256).max, type(uint256).max, _na());
        assertTrue(sale.phase(1).closed, "sold out to one wallet");
        c = _cfg(start, 10, 0, 0, 0); // limit 0, lift 48h
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(2, c);
    }

    /// 3 press packs per press: claimed in any split, never more per press, even after passing it on.
    function test_pressPacksPerPress3() public {
        FireSale.DropConfig memory c = _cfg(start, 10, 10, 0, 5);
        c.starterPerPress = 3;
        c.starterWalletLimit = 6;
        _set(1, c);
        uint256 p1 = press.mint(alice);
        _open();
        _claim(alice, p1, 2);
        _claim(alice, p1, 1);
        assertEq(packs.balanceOf(alice, 1), 3);
        assertEq(sale.startersClaimedWith(1, p1), 3);
        assertEq(paper.balanceOf(DEAD), 3e18, "PAPER only, 1 each");
        vm.prank(alice, alice);
        press.transferFrom(alice, bob, p1);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.PressUsed.selector);
        sale.claimStarter(1, p1, 1, FireSale.Pay.PLANK, 0, type(uint256).max); // the press is used up this drop
        uint256 p2 = press.mint(bob);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.PressUsed.selector);
        sale.claimStarter(1, p2, 4, FireSale.Pay.PLANK, 0, type(uint256).max); // 4 > 3 per press
        _claim(bob, p2, 3);
        assertEq(sale.phase(1).startersLeft, 4);
    }

    /// Press packs per wallet: a wallet with many presses still gets at most the wallet limit.
    function test_pressPacksWalletLimit() public {
        FireSale.DropConfig memory c = _cfg(start, 10, 6, 0, 5);
        c.starterWalletLimit = 2;
        _set(1, c);
        uint256 p1 = press.mint(alice);
        uint256 p2 = press.mint(alice);
        uint256 p3 = press.mint(alice);
        _open();
        _claim(alice, p1, 1);
        _claim(alice, p2, 1);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.AlreadyClaimed.selector);
        sale.claimStarter(1, p3, 1, FireSale.Pay.PLANK, 0, type(uint256).max);
        assertEq(sale.startersClaimedBy(1, alice), 2);
    }

    /// Free press packs: no PAPER, no price; any ETH sent comes back.
    function test_pressPacksFree() public {
        FireSale.DropConfig memory c = _cfg(start, 10, 3, 0, 5);
        c.starterPaper = 0;
        _set(1, c);
        uint256 p1 = press.mint(alice);
        _open();
        uint256 eth = alice.balance;
        vm.prank(alice, alice);
        sale.claimStarter{value: 1 ether}(1, p1, 1, FireSale.Pay.ETH, 0, 0);
        assertEq(packs.balanceOf(alice, 1), 1);
        assertEq(paper.balanceOf(DEAD), 0, "no PAPER");
        assertEq(alice.balance, eth, "ETH back");
        _assertHoldsNothing();
    }

    /// Press packs at a set PAPER amount; the claimer names the most PAPER.
    function test_pressPacksPaperAmount() public {
        FireSale.DropConfig memory c = _cfg(start, 10, 3, 0, 5);
        c.starterPaper = 3e18;
        _set(1, c);
        uint256 p1 = press.mint(alice);
        _open();
        (uint256 cost, uint256 pp) = sale.quoteStarter(1, 1, FireSale.Pay.PLANK);
        assertEq(cost, 0);
        assertEq(pp, 3e18);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.claimStarter(1, p1, 1, FireSale.Pay.PLANK, 0, 2e18);
        _claim(alice, p1, 1);
        assertEq(paper.balanceOf(DEAD), 3e18);
    }

    /// Press packs at a dollar price, paid like a paid pack (PLANK, ETH or USDG; burn share and revenue split).
    function test_pressPacksUsdPrice() public {
        FireSale.DropConfig memory c = _cfg(start, 10, 6, 4, 5);
        c.starterPriceUsd = 100_000_000; // $1
        c.starterPaper = 0;
        c.starterWalletLimit = 3;
        c.starterPerPress = 3;
        _set(1, c);
        uint256 p1 = press.mint(alice);
        uint256 p2 = press.mint(bob);
        _open();
        // PLANK, during the PLANK-only phase (it doesn't apply to press packs)
        (uint256 cost,) = sale.quoteStarter(1, 1, FireSale.Pay.PLANK);
        assertEq(cost, 1e27);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.claimStarter(1, p1, 1, FireSale.Pay.PLANK, cost - 1, 0);
        vm.prank(alice, alice);
        sale.claimStarter(1, p1, 1, FireSale.Pay.PLANK, cost, 0);
        assertEq(plank.balanceOf(DEAD), cost * 3_000 / 10_000);
        assertEq(plank.balanceOf(revenue), cost - cost * 3_000 / 10_000);
        // ETH with change back
        (cost,) = sale.quoteStarter(1, 2, FireSale.Pay.ETH);
        uint256 eth = alice.balance;
        vm.prank(alice, alice);
        sale.claimStarter{value: cost + 1 ether}(1, p1, 2, FireSale.Pay.ETH, type(uint256).max, 0);
        assertEq(eth - alice.balance, cost);
        assertEq(revenue.balance, cost - cost * 3_000 / 10_000);
        // ETH short
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.claimStarter{value: 1}(1, p2, 1, FireSale.Pay.ETH, type(uint256).max, 0);
        // USDG
        (cost,) = sale.quoteStarter(1, 1, FireSale.Pay.USDG);
        assertEq(cost, 1e6);
        vm.prank(bob, bob);
        sale.claimStarter(1, p2, 1, FireSale.Pay.USDG, cost, 0);
        assertEq(usdg.balanceOf(revenue), 7e5);
        assertEq(packs.balanceOf(alice, 1), 3);
        assertEq(packs.balanceOf(bob, 1), 1);
        _assertHoldsNothing();
    }

    /// Press packs off (0 per press needs 0 press packs), and a press-packs-only drop (no paid packs).
    function test_pressPacksOffAndPressOnlyDrop() public {
        FireSale.DropConfig memory c = _cfg(start, 10, 3, 0, 5);
        c.starterPerPress = 0;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, c); // press packs with 0 per press
        c.starters = 0;
        _set(1, c); // press packs off
        uint256 p1 = press.mint(alice);
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.SoldOut.selector);
        sale.claimStarter(1, p1, 1, FireSale.Pay.PLANK, 0, type(uint256).max);
        // a press-only drop
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 4, type(uint256).max, type(uint256).max, _na());
        _warp(start + 48 hours);
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 6, type(uint256).max, type(uint256).max, _na()); // fire 1 sells out
        c = _cfg(uint64(block.timestamp + 1 hours), 0, 2, 0, 0);
        c.liftAfter = 0;
        c.priceUsd = 0;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(2, c); // unclaimed press packs would sell at $0
        c.priceUsd = 250_000_000;
        _set(2, c);
        _warp(block.timestamp + 1 hours);
        vm.prank(alice, alice);
        sale.claimStarter(2, p1, 1, FireSale.Pay.PLANK, 0, type(uint256).max);
        uint256 p2 = press.mint(bob);
        vm.prank(bob, bob);
        sale.claimStarter(2, p2, 1, FireSale.Pay.PLANK, 0, type(uint256).max);
        assertTrue(sale.phase(2).closed, "all press packs claimed: sold out");
        c = _cfg(uint64(block.timestamp + 1 hours), 5, 0, 0, 5);
        c.priceUsd = 0;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(3, c); // paid packs at $0 are refused
    }

    /// The regular-wallets rule has its own time (0 = off), apart from the wallet limit.
    function test_regularWalletsForIsItsOwnSetting() public {
        FireSale.DropConfig memory c = _cfg(start, 20, 0, 0, 5);
        c.regularWalletsFor = 1 hours;
        _set(1, c);
        _open();
        assertTrue(sale.phase(1).regularWalletsOnly);
        vm.prank(alice); // a contract call
        vm.expectRevert(FireSale.NoContracts.selector);
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        _warp(start + 1 hours);
        assertFalse(sale.phase(1).regularWalletsOnly);
        vm.prank(alice); // the wallet limit is still on, contracts may buy
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        c = _cfg(uint64(block.timestamp + 1 hours), 20, 0, 0, 5);
        c.regularWalletsFor = 0;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.AnotherDropActive.selector);
        sale.configureDrop(2, c);
    }

    function test_regularWalletsOff() public {
        FireSale.DropConfig memory c = _cfg(start, 20, 0, 0, 5);
        c.regularWalletsFor = 0;
        _set(1, c);
        _open();
        vm.prank(alice); // a contract call, right at the start
        sale.buyWithPlank(1, 1, type(uint256).max, type(uint256).max, _na());
        assertEq(packs.balanceOf(alice, 1), 1);
    }

    /// The PLANK-only packs open up to ETH and USDG at their own time; a PLANK-only count needs one.
    function test_plankOnlyForIsItsOwnSetting() public {
        FireSale.DropConfig memory c = _cfg(start, 20, 0, 10, 5);
        c.plankOnlyFor = 2 hours;
        _set(1, c);
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PlankOnly.selector);
        sale.buyWithUsdg(1, 1, type(uint256).max, type(uint256).max, _na());
        _warp(start + 2 hours);
        assertFalse(sale.phase(1).plankOnly);
        vm.prank(alice, alice);
        sale.buyWithUsdg(1, 1, type(uint256).max, type(uint256).max, _na());
        c.plankOnlyFor = 0;
        c.start = uint64(block.timestamp + 1 hours);
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropStarted.selector);
        sale.configureDrop(1, c);
        assertFalse(sale.phase(1).limitLifted);
    }

    function test_plankOnlyNeedsATime() public {
        FireSale.DropConfig memory c = _cfg(start, 20, 0, 10, 5);
        c.plankOnlyFor = 0;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, c);
    }

    /// The owner can end a stalled drop only once its longest phase is over.
    function test_endDropWaitsForTheLongestPhase() public {
        FireSale.DropConfig memory c = _cfg(start, 20, 0, 0, 5);
        c.holderWindow = 72 hours; // longer than the 48h wallet limit
        _set(1, c);
        assertEq(sale.phase(1).phasesOver, start + 72 hours);
        _warp(start + 48 hours);
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.TooEarly.selector);
        sale.endDrop(1);
        _warp(start + 72 hours);
        vm.prank(owner, owner);
        sale.endDrop(1);
    }

    /// PAPER per pack can be 0 (no PAPER for paid or credit packs).
    function test_paperPerPackZero() public {
        FireSale.DropConfig memory c = _cfg(start, 20, 0, 0, 5);
        c.paperPerPack = 0;
        _set(1, c);
        _open();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 2, type(uint256).max, 0, _na());
        assertEq(paper.balanceOf(DEAD), 0);
        assertEq(packs.balanceOf(alice, 1), 2);
    }

    /// Credits per picked suggestion is per drop: 3 each, or none.
    function test_creditsPerPick() public {
        FireSale.DropConfig memory c = _cfg(start, 20, 0, 0, 5);
        c.creditsPerPick = 3;
        _set(1, c);
        vm.prank(bob, bob);
        uint256 id = sale.suggest("Ember Fox", type(uint256).max);
        vm.prank(alice, alice);
        uint256 id2 = sale.suggest("Ash Wolf", type(uint256).max);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(owner, owner);
        sale.pickSuggestions(1, ids);
        assertEq(sale.credits(bob), 3);
        c.creditsPerPick = 0;
        _set(1, c);
        ids[0] = id2;
        vm.prank(owner, owner);
        sale.pickSuggestions(1, ids);
        assertEq(sale.credits(alice), 0, "picked, no credit");
    }

    /// The suggestion cost and length are owner settings (any cost, 0 included); suggesters name their most PAPER.
    function test_suggestionRules() public {
        assertEq(sale.suggestionPaper(), 1e18);
        vm.prank(alice, alice);
        vm.expectRevert();
        sale.setSuggestionRules(0, 280);
        vm.prank(owner, owner);
        sale.setSuggestionRules(0, 10);
        vm.prank(bob, bob);
        sale.suggest("Ember Fox", 0); // free
        assertEq(paper.balanceOf(DEAD), 0);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.BadAmount.selector);
        sale.suggest("Captain Kindling", 0); // 16 bytes > 10
        vm.prank(owner, owner);
        sale.setSuggestionRules(5e18, 280);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.suggest("Ash Wolf", 1e18); // the cost went up past the suggester's most
        vm.prank(bob, bob);
        sale.suggest("Ash Wolf", 5e18);
        assertEq(paper.balanceOf(DEAD), 5e18);
        vm.startPrank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.setSuggestionRules(0, 0);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.setSuggestionRules(0, 1_025);
        vm.stopPrank();
    }

    /// Every new setting locks at the drop's start like the rest.
    function test_newSettingsLockAtStart() public {
        _open();
        FireSale.DropConfig memory c = _cfg(uint64(block.timestamp + 1 hours), 10, 3, 0, 5);
        c.starterPerPress = 5;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropStarted.selector);
        sale.configureDrop(1, c);
        assertEq(sale.dropOf(1).starterPerPress, 1);
    }


    /// The studio's sample export (recipe.json with a "sale" block, written by studio/src/sale.test.ts) goes through
    /// ConfigureSeries into the recipe calls and FireSale.configureDrop, and the drop comes out as the studio set it.
    function test_studioSaleExportConfiguresTheDrop() public {
        _warp(start + 48 hours);
        vm.prank(owner, owner);
        sale.endDrop(1); // one drop at a time
        _warp(1_800_000_000); // the export's start is a few months on from here
        FirePsa psa = new FirePsa(owner, address(cards), address(new MockBurner(address(plank), address(0))));
        ConfigureSeries cs = new ConfigureSeries();
        string memory json = vm.readFile("test/cards/recipe-studio-sale.json");
        ConfigureSeries.Call[] memory calls = cs.buildAll(json, address(dealer), address(cards), address(psa), address(sale), 200);
        assertEq(calls.length, 6, "recipe, characters, dealer, images, odds, configureDrop");
        assertEq(calls[5].what, "FireSale.configureDrop");
        assertEq(cs.build(json, address(dealer), address(cards), address(psa), 200).length, 5, "build leaves the sale out");
        vm.startPrank(owner, owner);
        for (uint256 i; i < calls.length; i++) {
            (bool ok,) = calls[i].to.call(calls[i].data);
            assertTrue(ok, calls[i].what);
        }
        vm.stopPrank();
        FireSale.Drop memory d = sale.dropOf(7);
        assertEq(d.start, 1_810_000_000);
        assertEq(d.packs, 117);
        assertEq(d.starters, 50);
        assertEq(d.plankOnly, 50);
        assertEq(d.walletLimit, 5);
        assertEq(d.starterWindow, 24 hours);
        assertEq(d.liftAfter, 48 hours);
        assertEq(d.holderWindow, 24 hours);
        assertEq(d.plankOnlyFor, 48 hours);
        assertEq(d.regularWalletsFor, 48 hours);
        assertEq(d.maxPerTx, 50);
        assertEq(d.plankBurnBps, 3_000);
        assertEq(d.priceUsd, 250_000_000);
        assertEq(d.paperPerPack, 1e18);
        assertEq(d.starterPerPress, 1);
        assertEq(d.starterWalletLimit, 1);
        assertEq(d.starterPriceUsd, 0);
        assertEq(d.starterPaper, 1e18);
        assertEq(d.creditsPerPick, 1);
        assertEq(d.creditPacksMax, 0);
        assertEq(d.creditPacksPerWallet, 0);
        assertEq(d.holderRoot, bytes32(0xabababababababababababababababababababababababababababababababab));
        // DROP_START and HOLDER_ROOT override the block's start and root
        vm.setEnv("DROP_START", "1810000123");
        vm.setEnv("HOLDER_ROOT", "0x0000000000000000000000000000000000000000000000000000000000000001");
        FireSale.DropConfig memory c = cs.parseSale(json);
        assertEq(c.start, 1_810_000_123);
        assertEq(c.holderRoot, bytes32(uint256(1)));
        // a misspelt field is refused by name, not read as 0
        vm.expectRevert(bytes(".sale: unknown key creditsPerPik"));
        cs.parseSale(vm.replace(json, '"creditsPerPick"', '"creditsPerPik"'));
        vm.expectRevert(bytes(".sale: unknown key creditPacksMx"));
        cs.parseSale(vm.replace(json, '"creditPacksMax"', '"creditPacksMx"'));
        // a start more than a year away is refused
        vm.setEnv("DROP_START", "1900000123");
        vm.expectRevert(bytes("sale.start is more than a year away: a typo?"));
        cs.parseSale(json);
        vm.setEnv("DROP_START", "1810000000");
    }

    // ---------------------------------------------------------------- caps on free (credit) packs

    /// Alice and bob each get `n` credits (picked suggestions for fire 2's drop, set up with `c`); fire 2 then opens.
    function _creditDrop(FireSale.DropConfig memory c, uint256 n) internal returns (uint64 s2) {
        _aliceGetsCards(14); // closes fire 1
        s2 = uint64(block.timestamp + 1 hours);
        c.start = s2;
        c.creditsPerPick = uint16(n);
        _set(2, c);
        uint256[] memory ids = new uint256[](2);
        vm.prank(alice, alice);
        ids[0] = sale.suggest("Ember Fox", type(uint256).max);
        vm.prank(bob, bob);
        ids[1] = sale.suggest("Ash Wolf", type(uint256).max);
        vm.prank(owner, owner);
        sale.pickSuggestions(2, ids);
        _warp(s2);
    }

    function test_creditPacksTotalCap() public {
        FireSale.DropConfig memory c = _cfg(0, 20, 0, 0, 5);
        c.creditPacksMax = 5;
        _creditDrop(c, 4);
        assertEq(sale.phase(2).creditPacksLeft, 5);
        vm.prank(alice, alice);
        sale.useCredits(2, 4, type(uint256).max);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.CreditCapReached.selector);
        sale.useCredits(2, 2, type(uint256).max);
        vm.prank(bob, bob);
        sale.useCredits(2, 1, type(uint256).max);
        assertEq(sale.phase(2).creditPacksLeft, 0);
        assertEq(sale.credits(bob), 3, "unused credits wait for another drop");
    }

    function test_creditPacksPerWalletCap() public {
        FireSale.DropConfig memory c = _cfg(0, 20, 0, 0, 5);
        c.creditPacksPerWallet = 2;
        _creditDrop(c, 4);
        vm.prank(alice, alice);
        sale.useCredits(2, 2, type(uint256).max);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.CreditWalletLimit.selector);
        sale.useCredits(2, 1, type(uint256).max);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.CreditWalletLimit.selector);
        sale.useCredits(2, 3, type(uint256).max);
        vm.prank(bob, bob);
        sale.useCredits(2, 2, type(uint256).max);
        assertEq(sale.creditPacksBy(2, alice), 2);
    }

    function test_creditPacksZeroMeansNoLimit() public {
        FireSale.DropConfig memory c = _cfg(0, 20, 0, 0, 5);
        _creditDrop(c, 10);
        assertEq(sale.phase(2).creditPacksLeft, 20, "only the supply");
        vm.prank(alice, alice);
        sale.useCredits(2, 10, type(uint256).max);
        vm.prank(bob, bob);
        sale.useCredits(2, 10, type(uint256).max);
        assertTrue(sale.phase(2).closed, "credits took the whole drop");
    }

    function test_creditCapsLockAtStart() public {
        FireSale.DropConfig memory c = _cfg(start, 10, 3, 0, 5);
        c.creditPacksMax = 2;
        c.creditPacksPerWallet = 1;
        _set(1, c);
        _open();
        c.start = uint64(block.timestamp + 1 hours);
        c.creditPacksMax = 0;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropStarted.selector);
        sale.configureDrop(1, c);
        assertEq(sale.dropOf(1).creditPacksMax, 2);
        assertEq(sale.dropOf(1).creditPacksPerWallet, 1);
    }

    // ---------------------------------------------------------------- Plan A and round-4 fixes

    event DropConfigured(uint256 indexed fire, FireSale.DropConfig config);

    /// A pack's PAPER never costs more than $1: past $1 a PAPER it takes $1 worth (part of a PAPER).
    function test_packPaperCappedAtOneDollar() public {
        MockFeed paperUsd = new MockFeed(5e18); // PAPER at $5
        paperUsd.setDecimals(18);
        _warp(start + 72 hours);
        vm.prank(owner, owner);
        sale.endDrop(1);
        vm.prank(owner, owner);
        sale.setFeeds(address(ethFeed), address(plankFeed), address(paperUsd), address(router));
        uint64 s3 = uint64(block.timestamp + 1 hours);
        FireSale.DropConfig memory c = _cfg(s3, 10, 0, 0, 0);
        c.liftAfter = 0;
        c.plankOnlyFor = 0;
        _set(2, c);
        _warp(s3);
        paperUsd.set(5e18);
        assertEq(sale.paperFor(2, 1), 0.2e18, "$1 of PAPER at $5");
        uint256 before = paper.balanceOf(alice);
        vm.prank(alice, alice);
        sale.buyWithPlank(2, 3, type(uint256).max, 0.6e18, _na());
        assertEq(before - paper.balanceOf(alice), 0.6e18);
        paperUsd.set(0.08e18);
        assertEq(sale.paperFor(2, 2), 2e18, "under $1 a PAPER: the full PAPER");
        paperUsd.setBroken(true);
        assertEq(sale.lastPaperCap(), 0.2e18, "the last cap a buy saw");
        assertEq(sale.paperFor(2, 2), 0.4e18, "no price: the last cap holds, never back to an uncapped pack");
    }

    /// Setting a drop up locks its Series (recipe, characters, dealer, images, odds) before anyone can buy.
    function test_configureDropLocksTheSeries() public {
        (, , bool locked,,,) = cards.fires(1);
        assertTrue(locked);
        (string[] memory names, string[] memory cats) = _chars(2);
        vm.startPrank(owner, owner);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.setCharacters(1, names, cats);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setImagesBase(1, "ipfs://other/");
        vm.stopPrank();
    }

    /// The event carries the per-transaction cap that applies (0 means the default).
    function test_dropConfiguredEventShowsTheAppliedCap() public {
        FireSale.DropConfig memory c = _cfg(uint64(block.timestamp + 30 minutes), 10, 3, 4, 5);
        FireSale.DropConfig memory e = c;
        e.maxPerTx = uint32(sale.DEFAULT_MAX_PER_TX());
        vm.expectEmit(address(sale));
        emit DropConfigured(1, e);
        vm.prank(owner, owner);
        sale.configureDrop(1, c);
    }

    /// Even a drop with no timed phases runs at least a day before the owner can end it.
    function test_endDropWaitsAtLeastADay() public {
        _warp(start + 72 hours);
        vm.prank(owner, owner);
        sale.endDrop(1);
        FireSale.DropConfig memory c = _cfg(uint64(block.timestamp + 1 hours), 10, 0, 0, 0);
        (c.liftAfter, c.plankOnlyFor, c.regularWalletsFor, c.starterWindow) = (0, 0, 0, 0);
        _set(2, c);
        _warp(block.timestamp + 2 hours);
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.TooEarly.selector);
        sale.endDrop(2);
        _warp(block.timestamp + 1 days);
        vm.prank(owner, owner);
        sale.endDrop(2);
        FireSale.Phase memory p = sale.phase(2);
        assertTrue(p.closed);
        assertFalse(p.plankOnly);
        assertEq(p.paidLeft, 0, "an ended drop has nothing for sale");
    }

    /// Credit packs aren't available in a Series whose packs hold 42+ cards (burning one would pay for itself).
    function test_noCreditsInBigPackSeries() public {
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](1);
        r.types[0] = _type("Common", "common", 0, RecipeDealer.Supply.Filler, 0);
        r.slots = new RecipeDealer.Slot[](1);
        r.slots[0] = _slotOne(42, 0);
        _series(cards, dealer, owner, 5, r, 2);
        _warp(start + 72 hours);
        vm.prank(owner, owner);
        sale.endDrop(1);
        uint64 s5 = uint64(block.timestamp + 1 hours);
        _set(5, _cfg(s5, 10, 0, 0, 5));
        _warp(s5);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.useCredits(5, 1, type(uint256).max);
    }
}
