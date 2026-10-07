// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {stdJson} from "forge-std/StdJson.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {ConfigureSeries} from "../../script/ConfigureSeries.s.sol";
import {SeriesHelper} from "./SeriesHelper.sol";
import {MockBurner} from "../Mocks.sol";

/// @dev The series check before lock (review item 21): batch A is the content only, batch B (configureDrop) is only
///      written once the chain holds batch A exactly as the JSON says, and both go out as Safe Transaction Builder files.
contract SeriesCheckTest is SeriesHelper {
    using stdJson for string;

    address owner = address(0xA11CE);
    FirePacks packs;
    FireCards cards;
    RecipeDealer dealer;
    FirePsa psa;
    ConfigureSeries cs;
    string json;

    function setUp() public {
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        psa = new FirePsa(owner, address(cards), address(new MockBurner(address(1), address(0))));
        cs = new ConfigureSeries();
        json = vm.readFile("test/cards/recipe-standard.json");
    }

    function _run(ConfigureSeries.Call[] memory calls) internal {
        vm.startPrank(owner);
        for (uint256 i; i < calls.length; i++) {
            (bool ok,) = calls[i].to.call(calls[i].data);
            assertTrue(ok, calls[i].what);
        }
        vm.stopPrank();
    }

    function test_batchA_isContentOnly_andTheReadBackPassesAfterIt() public {
        ConfigureSeries.Call[] memory a = cs.build(json, address(dealer), address(cards), address(psa), 200);
        for (uint256 i; i < a.length; i++) {
            assertTrue(keccak256(bytes(a[i].what)) != keccak256("FireSale.configureDrop"), "no configureDrop in batch A");
        }
        vm.expectRevert(bytes("on chain: the recipe differs from the JSON (run batch A)"));
        cs.checkOnChain(json, address(dealer), address(cards), address(psa));
        _run(a);
        cs.checkOnChain(json, address(dealer), address(cards), address(psa)); // passes
        (, bool closed, bool locked,,,) = cards.fires(7);
        assertFalse(closed || locked, "batch A locks nothing");
    }

    function test_readBack_catchesEachKindOfDifference() public {
        _run(cs.build(json, address(dealer), address(cards), address(psa), 200));
        vm.expectRevert(bytes("on chain: character 2 differs from the JSON"));
        cs.checkOnChain(vm.replace(json, "Cinder Queen", "Cinder King"), address(dealer), address(cards), address(psa));
        vm.expectRevert(bytes("on chain: imagesBase differs from the JSON"));
        cs.checkOnChain(vm.replace(json, "bafyexampleimages", "bafyotherimages"), address(dealer), address(cards), address(psa));
        vm.expectRevert(bytes("on chain: PDA odds differ from the JSON"));
        cs.checkOnChain(vm.replace(json, '"2700", "2500"', '"2500", "2700"'), address(dealer), address(cards), address(psa));
        vm.expectRevert(bytes("on chain: the recipe differs from the JSON (run batch A)"));
        cs.checkOnChain(vm.replace(json, '"amount": 3', '"amount": 2'), address(dealer), address(cards), address(psa));
        // the owner changes the folder after the check: caught too
        vm.prank(owner);
        cards.setImagesBase(7, "ipfs://bafychanged/");
        vm.expectRevert(bytes("on chain: imagesBase differs from the JSON"));
        cs.checkOnChain(json, address(dealer), address(cards), address(psa));
    }

    function test_readBack_refusesALockedSeries() public {
        _run(cs.build(json, address(dealer), address(cards), address(psa), 200));
        vm.prank(owner);
        cards.lockFire(7);
        vm.expectRevert(bytes("on chain: the Series is already locked"));
        cs.checkOnChain(json, address(dealer), address(cards), address(psa));
    }

    function test_safeTransactionBuilderFile() public {
        ConfigureSeries.Call[] memory a = cs.build(json, address(dealer), address(cards), address(psa), 2);
        string memory f = cs.safeJson(a, 4663, address(0x5AFE), "Series 7 batch A", "content");
        assertEq(f.readString(".version"), "1.0");
        assertEq(f.readString(".chainId"), "4663");
        assertEq(f.readAddress(".meta.createdFromSafeAddress"), address(0x5AFE));
        for (uint256 i; i < a.length; i++) {
            string memory p = string.concat(".transactions[", vm.toString(i), "]");
            assertEq(f.readAddress(string.concat(p, ".to")), a[i].to);
            assertEq(f.readBytes(string.concat(p, ".data")), a[i].data);
            assertEq(f.readString(string.concat(p, ".value")), "0");
        }
        assertFalse(vm.keyExistsJson(f, string.concat(".transactions[", vm.toString(a.length), "]")), "one entry per call");
    }
}
