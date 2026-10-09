// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {RecipeDealer} from "../../src/cards/RecipeDealer.sol";
import {RecipeCompiler} from "../../src/cards/RecipeCompiler.sol";
import {CardsRenderer} from "../../src/cards/CardsRenderer.sol";
import {PaperBurner} from "../../src/cards/PaperBurner.sol";
import {FireCredits} from "../../src/cards/FireCredits.sol";
import {StandardRecipe} from "../../src/cards/StandardRecipe.sol";
import {DeployCards} from "../../script/DeployCards.s.sol";
import {AcceptOwnership} from "../../script/AcceptOwnership.s.sol";
import {MockERC20, MockUSDG, MockFeed, MockPlankTwap, MockPair, MockV2Factory, MockRouterInfo} from "../Mocks.sol";
import {OpenDrandRouter} from "../../src/OpenDrandRouter.sol";
import {SeriesHelper, RecipeHarness} from "./SeriesHelper.sol";

/// @dev Stands in for the drand adapter: hands out ids, the test delivers words.
contract MockRandomness {
    FireCards public cards;
    uint256 public next = 1;
    mapping(uint256 => bool) public answered;

    function setCards(FireCards c) external { cards = c; }

    function request() external returns (uint256) { return next++; }
    function answerSilently(uint256 id) external { answered[id] = true; }

    function deliver(uint256 id, uint256 word) external {
        answered[id] = true;
        cards.onRandomness(id, word);
    }
}

/// @dev A holder contract that refuses ERC-721 transfers. It must still receive its cards and must not stall others.
contract Grumpy {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { revert("no"); }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }
    function open(FireCards c, uint256 fire) external { c.open(fire, 1); }
}

/// @dev An opener whose wallet can later refuse ERC-1155 (an upgradeable wallet, or an EIP-7702 delegated EOA).
contract Toggle {
    bool public refuse;
    function setRefuse(bool r) external { refuse = r; }
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external view returns (bytes4) {
        require(!refuse, "no thanks");
        return this.onERC1155Received.selector;
    }
    function open(FireCards c, uint256 fire) external { c.open(fire, 1); }
}

contract CardsTest is SeriesHelper {
    using stdJson for string;

    address owner = address(0xA11CE);
    address seller = address(0x5E11);
    FirePacks packs;
    FireCards cards;
    RecipeDealer dealer;
    CardsRenderer renderer;
    MockRandomness rng;
    bytes32 constant DEALT = keccak256("CardDealt(uint256,uint256,uint256,uint256,bool,bool,uint256)");

    function setUp() public {
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        dealer = new RecipeDealer(owner, address(cards), address(new RecipeCompiler()));
        rng = new MockRandomness();
        rng.setCards(cards);
        vm.startPrank(owner);
        packs.setSeller(seller);
        packs.setCards(address(cards));
        cards.setSeller(seller);
        cards.setRandomness(address(rng));
        cards.setDefaultRoyalty(owner, 500);
        renderer = new CardsRenderer(address(cards));
        cards.setRenderer(address(renderer));
        vm.stopPrank();
        _configure(1, 3);
    }

    function _configure(uint256 fire, uint256 n) internal {
        _standard(cards, dealer, owner, fire, n, 1);
    }

    function _holder(uint256 i) internal pure returns (address) { return address(uint160(0x1000 + i)); }

    /// Sell `n` packs of `fire` spread across holders, close the Fire.
    function _sellAndClose(uint256 fire, uint256 n) internal {
        vm.startPrank(seller);
        for (uint256 i; i < n; i++) packs.mint(_holder(i % 17), fire, 1);
        cards.closeFire(fire);
        vm.stopPrank();
    }

    /// Open every pack one at a time (one open per pack), deliver words, process. Returns types per pack.
    function _openAll(uint256 fire, uint256 n, uint256 salt) internal returns (uint256[6][] memory perPack) {
        uint256 first = rng.next();
        for (uint256 i; i < n; i++) { vm.prank(_holder(i % 17)); cards.open(fire, 1); }
        vm.recordLogs();
        for (uint256 i; i < n; i++) rng.deliver(first + i, uint256(keccak256(abi.encode(salt, i))));
        cards.process(fire, type(uint256).max);
        perPack = new uint256[6][](n);
        uint256[] memory filled = new uint256[](n);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 base = type(uint256).max;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != DEALT) continue;
            (uint256 openIndex, uint256 cardType,,,) = abi.decode(logs[i].data, (uint256, uint256, bool, bool, uint256));
            if (base == type(uint256).max) base = openIndex;
            uint256 p = openIndex - base;
            perPack[p][filled[p]++] = cardType;
        }
    }

    function _pool(uint256 fire) internal view returns (uint256[] memory) {
        return dealer.poolOf(fire);
    }

    // ---------- the rarity math matches the studio exactly ----------

    function test_collectionNames() public view {
        assertEq(cards.name(), "Omni Cards");
        assertEq(cards.symbol(), "OMNICARD");
        assertEq(packs.name(), "Omni Card Packs");
        assertEq(packs.symbol(), "OMNIPACK");
    }

    /// The Standard recipe's pool, through the dealer's general floor rule, equals the studio's computePool on every
    /// row of the fixture (written by studio/scripts/pool-fixture.test.ts; format unchanged).
    function test_poolParityWithStudio() public {
        RecipeHarness h = new RecipeHarness(address(cards));
        string memory json = vm.readFile("test/cards/pool-fixture.json");
        uint256 rows;
        while (json.keyExists(string.concat(".rows[", vm.toString(rows), "]"))) rows++;
        assertGt(rows, 300, "fixture has its rows");
        bool sawCap; // a row where the Diamond setting is above the pack count
        bool sawFloor; // a row where the pack floor moved cards
        uint256 lastD = type(uint256).max;
        bytes memory plan;
        for (uint256 i; i < rows; i++) {
            string memory p = string.concat(".rows[", vm.toString(i), "]");
            uint256 n = json.readUint(string.concat(p, ".packs"));
            uint256 d = json.readUint(string.concat(p, ".diamonds"));
            uint256[] memory counts = json.readUintArray(string.concat(p, ".counts"));
            if (d != lastD) {
                plan = h.compile(StandardRecipe.classic(d));
                lastD = d;
            }
            uint256[] memory c = h.pool(plan, n);
            for (uint256 m; m < 5; m++) assertEq(c[m], counts[m], string.concat("count row ", vm.toString(i)));
            if (n > 0 && d > n) sawCap = true;
            if (c[2] != (15_000 * 6 * n + 50_000) / 100_000) sawFloor = true;
        }
        assertTrue(sawCap && sawFloor, "fixture covers the Diamond cap and the pack floor");
        // the owner's worked example
        uint256[] memory e = dealer.previewPool(StandardRecipe.classic(1), 167, 1);
        assertEq(e[0], 501); assertEq(e[1], 301); assertEq(e[2], 150); assertEq(e[3], 49); assertEq(e[4], 1);
    }

    // ---------- every pack keeps the guarantees and the Fire's totals come out exact ----------

    function test_fullFireTotalsAndGuarantees() public {
        uint256 n = 150;
        _sellAndClose(1, n);
        uint256[6][] memory perPack = _openAll(1, n, 7);
        uint256[5] memory totals;
        for (uint256 p; p < n; p++) {
            uint256 paper; uint256 wood; uint256 bp;
            for (uint256 k; k < 6; k++) {
                uint256 m = perPack[p][k];
                totals[m]++;
                if (m == 0) paper++; else if (m == 1) wood++; else bp++;
            }
            assertEq(paper, 3, "3 Paper per pack");
            assertGe(wood, 1, "slot 4 Wood");
            assertGe(bp, 1, "slot 6 Fire-or-better");
            assertEq(wood + bp, 3, "slots 4-6 Wood or better");
        }
        uint256[] memory pool = _pool(1);
        uint256 sum;
        for (uint256 m; m < 5; m++) { assertEq(totals[m], pool[m]); sum += pool[m]; }
        assertEq(sum, n * 6);
        assertEq(cards.nextSerial(), n * 6 + 1);
        (, bool closed,, uint32 per, uint64 total, uint64 dealt) = cards.fires(1);
        assertTrue(closed); assertEq(per, 6); assertEq(total, n); assertEq(dealt, n);
        (uint256[] memory left, uint256 packsLeft) = dealer.remainingOf(1);
        assertEq(packsLeft, 0);
        for (uint256 m; m < 5; m++) assertEq(left[m], 0, "everything dealt");
    }

    function test_smallFiresKeepGuarantees() public {
        for (uint256 f = 2; f < 12; f++) {
            _configure(f, 1 + f % 4);
            uint256 n = 1 + (f * 7) % 9;
            _sellAndClose(f, n);
            uint256[6][] memory perPack = _openAll(f, n, f);
            for (uint256 p; p < n; p++) {
                uint256 paper; uint256 bp;
                for (uint256 k; k < 6; k++) { if (perPack[p][k] == 0) paper++; if (perPack[p][k] >= 2) bp++; }
                assertEq(paper, 3);
                assertGe(bp, 1);
            }
        }
    }

    /// The deal order the recipe gives (most specific group first) and every pack position's slot.
    function test_dealOrderOfTheStandardPack() public view {
        uint256[] memory o = dealer.dealOrder(1);
        // depth 2: Wood (slot 1), Fire-or-better (slot 3); depth 1: Paper x3 (slot 0), Wood-or-better (slot 2)
        uint256[6] memory want = [uint256(1), 3, 0, 0, 0, 2];
        assertEq(o.length, 6);
        for (uint256 i; i < 6; i++) assertEq(o[i], want[i]);
    }

    // ---------- order is fixed: results depend only on words and open order ----------

    function test_outOfOrderWordsWaitForTheQueue() public {
        _sellAndClose(1, 4);
        uint256 first = rng.next();
        for (uint256 i; i < 3; i++) { vm.prank(_holder(i)); cards.open(1, 1); }
        rng.deliver(first + 1, 111); // second open's word arrives first
        assertEq(cards.process(1, 100), 0, "nothing dealt until the head is ready");
        rng.deliver(first, 222);
        assertEq(cards.process(1, 100), 12, "head and the one behind it");
        assertEq(cards.headOf(1), 2);
        rng.deliver(first + 2, 333);
        assertEq(cards.process(1, 100), 6);
    }

    function test_sameWordsSameCardsWhateverTheProcessingPattern() public {
        _sellAndClose(1, 30);
        uint256 first = rng.next();
        for (uint256 i; i < 30; i++) { vm.prank(_holder(i % 17)); cards.open(1, 1); }
        uint256 snap = vm.snapshotState();
        for (uint256 i; i < 30; i++) rng.deliver(first + i, uint256(keccak256(abi.encode("w", i))));
        cards.process(1, type(uint256).max);
        uint256[] memory a = new uint256[](180);
        for (uint256 s = 1; s <= 180; s++) a[s - 1] = uint256(keccak256(abi.encode(cards.cardOf(s), cards.ownerOf(s))));
        vm.revertToState(snap);
        // deliver and process in odd pieces: 1, 5, 7 cards at a time (packs split across calls)
        for (uint256 i; i < 30; i++) {
            rng.deliver(first + i, uint256(keccak256(abi.encode("w", i))));
            cards.process(1, 1 + (i % 3) * 3 + i % 2);
        }
        while (cards.process(1, 5) > 0) {}
        for (uint256 s = 1; s <= 180; s++) assertEq(uint256(keccak256(abi.encode(cards.cardOf(s), cards.ownerOf(s)))), a[s - 1]);
    }

    /// Each pack's six cards fill its own block of six serials, in a shuffled order.
    function test_eachPackGetsItsOwnBlockOfSerials() public {
        _sellAndClose(1, 40);
        uint256 first = rng.next();
        for (uint256 i; i < 40; i++) { vm.prank(_holder(i % 17)); cards.open(1, 1); }
        vm.recordLogs();
        for (uint256 i; i < 40; i++) rng.deliver(first + i, i * 77 + 1);
        cards.process(1, type(uint256).max);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 n;
        uint256[6] memory firstSlotPos; // where the first-dealt card (slot Wood) landed in its block
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != DEALT) continue;
            (uint256 openIndex,,,,) = abi.decode(logs[i].data, (uint256, uint256, bool, bool, uint256));
            uint256 serial = uint256(logs[i].topics[2]);
            assertEq((serial - 1) / 6, openIndex, "the pack's own block");
            if (n % 6 == 0) firstSlotPos[(serial - 1) % 6]++;
            n++;
        }
        assertEq(n, 240);
        uint256 spots;
        for (uint256 i; i < 6; i++) if (firstSlotPos[i] > 0) spots++;
        assertGe(spots, 4, "the slot doesn't fix the serial");
    }

    // ---------- holo rates ----------

    function test_holoRatesConverge() public {
        uint256 n = 600; // 3,600 cards
        _sellAndClose(1, n);
        _openAll(1, n, 99);
        uint256[5] memory cnt; uint256[5] memory holo; uint256 diamondNone;
        for (uint256 s = 1; s <= n * 6; s++) {
            FireCards.Card memory c = cards.cardOf(s);
            cnt[c.cardType]++;
            if (c.holoFrame || c.holoPicture) holo[c.cardType]++;
            if (c.cardType == 4 && !c.holoFrame && !c.holoPicture) diamondNone++;
        }
        // paper 5%, wood 10%, fire 50%, coal 90% within 4 standard deviations
        _within(holo[0], cnt[0], 50_000);
        _within(holo[1], cnt[1], 100_000);
        _within(holo[2], cnt[2], 500_000);
        _within(holo[3], cnt[3], 900_000);
        assertEq(diamondNone, 0, "Diamond always holo");
        assertEq(holo[4], cnt[4]);
        assertGt(cnt[4], 0);
    }

    function _within(uint256 k, uint256 n, uint256 ratePpm) internal pure {
        // |k/n - r| < 4 sqrt(r(1-r)/n)  <=>  (k*1e6 - r*n)^2 < 16 r (1e6 - r) n
        int256 d = int256(k * 1e6) - int256(ratePpm * n);
        assertLt(uint256(d * d), 16 * ratePpm * (1e6 - ratePpm) * n, "holo rate off");
    }

    /// Exactly the old rolls: Diamond k = r1 % 3 gives frame / picture / full a third each; other types hit exactly
    /// below their chance.
    /// Gold is always full holo; other types hit exactly below their roll chance.
    function test_rollHoloGoldFullAndRates() public {
        RecipeHarness h = new RecipeHarness(address(cards));
        bytes memory plan = h.compile(StandardRecipe.classic(1));
        for (uint256 i; i < 300; i++) {
            (bool f, bool p) = h.holo(plan, 4, false, i * 7919, i);
            assertTrue(f && p, "Gold: full holo");
        }
        uint256 pp = StandardRecipe.PAPER_ROLL;
        (bool a,) = h.holo(plan, 0, false, pp - 1, 0);
        (bool b,) = h.holo(plan, 0, false, pp, 0);
        assertTrue(a); assertFalse(b);
        (, bool c) = h.holo(plan, 0, false, 0, pp - 1);
        (, bool d) = h.holo(plan, 0, false, 0, pp + 1e18); // taken modulo 1e18
        assertTrue(c); assertFalse(d);
    }

    // ---------- secret until opened, permissions, queue safety ----------

    function test_packIsBurnedOnOpenAndNothingIsDealtBeforeTheWord() public {
        _sellAndClose(1, 2);
        address h = _holder(0);
        assertEq(packs.balanceOf(h, 1), 1);
        vm.prank(h);
        cards.open(1, 1);
        assertEq(packs.balanceOf(h, 1), 0, "burned on open");
        assertEq(cards.nextSerial(), 1, "no card exists yet");
        assertEq(cards.process(1, 5), 0);
        assertFalse(dealer.stateOf(1).started, "the pool isn't even laid out yet");
    }

    function test_cannotOpenBeforeCloseOrWithoutAPack() public {
        vm.prank(seller);
        packs.mint(_holder(0), 1, 1);
        vm.prank(_holder(0));
        vm.expectRevert(FireCards.FireNotClosed.selector);
        cards.open(1, 1);
        vm.prank(seller);
        cards.closeFire(1);
        vm.prank(_holder(5)); // owns no pack
        vm.expectRevert();
        cards.open(1, 1);
        vm.prank(_holder(0));
        vm.expectRevert(FireCards.BadCount.selector);
        cards.open(1, 0);
    }

    function test_onlySellerClosesAndOnlyOnce() public {
        vm.expectRevert(FireCards.NotSeller.selector);
        cards.closeFire(1);
        vm.prank(seller);
        cards.closeFire(1);
        vm.prank(seller);
        vm.expectRevert(FireCards.FireIsClosed.selector);
        cards.closeFire(1);
        vm.prank(seller);
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.closeFire(99); // no dealer
    }

    function test_onlyRandomnessDeliversAndThereIsNoRerequest() public {
        _sellAndClose(1, 1);
        vm.prank(_holder(0));
        cards.open(1, 1);
        vm.expectRevert(FireCards.NotRandomness.selector);
        cards.onRandomness(1, 5);
        (bool ok,) = address(cards).call(abi.encodeWithSignature("rerequest(uint256,uint256)", 1, 0));
        assertFalse(ok, "no re-request: one open, one number");
        rng.deliver(1, 42);
        assertEq(cards.process(1, 100), 6);
        vm.expectRevert(FireCards.NotRandomness.selector);
        rng.deliver(1, 43); // answered once: a second answer is refused
    }

    /// The owner can switch the randomness source at any time. New opens use the new one; an open waiting on the old
    /// one is answered by it (and only it), or cancelled after CANCEL_AFTER if it never answers.
    function test_randomnessSwitchKeepsEachOpensSource() public {
        _sellAndClose(1, 3);
        vm.prank(_holder(0)); cards.open(1, 1); // old source, id 1
        vm.prank(_holder(1)); cards.open(1, 1); // old source, id 2
        MockRandomness rng2 = new MockRandomness();
        rng2.setCards(cards);
        vm.prank(_holder(0));
        vm.expectRevert(); // not the owner
        cards.setRandomness(address(rng2));
        vm.expectEmit(address(cards));
        emit FireCards.RandomnessSet(address(rng2));
        vm.prank(owner);
        cards.setRandomness(address(rng2)); // no delay
        vm.prank(_holder(2)); cards.open(1, 1); // new source, id 1 (the same number as the old source's first)
        FireCards.Open memory o = cards.openOf(1, 2);
        assertEq(o.source, address(rng2));
        assertEq(o.requestId, 1);
        assertEq(cards.openOf(1, 0).source, address(rng));

        // the new source can't answer the old source's request 1, even with the same id: it answers its own
        rng2.deliver(1, 7);
        assertFalse(cards.openOf(1, 0).ready, "the old open still waits for its own source");
        assertTrue(cards.openOf(1, 2).ready);
        vm.expectRevert(FireCards.NotRandomness.selector);
        rng2.deliver(2, 7); // the new source never took request 2
        // the old source still answers its pending open
        rng.deliver(1, 5);
        assertTrue(cards.openOf(1, 0).ready);
        assertEq(cards.process(1, 100), 6, "the head is dealt; the next waits for the old source's second answer");
        // the old source never answers its second open: after CANCEL_AFTER it is cancelled, the pack comes back
        vm.expectRevert(FireCards.NotStuck.selector);
        cards.cancelOpen(1, 1);
        vm.warp(block.timestamp + 7 days);
        cards.cancelOpen(1, 1);
        assertEq(packs.balanceOf(_holder(1), 1), 1);
        vm.expectRevert(FireCards.NotRandomness.selector);
        rng.deliver(2, 9); // a late answer for a cancelled open is refused
        assertEq(cards.process(1, 100), 6, "the queue moves on to the new source's open");
        assertEq(cards.balanceOf(_holder(2)), 6);
    }

    function test_onlyCardsCanDeal() public {
        vm.expectRevert(RecipeDealer.NotCards.selector);
        dealer.deal(1, 5, 0, 6);
    }

    function test_refusingContractCannotStallTheQueue() public {
        Grumpy g = new Grumpy();
        vm.prank(seller);
        packs.mint(address(g), 1, 1);
        vm.prank(seller);
        packs.mint(_holder(1), 1, 1);
        vm.prank(seller);
        cards.closeFire(1);
        uint256 first = rng.next();
        g.open(cards, 1);
        vm.prank(_holder(1));
        cards.open(1, 1);
        rng.deliver(first, 1);
        rng.deliver(first + 1, 2);
        assertEq(cards.process(1, 100), 12);
        assertEq(cards.balanceOf(address(g)), 6);
        assertEq(cards.balanceOf(_holder(1)), 6);
    }

    function test_multiPackOpen() public {
        vm.prank(seller);
        packs.mint(_holder(0), 1, 25);
        vm.prank(seller);
        cards.closeFire(1);
        uint256 id = rng.next();
        vm.prank(_holder(0));
        cards.open(1, 25); // no cap on packs per open: dealing is chunked
        rng.deliver(id, 77);
        assertEq(cards.process(1, 100), 100, "stops at 100 cards, mid-open");
        FireCards.Open memory o = cards.openOf(1, 0);
        assertEq(o.count, 25); assertEq(o.packsDone, 16); assertEq(o.cardInPack, 4);
        assertEq(cards.process(1, 1000), 50);
        assertEq(cards.balanceOf(_holder(0)), 150);
        assertEq(cards.headOf(1), 1);
    }

    // ---------- metadata and royalty ----------

    function test_tokenUriAndImage() public {
        _sellAndClose(1, 3);
        _openAll(1, 3, 5);
        FireCards.Card memory c = cards.cardOf(1);
        string memory file = renderer.imageFile(1);
        string[5] memory slugs = ["paper", "wood", "fire", "coal", "gold"];
        assertEq(file, renderer.imageName(c.character, slugs[c.cardType], c.holoFrame, c.holoPicture, 0, false));
        string memory uri = cards.tokenURI(1);
        assertTrue(_startsWith(uri, "data:application/json;base64,"));
        string memory json = _json(uri);
        vm.parseJson(json); // valid JSON
        string[5] memory names_ = ["Paper", "Wood", "Fire", "Coal", "Gold"];
        assertTrue(_contains(json, string.concat('{"trait_type":"Material","value":"', names_[c.cardType], '"}')), json);
        assertTrue(_contains(json, string.concat('"name":"', names_[c.cardType], " Char")), json);
        assertGt(c.editionOf, 0, "edition total known once every pack is dealt");
        (address r, uint256 amt) = cards.royaltyInfo(1, 10_000);
        assertEq(r, owner);
        assertEq(amt, 500);
        assertTrue(cards.supportsInterface(0x2a55205a)); // ERC-2981
        assertTrue(cards.supportsInterface(0x49064906)); // ERC-4906
        string memory pack = _json(packs.uri(1));
        assertTrue(_contains(pack, "A sealed pack of 6 cards from Series 1"), pack);
        vm.parseJson(pack);
    }

    function test_configLocks() public {
        vm.prank(owner);
        cards.lockFire(1);
        (string[] memory names, string[] memory cats) = _chars(1);
        vm.startPrank(owner);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.setCharacters(1, names, cats);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.setRecipe(1, StandardRecipe.classic(2));
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setDealer(1, address(dealer));
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setImagesBase(1, "x");
        vm.stopPrank();
    }

    // ---------- Diamonds per Series (each Series stands alone) ----------

    function test_diamondsDefaultToOne() public {
        assertEq(StandardRecipe.classic(0).types[4].amount, 15, "Gold: 15 by default");
        assertEq(dealer.recipeOf(1).types[4].amount, 1);
        _sellAndClose(1, 150);
        assertEq(_pool(1)[4], 1);
        assertEq(_pool(1)[1], 270);
    }

    function test_setDiamonds() public {
        vm.prank(owner);
        dealer.setRecipe(1, StandardRecipe.classic(3));
        assertEq(dealer.recipeOf(1).types[4].amount, 3);
        vm.prank(owner);
        dealer.setRecipe(1, StandardRecipe.classic(2)); // can change until the packs sell
        assertEq(dealer.recipeOf(1).types[4].amount, 2);
        assertEq(dealer.recipeOf(2).types.length, 0, "other Series untouched");
        // no product cap on Diamonds any more (it was 1000): only one per pack's worth, from the recipe
        vm.prank(owner);
        dealer.setRecipe(1, StandardRecipe.classic(1_000_000));
        assertEq(dealer.poolFor(1, 10)[4], 10);
    }

    function test_setRecipeOnlyOwner() public {
        RecipeDealer.Recipe memory r = StandardRecipe.classic(2);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        dealer.setRecipe(1, r);
        (string[] memory names, string[] memory cats) = _chars(1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        dealer.setCharacters(1, names, cats);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        dealer.appendCharacters(1, names, cats);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        cards.setDealer(1, address(dealer));
    }

    function test_setDiamondsLocks() public {
        // locked Series
        vm.startPrank(owner);
        cards.lockFire(1);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.setRecipe(1, StandardRecipe.classic(2));
        vm.stopPrank();
        // after the first pack sells
        _configure(2, 3);
        vm.prank(seller);
        packs.mint(_holder(0), 2, 1);
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.setRecipe(2, StandardRecipe.classic(2));
        // closed (even with no packs sold)
        _configure(3, 3);
        vm.prank(seller);
        cards.closeFire(3);
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.setRecipe(3, StandardRecipe.classic(2));
    }

    function test_diamondsSetTheClosedPool() public {
        vm.prank(owner);
        dealer.setRecipe(1, StandardRecipe.classic(3));
        _sellAndClose(1, 167);
        uint256[5] memory want = [uint256(501), 299, 150, 49, 3];
        uint256[] memory pool = _pool(1);
        for (uint256 m; m < 5; m++) assertEq(pool[m], want[m]);
        (uint256[] memory left, uint256 packsLeft) = dealer.remainingOf(1);
        assertEq(left[3], 49);
        assertEq(left[4], 3);
        assertEq(packsLeft, 167);
        // every Diamond is dealt
        uint256[6][] memory perPack = _openAll(1, 167, 3);
        uint256 dia;
        for (uint256 p; p < 167; p++) for (uint256 k; k < 6; k++) if (perPack[p][k] == 4) dia++;
        assertEq(dia, 3);
    }

    function test_diamondsCappedAtOnePerPack() public {
        vm.prank(owner);
        dealer.setRecipe(1, StandardRecipe.classic(1000));
        _sellAndClose(1, 4);
        assertEq(_pool(1)[4], 4);
        assertEq(_pool(1)[1], 4, "Wood >= packs");
        uint256[6][] memory perPack = _openAll(1, 4, 9);
        uint256 dia;
        for (uint256 p; p < 4; p++) {
            uint256 paper; uint256 wood; uint256 bp;
            for (uint256 k; k < 6; k++) {
                uint256 m = perPack[p][k];
                if (m == 0) paper++;
                else if (m == 1) wood++;
                else bp++;
                if (m == 4) dia++;
            }
            assertEq(paper, 3);
            assertGe(wood, 1);
            assertGe(bp, 1);
        }
        assertEq(dia, 4);
    }

    function test_eachSeriesStandsAlone() public {
        _configure(2, 3);
        _sellAndClose(1, 150);
        _sellAndClose(2, 150);
        for (uint256 m; m < 5; m++) assertEq(_pool(2)[m], _pool(1)[m], "same packs, same pool");
    }

    function _startsWith(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s); bytes memory b = bytes(p);
        if (a.length < b.length) return false;
        for (uint256 i; i < b.length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    // ---------- gas: Standard opening ----------

    /// Prints the Standard opening's gas (before this redesign: open 1 pack ~101.9k, process 1 pack ~345.8k, a
    /// 10-pack open ~3.26M). `forge test --match-test test_gas -vv`.
    function test_gas_standardOpening() public {
        _configure(5, 20);
        vm.prank(seller);
        packs.mint(_holder(0), 5, 160);
        vm.prank(seller);
        cards.closeFire(5);
        uint256 totOpen;
        uint256 totProc;
        for (uint256 k; k < 100; k++) {
            vm.prank(_holder(0));
            uint256 g = gasleft();
            cards.open(5, 1);
            totOpen += g - gasleft();
            rng.deliver(rng.next() - 1, uint256(keccak256(abi.encode(k))));
            g = gasleft();
            cards.process(5, 6);
            totProc += g - gasleft();
        }
        emit log_named_uint("open 1 pack, avg gas", totOpen / 100);
        emit log_named_uint("process 1 pack (6 cards), avg gas", totProc / 100);
        vm.prank(_holder(0));
        cards.open(5, 10);
        rng.deliver(rng.next() - 1, 5);
        uint256 g2 = gasleft();
        cards.process(5, 60);
        emit log_named_uint("process a 10-pack open, gas", g2 - gasleft());
        assertLt(totProc / 100, 450_000, "a pack stays cheap");
    }

    // ---------- audit fixes ----------

    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);

    function test_audit_lastPackDealtRefreshesEditions() public {
        _sellAndClose(1, 2);
        vm.prank(_holder(0)); cards.open(1, 1);
        vm.prank(_holder(1)); cards.open(1, 1);
        rng.deliver(1, 5);
        rng.deliver(2, 6);
        cards.process(1, 6); // first pack: no refresh
        vm.expectEmit(address(cards));
        emit BatchMetadataUpdate(1, 12); // the last pack: every card's Edition becomes "k of N"
        cards.process(1, 6);
    }

    function test_audit_textThatWouldBreakJsonIsRejected() public {
        (string[] memory names, string[] memory cats) = _one("Person");
        names[0] = 'Bad "quote';
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.BadText.selector);
        dealer.setCharacters(5, names, cats);
        vm.prank(owner);
        vm.expectRevert(FireCards.BadText.selector);
        cards.setImagesBase(5, "ipfs://x\\/");
        // card type names too
        RecipeDealer.Recipe memory r = StandardRecipe.classic(1);
        r.types[2].name = "Fi\"re";
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(RecipeDealer.BadType.selector, 2, "name length"));
        dealer.setRecipe(5, _withName(r, 2, ""));
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.BadText.selector);
        dealer.setRecipe(5, _withName(r, 2, "Fi\"re"));
    }

    function _withName(RecipeDealer.Recipe memory r, uint256 t, string memory name)
        internal
        pure
        returns (RecipeDealer.Recipe memory)
    {
        r.types[t].name = name;
        return r;
    }

    // ---------- categories: free text per character ----------

    function _one(string memory cat) internal pure returns (string[] memory names, string[] memory cats) {
        names = new string[](1);
        cats = new string[](1);
        names[0] = "Solo";
        cats[0] = cat;
    }

    function test_categoryTextInTokenUri() public {
        (string[] memory names, string[] memory cats) = _one(unicode"Rock Stars é");
        vm.startPrank(owner);
        dealer.setRecipe(9, StandardRecipe.classic(1));
        dealer.setCharacters(9, names, cats);
        cards.setDealer(9, address(dealer));
        cards.setImagesBase(9, "ipfs://x/");
        vm.stopPrank();
        _sellAndClose(9, 1);
        _openAll(9, 1, 3);
        string memory json = _json(cards.tokenURI(1));
        assertTrue(_contains(json, unicode'{"trait_type":"Category","value":"Rock Stars é"}'), json);
        vm.parseJson(json); // still valid JSON
    }

    function test_categoryRules() public {
        string[] memory names;
        string[] memory cats;
        (names, cats) = _one("");
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.BadText.selector);
        dealer.setCharacters(5, names, cats);

        (names, cats) = _one("123456789012345678901234567890123"); // 33 bytes
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.BadText.selector);
        dealer.setCharacters(5, names, cats);

        string[4] memory bad = ['Say "hi"', "back\\slash", "tab\tin", "new\nline"];
        for (uint256 i; i < bad.length; i++) {
            (names, cats) = _one(bad[i]);
            vm.prank(owner);
            vm.expectRevert(RecipeDealer.BadText.selector);
            dealer.setCharacters(5, names, cats);
        }

        (names, cats) = _one("12345678901234567890123456789012"); // exactly 32 bytes is fine
        vm.prank(owner);
        dealer.setCharacters(5, names, cats);
    }

    function test_categoryCountMustMatchNames() public {
        string[] memory names = new string[](2);
        string[] memory cats = new string[](1);
        names[0] = "A"; names[1] = "B"; cats[0] = "Person";
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.BadLength.selector);
        dealer.setCharacters(5, names, cats);
    }

    function test_audit_royaltyCappedAt10Percent() public {
        vm.startPrank(owner);
        vm.expectRevert(FireCards.RoyaltyTooHigh.selector);
        cards.setDefaultRoyalty(owner, 1_001);
        vm.expectRevert(FirePacks.RoyaltyTooHigh.selector);
        packs.setDefaultRoyalty(owner, 1_001);
        vm.stopPrank();
    }

    // ---------- audit round 2 ----------

    function test_audit2_charactersFixedOncePacksSell() public {
        vm.prank(seller);
        packs.mint(_holder(0), 1, 1);
        (string[] memory names, string[] memory cats) = _chars(5);
        vm.startPrank(owner);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.setCharacters(1, names, cats);
        vm.expectRevert(RecipeDealer.FireIsLocked.selector);
        dealer.appendCharacters(1, names, cats);
        vm.stopPrank();
    }

    function test_audit2_stuckOpenCanBeCancelledAfterAWeek() public {
        _sellAndClose(1, 2);
        vm.prank(_holder(0)); cards.open(1, 1);
        vm.prank(_holder(1)); cards.open(1, 1);
        vm.warp(block.timestamp + 7 days);
        cards.cancelOpen(1, 0); // randomness gone for good: the pack comes back sealed
        assertEq(packs.balanceOf(_holder(0), 1), 1);
        rng.deliver(2, 9);
        assertEq(cards.process(1, 100), 6, "the queue moves past the cancelled open");
        assertEq(cards.balanceOf(_holder(1)), 6);
        vm.prank(_holder(0)); cards.open(1, 1); // and the returned pack can be opened later
        rng.deliver(3, 4);
        cards.process(1, 100);
        assertEq(cards.balanceOf(_holder(0)), 6);
        vm.expectRevert(FirePacks.NotCards.selector);
        packs.returnPacks(_holder(0), 1, 1);
    }

    // ---------- audit round 3 ----------

    function test_audit3_imageFileNames() public view {
        string[5] memory mats = ["paper", "wood", "fire", "coal", "gold"];
        string[4] memory holos = ["none", "picture", "frame", "full"]; // bit 0 = picture, bit 1 = frame
        for (uint256 m; m < 5; m++) {
            for (uint256 h; h < 4; h++) {
                for (uint256 g; g <= 10; g++) {
                    string memory want = string.concat(
                        "c7-", mats[m], "-", holos[h], "-", g == 0 ? "u" : vm.toString(g), ".webp"
                    );
                    assertEq(renderer.imageName(7, mats[m], h & 2 != 0, h & 1 != 0, g, false), want);
                    // cased: "c" until graded; a slab's image is its grade's
                    string memory cased = string.concat("c7-", mats[m], "-", holos[h], "-", g == 0 ? "c" : vm.toString(g), ".webp");
                    assertEq(renderer.imageName(7, mats[m], h & 2 != 0, h & 1 != 0, g, true), cased);
                }
            }
        }
        assertEq(renderer.imageName(0, "coal", true, true, 7, false), "c0-coal-full-7.webp");
        assertEq(renderer.imageName(2, "fire", false, false, 0, false), "c2-fire-none-u.webp");
        assertEq(renderer.imageName(2, "fire", false, false, 0, true), "c2-fire-none-c.webp");
        assertEq(renderer.imageName(254, "gold", true, true, 10, true), "c254-gold-full-10.webp");
        assertEq(renderer.imageName(99_999, "fullart", true, true, 3, false), "c99999-fullart-full-3.webp");
    }

    event ImagesBaseSet(uint256 indexed fire, string imagesBase);

    /// The image folder can move until the Series' first pack is minted (or it's locked); then the art is fixed.
    function test_imagesBaseLocksAtFirstPack() public {
        vm.expectEmit(address(cards));
        emit ImagesBaseSet(1, "ar://moved/");
        vm.prank(owner);
        cards.setImagesBase(1, "ar://moved/");
        assertEq(cards.imagesBase(1), "ar://moved/");

        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBAD)));
        cards.setImagesBase(1, "ipfs://y/");

        string[5] memory bad = ['ipfs://"x/', "ipfs://x\\/", "ipfs://x\n/", "", unicode"ipfs://é/"];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(owner);
            vm.expectRevert(FireCards.BadText.selector);
            cards.setImagesBase(1, bad[i]);
        }

        _sellAndClose(1, 2);
        _openAll(1, 2, 9);
        string memory json = _json(cards.tokenURI(1));
        assertTrue(_contains(json, '"image":"ar://moved/c'), json);
        vm.prank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setImagesBase(1, "ipfs://y/");

        vm.prank(owner);
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.lockFire(77); // no dealer: nothing to lock
        _configure(2, 3);
        vm.prank(owner);
        cards.lockFire(2);
        vm.prank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setImagesBase(2, "ipfs://y/");
    }

    /// A Series isn't ready to sell without an image folder.
    function test_notReadyWithoutImages() public {
        (string[] memory names, string[] memory cats) = _chars(2);
        vm.startPrank(owner);
        dealer.setRecipe(6, StandardRecipe.classic(1));
        dealer.setCharacters(6, names, cats);
        cards.setDealer(6, address(dealer));
        assertFalse(cards.ready(6));
        cards.setImagesBase(6, "ipfs://x/");
        assertTrue(cards.ready(6));
        vm.stopPrank();
    }

    function test_audit3_nameLengthCapped() public {
        (string[] memory names, string[] memory cats) = _one("Person");
        names[0] = "1234567890123456789012345678901234567890123456789012345678901234"; // 64 bytes is fine
        vm.prank(owner);
        dealer.setCharacters(5, names, cats);
        names[0] = "12345678901234567890123456789012345678901234567890123456789012345"; // 65
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.BadText.selector);
        dealer.setCharacters(5, names, cats);
        names[0] = "back\\slash";
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.BadText.selector);
        dealer.setCharacters(5, names, cats);
    }

    function test_audit3_packImageBaseTextChecked() public {
        string[3] memory bad = ['ipfs://"x/', "ipfs://x\\/", "ipfs://x\n/"];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(owner);
            vm.expectRevert(FirePacks.BadText.selector);
            packs.setPackImageBase(bad[i]);
        }
        vm.prank(owner);
        packs.setPackImageBase("ipfs://packs/");
        assertEq(packs.packImageBase(), "ipfs://packs/");
    }

    function test_audit_fireNumberFitsIn64Bits() public {
        uint256 big = uint256(type(uint64).max) + 8;
        (string[] memory names, string[] memory cats) = _chars(1);
        vm.startPrank(owner);
        vm.expectRevert(RecipeDealer.BadLength.selector);
        dealer.setRecipe(big, StandardRecipe.classic(1));
        vm.expectRevert(RecipeDealer.BadLength.selector);
        dealer.setCharacters(big, names, cats);
        vm.expectRevert(FireCards.BadLength.selector);
        cards.setDealer(big, address(dealer));
        vm.stopPrank();
    }

    // ---------- per-Series queues (round 4) ----------

    /// Names must be valid UTF-8 (they go into the token JSON as-is).
    function test_namesMustBeValidUtf8() public {
        (string[] memory names, string[] memory cats) = _one("Person");
        names[0] = unicode"Zoë the 🦊";
        vm.prank(owner);
        dealer.setCharacters(5, names, cats);
        bytes[5] memory bad = [bytes(hex"c0af"), hex"e08080", hex"eda080", hex"f4908080", hex"e282"];
        for (uint256 i; i < bad.length; i++) {
            names[0] = string(bad[i]);
            vm.prank(owner);
            vm.expectRevert(RecipeDealer.BadText.selector);
            dealer.setCharacters(5, names, cats);
        }
    }

    /// One Series' stuck open never holds up another Series.
    function test_eachSeriesHasItsOwnQueue() public {
        _configure(2, 3);
        _sellAndClose(1, 1);
        _sellAndClose(2, 1);
        uint256 first = rng.next();
        vm.prank(_holder(0)); cards.open(1, 1); // never answered
        vm.prank(_holder(0)); cards.open(2, 1);
        rng.deliver(first + 1, 5);
        assertEq(cards.process(1, 100), 0, "Series 1 waits on its word");
        assertEq(cards.process(2, 100), 6, "Series 2 deals anyway");
        (uint256 q1,) = cards.pending(1);
        (uint256 q2,) = cards.pending(2);
        assertEq(q1, 1);
        assertEq(q2, 0);
    }

    /// An open that's ready but can't be dealt (a dealer that reverts) can be skipped after a week; its packs come
    /// back sealed and the queue moves on.
    function test_stuckReadyOpenCanBeSkipped() public {
        _sellAndClose(1, 2);
        uint256 first = rng.next();
        vm.prank(_holder(0)); cards.open(1, 1);
        vm.prank(_holder(1)); cards.open(1, 1);
        rng.deliver(first, 1);
        rng.deliver(first + 1, 2);
        vm.mockCallRevert(address(dealer), abi.encodeWithSelector(RecipeDealer.deal.selector), "dealer broke");
        vm.expectRevert();
        cards.process(1, 100);
        vm.expectRevert(FireCards.NotStuck.selector);
        cards.skipStuck(1);
        vm.warp(block.timestamp + 7 days);
        cards.skipStuck(1);
        assertEq(packs.balanceOf(_holder(0), 1), 1, "the pack is back, sealed");
        assertEq(cards.headOf(1), 1);
        vm.clearMockedCalls();
        assertEq(cards.process(1, 100), 6, "the next open deals");
        assertEq(cards.balanceOf(_holder(1)), 6);
    }

    /// A dealer whose packs are over MAX_CARDS_PER_PACK can't be chosen.
    function test_packSizeCapped() public {
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](1);
        r.types[0] = _type("Common", "common", 0, RecipeDealer.Supply.Filler, 0);
        r.slots = new RecipeDealer.Slot[](1);
        r.slots[0] = _slotOne(1_001, 0);
        (string[] memory names, string[] memory cats) = _chars(1);
        vm.startPrank(owner);
        dealer.setRecipe(12, r);
        dealer.setCharacters(12, names, cats);
        vm.expectRevert(FireCards.BadDeal.selector);
        cards.setDealer(12, address(dealer));
        vm.stopPrank();
    }

    /// The cancel clock counts from the open's request; the source having an answer blocks a cancel.
    function test_cancelClockFromTheRequest() public {
        _sellAndClose(1, 2);
        vm.prank(_holder(0)); cards.open(1, 1);
        vm.prank(_holder(1)); cards.open(1, 1);
        vm.warp(block.timestamp + 7 days - 1);
        vm.expectRevert(FireCards.NotStuck.selector);
        cards.cancelOpen(1, 0);
        vm.warp(block.timestamp + 1);
        cards.cancelOpen(1, 0);
        assertEq(packs.balanceOf(_holder(0), 1), 1);
        rng.answerSilently(2); // the source holds a word whose callback didn't land: deliver it, don't cancel
        vm.expectRevert(FireCards.NotStuck.selector);
        cards.cancelOpen(1, 1);
    }

    /// Ownership can never be renounced (it can still be handed over in two steps).
    function test_renounceOwnershipReverts() public {
        vm.prank(owner);
        vm.expectRevert(FireCards.RenounceDisabled.selector);
        cards.renounceOwnership();
        vm.prank(owner);
        vm.expectRevert(FirePacks.RenounceDisabled.selector);
        packs.renounceOwnership();
        vm.prank(owner);
        vm.expectRevert(RecipeDealer.RenounceDisabled.selector);
        dealer.renounceOwnership();
        assertEq(cards.owner(), owner);
        vm.prank(owner);
        cards.transferOwnership(address(0xB0B));
        vm.prank(address(0xB0B));
        cards.acceptOwnership();
        assertEq(cards.owner(), address(0xB0B));
    }

    /// Collection metadata for marketplaces (ERC-7572), set by the owner.
    function test_contractURI() public {
        assertEq(cards.contractURI(), "");
        vm.prank(_holder(0));
        vm.expectRevert();
        cards.setContractURI("ipfs://x");
        vm.expectEmit(address(cards));
        emit FireCards.ContractURIUpdated();
        vm.prank(owner);
        cards.setContractURI("ipfs://cards.json");
        assertEq(cards.contractURI(), "ipfs://cards.json");
        vm.prank(_holder(0));
        vm.expectRevert();
        packs.setContractURI("ipfs://x");
        vm.expectEmit(address(packs));
        emit FirePacks.ContractURIUpdated();
        vm.prank(owner);
        packs.setContractURI("ipfs://packs.json");
        assertEq(packs.contractURI(), "ipfs://packs.json");
    }

    /// An ungraded card shows a fixed "Dealt" date (a date trait), never an age that grows; once cased it adds its
    /// frozen "Age when cased (days)". A grading that's cancelled doesn't move the Dealt date.
    function test_dealtDateAndAgeWhenCased() public {
        uint256 dealtAt = block.timestamp;
        _sellAndClose(1, 1);
        _openAll(1, 1, 3);
        string memory dealt = string.concat('{"trait_type":"Dealt","value":', vm.toString(dealtAt), ',"display_type":"date"}');
        string memory json = _json(cards.tokenURI(1));
        vm.parseJson(json);
        assertTrue(_contains(json, dealt), json);
        assertFalse(_contains(json, "Uncased Age"), json);
        assertFalse(_contains(json, "Age when cased"), json);
        vm.warp(block.timestamp + 3 days);
        assertEq(_json(cards.tokenURI(1)), json, "the metadata doesn't change as time passes");
        vm.prank(owner);
        cards.setPsa(address(this));
        cards.setGradePending(1, true); // sent for grading...
        vm.warp(block.timestamp + 1 days);
        cards.setGradePending(1, false); // ...and cancelled: the wear clock resumes, the Dealt date stays
        assertEq(cards.cardOf(1).dealtAt, dealtAt);
        assertEq(cards.cardOf(1).age, 3 days);
        vm.warp(block.timestamp + 2 days);
        cards.setCased(1);
        json = _json(cards.tokenURI(1));
        vm.parseJson(json);
        assertTrue(_contains(json, dealt), json);
        assertTrue(_contains(json, '{"trait_type":"Age when cased (days)","value":5,"display_type":"number"}'), json);
        vm.warp(block.timestamp + 30 days);
        assertEq(_json(cards.tokenURI(1)), json, "frozen once cased");
        cards.setGrade(1, 8);
        json = _json(cards.tokenURI(1));
        assertFalse(_contains(json, "Dealt"), "a slabbed card shows its grade only");
        assertTrue(_contains(json, '{"trait_type":"PDA","value":"PDA 8"}'), json);
    }

    /// Moves count only wallet to wallet, never for burning; a card's wear shows in cardOf.
    function test_movesAndAgeInCardOf() public {
        _sellAndClose(1, 1);
        _openAll(1, 1, 3);
        address h = _holder(0);
        vm.warp(block.timestamp + 5 days);
        vm.prank(h);
        cards.transferFrom(h, _holder(1), 1);
        FireCards.Card memory c = cards.cardOf(1);
        assertEq(c.moves, 1);
        assertEq(c.age, 5 days);
        assertFalse(c.cased);
        assertEq(c.grade, 0);
    }

    // ---------- pre-testnet audit (round 8) regressions ----------

    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);

    /// M-1: a holder that refuses the returned packs used to make cancelOpen revert, so its open sat at the head of the
    /// queue forever and every later open of the Series (answered, packs already burned) could never be dealt. Packs
    /// now come back without the receiver hook: the cancel goes through and the queue moves on.
    function test_audit8_refusedReturnDoesNotBrickTheQueue() public {
        _sellAndClose(1, 3);
        Toggle t = new Toggle();
        vm.prank(_holder(0));
        packs.safeTransferFrom(_holder(0), address(t), 1, 1, "");
        t.open(cards, 1); // old source; it dies
        MockRandomness rng2 = new MockRandomness();
        rng2.setCards(cards);
        vm.prank(owner);
        cards.setRandomness(address(rng2)); // the owner switches away from the dead source
        vm.prank(_holder(1));
        cards.open(1, 1); // new source
        rng2.deliver(1, 42); // answered
        t.setRefuse(true);
        vm.warp(block.timestamp + 8 days);
        vm.expectEmit(true, true, true, true, address(packs));
        emit TransferSingle(address(cards), address(0), address(t), 1, 1);
        cards.cancelOpen(1, 0);
        assertEq(packs.balanceOf(address(t), 1), 1, "the refused pack is back anyway, sealed");
        assertEq(packs.burned(1), 1, "only the victim's pack stays burned");
        assertGt(cards.process(1, 100), 0, "the queue moves");
        assertEq(cards.balanceOf(_holder(1)), cards.cardsPerPack(1), "the next opener gets their cards");
        assertEq(packs.balanceOf(_holder(1), 1), 0);
    }

    /// L-2: a recipe changed after setDealer could push cards per pack past MAX_CARDS_PER_PACK and still lock, after
    /// which every open of the Series reverted in process. Every lock (and ready) now checks the pack size again.
    function test_audit8_recipeChangedAfterSetDealerCantLock() public {
        RecipeDealer.Recipe memory r;
        r.types = new RecipeDealer.CardType[](1);
        r.types[0] = _type("Paper", "paper", 0, RecipeDealer.Supply.Filler, 0);
        r.slots = new RecipeDealer.Slot[](1);
        r.slots[0] = _slotOne(1001, 0);
        _configure(6, 3);
        vm.prank(owner);
        dealer.setRecipe(6, r); // after setDealer(6): still accepted by the dealer
        assertEq(cards.cardsPerPack(6), 1001);
        assertFalse(cards.ready(6), "not ready: configureDrop refuses it");
        vm.prank(seller);
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.lockForSale(6);
        vm.prank(owner);
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.lockFire(6);
        r.slots[0] = _slotOne(1000, 0); // at the limit: fine
        vm.prank(owner);
        dealer.setRecipe(6, r);
        assertTrue(cards.ready(6));
        vm.prank(seller);
        cards.lockForSale(6);
        (,, bool locked,,,) = cards.fires(6);
        assertTrue(locked);
    }

    /// Info: a Series can't lock without an image folder (its art could never be set after the lock).
    function test_audit8_lockNeedsImages() public {
        (string[] memory names, string[] memory cats) = _chars(2);
        vm.startPrank(owner);
        dealer.setRecipe(6, StandardRecipe.classic(1));
        dealer.setCharacters(6, names, cats);
        cards.setDealer(6, address(dealer));
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.lockFire(6);
        vm.stopPrank();
        vm.prank(seller);
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.lockForSale(6);
        vm.startPrank(owner);
        cards.setImagesBase(6, "ipfs://x/");
        cards.lockFire(6);
        vm.stopPrank();
        vm.prank(seller);
        cards.lockForSale(6); // already locked: nothing to check
    }
}

contract DeployCardsTest is Test {
    /// @dev The hardware wallet accepts the six contracts in one run: AcceptOwnership lists exactly the ones still
    ///      pending for it, skips the ones it holds, and refuses a contract pending to someone else.
    function test_acceptOwnershipListsTheSixForTheHardwareWallet() public {
        address owner = address(0x1ED6E2);
        FirePacks packs = new FirePacks(address(this));
        FireCards cards = new FireCards(address(this), address(packs));
        RecipeDealer dealer = new RecipeDealer(address(this), address(cards), address(new RecipeCompiler()));
        FireCredits credits = new FireCredits(address(this), address(cards), 0);
        // FirePsa and PaperBurner stand-ins: two more two-step-owned contracts
        address[6] memory c = [address(packs), address(cards), address(dealer), address(credits),
            address(new FirePacks(address(this))), address(new FirePacks(address(this)))];
        string memory json = "{";
        string[6] memory names = new AcceptOwnership().owned();
        for (uint256 i; i < 6; i++) {
            FirePacks(c[i]).transferOwnership(owner);
            json = string.concat(json, i == 0 ? '"contracts":{"' : ',"', names[i], '":"', vm.toString(c[i]), '"');
        }
        string memory file = string.concat(vm.projectRoot(), "/../deployments/test-accept-ownership.json");
        vm.writeFile(file, string.concat(json, '},"inputs":{"OWNER":"', vm.toString(owner), '"}}'));
        vm.setEnv("DEPLOYMENTS_FILE", file);
        AcceptOwnership a = new AcceptOwnership();
        address[] memory list = a.toAccept(owner);
        assertEq(list.length, 6, "all six pending");
        for (uint256 i; i < 6; i++) assertEq(list[i], c[i]);
        vm.prank(owner); packs.acceptOwnership();
        vm.prank(owner); credits.acceptOwnership();
        list = a.toAccept(owner);
        assertEq(list.length, 4, "the ones it holds are skipped");
        for (uint256 i; i < list.length; i++) {
            vm.prank(owner);
            FirePacks(list[i]).acceptOwnership();
        }
        assertEq(a.toAccept(owner).length, 0, "nothing left");
        assertEq(dealer.owner(), owner);
        vm.expectRevert(bytes("FirePacks is not waiting for this owner"));
        a.toAccept(address(0xBAD));
        vm.removeFile(file);
    }

    function test_deployWiresEverythingAndHandsOwnershipToTheOwner() public {
        vm.warp(1_800_000_000);
        DeployCards s = new DeployCards();
        address safe = address(0x5AFE);
        address drand = address(new OpenDrandRouter());
        MockERC20 paper = new MockERC20("PAPER", "PAPER");
        MockUSDG usdg = new MockUSDG();
        MockERC20 plank = new MockERC20("PLANK", "PLANK");
        MockERC20 weth = new MockERC20("WETH", "WETH");
        MockPlankTwap twap = new MockPlankTwap(1e9, address(new MockPair(address(weth), address(plank))));
        address ethUsd = address(new MockFeed(3_333e8));
        twap.setEthUsd(ethUsd);
        MockFeed paperUsd = new MockFeed(0.05e18);
        paperUsd.setDecimals(18);
        paperUsd.setIds(address(paper), ethUsd);
        paperUsd.setPlankUsd(address(twap));
        address v2Factory = address(new MockV2Factory(twap.PAIR()));
        paperUsd.setPools(address(plank), address(weth), address(usdg), v2Factory);
        DeployCards.Params memory p = DeployCards.Params({
            router: drand, owner: safe, royaltyTo: safe, royaltyBps: 500, packBase: "ipfs://packs/",
            paper: address(paper), plank: address(plank), usdg: address(usdg),
            weth: address(weth), press: address(new MockERC20("PRESS", "PRESS")),
            ethUsd: ethUsd,
            plankUsd: address(twap), paperUsd: address(paperUsd),
            v2Router: address(new MockRouterInfo(address(weth), v2Factory)),
            revenueWallet: address(0xBEEF), suggestionPaper: 2e18
        });
        DeployCards.Deployed memory d = s.deploy(p, address(s));

        assertEq(address(d.cards.PACKS()), address(d.packs));
        assertEq(d.packs.cards(), address(d.cards));
        assertEq(d.packs.seller(), address(d.sale));
        assertEq(d.cards.seller(), address(d.sale));
        assertEq(d.cards.psa(), address(d.psa));
        assertEq(address(d.dealer.CARDS()), address(d.cards));
        assertEq(address(d.dealer.PACKS()), address(d.packs));
        assertEq(d.dealer.pendingOwner(), safe);
        assertEq(address(d.cards.randomness()), address(d.adapter));
        assertEq(d.adapter.FIRE(), address(d.cards));
        assertEq(address(d.psa.randomness()), address(d.psaAdapter));
        assertEq(d.psaAdapter.FIRE(), address(d.psa));
        assertEq(address(d.adapter.ROUTER()), drand);
        assertEq(address(d.sale.PACKS()), address(d.packs));
        assertEq(address(d.sale.CARDS()), address(d.cards));
        assertEq(d.sale.revenueWallet(), address(0xBEEF));
        assertEq(d.sale.plankBurner(), address(d.plankBurner));
        assertEq(address(d.plankBurner.ROUTER()), p.v2Router);
        assertEq(address(d.plankBurner.PLANK_USD()), address(twap));
        assertEq(address(d.plankBurner.ETH_USD()), ethUsd);
        assertEq(address(d.plankBurner.USDG()), address(usdg));
        assertEq(d.sale.CREDITS(), address(d.credits));
        assertEq(address(d.credits.sale()), address(d.sale));
        assertEq(address(d.credits.CARDS()), address(d.cards));
        assertEq(d.credits.pendingOwner(), safe);
        vm.expectRevert(FireCredits.AlreadySet.selector);
        vm.prank(address(s));
        d.credits.setSale(address(0xBEEF)); // set once
        assertEq(d.sale.USDG_UNIT(), 1e6);
        assertEq(d.credits.suggestionPaper(), 2e18);
        assertEq(d.sale.owner(), safe, "the sale is the owner's from the start");
        assertEq(d.packs.pendingOwner(), safe);
        assertEq(d.cards.pendingOwner(), safe);
        assertEq(d.psa.pendingOwner(), safe);
        assertEq(d.burner.pendingOwner(), safe);
        assertEq(address(d.cards.renderer()), address(d.renderer));
        assertEq(address(d.psa.BURNER()), address(d.burner));
        assertEq(address(d.dealer.COMPILER()), address(d.compiler));
        assertEq(address(d.sale.PAPER_USD()), address(paperUsd));
        assertEq(address(d.burner.paperUsd()), address(paperUsd));
        assertEq(d.burner.routesOf(PaperBurner.Pay.ETH).length, 2, "ETH: straight and through PLANK");
        vm.prank(safe); d.packs.acceptOwnership();
        vm.prank(safe); d.cards.acceptOwnership();
        vm.prank(safe); d.psa.acceptOwnership();
        vm.prank(safe); d.dealer.acceptOwnership();
        vm.prank(safe); d.credits.acceptOwnership();
        assertEq(d.credits.owner(), safe);
        assertEq(d.dealer.owner(), safe);
        assertEq(d.packs.owner(), safe);
        assertEq(d.cards.owner(), safe);
        assertEq(d.psa.owner(), safe);
        (address r, uint256 amt) = d.cards.royaltyInfo(1, 10_000);
        assertEq(r, safe); assertEq(amt, 500);
        assertEq(d.packs.packImageBase(), "ipfs://packs/");
        s.check(p); // a plain wallet (the hardware wallet) is the owner: 0x5AFE has no code here

        // the checks that catch a permanent mistake (memory structs alias, so change one thing and put it back)
        p.router = address(d.adapter); // the adapter printed next to the router by the Fire deploy
        vm.expectRevert(bytes("DRAND_ROUTER is not the OpenDrandRouter"));
        s.check(p);
        p.router = drand;
        (p.ethUsd, p.plankUsd) = (p.plankUsd, p.ethUsd); // swapped feeds
        vm.expectRevert(bytes("ETH_USD_FEED must have 8 decimals (Chainlink ETH/USD)"));
        s.check(p);
        (p.ethUsd, p.plankUsd) = (p.plankUsd, p.ethUsd);
        p.paper = address(usdg); // 6 decimals
        vm.expectRevert(bytes("PAPER is not 18 decimals"));
        s.check(p);
        p.paper = address(paper);
        s.check(p);
        address goodRouter = p.v2Router;
        p.v2Router = address(new MockRouterInfo(address(usdg), address(new MockV2Factory(twap.PAIR()))));
        vm.expectRevert(bytes("V2_ROUTER uses a different WETH"));
        s.check(p);
        p.v2Router = address(new MockRouterInfo(address(weth), address(new MockV2Factory(address(0xDEAD)))));
        vm.expectRevert(bytes("V2_ROUTER's factory doesn't own the PLANK_USD_FEED pool"));
        s.check(p);
        p.v2Router = goodRouter;

        // the price feeds must be built on these inputs
        twap.setEthUsd(address(0xE7));
        vm.expectRevert(bytes("PLANK_USD_FEED uses a different ETH_USD_FEED"));
        s.check(p);
        twap.setEthUsd(ethUsd);
        paperUsd.setIds(address(usdg), ethUsd);
        vm.expectRevert(bytes("PAPER_USD_FEED prices a different PAPER"));
        s.check(p);
        paperUsd.setIds(address(paper), address(0xE7));
        vm.expectRevert(bytes("PAPER_USD_FEED uses a different ETH_USD_FEED"));
        s.check(p);
        paperUsd.setIds(address(paper), ethUsd);
        paperUsd.setPlankUsd(address(0xE7));
        vm.expectRevert(bytes("PAPER_USD_FEED uses a different PLANK_USD_FEED"));
        s.check(p);
        paperUsd.setPlankUsd(address(twap));
        paperUsd.setPools(address(weth), address(weth), address(usdg), MockRouterInfo(p.v2Router).factory());
        vm.expectRevert(bytes("PAPER_USD_FEED looks for a different PLANK"));
        s.check(p);
        paperUsd.setPools(address(plank), address(weth), address(usdg), address(0xF));
        vm.expectRevert(bytes("PAPER_USD_FEED reads a different factory"));
        s.check(p);
        paperUsd.setPools(address(plank), address(weth), address(usdg), MockRouterInfo(p.v2Router).factory());
        s.check(p);
    }
}
