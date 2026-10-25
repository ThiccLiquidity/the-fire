// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Test.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {FirePsa} from "../../src/cards/FirePsa.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {CardsRenderer} from "../../src/cards/CardsRenderer.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {MockRandomness, MockBurner} from "../Mocks.sol";
import {SeriesHelper} from "./SeriesHelper.sol";
import {ConfigureSeries} from "../../script/ConfigureSeries.s.sol";

/// @dev Per-Series recipes: every pack has the same shape (its slots), every card rolled on its own (type by its
///      slot's weights, holo, character by weight). No pool and no caps; the first and the last pack have the same odds.
contract RecipeTest is SeriesHelper {
    address owner = address(0xA11CE);
    address seller = address(0x5E11);
    FirePacks packs;
    FireCards cards;
    RecipeDealer dealer;
    FirePsa psa;
    CardsRenderer renderer;
    MockRandomness rng;
    bytes32 constant DEALT = keccak256("CardDealt(uint256,uint256,uint256,uint256,bool,bool,uint256)");

    function setUp() public {
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        psa = new FirePsa(owner, address(cards), address(new MockBurner(address(1), address(0))));
        renderer = new CardsRenderer(address(cards));
        rng = new MockRandomness();
        rng.setFire(address(cards));
        vm.startPrank(owner);
        packs.setSeller(seller);
        packs.setCards(address(cards));
        cards.setSeller(seller);
        cards.setRandomness(address(rng));
        cards.setPsa(address(psa));
        cards.setRenderer(address(renderer));
        vm.stopPrank();
        _standard(cards, dealer, owner, 1, 3);
    }

    function _holder(uint256 i) internal pure returns (address) { return address(uint160(0x1000 + i)); }

    function _sellAndClose(uint256 fire, uint256 n) internal {
        vm.startPrank(seller);
        for (uint256 i; i < n; i++) packs.mint(_holder(i % 17), fire, 1);
        cards.closeFire(fire);
        vm.stopPrank();
    }

    struct Dealt {
        uint256 openIndex;
        uint256 serial;
        uint256 cardType;
        bool frame;
        bool picture;
        uint256 character;
    }

    /// Open every pack (one open each), deliver words, process everything; the cards in dealing order.
    function _openAll(uint256 fire, uint256 n, uint256 salt) internal returns (Dealt[] memory out) {
        uint256 first = rng.last() + 1;
        for (uint256 i; i < n; i++) { vm.prank(_holder(i % 17)); cards.open(fire, 1); }
        vm.recordLogs();
        for (uint256 i; i < n; i++) rng.fulfill(first + i, uint256(keccak256(abi.encode(salt, i))));
        cards.process(fire, type(uint256).max);
        out = _dealtFromLogs();
    }

    function _dealtFromLogs() internal returns (Dealt[] memory out) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 k;
        for (uint256 i; i < logs.length; i++) if (logs[i].topics[0] == DEALT) k++;
        out = new Dealt[](k);
        k = 0;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != DEALT) continue;
            Dealt memory d = out[k++];
            d.serial = uint256(logs[i].topics[2]);
            (d.openIndex, d.cardType, d.frame, d.picture, d.character) = abi.decode(logs[i].data, (uint256, uint256, bool, bool, uint256));
        }
    }

    // ---------------------------------------------------------------- statistics

    struct Tally {
        uint256 cards;
        uint256[] types;
        uint256[] holo; // any holo, per type
        uint256[] full; // full holo, per type
        uint256[] chars;
    }

    /// `n` packs dealt straight from the dealer (a view: what FireCards would get for these seeds).
    function _tally(uint256 fire, uint256 n, uint256 salt) internal view returns (Tally memory t) {
        uint256 per = dealer.cardsPerPack(fire);
        uint256 nt = dealer.recipeOf(fire).types.length;
        t.types = new uint256[](nt);
        t.holo = new uint256[](nt);
        t.full = new uint256[](nt);
        t.chars = new uint256[](dealer.characterCount(fire));
        for (uint256 p; p < n; p++) {
            uint256[] memory got = dealer.deal(fire, uint256(keccak256(abi.encode(salt, p))), 0, per);
            for (uint256 i; i < got.length; i++) {
                uint256 a = got[i];
                uint256 ty = uint32(a);
                t.types[ty]++;
                if ((a >> 64) & 3 != 0) t.holo[ty]++;
                if ((a >> 64) & 3 == 3) t.full[ty]++;
                t.chars[uint32(a >> 32)]++;
            }
        }
        t.cards = n * per;
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    /// `got` out of `n` is within 5 standard deviations (+1) of chance `w / total`.
    function _near(uint256 got, uint256 n, uint256 w, uint256 total, string memory what) internal pure {
        uint256 mean = n * w / total;
        uint256 sd = _sqrt(n * w * (total - w) / total / total);
        assertApproxEqAbs(got, mean, 5 * sd + 1, what);
    }

    // ---------------------------------------------------------------- views

    function test_standardRecipeViews() public view {
        RecipeDealer.Recipe memory r = dealer.recipeOf(1);
        assertEq(r.types.length, 6);
        assertEq(r.slots.length, 4);
        assertEq(r.slots[0].count, 3);
        assertEq(r.types[4].slug, "gold");
        assertEq(r.types[2].name, "Fire");
        assertEq(r.types[5].rank, 5);
        assertEq(dealer.check(StandardRecipe.build()), 6);
        assertEq(dealer.cardsPerPack(1), 6);
        assertEq(cards.cardsPerPack(1), 6);
        assertEq(cards.characterCount(1), 3);
        assertTrue(dealer.ready(1));
        assertTrue(cards.ready(1));
        assertFalse(cards.ready(2));
        (uint256[] memory counts, uint256[][] memory w, uint256[] memory totals) = dealer.slotsOf(1);
        assertEq(counts.length, 4);
        assertEq(counts[0], 3); assertEq(counts[1], 1); assertEq(counts[2], 1); assertEq(counts[3], 1);
        assertEq(totals[0], 1); assertEq(totals[1], 1); assertEq(totals[2], 1_000); assertEq(totals[3], 10_000);
        assertEq(w[0][0], 1); assertEq(w[0][1], 0); assertEq(w[1][1], 1); assertEq(w[1][0], 0);
        assertEq(w[2][0], 0); assertEq(w[2][1], 449); assertEq(w[2][2], 300); assertEq(w[2][3], 120); assertEq(w[2][4], 86); assertEq(w[2][5], 45);
        assertEq(w[3][1], 0); assertEq(w[3][2], 5982); assertEq(w[3][3], 1734); assertEq(w[3][4], 1534); assertEq(w[3][5], 750);
        (uint256[] memory cw, uint256 ctotal) = dealer.characterOddsOf(1);
        assertEq(cw.length, 3);
        assertEq(ctotal, 3, "no weights set: every character 1");
        assertEq(cw[2], 1);
        // holo odds: Gold always full holo; Paper ~95% none
        uint256[4] memory o = dealer.holoOdds(1, 4);
        assertEq(o[0], 0);
        assertEq(o[1], 0);
        assertEq(o[3], 1e18);
        o = dealer.holoOdds(1, 0);
        assertApproxEqAbs(o[0], 0.95e18, 1e4);
        assertApproxEqAbs(o[1] + o[2] + o[3], 0.05e18, 1e4);
        (string[] memory names, string[] memory cats) = dealer.charactersOf(1, 1, 10);
        assertEq(names.length, 2);
        assertEq(names[1], "Char2");
        assertEq(cats[0], "Cat 1");
    }

    // ---------------------------------------------------------------- the odds

    /// Over many packs every slot's types, every holo look and character come out at their odds (Standard recipe,
    /// 20 characters), and the per-pack averages are the Standard's: 3 Paper, 1.449 Wood, 0.8982 Fire, 0.2934 Coal,
    /// 0.2394 Gold, 0.12 Full Art.
    function test_standardOddsConverge() public {
        _standard(cards, dealer, owner, 2, 20);
        uint256 n = 4000;
        Tally memory t = _tally(2, n, 1); // 24,000 cards
        string[6] memory names = ["Paper", "Wood", "Fire", "Coal", "Gold", "Full Art"];
        // each slot on its own: positions 0-2 always Paper, 3 always Wood, 4 and 5 at their slot's weights
        uint256[6][6] memory at; // at[position][type]
        for (uint256 p; p < n; p++) {
            uint256[] memory got = dealer.deal(2, uint256(keccak256(abi.encode(uint256(1), p))), 0, 6);
            for (uint256 i; i < 6; i++) at[i][uint32(got[i])]++;
        }
        for (uint256 i; i < 3; i++) assertEq(at[i][0], n, "slot 1: Paper only");
        assertEq(at[3][1], n, "slot 2: Wood only");
        (, uint256[][] memory w, uint256[] memory totals) = dealer.slotsOf(2);
        for (uint256 ty; ty < 6; ty++) {
            _near(at[4][ty], n, w[2][ty], totals[2], string.concat("slot 3 (Wood or better): ", names[ty]));
            _near(at[5][ty], n, w[3][ty], totals[3], string.concat("slot 4 (Fire or better): ", names[ty]));
        }
        assertEq(at[4][0], 0, "slot 3: never Paper");
        assertEq(at[5][0] + at[5][1], 0, "slot 4: never Paper or Wood");
        // per pack (out of 10,000 packs' worth): Paper 30,000, Wood 14,490, Fire 8,982, Coal 2,934, Gold 2,394, Full Art 1,200
        uint256[6] memory perPack = [uint256(30_000), 14_490, 8_982, 2_934, 2_394, 1_200];
        uint256 sum;
        for (uint256 ty; ty < 6; ty++) {
            uint256 expect = (3 * (w[0][ty] * 10_000 / totals[0]) + w[1][ty] * 10_000 / totals[1] + w[2][ty] * 10_000 / totals[2]
                + w[3][ty] * 10_000 / totals[3]);
            assertEq(expect, perPack[ty], string.concat(names[ty], ": expected per pack"));
            sum += expect;
            // the whole tally per card: its per-pack average / 6 (within 5 standard deviations of the per-card rate)
            _near(t.types[ty], t.cards, perPack[ty], 60_000, names[ty]);
        }
        assertEq(sum, 60_000, "6 cards a pack");
        // holo: any holo 5 / 10 / 50 / 90%; Gold and Full Art always full holo
        uint16[4] memory any = [500, 1000, 5000, 9000];
        for (uint256 i; i < 4; i++) _near(t.holo[i], t.types[i], any[i], 10_000, string.concat(names[i], " holo"));
        assertEq(t.full[4], t.types[4], "Gold: full holo");
        assertEq(t.full[5], t.types[5], "Full Art: full holo");
        // full holo = both rolls: Coal 1 - sqrt(0.1) per roll, squared ~ 46.8%
        _near(t.full[3], t.types[3], 4675, 10_000, "Coal full holo");
        for (uint256 c; c < 20; c++) _near(t.chars[c], t.cards, 1, 20, "a character");
    }

    /// The pack's shape is all the guarantee there is: every Standard pack has 3 Paper, a Wood, a Wood-or-better and
    /// a Fire-or-better, and nothing caps the rest: a pack can hold two Full Arts, two Golds, or no Fire at all past
    /// its last slot's, and a character can get any number of Full Arts.
    function test_shapeIsTheOnlyGuarantee() public view {
        uint256 twoFullArts;
        uint256 twoGolds;
        uint256 woodWood; // slot 3 came out Wood: the only Fire or better is slot 4's
        uint256[3] memory fullArtOf;
        for (uint256 p; p < 3000; p++) {
            uint256[] memory got = dealer.deal(1, uint256(keccak256(abi.encode("caps", p))), 0, 6);
            uint256 paper;
            uint256 fa;
            uint256 gold;
            uint256 better;
            for (uint256 i; i < 6; i++) {
                uint256 ty = uint32(got[i]);
                if (ty == 0) paper++;
                if (ty >= 2) better++;
                if (ty == 4) gold++;
                if (ty == 5) { fa++; fullArtOf[uint32(got[i] >> 32)]++; }
            }
            assertEq(paper, 3, "3 Paper, always");
            assertGe(better, 1, "a Fire or better, always");
            if (fa >= 2) twoFullArts++;
            if (gold >= 2) twoGolds++;
            if (uint32(got[4]) == 1) woodWood++;
        }
        assertGt(twoFullArts, 3, "two Full Arts in one pack happen (4.5% x 7.5%)");
        assertGt(twoGolds, 15, "two Golds in one pack happen (8.6% x 15.34%)");
        assertGt(woodWood, 1100, "slot 3 is Wood 44.9% of the time");
        for (uint256 c; c < 3; c++) assertGt(fullArtOf[c], 1, "no one-per-character cap");
    }

    /// The last pack of a big Series gets exactly what the only pack of a one-pack Series gets from the same word:
    /// nothing depends on what was dealt before, how many packs there are, or what is left.
    function test_lastPackSameOddsAsFirst() public {
        _standard(cards, dealer, owner, 3, 5);
        _standard(cards, dealer, owner, 4, 5);
        vm.startPrank(seller);
        packs.mint(_holder(0), 3, 1);
        packs.mint(_holder(0), 4, 300);
        cards.closeFire(3);
        cards.closeFire(4);
        vm.stopPrank();
        // Series 4: 299 packs dealt first
        vm.prank(_holder(0));
        cards.open(4, 299);
        rng.fulfill(rng.last(), 77);
        cards.process(4, type(uint256).max);
        // now the last pack of Series 4 and the only pack of Series 3, from the same word
        uint256 w = uint256(keccak256("the same word"));
        vm.prank(_holder(0));
        cards.open(3, 1);
        rng.fulfill(rng.last(), w);
        vm.prank(_holder(0));
        cards.open(4, 1);
        rng.fulfill(rng.last(), w);
        uint256 firstA = cards.nextSerial();
        cards.process(3, 6);
        uint256 firstB = cards.nextSerial();
        cards.process(4, 6);
        for (uint256 i; i < 6; i++) {
            FireCards.Card memory a = cards.cardOf(firstA + i);
            FireCards.Card memory b = cards.cardOf(firstB + i);
            assertEq(a.cardType, b.cardType, "type");
            assertEq(a.character, b.character, "character");
            assertEq(a.holoFrame, b.holoFrame, "frame");
            assertEq(a.holoPicture, b.holoPicture, "picture");
        }
        // and the dealer's view gives the same pack, before and after everything was dealt
        uint256 seed = uint256(keccak256(abi.encode(w, uint256(0))));
        assertEq(keccak256(abi.encode(dealer.deal(3, seed, 0, 6))), keccak256(abi.encode(dealer.deal(4, seed, 0, 6))));
        // print numbers count each Series on its own: Series 3's only pack starts at #1, while the same cards in
        // Series 4 come after 299 packs of it
        bool one;
        uint256 sumA;
        uint256 sumB;
        for (uint256 i; i < 6; i++) {
            uint256 k = cards.cardOf(firstA + i).printNumber;
            assertTrue(k >= 1 && k <= 6, "print number within Series 3's one pack");
            if (k == 1) one = true;
            sumA += k;
            sumB += cards.cardOf(firstB + i).printNumber;
        }
        assertTrue(one);
        assertGt(sumB, sumA);
    }

    /// The type odds of a pack hold over a whole Series that was actually opened (FireCards, print numbers and all).
    function test_openedSeriesFollowsTheOdds() public {
        RecipeDealer.CardType[] memory ts = new RecipeDealer.CardType[](3);
        ts[0] = _type("Common", "common", 0);
        ts[1] = _holoChances(_type("Rare", "rare", 1), 0.5e18, 0);
        ts[2] = _holoWeights(_type("Epic", "epic", 2), 0, 0, 0, 1);
        _series(cards, dealer, owner, 5, _recipe(ts, _w(70, 25, 5), 4), 3);
        _sellAndClose(5, 400);
        Dealt[] memory d = _openAll(5, 400, 9);
        assertEq(d.length, 1600);
        uint256[3] memory n;
        uint256 rareFrame;
        for (uint256 i; i < d.length; i++) {
            n[d[i].cardType]++;
            if (d[i].cardType == 0) assertFalse(d[i].frame || d[i].picture, "Common never holo");
            if (d[i].cardType == 1) { assertFalse(d[i].picture); if (d[i].frame) rareFrame++; }
            if (d[i].cardType == 2) assertTrue(d[i].frame && d[i].picture);
        }
        _near(n[0], 1600, 70, 100, "Common");
        _near(n[1], 1600, 25, 100, "Rare");
        _near(n[2], 1600, 5, 100, "Epic");
        _near(rareFrame, n[1], 1, 2, "Rare frame holo");
        // print numbers: each exact card (type, character, holo look) is #1, #2, ... in the order it was dealt
        uint256[36] memory seen;
        for (uint256 i; i < d.length; i++) {
            uint256 look = (d[i].cardType * 3 + d[i].character) * 4 + (d[i].frame ? 1 : 0) + (d[i].picture ? 2 : 0);
            assertEq(cards.cardOf(d[i].serial).printNumber, ++seen[look], "print number in deal order, per exact card");
        }
        uint256 plainRares;
        for (uint256 ch; ch < 3; ch++) plainRares += seen[(3 + ch) * 4];
        assertEq(plainRares + rareFrame, n[1], "a Rare frame holo and a plain Rare are numbered apart");
    }

    // ---------------------------------------------------------------- character odds

    function _weights4() internal pure returns (uint64[] memory w) {
        w = new uint64[](4);
        w[0] = 1; w[1] = 2; w[2] = 3; w[3] = 4;
    }

    /// Weighted characters come out at their weights, independent of type.
    function test_characterWeightsConverge() public {
        _standard(cards, dealer, owner, 6, 4);
        vm.prank(owner);
        dealer.setCharacterWeights(6, _weights4());
        (uint256[] memory w, uint256 total) = dealer.characterOddsOf(6);
        assertEq(total, 10);
        assertEq(w[3], 4);
        Tally memory t = _tally(6, 3000, 2); // 18,000 cards
        for (uint256 c; c < 4; c++) _near(t.chars[c], t.cards, c + 1, 10, "character weight");
        // independent of type: among Full Arts too
        uint256[4] memory fa;
        for (uint256 p; p < 3000; p++) {
            uint256[] memory got = dealer.deal(6, uint256(keccak256(abi.encode(uint256(2), p))), 0, 6);
            for (uint256 i; i < 6; i++) if (uint32(got[i]) >= 3) fa[uint32(got[i] >> 32)]++;
        }
        uint256 nfa = fa[0] + fa[1] + fa[2] + fa[3];
        for (uint256 c; c < 4; c++) _near(fa[c], nfa, c + 1, 10, "character weight among Coal-or-better");
        assertGt(nfa, 1500, "enough Coal-or-better to tell");
    }

    /// Equal weights deal exactly what no weights deal (uniform is the default).
    function test_equalWeightsSameAsUniform() public {
        _standard(cards, dealer, owner, 6, 4);
        _standard(cards, dealer, owner, 7, 4);
        uint64[] memory ones = new uint64[](4);
        for (uint256 i; i < 4; i++) ones[i] = 1;
        vm.prank(owner);
        dealer.setCharacterWeights(7, ones);
        for (uint256 p; p < 50; p++) {
            uint256 seed = uint256(keccak256(abi.encode("u", p)));
            assertEq(keccak256(abi.encode(dealer.deal(6, seed, 0, 6))), keccak256(abi.encode(dealer.deal(7, seed, 0, 6))));
        }
        // clearing them goes back to uniform
        vm.prank(owner);
        dealer.setCharacterWeights(7, _weights4());
        vm.prank(owner);
        dealer.setCharacterWeights(7, new uint64[](0));
        (, uint256 total) = dealer.characterOddsOf(7);
        assertEq(total, 4);
    }

    function test_characterWeightRules() public {
        // one per character, each at least 1
        vm.startPrank(owner);
        vm.expectRevert(RecipeDealer.BadWeights.selector);
        dealer.setCharacterWeights(1, _weights4()); // 3 characters
        uint64[] memory w = new uint64[](3);
        w[0] = 1; w[1] = 0; w[2] = 1;
        vm.expectRevert(RecipeDealer.BadWeights.selector);
        dealer.setCharacterWeights(1, w);
        w[1] = 5;
        dealer.setCharacterWeights(1, w);
        assertTrue(dealer.ready(1));
        // more characters added: not ready (nor lockable) until the weights match again
        (string[] memory names, string[] memory cats) = _chars(1);
        dealer.appendCharacters(1, names, cats);
        assertFalse(dealer.ready(1));
        assertFalse(cards.ready(1));
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.lockFire(1);
        dealer.setCharacterWeights(1, _weights4());
        assertTrue(cards.ready(1));
        // a fresh character list starts uniform
        dealer.setCharacters(1, names, cats);
        (, uint256 total) = dealer.characterOddsOf(1);
        assertEq(total, 1);
        dealer.setCharacters(1, _names4(), _cats4());
        dealer.setCharacterWeights(1, _weights4());
        // locked with the Series
        cards.lockFire(1);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.setCharacterWeights(1, new uint64[](0));
        vm.stopPrank();
        vm.prank(_holder(0));
        vm.expectRevert();
        dealer.setCharacterWeights(2, new uint64[](0));
    }

    function _names4() internal pure returns (string[] memory n) {
        (n,) = _chars(4);
    }

    function _cats4() internal pure returns (string[] memory c) {
        (, c) = _chars(4);
    }

    // ---------------------------------------------------------------- new shapes

    /// 3-card packs, every card holo (by the types' own holo odds).
    function test_threeCardAllHoloPack() public {
        RecipeDealer.CardType[] memory ts = new RecipeDealer.CardType[](3);
        ts[0] = _holoWeights(_type("Flame", "flame", 0), 0, 1, 1, 0);
        ts[1] = _holoWeights(_type("Diamond", "diamond", 1), 0, 1, 1, 1);
        ts[2] = _holoWeights(_type("Gold", "gold", 2), 0, 0, 0, 1);
        _series(cards, dealer, owner, 7, _recipe(ts, _w(90, 9, 1), 3), 4);
        assertEq(cards.cardsPerPack(7), 3);
        _sellAndClose(7, 20);
        assertTrue(_contains(_json(packs.uri(7)), "A sealed pack of 3 cards from Series 7"));
        Dealt[] memory d = _openAll(7, 20, 1);
        assertEq(d.length, 60);
        for (uint256 i; i < d.length; i++) {
            assertTrue(d[i].frame || d[i].picture, "every card holo");
            if (d[i].cardType == 2) assertTrue(d[i].frame && d[i].picture, "Gold is always full holo");
            assertEq(d[i].openIndex, i / 3, "3 per pack");
        }
    }

    /// 100 characters, set in two batches.
    function test_hundredCharacters() public {
        (string[] memory names, string[] memory cats) = _chars(100);
        string[] memory a = new string[](60);
        string[] memory ac = new string[](60);
        string[] memory b = new string[](40);
        string[] memory bc = new string[](40);
        for (uint256 i; i < 60; i++) { a[i] = names[i]; ac[i] = cats[i]; }
        for (uint256 i; i < 40; i++) { b[i] = names[60 + i]; bc[i] = cats[60 + i]; }
        vm.startPrank(owner);
        dealer.setRecipe(8, StandardRecipe.build());
        dealer.setCharacters(8, a, ac);
        dealer.appendCharacters(8, b, bc);
        cards.setDealer(8, address(dealer));
        vm.stopPrank();
        assertEq(cards.characterCount(8), 100);
        (string memory n99, string memory c99) = dealer.characterOf(8, 99);
        assertEq(n99, "Char99"); assertEq(c99, "Cat 1");
        _sellAndClose(8, 100);
        Dealt[] memory d = _openAll(8, 100, 2);
        bool[100] memory seen;
        uint256 distinct;
        uint256 serial99;
        for (uint256 i; i < d.length; i++) {
            assertLt(d[i].character, 100);
            if (!seen[d[i].character]) { seen[d[i].character] = true; distinct++; }
            if (d[i].character == 99) serial99 = d[i].serial;
        }
        assertGt(distinct, 95, "600 cards cover nearly all 100 characters");
        if (serial99 != 0) assertTrue(_contains(_json(cards.tokenURI(serial99)), '"value":"Char99"'));
    }

    /// Long weighted casts work too (the weights span storage chunks).
    function test_manyWeightedCharacters() public {
        (string[] memory names, string[] memory cats) = _chars(1000);
        uint64[] memory w = new uint64[](1000);
        for (uint256 i; i < 1000; i++) w[i] = i == 999 ? 1000 : 1;
        vm.startPrank(owner);
        dealer.setRecipe(8, StandardRecipe.build());
        dealer.setCharacters(8, names, cats);
        dealer.setCharacterWeights(8, w);
        vm.stopPrank();
        assertTrue(dealer.ready(8));
        (uint256[] memory back, uint256 total) = dealer.characterOddsOf(8);
        assertEq(total, 1999);
        assertEq(back[999], 1000);
        assertEq(back[500], 1);
        Tally memory t = _tally(8, 500, 3);
        _near(t.chars[999], t.cards, 1000, 1999, "the heavy character: about half");
    }

    /// setCharacters replaces the whole list (a fresh list, however long the old one was).
    function test_setCharactersReplaces() public {
        (string[] memory five, string[] memory c5) = _chars(5);
        string[] memory two = new string[](2);
        string[] memory c2 = new string[](2);
        two[0] = "Nova"; two[1] = "Pyre"; c2[0] = "Stars"; c2[1] = "Stars";
        vm.startPrank(owner);
        dealer.setCharacters(1, five, c5);
        assertEq(dealer.characterCount(1), 5);
        dealer.setCharacters(1, two, c2);
        vm.stopPrank();
        assertEq(dealer.characterCount(1), 2);
        (string memory n, string memory c) = dealer.characterOf(1, 1);
        assertEq(n, "Pyre"); assertEq(c, "Stars");
        vm.expectRevert();
        dealer.characterOf(1, 2);
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.BadLength.selector);
        dealer.setCharacters(1, new string[](0), new string[](0));
    }

    /// A new card type, Platinum, added to the Standard recipe in its Fire-or-better slot: its own weight there,
    /// always full holo. Every other slot gets a 0 for it (never dealt there).
    function test_newTypeAdded() public {
        RecipeDealer.Recipe memory r = StandardRecipe.build();
        RecipeDealer.CardType[] memory ts = new RecipeDealer.CardType[](7);
        for (uint256 i; i < 6; i++) ts[i] = r.types[i];
        ts[6] = _holoWeights(_type("Platinum", "platinum", 6), 0, 0, 0, 1);
        r.types = ts;
        for (uint256 s; s < 4; s++) {
            uint64[] memory w = new uint64[](7);
            for (uint256 i; i < 6; i++) w[i] = r.slots[s].weights[i];
            if (s == 3) w[6] = 10_000; // Fire or better: Platinum half the time
            r.slots[s].weights = w;
        }
        // a type no slot deals is refused before the slot weights are there
        r.slots[3].weights[6] = 0;
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadType.selector, 6, "in no slot"));
        dealer.check(r);
        r.slots[3].weights[6] = 10_000;
        _series(cards, dealer, owner, 9, r, 5);
        (,, uint256[] memory totals) = dealer.slotsOf(9);
        assertEq(totals[3], 20_000);
        _sellAndClose(9, 50);
        Dealt[] memory d = _openAll(9, 50, 3);
        uint256 plat;
        uint256 platSerial;
        for (uint256 i; i < d.length; i++) {
            if (d[i].cardType == 6) { plat++; platSerial = d[i].serial; assertTrue(d[i].frame && d[i].picture); }
        }
        _near(plat, 50, 1, 2, "Platinum: half of slot 4");
        FireCards.Card memory g = cards.cardOf(platSerial);
        assertEq(renderer.imageFile(platSerial), string.concat("c", vm.toString(g.character), "-platinum-full-u.webp"));
        string memory json = _json(cards.tokenURI(platSerial));
        assertTrue(_contains(json, '{"trait_type":"Material","value":"Platinum"}'), json);
        vm.parseJson(json);
    }

    /// One card per pack.
    function test_oneCardPacks() public {
        RecipeDealer.CardType[] memory ts = new RecipeDealer.CardType[](2);
        ts[0] = _type("Common", "common", 0);
        ts[1] = _holoChances(_type("Rare", "rare", 1), 1e18, 0);
        _series(cards, dealer, owner, 10, _recipe(ts, _w(9, 1), 1), 2);
        _sellAndClose(10, 50);
        assertTrue(_contains(_json(packs.uri(10)), "A sealed pack of 1 card from Series 10"));
        Dealt[] memory d = _openAll(10, 50, 4);
        assertEq(d.length, 50);
        for (uint256 i; i < 50; i++) {
            assertEq(d[i].serial, i + 1, "one card, one serial per pack");
            if (d[i].cardType == 1) assertTrue(d[i].frame && !d[i].picture);
            else assertFalse(d[i].frame || d[i].picture, "Common never holo");
        }
    }

    /// A 1,000-card pack, dealt over many calls well under a block each, gives exactly what one long call gives.
    function test_hugePackChunked() public {
        RecipeDealer.CardType[] memory ts = new RecipeDealer.CardType[](3);
        ts[0] = _type("Common", "common", 0);
        ts[1] = _holoChances(_type("Rare", "rare", 1), 0.1e18, 0.1e18);
        ts[2] = _holoWeights(_type("Epic", "epic", 2), 0, 1, 1, 1);
        _series(cards, dealer, owner, 11, _recipe(ts, _w(893, 100, 7), 1000), 30);
        vm.prank(seller);
        packs.mint(_holder(0), 11, 3);
        vm.prank(seller);
        cards.closeFire(11);
        vm.prank(_holder(0));
        cards.open(11, 3);
        rng.fulfill(rng.last(), 12345);

        uint256 snap = vm.snapshotState();
        assertEq(cards.process(11, type(uint256).max), 3000);
        bytes32[] memory a = new bytes32[](3000);
        for (uint256 s = 1; s <= 3000; s++) a[s - 1] = keccak256(abi.encode(cards.cardOf(s)));
        vm.revertToState(snap);

        uint256 calls;
        uint256 maxGas;
        while (true) {
            uint256 g = gasleft();
            uint256 n = cards.process(11, 300);
            uint256 used = g - gasleft();
            if (n == 0) break;
            calls++;
            if (used > maxGas) maxGas = used;
        }
        assertEq(calls, 10);
        assertLt(maxGas, 30_000_000, "each call fits a block");
        emit log_named_uint("process(300) of a 1,000-card pack: most gas in one call", maxGas);
        uint256[3] memory n3;
        for (uint256 s = 1; s <= 3000; s++) {
            FireCards.Card memory c = cards.cardOf(s);
            assertEq(keccak256(abi.encode(c)), a[s - 1], "same card however it was split");
            n3[c.cardType]++;
        }
        _near(n3[1], 3000, 100, 1000, "Rare");
        _near(n3[2], 3000, 7, 1000, "Epic");
    }

    // ---------------------------------------------------------------- bad recipes are refused, with the reason

    function _two() internal pure returns (RecipeDealer.Recipe memory r) {
        RecipeDealer.CardType[] memory ts = new RecipeDealer.CardType[](3);
        ts[0] = _type("A", "a", 0);
        ts[1] = _type("B", "b", 1);
        ts[2] = _type("C", "c", 2);
        r = _recipe(ts, _w(8, 1, 1), 3);
    }

    function test_badRecipesRevert() public {
        RecipeDealer.Recipe memory r = _two();
        assertEq(dealer.check(r), 3);

        // no types
        r.types = new RecipeDealer.CardType[](0);
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadRecipe.selector, "no types"));
        dealer.check(r);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadRecipe.selector, "no types"));
        dealer.setRecipe(20, r);

        // no slots
        r = _two();
        r.slots = new RecipeDealer.Slot[](0);
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadRecipe.selector, "no slots"));
        dealer.check(r);

        // cards per pack: the slots' counts add up to 1 to 1,000; every slot at least 1 card
        r = _two();
        r.slots[0].count = 0;
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadSlot.selector, 0, "count"));
        dealer.check(r);
        r.slots[0].count = 1001;
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadRecipe.selector, "cards per pack"));
        dealer.check(r);
        r.slots[0].count = 1000;
        assertEq(dealer.check(r), 1000);
        RecipeDealer.Slot[] memory two = new RecipeDealer.Slot[](2);
        two[0] = _slot(600, _w(1, 0, 0));
        two[1] = _slot(401, _w(0, 1, 1));
        r.slots = two;
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadRecipe.selector, "cards per pack"));
        dealer.check(r);
        two[1].count = 400;
        assertEq(dealer.check(r), 1000, "two slots, 1,000 cards");

        // weights: one per type, some above 0 in every slot, and every type in some slot
        r = _two();
        r.slots[0].weights = _w(8, 1);
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadSlot.selector, 0, "one weight per type"));
        dealer.check(r);
        r.slots[0].weights = _w(0, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadSlot.selector, 0, "weights"));
        dealer.check(r);
        r.slots[0].weights = _w(8, 0, 1);
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadType.selector, 1, "in no slot"));
        dealer.check(r);
        RecipeDealer.Slot[] memory pair = new RecipeDealer.Slot[](2);
        pair[0] = _slot(2, _w(8, 0, 1));
        pair[1] = _slot(1, _w(0, 1, 0));
        r.slots = pair;
        assertEq(dealer.check(r), 3, "B only in the second slot: fine");
        r.slots[1].weights = _w(0, 0, 0);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadSlot.selector, 1, "weights"));
        dealer.setRecipe(20, r);

        // types
        r = _two();
        r.types[1].slug = "Big";
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadType.selector, 1, "slug characters"));
        dealer.check(r);
        r.types[1].slug = "a";
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadType.selector, 1, "slug repeated"));
        dealer.check(r);
        r.types[1].slug = "";
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadType.selector, 1, "slug length"));
        dealer.check(r);
        r.types[1].slug = "b-2";
        r.types[1].name = "";
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadType.selector, 1, "name length"));
        dealer.check(r);
        r.types[1].name = 'B "quoted"';
        vm.expectRevert(RecipeCompiler.BadText.selector);
        dealer.check(r);
        r.types[1].name = "B";
        r.types[2].holo = [uint64(1e18 + 1), 0, 0, 0];
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadType.selector, 2, "holo chances"));
        dealer.check(r);
        r.types[2].holo = [uint64(0), 0, 1, 0];
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadType.selector, 2, "holo chances"));
        dealer.check(r);
        r.types[2] = _holoWeights(r.types[2], 0, 0, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadType.selector, 2, "holo weights"));
        dealer.check(r);
        r.types[2] = _holoWeights(r.types[2], 1, 0, 0, 0);
        dealer.check(r); // never holo is fine
    }

    // ---------------------------------------------------------------- everything locks at the first pack

    function test_everythingLocksAtTheFirstMint() public {
        RecipeDealer other = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        RecipeDealer.Recipe memory one = _two();
        (string[] memory names, string[] memory cats) = _chars(2);
        // a dealer must have the Series set up before it can be chosen
        vm.prank(owner);
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.setDealer(1, address(other));
        vm.startPrank(owner);
        other.setRecipe(1, one);
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.setDealer(1, address(other)); // no characters yet
        other.setCharacters(1, names, cats);
        // before the first pack everything can change: the dealer, its recipe and characters
        cards.setDealer(1, address(other));
        assertEq(cards.cardsPerPack(1), 3);
        other.setRecipe(1, StandardRecipe.build());
        other.appendCharacters(1, names, cats);
        cards.setDealer(1, address(dealer));
        cards.setDealer(1, address(other));
        vm.stopPrank();

        vm.prank(seller);
        packs.mint(_holder(0), 1, 1); // the first pack: from here on, nothing about Series 1 can change

        vm.startPrank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setDealer(1, address(dealer));
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        other.setRecipe(1, one);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        other.setCharacters(1, names, cats);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        other.appendCharacters(1, names, cats);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        other.setCharacterWeights(1, new uint64[](0));
        vm.stopPrank();
        assertEq(cards.characterCount(1), 4);

        // the Series opens with the dealer it had at the first pack
        vm.prank(seller);
        cards.closeFire(1);
        Dealt[] memory d = _openAll(1, 1, 6);
        assertEq(d.length, 6, "Standard: 6 cards");

        // a closed Series (even with nothing sold) locks too
        _standard(cards, dealer, owner, 2, 1);
        vm.prank(seller);
        cards.closeFire(2);
        vm.startPrank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setDealer(2, address(dealer));
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.setRecipe(2, one);
        vm.stopPrank();
    }

    /// A recipe too big for one storage chunk (many types) still works, and reads back whole.
    function test_bigRecipeSpansChunks() public {
        uint256 T = 150;
        RecipeDealer.CardType[] memory ts = new RecipeDealer.CardType[](T);
        for (uint256 t; t < T; t++) {
            ts[t] = _type(
                string.concat("Type number ", vm.toString(t), " with a long descriptive name ok"),
                string.concat("type-", vm.toString(t)),
                uint32(t)
            );
        }
        uint64[] memory tw = new uint64[](T);
        for (uint256 t; t < T; t++) tw[t] = uint64(t + 1);
        RecipeDealer.Recipe memory r = _recipe(ts, tw, 3);
        _series(cards, dealer, owner, 14, r, 2);
        assertGt(abi.encode(r).length, 24_000, "more than one chunk");
        RecipeDealer.Recipe memory back = dealer.recipeOf(14);
        assertEq(back.types.length, T);
        assertEq(back.types[149].slug, "type-149");
        (, uint256[][] memory w, uint256[] memory totals) = dealer.slotsOf(14);
        assertEq(totals[0], T * (T + 1) / 2);
        assertEq(w[0][149], 150);
        _sellAndClose(14, 200);
        Dealt[] memory d = _openAll(14, 200, 8);
        assertEq(d.length, 600);
        uint256 high;
        for (uint256 i; i < d.length; i++) if (d[i].cardType >= 75) high++;
        // types 75..149 hold (76+...+150) / 11,325 = 75% of the weight
        _near(high, 600, 8550, 11_325, "the heavier half");
    }

    /// deal is a view of the seed: anyone can check a pack, and it never changes the dealer.
    function test_dealIsAPureViewOfTheSeed() public {
        uint256[] memory a = dealer.deal(1, 42, 0, 6);
        vm.prank(_holder(3));
        uint256[] memory b = dealer.deal(1, 42, 2, 4);
        for (uint256 i; i < 4; i++) assertEq(a[2 + i], b[i], "a pack dealt in pieces is the same");
        vm.expectRevert(RecipeDealer.BadDeal.selector);
        dealer.deal(1, 42, 4, 3);
        vm.expectRevert(RecipeDealer.BadDeal.selector);
        dealer.deal(1, 42, 0, 0);
        vm.expectRevert(RecipeDealer.NotConfigured.selector);
        dealer.deal(99, 42, 0, 1);
    }

    // ---------------------------------------------------------------- the studio's recipe JSON

    /// script/ConfigureSeries.s.sol turns the studio's recipe JSON into the owner's calls; the Standard JSON gives
    /// exactly the Standard recipe.
    function test_configureSeriesFromJson() public {
        ConfigureSeries cs = new ConfigureSeries();
        string memory json = vm.readFile("test/cards/recipe-standard.json");
        ConfigureSeries.Series memory s = cs.parse(json);
        assertEq(s.fire, 7);
        assertEq(keccak256(abi.encode(s.recipe)), keccak256(abi.encode(StandardRecipe.build())), "same as StandardRecipe");
        assertEq(s.weights.length, 0, "no character weights: equal odds");
        ConfigureSeries.Call[] memory calls = cs.build(json, address(dealer), address(cards), 2);
        assertEq(calls.length, 5, "recipe, 2 character batches, dealer, images");
        vm.startPrank(owner);
        for (uint256 i; i < calls.length; i++) {
            (bool ok,) = calls[i].to.call(calls[i].data);
            assertTrue(ok, calls[i].what);
        }
        vm.stopPrank();
        assertTrue(cards.ready(7));
        assertEq(cards.characterCount(7), 3);
        (string memory name, string memory cat) = dealer.characterOf(7, 2);
        assertEq(name, "Cinder Queen"); assertEq(cat, "Royals");
        assertEq(cards.imagesBase(7), "ipfs://bafyexampleimages/");
        cs.checkOnChain(json, address(dealer), address(cards));
        // a bad recipe is caught before anything is printed
        string memory bad = vm.replace(json, '{ "count": 1, "weights": { "wood": 1 } }', '{ "count": 1, "weights": { "wood": 0 } }');
        vm.expectRevert(abi.encodeWithSelector(RecipeCompiler.BadSlot.selector, 1, "weights"));
        cs.build(bad, address(dealer), address(cards), 2);
    }

    /// Character weights in the JSON: one per character (all or none), sent with setCharacterWeights and checked
    /// back on chain.
    function test_configureSeriesWithCharacterWeights() public {
        ConfigureSeries cs = new ConfigureSeries();
        string memory json = vm.readFile("test/cards/recipe-standard.json");
        string memory weighted = vm.replace(
            vm.replace(
                vm.replace(json, '"category": "Animals" },\n    { "name": "Ash Wolf"', '"category": "Animals", "weight": 5 },\n    { "name": "Ash Wolf"'),
                '"name": "Ash Wolf", "category": "Animals" }',
                '"name": "Ash Wolf", "category": "Animals", "weight": 3 }'
            ),
            '"category": "Royals" }',
            '"category": "Royals", "weight": 1 }'
        );
        ConfigureSeries.Series memory s = cs.parse(weighted);
        assertEq(s.weights.length, 3);
        assertEq(s.weights[0], 5); assertEq(s.weights[1], 3); assertEq(s.weights[2], 1);
        ConfigureSeries.Call[] memory calls = cs.build(weighted, address(dealer), address(cards), 200);
        assertEq(calls.length, 5, "recipe, characters, weights, dealer, images");
        assertEq(calls[2].what, "RecipeDealer.setCharacterWeights");
        vm.startPrank(owner);
        for (uint256 i; i < calls.length; i++) {
            (bool ok,) = calls[i].to.call(calls[i].data);
            assertTrue(ok, calls[i].what);
        }
        vm.stopPrank();
        cs.checkOnChain(weighted, address(dealer), address(cards));
        vm.expectRevert(bytes("on chain: character 0's weight differs from the JSON"));
        cs.checkOnChain(json, address(dealer), address(cards));
        // all or none
        string memory some = vm.replace(json, '"category": "Royals" }', '"category": "Royals", "weight": 2 }');
        vm.expectRevert(bytes(".characters: give every character a weight, or none (equal odds)"));
        cs.parse(some);
        vm.expectRevert(bytes(".characters[2].weight: at least 1 (leave every weight out for equal odds)"));
        cs.parse(vm.replace(weighted, '"weight": 1 }', '"weight": 0 }'));
    }

    /// The studio JSON is read strictly: unknown keys (PDA odds and the old pool fields too).
    function test_configureSeriesStrictParsing() public {
        ConfigureSeries cs = new ConfigureSeries();
        string memory json = vm.readFile("test/cards/recipe-standard.json");
        vm.expectRevert(bytes(".: unknown key imagesBas"));
        cs.parse(vm.replace(json, '"imagesBase"', '"imagesBas"'));
        vm.expectRevert(bytes(".types[0]: unknown key supply"));
        cs.parse(vm.replace(json, '"rank": 0,', '"rank": 0, "supply": "perPack",'));
        vm.expectRevert(bytes(".types[0]: unknown key weight"));
        cs.parse(vm.replace(json, '"rank": 0,', '"rank": 0, "weight": 5000,'));
        vm.expectRevert(bytes(".: unknown key cardsPerPack"));
        cs.parse(vm.replace(json, '"fire": 7,', '"fire": 7, "cardsPerPack": 6,'));
        vm.expectRevert(bytes(".slots[0]: unknown key minRank"));
        cs.parse(vm.replace(json, '{ "count": 3, "weights": { "paper": 1 } }', '{ "count": 3, "minRank": 1, "weights": { "paper": 1 } }'));
        vm.expectRevert(bytes(".slots[0].weights: diamond is not the slug of a card type"));
        cs.parse(vm.replace(json, '{ "count": 3, "weights": { "paper": 1 } }', '{ "count": 3, "weights": { "paper": 1, "diamond": 1 } }'));
        vm.expectRevert(bytes(".: unknown key pdaOdds"));
        cs.parse(vm.replace(json, '"fire": 7,', '"fire": 7, "pdaOdds": ["0", "0", "0", "0", "1", "1", "1", "1", "1", "1"],'));
        vm.expectRevert(bytes(".types[2].rank is too big for its field"));
        cs.parse(vm.replace(json, '"rank": 2,', '"rank": 4294967296,'));
        vm.expectRevert(bytes("$.slots[3].weights['fire'] is too big for its field"));
        cs.parse(vm.replace(json, '"fire": 5982,', '"fire": 18446744073709551616,'));
        vm.expectRevert(bytes(".slots[0].count is too big for its field"));
        cs.parse(vm.replace(json, '{ "count": 3,', '{ "count": 4294967296,'));
    }
}
