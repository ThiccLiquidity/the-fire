// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base64} from "openzeppelin-contracts/contracts/utils/Base64.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";
import {IDealer} from "./IDealer.sol";
import {FireCards} from "./FireCards.sol";

/**
 * @title CardsRenderer
 * @notice Writes each card's metadata JSON for FireCards (set once there). No owner, no settings: everything comes
 *         from FireCards and the Series' dealer.
 *
 *         Image: <Series image folder>c<character>-<type slug>-<holo>-<state>.webp, holo none|frame|picture|full,
 *         state `u` (ungraded), `c` (cased) or `1`-`10` (slabbed at that grade). The Card Studio builds every one.
 *
 *         Traits: Character, Category, Material, Holo, Series, Edition, Serial, PDA. An ungraded card adds Cased,
 *         Uncased Age (days) and Moves, so a buyer can see what it has been through; its condition is never shown.
 *         A slabbed card shows its grade only.
 */
contract CardsRenderer {
    using Strings for uint256;

    FireCards public immutable CARDS;

    constructor(address cards) {
        CARDS = FireCards(cards);
    }

    function tokenURI(uint256 serial) external view returns (string memory) {
        FireCards.Card memory c = CARDS.cardOf(serial);
        IDealer.CardText memory t = CARDS.dealerOf(c.fire).cardText(c.fire, c.cardType, c.character, c.extra);
        string memory json = string.concat(
            '{"name":"', t.typeName, " ", t.characterName, " #", serial.toString(),
            '","image":"', CARDS.imagesBase(c.fire), imageName(c.character, t.typeSlug, c.holoFrame, c.holoPicture, c.grade, c.cased),
            '","attributes":', _attributes(c, t, serial), "}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice A card's image file in its Series' image folder.
    function imageFile(uint256 serial) external view returns (string memory) {
        FireCards.Card memory c = CARDS.cardOf(serial);
        IDealer.CardText memory t = CARDS.dealerOf(c.fire).cardText(c.fire, c.cardType, c.character, c.extra);
        return imageName(c.character, t.typeSlug, c.holoFrame, c.holoPicture, c.grade, c.cased);
    }

    /// @notice Image file names: c<character>-<type slug>-<holo>-<state>.webp (the studio's export uses the same).
    function imageName(uint256 character, string memory slug, bool holoFrame, bool holoPicture, uint256 grade, bool cased)
        public
        pure
        returns (string memory)
    {
        return string.concat(
            "c", character.toString(), "-", slug, "-", _holo(holoFrame, holoPicture), "-",
            grade != 0 ? grade.toString() : cased ? "c" : "u", ".webp"
        );
    }

    function _attributes(FireCards.Card memory c, IDealer.CardText memory t, uint256 serial) private pure returns (string memory) {
        string memory edition = c.editionOf == 0 ? c.edition.toString() : string.concat(c.edition.toString(), " of ", c.editionOf.toString());
        string memory head = string.concat( // in parts: one concat of everything is too deep for the stack
            '[{"trait_type":"Character","value":"', t.characterName,
            '"},{"trait_type":"Category","value":"', t.category,
            '"},{"trait_type":"Material","value":"', t.typeName,
            '"},{"trait_type":"Holo","value":"', _holoLabel(c.holoFrame, c.holoPicture)
        );
        string memory mid = string.concat(
            '"},{"trait_type":"Series","value":', c.fire.toString(), ',"display_type":"number"},{"trait_type":"Edition","value":"', edition,
            '"},{"trait_type":"Serial","value":', serial.toString(), ',"display_type":"number"}'
        );
        string memory wear = c.grade != 0
            ? string.concat(',{"trait_type":"PDA","value":"PDA ', c.grade.toString(), '"}')
            : string.concat(
                ',{"trait_type":"PDA","value":"Ungraded"},{"trait_type":"Cased","value":"', c.cased ? "Yes" : "No",
                '"},{"trait_type":"Uncased Age (days)","value":', (c.age / 1 days).toString(),
                ',"display_type":"number"},{"trait_type":"Moves","value":', c.moves.toString(), ',"display_type":"number"}'
            );
        return string.concat(head, mid, wear, t.extraAttributes, "]");
    }

    function _holo(bool f, bool p) private pure returns (string memory) {
        return f && p ? "full" : f ? "frame" : p ? "picture" : "none";
    }

    function _holoLabel(bool f, bool p) private pure returns (string memory) {
        return f && p ? "Full" : f ? "Frame" : p ? "Picture" : "None";
    }
}
