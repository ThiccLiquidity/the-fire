// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";

/// @dev Setting up a Series the way the owner does: recipe and characters in the dealer, then the dealer and image
///      folder in the card contract.
abstract contract SeriesHelper is Test {
    function _chars(uint256 n) internal pure returns (string[] memory names, string[] memory cats) {
        names = new string[](n);
        cats = new string[](n);
        for (uint256 i; i < n; i++) {
            names[i] = string.concat("Char", vm.toString(i));
            cats[i] = string.concat("Cat ", vm.toString(i % 7));
        }
    }

    function _series(FireCards cards, RecipeDealer dealer, address owner_, uint256 fire, RecipeDealer.Recipe memory r, uint256 nChars)
        internal
    {
        (string[] memory names, string[] memory cats) = _chars(nChars);
        vm.startPrank(owner_, owner_);
        dealer.setRecipe(fire, r);
        dealer.setCharacters(fire, names, cats);
        cards.setDealer(fire, address(dealer));
        cards.setImagesBase(fire, "ipfs://images/");
        vm.stopPrank();
    }

    /// The Standard recipe with `nChars` characters.
    function _standard(FireCards cards, RecipeDealer dealer, address owner_, uint256 fire, uint256 nChars) internal {
        _series(cards, dealer, owner_, fire, StandardRecipe.build(), nChars);
    }

    /// A recipe of `types` with `perPack` cards a pack.
    function _recipe(RecipeDealer.CardType[] memory types, uint32 perPack) internal pure returns (RecipeDealer.Recipe memory r) {
        r.types = types;
        r.cardsPerPack = perPack;
    }

    // ---------- recipe building ----------

    function _type(string memory name, string memory slug, uint32 rank, uint64 weight)
        internal
        pure
        returns (RecipeDealer.CardType memory t)
    {
        t.name = name;
        t.slug = slug;
        t.rank = rank;
        t.weight = weight;
        t.holoMode = RecipeDealer.HoloMode.Independent;
    }

    function _holoWeights(RecipeDealer.CardType memory t, uint64 none, uint64 frame, uint64 picture, uint64 full)
        internal
        pure
        returns (RecipeDealer.CardType memory)
    {
        t.holoMode = RecipeDealer.HoloMode.Distribution;
        t.holo = [none, frame, picture, full];
        return t;
    }

    function _holoChances(RecipeDealer.CardType memory t, uint64 frame, uint64 picture)
        internal
        pure
        returns (RecipeDealer.CardType memory)
    {
        t.holoMode = RecipeDealer.HoloMode.Independent;
        t.holo = [frame, picture, 0, 0];
        return t;
    }

    function _ids(uint256 from, uint256 n) internal pure returns (uint256[] memory ids) {
        ids = new uint256[](n);
        for (uint256 i; i < n; i++) ids[i] = from + i;
    }

    function _contains(string memory s, string memory sub) internal pure returns (bool) {
        bytes memory a = bytes(s);
        bytes memory b = bytes(sub);
        if (b.length > a.length) return false;
        for (uint256 i; i + b.length <= a.length; i++) {
            bool ok = true;
            for (uint256 j; j < b.length && ok; j++) if (a[i + j] != b[j]) ok = false;
            if (ok) return true;
        }
        return false;
    }

    function _after(bytes memory b, uint256 from) internal pure returns (bytes memory r) {
        r = new bytes(b.length - from);
        for (uint256 i; i < r.length; i++) r[i] = b[from + i];
    }

    function _b64decode(bytes memory d) internal pure returns (bytes memory out) {
        bytes memory t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint8[256] memory v;
        for (uint256 i; i < 64; i++) v[uint8(t[i])] = uint8(i);
        uint256 pad = d.length > 0 && d[d.length - 1] == "=" ? (d[d.length - 2] == "=" ? 2 : 1) : 0;
        out = new bytes(d.length / 4 * 3 - pad);
        uint256 o;
        for (uint256 i; i < d.length; i += 4) {
            uint256 n = (uint256(v[uint8(d[i])]) << 18) | (uint256(v[uint8(d[i + 1])]) << 12)
                | (uint256(v[uint8(d[i + 2])]) << 6) | uint256(v[uint8(d[i + 3])]);
            for (uint256 k; k < 3 && o < out.length; k++) out[o++] = bytes1(uint8(n >> (16 - 8 * k)));
        }
    }

    /// The token JSON behind a data: URI.
    function _json(string memory uri) internal pure returns (string memory) {
        return string(_b64decode(_after(bytes(uri), 29))); // "data:application/json;base64,"
    }
}

/// @dev Exposes the dealer's internals for exact checks (holo rolls on a compiled recipe).
contract RecipeHarness is RecipeDealer {
    constructor(address cards) RecipeDealer(msg.sender, cards, address(new RecipeCompiler())) {}

    function compile(Recipe memory r) external view returns (bytes memory plan) {
        (plan,) = COMPILER.compile(r);
    }

    function holo(bytes memory plan, uint256 t, uint256 r1, uint256 r2) external pure returns (bool, bool) {
        return _holo(plan, t, r1, r2);
    }
}
