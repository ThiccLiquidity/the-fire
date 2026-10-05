// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RecipeDealer} from "./RecipeDealer.sol";

/**
 * @title StandardRecipe
 * @notice The original Omni recipe as a RecipeDealer recipe, ported exactly from the Card Studio (studio/src/rules.ts
 *         and deal.ts). A parity test checks its pool against the studio's own computePool.
 *
 *         Types: Paper (3 per pack), Wood (the rest), Fire (15% of the cards), Coal (4.9%), Diamond (as set, at
 *         least 1, at most one per pack's worth). Pack of 6: slots 1-3 Paper, 4 Wood, 5 Wood-or-better, 6
 *         Fire-or-better. Holo: two independent rolls (frame, picture), each at 1 - sqrt(1 - rate) for 5/10/50/90%,
 *         so the chance of any holo is that rate; Diamond is always holo, a third each frame / picture / full.
 *         The floor (Fire-or-better between P and 2P per Series) is the dealer's general floor rule.
 */
library StandardRecipe {
    uint8 internal constant PAPER = 0;
    uint8 internal constant WOOD = 1;
    uint8 internal constant FIRE = 2;
    uint8 internal constant COAL = 3;
    uint8 internal constant DIAMOND = 4;

    /// @dev Holo roll chances at 1e18 scale: 1 - sqrt(1 - rate) for 5%, 10%, 50%, 90%.
    uint64 internal constant PAPER_ROLL = 25320565519103609;
    uint64 internal constant WOOD_ROLL = 51316701949486200;
    uint64 internal constant FIRE_ROLL = 292893218813452475;
    uint64 internal constant COAL_ROLL = 683772233983162066;

    function build(uint256 diamonds) internal pure returns (RecipeDealer.Recipe memory r) {
        r.types = new RecipeDealer.CardType[](5);
        r.types[PAPER] = _independent("Paper", "paper", 0, RecipeDealer.Supply.PerPack, 3, 0, PAPER_ROLL);
        r.types[WOOD] = _independent("Wood", "wood", 1, RecipeDealer.Supply.Filler, 0, 0, WOOD_ROLL);
        r.types[FIRE] = _independent("Fire", "fire", 2, RecipeDealer.Supply.Share, 150_000_000, 0, FIRE_ROLL);
        r.types[COAL] = _independent("Coal", "coal", 3, RecipeDealer.Supply.Share, 49_000_000, 0, COAL_ROLL);
        r.types[DIAMOND] = RecipeDealer.CardType({
            name: "Diamond", slug: "diamond", rank: 4, supply: RecipeDealer.Supply.Count,
            amount: uint128(diamonds == 0 ? 1 : diamonds), maxPerPack: 1,
            holoMode: RecipeDealer.HoloMode.Distribution, holo: [uint64(0), 1, 1, 1]
        });
        r.slots = new RecipeDealer.Slot[](4);
        r.slots[0] = _exact(3, PAPER);
        r.slots[1] = _exact(1, WOOD);
        r.slots[2] = _range(1, 1, type(uint32).max); // Wood-or-better
        r.slots[3] = _range(1, 2, type(uint32).max); // Fire-or-better
    }

    function _independent(
        string memory name,
        string memory slug,
        uint32 rank,
        RecipeDealer.Supply supply,
        uint128 amount,
        uint64 maxPerPack,
        uint64 roll
    ) internal pure returns (RecipeDealer.CardType memory) {
        return RecipeDealer.CardType({
            name: name, slug: slug, rank: rank, supply: supply, amount: amount, maxPerPack: maxPerPack,
            holoMode: RecipeDealer.HoloMode.Independent, holo: [roll, roll, 0, 0]
        });
    }

    function _exact(uint32 count, uint32 t) internal pure returns (RecipeDealer.Slot memory s) {
        s.count = count;
        s.types = new uint32[](1);
        s.types[0] = t;
    }

    function _range(uint32 count, uint32 minRank, uint32 maxRank) internal pure returns (RecipeDealer.Slot memory s) {
        s.count = count;
        s.minRank = minRank;
        s.maxRank = maxRank;
    }
}
