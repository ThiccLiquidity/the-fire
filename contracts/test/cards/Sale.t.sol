// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FireSale} from "../../src/cards/FireSale.sol";
import {FireCredits} from "../../src/cards/FireCredits.sol";
import {FireGroups} from "../../src/cards/FireGroups.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {ConfigureSeries} from "../../script/ConfigureSeries.s.sol";
import {SeriesHelper} from "./SeriesHelper.sol";
import {MockERC20, MockUSDG, MockMill, MockFeed, MockRandomness, MockPlankTwap, MockPair, MockBurner} from "../Mocks.sol";
import {PlankUsdTwap} from "../../src/PlankUsdTwap.sol";
import {PaperUsdTwap} from "../../src/PaperUsdTwap.sol";
import {MockPair as CumPair} from "../PlankUsdTwap.t.sol";
import {MockFactory} from "../PaperUsdTwap.t.sol";

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

    // PAPER bought with ETH (buyWithEthAll): PAPER wei per ETH wei, straight and through PLANK (0 = no pool)
    MockERC20 public paper;
    uint256 public paperDirect;
    uint256 public paperViaPlank;
    function setPaper(MockERC20 p, uint256 direct, uint256 viaPlank) external { (paper, paperDirect, paperViaPlank) = (p, direct, viaPlank); }
    function _paperRate(address[] calldata path) internal view returns (uint256) { return path.length == 2 ? paperDirect : paperViaPlank; }
    function getAmountsIn(uint256 out, address[] calldata path) external view returns (uint256[] memory a) {
        uint256 r = _paperRate(path);
        require(address(paper) != address(0) && path[path.length - 1] == address(paper) && r != 0, "no pool");
        a = new uint256[](path.length);
        a[0] = (out + r - 1) / r;
    }

    function swapExactETHForTokens(uint256 minOut, address[] calldata path, address to, uint256) external payable returns (uint256[] memory a) {
        require(!fail, "router down");
        if (address(paper) != address(0) && path[path.length - 1] == address(paper)) {
            uint256 got = msg.value * _paperRate(path);
            require(got >= minOut, "INSUFFICIENT_OUTPUT_AMOUNT");
            paper.mint(to, got);
            return new uint256[](path.length);
        }
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

/// @dev A PLANK/USD feed whose checkpoint() refreshes it (like PlankUsdTwap when due); it can be told to fail.
contract CheckpointFeed {
    int256 public answer;
    uint256 public updatedAt;
    uint256 public checkpoints;
    bool public fail;
    constructor(int256 a) { answer = a; updatedAt = block.timestamp; }
    function setFail(bool f) external { fail = f; }
    function checkpoint() external {
        require(!fail, "checkpoint down");
        checkpoints++;
        updatedAt = block.timestamp;
    }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, answer, 0, updatedAt, 0);
    }
}

/// @dev The sale's test bench: every contract wired as DeployCards wires it, two buyers with every coin, a press NFT,
///      and drop 1 set up (one open group of 13 packs, $2.50 + 1 PAPER, any coin, 30% PLANK burn) opening in an hour.
abstract contract SaleBase is SeriesHelper {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint8 constant NONE = 255;
    address owner = address(0xA11CE0);
    address revenue = address(0xBEEF);
    address burnW = address(0xB0B);
    address paperW = address(0xBA9E5);
    address alice = address(0xA1);
    address bob = address(0xB2);
    address carol = address(0xC3);

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
    FireCredits credits;
    FireGroups groups;

    // ETH $3,333; PLANK $1e-9 (18-decimal feed: 1e9); the router trades at the same prices.
    int256 constant ETH_USD = 3_333e8;
    int256 constant PLANK_USD = 1e9;
    uint256 constant PER_ETH = 3_333e9; // PLANK wei per ETH wei
    uint256 constant PER_USDG = 1e21; // PLANK wei per USDG unit ($1e-6 / 1e-9 PLANK = 1e3 PLANK = 1e21 wei)
    uint128 constant PRICE = 250_000_000; // $2.50
    uint64 start;

    function setUp() public virtual {
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
        credits = new FireCredits(owner, address(cards), 1e18);
        groups = new FireGroups();
        sale = new FireSale(_saleConfig(address(plankFeed)));
        groups.setSale(address(sale));
        vm.startPrank(owner, owner);
        packs.setSeller(address(sale));
        packs.setCards(address(cards));
        cards.setSeller(address(sale));
        cards.setRandomness(address(rng));
        credits.setSale(address(sale));
        vm.stopPrank();
        _configureCards(1);
        _configureCards(2);
        start = uint64(block.timestamp + 1 hours);
        _drop(1, start, 13);

        for (uint256 i; i < 3; i++) {
            address u = i == 0 ? alice : i == 1 ? bob : carol;
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

    function _saleConfig(address plankUsd) internal view returns (FireSale.Config memory) {
        return FireSale.Config({
            owner: owner, paper: address(paper), plank: address(plank), usdg: address(usdg), weth: address(0xE7),
            packs: address(packs), cards: address(cards), ethUsd: address(ethFeed), plankUsd: plankUsd, paperUsd: address(0),
            router: address(router), revenueWallet: revenue, plankBurner: burnW, paperBurner: paperW,
            credits: address(credits), groups: address(groups)
        });
    }

    // ---------------------------------------------------------------- config helpers

    function _configureCards(uint256 fire) internal {
        _standard(cards, dealer, owner, fire, 3);
    }

    /// An open group: anyone, $2.50 + 1 PAPER a pack in any coin, no wallet limit, opens with the drop, until sold.
    function _g(uint64 n) internal pure returns (FireGroups.Group memory g) {
        g.packs = n;
        g.coins = 7;
        g.afterGroup = NONE;
        g.rollTo = NONE;
        g.priceUsd = PRICE;
        g.paper = 1e18;
    }

    /// A drop of one open group (`_g(n)`): 30% PLANK burn, $1 PAPER ceiling, regular wallets only for 48h, credits
    /// from the group.
    function _cfg(uint64 s, uint64 n) internal pure returns (FireSale.DropConfig memory c) {
        c.start = s;
        c.packs = n;
        c.plankBurnBps = 3_000;
        c.paperCapUsd = 1e8;
        c.regularWalletsFor = 48 hours;
        c.creditsPerPick = 1;
        c.groups = new FireGroups.Group[](1);
        c.groups[0] = _g(n);
    }

    /// `c` with these groups (and their packs as the total).
    function _with(FireSale.DropConfig memory c, FireGroups.Group[] memory gs) internal pure returns (FireSale.DropConfig memory) {
        c.groups = gs;
        uint256 total;
        for (uint256 i; i < gs.length; i++) total += gs[i].packs;
        c.packs = uint64(total);
        return c;
    }

    function _two(FireGroups.Group memory a, FireGroups.Group memory b) internal pure returns (FireGroups.Group[] memory gs) {
        gs = new FireGroups.Group[](2);
        (gs[0], gs[1]) = (a, b);
    }

    function _three(FireGroups.Group memory a, FireGroups.Group memory b, FireGroups.Group memory c)
        internal
        pure
        returns (FireGroups.Group[] memory gs)
    {
        gs = new FireGroups.Group[](3);
        (gs[0], gs[1], gs[2]) = (a, b, c);
    }

    function _set(uint256 fire, FireSale.DropConfig memory c) internal {
        vm.prank(owner, owner);
        sale.configureDrop(fire, c);
    }

    function _drop(uint256 fire, uint64 s, uint64 n) internal {
        _set(fire, _cfg(s, n));
    }

    /// Move time and keep the price feeds fresh (they'd go stale over a 48h warp).
    function _warp(uint256 t) internal {
        vm.warp(t);
        ethFeed.set(ETH_USD);
        plankFeed.set(PLANK_USD);
    }

    function _open() internal { _warp(start); }

    // ---------------------------------------------------------------- buying helpers

    function _na() internal pure returns (FireGroups.Access memory a) {}

    function _cost(uint256 fire, uint256 g, uint256 n, FireSale.Pay pay) internal view returns (uint256 cost) {
        (cost,) = sale.quote(fire, g, n, pay);
    }

    /// `who` buys `n` packs of group `g` in PLANK (any amount), from a regular wallet.
    function _plank(address who, uint256 fire, uint256 g, uint256 n) internal {
        vm.prank(who, who);
        sale.buy(fire, g, n, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
    }

    function _eth(address who, uint256 fire, uint256 g, uint256 n) internal {
        uint256 cost = _cost(fire, g, n, FireSale.Pay.ETH);
        vm.prank(who, who);
        sale.buy{value: cost}(fire, g, n, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
    }

    function _usdg(address who, uint256 fire, uint256 g, uint256 n) internal {
        vm.prank(who, who);
        sale.buy(fire, g, n, FireSale.Pay.USDG, type(uint256).max, type(uint256).max, _na());
    }

    function _assertHoldsNothing() internal view {
        assertEq(address(sale).balance, 0, "eth");
        assertEq(usdg.balanceOf(address(sale)), 0, "usdg");
        assertEq(plank.balanceOf(address(sale)), 0, "plank");
        assertEq(paper.balanceOf(address(sale)), 0, "paper");
        assertEq(usdg.allowance(address(sale), address(router)), 0, "allowance");
    }

    function _closed(uint256 fire) internal view returns (bool closed) {
        (, closed,,,,) = cards.fires(fire);
    }

    function _view(uint256 fire, uint256 g) internal view returns (FireGroups.GroupView memory) {
        return groups.groupsOf(fire)[g];
    }

    // ---------------------------------------------------------------- snapshot trees

    function _leaf(address a, uint256 allowance) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(a, allowance))));
    }

    function _pair(bytes32 x, bytes32 y) internal pure returns (bytes32) {
        return x < y ? keccak256(abi.encode(x, y)) : keccak256(abi.encode(y, x));
    }

    function _proof(uint256 allowance, bytes32 sibling) internal pure returns (FireGroups.Access memory a) {
        a.allowance = allowance;
        a.proof = new bytes32[](1);
        a.proof[0] = sibling;
    }

    function _nfts(uint256 id) internal pure returns (FireGroups.Access memory a) {
        a.nftIds = new uint256[](1);
        a.nftIds[0] = id;
    }

    function _nfts(uint256 id1, uint256 id2) internal pure returns (FireGroups.Access memory a) {
        a.nftIds = new uint256[](2);
        (a.nftIds[0], a.nftIds[1]) = (id1, id2);
    }

    /// A Paper Press group: `n` packs, 1 PAPER each, `per` per press.
    function _pressGroup(uint64 n, uint32 per) internal view returns (FireGroups.Group memory g) {
        g = _g(n);
        g.gate = FireGroups.Gate.NFT;
        g.nft = address(press);
        g.perNft = per;
        g.priceUsd = 0;
        g.coins = 0;
    }

    function _snapGroup(uint64 n, bytes32 root) internal pure returns (FireGroups.Group memory g) {
        g = _g(n);
        g.gate = FireGroups.Gate.SNAPSHOT;
        g.root = root;
    }

    // ---------------------------------------------------------------- cards and credits helpers

    /// Alice ends up with `n` packs' worth of cards (6 each) from fire 1.
    function _aliceGetsCards(uint256 nPacks) internal {
        _drop(1, start, uint64(nPacks));
        _open();
        _plank(alice, 1, 0, nPacks); // sells out, closes the Fire
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

    /// Ends drop 1 (its schedule is over a day after the start).
    function _endDrop1() internal {
        _warp(start + 72 hours);
        vm.prank(owner, owner);
        sale.endDrop(1);
    }
}

contract SaleTest is SaleBase {
    // ---------------------------------------------------------------- setup and locking

    function test_notLiveBeforeStart() public {
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.NotLive.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
    }

    function test_configLocksWhenTheDropOpens() public {
        _drop(1, start, 20); // changing before it opens is fine
        assertEq(sale.dropOf(1).packs, 20);
        assertEq(_view(1, 0).capacity, 20);
        _open();
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropStarted.selector);
        sale.configureDrop(1, _cfg(uint64(block.timestamp + 1), 99));
    }

    function test_onlyOwnerConfigures() public {
        vm.prank(alice, alice);
        vm.expectRevert();
        sale.configureDrop(3, _cfg(start, 10));
    }

    function test_badConfigRejected() public {
        vm.startPrank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, _cfg(uint64(block.timestamp), 10)); // start in the past
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(3, _cfg(start, 10)); // Fire 3's characters aren't set in the card contract
        FireSale.DropConfig memory c = _cfg(start, 10);
        c.regularWalletsFor = 30 days + 1;
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, c); // longer than any window may be
        vm.stopPrank();
    }

    /// Only FireSale writes to FireGroups, and only the deployer wires it, once.
    function test_groupsOnlyFromTheSale() public {
        FireGroups.Group[] memory gs = new FireGroups.Group[](1);
        gs[0] = _g(5);
        vm.prank(owner, owner);
        vm.expectRevert(FireGroups.NotSale.selector);
        groups.configure(1, start, 5, gs, 0);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.NotSale.selector);
        groups.take(1, 0, alice, 1, 1, _na());
        vm.expectRevert(FireGroups.NotSale.selector);
        groups.takeCredit(1, 0, 1);
        vm.expectRevert(FireGroups.AlreadySet.selector);
        groups.setSale(address(sale));
        vm.prank(alice);
        vm.expectRevert(FireGroups.NotSale.selector);
        groups.setSale(address(sale));
        FireGroups g2 = new FireGroups();
        vm.expectRevert(FireGroups.BadConfig.selector);
        g2.setSale(address(sale)); // the sale doesn't point at it
        assertEq(address(sale.GROUPS()), address(groups));
        assertEq(groups.sale(), address(sale));
    }

    // ---------------------------------------------------------------- PLANK

    function test_plankBuy_splitsAndBurns() public {
        _open();
        uint256 cost = _cost(1, 0, 2, FireSale.Pay.PLANK);
        assertEq(cost, 5e27, "2 packs = $5 = 5e9 PLANK");
        uint256 before = plank.balanceOf(alice);
        vm.prank(alice, alice);
        sale.buy(1, 0, 2, FireSale.Pay.PLANK, cost, type(uint256).max, _na());
        assertEq(before - plank.balanceOf(alice), cost);
        assertEq(plank.balanceOf(DEAD), cost * 3_000 / 10_000, "30% burned");
        assertEq(plank.balanceOf(revenue), cost - cost * 3_000 / 10_000, "70% revenue");
        assertEq(paper.balanceOf(DEAD), 2e18, "1 PAPER per pack burned");
        assertEq(packs.balanceOf(alice, 1), 2);
        _assertHoldsNothing();
    }

    function test_plankPriceMoved() public {
        _open();
        uint256 cost = _cost(1, 0, 1, FireSale.Pay.PLANK);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, cost - 1, type(uint256).max, _na());
    }

    function test_paperIsRequired() public {
        _open();
        vm.prank(alice, alice);
        paper.approve(address(sale), 0);
        vm.prank(alice, alice);
        vm.expectRevert();
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
    }

    /// ETH sent with a PLANK payment comes back.
    function test_plankBuy_refundsStrayEth() public {
        _open();
        uint256 eth = alice.balance;
        vm.prank(alice, alice);
        sale.buy{value: 1 ether}(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        assertEq(alice.balance, eth);
        _assertHoldsNothing();
    }

    // ---------------------------------------------------------------- ETH and USDG

    function test_ethBuy_burnsPlankAndRefunds() public {
        _open();
        uint256 cost = _cost(1, 0, 2, FireSale.Pay.ETH);
        assertEq(cost, (500_000_000 * uint256(1e18) + uint256(ETH_USD) - 1) / uint256(ETH_USD));
        uint256 burnShare = cost * 3_000 / 10_000;
        uint256 balBefore = alice.balance;
        vm.prank(alice, alice);
        sale.buy{value: cost + 0.01 ether}(1, 0, 2, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        assertEq(balBefore - alice.balance, cost, "excess refunded");
        assertEq(revenue.balance, cost - burnShare, "70% revenue");
        assertEq(plank.balanceOf(DEAD), burnShare * PER_ETH, "30% bought PLANK, burned");
        assertEq(burnW.balance, 0);
        _assertHoldsNothing();
    }

    function test_ethShortOrOverMaxReverts() public {
        _open();
        uint256 cost = _cost(1, 0, 1, FireSale.Pay.ETH);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.buy{value: cost - 1}(1, 0, 1, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.buy{value: cost}(1, 0, 1, FireSale.Pay.ETH, cost - 1, type(uint256).max, _na());
    }

    function test_ethSwapFails_burnShareToBurnWallet() public {
        _open();
        router.setFail(true);
        uint256 cost = _cost(1, 0, 1, FireSale.Pay.ETH);
        _eth(alice, 1, 0, 1);
        assertEq(burnW.balance, cost * 3_000 / 10_000, "burn wallet");
        assertEq(revenue.balance, cost - cost * 3_000 / 10_000);
        assertEq(packs.balanceOf(alice, 1), 1, "the purchase still went through");
        _assertHoldsNothing();
    }

    function test_pumpedPool_skipsSwap() public {
        _open();
        router.setRates(PER_ETH * 85 / 100, PER_USDG * 85 / 100); // pool 15% worse than the 30-minute average
        uint256 cost = _cost(1, 0, 1, FireSale.Pay.ETH);
        _eth(alice, 1, 0, 1);
        assertEq(burnW.balance, cost * 3_000 / 10_000, "falls back instead of overpaying");
        _assertHoldsNothing();
    }

    function test_usdgBuy() public {
        _open();
        uint256 cost = _cost(1, 0, 2, FireSale.Pay.USDG);
        assertEq(cost, 5e6, "$5.00");
        vm.prank(alice, alice);
        sale.buy(1, 0, 2, FireSale.Pay.USDG, cost, type(uint256).max, _na());
        assertEq(usdg.balanceOf(revenue), 3_500_000, "70%");
        assertEq(usdg.balanceOf(address(router)), 1_500_000, "30% swapped");
        assertEq(plank.balanceOf(DEAD), 1_500_000 * PER_USDG);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.buy(1, 0, 1, FireSale.Pay.USDG, 2_499_999, type(uint256).max, _na());
        _assertHoldsNothing();
    }

    function test_usdgSwapFails_burnShareToBurnWallet() public {
        _open();
        router.setFail(true);
        _usdg(alice, 1, 0, 1);
        assertEq(usdg.balanceOf(burnW), 750_000);
        assertEq(usdg.balanceOf(revenue), 1_750_000);
        _assertHoldsNothing();
    }

    function test_noUsdgConfigured() public {
        FireSale s2 = new FireSale(FireSale.Config({
            owner: owner, paper: address(paper), plank: address(plank), usdg: address(0), weth: address(0xE7),
            packs: address(packs), cards: address(cards), ethUsd: address(ethFeed), plankUsd: address(plankFeed),
            paperUsd: address(0), router: address(router), revenueWallet: revenue, plankBurner: burnW, paperBurner: paperW,
            credits: address(credits), groups: address(groups)
        }));
        assertEq(address(s2.USDG()), address(0));
        assertEq(s2.USDG_UNIT(), 0);
    }

    // ---------------------------------------------------------------- the PAPER burn share (20/10/70)

    /// Drop 1 again (before it opens) with 10% PLANK burn and 20% to PaperBurner.
    function _split() internal {
        FireSale.DropConfig memory c = _cfg(start, 13);
        c.plankBurnBps = 1_000;
        c.paperBurnBps = 2_000;
        _set(1, c);
    }

    function test_split_plank() public {
        _split();
        _open();
        uint256 cost = _cost(1, 0, 2, FireSale.Pay.PLANK);
        _plank(alice, 1, 0, 2);
        assertEq(plank.balanceOf(DEAD), cost * 1_000 / 10_000, "10% PLANK burned");
        assertEq(plank.balanceOf(paperW), cost * 2_000 / 10_000, "20% to PaperBurner");
        assertEq(plank.balanceOf(revenue), cost - cost * 1_000 / 10_000 - cost * 2_000 / 10_000, "70% revenue");
        _assertHoldsNothing();
    }

    function test_split_eth() public {
        _split();
        _open();
        uint256 cost = _cost(1, 0, 2, FireSale.Pay.ETH);
        vm.prank(alice, alice);
        sale.buy{value: cost + 0.01 ether}(1, 0, 2, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        uint256 plankShare = cost * 1_000 / 10_000;
        uint256 paperShare = cost * 2_000 / 10_000;
        assertEq(plank.balanceOf(DEAD), plankShare * PER_ETH, "10% bought PLANK, burned");
        assertEq(paperW.balance, paperShare, "20% to PaperBurner");
        assertEq(revenue.balance, cost - plankShare - paperShare, "70% revenue");
        _assertHoldsNothing();
    }

    function test_split_ethSwapFails() public {
        _split();
        _open();
        router.setFail(true);
        uint256 cost = _cost(1, 0, 1, FireSale.Pay.ETH);
        _eth(alice, 1, 0, 1);
        assertEq(burnW.balance, cost * 1_000 / 10_000, "PLANK share waits in PlankBurner");
        assertEq(paperW.balance, cost * 2_000 / 10_000, "PAPER share still to PaperBurner");
        _assertHoldsNothing();
    }

    function test_split_usdg() public {
        _split();
        _open();
        _usdg(alice, 1, 0, 2); // $5.00
        assertEq(usdg.balanceOf(address(router)), 500_000, "10% swapped for PLANK");
        assertEq(usdg.balanceOf(paperW), 1_000_000, "20% to PaperBurner");
        assertEq(usdg.balanceOf(revenue), 3_500_000, "70% revenue");
        _assertHoldsNothing();
    }

    function test_split_overHundredPercentRefused() public {
        FireSale.DropConfig memory c = _cfg(start, 10);
        c.plankBurnBps = 5_000;
        c.paperBurnBps = 5_001;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(1, c);
        c.paperBurnBps = 5_000; // exactly 100%: allowed (nothing to revenue)
        _set(1, c);
    }

    function test_split_walletsMustDiffer() public {
        _drop(1, start, 4);
        _open();
        _plank(alice, 1, 0, 4); // sells out, closes
        assertEq(sale.activeDrops(), 0);
        vm.startPrank(owner, owner);
        vm.expectRevert(FireSale.ZeroAddress.selector);
        sale.setWallets(address(0x1111), address(0x2222), address(0x2222));
        vm.expectRevert(FireSale.ZeroAddress.selector);
        sale.setWallets(address(0x1111), address(0x2222), address(0));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- buyWithEthAll: ETH pays for the PAPER too

    function test_ethAll_buysThePaperOnTheCheaperRoute() public {
        address dave = address(0xDA7E); // holds ETH only, no PAPER
        router.setPaper(paper, 30_000, 31_250); // through PLANK is cheaper
        _open();
        uint256 cost = _cost(1, 0, 2, FireSale.Pay.ETH);
        uint256 paperNeed = sale.paperFor(1, 0, 2);
        uint256 paperEth = sale.quotePaperInEth(paperNeed);
        assertEq(paperEth, (paperNeed + 31_250 - 1) / 31_250, "the PLANK route");
        vm.deal(dave, 1 ether);
        vm.prank(dave, dave);
        sale.buyWithEthAll{value: cost + paperEth + 0.01 ether}(1, 0, 2, _na());
        assertEq(packs.balanceOf(dave, 1), 2);
        assertGe(paper.balanceOf(DEAD), paperNeed, "the PAPER bought and burned");
        assertEq(paper.balanceOf(dave), 0, "none of the buyer's own PAPER");
        assertEq(dave.balance, 1 ether - cost - paperEth, "the rest refunded");
        assertEq(revenue.balance, cost - cost * 3_000 / 10_000, "revenue as usual");
        _assertHoldsNothing();
    }

    function test_ethAll_directRouteWhenCheaper() public {
        address dave = address(0xDA7E);
        router.setPaper(paper, 31_250, 0); // no PLANK route
        _open();
        uint256 need = sale.paperFor(1, 0, 1);
        assertEq(sale.quotePaperInEth(need), (need + 31_250 - 1) / 31_250);
        uint256 total = _cost(1, 0, 1, FireSale.Pay.ETH) + sale.quotePaperInEth(need);
        vm.deal(dave, total);
        vm.prank(dave, dave);
        sale.buyWithEthAll{value: total}(1, 0, 1, _na());
        assertEq(dave.balance, 0, "exactly enough");
        _assertHoldsNothing();
    }

    function test_ethAll_notEnoughEthOrNoPoolReverts() public {
        address dave = address(0xDA7E);
        _open();
        vm.deal(dave, 1 ether);
        vm.prank(dave, dave);
        vm.expectRevert(FireSale.FeedUnavailable.selector); // no pool to buy PAPER from
        sale.buyWithEthAll{value: 0.1 ether}(1, 0, 1, _na());
        router.setPaper(paper, 31_250, 0);
        uint256 cost = _cost(1, 0, 1, FireSale.Pay.ETH);
        vm.prank(dave, dave);
        vm.expectRevert(); // the price is covered but not the PAPER
        sale.buyWithEthAll{value: cost}(1, 0, 1, _na());
        assertEq(packs.balanceOf(dave, 1), 0);
    }

    /// ETH alone in a group that doesn't take ETH: refused. In a PAPER-only group: it just buys the PAPER.
    function test_ethAll_followsTheGroupsCoins() public {
        FireGroups.Group memory plankOnly = _g(5);
        plankOnly.coins = FireGroups(groups).PLANK();
        FireGroups.Group memory paperOnly = _g(5);
        paperOnly.priceUsd = 0;
        paperOnly.coins = 0;
        paperOnly.gate = FireGroups.Gate.NFT;
        paperOnly.nft = address(press);
        paperOnly.perNft = 5;
        _set(1, _with(_cfg(start, 0), _two(plankOnly, paperOnly)));
        router.setPaper(paper, 31_250, 0);
        uint256 pid = press.mint(carol);
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.CoinNotAccepted.selector);
        sale.buyWithEthAll{value: 1 ether}(1, 0, 1, _na());
        uint256 need = sale.quotePaperInEth(sale.paperFor(1, 1, 2));
        uint256 bal = carol.balance;
        vm.prank(carol, carol);
        sale.buyWithEthAll{value: need + 1 ether}(1, 1, 2, _nfts(pid));
        assertEq(bal - carol.balance, need, "only the PAPER, bought with ETH");
        assertEq(packs.balanceOf(carol, 1), 2);
        assertEq(revenue.balance, 0);
        _assertHoldsNothing();
    }

    // ---------------------------------------------------------------- price feeds

    function test_ethFeedStale_reverts() public {
        _open();
        vm.warp(block.timestamp + 26 hours);
        plankFeed.set(PLANK_USD);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.FeedUnavailable.selector);
        sale.buy{value: 1 ether}(1, 0, 1, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        _plank(alice, 1, 0, 1); // PLANK still sells
    }

    /// A PLANK-only group can't sell while the PLANK price is down, but it can't stall the drop: when its time runs
    /// out its packs roll to the next group, which takes ETH (the burn share then waits in PlankBurner).
    function test_plankFeedDown_drop_doesNotGetStuck() public {
        FireGroups.Group memory a = _g(4);
        a.coins = 1; // PLANK only
        a.duration = 48 hours;
        a.rollTo = 1;
        FireGroups.Group memory b = _g(6);
        b.afterGroup = 0;
        _set(1, _with(_cfg(start, 0), _two(a, b)));
        _open();
        plankFeed.setBroken(true);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.FeedUnavailable.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.CoinNotAccepted.selector);
        sale.buy{value: 1 ether}(1, 0, 1, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.GroupNotOpen.selector);
        sale.buy{value: 1 ether}(1, 1, 1, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        vm.warp(start + 48 hours);
        ethFeed.set(ETH_USD);
        assertEq(_view(1, 1).capacity, 10, "the 4 PLANK-only packs rolled in");
        uint256 cost = _cost(1, 1, 1, FireSale.Pay.ETH);
        _eth(alice, 1, 1, 1);
        assertEq(burnW.balance, cost * 3_000 / 10_000, "no PLANK price: the burn share waits in PlankBurner");
    }

    function test_audit_stalePlankPricePausesPlankAndSkipsTheSwap() public {
        _open();
        vm.warp(block.timestamp + 3 hours); // keeper down: the average is 3 hours old
        ethFeed.set(ETH_USD);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.FeedUnavailable.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        uint256 cost = _cost(1, 0, 1, FireSale.Pay.ETH);
        _eth(alice, 1, 0, 1);
        assertEq(burnW.balance, cost * 3_000 / 10_000, "no swap on an old price");
    }

    function test_audit_longWindowAfterAKeeperGapRejected() public {
        MockPlankTwap twap = new MockPlankTwap(PLANK_USD, address(new MockPair(address(0xE7), address(plank))));
        FireSale s2 = new FireSale(_saleConfig(address(twap)));
        (uint256 c,) = s2.quote(1, 0, 1, FireSale.Pay.PLANK); // a normal 30-minute window: fine
        assertGt(c, 0);
        twap.setWindow(PLANK_USD, 6 days); // a checkpoint after a 6-day gap: fresh-looking, but a 6-day average
        vm.expectRevert(FireSale.FeedUnavailable.selector);
        s2.quote(1, 0, 1, FireSale.Pay.PLANK);
    }

    // ---------------------------------------------------------------- selling out and ending

    function test_soldOut_closesTheFire() public {
        _drop(1, start, 10);
        _open();
        _plank(alice, 1, 0, 10);
        assertTrue(_closed(1), "the last purchase closed the Fire");
        assertTrue(sale.status(1).closed);
        assertEq(sale.activeDrops(), 0);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.NotLive.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
    }

    function test_cantOversell() public {
        _drop(1, start, 3);
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.SoldOut.selector);
        sale.buy(1, 0, 4, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
    }

    function test_close_needsNothingLeftAndAConfiguredDrop() public {
        vm.expectRevert(FireSale.NotSoldOut.selector);
        sale.close(7); // never configured
        vm.expectRevert(FireSale.NotSoldOut.selector);
        sale.close(1); // not open yet
        _open();
        vm.expectRevert(FireSale.NotSoldOut.selector);
        sale.close(1);
    }

    function test_ownerCanEndADrop_onlyAfterADay() public {
        _open();
        _plank(alice, 1, 0, 4);
        assertEq(sale.status(1).endableAt, start + 1 days, "an until-sold group: MIN_DROP_TIME");
        _warp(start + 1 days - 1);
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.TooEarly.selector);
        sale.endDrop(1);
        _warp(start + 1 days);
        vm.prank(owner, owner);
        sale.endDrop(1);
        (, bool closed,,, uint64 packCount,) = cards.fires(1);
        assertTrue(closed);
        assertEq(packCount, 4);
        vm.expectRevert(FireSale.NotLive.selector);
        sale.endDrop(1);
    }

    function test_audit2_anyoneCanEndAStalledDropAfterAGracePeriod() public {
        _open();
        _plank(alice, 1, 0, 4);
        _warp(start + 48 hours);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.TooEarly.selector);
        sale.endDrop(1); // the owner's turn first
        _warp(start + 1 days + 7 days);
        vm.prank(bob, bob);
        sale.endDrop(1); // the owner never acted: anyone can, so the packs can be opened
        assertTrue(sale.status(1).closed);
    }

    /// The owner can end a stalled drop only once its schedule is over: every timed group has run its full time.
    function test_endDropWaitsForTheLongestGroup() public {
        FireGroups.Group memory a = _g(10);
        a.duration = 72 hours;
        a.rollTo = 1;
        FireGroups.Group memory b = _g(10);
        b.startDelay = 2 hours;
        b.duration = 3 hours;
        b.afterGroup = 0;
        _set(1, _with(_cfg(start, 0), _two(a, b)));
        assertEq(groups.scheduleEnd(1), start + 77 hours, "72h, then 2h later 3h more");
        assertEq(sale.status(1).endableAt, start + 77 hours);
        _warp(start + 76 hours);
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.TooEarly.selector);
        sale.endDrop(1);
        _warp(start + 77 hours);
        vm.prank(owner, owner);
        sale.endDrop(1);
    }

    function test_audit2_buyerNamesTheMostPaper() public {
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.PriceMoved.selector);
        sale.buy(1, 0, 2, FireSale.Pay.PLANK, type(uint256).max, 1e18, _na()); // 2 packs need 2 PAPER
    }

    function test_audit2_feedsReplaceableOnlyBetweenDrops() public {
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropsActive.selector);
        sale.setFeeds(address(ethFeed), address(plankFeed), address(0), address(router));
        _drop(1, start, 4);
        _open();
        _plank(alice, 1, 0, 4);
        MockFeed newEth = new MockFeed(ETH_USD);
        vm.prank(owner, owner);
        sale.setFeeds(address(newEth), address(plankFeed), address(0), address(router));
        assertEq(address(sale.ETH_USD()), address(newEth));
    }

    function test_audit_walletsLockedWhileADropIsSetUp() public {
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropsActive.selector);
        sale.setWallets(address(0x1111), address(0x2222), address(0x3333));
        _drop(1, start, 4);
        _open();
        _plank(alice, 1, 0, 4); // sells out, closes
        assertEq(sale.activeDrops(), 0);
        vm.prank(owner, owner);
        sale.setWallets(address(0x1111), address(0x2222), address(0x3333));
        assertEq(sale.revenueWallet(), address(0x1111));
    }

    /// Only one drop at a time: picks only happen while no drop is running.
    function test_audit_oneDropAtATime() public {
        vm.prank(owner);
        vm.expectRevert(FireSale.AnotherDropActive.selector);
        sale.configureDrop(2, _cfg(uint64(block.timestamp + 365 days), 10));
        _endDrop1();
        _drop(2, uint64(block.timestamp + 1 hours), 10); // the next one, once the first has closed
        assertEq(sale.activeDrops(), 1);
    }

    function test_audit_fireNumberFitsIn64Bits() public {
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.BadConfig.selector);
        sale.configureDrop(uint256(type(uint64).max) + 8, _cfg(start, 10));
        vm.prank(owner, owner);
        vm.expectRevert(FireCards.BadLength.selector);
        cards.setDealer(uint256(type(uint64).max) + 8, address(dealer));
    }

    // ---------------------------------------------------------------- limits

    /// Most packs per purchase is a per-drop setting (default 50).
    function test_maxPerTxIsPerDrop() public {
        _drop(1, start, 300);
        assertEq(sale.dropOf(1).maxPerTx, 50, "default");
        FireSale.DropConfig memory c = _cfg(start, 300);
        c.maxPerTx = 120;
        _set(1, c);
        assertEq(sale.dropOf(1).maxPerTx, 120);
        _open();
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.BadAmount.selector);
        sale.buy(1, 0, 121, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.BadAmount.selector);
        sale.buy(1, 0, 0, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _plank(alice, 1, 0, 120);
        assertEq(packs.balanceOf(alice, 1), 120);
    }

    /// A giant drop: 10,000 packs, 100 per wallet, 100 per purchase. One purchase of 100 costs about what 1 does.
    function test_giantDrop_buy100InOneTx() public {
        FireSale.DropConfig memory c = _cfg(start, 10_000);
        c.maxPerTx = 100;
        c.groups[0].perWallet = 100;
        _set(1, c);
        _open();
        _plank(bob, 1, 0, 1); // warm the counters
        uint256 g = gasleft();
        _plank(alice, 1, 0, 100);
        emit log_named_uint("PLANK, 100 packs", g - gasleft());
        assertEq(packs.balanceOf(alice, 1), 100);
        assertEq(paper.balanceOf(DEAD), 101e18, "1 PAPER a pack");
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.WalletLimit.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        g = gasleft();
        _eth(bob, 1, 0, 99);
        emit log_named_uint("ETH, 99 packs (with PLANK swap)", g - gasleft());
        assertEq(packs.balanceOf(bob, 1), 100);
        _assertHoldsNothing();
    }

    /// A wallet limit in the thousands, matched by maxPerTx.
    function test_bigWalletLimitAndMaxPerTx() public {
        FireSale.DropConfig memory c = _cfg(start, 5_000);
        c.maxPerTx = 2_500;
        c.groups[0].perWallet = 2_500;
        _set(1, c);
        paper.mint(alice, 2_000e18);
        _open();
        _plank(alice, 1, 0, 2_500);
        assertEq(packs.balanceOf(alice, 1), 2_500);
    }

    /// No wallet limit: one wallet can take the whole group.
    function test_noWalletLimit() public {
        _drop(1, start, 100);
        _open();
        _plank(alice, 1, 0, 50);
        _plank(alice, 1, 0, 50);
        assertTrue(sale.status(1).closed, "sold out to one wallet");
    }

    function test_noBotContractsWhileTheRuleIsOn() public {
        _open();
        assertTrue(sale.status(1).regularWalletsOnly);
        vm.prank(alice); // called from a contract: msg.sender isn't the wallet that signed
        vm.expectRevert(FireSale.NoContracts.selector);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        _plank(alice, 1, 0, 1); // a regular wallet
        _warp(start + 48 hours);
        assertFalse(sale.status(1).regularWalletsOnly);
        vm.prank(alice); // after it lifts, anyone
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
    }

    function test_regularWalletsOff() public {
        FireSale.DropConfig memory c = _cfg(start, 20);
        c.regularWalletsFor = 0;
        _set(1, c);
        _open();
        assertFalse(sale.status(1).regularWalletsOnly);
        vm.prank(alice); // a contract call, right at the start
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        assertEq(packs.balanceOf(alice, 1), 1);
    }

    // ---------------------------------------------------------------- burning cards and credits

    function test_burn42_earnsACredit_runningCount() public {
        _aliceGetsCards(9); // 54 cards, serials 1..54
        vm.startPrank(alice, alice);
        credits.burnCards(_ids(1, 3));
        credits.burnCards(_ids(4, 2));
        assertEq(credits.burnCount(alice), 5, "3 one day + 2 the next");
        assertEq(credits.credits(alice), 0);
        credits.burnCards(_ids(6, 45)); // 50 total
        vm.stopPrank();
        assertEq(credits.credits(alice), 1);
        assertEq(credits.burnCount(alice), 8, "extras carry over");
        assertEq(cards.balanceOf(alice), 4);
    }

    function test_cantBurnSomeoneElsesCards() public {
        _aliceGetsCards(1);
        vm.prank(bob, bob);
        vm.expectRevert(FireCards.NotHolder.selector);
        credits.burnCards(_ids(1, 1));
        vm.prank(bob, bob);
        vm.expectRevert(FireCards.NotSeller.selector);
        cards.burnFor(alice, _ids(1, 1));
    }

    function test_creditsStackAndMintForPaperOnly() public {
        _aliceGetsCards(14); // 84 cards
        vm.prank(alice, alice);
        credits.burnCards(_ids(1, 84));
        assertEq(credits.credits(alice), 2);
        // her suggestion gets picked for the next drop: a third credit
        vm.prank(alice, alice);
        uint256 id = credits.suggest("A fox made of embers", type(uint256).max);
        uint64 s2 = uint64(block.timestamp + 1 hours);
        _drop(2, s2, 10);
        uint256[] memory picked = new uint256[](1);
        picked[0] = id;
        vm.prank(owner, owner);
        credits.pickSuggestions(2, picked);
        assertEq(credits.credits(alice), 3, "2 from burning + 1 picked: one pool, any drop");

        vm.prank(alice, alice);
        vm.expectRevert(FireSale.NotLive.selector);
        credits.useCredits(2, 1, type(uint256).max); // no drop live: credits wait

        _warp(s2);
        uint256 deadPaper = paper.balanceOf(DEAD);
        uint256 revBefore = plank.balanceOf(revenue);
        vm.prank(alice, alice);
        credits.useCredits(2, 3, type(uint256).max);
        assertEq(packs.balanceOf(alice, 2), 3);
        assertEq(credits.credits(alice), 0);
        assertEq(paper.balanceOf(DEAD) - deadPaper, 3e18, "1 PAPER each");
        assertEq(plank.balanceOf(revenue), revBefore, "nothing else paid");
        assertEq(sale.status(2).left, 7, "out of the credit group");
        assertEq(_view(2, 0).sold, 3);
        assertEq(sale.dropOf(2).creditPacks, 3);
        vm.prank(alice, alice);
        vm.expectRevert(FireCredits.NoCredits.selector);
        credits.useCredits(2, 1, type(uint256).max);
    }

    /// Cards per free pack credit is fixed forever at 42 (burn progress carries over between Series): no setter.
    function test_cardsPerCreditIsFixedAt42() public {
        assertEq(credits.CARDS_PER_CREDIT(), 42);
        (bool ok,) = address(credits).call(abi.encodeWithSignature("setCardsPerCredit(uint256)", uint256(10)));
        assertFalse(ok, "no setter");
        _aliceGetsCards(7); // 42 cards; fire 1 closes
        vm.prank(alice, alice);
        credits.burnCards(_ids(1, 41));
        assertEq(credits.credits(alice), 0);
        _drop(2, uint64(block.timestamp + 1 hours), 10);
        vm.prank(alice, alice);
        credits.burnCards(_ids(42, 1));
        assertEq(credits.credits(alice), 1);
        assertEq(credits.burnCount(alice), 0);
    }

    /// Alice and bob each get `n` credits (picked suggestions for fire 2's drop, set up with `c`); fire 2 then opens.
    function _creditDrop(FireSale.DropConfig memory c, uint256 n) internal returns (uint64 s2) {
        _aliceGetsCards(14); // closes fire 1
        s2 = uint64(block.timestamp + 1 hours);
        c.start = s2;
        c.creditsPerPick = uint16(n);
        _set(2, c);
        uint256[] memory ids = new uint256[](2);
        vm.prank(alice, alice);
        ids[0] = credits.suggest("Ember Fox", type(uint256).max);
        vm.prank(bob, bob);
        ids[1] = credits.suggest("Ash Wolf", type(uint256).max);
        vm.prank(owner, owner);
        credits.pickSuggestions(2, ids);
        _warp(s2);
    }

    function test_creditPacksTotalCap() public {
        FireSale.DropConfig memory c = _cfg(0, 20);
        c.creditPacksMax = 5;
        _creditDrop(c, 4);
        assertEq(sale.status(2).creditPacksLeft, 5);
        vm.prank(alice, alice);
        credits.useCredits(2, 4, type(uint256).max);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.CreditCapReached.selector);
        credits.useCredits(2, 2, type(uint256).max);
        vm.prank(bob, bob);
        credits.useCredits(2, 1, type(uint256).max);
        assertEq(sale.status(2).creditPacksLeft, 0);
        assertEq(credits.credits(bob), 3, "unused credits wait for another drop");
    }

    function test_creditPacksPerWalletCap() public {
        FireSale.DropConfig memory c = _cfg(0, 20);
        c.creditPacksPerWallet = 2;
        _creditDrop(c, 4);
        vm.prank(alice, alice);
        credits.useCredits(2, 2, type(uint256).max);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.CreditWalletLimit.selector);
        credits.useCredits(2, 1, type(uint256).max);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.CreditWalletLimit.selector);
        credits.useCredits(2, 3, type(uint256).max);
        vm.prank(bob, bob);
        credits.useCredits(2, 2, type(uint256).max);
        assertEq(sale.creditPacksBy(2, alice), 2);
    }

    function test_creditPacksZeroMeansNoLimit() public {
        _creditDrop(_cfg(0, 20), 10);
        assertEq(sale.status(2).creditPacksLeft, 20, "only the supply");
        vm.prank(alice, alice);
        credits.useCredits(2, 10, type(uint256).max);
        vm.prank(bob, bob);
        credits.useCredits(2, 10, type(uint256).max);
        assertTrue(sale.status(2).closed, "credits took the whole drop");
    }

    function test_creditCapsLockAtStart() public {
        FireSale.DropConfig memory c = _cfg(start, 10);
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

    /// Credits come from the credit group while it is open, whatever its gate, price, coins and wallet limit, and
    /// whatever the regular-wallets rule. Before it opens (and after it ends) they wait.
    function test_creditsFromTheCreditGroupOnly() public {
        FireGroups.Group memory press1 = _pressGroup(5, 1);
        press1.duration = 6 hours;
        press1.rollTo = 1;
        FireGroups.Group memory late = _g(10);
        late.coins = 1;
        late.perWallet = 1;
        late.gate = FireGroups.Gate.SNAPSHOT;
        late.root = bytes32(uint256(1)); // nobody can prove into it
        late.afterGroup = 0;
        FireSale.DropConfig memory c = _with(_cfg(0, 0), _two(press1, late));
        c.creditGroup = 1;
        _creditDrop(c, 3);
        assertEq(sale.status(2).creditPacksLeft, 0, "the credit group isn't open yet");
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.GroupNotOpen.selector);
        credits.useCredits(2, 1, type(uint256).max);
        _warp(block.timestamp + 6 hours); // the press group ends; its 5 roll into the credit group
        assertEq(sale.status(2).creditPacksLeft, 15);
        vm.prank(alice, alice);
        credits.useCredits(2, 3, type(uint256).max); // past a wallet limit of 1, no proof, no PLANK
        assertEq(packs.balanceOf(alice, 2), 3);
        assertEq(groups.boughtIn(2, 1, alice), 0, "credit packs don't count toward the group's wallet limit");
    }

    /// A drop with no credit group (255) takes no credits.
    function test_noCreditGroup() public {
        FireSale.DropConfig memory c = _cfg(0, 20);
        c.creditGroup = NONE;
        _creditDrop(c, 2);
        assertEq(sale.status(2).creditPacksLeft, 0);
        vm.prank(alice, alice);
        vm.expectRevert(FireGroups.GroupNotOpen.selector);
        credits.useCredits(2, 1, type(uint256).max);
    }

    /// Credit packs aren't available in a Series whose packs hold 42+ cards (burning one would pay for itself).
    function test_noCreditsInBigPackSeries() public {
        RecipeDealer.CardType[] memory ts = new RecipeDealer.CardType[](1);
        ts[0] = _type("Common", "common", 0, 1);
        _series(cards, dealer, owner, 5, _recipe(ts, 42), 2);
        _endDrop1();
        uint64 s5 = uint64(block.timestamp + 1 hours);
        _set(5, _cfg(s5, 10));
        _warp(s5);
        vm.prank(alice, alice);
        vm.expectRevert(FireCredits.BadConfig.selector);
        credits.useCredits(5, 1, type(uint256).max);
    }

    // ---------------------------------------------------------------- suggestions

    function test_suggestions() public {
        uint256 before = paper.balanceOf(DEAD);
        vm.prank(bob, bob);
        uint256 id = credits.suggest("Captain Kindling", type(uint256).max);
        assertEq(paper.balanceOf(DEAD) - before, 1e18);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(owner, owner);
        credits.pickSuggestions(1, ids);
        assertEq(credits.credits(bob), 1);
        vm.prank(owner, owner);
        vm.expectRevert(FireCredits.AlreadyClaimed.selector);
        credits.pickSuggestions(1, ids); // once each
        vm.prank(bob, bob);
        uint256 id2 = credits.suggest("Ash Wolf", type(uint256).max);
        ids[0] = id2;
        _open();
        vm.prank(owner, owner);
        vm.expectRevert(FireCredits.DropStarted.selector);
        credits.pickSuggestions(1, ids); // only while setting up a drop
        vm.prank(alice, alice);
        vm.expectRevert();
        credits.pickSuggestions(1, ids); // only the owner
    }

    /// The suggestion list clears after every picking session: unpicked suggestions don't carry over.
    function test_suggestionListClearsAfterEachPickingSession() public {
        _drop(1, start, 4);
        vm.startPrank(bob, bob);
        uint256 a = credits.suggest("Ember Fox", type(uint256).max);
        uint256 b = credits.suggest("Ash Wolf", type(uint256).max);
        vm.stopPrank();
        uint256[] memory one = new uint256[](1);
        one[0] = a;
        vm.prank(owner, owner);
        credits.pickSuggestions(1, one); // session for Fire 1: picks from the list a and b are in
        assertEq(credits.currentRound(), 1, "new suggestions now go into a fresh list");
        vm.prank(alice, alice);
        uint256 c = credits.suggest("Cinder Owl", type(uint256).max); // made after the session started: next list

        _open();
        _plank(alice, 1, 0, 4); // drop 1 sells out
        _drop(2, uint64(block.timestamp + 2 hours), 10); // next session, for Fire 2
        one[0] = b;
        vm.prank(owner, owner);
        vm.expectRevert(FireCredits.NotThisRound.selector);
        credits.pickSuggestions(2, one); // b wasn't picked last time: it's gone
        one[0] = c;
        vm.prank(owner, owner);
        credits.pickSuggestions(2, one);
        assertEq(credits.credits(alice), 1);
        assertEq(credits.currentRound(), 2);
    }

    function test_audit_picksCappedByCharacters() public {
        uint256[] memory ids = new uint256[](6);
        for (uint256 i; i < 6; i++) { vm.prank(bob, bob); ids[i] = credits.suggest("x", type(uint256).max); }
        vm.prank(owner, owner);
        vm.expectRevert(FireCredits.BadAmount.selector);
        credits.pickSuggestions(1, ids); // Fire 1 has 3 characters: at most 3 + 2 (theme, art style) picks
        uint256[] memory five = new uint256[](5);
        for (uint256 i; i < 5; i++) five[i] = ids[i];
        vm.prank(owner, owner);
        credits.pickSuggestions(1, five); // every character, the theme and the art style
        assertEq(credits.credits(bob), 5 * 1);
    }

    /// A theme and an art style in one transaction: two suggestions, each picked on its own, 1 PAPER each.
    function test_suggestMany() public {
        string[] memory two = new string[](2);
        two[0] = "Theme: Haunted diner";
        two[1] = "Style: Woodcut print";
        uint256 before = paper.balanceOf(DEAD);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.PriceMoved.selector);
        credits.suggestMany(two, 1e18); // two cost 2 PAPER
        vm.prank(bob, bob);
        uint256 first = credits.suggestMany(two, 2e18);
        assertEq(paper.balanceOf(DEAD) - before, 2e18, "one PAPER each");
        assertEq(credits.suggestionCount(), first + 2);
        (address by,,,) = credits.suggestions(first + 1);
        assertEq(by, bob);
        uint256[] memory one = new uint256[](1);
        one[0] = first + 1;
        vm.prank(owner, owner);
        credits.pickSuggestions(1, one);
        assertEq(credits.credits(bob), 1);
        string[] memory none = new string[](0);
        string[] memory four = new string[](4);
        for (uint256 i; i < 4; i++) four[i] = "x";
        vm.startPrank(bob, bob);
        vm.expectRevert(FireCredits.BadAmount.selector);
        credits.suggestMany(none, type(uint256).max);
        vm.expectRevert(FireCredits.BadAmount.selector);
        credits.suggestMany(four, type(uint256).max);
        two[1] = "";
        vm.expectRevert(FireCredits.BadAmount.selector);
        credits.suggestMany(two, type(uint256).max);
        vm.stopPrank();
    }

    /// The two waves of a Series, as run: the theme and art style wave, then the characters wave, all in one round.
    function test_twoWaves_pickedInOneSession() public {
        string[] memory look = new string[](2);
        look[0] = "Theme: Haunted diner";
        look[1] = "Art style: Woodcut";
        vm.prank(alice, alice);
        uint256 t = credits.suggestMany(look, 2e18);
        uint256[] memory ids = new uint256[](5);
        ids[0] = t;
        ids[1] = t + 1;
        for (uint256 i; i < 3; i++) { vm.prank(bob, bob); ids[2 + i] = credits.suggest("Character: x", 1e18); }
        (,,, uint32 r0) = credits.suggestions(t);
        (,,, uint32 r4) = credits.suggestions(ids[4]);
        assertEq(r0, r4, "both waves in one round");
        vm.prank(owner, owner);
        credits.pickSuggestions(1, ids);
        assertEq(credits.credits(alice), 2);
        assertEq(credits.credits(bob), 3);
        vm.prank(bob, bob);
        uint256 next = credits.suggest("Theme: Space diner", 1e18);
        (,,, uint32 rn) = credits.suggestions(next);
        assertEq(rn, r0 + 1);
    }

    function test_twoWaves_laterCallsSameRound() public {
        uint256[] memory a = new uint256[](3);
        for (uint256 i; i < 3; i++) { vm.prank(bob, bob); a[i] = credits.suggest("x", 1e18); }
        uint256[] memory first = new uint256[](2);
        first[0] = a[0];
        first[1] = a[1];
        vm.prank(owner, owner);
        credits.pickSuggestions(1, first);
        uint256[] memory second = new uint256[](1);
        second[0] = a[2];
        vm.prank(owner, owner);
        credits.pickSuggestions(1, second); // same round: fine
        vm.prank(alice, alice);
        uint256 late = credits.suggest("Character: late", 1e18);
        second[0] = late;
        vm.prank(owner, owner);
        vm.expectRevert(FireCredits.NotThisRound.selector);
        credits.pickSuggestions(1, second);
        assertEq(credits.picksOf(1), 3);
    }

    function test_suggestMany_edges() public {
        string[] memory three = new string[](3);
        three[0] = "a";
        three[1] = "b";
        bytes memory longest = new bytes(280);
        for (uint256 i; i < 280; i++) longest[i] = "z";
        three[2] = string(longest);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.PriceMoved.selector);
        credits.suggestMany(three, 3e18 - 1);
        vm.prank(bob, bob);
        uint256 first = credits.suggestMany(three, 3e18);
        (address by,,, uint32 r) = credits.suggestions(first + 2);
        assertEq(by, bob);
        assertEq(r, credits.currentRound());
        three[2] = string(abi.encodePacked(longest, "z"));
        uint256 count = credits.suggestionCount();
        uint256 bal = paper.balanceOf(bob);
        vm.prank(bob, bob);
        vm.expectRevert(FireCredits.BadAmount.selector);
        credits.suggestMany(three, type(uint256).max);
        assertEq(credits.suggestionCount(), count);
        assertEq(paper.balanceOf(bob), bal);
        three[2] = "c";
        vm.prank(owner, owner);
        sale.setPaused(true);
        vm.prank(bob, bob);
        vm.expectRevert();
        credits.suggestMany(three, type(uint256).max);
    }

    function test_pick_sameIdTwiceRefused() public {
        vm.prank(bob, bob);
        uint256 id = credits.suggest("x", 1e18);
        uint256[] memory ids = new uint256[](2);
        ids[0] = id;
        ids[1] = id;
        vm.prank(owner, owner);
        vm.expectRevert(FireCredits.AlreadyClaimed.selector);
        credits.pickSuggestions(1, ids);
    }

    /// Credits per picked suggestion is per drop: 3 each, or none.
    function test_creditsPerPick() public {
        FireSale.DropConfig memory c = _cfg(start, 20);
        c.creditsPerPick = 3;
        _set(1, c);
        vm.prank(bob, bob);
        uint256 id = credits.suggest("Ember Fox", type(uint256).max);
        vm.prank(alice, alice);
        uint256 id2 = credits.suggest("Ash Wolf", type(uint256).max);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(owner, owner);
        credits.pickSuggestions(1, ids);
        assertEq(credits.credits(bob), 3);
        c.creditsPerPick = 0;
        _set(1, c);
        ids[0] = id2;
        vm.prank(owner, owner);
        credits.pickSuggestions(1, ids);
        assertEq(credits.credits(alice), 0, "picked, no credit");
    }

    /// The suggestion cost and length are owner settings (any cost, 0 included); suggesters name their most PAPER.
    function test_suggestionRules() public {
        assertEq(credits.suggestionPaper(), 1e18);
        vm.prank(alice, alice);
        vm.expectRevert();
        credits.setSuggestionRules(0, 280);
        vm.prank(owner, owner);
        credits.setSuggestionRules(0, 10);
        vm.prank(bob, bob);
        credits.suggest("Ember Fox", 0); // free
        assertEq(paper.balanceOf(DEAD), 0);
        vm.prank(bob, bob);
        vm.expectRevert(FireCredits.BadAmount.selector);
        credits.suggest("Captain Kindling", 0); // 16 bytes > 10
        vm.prank(owner, owner);
        credits.setSuggestionRules(5e18, 280);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.PriceMoved.selector);
        credits.suggest("Ash Wolf", 1e18);
        vm.prank(bob, bob);
        credits.suggest("Ash Wolf", 5e18);
        assertEq(paper.balanceOf(DEAD), 5e18);
        vm.startPrank(owner, owner);
        vm.expectRevert(FireCredits.BadConfig.selector);
        credits.setSuggestionRules(0, 0);
        vm.expectRevert(FireCredits.BadConfig.selector);
        credits.setSuggestionRules(0, 1_025);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- gas

    function test_gas() public {
        _drop(1, start, 100);
        _open();
        _plank(bob, 1, 0, 1); // warm the counters
        uint256 g = gasleft();
        _plank(alice, 1, 0, 1);
        emit log_named_uint("PLANK, 1 pack", g - gasleft());
        g = gasleft();
        _plank(alice, 1, 0, 5);
        emit log_named_uint("PLANK, 5 packs", g - gasleft());
        g = gasleft();
        _eth(bob, 1, 0, 1);
        emit log_named_uint("ETH, 1 pack (with PLANK swap)", g - gasleft());
        g = gasleft();
        _eth(bob, 1, 0, 5);
        emit log_named_uint("ETH, 5 packs (with PLANK swap)", g - gasleft());
    }

    /// The Standard drop's worst case: three groups (press, PLANK snapshot, everyone) to work out on every buy.
    function test_gas_standardGroups() public {
        bytes32 root = _pair(_leaf(alice, 5), _leaf(bob, 5));
        FireGroups.Group memory p = _pressGroup(50, 1);
        p.duration = 6 hours;
        p.rollTo = 2;
        FireGroups.Group memory s = _snapGroup(40, root);
        s.coins = 1;
        s.perWallet = 5;
        s.duration = 24 hours;
        s.rollTo = 2;
        FireGroups.Group memory e = _g(77);
        e.perWallet = 5;
        e.afterGroup = 1;
        _set(1, _with(_cfg(start, 0), _three(p, s, e)));
        uint256 pid = press.mint(carol);
        _open();
        uint256 g = gasleft();
        vm.prank(carol, carol);
        sale.buy(1, 0, 1, FireSale.Pay.PLANK, 0, type(uint256).max, _nfts(pid));
        emit log_named_uint("press group, 1 pack (NFT gate, PAPER only)", g - gasleft());
        g = gasleft();
        vm.prank(alice, alice);
        sale.buy(1, 1, 5, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(5, _leaf(bob, 5)));
        emit log_named_uint("snapshot group, 5 packs in PLANK", g - gasleft());
        g = gasleft();
        vm.prank(bob, bob);
        sale.buy(1, 1, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _proof(5, _leaf(alice, 5)));
        emit log_named_uint("snapshot group, 1 pack in PLANK", g - gasleft());
    }

    // ---------------------------------------------------------------- PAPER and its dollar ceiling

    /// Ends drop 1 and sets a PAPER/USD feed at `px` (18 decimals) for the next drops.
    function _paperFeed(int256 px) internal returns (MockFeed f) {
        f = new MockFeed(px);
        f.setDecimals(18);
        _endDrop1();
        vm.prank(owner, owner);
        sale.setFeeds(address(ethFeed), address(plankFeed), address(f), address(router));
    }

    /// With a $1 ceiling, a pack's PAPER never costs more than $1: past $1 a PAPER it takes $1 worth (part of a PAPER).
    function test_packPaperCappedAtOneDollar() public {
        MockFeed paperUsd = _paperFeed(5e18); // PAPER at $5
        uint64 s3 = uint64(block.timestamp + 1 hours);
        _set(2, _cfg(s3, 10));
        _warp(s3);
        paperUsd.set(5e18);
        assertEq(sale.paperFor(2, 0, 1), 0.2e18, "$1 of PAPER at $5");
        uint256 before = paper.balanceOf(alice);
        vm.prank(alice, alice);
        sale.buy(2, 0, 3, FireSale.Pay.PLANK, type(uint256).max, 0.6e18, _na());
        assertEq(before - paper.balanceOf(alice), 0.6e18);
        paperUsd.set(0.08e18);
        assertEq(sale.paperFor(2, 0, 2), 2e18, "under $1 a PAPER: the full PAPER");
        paperUsd.setBroken(true);
        assertEq(sale.lastPaperUsd(), 5e18, "the last good price a buy saw");
        assertEq(sale.paperFor(2, 0, 2), 0.4e18, "no price: the last price holds, never back to an uncapped pack");
        _warp(s3 + 72 hours);
        vm.prank(owner, owner);
        sale.endDrop(2);
        vm.prank(owner, owner);
        sale.setFeeds(address(ethFeed), address(plankFeed), address(0), address(router));
        assertEq(sale.lastPaperUsd(), 0, "a new PAPER feed (or none) starts without the old price");
    }

    /// The PAPER dollar ceiling is per drop and applies to every group and to credit packs alike.
    function test_paperCeilingPerDrop() public {
        MockFeed f = _paperFeed(2e18); // PAPER at $2
        uint64 s2 = uint64(block.timestamp + 1 hours);
        FireGroups.Group memory pg = _pressGroup(3, 1);
        pg.paper = 3e18; // $6 worth
        FireGroups.Group memory open_ = _g(10); // 1 PAPER, $2 worth
        FireSale.DropConfig memory c = _with(_cfg(s2, 0), _two(pg, open_));
        c.paperCapUsd = 50_000_000; // $0.50
        c.creditsPerPick = 2;
        c.creditGroup = 1;
        _set(2, c);
        vm.prank(bob, bob);
        uint256 id = credits.suggest("Ember Fox", type(uint256).max);
        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        vm.prank(owner, owner);
        credits.pickSuggestions(2, ids);
        uint256 p1 = press.mint(alice);
        _warp(s2);
        f.set(2e18);
        assertEq(sale.paperFor(2, 1, 1), 0.25e18, "$0.50 of PAPER at $2");
        (, uint256 pp) = sale.quote(2, 0, 1, FireSale.Pay.PLANK);
        assertEq(pp, 0.25e18, "press packs too");
        uint256 dead = paper.balanceOf(DEAD);
        vm.prank(alice, alice);
        sale.buy(2, 1, 2, FireSale.Pay.PLANK, type(uint256).max, 0.5e18, _na());
        assertEq(paper.balanceOf(DEAD) - dead, 0.5e18, "paid packs");
        vm.prank(alice, alice);
        sale.buy(2, 0, 1, FireSale.Pay.PLANK, 0, 0.25e18, _nfts(p1));
        assertEq(paper.balanceOf(DEAD) - dead, 0.75e18, "press packs");
        vm.prank(bob, bob);
        credits.useCredits(2, 2, 0.5e18);
        assertEq(paper.balanceOf(DEAD) - dead, 1.25e18, "credit packs");
        f.set(0.1e18); // PAPER at $0.10: the full PAPER is under the ceiling
        assertEq(sale.paperFor(2, 1, 1), 1e18);
        (, pp) = sale.quote(2, 0, 1, FireSale.Pay.PLANK);
        assertEq(pp, 3e18);
        f.setBroken(true); // feed late: the last good price ($2, from the last buy) holds
        assertEq(sale.lastPaperUsd(), 2e18);
        assertEq(sale.paperFor(2, 1, 1), 0.25e18);

        // the next drop has no ceiling: the full PAPER whatever its price
        f.setBroken(false);
        _warp(s2 + 72 hours);
        vm.prank(owner, owner);
        sale.endDrop(2);
        uint64 s3 = uint64(block.timestamp + 1 hours);
        _configureCards(3);
        c = _cfg(s3, 10);
        c.paperCapUsd = 0;
        _set(3, c);
        _warp(s3);
        f.set(50e18);
        assertEq(sale.paperFor(3, 0, 2), 2e18, "no ceiling");
        assertEq(sale.dropOf(3).paperCapUsd, 0);
    }

    /// With no PAPER price ever seen, packs take the set PAPER (there is nothing to measure the ceiling with).
    function test_paperCeilingWithoutAPrice() public view {
        assertEq(sale.lastPaperUsd(), 0);
        assertEq(sale.paperFor(1, 0, 3), 3e18);
    }

    /// PAPER per pack can be 0 (a dollar price only).
    function test_paperPerPackZero() public {
        FireSale.DropConfig memory c = _cfg(start, 20);
        c.groups[0].paper = 0;
        _set(1, c);
        _open();
        vm.prank(alice, alice);
        sale.buy(1, 0, 2, FireSale.Pay.PLANK, type(uint256).max, 0, _na());
        assertEq(paper.balanceOf(DEAD), 0);
        assertEq(packs.balanceOf(alice, 1), 2);
    }

    /// Suggestions keep their own $1 ceiling.
    function test_suggestionPaperCappedAtOneDollar() public {
        MockFeed f = _paperFeed(4e18); // PAPER at $4
        vm.prank(owner, owner);
        credits.setSuggestionRules(3e18, 280);
        f.set(4e18);
        uint256 dead = paper.balanceOf(DEAD);
        vm.prank(bob, bob);
        vm.expectRevert(FireSale.PriceMoved.selector);
        credits.suggest("Ember Fox", 0.24e18);
        vm.prank(bob, bob);
        credits.suggest("Ember Fox", 0.25e18);
        assertEq(paper.balanceOf(DEAD) - dead, 0.25e18, "$1 at $4, not 3 PAPER");
    }

    function test_audit8_lopsidedPaperPoolCantZeroPackPaper() public {
        _warp(start + 72 hours);
        MockFactory f = new MockFactory();
        MockFeed eth2 = new MockFeed(2_500_00000000);
        PaperUsdTwap ptwap = new PaperUsdTwap(address(f), address(paper), address(0xE7), address(usdg), 6, address(eth2), address(0), address(0));
        CumPair p = new CumPair(address(usdg), address(paper));
        p.set(11e6, 1); // $11 of USDG against 1 wei of PAPER
        f.add(address(paper), address(usdg), address(p));
        ptwap.checkpoint();
        vm.warp(block.timestamp + 21 hours); eth2.set(2_500_00000000); ptwap.checkpoint();
        vm.warp(block.timestamp + 21 hours); eth2.set(2_500_00000000); ptwap.checkpoint();
        assertEq(address(ptwap.pair()), address(0), "never adopted");
        (, int256 px,,,) = ptwap.latestRoundData();
        assertEq(px, 0, "no price");
        _warp(block.timestamp);
        vm.prank(owner, owner);
        sale.endDrop(1);
        vm.prank(owner, owner);
        sale.setFeeds(address(ethFeed), address(plankFeed), address(ptwap), address(router));
        uint64 s2 = uint64(block.timestamp + 1 hours);
        _set(2, _cfg(s2, 20));
        _warp(s2);
        eth2.set(2_500_00000000);
        assertEq(sale.paperFor(2, 0, 5), 5e18, "5 packs burn 5 PAPER");
        p.set(11e6, 1_000e18);
        ptwap.checkpoint();
        vm.warp(block.timestamp + 21 hours); eth2.set(2_500_00000000); ptwap.checkpoint();
        assertEq(address(ptwap.pair()), address(p), "adopted");
        vm.warp(block.timestamp + 21 hours); eth2.set(2_500_00000000); ptwap.checkpoint();
        (, px,,,) = ptwap.latestRoundData();
        assertApproxEqRel(uint256(px), 0.011e18, 1e15);
        _warp(block.timestamp);
        assertEq(sale.paperFor(2, 0, 5), 5e18, "still the group's PAPER per pack");
    }

    // ---------------------------------------------------------------- the Series lock and the config event

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

    event DropConfigured(uint256 indexed fire, FireSale.DropConfig config);

    /// The event carries the whole config, with the per-transaction cap that applies (0 means the default).
    function test_dropConfiguredEventShowsTheAppliedCap() public {
        FireSale.DropConfig memory c = _cfg(uint64(block.timestamp + 30 minutes), 10);
        FireSale.DropConfig memory e = _cfg(uint64(block.timestamp + 30 minutes), 10);
        e.maxPerTx = uint32(sale.DEFAULT_MAX_PER_TX());
        vm.expectEmit(address(sale));
        emit DropConfigured(1, e);
        _set(1, c);
    }

    /// Every setting locks at the drop's start like the rest.
    function test_newSettingsLockAtStart() public {
        _open();
        FireSale.DropConfig memory c = _cfg(uint64(block.timestamp + 1 hours), 13);
        c.groups[0].perWallet = 5;
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.DropStarted.selector);
        sale.configureDrop(1, c);
        assertEq(groups.groupOf(1, 0).perWallet, 0);
    }

    // ---------------------------------------------------------------- pause

    /// Pause stops buying, credit spending and paid suggestions. Never ending or closing a drop, burning cards,
    /// opening or dealing.
    function test_pauseBlocksBuyingOnly() public {
        _aliceGetsCards(14); // drop 1 sold out and dealt: 84 cards
        uint64 s2 = uint64(block.timestamp + 1 hours);
        _set(2, _cfg(s2, 10));
        vm.prank(alice, alice);
        credits.burnCards(_ids(1, 42)); // a credit
        _warp(s2);

        vm.prank(alice, alice);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", alice));
        sale.setPaused(true);
        vm.expectEmit(address(sale));
        emit FireSale.PausedSet(true);
        vm.prank(owner, owner);
        sale.setPaused(true);
        assertTrue(sale.status(2).paused);

        vm.startPrank(alice, alice);
        vm.expectRevert(FireSale.IsPaused.selector);
        sale.buy(2, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        vm.expectRevert(FireSale.IsPaused.selector);
        sale.buy{value: 1 ether}(2, 0, 1, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        vm.expectRevert(FireSale.IsPaused.selector);
        sale.buy(2, 0, 1, FireSale.Pay.USDG, type(uint256).max, type(uint256).max, _na());
        vm.expectRevert(FireSale.IsPaused.selector);
        sale.buyWithEthAll{value: 1 ether}(2, 0, 1, _na());
        vm.expectRevert(FireSale.IsPaused.selector);
        credits.useCredits(2, 1, type(uint256).max);
        vm.expectRevert(FireSale.IsPaused.selector);
        credits.suggest("Ember Fox", type(uint256).max);
        credits.burnCards(_ids(43, 1)); // never paused: burning cards, transfers
        cards.transferFrom(alice, bob, 44);
        vm.stopPrank();
        assertEq(credits.burnCount(alice), 1);

        _warp(s2 + 72 hours);
        vm.prank(owner, owner);
        sale.endDrop(2); // ending a drop never pauses either
        assertTrue(sale.status(2).closed);
        vm.prank(owner, owner);
        sale.setPaused(false);
        assertFalse(sale.paused());
    }

    /// While paused, a sold-out drop still closes and its packs still open.
    function test_pauseNeverBlocksOpeningOrClosing() public {
        _drop(1, start, 2);
        _open();
        _plank(alice, 1, 0, 2); // sells out, closes
        vm.prank(owner, owner);
        sale.setPaused(true);
        vm.prank(alice, alice);
        cards.open(1, 2);
        rng.fulfill(rng.last(), 5);
        cards.process(1, type(uint256).max);
        assertEq(cards.balanceOf(alice), 12);
    }

    /// The credit hooks answer FireCredits only.
    function test_creditHooksOnlyFromFireCredits() public {
        _open();
        vm.startPrank(alice, alice);
        vm.expectRevert(FireSale.NotCredits.selector);
        sale.creditPacks(alice, 1, 1, type(uint256).max);
        vm.expectRevert(FireSale.NotCredits.selector);
        sale.burnPaperFor(bob, 1e18, 0, type(uint256).max);
        vm.expectRevert(FireSale.NotCredits.selector);
        sale.burnCardsFor(bob, _ids(1, 1));
        vm.stopPrank();
        vm.prank(owner, owner);
        vm.expectRevert(FireCredits.AlreadySet.selector);
        credits.setSale(address(sale));
    }

    function test_renounceOwnershipReverts() public {
        vm.prank(owner, owner);
        vm.expectRevert(FireSale.RenounceDisabled.selector);
        sale.renounceOwnership();
        vm.prank(owner, owner);
        vm.expectRevert(FireCredits.RenounceDisabled.selector);
        credits.renounceOwnership();
        assertEq(sale.owner(), owner);
        assertEq(credits.owner(), owner);
    }

    // ---------------------------------------------------------------- the PLANK price refresh

    /// Every buy also checkpoints the PLANK price (the real PlankUsdTwap; a no-op when not due). That keeps it fresh
    /// while buys or the keeper come at least every 2 hours, but it can't heal a longer gap: the checkpoint it makes
    /// then spans more than PLANK_WINDOW_MAX, so the PLANK buy still reverts (taking its checkpoint with it), and
    /// a PLANK-only group can't sell until someone checkpoints twice, 30 minutes apart (the keeper's job; pre-testnet
    /// audit L-1).
    function test_buysRefreshThePlankPrice() public {
        CumPair pair = new CumPair(address(plank), address(0xE7));
        pair.set(88_700_000_000_000e18, 28.1e18);
        PlankUsdTwap twap = new PlankUsdTwap(address(pair), address(plank), address(ethFeed));
        _endDrop1();
        vm.warp(block.timestamp + 1 hours); ethFeed.set(ETH_USD);
        twap.checkpoint();
        vm.warp(block.timestamp + 30 minutes); ethFeed.set(ETH_USD);
        twap.checkpoint(); // the keeper: a 30-minute window
        vm.prank(owner, owner);
        sale.setFeeds(address(ethFeed), address(twap), address(0), address(router));
        uint64 s2 = uint64(block.timestamp + 1 hours);
        FireSale.DropConfig memory c = _cfg(s2, 20);
        c.groups[0].coins = 1; // PLANK only
        _set(2, c);
        vm.warp(s2 + 50 minutes); ethFeed.set(ETH_USD); // 1h50 since the keeper's last checkpoint
        assertTrue(sale.status(2).plankPriceOk);
        _plank(alice, 2, 0, 1);
        (, uint32 lastTs) = twap.last();
        assertEq(lastTs, block.timestamp, "the buy checkpointed");
        vm.warp(block.timestamp + 1 hours + 50 minutes); ethFeed.set(ETH_USD); // keeper still away: 3h40 in all
        assertTrue(sale.status(2).plankPriceOk, "kept fresh by the last buy");
        _plank(alice, 2, 0, 1);
        assertEq(packs.balanceOf(alice, 2), 2);

        vm.warp(block.timestamp + 3 hours); ethFeed.set(ETH_USD); // nobody for 3 hours
        assertFalse(sale.status(2).plankPriceOk);
        vm.prank(alice, alice);
        vm.expectRevert(FireSale.FeedUnavailable.selector);
        sale.buy(2, 0, 1, FireSale.Pay.PLANK, type(uint256).max, type(uint256).max, _na());
        twap.checkpoint(); // one checkpoint makes a window longer than 2h: still not a usable price
        assertFalse(sale.status(2).plankPriceOk, "needs a second checkpoint 30 minutes later");
        vm.warp(block.timestamp + 30 minutes); ethFeed.set(ETH_USD);
        twap.checkpoint();
        assertTrue(sale.status(2).plankPriceOk);
        _plank(alice, 2, 0, 1);
        assertEq(packs.balanceOf(alice, 2), 3);
    }

    /// A PLANK checkpoint that fails inside a buy never blocks it: the ETH buy still sells, the burn share waits.
    function test_aFailingPlankCheckpointNeverBlocksABuy() public {
        CheckpointFeed twap = new CheckpointFeed(PLANK_USD);
        _endDrop1();
        vm.prank(owner, owner);
        sale.setFeeds(address(ethFeed), address(twap), address(0), address(router));
        uint64 s2 = uint64(block.timestamp + 1 hours);
        _set(2, _cfg(s2, 20));
        vm.warp(s2 + 1 hours);
        ethFeed.set(ETH_USD);
        twap.setFail(true);
        uint256 cost = _cost(2, 0, 1, FireSale.Pay.ETH);
        _eth(alice, 2, 0, 1); // still sells; the burn share waits
        assertEq(twap.checkpoints(), 0);
        assertEq(burnW.balance, cost * 3_000 / 10_000, "to PlankBurner");
        assertEq(packs.balanceOf(alice, 2), 1);
    }

    // ---------------------------------------------------------------- the studio's JSON

    /// The studio's sample export (recipe.json with a "sale" block, written by studio/scripts/sale-sample.test.ts)
    /// goes through ConfigureSeries into the recipe calls and FireSale.configureDrop, and the drop comes out as the
    /// studio set it: the Standard preset (167 packs in three groups, and an unlimited "After sell-out" group with a
    /// rising tax on top, which ends 15 minutes after its last sale).
    function test_studioSaleExportConfiguresTheDrop() public {
        _endDrop1(); // one drop at a time
        _warp(1_800_000_000); // the export's start is a few months on from here
        vm.setEnv("MILL", vm.toString(address(press))); // "nft": "press"
        ConfigureSeries cs = new ConfigureSeries();
        string memory json = vm.readFile("test/cards/recipe-studio-sale.json");
        ConfigureSeries.Call[] memory calls = cs.buildAll(json, address(dealer), address(cards), address(sale), 200);
        assertEq(calls.length, 5, "recipe, characters, dealer, images, configureDrop");
        assertEq(calls[4].what, "FireSale.configureDrop");
        assertEq(cs.build(json, address(dealer), address(cards), 200).length, 4, "build leaves the sale out");
        vm.startPrank(owner, owner);
        for (uint256 i; i < calls.length; i++) {
            (bool ok,) = calls[i].to.call(calls[i].data);
            assertTrue(ok, calls[i].what);
        }
        vm.stopPrank();
        FireSale.Drop memory d = sale.dropOf(7);
        assertEq(d.start, 1_810_000_000);
        assertEq(d.packs, 167, "the base Series; the unlimited group adds on top");
        assertEq(d.regularWalletsFor, 48 hours);
        assertEq(d.maxPerTx, 50);
        assertEq(d.plankBurnBps, 1_000);
        assertEq(d.paperBurnBps, 2_000);
        assertEq(d.paperCapUsd, 100_000_000);
        assertEq(d.creditsPerPick, 1);
        assertEq(d.creditPacksMax, 16);
        assertEq(d.creditPacksPerWallet, 3);
        assertEq(d.creditGroup, 2);
        FireGroups.GroupView[] memory v = groups.groupsOf(7);
        assertEq(v.length, 4);
        // 1. Paper Press holders: 50, 1 PAPER, 1 per press, opens with the drop, up to 6h, leftovers to group 3
        assertEq(v[0].config.packs, 50);
        assertEq(uint8(v[0].config.gate), uint8(FireGroups.Gate.NFT));
        assertEq(v[0].config.nft, address(press));
        assertEq(v[0].config.perNft, 1);
        assertEq(v[0].config.priceUsd, 0);
        assertEq(v[0].config.paper, 1e18);
        assertEq(v[0].config.afterGroup, NONE);
        assertEq(v[0].config.duration, 6 hours);
        assertEq(v[0].config.rollTo, 2);
        // 2. PLANK holders: 40, $2.50 + 1 PAPER, PLANK only, 5 per wallet, up to 24h, leftovers to group 3
        assertEq(v[1].config.packs, 40);
        assertEq(uint8(v[1].config.gate), uint8(FireGroups.Gate.SNAPSHOT));
        assertEq(v[1].config.root, bytes32(0xabababababababababababababababababababababababababababababababab));
        assertEq(v[1].config.priceUsd, 250_000_000);
        assertEq(v[1].config.coins, 1);
        assertEq(v[1].config.perWallet, 5);
        assertEq(v[1].config.duration, 24 hours);
        assertEq(v[1].config.rollTo, 2);
        // 3. Everyone: 77 (+ leftovers), $2.50 + 1 PAPER, any coin, 5 per wallet, after group 2, until sold
        assertEq(v[2].config.packs, 77);
        assertEq(uint8(v[2].config.gate), uint8(FireGroups.Gate.OPEN));
        assertEq(v[2].config.coins, 7);
        assertEq(v[2].config.perWallet, 5);
        assertEq(v[2].config.afterGroup, 1);
        assertEq(v[2].config.duration, 0);
        assertEq(v[2].config.rollTo, NONE);
        assertEq(v[2].opensAt, 1_810_000_000 + 24 hours, "at the latest");
        // 4. After sell-out: unlimited, $2.50 rising 4% a pack + 1 PAPER, ETH only, 1 per purchase, when group 3 sells
        //    out, until 15 minutes pass with no sale
        assertTrue(v[3].config.unlimited);
        assertEq(v[3].config.packs, 0);
        assertEq(v[3].capacity, type(uint256).max);
        assertEq(uint8(v[3].config.gate), uint8(FireGroups.Gate.OPEN));
        assertEq(v[3].config.taxBps, 400);
        assertEq(v[3].config.coins, 2);
        assertEq(v[3].config.perWallet, 0);
        assertEq(v[3].config.afterGroup, 2);
        assertEq(v[3].config.duration, 0);
        assertEq(v[3].config.idle, 15 minutes, "ends 15 minutes after its last sale");
        assertEq(v[3].config.perTx, 1, "one pack per purchase");
        assertEq(v[2].config.idle, 0);
        assertEq(v[2].config.perTx, 0);
        assertEq(v[3].config.rollTo, NONE);
        assertEq(v[3].opensAt, 0, "when Everyone sells out");
        assertEq(groups.scheduleEnd(7), 1_810_000_000 + 24 hours, "until the unlimited group opens");

        // DROP_START and GROUP_ROOT_<i> override the block's start and a snapshot group's root
        vm.setEnv("DROP_START", "1810000123");
        vm.setEnv("GROUP_ROOT_1", "0x0000000000000000000000000000000000000000000000000000000000000001");
        FireSale.DropConfig memory c = cs.parseSale(json);
        assertEq(c.start, 1_810_000_123);
        assertEq(c.groups[1].root, bytes32(uint256(1)));
        vm.setEnv("GROUP_ROOT_1", "0x0000000000000000000000000000000000000000000000000000000000000000");
        // a misspelt field is refused by name, not read as 0
        vm.expectRevert(bytes(".sale: unknown key creditPacksMx"));
        cs.parseSale(vm.replace(json, '"creditPacksMax"', '"creditPacksMx"'));
        vm.expectRevert(bytes(".sale.groups[0]: unknown key perNfts"));
        cs.parseSale(vm.replace(json, '"perNft"', '"perNfts"'));
        // a start more than a year away is refused
        vm.setEnv("DROP_START", "1900000123");
        vm.expectRevert(bytes("sale.start is more than a year away: a typo?"));
        cs.parseSale(json);
        vm.setEnv("DROP_START", "1810000000");
    }

    /// The JSON is checked group by group, with the reason by name, before anything is sent.
    function test_studioSaleExportRefusesBadGroups() public {
        vm.setEnv("MILL", vm.toString(address(press)));
        vm.setEnv("DROP_START", "1810000000");
        ConfigureSeries cs = new ConfigureSeries();
        string memory json = vm.readFile("test/cards/recipe-studio-sale.json");
        cs.parseSale(json);
        vm.expectRevert(bytes("sale.groups: the groups' packs add up to 168, not sale.packs (167; unlimited groups count 0)"));
        cs.parseSale(vm.replace(json, '"packs": 77', '"packs": 78'));
        vm.expectRevert(bytes(".sale.groups[2].afterGroup: an earlier group's index, or 255 to open with the drop"));
        cs.parseSale(vm.replace(json, '"afterGroup": 1', '"afterGroup": 2'));
        vm.expectRevert(bytes(".sale.groups[0].rollTo: a later group's index, or 255 for nowhere"));
        cs.parseSale(vm.replace(json, '"rollTo": 2\n   },\n   {\n    "name": "PLANK', '"rollTo": 0\n   },\n   {\n    "name": "PLANK'));
        vm.expectRevert(bytes(".sale.groups[1].gate: open, nft or snapshot"));
        cs.parseSale(vm.replace(json, '"gate": "snapshot"', '"gate": "holders"'));
        vm.expectRevert(bytes(".sale.groups[1].root is missing: set GROUP_ROOT_1 (the snapshot from ops/snapshot)"));
        cs.parseSale(vm.replace(json, '"0xabababababababababababababababababababababababababababababababab"', '"0x0000000000000000000000000000000000000000000000000000000000000000"'));
        vm.expectRevert(bytes(".sale.groups[2].coins: a dollar price needs a coin (PLANK 1 + ETH 2 + USDG 4)"));
        cs.parseSale(vm.replace(json, '"coins": 7', '"coins": 0'));
        vm.expectRevert(bytes(".sale.groups[2].coins is too big for its field (most 7)"));
        cs.parseSale(vm.replace(json, '"coins": 7', '"coins": 8'));
        vm.expectRevert(bytes(".sale.groups[0].duration is too big for its field (most 2592000)"));
        cs.parseSale(vm.replace(json, '"duration": 21600', '"duration": 2592001'));
        vm.expectRevert(bytes("sale.creditGroup: the index of a group (0 is the first), or 255 for no credit packs"));
        cs.parseSale(vm.replace(json, '"creditGroup": 2', '"creditGroup": 4'));
        vm.expectRevert(bytes(".sale.groups[2].rollTo: a group with a rising tax (taxBps) takes no leftovers"));
        cs.parseSale(vm.replace(json, '"rollTo": 255\n   },\n   {\n    "name": "After', '"rollTo": 3\n   },\n   {\n    "name": "After'));
        vm.expectRevert(bytes(".sale.groups[3].unlimited: needs taxBps (the rising price caps demand) and idle (so it always ends)"));
        cs.parseSale(vm.replace(json, '"idle": 900', '"idle": 0'));
        vm.expectRevert(bytes(".sale.groups[3].unlimited: needs taxBps (the rising price caps demand) and idle (so it always ends)"));
        cs.parseSale(vm.replace(json, '"taxBps": 400', '"taxBps": 0'));
        vm.expectRevert(bytes(".sale.groups[3].packs: 0 for an unlimited group (it has no pack count; it adds on top of sale.packs)"));
        cs.parseSale(vm.replace(vm.replace(json, '"packs": 0', '"packs": 5'), '"packs": 167', '"packs": 172'));
        vm.expectRevert(bytes(".sale.groups[3].idle is too big for its field (most 2592000)"));
        cs.parseSale(vm.replace(json, '"idle": 900', '"idle": 2592001'));
        vm.expectRevert(bytes(".sale.groups[3].taxBps is too big for its field (most 5000)"));
        cs.parseSale(vm.replace(json, '"taxBps": 400', '"taxBps": 5001'));
        vm.expectRevert(bytes(".sale.groups[2]: nft and perNft are for gate nft only"));
        cs.parseSale(vm.replace(json, '"gate": "open",', '"gate": "open", "perNft": 1,'));
    }
}
