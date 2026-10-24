// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RecipeDealer} from "./RecipeDealer.sol";

/**
 * @title StandardRecipe
 * @notice The standard Omni recipe as a RecipeDealer recipe: 6 cards a pack, every card rolled on its own from fixed
 *         odds (out of 10,000): Paper 5,000 (50%), Wood 2,415 (24.15%), Fire 1,497 (14.97%), Coal 489 (4.89%), Gold
 *         399 (3.99%), Full Art 200 (2%). These keep the expected share of each type per card of the old pool
 *         dealing (167 packs, 20 characters: 501 Paper, 242 Wood, 150 Fire, 49 Coal, 40 Gold, 20 Full Art of 1,002).
 *         Holo: two independent rolls (frame, picture), each at 1 - sqrt(1 - rate) for 5/10/50/90%, so the chance
 *         of any holo is that rate; Gold and Full Art are always full holo. Characters: equal odds.
 */
library StandardRecipe {
    uint8 internal constant PAPER = 0;
    uint8 internal constant WOOD = 1;
    uint8 internal constant FIRE = 2;
    uint8 internal constant COAL = 3;
    uint8 internal constant GOLD = 4;
    uint8 internal constant FULL_ART = 5;
    uint32 internal constant CARDS_PER_PACK = 6;
    uint256 internal constant TOTAL_WEIGHT = 10_000;

    /// @dev Type weights, out of TOTAL_WEIGHT.
    uint64 internal constant PAPER_WEIGHT = 5_000;
    uint64 internal constant WOOD_WEIGHT = 2_415;
    uint64 internal constant FIRE_WEIGHT = 1_497;
    uint64 internal constant COAL_WEIGHT = 489;
    uint64 internal constant GOLD_WEIGHT = 399;
    uint64 internal constant FULL_ART_WEIGHT = 200;

    /// @dev Holo roll chances at 1e18 scale: 1 - sqrt(1 - rate) for 5%, 10%, 50%, 90%.
    uint64 internal constant PAPER_ROLL = 25320565519103609;
    uint64 internal constant WOOD_ROLL = 51316701949486200;
    uint64 internal constant FIRE_ROLL = 292893218813452475;
    uint64 internal constant COAL_ROLL = 683772233983162066;

    /// @notice The Standard recipe.
    function build() internal pure returns (RecipeDealer.Recipe memory r) {
        r.cardsPerPack = CARDS_PER_PACK;
        r.types = new RecipeDealer.CardType[](6);
        r.types[PAPER] = _independent("Paper", "paper", 0, PAPER_WEIGHT, PAPER_ROLL);
        r.types[WOOD] = _independent("Wood", "wood", 1, WOOD_WEIGHT, WOOD_ROLL);
        r.types[FIRE] = _independent("Fire", "fire", 2, FIRE_WEIGHT, FIRE_ROLL);
        r.types[COAL] = _independent("Coal", "coal", 3, COAL_WEIGHT, COAL_ROLL);
        r.types[GOLD] = _full("Gold", "gold", 4, GOLD_WEIGHT);
        r.types[FULL_ART] = _full("Full Art", "fullart", 5, FULL_ART_WEIGHT);
    }

    function _independent(string memory name, string memory slug, uint32 rank, uint64 weight, uint64 roll)
        internal
        pure
        returns (RecipeDealer.CardType memory)
    {
        return RecipeDealer.CardType({
            name: name, slug: slug, rank: rank, weight: weight, holoMode: RecipeDealer.HoloMode.Independent,
            holo: [roll, roll, 0, 0]
        });
    }

    function _full(string memory name, string memory slug, uint32 rank, uint64 weight)
        internal
        pure
        returns (RecipeDealer.CardType memory)
    {
        return RecipeDealer.CardType({
            name: name, slug: slug, rank: rank, weight: weight, holoMode: RecipeDealer.HoloMode.Distribution,
            holo: [uint64(0), 0, 0, 1]
        });
    }
}
