// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FireSale} from "../../src/cards/FireSale.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {PlankUsdTwap} from "../../src/PlankUsdTwap.sol";
import {MockERC20, MockMill} from "../Mocks.sol";

/// Gas and the real PLANK swap, on a copy of Robinhood Chain. Skipped unless FORK_RPC is set:
///   $env:FORK_RPC = "https://rpc.mainnet.chain.robinhood.com"   (PowerShell)
///   forge test --match-path test/cards/SaleFork.t.sol -vv
/// Uses the real PLANK, WETH, Uniswap V2 router and pair, and Chainlink ETH/USD; a stand-in PAPER and press.
contract SaleForkTest is Test {
    function _na() internal pure returns (FireSale.Access memory a) {
        a.proof = new bytes32[](0);
    }


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
        MockMill press = new MockMill(address(paper), 0);
        FirePacks packs = new FirePacks(address(this));
        FireCards cards = new FireCards(address(this), address(packs));
        FireSale sale = new FireSale(FireSale.Config({
            owner: address(this), paper: address(paper), plank: PLANK, usdg: address(0), weth: WETH, press: address(press),
            packs: address(packs), cards: address(cards), ethUsd: ETH_USD, plankUsd: address(twap), router: ROUTER,
            revenueWallet: address(0xBEEF), burnWallet: address(0xB0B), paperPerSuggestion: 1e18
        }));
        packs.setSeller(address(sale));
        packs.setCards(address(cards));
        cards.setSeller(address(sale));
        string[] memory names = new string[](1);
        string[] memory cats = new string[](1);
        for (uint256 k; k < cats.length; k++) cats[k] = "Person";
        names[0] = "Test";
        RecipeDealer dealer = new RecipeDealer(address(this), address(cards));
        dealer.setRecipe(1, StandardRecipe.build(1));
        dealer.setCharacters(1, names, cats);
        cards.setDealer(1, address(dealer));
        cards.setImagesBase(1, "ipfs://x/");
        sale.configureDrop(1, FireSale.DropConfig({start: uint64(block.timestamp + 1), packs: 100, starters: 0, plankOnly: 0,
            walletLimit: 50, starterWindow: 0, liftAfter: 1 hours, plankBurnBps: 3_000, priceUsd: 250_000_000, paperPerPack: 1e18, holderWindow: 0, holderRoot: bytes32(0), maxPerTx: 0, plankOnlyFor: 1 hours, regularWalletsFor: 1 hours, starterPerPress: 1, starterWalletLimit: 1, starterPriceUsd: 0, starterPaper: 1e18, creditsPerPick: 1, creditPacksMax: 0, creditPacksPerWallet: 0}));
        vm.warp(block.timestamp + 1);

        address buyer = address(0xA1);
        paper.mint(buyer, 100e18);
        vm.deal(buyer, 1 ether);
        vm.prank(buyer, buyer);
        paper.approve(address(sale), type(uint256).max);

        uint256 dead = MockERC20(PLANK).balanceOf(DEAD);
        uint256 cost = sale.quoteEth(1, 1);
        uint256 g = gasleft();
        vm.prank(buyer, buyer);
        sale.buyWithEth{value: cost}(1, 1, type(uint256).max, _na());
        emit log_named_uint("ETH, 1 pack, real swap: gas", g - gasleft());
        assertGt(MockERC20(PLANK).balanceOf(DEAD), dead, "PLANK burned");
        assertEq(address(0xB0B).balance, 0, "the swap went through, nothing to the burn wallet");

        cost = sale.quoteEth(1, 5);
        g = gasleft();
        vm.prank(buyer, buyer);
        sale.buyWithEth{value: cost}(1, 5, type(uint256).max, _na());
        emit log_named_uint("ETH, 5 packs, real swap: gas", g - gasleft());
        assertEq(address(sale).balance, 0);
    }
}
