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
import {MockERC20, MockRandomness, MockBurner} from "../Mocks.sol";
import {SeriesHelper} from "./SeriesHelper.sol";
import {ConfigureSeries} from "../../script/ConfigureSeries.s.sol";

/// @dev Per-Series recipes: new pack shapes, new card types, any number of characters, the floor, the locks.
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
    uint32 constant ANY = type(uint32).max;

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
        _standard(cards, dealer, owner, 1, 3, 1);
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

    // ---------------------------------------------------------------- views

    function test_standardRecipeViews() public view {
        RecipeDealer.Recipe memory r = dealer.recipeOf(1);
        assertEq(r.types.length, 5);
        assertEq(r.types[4].slug, "gold");
        assertEq(r.types[2].name, "Fire");
        assertEq(r.slots.length, 4);
        assertEq(r.slots[3].minRank, 2);
        assertEq(dealer.check(StandardRecipe.build(1)), 6);
        assertEq(dealer.cardsPerPack(1), 6);
        assertEq(cards.cardsPerPack(1), 6);
        assertEq(cards.characterCount(1), 3);
        assertTrue(dealer.ready(1));
        assertTrue(cards.ready(1));
        assertFalse(cards.ready(2));
        // holo odds: Gold always full holo; Paper ~95% none
        uint256[4] memory o = dealer.holoOdds(1, 4);
        assertEq(o[0], 0);
        assertEq(o[1], 0);
        assertEq(o[3], 1e18);
        o = dealer.holoOdds(1, 0);
        assertApproxEqAbs(o[0], 0.95e18, 1e4);
        assertApproxEqAbs(o[1] + o[2] + o[3], 0.05e18, 1e4);
        uint256[] memory pool = dealer.poolFor(1, 167);
        assertEq(pool[0], 501); assertEq(pool[1], 301); assertEq(pool[2], 150); assertEq(pool[3], 49); assertEq(pool[4], 1);
        assertEq(dealer.poolOf(1).length, 0, "no pool before close");
        (string[] memory names, string[] memory cats) = dealer.charactersOf(1, 1, 10);
        assertEq(names.length, 2);
        assertEq(names[1], "Char2");
        assertEq(cats[0], "Cat 1");
    }

    // ---------------------------------------------------------------- new shapes

    /// A super-limited collection: 3-card packs, every card holo (the slot requires it), two Diamonds and one Gold in
    /// the whole Series.
    function test_threeCardAllHoloPack() public {
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](3);
        r.types[0] = _holoChances(_type("Flame", "flame", 0, RecipeDealer.Supply.Filler, 0), 0.2e18, 0.2e18);
        r.types[1] = _holoWeights(_type("Diamond", "diamond", 1, RecipeDealer.Supply.Count, 2), 0, 1, 1, 1);
        r.types[2] = _holoWeights(_type("Gold", "gold", 2, RecipeDealer.Supply.Count, 1), 0, 0, 0, 1);
        r.types[1].maxPerPack = 1;
        r.slots = new RecipeDealer.Slot[](1);
        r.slots[0] = _slotRange(3, 0, ANY);
        r.slots[0].mustHolo = true;
        _series(cards, dealer, owner, 7, r, 4);
        assertEq(cards.cardsPerPack(7), 3);
        _sellAndClose(7, 20);
        assertEq(_json(packs.uri(7)), _json(packs.uri(7))); // renders
        assertTrue(_contains(_json(packs.uri(7)), "A sealed pack of 3 cards from Series 7"));
        Dealt[] memory d = _openAll(7, 20, 1);
        assertEq(d.length, 60);
        uint256[3] memory n;
        for (uint256 i; i < d.length; i++) {
            assertTrue(d[i].frame || d[i].picture, "every card holo");
            if (d[i].cardType == 2) assertTrue(d[i].frame && d[i].picture, "Gold is always full holo");
            assertEq(d[i].openIndex, i / 3, "3 per pack");
            n[d[i].cardType]++;
        }
        assertEq(n[0], 57); assertEq(n[1], 2); assertEq(n[2], 1);
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
        dealer.setRecipe(8, StandardRecipe.build(2));
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

    /// A new card type, Platinum, added above Gold: the rank-range slots (Wood-or-better, Fire-or-better) take it
    /// with no other change; three in the Series, always full holo.
    function test_newTypeAdded() public {
        RecipeDealer.Recipe memory r = StandardRecipe.classic(2);
        RecipeDealer.CardType[] memory ts = new RecipeDealer.CardType[](6);
        for (uint256 i; i < 5; i++) ts[i] = r.types[i];
        ts[5] = _holoWeights(_type("Platinum", "platinum", 5, RecipeDealer.Supply.Count, 3), 0, 0, 0, 1);
        ts[5].maxPerPack = 1;
        r.types = ts;
        _series(cards, dealer, owner, 9, r, 5);
        _sellAndClose(9, 50);
        uint256[] memory pool = dealer.poolOf(9);
        assertEq(pool.length, 6);
        assertEq(pool[5], 3);
        assertEq(pool[0], 150);
        uint256 bp = pool[2] + pool[3] + pool[4] + pool[5];
        assertGe(bp, 50); assertLe(bp, 100);
        Dealt[] memory d = _openAll(9, 50, 3);
        uint256 gold;
        uint256 goldSerial;
        for (uint256 p; p < 50; p++) {
            uint256 paper; uint256 wood; uint256 better;
            for (uint256 k; k < 6; k++) {
                Dealt memory c = d[p * 6 + k];
                if (c.cardType == 0) paper++; else if (c.cardType == 1) wood++; else better++;
                if (c.cardType == 5) { gold++; goldSerial = c.serial; assertTrue(c.frame && c.picture); }
            }
            assertEq(paper, 3); assertGe(wood, 1); assertGe(better, 1);
        }
        assertEq(gold, 3);
        FireCards.Card memory g = cards.cardOf(goldSerial);
        assertEq(renderer.imageFile(goldSerial), string.concat("c", vm.toString(g.character), "-platinum-full-u.webp"));
        string memory json = _json(cards.tokenURI(goldSerial));
        assertTrue(_contains(json, '{"trait_type":"Material","value":"Platinum"}'), json);
        vm.parseJson(json);
    }

    /// One card per pack.
    function test_oneCardPacks() public {
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](2);
        r.types[0] = _type("Common", "common", 0, RecipeDealer.Supply.Filler, 0);
        r.types[1] = _holoChances(_type("Rare", "rare", 1, RecipeDealer.Supply.Count, 5), 1e18, 0);
        r.slots = new RecipeDealer.Slot[](1);
        r.slots[0] = _slotRange(1, 0, ANY);
        _series(cards, dealer, owner, 10, r, 2);
        _sellAndClose(10, 50);
        assertTrue(_contains(_json(packs.uri(10)), "A sealed pack of 1 card from Series 10"));
        Dealt[] memory d = _openAll(10, 50, 4);
        assertEq(d.length, 50);
        uint256 rare;
        for (uint256 i; i < 50; i++) {
            assertEq(d[i].serial, i + 1, "one card, one serial per pack");
            if (d[i].cardType == 1) { rare++; assertTrue(d[i].frame && !d[i].picture); }
            else assertFalse(d[i].frame || d[i].picture, "Common never holo");
        }
        assertEq(rare, 5);
    }

    /// A 1,000-card pack, dealt over many calls well under a block each, gives exactly what one long call gives.
    function test_hugePackChunked() public {
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](3);
        r.types[0] = _type("Common", "common", 0, RecipeDealer.Supply.Filler, 0);
        r.types[1] = _holoChances(_type("Rare", "rare", 1, RecipeDealer.Supply.Share, 100_000_000), 0.1e18, 0.1e18); // 10%
        r.types[2] = _holoWeights(_type("Epic", "epic", 2, RecipeDealer.Supply.Count, 7), 0, 1, 1, 1);
        r.slots = new RecipeDealer.Slot[](2);
        r.slots[0] = _slotRange(990, 0, ANY);
        r.slots[1] = _slotRange(10, 1, ANY); // Rare-or-better
        _series(cards, dealer, owner, 11, r, 30);
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
        assertEq(n3[1], 300); assertEq(n3[2], 7); assertEq(n3[0], 2693);
        // each pack (its own block of 1,000 serials) has at least 10 Rare-or-better
        for (uint256 p; p < 3; p++) {
            uint256 better;
            for (uint256 s = p * 1000 + 1; s <= p * 1000 + 1000; s++) if (cards.cardOf(s).cardType != 0) better++;
            assertGe(better, 10);
        }
    }

    // ---------------------------------------------------------------- the floor

    function test_floorTopsUpAGuaranteedType() public {
        // Gold is guaranteed in every pack but set to 1: the floor raises it to one per pack, from the filler
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](2);
        r.types[0] = _type("Common", "common", 0, RecipeDealer.Supply.Filler, 0);
        r.types[1] = _type("Gold", "gold", 1, RecipeDealer.Supply.Count, 1);
        r.slots = new RecipeDealer.Slot[](2);
        r.slots[0] = _slotOne(2, 0);
        r.slots[1] = _slotOne(1, 1);
        uint256[] memory pool = dealer.previewPool(r, 10, 1);
        assertEq(pool[0], 20); assertEq(pool[1], 10);
        _series(cards, dealer, owner, 12, r, 1);
        _sellAndClose(12, 10);
        Dealt[] memory d = _openAll(12, 10, 5);
        for (uint256 p; p < 10; p++) {
            uint256 gold;
            for (uint256 k; k < 3; k++) if (d[p * 3 + k].cardType == 1) gold++;
            assertEq(gold, 1);
        }
    }

    function test_floorTakesBackFromAnOversizedShare() public {
        // Rare set to 90% of the cards, but 5 of 6 slots only take Common: Rare comes back down to one per pack
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](2);
        r.types[0] = _type("Common", "common", 0, RecipeDealer.Supply.Filler, 0);
        r.types[1] = _type("Rare", "rare", 1, RecipeDealer.Supply.Share, 900_000_000);
        r.slots = new RecipeDealer.Slot[](2);
        r.slots[0] = _slotOne(5, 0);
        r.slots[1] = _slotRange(1, 0, ANY);
        uint256[] memory pool = dealer.previewPool(r, 100, 1);
        assertEq(pool[0], 500); assertEq(pool[1], 100);
        // and an exact count bigger than any pack could hold
        r.types[1].supply = RecipeDealer.Supply.Count;
        r.types[1].amount = 1_000_000;
        pool = dealer.previewPool(r, 3, 1);
        assertEq(pool[0], 15); assertEq(pool[1], 3);
        // a cap (at most one per pack's worth) applies before the floor
        r.types[1].amount = 7;
        r.types[1].maxPerPack = 1;
        r.slots[1] = _slotRange(1, 1, ANY); // Rare only
        r.slots[0].count = 1;
        r.slots[0].types[0] = 0;
        RecipeDealer.Slot[] memory s3 = new RecipeDealer.Slot[](3);
        s3[0] = r.slots[0];
        s3[1] = r.slots[1];
        s3[2] = _slotRange(1, 0, ANY);
        r.slots = s3;
        pool = dealer.previewPool(r, 4, 1); // 12 cards: Rare min(7, 4) = 4, Common 8
        assertEq(pool[1], 4); assertEq(pool[0], 8);
        pool = dealer.previewPool(r, 10, 1); // Rare 7 (under the cap), Common 23
        assertEq(pool[1], 10, "guaranteed slot: topped up to one per pack");
    }

    // ---------------------------------------------------------------- bad recipes are refused, with the reason

    function _two() internal pure returns (RecipeDealer.Recipe memory r) {
        r.types = new RecipeDealer.CardType[](3);
        r.types[0] = _type("A", "a", 0, RecipeDealer.Supply.Filler, 0);
        r.types[1] = _type("B", "b", 1, RecipeDealer.Supply.Count, 1);
        r.types[2] = _type("C", "c", 2, RecipeDealer.Supply.Count, 1);
        r.slots = new RecipeDealer.Slot[](1);
        r.slots[0] = _slotRange(3, 0, ANY);
    }

    function test_badRecipesRevert() public {
        RecipeDealer.Recipe memory r = _two();
        assertEq(dealer.check(r), 3);

        // overlapping slot sets that don't nest
        uint32[] memory ab = new uint32[](2);
        ab[0] = 0; ab[1] = 1;
        uint32[] memory bc = new uint32[](2);
        bc[0] = 1; bc[1] = 2;
        r.slots = new RecipeDealer.Slot[](2);
        r.slots[0] = _slotTypes(1, ab);
        r.slots[1] = _slotTypes(1, bc);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.NotNested.selector, 0, 1));
        dealer.check(r);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.NotNested.selector, 0, 1));
        dealer.setRecipe(20, r);

        // a type no slot takes
        r.slots = new RecipeDealer.Slot[](1);
        r.slots[0] = _slotTypes(2, ab);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.TypeNeverDealt.selector, 2));
        dealer.check(r);

        // filler: none, or two
        r = _two();
        r.types[0].supply = RecipeDealer.Supply.Count;
        vm.expectRevert(RecipeDealer.BadFiller.selector);
        dealer.check(r);
        r.types[0].supply = RecipeDealer.Supply.Filler;
        r.types[1].supply = RecipeDealer.Supply.Filler;
        vm.expectRevert(RecipeDealer.BadFiller.selector);
        dealer.check(r);
        r.types = new RecipeDealer.CardType[](0);
        vm.expectRevert(RecipeDealer.BadFiller.selector);
        dealer.check(r);

        // must-be-holo slot with a type that is never holo
        r = _two();
        r.slots[0].mustHolo = true;
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.NeverHolo.selector, 0, 0));
        dealer.check(r);

        // slots
        r = _two();
        r.slots[0].count = 0;
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadSlot.selector, 0, "count"));
        dealer.check(r);
        r = _two();
        r.slots[0] = _slotRange(3, 7, 9);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadSlot.selector, 0, "no type in rank range"));
        dealer.check(r);
        r.slots[0] = _slotRange(3, 2, 1);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadSlot.selector, 0, "rank range"));
        dealer.check(r);
        r.slots[0] = _slotOne(3, 3);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadSlot.selector, 0, "type index"));
        dealer.check(r);
        uint32[] memory aa = new uint32[](2);
        r.slots[0] = _slotTypes(3, aa);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadSlot.selector, 0, "type repeated"));
        dealer.check(r);
        r.slots = new RecipeDealer.Slot[](0);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadSlot.selector, 0, "no slots"));
        dealer.check(r);

        // types
        r = _two();
        r.types[1].slug = "Big";
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadType.selector, 1, "slug characters"));
        dealer.check(r);
        r.types[1].slug = "a";
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadType.selector, 1, "slug repeated"));
        dealer.check(r);
        r.types[1].slug = "";
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadType.selector, 1, "slug length"));
        dealer.check(r);
        r.types[1].slug = "b-2";
        r.types[1].supply = RecipeDealer.Supply.Share;
        r.types[1].amount = 1e9 + 1;
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadType.selector, 1, "share above 100%"));
        dealer.check(r);
        r.types[1].amount = 1e9;
        dealer.check(r); // 100% is allowed (the floor sorts it out)
        r.types[2].holo = [uint64(1e18 + 1), 0, 0, 0];
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadType.selector, 2, "holo chances"));
        dealer.check(r);
        r.types[2] = _holoWeights(r.types[2], 0, 0, 0, 0);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadType.selector, 2, "holo weights"));
        dealer.check(r);
    }

    // ---------------------------------------------------------------- everything locks at the first pack

    function test_everythingLocksAtTheFirstMint() public {
        RecipeDealer other = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        RecipeDealer.Recipe memory one = _two();
        (string[] memory names, string[] memory cats) = _chars(2);
        uint64[10] memory odds = [uint64(0), 0, 0, 0, 1, 1, 1, 1, 1, 1];

        // a dealer must have the Series set up before it can be chosen
        vm.prank(owner);
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.setDealer(1, address(other));
        vm.startPrank(owner);
        other.setRecipe(1, one);
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.setDealer(1, address(other)); // no characters yet
        other.setCharacters(1, names, cats);
        // before the first pack everything can change: the dealer, its recipe and characters, the PDA odds
        cards.setDealer(1, address(other));
        assertEq(cards.cardsPerPack(1), 3);
        other.setRecipe(1, StandardRecipe.build(4));
        other.appendCharacters(1, names, cats);
        psa.setOdds(1, odds);
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
        vm.expectRevert(FirePsa.FireIsClosed.selector);
        psa.setOdds(1, odds);
        vm.stopPrank();
        assertEq(cards.characterCount(1), 4);

        // the Series opens with the dealer it had at the first pack
        vm.prank(seller);
        cards.closeFire(1);
        Dealt[] memory d = _openAll(1, 1, 6);
        assertEq(d.length, 6, "Standard: 6 cards");

        // a closed Series (even with nothing sold) locks too
        _standard(cards, dealer, owner, 2, 1, 1);
        vm.prank(seller);
        cards.closeFire(2);
        vm.startPrank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setDealer(2, address(dealer));
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.setRecipe(2, one);
        vm.expectRevert(FirePsa.FireIsClosed.selector);
        psa.setOdds(2, odds);
        vm.stopPrank();
    }

    /// A must-be-holo slot uses the type's own odds, given it is holo.
    function test_mustHoloKeepsTheTypesShape() public {
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](1);
        r.types[0] = _holoChances(_type("Wood", "wood", 0, RecipeDealer.Supply.Filler, 0), 0.1e18, 0.1e18);
        r.slots = new RecipeDealer.Slot[](2);
        r.slots[0] = _slotOne(1, 0);
        r.slots[1] = _slotOne(1, 0);
        r.slots[1].mustHolo = true;
        _series(cards, dealer, owner, 13, r, 1);
        _sellAndClose(13, 300);
        Dealt[] memory d = _openAll(13, 300, 7);
        uint256[] memory order = dealer.dealOrder(13);
        assertEq(order[1], 1);
        uint256 full;
        uint256 single;
        uint256 freeHolo;
        for (uint256 p; p < 300; p++) {
            Dealt memory must = d[p * 2 + 1];
            assertTrue(must.frame || must.picture);
            if (must.frame && must.picture) full++; else single++;
            if (d[p * 2].frame || d[p * 2].picture) freeHolo++;
        }
        // given holo: full = 0.01 / 0.19 ~ 5%; frame-only and picture-only ~ 47% each
        assertLt(full, 40);
        assertGt(single, 250);
        assertLt(freeHolo, 100, "the other slot keeps the plain ~19%");
    }

    /// A recipe too big for one storage chunk (many types) still works, and reads back whole.
    function test_bigRecipeSpansChunks() public {
        uint256 T = 150;
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](T);
        for (uint256 t; t < T; t++) {
            r.types[t] = _type(
                string.concat("Type number ", vm.toString(t), " with a long descriptive name ok"),
                string.concat("type-", vm.toString(t)),
                uint32(t),
                t == 0 ? RecipeDealer.Supply.Filler : RecipeDealer.Supply.Count,
                t == 0 ? 0 : 1
            );
        }
        r.slots = new RecipeDealer.Slot[](2);
        r.slots[0] = _slotRange(2, 0, ANY);
        r.slots[1] = _slotRange(1, 75, ANY);
        _series(cards, dealer, owner, 14, r, 2);
        assertGt(abi.encode(r).length, 24_000, "more than one chunk");
        RecipeDealer.Recipe memory back = dealer.recipeOf(14);
        assertEq(back.types.length, T);
        assertEq(back.types[149].slug, "type-149");
        _sellAndClose(14, 200);
        Dealt[] memory d = _openAll(14, 200, 8);
        assertEq(d.length, 600);
        uint256[] memory left;
        (left,) = dealer.remainingOf(14);
        for (uint256 t; t < T; t++) assertEq(left[t], 0);
        for (uint256 p; p < 200; p++) {
            bool high;
            for (uint256 k; k < 3; k++) if (d[p * 3 + k].cardType >= 75) high = true;
            assertTrue(high, "slot 3 takes rank 75 and up");
        }
    }

    function test_remainingAndStateAsDealt() public {
        _sellAndClose(1, 10);
        (uint256[] memory left, uint256 packsLeft) = dealer.remainingOf(1);
        assertEq(packsLeft, 10);
        assertEq(left[0], 30);
        assertFalse(dealer.stateOf(1).started);
        vm.prank(_holder(0));
        cards.open(1, 1);
        rng.fulfill(rng.last(), 3);
        cards.process(1, 4); // part of a pack
        (left, packsLeft) = dealer.remainingOf(1);
        assertEq(packsLeft, 9, "the pack being dealt counts as started");
        assertEq(left[0] + left[1] + left[2] + left[3] + left[4], 56);
        assertTrue(dealer.stateOf(1).started);
        assertEq(dealer.stateOf(1).characters, 3);
    }

    // ---------------------------------------------------------------- the studio's recipe JSON

    /// script/ConfigureSeries.s.sol turns the studio's recipe JSON into the owner's calls; the Standard JSON gives
    /// exactly the Standard recipe.
    function test_configureSeriesFromJson() public {
        ConfigureSeries cs = new ConfigureSeries();
        string memory json = vm.readFile("test/cards/recipe-standard.json");
        ConfigureSeries.Series memory s = cs.parse(json);
        assertEq(s.fire, 7);
        assertEq(keccak256(abi.encode(s.recipe)), keccak256(abi.encode(StandardRecipe.build(0))), "same as StandardRecipe");
        ConfigureSeries.Call[] memory calls = cs.build(json, address(dealer), address(cards), address(psa), 2);
        assertEq(calls.length, 6, "recipe, 2 character batches, dealer, images, odds");
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
        assertTrue(psa.customOdds(7));
        // a bad recipe is caught before anything is printed
        string memory bad = vm.replace(json, '"minRank": 2', '"types": [9]');
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadSlot.selector, 3, "type index"));
        cs.build(bad, address(dealer), address(cards), address(psa), 2);
    }

    // ---------------------------------------------------------------- Full Art: one of each character

    /// The Standard recipe: Gold (15, full holo) and one Full Art per character, each character exactly once.
    function test_fullArtOnePerCharacter() public {
        _series(cards, dealer, owner, 20, StandardRecipe.build(0), 12);
        _sellAndClose(20, 100);
        uint256[] memory pool = dealer.poolOf(20);
        assertEq(pool.length, 6);
        assertEq(pool[4], 24, "Gold: 2 per character");
        assertEq(pool[5], 12, "one Full Art per character");
        Dealt[] memory d = _openAll(20, 100, 11);
        uint256[12] memory per;
        uint256 fa;
        uint256 gold;
        for (uint256 i; i < d.length; i++) {
            if (d[i].cardType == 5) {
                fa++;
                per[d[i].character]++;
                assertTrue(d[i].frame && d[i].picture, "Full Art: full holo");
            }
            if (d[i].cardType == 4) {
                gold++;
                assertTrue(d[i].frame && d[i].picture, "Gold: full holo");
            }
        }
        assertEq(fa, 12);
        assertEq(gold, 24);
        for (uint256 c; c < 12; c++) assertEq(per[c], 1, "each character exactly once");
    }

    function test_perCharacterAmounts() public {
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](2);
        r.types[0] = _type("Common", "common", 0, RecipeDealer.Supply.Filler, 0);
        r.types[1] = _holoWeights(_type("Alt", "alt", 1, RecipeDealer.Supply.PerCharacter, 3), 0, 0, 0, 1);
        r.slots = new RecipeDealer.Slot[](1);
        r.slots[0] = _slotRange(4, 0, ANY);
        _series(cards, dealer, owner, 21, r, 5);
        assertEq(dealer.poolFor(21, 30)[1], 15, "3 x 5 characters");
        _sellAndClose(21, 30);
        Dealt[] memory d = _openAll(21, 30, 12);
        uint256[5] memory per;
        for (uint256 i; i < d.length; i++) if (d[i].cardType == 1) per[d[i].character]++;
        for (uint256 c; c < 5; c++) assertEq(per[c], 3);
        r.types[1].amount = 0;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadType.selector, 1, "per character"));
        dealer.setRecipe(22, r);
    }

    /// The studio JSON is read strictly: unknown keys, odds on grades 1-4, and the perCharacter supply.
    function test_configureSeriesStrictParsing() public {
        ConfigureSeries cs = new ConfigureSeries();
        string memory json = vm.readFile("test/cards/recipe-standard.json");
        ConfigureSeries.Series memory s = cs.parse(json);
        assertEq(uint256(s.recipe.types[5].supply), uint256(RecipeDealer.Supply.PerCharacter));
        vm.expectRevert(bytes(".: unknown key pdaOdd"));
        cs.parse(vm.replace(json, '"pdaOdds"', '"pdaOdd"'));
        vm.expectRevert(bytes(".types[0]: unknown key amonut"));
        cs.parse(vm.replace(json, '"perPack", "amount": 3', '"perPack", "amonut": 3'));
        vm.expectRevert(bytes("pdaOdds: grades 1-4 must be 0 (they come only from wear)"));
        cs.parse(vm.replace(json, '"pdaOdds": ["0"', '"pdaOdds": ["5"'));
        vm.expectRevert(bytes(".types[2].rank is too big for its field"));
        cs.parse(vm.replace(json, '"rank": 2,', '"rank": 4294967296,'));
    }

    /// Per-character supply is exact: a recipe whose slots would top Full Art up past one per character (here "a Full
    /// Art in every pack") is refused, instead of dealing some character's Full Art twice.
    function test_perCharacterNeverToppedUpPastExact() public {
        RecipeDealer.Recipe memory r = StandardRecipe.build(0);
        RecipeDealer.Slot[] memory sl = new RecipeDealer.Slot[](5);
        for (uint256 i; i < 4; i++) sl[i] = r.slots[i];
        sl[4] = _slotOne(1, StandardRecipe.FULL_ART);
        r.slots = sl;
        vm.expectRevert(RecipeCompiler.Infeasible.selector); // the dry run (2 packs, 1 character) catches it
        dealer.check(r);
        vm.prank(owner);
        vm.expectRevert(RecipeCompiler.Infeasible.selector);
        dealer.setRecipe(30, r);
    }
}
