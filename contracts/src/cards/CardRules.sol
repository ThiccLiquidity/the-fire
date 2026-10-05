// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title CardRules
 * @notice The card game's fixed numbers, ported exactly from the Card Studio (studio/src/rules.ts and deal.ts). A parity
 *         test checks computePool against the studio's own output.
 *
 *         Materials: 0 Paper, 1 Wood, 2 Fire, 3 Coal, 4 Diamond.
 *         Each Series stands alone (nothing carries from one Series to the next). Per Series of P packs (N = 6P
 *         cards): Paper 3P; Fire 15% and Coal 4.9% of N, rounded half up; Diamond as the owner set it (at least
 *         1, at most one per pack); Wood the rest; then the pack floor (see computePool).
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

    uint256 internal constant SHARE_SCALE = 100_000; // shares in units of 1/100,000 card
    uint256 internal constant FIRE_SHARE = 15_000; // 15%
    uint256 internal constant CHARCOAL_SHARE = 4_900; // 4.9%
    uint256 internal constant CARDS_PER_PACK = 6;

    /// @dev Holo roll chances at 1e18 scale: 1 - sqrt(1 - rate) for 5%, 10%, 50%, 90%.
    uint256 internal constant ONE = 1e18;

    error BadPacks();

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
     * @notice A Series' pool sizes. Same steps as the studio's computePool (studio/src/deal.ts), integers only:
     *         Paper = 3P; Fire = round_half_up(15% x N); Coal = round_half_up(4.9% x N); Diamond = min(diamonds, P)
     *         with diamonds >= 1 (0 when P = 0); Wood = the rest. Then the pack floor: while Fire-or-better > 2P, move
     *         a Fire (or, with none left, a Coal) to Wood; while it is < P, move a Wood to Fire. So Wood >= P. (Done
     *         in one step each here; the result is the same.)
     */
    function computePool(uint256 packs, uint256 diamonds) internal pure returns (uint256[5] memory counts) {
        if (packs > type(uint32).max) revert BadPacks();
        uint256 cards = packs * CARDS_PER_PACK;
        uint256 fire = (FIRE_SHARE * cards + SHARE_SCALE / 2) / SHARE_SCALE;
        uint256 charcoal = (CHARCOAL_SHARE * cards + SHARE_SCALE / 2) / SHARE_SCALE;
        uint256 diamond = packs == 0 ? 0 : _min(diamonds == 0 ? 1 : diamonds, packs);
        // the floor in one step each (same result as moving one card at a time)
        uint256 bp = fire + charcoal + diamond;
        if (bp > 2 * packs) {
            uint256 over = bp - 2 * packs;
            uint256 fromFire = _min(over, fire);
            fire -= fromFire;
            charcoal -= over - fromFire;
        } else if (bp < packs) {
            fire += packs - bp;
        }
        counts[PAPER] = 3 * packs;
        counts[WOOD] = 3 * packs - fire - charcoal - diamond;
        counts[FIRE] = fire;
        counts[CHARCOAL] = charcoal;
        counts[DIAMOND] = diamond;
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
