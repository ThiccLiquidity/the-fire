// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {RecipeDealer} from "../src/cards/RecipeDealer.sol";
import {FireCards} from "../src/cards/FireCards.sol";
import {FirePsa} from "../src/cards/FirePsa.sol";
import {FireSale} from "../src/cards/FireSale.sol";

/**
 * Sets up one Series from a recipe JSON (the Card Studio exports it; shape in ../docs/cards-contracts.md):
 *   RecipeDealer.setRecipe, setCharacters (+ appendCharacters in batches for long lists), FireCards.setDealer,
 *   FireCards.setImagesBase (if "imagesBase" is given), FirePsa.setOdds (if "pdaOdds" is given), and last
 *   FireSale.configureDrop from the "sale" block (if given and FIRE_SALE is set; every FireSale.DropConfig field by
 *   name, in contract units). DROP_START (unix seconds) and HOLDER_ROOT override the block's start and holderRoot,
 *   since both are usually decided last (the snapshot runs just before the drop).
 * It checks the recipe against the dealer first (RecipeDealer.check reverts with the reason), then prints each call
 * (target and calldata) for the OWNER multisig to submit. With SEND=true it sends them itself (only when the signer
 * is the owner, e.g. on a testnet).
 *
 *   RECIPE_JSON=path/to/recipe.json RECIPE_DEALER=0x... FIRE_CARDS=0x... [FIRE_PSA=0x...] [FIRE_SALE=0x...] \
 *   [DROP_START=<unix seconds>] [HOLDER_ROOT=0x...] [CHARACTER_BATCH=200] \
 *   forge script script/ConfigureSeries.s.sol --rpc-url $RPC [--account deployer --sender <owner> --broadcast, with SEND=true]
 *
 * The recipe settings lock when the drop is set up (configureDrop locks the Series); the drop settings when it opens.
 * The JSON is read strictly: unknown keys, numbers too big for their field, PDA odds on grades 1-4 and a drop start
 * more than a year away are refused, so a typo can't slip through as a default.
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
        bool hasSale;
        FireSale.DropConfig drop;
    }

    function run() external {
        string memory json = vm.readFile(vm.envString("RECIPE_JSON"));
        address sale = vm.envOr("FIRE_SALE", address(0));
        if (sale == address(0) && json.keyExists(".sale")) console.log("The JSON has a sale block: set FIRE_SALE to add configureDrop.");
        Call[] memory calls = buildAll(
            json, vm.envAddress("RECIPE_DEALER"), vm.envAddress("FIRE_CARDS"), vm.envOr("FIRE_PSA", address(0)), sale,
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

    /// @dev The recipe calls only (the sale block, if any, is left out).
    function build(string memory json, address dealer, address cards, address psa, uint256 batch)
        public
        view
        returns (Call[] memory calls)
    {
        return buildAll(json, dealer, cards, psa, address(0), batch);
    }

    /// @dev The calls, in order. Checks the recipe with the dealer first. With `sale` set and a "sale" block,
    ///      FireSale.configureDrop comes last (it needs the Series ready, so it can't be checked ahead).
    function buildAll(string memory json, address dealer, address cards, address psa, address sale, uint256 batch)
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
        bool withSale = s.hasSale && sale != address(0);
        calls = new Call[](batches + 2 + (bytes(s.imagesBase).length > 0 ? 1 : 0) + (s.hasOdds ? 1 : 0) + (withSale ? 1 : 0));
        calls[0] = Call(dealer, abi.encodeCall(RecipeDealer.setRecipe, (s.fire, s.recipe)), "RecipeDealer.setRecipe");
        uint256 k = _characterCalls(calls, s, dealer, batch);
        calls[k++] = Call(cards, abi.encodeCall(FireCards.setDealer, (s.fire, dealer)), "FireCards.setDealer");
        if (bytes(s.imagesBase).length > 0) {
            calls[k++] = Call(cards, abi.encodeCall(FireCards.setImagesBase, (s.fire, s.imagesBase)), "FireCards.setImagesBase");
        }
        if (s.hasOdds) {
            require(psa != address(0), "pdaOdds given: set FIRE_PSA");
            calls[k++] = Call(psa, abi.encodeCall(FirePsa.setOdds, (s.fire, s.odds)), "FirePsa.setOdds");
        }
        if (withSale) {
            calls[k++] = Call(sale, abi.encodeCall(FireSale.configureDrop, (s.fire, s.drop)), "FireSale.configureDrop");
        }
    }

    /// @dev setCharacters, then appendCharacters, `batch` characters each, from calls[1]. Returns the next index.
    function _characterCalls(Call[] memory calls, Series memory s, address dealer, uint256 batch)
        internal
        pure
        returns (uint256 k)
    {
        uint256 n = s.names.length;
        k = 1;
        for (uint256 from; from < n; from += batch) {
            uint256 len = n - from < batch ? n - from : batch;
            string[] memory names = new string[](len);
            string[] memory cats = new string[](len);
            for (uint256 i; i < len; i++) {
                names[i] = s.names[from + i];
                cats[i] = s.categories[from + i];
            }
            calls[k++] = from == 0
                ? Call(dealer, abi.encodeCall(RecipeDealer.setCharacters, (s.fire, names, cats)), "RecipeDealer.setCharacters")
                : Call(dealer, abi.encodeCall(RecipeDealer.appendCharacters, (s.fire, names, cats)), "RecipeDealer.appendCharacters");
        }
    }

    uint256 internal constant MAX_START_AHEAD = 365 days;

    function parse(string memory json) public view returns (Series memory s) {
        _onlyKeys(json, ".", "fire,imagesBase,types,slots,characters,pdaOdds,sale");
        s.fire = _num(json, ".fire", type(uint64).max);
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
            _onlyKeys(json, p, "name,category");
            s.names[i] = json.readString(string.concat(p, ".name"));
            s.categories[i] = json.readString(string.concat(p, ".category"));
        }
        if (json.keyExists(".pdaOdds")) {
            uint256[] memory o = json.readUintArray(".pdaOdds");
            require(o.length == 10, "pdaOdds: one weight per grade, 1 to 10");
            for (uint256 g; g < 10; g++) {
                require(o[g] <= type(uint64).max, "pdaOdds: a weight is too big");
                require(g >= 4 || o[g] == 0, "pdaOdds: grades 1-4 must be 0 (they come only from wear)");
                s.odds[g] = uint64(o[g]);
            }
            s.hasOdds = true;
        }
        if (json.keyExists(".sale")) {
            s.drop = parseSale(json);
            s.hasSale = true;
        }
    }

    /// @dev The "sale" block: every FireSale.DropConfig field by name (contract units: seconds, 8-decimal dollars,
    ///      PAPER wei, basis points). holderRoot is optional (0 = presses only). DROP_START and HOLDER_ROOT override.
    function parseSale(string memory json) public view returns (FireSale.DropConfig memory c) {
        _onlyKeys(json, ".sale", "start,packs,starters,plankOnly,walletLimit,starterWindow,liftAfter,plankBurnBps,priceUsd,paperPerPack,paperCapUsd,holderWindow,holderRoot,maxPerTx,plankOnlyFor,regularWalletsFor,starterPerPress,starterWalletLimit,starterPriceUsd,starterPaper,creditsPerPick,creditPacksMax,creditPacksPerWallet");
        c.start = uint64(vm.envOr("DROP_START", _u(json, "start")));
        require(c.start != 0, "sale.start is 0: set it in the studio or with DROP_START");
        require(c.start < block.timestamp + MAX_START_AHEAD, "sale.start is more than a year away: a typo?");
        c.packs = uint64(_u(json, "packs"));
        c.starters = uint64(_u(json, "starters"));
        c.plankOnly = uint64(_u(json, "plankOnly"));
        c.walletLimit = uint64(_u(json, "walletLimit"));
        c.starterWindow = uint32(_u(json, "starterWindow"));
        c.liftAfter = uint32(_u(json, "liftAfter"));
        c.plankBurnBps = uint16(_u(json, "plankBurnBps"));
        c.priceUsd = uint128(_u(json, "priceUsd"));
        c.paperPerPack = uint128(_u(json, "paperPerPack"));
        c.paperCapUsd = uint128(_u(json, "paperCapUsd"));
        c.holderWindow = uint32(_u(json, "holderWindow"));
        bytes32 root;
        if (json.keyExists(".sale.holderRoot")) root = json.readBytes32(".sale.holderRoot");
        c.holderRoot = vm.envOr("HOLDER_ROOT", root);
        c.maxPerTx = uint32(_u(json, "maxPerTx"));
        c.plankOnlyFor = uint32(_u(json, "plankOnlyFor"));
        c.regularWalletsFor = uint32(_u(json, "regularWalletsFor"));
        c.starterPerPress = uint32(_u(json, "starterPerPress"));
        c.starterWalletLimit = uint32(_u(json, "starterWalletLimit"));
        c.starterPriceUsd = uint128(_u(json, "starterPriceUsd"));
        c.starterPaper = uint128(_u(json, "starterPaper"));
        c.creditsPerPick = uint16(_u(json, "creditsPerPick"));
        c.creditPacksMax = uint64(_u(json, "creditPacksMax"));
        c.creditPacksPerWallet = uint64(_u(json, "creditPacksPerWallet"));
    }

    /// @dev A required whole number from the sale block, checked to fit its field.
    function _u(string memory json, string memory key) internal view returns (uint256 v) {
        string memory p = string.concat(".sale.", key);
        require(json.keyExists(p), string.concat(p, " is missing"));
        v = json.readUint(p);
        bytes32 k = keccak256(bytes(key));
        uint256 max = k == keccak256("plankBurnBps") || k == keccak256("creditsPerPick") ? type(uint16).max
            : k == keccak256("priceUsd") || k == keccak256("paperPerPack") || k == keccak256("paperCapUsd")
                || k == keccak256("starterPriceUsd")
                || k == keccak256("starterPaper") ? type(uint128).max
            : k == keccak256("start") || k == keccak256("packs") || k == keccak256("starters") || k == keccak256("plankOnly")
                || k == keccak256("walletLimit") || k == keccak256("creditPacksMax")
                || k == keccak256("creditPacksPerWallet") ? type(uint64).max
            : type(uint32).max;
        require(v <= max, string.concat(p, " is too big for its field"));
    }

    function _type(string memory json, string memory p) internal view returns (RecipeDealer.CardType memory t) {
        _onlyKeys(json, p, "name,slug,rank,supply,amount,maxPerPack,holo");
        _onlyKeys(json, string.concat(p, ".holo"), "mode,frame,picture,weights");
        t.name = json.readString(string.concat(p, ".name"));
        t.slug = json.readString(string.concat(p, ".slug"));
        t.rank = uint32(_num(json, string.concat(p, ".rank"), type(uint32).max));
        bytes32 sup = keccak256(bytes(json.readString(string.concat(p, ".supply"))));
        if (sup == keccak256("filler")) t.supply = RecipeDealer.Supply.Filler;
        else if (sup == keccak256("share")) t.supply = RecipeDealer.Supply.Share;
        else if (sup == keccak256("perPack")) t.supply = RecipeDealer.Supply.PerPack;
        else if (sup == keccak256("count")) t.supply = RecipeDealer.Supply.Count;
        else if (sup == keccak256("perCharacter")) t.supply = RecipeDealer.Supply.PerCharacter;
        else revert(string.concat(p, ".supply: filler, share, perPack, count or perCharacter"));
        if (t.supply != RecipeDealer.Supply.Filler) t.amount = uint128(_num(json, string.concat(p, ".amount"), type(uint128).max));
        if (json.keyExists(string.concat(p, ".maxPerPack"))) t.maxPerPack = uint64(_num(json, string.concat(p, ".maxPerPack"), type(uint64).max));
        bytes32 mode = keccak256(bytes(json.readString(string.concat(p, ".holo.mode"))));
        if (mode == keccak256("independent")) {
            t.holoMode = RecipeDealer.HoloMode.Independent;
            t.holo[0] = uint64(_num(json, string.concat(p, ".holo.frame"), type(uint64).max));
            t.holo[1] = uint64(_num(json, string.concat(p, ".holo.picture"), type(uint64).max));
        } else if (mode == keccak256("distribution")) {
            t.holoMode = RecipeDealer.HoloMode.Distribution;
            uint256[] memory w = json.readUintArray(string.concat(p, ".holo.weights"));
            require(w.length == 4, string.concat(p, ".holo.weights: none, frame, picture, full"));
            for (uint256 i; i < 4; i++) {
                require(w[i] <= type(uint64).max, string.concat(p, ".holo.weights: a weight is too big"));
                t.holo[i] = uint64(w[i]);
            }
        } else {
            revert(string.concat(p, ".holo.mode: independent or distribution"));
        }
    }

    function _slot(string memory json, string memory p) internal view returns (RecipeDealer.Slot memory s) {
        _onlyKeys(json, p, "count,types,minRank,maxRank,mustHolo");
        s.count = uint32(_num(json, string.concat(p, ".count"), type(uint32).max));
        if (json.keyExists(string.concat(p, ".types"))) {
            uint256[] memory ts = json.readUintArray(string.concat(p, ".types"));
            s.types = new uint32[](ts.length);
            for (uint256 i; i < ts.length; i++) {
                require(ts[i] <= type(uint32).max, string.concat(p, ".types: an index is too big"));
                s.types[i] = uint32(ts[i]);
            }
        }
        if (json.keyExists(string.concat(p, ".minRank"))) s.minRank = uint32(_num(json, string.concat(p, ".minRank"), type(uint32).max));
        // a rank range with no top means "or better": every rank from minRank up
        if (json.keyExists(string.concat(p, ".maxRank"))) s.maxRank = uint32(_num(json, string.concat(p, ".maxRank"), type(uint32).max));
        else if (s.types.length == 0) s.maxRank = type(uint32).max;
        if (json.keyExists(string.concat(p, ".mustHolo"))) s.mustHolo = json.readBool(string.concat(p, ".mustHolo"));
    }

    /// @dev A whole number that must fit `max`.
    function _num(string memory json, string memory p, uint256 max) internal pure returns (uint256 v) {
        v = json.readUint(p);
        require(v <= max, string.concat(p, " is too big for its field"));
    }

    /// @dev Every key of the object at `p` must be in `allowed` (comma-separated).
    function _onlyKeys(string memory json, string memory p, string memory allowed) internal view {
        string[] memory keys = vm.parseJsonKeys(json, p);
        bytes memory list = bytes(string.concat(",", allowed, ","));
        for (uint256 i; i < keys.length; i++) {
            require(_contains(list, bytes(string.concat(",", keys[i], ","))), string.concat(p, ": unknown key ", keys[i]));
        }
    }

    function _contains(bytes memory hay, bytes memory needle) internal pure returns (bool) {
        if (needle.length > hay.length) return false;
        for (uint256 i; i + needle.length <= hay.length; i++) {
            bool ok = true;
            for (uint256 j; j < needle.length; j++) {
                if (hay[i + j] != needle[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    function _count(string memory json, string memory key) internal view returns (uint256 n) {
        while (json.keyExists(string.concat(key, "[", vm.toString(n), "]"))) n++;
    }
}
