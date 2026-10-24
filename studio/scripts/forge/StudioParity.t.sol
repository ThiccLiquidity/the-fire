// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Run by studio/scripts/contract-parity.sh in a scratch copy of contracts/ (it is not part of the contracts' own
// suite). For every recipe.json the studio wrote into test/cards/studio-parity/<i>.json: parse it exactly as
// ConfigureSeries.s.sol does, ask RecipeDealer.check (ok, or the revert decoded), and for a valid recipe set it on a
// fresh Series and read back oddsOf (type weights and total) and holoOdds for each type. Case 0 is the studio's
// Standard export: it must parse to StandardRecipe.build() and ConfigureSeries.build must turn it into the owner's
// calls. Results go to test/cards/studio-parity/results.json.

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {ConfigureSeries} from "../../script/ConfigureSeries.s.sol";

contract StudioParityTest is Test {
    using stdJson for string;

    string constant DIR = "test/cards/studio-parity/";
    RecipeDealer dealer;
    FireCards cards;
    ConfigureSeries cs;

    function setUp() public {
        FirePacks packs = new FirePacks(address(this));
        cards = new FireCards(address(this), address(packs));
        dealer = new RecipeDealer(address(this), address(cards), address(new RecipeCompiler()));
        cs = new ConfigureSeries();
    }

    function test_studioParity() public {
        string memory out = "[";
        for (uint256 i;; i++) {
            string memory path = string.concat(DIR, vm.toString(i), ".json");
            if (!vm.exists(path)) break;
            string memory json = vm.readFile(path);
            ConfigureSeries.Series memory s = cs.parse(json);
            string memory row;
            try dealer.check(s.recipe) returns (uint256 perPack) {
                uint256 fire = 1000 + i;
                dealer.setRecipe(fire, s.recipe);
                (uint256[] memory w, uint256 total) = dealer.oddsOf(fire);
                string memory ws = "[";
                for (uint256 t; t < w.length; t++) ws = string.concat(ws, t == 0 ? "" : ",", '"', vm.toString(w[t]), '"');
                string memory hs = "[";
                for (uint256 t; t < w.length; t++) {
                    uint256[4] memory o = dealer.holoOdds(fire, t);
                    string memory a = "[";
                    for (uint256 h; h < 4; h++) a = string.concat(a, h == 0 ? "" : ",", '"', vm.toString(o[h]), '"');
                    hs = string.concat(hs, t == 0 ? "" : ",", a, "]");
                }
                row = string.concat(
                    '{"ok":true,"perPack":', vm.toString(perPack), ',"weights":', ws, '],"total":"', vm.toString(total), '","holo":', hs, "]"
                );
                if (i == 0) {
                    assertEq(keccak256(abi.encode(s.recipe)), keccak256(abi.encode(StandardRecipe.build())), "Standard export != StandardRecipe");
                    ConfigureSeries.Call[] memory calls = cs.build(json, address(dealer), address(cards), 2);
                    row = string.concat(row, ',"calls":', vm.toString(calls.length));
                }
                row = string.concat(row, "}");
            } catch (bytes memory err) {
                row = string.concat('{"ok":false,"error":"', _decode(err), '"}');
            }
            out = string.concat(out, i == 0 ? "" : ",\n", row);
        }
        vm.writeFile(string.concat(DIR, "results.json"), string.concat(out, "]"));
    }

    function _decode(bytes memory err) internal pure returns (string memory) {
        bytes4 sel = bytes4(err);
        bytes memory a = new bytes(err.length - 4);
        for (uint256 i; i < a.length; i++) a[i] = err[i + 4];
        if (sel == RecipeCompiler.BadText.selector) return "BadText";
        if (sel == RecipeCompiler.BadRecipe.selector) return string.concat("BadRecipe(", abi.decode(a, (string)), ")");
        if (sel == RecipeCompiler.BadType.selector) {
            (uint256 x, string memory why) = abi.decode(a, (uint256, string));
            return string.concat("BadType(", vm.toString(x), ",", why, ")");
        }
        return vm.toString(err);
    }
}
