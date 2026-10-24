// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {RecipeDealer} from "../src/cards/RecipeDealer.sol";
import {FireCards} from "../src/cards/FireCards.sol";
import {FireSale} from "../src/cards/FireSale.sol";
import {FireGroups} from "../src/cards/FireGroups.sol";
import {Deployments} from "./Deployments.sol";

/**
 * Sets up one Series from a recipe JSON (the Card Studio exports it; shape in ../docs/cards-contracts.md), in two
 * signings on the owner's hardware wallet with a check in between (docs/deploy.md, step 6):
 *
 *   Batch A, the content: RecipeDealer.setRecipe, setCharacters (+ appendCharacters in batches for long lists),
 *     setCharacterWeights (only if the characters have a "weight"), FireCards.setDealer, FireCards.setImagesBase (if
 *     "imagesBase" is given).
 *     Nothing is locked yet: any of it can still be set again.
 *   Then ops/series (VerifySeries) reads it all back from the chain, diffs it against the JSON and loads every image
 *     the contract can point at through two gateways. Only when it's green:
 *   Batch B, the lock: FireSale.configureDrop from the "sale" block (the drop-wide FireSale.DropConfig fields and a
 *     "groups" list of FireGroups.Group, by name, in contract units; docs/cards-contracts.md). It locks the Series:
 *     recipe, characters and images are fixed from then. Before sending batch B the script reads the chain and
 *     refuses unless batch A is there exactly as the JSON says.
 *
 * Each batch is sent from the owner, signed on the device (one confirmation per call). The calls are also printed.
 *
 *   forge script script/ConfigureSeries.s.sol --rpc-url $env:RPC --ledger --hd-paths $env:OWNER_HD_PATH `
 *     --sender $env:OWNER --slow --broadcast                          (--trezor works too; no --broadcast = dry run)
 *   SIMULATE=true with --fork-url $env:RPC: run the batch as the owner on a fork (impersonated, no device, nothing
 *     sent). BATCH=AB SIMULATE=true shows batch B passing after batch A.
 *
 *   BATCH=A|B (AB only with SIMULATE; default A), RECIPE_JSON=series/recipe.json (the file must be under contracts/series/)
 *   RECIPE_DEALER, FIRE_CARDS, FIRE_SALE: read from deployments/<chainId>.json when not set
 *   DROP_START=<unix seconds>: overrides the sale block's start; GROUP_ROOT_<i>=0x...: the snapshot root of group i
 *     (a "snapshot" group; both are usually decided last: the snapshot runs just before the drop). A snapshot group
 *     with no root in the JSON and no GROUP_ROOT_<i> is refused.
 *   MILL: the Paper Press for a group whose "nft" is "press" (read from deployments/<chainId>.json when not set)
 *   CHARACTER_BATCH=200
 *
 * The JSON is read strictly: unknown keys (PDA odds included: they are fixed in FirePsa for every Series), numbers too
 * big for their field and a drop start more than a year away are refused, so a typo can't slip through as a default.
 */
contract ConfigureSeries is Deployments {
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
        uint64[] weights; // character odds; empty = every character equally likely
        string imagesBase; // "" = leave as is
        bool hasSale;
        FireSale.DropConfig drop;
    }

    function run() external {
        string memory json = vm.readFile(vm.envString("RECIPE_JSON"));
        bytes32 which = keccak256(bytes(vm.envOr("BATCH", string("A"))));
        bool a = which == keccak256("A") || which == keccak256("AB");
        bool b = which == keccak256("B") || which == keccak256("AB");
        require(a || b, "BATCH must be A or B");
        bool simulate = vm.envOr("SIMULATE", false);
        require(!(a && b) || simulate, "BATCH=AB only with SIMULATE=true: VerifySeries must be GREEN between A and B");
        address dealer = _addr("RECIPE_DEALER", "RecipeDealer");
        address cards = _addr("FIRE_CARDS", "FireCards");
        address sale = vm.envOr("FIRE_SALE", deployed("FireSale"));
        address owner = FireCards(cards).owner();
        Series memory s = _parse(json, b);

        Call[] memory calls;
        if (a) {
            calls = build(json, dealer, cards, vm.envOr("CHARACTER_BATCH", uint256(200)));
            _print(string.concat("Series ", vm.toString(s.fire), ", batch A (content: recipe, characters, dealer, images; nothing locks yet)"), calls);
            if (simulate) _simulate(owner, calls);
            else _send(owner, calls);
        }
        if (b) {
            require(s.hasSale, "batch B needs the JSON's sale block");
            require(sale != address(0), "batch B: set FIRE_SALE or deploy FireSale first");
            checkOnChain(json, dealer, cards); // batch A must be on chain exactly as the JSON says
            calls = new Call[](1);
            calls[0] = Call(sale, abi.encodeCall(FireSale.configureDrop, (s.fire, s.drop)), "FireSale.configureDrop");
            _print(string.concat("Series ", vm.toString(s.fire), ", batch B (the lock: configureDrop; only after VerifySeries is GREEN)"), calls);
            if (simulate) _simulate(owner, calls);
            else _send(owner, calls);
        }
    }

    function _print(string memory title, Call[] memory calls) internal pure {
        console.log(title);
        for (uint256 i; i < calls.length; i++) {
            console.log(calls[i].what);
            console.log("  to  ", calls[i].to);
            console.log("  data");
            console.logBytes(calls[i].data);
        }
    }

    /// @dev Send the calls from the owner (the hardware wallet signs each). Without --broadcast forge only simulates.
    function _send(address owner, Call[] memory calls) internal {
        require(
            msg.sender == owner,
            string.concat("sign as the owner ", vm.toString(owner), ": --ledger (or --trezor) --hd-paths <its path> --sender <it>, or SIMULATE=true on a fork")
        );
        vm.startBroadcast(owner);
        for (uint256 i; i < calls.length; i++) {
            (bool ok,) = calls[i].to.call(calls[i].data);
            require(ok, string.concat(calls[i].what, " reverts"));
        }
        vm.stopBroadcast();
        console.log(string.concat(vm.toString(calls.length), " call(s) from the owner"));
    }

    /// @dev Run the calls as the owner (a fork; nothing is sent) and stop at the first that fails.
    function _simulate(address owner, Call[] memory calls) internal {
        for (uint256 i; i < calls.length; i++) {
            vm.prank(owner);
            (bool ok, bytes memory ret) = calls[i].to.call(calls[i].data);
            if (!ok) {
                console.log(string.concat("SIMULATION FAILED at ", calls[i].what));
                console.logBytes(ret);
                revert(string.concat("simulation: ", calls[i].what, " reverts"));
            }
            console.log(string.concat("simulated OK: ", calls[i].what));
        }
    }

    /// @notice Reverts (naming what differs) unless batch A is on chain exactly as the JSON says: the dealer's recipe
    ///         and characters, FireCards' dealer and image folder; and the Series isn't locked yet.
    function checkOnChain(string memory json, address dealer, address cards) public view {
        Series memory s = _parse(json, false);
        RecipeDealer d = RecipeDealer(dealer);
        require(
            keccak256(abi.encode(d.recipeOf(s.fire))) == keccak256(abi.encode(s.recipe)),
            "on chain: the recipe differs from the JSON (run batch A)"
        );
        require(d.characterCount(s.fire) == s.names.length, "on chain: the character count differs from the JSON");
        {
            (uint256[] memory w,) = d.characterOddsOf(s.fire);
            for (uint256 i; i < w.length; i++) {
                require(
                    w[i] == (s.weights.length == 0 ? 1 : s.weights[i]),
                    string.concat("on chain: character ", vm.toString(i), "'s weight differs from the JSON")
                );
            }
        }
        for (uint256 from; from < s.names.length; from += 200) {
            (string[] memory n, string[] memory c) = d.charactersOf(s.fire, from, 200);
            for (uint256 i; i < n.length; i++) {
                require(
                    keccak256(bytes(n[i])) == keccak256(bytes(s.names[from + i]))
                        && keccak256(bytes(c[i])) == keccak256(bytes(s.categories[from + i])),
                    string.concat("on chain: character ", vm.toString(from + i), " differs from the JSON")
                );
            }
        }
        require(address(FireCards(cards).dealerOf(s.fire)) == dealer, "on chain: FireCards' dealer for the Series isn't RecipeDealer");
        if (bytes(s.imagesBase).length > 0) {
            require(
                keccak256(bytes(FireCards(cards).imagesBase(s.fire))) == keccak256(bytes(s.imagesBase)),
                "on chain: imagesBase differs from the JSON"
            );
        }
        require(bytes(FireCards(cards).imagesBase(s.fire)).length > 0, "on chain: no imagesBase yet");
        (, bool closed, bool locked,,,) = FireCards(cards).fires(s.fire);
        require(!closed && !locked, "on chain: the Series is already locked");
    }

    /// @dev The recipe calls only (the sale block, if any, is left out).
    function build(string memory json, address dealer, address cards, uint256 batch)
        public
        view
        returns (Call[] memory calls)
    {
        return buildAll(json, dealer, cards, address(0), batch);
    }

    /// @dev The calls, in order. Checks the recipe with the dealer first. With `sale` set and a "sale" block,
    ///      FireSale.configureDrop comes last (it needs the Series ready, so it can't be checked ahead).
    function buildAll(string memory json, address dealer, address cards, address sale, uint256 batch)
        public
        view
        returns (Call[] memory calls)
    {
        require(batch > 0, "CHARACTER_BATCH must be at least 1");
        Series memory s = _parse(json, sale != address(0));
        RecipeDealer(dealer).check(s.recipe); // reverts with the reason if the recipe can't work
        uint256 n = s.names.length;
        require(n > 0, "the recipe has no characters");
        uint256 batches = (n + batch - 1) / batch;
        bool withSale = s.hasSale && sale != address(0);
        bool weighted = s.weights.length > 0;
        calls = new Call[](
            batches + 2 + (weighted ? 1 : 0) + (bytes(s.imagesBase).length > 0 ? 1 : 0) + (withSale ? 1 : 0)
        );
        calls[0] = Call(dealer, abi.encodeCall(RecipeDealer.setRecipe, (s.fire, s.recipe)), "RecipeDealer.setRecipe");
        uint256 k = _characterCalls(calls, s, dealer, batch);
        if (weighted) {
            calls[k++] = Call(
                dealer, abi.encodeCall(RecipeDealer.setCharacterWeights, (s.fire, s.weights)), "RecipeDealer.setCharacterWeights"
            );
        }
        calls[k++] = Call(cards, abi.encodeCall(FireCards.setDealer, (s.fire, dealer)), "FireCards.setDealer");
        if (bytes(s.imagesBase).length > 0) {
            calls[k++] = Call(cards, abi.encodeCall(FireCards.setImagesBase, (s.fire, s.imagesBase)), "FireCards.setImagesBase");
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
        return _parse(json, true);
    }

    /// @dev `withSale` false: the sale block is left unread (batch A doesn't need the drop's start yet).
    function _parse(string memory json, bool withSale) internal view returns (Series memory s) {
        _onlyKeys(json, ".", "fire,imagesBase,cardsPerPack,types,characters,sale");
        s.fire = _num(json, ".fire", type(uint64).max);
        if (json.keyExists(".imagesBase")) s.imagesBase = json.readString(".imagesBase");
        uint256 nt = _count(json, ".types");
        s.recipe.types = new RecipeDealer.CardType[](nt);
        for (uint256 i; i < nt; i++) s.recipe.types[i] = _type(json, string.concat(".types[", vm.toString(i), "]"));
        s.recipe.cardsPerPack = uint32(_num(json, ".cardsPerPack", type(uint32).max));
        uint256 nc = _count(json, ".characters");
        s.names = new string[](nc);
        s.categories = new string[](nc);
        uint256 weighted;
        uint64[] memory w = new uint64[](nc);
        for (uint256 i; i < nc; i++) {
            string memory p = string.concat(".characters[", vm.toString(i), "]");
            _onlyKeys(json, p, "name,category,weight");
            s.names[i] = json.readString(string.concat(p, ".name"));
            s.categories[i] = json.readString(string.concat(p, ".category"));
            if (json.keyExists(string.concat(p, ".weight"))) {
                w[i] = uint64(_num(json, string.concat(p, ".weight"), type(uint64).max));
                require(w[i] > 0, string.concat(p, ".weight: at least 1 (leave every weight out for equal odds)"));
                weighted++;
            }
        }
        require(weighted == 0 || weighted == nc, ".characters: give every character a weight, or none (equal odds)");
        if (weighted > 0) s.weights = w;
        if (withSale && json.keyExists(".sale")) {
            s.drop = parseSale(json);
            s.hasSale = true;
        }
    }

    /// @dev The "sale" block: the drop-wide FireSale.DropConfig fields and its "groups" (FireGroups.Group each), by
    ///      name, in contract units (seconds, 8-decimal dollars, PAPER wei, basis points). DROP_START overrides the
    ///      start and GROUP_ROOT_<i> a snapshot group's root. Shape: docs/cards-contracts.md.
    function parseSale(string memory json) public view returns (FireSale.DropConfig memory c) {
        _onlyKeys(json, ".sale", "start,packs,plankBurnBps,paperBurnBps,paperCapUsd,maxPerTx,regularWalletsFor,creditsPerPick,creditPacksMax,creditPacksPerWallet,creditGroup,groups");
        c.start = uint64(vm.envOr("DROP_START", _u(json, ".sale", "start", type(uint64).max)));
        require(c.start != 0, "sale.start is 0: set it in the studio or with DROP_START");
        require(c.start < block.timestamp + MAX_START_AHEAD, "sale.start is more than a year away: a typo?");
        c.packs = uint64(_u(json, ".sale", "packs", type(uint64).max));
        c.plankBurnBps = uint16(_u(json, ".sale", "plankBurnBps", 10_000));
        c.paperBurnBps = uint16(_u(json, ".sale", "paperBurnBps", 10_000));
        require(uint256(c.plankBurnBps) + c.paperBurnBps <= 10_000, "sale: plankBurnBps + paperBurnBps is over 10000 (100%)");
        c.paperCapUsd = uint128(_u(json, ".sale", "paperCapUsd", type(uint128).max));
        c.maxPerTx = uint32(_u(json, ".sale", "maxPerTx", type(uint32).max));
        c.regularWalletsFor = uint32(_u(json, ".sale", "regularWalletsFor", 30 days));
        c.creditsPerPick = uint16(_u(json, ".sale", "creditsPerPick", type(uint16).max));
        c.creditPacksMax = uint64(_u(json, ".sale", "creditPacksMax", type(uint64).max));
        c.creditPacksPerWallet = uint64(_u(json, ".sale", "creditPacksPerWallet", type(uint64).max));
        c.creditGroup = uint8(_u(json, ".sale", "creditGroup", 255));
        uint256 n = _count(json, ".sale.groups");
        require(n >= 1 && n <= 6, "sale.groups: 1 to 6 groups");
        require(c.creditGroup == 255 || c.creditGroup < n, "sale.creditGroup: the index of a group (0 is the first), or 255 for no credit packs");
        c.groups = new FireGroups.Group[](n);
        uint256 sum;
        for (uint256 i; i < n; i++) {
            c.groups[i] = parseGroup(json, i, n);
            sum += c.groups[i].packs;
        }
        for (uint256 i; i < n; i++) {
            uint8 to = c.groups[i].rollTo;
            require(
                to == 255 || c.groups[to].taxBps == 0,
                string.concat(".sale.groups[", vm.toString(i), "].rollTo: a group with a rising tax (taxBps) takes no leftovers")
            );
        }
        require(
            sum == c.packs,
            string.concat(
                "sale.groups: the groups' packs add up to ", vm.toString(sum), ", not sale.packs (", vm.toString(c.packs),
                "; unlimited groups count 0)"
            )
        );
    }

    /// @dev Group `i` of `n` in the sale block, checked like FireGroups checks it, with the reason by name.
    function parseGroup(string memory json, uint256 i, uint256 n) public view returns (FireGroups.Group memory g) {
        string memory p = string.concat(".sale.groups[", vm.toString(i), "]");
        _onlyKeys(json, p, "name,packs,gate,nft,perNft,root,priceUsd,paper,coins,perWallet,afterGroup,startDelay,duration,rollTo,taxBps,idle,perTx,unlimited");
        g.packs = uint64(_u(json, p, "packs", type(uint64).max));
        g.priceUsd = uint128(_u(json, p, "priceUsd", type(uint128).max));
        g.paper = uint128(_u(json, p, "paper", type(uint128).max));
        g.coins = uint8(_u(json, p, "coins", 7));
        require(g.priceUsd == 0 || g.coins != 0, string.concat(p, ".coins: a dollar price needs a coin (PLANK 1 + ETH 2 + USDG 4)"));
        g.perWallet = uint32(_u(json, p, "perWallet", type(uint32).max));
        g.afterGroup = uint8(_u(json, p, "afterGroup", 255));
        require(g.afterGroup == 255 || g.afterGroup < i, string.concat(p, ".afterGroup: an earlier group's index, or 255 to open with the drop"));
        g.startDelay = uint32(_u(json, p, "startDelay", 30 days));
        g.duration = uint32(_u(json, p, "duration", 30 days));
        g.rollTo = uint8(_u(json, p, "rollTo", 255));
        // optional, 0 = off: end after this long with no sale; most packs per purchase (0 = the drop's maxPerTx)
        if (json.keyExists(string.concat(p, ".idle"))) g.idle = uint32(_u(json, p, "idle", 30 days));
        if (json.keyExists(string.concat(p, ".perTx"))) g.perTx = uint32(_u(json, p, "perTx", type(uint32).max));
        if (json.keyExists(string.concat(p, ".taxBps"))) g.taxBps = uint16(_u(json, p, "taxBps", 5_000)); // optional, 0 = off
        require(g.taxBps == 0 || g.priceUsd != 0, string.concat(p, ".taxBps: a rising tax needs a dollar price"));
        if (json.keyExists(string.concat(p, ".unlimited"))) g.unlimited = json.readBool(string.concat(p, ".unlimited"));
        if (g.unlimited) {
            require(g.packs == 0, string.concat(p, ".packs: 0 for an unlimited group (it has no pack count; it adds on top of sale.packs)"));
            require(
                g.taxBps != 0 && g.idle != 0,
                string.concat(p, ".unlimited: needs taxBps (the rising price caps demand) and idle (so it always ends)")
            );
            require(g.rollTo == 255, string.concat(p, ".rollTo: 255 for an unlimited group"));
        }
        require(g.rollTo == 255 || (g.rollTo > i && g.rollTo < n), string.concat(p, ".rollTo: a later group's index, or 255 for nowhere"));
        bytes32 gate = keccak256(bytes(json.readString(string.concat(p, ".gate"))));
        bool isNft = gate == keccak256("nft");
        bool isSnap = gate == keccak256("snapshot");
        require(isNft || isSnap || gate == keccak256("open"), string.concat(p, ".gate: open, nft or snapshot"));
        require(isNft || (!json.keyExists(string.concat(p, ".nft")) && !json.keyExists(string.concat(p, ".perNft"))), string.concat(p, ": nft and perNft are for gate nft only"));
        require(isSnap || !json.keyExists(string.concat(p, ".root")), string.concat(p, ": root is for gate snapshot only"));
        if (isNft) {
            g.gate = FireGroups.Gate.NFT;
            g.nft = _nft(json, p);
            g.perNft = uint32(_u(json, p, "perNft", type(uint32).max));
            require(g.perNft > 0, string.concat(p, ".perNft: at least 1 pack per NFT"));
        } else if (isSnap) {
            g.gate = FireGroups.Gate.SNAPSHOT;
            if (json.keyExists(string.concat(p, ".root"))) g.root = json.readBytes32(string.concat(p, ".root"));
            bytes32 e = vm.envOr(string.concat("GROUP_ROOT_", vm.toString(i)), bytes32(0)); // 0 = not set
            if (e != 0) g.root = e;
            require(g.root != 0, string.concat(p, ".root is missing: set GROUP_ROOT_", vm.toString(i), " (the snapshot from ops/snapshot)"));
        } else {
            require(g.priceUsd != 0 || g.paper != 0, string.concat(p, ": free packs open to everyone are refused (give it a price, PAPER or a gate)"));
        }
    }

    /// @dev A group's NFT: an address, or "press" for the Paper Press (MILL, from the environment or deployments file).
    function _nft(string memory json, string memory p) internal view returns (address a) {
        string memory v = json.readString(string.concat(p, ".nft"));
        if (keccak256(bytes(v)) == keccak256("press")) {
            a = vm.envOr("MILL", deployedInput("MILL"));
            require(a != address(0), string.concat(p, ".nft is \"press\": set MILL or record it in the deployments file"));
        } else {
            a = vm.parseAddress(v);
        }
    }

    /// @dev A required whole number `key` of the object at `p`, at most `max`.
    function _u(string memory json, string memory p, string memory key, uint256 max) internal view returns (uint256 v) {
        string memory k = string.concat(p, ".", key);
        require(json.keyExists(k), string.concat(k, " is missing"));
        v = json.readUint(k);
        require(v <= max, string.concat(k, " is too big for its field (most ", vm.toString(max), ")"));
    }

    function _type(string memory json, string memory p) internal view returns (RecipeDealer.CardType memory t) {
        _onlyKeys(json, p, "name,slug,rank,weight,holo");
        _onlyKeys(json, string.concat(p, ".holo"), "mode,frame,picture,weights");
        t.name = json.readString(string.concat(p, ".name"));
        t.slug = json.readString(string.concat(p, ".slug"));
        t.rank = uint32(_num(json, string.concat(p, ".rank"), type(uint32).max));
        t.weight = uint64(_num(json, string.concat(p, ".weight"), type(uint64).max));
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
