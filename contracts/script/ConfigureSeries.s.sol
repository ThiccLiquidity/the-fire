// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {RecipeDealer} from "../src/cards/RecipeDealer.sol";
import {FireCards} from "../src/cards/FireCards.sol";
import {FirePsa} from "../src/cards/FirePsa.sol";

/**
 * Sets up one Series from a recipe JSON (the Card Studio exports it; shape in ../docs/cards-contracts.md):
 *   RecipeDealer.setRecipe, setCharacters (+ appendCharacters in batches for long lists), FireCards.setDealer,
 *   FireCards.setImagesBase (if "imagesBase" is given), FirePsa.setOdds (if "pdaOdds" is given).
 * It checks the recipe against the dealer first (RecipeDealer.check reverts with the reason), then prints each call
 * (target and calldata) for the OWNER multisig to submit. With SEND=true it sends them itself (only when the signer
 * is the owner, e.g. on a testnet).
 *
 *   RECIPE_JSON=path/to/recipe.json RECIPE_DEALER=0x... FIRE_CARDS=0x... [FIRE_PSA=0x...] [CHARACTER_BATCH=200] \
 *   forge script script/ConfigureSeries.s.sol --rpc-url $RPC [--account deployer --sender <owner> --broadcast, with SEND=true]
 *
 * Everything it sets locks once the Series' first pack is minted. Run it before FireSale.configureDrop.
 */
contract ConfigureSeries is Script {
    using stdJson for string;

    struct Call {
        address to;
        bytes data;
        string what;
    }

    struct Series {
        uint256 fire;
        RecipeDealer.Recipe recipe;
        string[] names;
        string[] categories;
        string imagesBase; // "" = leave as is
        bool hasOdds;
        uint64[10] odds;
    }

    function run() external {
        string memory json = vm.readFile(vm.envString("RECIPE_JSON"));
        Call[] memory calls = build(
            json, vm.envAddress("RECIPE_DEALER"), vm.envAddress("FIRE_CARDS"), vm.envOr("FIRE_PSA", address(0)),
            vm.envOr("CHARACTER_BATCH", uint256(200))
        );
        for (uint256 i; i < calls.length; i++) {
            console.log(calls[i].what);
            console.log("  to  ", calls[i].to);
            console.log("  data");
            console.logBytes(calls[i].data);
        }
        if (vm.envOr("SEND", false)) {
            vm.startBroadcast();
            for (uint256 i; i < calls.length; i++) {
                (bool ok,) = calls[i].to.call(calls[i].data);
                require(ok, calls[i].what);
            }
            vm.stopBroadcast();
        }
    }

    /// @dev The calls, in order. Checks the recipe with the dealer first.
    function build(string memory json, address dealer, address cards, address psa, uint256 batch)
        public
        view
        returns (Call[] memory calls)
    {
        require(batch > 0, "CHARACTER_BATCH must be at least 1");
        Series memory s = parse(json);
        RecipeDealer(dealer).check(s.recipe); // reverts with the reason if the recipe can't work
        uint256 n = s.names.length;
        require(n > 0, "the recipe has no characters");
        uint256 batches = (n + batch - 1) / batch;
        calls = new Call[](batches + 2 + (bytes(s.imagesBase).length > 0 ? 1 : 0) + (s.hasOdds ? 1 : 0));
        uint256 k;
        calls[k++] = Call(dealer, abi.encodeCall(RecipeDealer.setRecipe, (s.fire, s.recipe)), "RecipeDealer.setRecipe");
        for (uint256 b; b < batches; b++) {
            uint256 from = b * batch;
            uint256 len = n - from < batch ? n - from : batch;
            string[] memory names = new string[](len);
            string[] memory cats = new string[](len);
            for (uint256 i; i < len; i++) {
                names[i] = s.names[from + i];
                cats[i] = s.categories[from + i];
            }
            calls[k++] = b == 0
                ? Call(dealer, abi.encodeCall(RecipeDealer.setCharacters, (s.fire, names, cats)), "RecipeDealer.setCharacters")
                : Call(dealer, abi.encodeCall(RecipeDealer.appendCharacters, (s.fire, names, cats)), "RecipeDealer.appendCharacters");
        }
        calls[k++] = Call(cards, abi.encodeCall(FireCards.setDealer, (s.fire, dealer)), "FireCards.setDealer");
        if (bytes(s.imagesBase).length > 0) {
            calls[k++] = Call(cards, abi.encodeCall(FireCards.setImagesBase, (s.fire, s.imagesBase)), "FireCards.setImagesBase");
        }
        if (s.hasOdds) {
            require(psa != address(0), "pdaOdds given: set FIRE_PSA");
            calls[k++] = Call(psa, abi.encodeCall(FirePsa.setOdds, (s.fire, s.odds)), "FirePsa.setOdds");
        }
    }

    function parse(string memory json) public view returns (Series memory s) {
        s.fire = json.readUint(".fire");
        if (json.keyExists(".imagesBase")) s.imagesBase = json.readString(".imagesBase");
        uint256 nt = _count(json, ".types");
        s.recipe.types = new RecipeDealer.CardType[](nt);
        for (uint256 i; i < nt; i++) s.recipe.types[i] = _type(json, string.concat(".types[", vm.toString(i), "]"));
        uint256 ns = _count(json, ".slots");
        s.recipe.slots = new RecipeDealer.Slot[](ns);
        for (uint256 i; i < ns; i++) s.recipe.slots[i] = _slot(json, string.concat(".slots[", vm.toString(i), "]"));
        uint256 nc = _count(json, ".characters");
        s.names = new string[](nc);
        s.categories = new string[](nc);
        for (uint256 i; i < nc; i++) {
            string memory p = string.concat(".characters[", vm.toString(i), "]");
            s.names[i] = json.readString(string.concat(p, ".name"));
            s.categories[i] = json.readString(string.concat(p, ".category"));
        }
        if (json.keyExists(".pdaOdds")) {
            uint256[] memory o = json.readUintArray(".pdaOdds");
            require(o.length == 10, "pdaOdds: one weight per grade, 1 to 10");
            for (uint256 g; g < 10; g++) s.odds[g] = uint64(o[g]);
            s.hasOdds = true;
        }
    }

    function _type(string memory json, string memory p) internal view returns (RecipeDealer.CardType memory t) {
        t.name = json.readString(string.concat(p, ".name"));
        t.slug = json.readString(string.concat(p, ".slug"));
        t.rank = uint32(json.readUint(string.concat(p, ".rank")));
        bytes32 sup = keccak256(bytes(json.readString(string.concat(p, ".supply"))));
        if (sup == keccak256("filler")) t.supply = RecipeDealer.Supply.Filler;
        else if (sup == keccak256("share")) t.supply = RecipeDealer.Supply.Share;
        else if (sup == keccak256("perPack")) t.supply = RecipeDealer.Supply.PerPack;
        else if (sup == keccak256("count")) t.supply = RecipeDealer.Supply.Count;
        else revert(string.concat(p, ".supply: filler, share, perPack or count"));
        if (t.supply != RecipeDealer.Supply.Filler) t.amount = uint128(json.readUint(string.concat(p, ".amount")));
        if (json.keyExists(string.concat(p, ".maxPerPack"))) t.maxPerPack = uint64(json.readUint(string.concat(p, ".maxPerPack")));
        bytes32 mode = keccak256(bytes(json.readString(string.concat(p, ".holo.mode"))));
        if (mode == keccak256("independent")) {
            t.holoMode = RecipeDealer.HoloMode.Independent;
            t.holo[0] = uint64(json.readUint(string.concat(p, ".holo.frame")));
            t.holo[1] = uint64(json.readUint(string.concat(p, ".holo.picture")));
        } else if (mode == keccak256("distribution")) {
            t.holoMode = RecipeDealer.HoloMode.Distribution;
            uint256[] memory w = json.readUintArray(string.concat(p, ".holo.weights"));
            require(w.length == 4, string.concat(p, ".holo.weights: none, frame, picture, full"));
            for (uint256 i; i < 4; i++) t.holo[i] = uint64(w[i]);
        } else {
            revert(string.concat(p, ".holo.mode: independent or distribution"));
        }
    }

    function _slot(string memory json, string memory p) internal view returns (RecipeDealer.Slot memory s) {
        s.count = uint32(json.readUint(string.concat(p, ".count")));
        if (json.keyExists(string.concat(p, ".types"))) {
            uint256[] memory ts = json.readUintArray(string.concat(p, ".types"));
            s.types = new uint32[](ts.length);
            for (uint256 i; i < ts.length; i++) s.types[i] = uint32(ts[i]);
        }
        if (json.keyExists(string.concat(p, ".minRank"))) s.minRank = uint32(json.readUint(string.concat(p, ".minRank")));
        // a rank range with no top means "or better": every rank from minRank up
        if (json.keyExists(string.concat(p, ".maxRank"))) s.maxRank = uint32(json.readUint(string.concat(p, ".maxRank")));
        else if (s.types.length == 0) s.maxRank = type(uint32).max;
        if (json.keyExists(string.concat(p, ".mustHolo"))) s.mustHolo = json.readBool(string.concat(p, ".mustHolo"));
    }

    function _count(string memory json, string memory key) internal view returns (uint256 n) {
        while (json.keyExists(string.concat(key, "[", vm.toString(n), "]"))) n++;
    }
}
