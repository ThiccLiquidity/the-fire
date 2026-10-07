// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {stdJson} from "forge-std/StdJson.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {CardsRenderer} from "../../src/cards/CardsRenderer.sol";
import {ConfigureSeries} from "../../script/ConfigureSeries.s.sol";
import {SeriesHelper} from "./SeriesHelper.sol";
import {MockRandomness} from "../Mocks.sol";

/// @dev Image-name parity (review item 22). test/cards/image-parity/<i>.json is a recipe.json the studio exports and
///      <i>.files.json the image files the studio builds for it (studio/scripts/image-parity.test.ts writes both and
///      fails when they drift from the studio). For each recipe:
///      1. every holo look the dealer can produce for each card type (from the recipe as stored, with the dealer's own
///         rules: chances or weights, must-holo groups), for every character and every state (u, c, PDA 1-10), named by
///         CardsRenderer.imageName, is in the studio's list, and the two lists are the same size: the sets are equal;
///      2. dealing real packs through FireCards and RecipeDealer, every card's CardsRenderer.imageFile is in the
///         studio's list and is one of the looks in (1), ungraded, cased and graded.
contract ImageParityTest is SeriesHelper {
    using stdJson for string;

    string constant DIR = "test/cards/image-parity/";
    uint256 constant ONE = 1e18;
    string[12] STATE_NAMES = ["u", "c", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

    FirePacks packs;
    FireCards cards;
    RecipeDealer dealer;
    CardsRenderer renderer;
    MockRandomness rng;
    ConfigureSeries cs;
    mapping(bytes32 => uint256) studio; // case + file name -> 1
    mapping(bytes32 => bool) possible; // case + "type:holo" the dealer can produce

    function setUp() public {
        packs = new FirePacks(address(this));
        cards = new FireCards(address(this), address(packs));
        dealer = new RecipeDealer(address(this), address(cards), address(new RecipeCompiler()));
        renderer = new CardsRenderer(address(cards));
        rng = new MockRandomness();
        rng.setFire(address(cards));
        packs.setSeller(address(this));
        packs.setCards(address(cards));
        cards.setSeller(address(this));
        cards.setRandomness(address(rng));
        cards.setPsa(address(this)); // so the test can case and grade cards directly
        cards.setRenderer(address(renderer));
        cs = new ConfigureSeries();
    }

    function _holoName(bool f, bool p) internal pure returns (string memory) {
        return f && p ? "full" : f ? "frame" : p ? "picture" : "none";
    }

    /// The looks the dealer can produce for type t (RecipeDealer._holo, over every group that can deal t).
    function _looks(RecipeDealer.Recipe memory r, uint256 t) internal pure returns (bool[4] memory can) {
        RecipeDealer.CardType memory ty = r.types[t];
        for (uint256 s; s < r.slots.length; s++) {
            RecipeDealer.Slot memory sl = r.slots[s];
            bool has;
            if (sl.types.length > 0) {
                for (uint256 k; k < sl.types.length; k++) if (sl.types[k] == t) has = true;
            } else {
                has = sl.minRank <= ty.rank && ty.rank <= sl.maxRank;
            }
            if (!has) continue;
            uint256 h0 = ty.holo[0];
            uint256 h1 = ty.holo[1];
            if (ty.holoMode == RecipeDealer.HoloMode.Independent) {
                // two rolls: frame hits below h0, picture below h1 (out of 1e18); a must-holo group conditions on a hit
                bool f = h0 > 0;
                bool nf = h0 < ONE;
                bool p = h1 > 0;
                bool np = h1 < ONE;
                if (!sl.mustHolo && nf && np) can[0] = true;
                if (f && np) can[1] = true;
                if (nf && p) can[2] = true;
                if (f && p) can[3] = true;
            } else {
                if (!sl.mustHolo && ty.holo[0] > 0) can[0] = true;
                for (uint256 k = 1; k < 4; k++) if (ty.holo[k] > 0) can[k] = true;
            }
        }
    }

    function _lookIndex(bool f, bool p) internal pure returns (uint256) {
        return f && p ? 3 : f ? 1 : p ? 2 : 0;
    }

    function test_studioGridIsExactlyWhatTheContractCanName() public {
        uint256 n;
        for (uint256 i;; i++) {
            string memory path = string.concat(DIR, vm.toString(i), ".json");
            if (!vm.exists(path)) break;
            _case(i, vm.readFile(path), vm.readFile(string.concat(DIR, vm.toString(i), ".files.json")).readStringArray(".files"));
            n++;
        }
        assertGe(n, 12, "the studio wrote its cases (studio/scripts/image-parity.test.ts)");
    }

    function _case(uint256 i, string memory json, string[] memory files) internal {
        bytes32 tag = keccak256(abi.encode(i));
        for (uint256 k; k < files.length; k++) {
            bytes32 key = keccak256(abi.encode(tag, files[k]));
            assertEq(studio[key], 0, "a studio file name appears twice");
            studio[key] = 1;
        }
        ConfigureSeries.Series memory s = cs.parse(json);
        uint256 fire = 1000 + i; // fresh Series per case
        dealer.setRecipe(fire, s.recipe);
        dealer.setCharacters(fire, s.names, s.categories);
        cards.setDealer(fire, address(dealer));
        cards.setImagesBase(fire, "ipfs://parity/");

        // 1. the contract's names for everything the dealer can deal == the studio's list
        uint256 count;
        for (uint256 t; t < s.recipe.types.length; t++) count += _typeNames(tag, i, s, t);
        assertEq(count, files.length, string.concat("case ", vm.toString(i), ": the studio builds images the contract never names"));

        // 2. real deals: every card's image is in the studio's list, in every state
        uint256 first = cards.nextSerial();
        _deal(fire, 12);
        uint256 last = cards.nextSerial();
        for (uint256 serial = first; serial < last; serial++) {
            FireCards.Card memory c = cards.cardOf(serial);
            assertTrue(possible[keccak256(abi.encode(tag, c.cardType, _lookIndex(c.holoFrame, c.holoPicture)))], "dealt a look the analysis says can't happen");
            assertEq(studio[keccak256(abi.encode(tag, renderer.imageFile(serial)))], 1, renderer.imageFile(serial));
            uint256 g = serial % 12; // 0 stays ungraded, 1 is cased, 2..11 are graded 1..10
            if (g == 1) cards.setCased(serial);
            else if (g > 1) cards.setGrade(serial, g - 1);
            assertEq(studio[keccak256(abi.encode(tag, renderer.imageFile(serial)))], 1, renderer.imageFile(serial));
        }
    }

    /// Every name CardsRenderer gives type t's possible looks (all characters, all states) must be a studio file.
    function _typeNames(bytes32 tag, uint256 i, ConfigureSeries.Series memory s, uint256 t) internal returns (uint256 count) {
        bool[4] memory can = _looks(s.recipe, t);
        for (uint256 h; h < 4; h++) {
            if (!can[h]) continue;
            possible[keccak256(abi.encode(tag, t, h))] = true;
            for (uint256 c; c < s.names.length; c++) {
                for (uint256 st; st < 12; st++) {
                    string memory name = renderer.imageName(c, s.recipe.types[t].slug, h == 1 || h == 3, h == 2 || h == 3, st < 2 ? 0 : st - 1, st == 1);
                    if (studio[keccak256(abi.encode(tag, name))] != 1) revert(string.concat("case ", vm.toString(i), ": the studio doesn't build ", name));
                    count++;
                }
            }
        }
    }

    function _deal(uint256 fire, uint256 n) internal {
        address holder = address(0xC0FFEE);
        packs.mint(holder, fire, n);
        cards.closeFire(fire);
        vm.prank(holder);
        cards.open(fire, n);
        uint256 id = rng.last();
        rng.fulfill(id, uint256(keccak256(abi.encode("parity", fire))));
        while (true) {
            (, uint256 ready) = cards.pending(fire);
            if (ready == 0) break;
            cards.process(fire, 500);
        }
    }
}
