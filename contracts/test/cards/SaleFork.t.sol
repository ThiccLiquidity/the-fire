// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FireSale} from "../../src/cards/FireSale.sol";
import {FireCredits} from "../../src/cards/FireCredits.sol";
import {FireGroups} from "../../src/cards/FireGroups.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {PlankUsdTwap} from "../../src/PlankUsdTwap.sol";
import {MockERC20} from "../Mocks.sol";

/// Gas and the real PLANK swap, on a copy of Robinhood Chain. Skipped unless FORK_RPC is set:
///   $env:FORK_RPC = "https://rpc.mainnet.chain.robinhood.com"   (PowerShell)
///   forge test --match-path test/cards/SaleFork.t.sol -vv
/// Uses the real PLANK, WETH, Uniswap V2 router and pair, and Chainlink ETH/USD; a stand-in PAPER.
contract SaleForkTest is Test {
    function _na() internal pure returns (FireGroups.Access memory a) {}


    address constant PLANK = 0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant ROUTER = 0x89e5DB8B5aA49aA85AC63f691524311AEB649eba;
    address constant PAIR = 0x01b1BEf6fBA02c846eA5c4Ff59193988B5f86F73;
    address constant ETH_USD = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function test_fork_ethBuyBurnsRealPlank() public {
        string memory rpc = vm.envOr("FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        PlankUsdTwap twap = new PlankUsdTwap(PAIR, PLANK, ETH_USD);
        vm.warp(block.timestamp + 31 minutes);
        twap.checkpoint();

        MockERC20 paper = new MockERC20("PAPER", "PAPER");
        FirePacks packs = new FirePacks(address(this));
        FireCards cards = new FireCards(address(this), address(packs));
        FireCredits credits = new FireCredits(address(this), address(cards), 1e18);
        FireGroups groups = new FireGroups();
        FireSale sale = new FireSale(FireSale.Config({
            owner: address(this), paper: address(paper), plank: PLANK, usdg: address(0), weth: WETH,
            packs: address(packs), cards: address(cards), ethUsd: ETH_USD, plankUsd: address(twap), paperUsd: address(0), router: ROUTER,
            revenueWallet: address(0xBEEF), plankBurner: address(0xB0B), paperBurner: address(0xBA9E5), credits: address(credits),
            groups: address(groups)
        }));
        groups.setSale(address(sale));
        packs.setSeller(address(sale));
        packs.setCards(address(cards));
        cards.setSeller(address(sale));
        credits.setSale(address(sale));
        string[] memory names = new string[](1);
        string[] memory cats = new string[](1);
        for (uint256 k; k < cats.length; k++) cats[k] = "Person";
        names[0] = "Test";
        RecipeDealer dealer = new RecipeDealer(address(this), address(cards), address(new RecipeCompiler()));
        dealer.setRecipe(1, StandardRecipe.build());
        dealer.setCharacters(1, names, cats);
        cards.setDealer(1, address(dealer));
        cards.setImagesBase(1, "ipfs://x/");
        FireSale.DropConfig memory c;
        c.start = uint64(block.timestamp + 1);
        c.packs = 100;
        c.paperCapUsd = 1e8;
        c.regularWalletsFor = 1 hours;
        c.creditsPerPick = 1;
        c.groups = new FireGroups.Group[](1);
        c.groups[0] = FireGroups.Group({packs: 100, gate: FireGroups.Gate.OPEN, coins: 7, afterGroup: 255, rollTo: 255,
            startDelay: 0, duration: 0, perWallet: 50, limitFor: 0, perNft: 0, taxBps: 0, plankBurnBps: 3_000, paperBurnBps: 0, priceUsd: 250_000_000, paper: 1e18, nft: address(0), idle: 0, perTx: 0, unlimited: false, root: 0});
        sale.configureDrop(1, c);
        vm.warp(block.timestamp + 1);

        address buyer = address(0xA1);
        paper.mint(buyer, 100e18);
        vm.deal(buyer, 1 ether);
        vm.prank(buyer, buyer);
        paper.approve(address(sale), type(uint256).max);

        uint256 dead = MockERC20(PLANK).balanceOf(DEAD);
        (uint256 cost,) = sale.quote(1, 0, 1, FireSale.Pay.ETH);
        uint256 g = gasleft();
        vm.prank(buyer, buyer);
        sale.buy{value: cost}(1, 0, 1, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        emit log_named_uint("ETH, 1 pack, real swap: gas", g - gasleft());
        assertGt(MockERC20(PLANK).balanceOf(DEAD), dead, "PLANK burned");
        assertEq(address(0xB0B).balance, 0, "the swap went through, nothing to the burn wallet");

        (cost,) = sale.quote(1, 0, 5, FireSale.Pay.ETH);
        g = gasleft();
        vm.prank(buyer, buyer);
        sale.buy{value: cost}(1, 0, 5, FireSale.Pay.ETH, type(uint256).max, type(uint256).max, _na());
        emit log_named_uint("ETH, 5 packs, real swap: gas", g - gasleft());
        assertEq(address(sale).balance, 0);
    }
}
