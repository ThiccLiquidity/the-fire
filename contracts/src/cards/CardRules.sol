// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @notice The card game's fixed numbers, ported exactly from the Card Studio (studio/src/rules.ts and deal.ts). A parity
 *         test checks computePool against the studio's own output.
 *
 *         Materials: 0 Paper, 1 Wood, 2 Fire, 3 Charcoal, 4 Diamond.
 *         Rarity per card: 50 / 30 / 15 / 4.9 / 0.1 %, tracked in integer units of 1/100,000 card so fractional
 *         cards carry from one Fire to the next exactly.
 *         Pack (6 cards): slots 1-3 Paper, 4 Wood, 5 Wood-or-better, 6 Fire-or-better.
 *         Holo: two independent rolls (frame, picture), each at p = 1 - sqrt(1 - rate) for rates 5/10/50/90%, so the
 *         chance of any holo stays at that rate; Diamond is always holo, split evenly frame / picture / full.
 */
library CardRules {
    uint8 internal constant PAPER = 0;
    uint8 internal constant WOOD = 1;
    uint8 internal constant FIRE = 2;
    uint8 internal constant CHARCOAL = 3;
    uint8 internal constant DIAMOND = 4;

    int256 internal constant RATE_SCALE = 100_000;
    uint256 internal constant CARDS_PER_PACK = 6;

    /// @dev Holo roll chances at 1e18 scale: 1 - sqrt(1 - rate) for 5%, 10%, 50%, 90%.
    uint256 internal constant ONE = 1e18;

    error BadPacks();

    function rarityUnits(uint256 m) internal pure returns (int256) {
        if (m == PAPER) return 50_000;
        if (m == WOOD) return 30_000;
        if (m == FIRE) return 15_000;
        if (m == CHARCOAL) return 4_900;
        return 100; // Diamond
    }

    function holoRollChance(uint256 m) internal pure returns (uint256) {
        if (m == PAPER) return 25320565519103609;
        if (m == WOOD) return 51316701949486200;
        if (m == FIRE) return 292893218813452475;
        if (m == CHARCOAL) return 683772233983162066;
        return ONE;
    }

    /// @notice A card's holo from two random words. Diamond: 1/3 frame, 1/3 picture, 1/3 full.
    function rollHolo(uint256 m, uint256 r1, uint256 r2) internal pure returns (bool frame, bool picture) {
        if (m == DIAMOND) {
            uint256 k = r1 % 3;
            return (k != 1, k != 0);
        }
        uint256 p = holoRollChance(m);
        return (r1 % ONE < p, r2 % ONE < p);
    }

    /**
     * @notice This Fire's pool sizes from the carried accumulators. Same steps as the studio's computePool:
     *         every tier accrues rate x cards; Paper is exactly 3 x packs; the other four take the whole part of
     *         their accumulator; a shortfall goes one card at a time to the largest leftover fraction (ties: the more
     *         common tier), a surplus comes off the smallest; then the pack floor is enforced (Wood >= packs and
     *         packs <= Fire-or-better <= 2 x packs). Carries can go slightly negative (a borrowed card) and always
     *         sum to the same total, so nothing is created or lost across Fires.
     */
    function computePool(int256[5] memory before, uint256 packs)
        internal
        pure
        returns (uint256[5] memory counts, int256[5] memory carry)
    {
        if (packs > type(uint32).max) revert BadPacks();
        int256 cards = int256(packs * CARDS_PER_PACK);
        int256[5] memory acc;
        for (uint256 m; m < 5; m++) acc[m] = before[m] + rarityUnits(m) * cards;
        counts[PAPER] = 3 * packs;
        for (uint256 m = WOOD; m < 5; m++) counts[m] = acc[m] <= 0 ? 0 : uint256(acc[m] / RATE_SCALE);

        uint256 need = 3 * packs;
        uint256 have = counts[WOOD] + counts[FIRE] + counts[CHARCOAL] + counts[DIAMOND];
        while (have < need) { counts[_largest(acc, counts, WOOD)]++; have++; }
        while (have > need) { counts[_smallest(acc, counts, WOOD)]--; have--; }

        uint256 bp = counts[FIRE] + counts[CHARCOAL] + counts[DIAMOND];
        while (bp < packs) { counts[WOOD]--; counts[_largest(acc, counts, FIRE)]++; bp++; }
        while (bp > 2 * packs) { counts[_smallest(acc, counts, FIRE)]--; counts[WOOD]++; bp--; }

        for (uint256 m; m < 5; m++) carry[m] = acc[m] - int256(counts[m]) * RATE_SCALE;
    }

    function _frac(int256[5] memory acc, uint256[5] memory counts, uint256 m) private pure returns (int256) {
        return acc[m] - int256(counts[m]) * RATE_SCALE;
    }

    /// @dev Tier from `from`..Diamond with the largest remaining fraction; ties go to the more common (earlier) tier.
    function _largest(int256[5] memory acc, uint256[5] memory counts, uint256 from) private pure returns (uint256 best) {
        best = from;
        for (uint256 t = from + 1; t < 5; t++) if (_frac(acc, counts, t) > _frac(acc, counts, best)) best = t;
    }

    /// @dev Tier from `from`..Diamond that has a card and the smallest remaining fraction; ties: the earlier tier.
    function _smallest(int256[5] memory acc, uint256[5] memory counts, uint256 from) private pure returns (uint256 worst) {
        bool found;
        for (uint256 t = from; t < 5; t++) {
            if (counts[t] > 0 && (!found || _frac(acc, counts, t) < _frac(acc, counts, worst))) { worst = t; found = true; }
        }
        require(found, "computePool: nothing to take");
    }
}
