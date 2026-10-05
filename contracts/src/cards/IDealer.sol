// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IDealer
 * @notice What FireCards asks of a Series' dealer. FireCards keeps the permanent parts (the cards, the opening queue,
 *         randomness, serials, editions, PDA grades, tokenURI); the dealer decides what a Series' cards are. The owner
 *         picks a dealer per Series (FireCards.setDealer), and it is fixed once the Series' first pack is minted.
 *
 *         A dealer keeps its own per-Series state (what is left to deal). FireCards calls `deal` strictly in order:
 *         packs in the order they were opened, and each pack's cards from position 0 to cardsPerPack - 1, possibly
 *         over several calls (big packs are dealt in chunks). The result must depend only on `seed`, the position and
 *         the dealer's state, so it never matters who processes or how the work is split.
 */
interface IDealer {
    /// @notice Display text for one card (all of it goes into the token JSON as-is, so the dealer must keep it free
    ///         of quotes, backslashes and control characters).
    struct CardText {
        string typeName; // the "Material" trait and the first word of the card's name, e.g. "Diamond"
        string typeSlug; // lowercase [a-z0-9-], used in image file names, e.g. "diamond"
        string characterName;
        string category;
        string extraAttributes; // more JSON attributes, each starting with a comma, or ""
    }

    /// @notice True once `fire` is fully set up in this dealer (FireCards and the sale refuse a Series before that).
    ///         Once true it must stay true.
    function ready(uint256 fire) external view returns (bool);

    /// @notice Cards in one pack of `fire`. Fixed once the Series' first pack is minted.
    function cardsPerPack(uint256 fire) external view returns (uint256);

    /// @notice Characters in `fire` (the sale caps suggestion picks at this).
    function characterCount(uint256 fire) external view returns (uint256);

    /// @notice Deal cards `fromCard` .. `fromCard + count - 1` of the next pack of `fire` (position 0 starts a new
    ///         pack). Only FireCards calls it, and only after the Series is closed. One word per card: bits 0-31 the
    ///         card type, 32-63 the character, bit 64 holo frame, bit 65 holo picture, 96-127 extra (dealer-defined,
    ///         stored with the card and handed back to `cardText`).
    function deal(uint256 fire, uint256 seed, uint256 fromCard, uint256 count) external returns (uint256[] memory cards);

    /// @notice The text FireCards puts in a card's metadata.
    function cardText(uint256 fire, uint256 cardType, uint256 character, uint256 extra)
        external
        view
        returns (CardText memory);
}
