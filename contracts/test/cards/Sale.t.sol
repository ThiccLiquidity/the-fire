// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FireSale} from "../../src/cards/FireSale.sol";
import {MockERC20, MockUSDG, MockMill, MockFeed, MockRandomness, MockPlankTwap, MockPair} from "../Mocks.sol";

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

contract SaleTest is Test {
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
        rng.setFire(address(cards));
        sale = new FireSale(FireSale.Config({
            owner: owner, paper: address(paper), plank: address(plank), usdg: address(usdg), weth: address(0xE7),
            press: address(press), packs: address(packs), cards: address(cards), ethUsd: address(ethFeed),
            plankUsd: address(plankFeed), router: address(router), revenueWallet: revenue, burnWallet: burnW,
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
        string[] memory names = new string[](3);
        string[] memory cats = new string[](3);
        for (uint256 i; i < 3; i++) { names[i] = string.concat("Char", vm.toString(i)); cats[i] = string.concat("Cat ", vm.toString(i)); }
        vm.prank(owner, owner);
        cards.configureFire(fire, names, cats, "ipfs://x/");
    }

    function _cfg(uint64 s, uint32 n, uint32 starters, uint32 plankOnly, uint32 limit) internal pure returns (FireSale.DropConfig memory) {
        return FireSale.DropConfig({start: s, packs: n, starters: starters, plankOnly: plankOnly, walletLimit: limit,
            starterWindow: 24 hours, liftAfter: 48 hours, plankBurnBps: 3_000, priceUsd: PRICE, paperPerPack: 1e18, holderWindow: 0, holderRoot: bytes32(0)});
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
        sale.claimStarter(1, p1, type(uint256).max);
        assertEq(packs.balanceOf(alice, 1), 1);
        assertEq(paper.balanceOf(DEAD) - deadPaper, 1e18, "only the PAPER");
        assertEq(plank.balanceOf(revenue), 0);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.AlreadyClaimed.selector);
        sale.claimStarter(1, p2, type(uint256).max); // 1 per wallet
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.NotPressOwner.selector);
        sale.claimStarter(1, p1, type(uint256).max); // not bob's press
        vm.prank(alice, alice);
        press.transferFrom(alice, bob, p1);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.PressUsed.selector);
        sale.claimStarter(1, p1, type(uint256).max); // each press once per drop
        vm.prank(bob, bob);
        sale.claimStarter(1, p3, type(uint256).max);
        _warp(start + 24 hours);
        address carol = address(0xC3);
        uint256 p4 = press.mint(carol);
        vm.prank(carol, carol);
        vm.expectRevert(FireSale.StarterWindowClosed.selector);
        sale.claimStarter(1, p4, type(uint256).max);
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
        sale.claimStarter(1, p1, type(uint256).max);
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
        (bool closed,,,,,,,,,) = cards.fires(1);
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
        (bool closed,,, uint32 packCount,,,,,,) = cards.fires(1);
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
        cards.process(type(uint256).max);
        assertEq(cards.balanceOf(alice), nPacks * 6);
    }

    function _ids(uint256 from, uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; i++) ids[i] = from + i;
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
        uint256 id = sale.suggest("A fox made of embers");
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

    function test_suggestions() public {
        uint256 before = paper.balanceOf(DEAD);
        vm.prank(bob, bob);
        uint256 id = sale.suggest("Captain Kindling");
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
        uint256 id2 = sale.suggest("Ash Wolf");
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
        uint256 a = sale.suggest("Ember Fox");
        uint256 b = sale.suggest("Ash Wolf");
        vm.stopPrank();
        uint256[] memory one = new uint256[](1);
        one[0] = a;
        vm.prank(owner, owner);
        sale.pickSuggestions(1, one); // session for Fire 1: picks from the list a and b are in
        assertEq(sale.currentRound(), 1, "new suggestions now go into a fresh list");
        vm.prank(alice, alice);
        uint256 c = sale.suggest("Cinder Owl"); // made after the session started: next list

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
        sale.setFeeds(address(ethFeed), address(plankFeed), address(router));
        _drop(1, start, 4, 0, 0, 5);
        _open();
        vm.prank(alice, alice);
        sale.buyWithPlank(1, 4, type(uint256).max, type(uint256).max, _na());
        MockFeed newEth = new MockFeed(ETH_USD);
        vm.prank(owner, owner);
        sale.setFeeds(address(newEth), address(plankFeed), address(router));
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
        for (uint256 i; i < 4; i++) { vm.prank(bob, bob); ids[i] = sale.suggest("x"); }
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadAmount.selector);
        sale.pickSuggestions(1, ids); // Fire 1 has 3 characters
    }

    function test_audit_fireNumberFitsIn32Bits() public {
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(uint256(type(uint32).max) + 8, _cfg(start, 10, 0, 0, 5));
        string[] memory names = new string[](1);
        string[] memory cats = new string[](1);
        for (uint256 k; k < cats.length; k++) cats[k] = "Person";
        names[0] = "A";
        vm.prank(owner, owner);
        vm.expectRevert(FireCards.BadLength.selector);
        cards.configureFire(uint256(type(uint32).max) + 8, names, cats, "ipfs://x/");
    }

    function test_audit_timingsChecked() public {
        FireSale.DropConfig memory c = _cfg(start, 10, 3, 0, 5);
        c.liftAfter = 0;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, c); // would silently turn off PLANK-only and the wallet limit
        c = _cfg(start, 10, 3, 0, 5);
        c.starterWindow = 72 hours; // longer than the limited phase
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, c);
        c = _cfg(start, 10, 3, 0, 5);
        c.starterWindow = 0; // starters with no window
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
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
            plankUsd: address(twap), router: address(router), revenueWallet: revenue, burnWallet: burnW,
            paperPerSuggestion: 1e18
        }));
        s2.quotePlank(1, 1); // a normal 30-minute window: fine
        twap.setWindow(PLANK_USD, 6 days); // a checkpoint after a 6-day gap: fresh-looking, but a 6-day average
        vm.expectRevert(FireSale.FeedUnavailable.selector);
        s2.quotePlank(1, 1);
    }
}
