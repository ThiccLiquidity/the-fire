// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RecipeDealer} from "./RecipeDealer.sol";

/**
 * @title StandardRecipe
 * @notice The standard Omni recipe as a RecipeDealer recipe: 6 cards a pack in four slots, each card rolled on its own
 *         from its slot's fixed odds:
 *         - slot 1, 3 cards: Paper
 *         - slot 2, 1 card: Wood
 *         - slot 3, 1 card, Wood or better (out of 1,000): Wood 449, Fire 300, Coal 120, Gold 86, Full Art 45
 *         - slot 4, 1 card, Fire or better (out of 10,000): Fire 5,982, Coal 1,734, Gold 1,534, Full Art 750
 *         Per pack that is on average 3 Paper, 1.449 Wood, 0.8982 Fire, 0.2934 Coal, 0.2394 Gold and 0.12 Full Art:
 *         exactly the averages of the straight odds it replaces (50 / 24.15 / 14.97 / 4.89 / 3.99 / 2% of 6 cards).
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

    /// @dev The slots, in pack order.
    uint8 internal constant SLOT_PAPER = 0;
    uint8 internal constant SLOT_WOOD = 1;
    uint8 internal constant SLOT_WOOD_UP = 2;
    uint8 internal constant SLOT_FIRE_UP = 3;
    uint32 internal constant PAPER_COUNT = 3;

    /// @dev Slot 3 ("Wood or better") weights, out of 1,000.
    uint64 internal constant WOOD_UP_TOTAL = 1_000;
    uint64 internal constant WOOD_UP_WOOD = 449;
    uint64 internal constant WOOD_UP_FIRE = 300;
    uint64 internal constant WOOD_UP_COAL = 120;
    uint64 internal constant WOOD_UP_GOLD = 86;
    uint64 internal constant WOOD_UP_FULL_ART = 45;
    /// @dev Slot 4 ("Fire or better") weights, out of 10,000.
    uint64 internal constant FIRE_UP_TOTAL = 10_000;
    uint64 internal constant FIRE_UP_FIRE = 5_982;
    uint64 internal constant FIRE_UP_COAL = 1_734;
    uint64 internal constant FIRE_UP_GOLD = 1_534;
    uint64 internal constant FIRE_UP_FULL_ART = 750;

    /// @dev Holo roll chances at 1e18 scale: 1 - sqrt(1 - rate) for 5%, 10%, 50%, 90%.
    uint64 internal constant PAPER_ROLL = 25320565519103609;
    uint64 internal constant WOOD_ROLL = 51316701949486200;
    uint64 internal constant FIRE_ROLL = 292893218813452475;
    uint64 internal constant COAL_ROLL = 683772233983162066;

    /// @notice The Standard recipe.
    function build() internal pure returns (RecipeDealer.Recipe memory r) {
        r.types = new RecipeDealer.CardType[](6);
        r.types[PAPER] = _independent("Paper", "paper", 0, PAPER_ROLL);
        r.types[WOOD] = _independent("Wood", "wood", 1, WOOD_ROLL);
        r.types[FIRE] = _independent("Fire", "fire", 2, FIRE_ROLL);
        r.types[COAL] = _independent("Coal", "coal", 3, COAL_ROLL);
        r.types[GOLD] = _full("Gold", "gold", 4);
        r.types[FULL_ART] = _full("Full Art", "fullart", 5);
        r.slots = new RecipeDealer.Slot[](4);
        r.slots[SLOT_PAPER] = _slot(PAPER_COUNT, [uint64(1), 0, 0, 0, 0, 0]);
        r.slots[SLOT_WOOD] = _slot(1, [uint64(0), 1, 0, 0, 0, 0]);
        r.slots[SLOT_WOOD_UP] = _slot(1, [uint64(0), WOOD_UP_WOOD, WOOD_UP_FIRE, WOOD_UP_COAL, WOOD_UP_GOLD, WOOD_UP_FULL_ART]);
        r.slots[SLOT_FIRE_UP] = _slot(1, [uint64(0), 0, FIRE_UP_FIRE, FIRE_UP_COAL, FIRE_UP_GOLD, FIRE_UP_FULL_ART]);
    }

    function _slot(uint32 count, uint64[6] memory w) internal pure returns (RecipeDealer.Slot memory s) {
        s.count = count;
        s.weights = new uint64[](6);
        for (uint256 i; i < 6; i++) s.weights[i] = w[i];
    }

    function _independent(string memory name, string memory slug, uint32 rank, uint64 roll)
        internal
        pure
        returns (RecipeDealer.CardType memory)
    {
        return RecipeDealer.CardType({
            name: name, slug: slug, rank: rank, holoMode: RecipeDealer.HoloMode.Independent, holo: [roll, roll, 0, 0]
        });
    }

    function _full(string memory name, string memory slug, uint32 rank) internal pure returns (RecipeDealer.CardType memory) {
        return RecipeDealer.CardType({
            name: name, slug: slug, rank: rank, holoMode: RecipeDealer.HoloMode.Distribution, holo: [uint64(0), 0, 0, 1]
        });
    }
}
