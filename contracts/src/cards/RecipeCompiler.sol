// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RecipeDealer} from "./RecipeDealer.sol";

/**
 * @title RecipeCompiler
 * @notice RecipeDealer's recipe checker and compiler, as its own contract (pure, no state, no owner). `compile`
 *         checks a recipe and turns it into the plan the dealer reads for every card: the types' cumulative weights
 *         and holo odds.
 */
contract RecipeCompiler {
    uint256 public constant HOLO_ONE = 1e18;
    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_SLUG_BYTES = 32;
    /// @dev The same limit as FireCards.MAX_CARDS_PER_PACK (one pack's dealing and shuffle fit in a block).
    uint256 public constant MAX_CARDS_PER_PACK = 1_000;

    error BadText();
    /// @notice The recipe has no type, or a cards-per-pack outside 1 to MAX_CARDS_PER_PACK.
    error BadRecipe(string why);
    error BadType(uint256 index, string why);

    // Plan layout (uint256 words): types, cards per pack, total weight, then per type: cumulative weight, holo mode,
    // holo[0..3]. RecipeDealer reads the same layout.
    uint256 private constant HEADER = 3;
    uint256 private constant TW = 6;

    /// @notice Check a recipe and compile it. Reverts with the reason if it isn't valid.
    function compile(RecipeDealer.Recipe memory r) external pure returns (bytes memory plan, uint256 perPack) {
        uint256 n = r.types.length;
        if (n == 0 || n > type(uint32).max) revert BadRecipe("no types");
        perPack = r.cardsPerPack;
        if (perPack == 0 || perPack > MAX_CARDS_PER_PACK) revert BadRecipe("cards per pack");
        uint256[] memory p = new uint256[](HEADER + n * TW);
        p[0] = n;
        p[1] = perPack;
        bytes32[] memory slugs = new bytes32[](n);
        uint256 total;
        for (uint256 t; t < n; t++) {
            RecipeDealer.CardType memory c = r.types[t];
            uint256 len = bytes(c.name).length;
            if (len == 0 || len > MAX_NAME_BYTES) revert BadType(t, "name length");
            _checkText(bytes(c.name));
            bytes memory s = bytes(c.slug);
            if (s.length == 0 || s.length > MAX_SLUG_BYTES) revert BadType(t, "slug length");
            for (uint256 i; i < s.length; i++) {
                bytes1 ch = s[i];
                if (!((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch == "-")) revert BadType(t, "slug characters");
            }
            slugs[t] = keccak256(s);
            for (uint256 u; u < t; u++) if (slugs[u] == slugs[t]) revert BadType(t, "slug repeated");
            if (c.weight == 0) revert BadType(t, "weight");
            if (c.holoMode == RecipeDealer.HoloMode.Independent) {
                if (c.holo[0] > HOLO_ONE || c.holo[1] > HOLO_ONE || c.holo[2] != 0 || c.holo[3] != 0) revert BadType(t, "holo chances");
            } else if (uint256(c.holo[0]) + c.holo[1] + c.holo[2] + c.holo[3] == 0) {
                revert BadType(t, "holo weights");
            }
            total += c.weight;
            uint256 at = HEADER + t * TW;
            p[at] = total;
            p[at + 1] = uint256(c.holoMode);
            for (uint256 i; i < 4; i++) p[at + 2 + i] = c.holo[i];
        }
        p[2] = total;
        plan = abi.encodePacked(p);
    }

    /// @dev Text that goes into the token JSON as-is: valid UTF-8, no quotes, backslashes or control characters.
    function _checkText(bytes memory b) internal pure {
        uint256 i;
        while (i < b.length) {
            uint8 c = uint8(b[i]);
            if (c < 0x80) {
                if (c < 0x20 || c == 0x22 || c == 0x5c || c == 0x7f) revert BadText();
                i++;
                continue;
            }
            uint256 n = c >= 0xc2 && c <= 0xdf ? 1 : c >= 0xe0 && c <= 0xef ? 2 : c >= 0xf0 && c <= 0xf4 ? 3 : 0;
            if (n == 0 || i + n >= b.length) revert BadText(); // a lead byte with its continuation bytes missing
            uint8 lo = 0x80;
            uint8 hi = 0xbf;
            if (c == 0xe0) lo = 0xa0; // no overlong 3-byte forms
            else if (c == 0xed) hi = 0x9f; // no UTF-16 surrogates
            else if (c == 0xf0) lo = 0x90; // no overlong 4-byte forms
            else if (c == 0xf4) hi = 0x8f; // nothing past U+10FFFF
            uint8 c1 = uint8(b[i + 1]);
            if (c1 < lo || c1 > hi) revert BadText();
            for (uint256 k = 2; k <= n; k++) if (uint8(b[i + k]) & 0xc0 != 0x80) revert BadText();
            i += n + 1;
        }
    }
}
