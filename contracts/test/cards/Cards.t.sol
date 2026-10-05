// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {CardRules} from "../../src/cards/CardRules.sol";
import {DeployCards} from "../../script/DeployCards.s.sol";
import {MockERC20, MockUSDG, MockFeed, MockPlankTwap, MockPair, MockV2Factory, MockRouterInfo} from "../Mocks.sol";
import {OpenDrandRouter} from "../../src/OpenDrandRouter.sol";

/// @dev Stands in for the drand adapter: hands out ids, the test delivers words.
contract MockRandomness {
    FireCards public cards;
    uint256 public next = 1;
    mapping(uint256 => bool) public answered;

    function setCards(FireCards c) external { cards = c; }

    function request() external returns (uint256) { return next++; }

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

contract PoolHarness {
    function pool(uint256 packs, uint256 diamonds) external pure returns (uint256[5] memory) {
        return CardRules.computePool(packs, diamonds);
    }
}

contract CardsTest is Test {
    using stdJson for string;

    address owner = address(0xA11CE);
    address seller = address(0x5E11);
    FirePacks packs;
    FireCards cards;
    MockRandomness rng;
    bytes32 constant DEALT = keccak256("CardDealt(uint256,uint256,uint256,uint256,bool,bool,uint256)");

    function setUp() public {
        packs = new FirePacks(owner);
        cards = new FireCards(owner, address(packs));
        rng = new MockRandomness();
        rng.setCards(cards);
        vm.startPrank(owner);
        packs.setSeller(seller);
        packs.setCards(address(cards));
        cards.setSeller(seller);
        cards.setRandomness(address(rng));
        cards.setDefaultRoyalty(owner, 500);
        vm.stopPrank();
        _configure(1, 3);
    }

    function _configure(uint256 fire, uint256 n) internal {
        string[] memory names = new string[](n);
        string[] memory cats = new string[](n);
        for (uint256 i; i < n; i++) { names[i] = string.concat("Char", vm.toString(i)); cats[i] = string.concat("Cat ", vm.toString(i % 7)); }
        vm.prank(owner);
        cards.configureFire(fire, names, cats, "ipfs://images/");
    }

    function _holder(uint256 i) internal pure returns (address) { return address(uint160(0x1000 + i)); }

    /// Sell `n` packs of `fire` spread across holders, close the Fire.
    function _sellAndClose(uint256 fire, uint256 n) internal {
        vm.startPrank(seller);
        for (uint256 i; i < n; i++) packs.mint(_holder(i % 17), fire, 1);
        cards.closeFire(fire);
        vm.stopPrank();
    }

    /// Open every pack one at a time (one open per pack), deliver words, process. Returns materials per pack.
    function _openAll(uint256 fire, uint256 n, uint256 salt) internal returns (uint256[6][] memory perPack) {
        uint256 first = rng.next();
        for (uint256 i; i < n; i++) { vm.prank(_holder(i % 17)); cards.open(fire, 1); }
        vm.recordLogs();
        for (uint256 i; i < n; i++) rng.deliver(first + i, uint256(keccak256(abi.encode(salt, i))));
        cards.process(type(uint256).max);
        perPack = new uint256[6][](n);
        uint256[] memory filled = new uint256[](n);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 base = type(uint256).max;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != DEALT) continue;
            uint256 openIndex = uint256(logs[i].topics[1]);
            if (base == type(uint256).max) base = openIndex;
            (, uint256 material,,,) = abi.decode(logs[i].data, (uint256, uint256, bool, bool, uint256));
            uint256 p = openIndex - base;
            perPack[p][filled[p]++] = material;
        }
    }

    // ---------- the rarity math matches the studio exactly ----------

    function test_collectionNames() public view {
        assertEq(cards.name(), "Omni Cards");
        assertEq(cards.symbol(), "OMNICARD");
        assertEq(packs.name(), "Omni Card Packs");
        assertEq(packs.symbol(), "OMNIPACK");
    }

    function test_poolParityWithStudio() public {
        PoolHarness h = new PoolHarness();
        string memory json = vm.readFile("test/cards/pool-fixture.json");
        uint256 rows;
        while (json.keyExists(string.concat(".rows[", vm.toString(rows), "]"))) rows++;
        assertGt(rows, 300, "fixture has its rows");
        bool sawCap; // a row where the Diamond setting is above the pack count
        bool sawFloor; // a row where the pack floor moved cards
        for (uint256 i; i < rows; i++) {
            string memory p = string.concat(".rows[", vm.toString(i), "]");
            uint256 n = json.readUint(string.concat(p, ".packs"));
            uint256 d = json.readUint(string.concat(p, ".diamonds"));
            uint256[] memory counts = json.readUintArray(string.concat(p, ".counts"));
            uint256[5] memory c = h.pool(n, d);
            for (uint256 m; m < 5; m++) assertEq(c[m], counts[m], string.concat("count row ", vm.toString(i)));
            if (n > 0 && d > n) sawCap = true;
            if (c[2] != (15_000 * 6 * n + 50_000) / 100_000) sawFloor = true;
        }
        assertTrue(sawCap && sawFloor, "fixture covers the Diamond cap and the pack floor");
        // the owner's worked example
        uint256[5] memory e = h.pool(167, 1);
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
        (uint256 p0, uint256 p1, uint256 p2, uint256 p3, uint256 p4) = (cards.poolOf(1, 0), cards.poolOf(1, 1), cards.poolOf(1, 2), cards.poolOf(1, 3), cards.poolOf(1, 4));
        assertEq(totals[0], p0); assertEq(totals[1], p1); assertEq(totals[2], p2); assertEq(totals[3], p3); assertEq(totals[4], p4);
        assertEq(p0 + p1 + p2 + p3 + p4, n * 6);
        assertEq(cards.nextSerial(), n * 6 + 1);
        (,,, uint32 total, uint32 dealt, uint32 left,,,,) = cards.fires(1);
        assertEq(total, n); assertEq(dealt, n); assertEq(left, 0);
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

    // ---------- order is fixed: results depend only on words and open order ----------

    function test_outOfOrderWordsWaitForTheQueue() public {
        _sellAndClose(1, 4);
        uint256 first = rng.next();
        for (uint256 i; i < 3; i++) { vm.prank(_holder(i)); cards.open(1, 1); }
        rng.deliver(first + 1, 111); // second open's word arrives first
        assertEq(cards.process(10), 0, "nothing dealt until the head is ready");
        rng.deliver(first, 222);
        assertEq(cards.process(10), 2, "head and the one behind it");
        assertEq(cards.head(), 2);
        rng.deliver(first + 2, 333);
        assertEq(cards.process(10), 1);
    }

    function test_sameWordsSameCardsWhateverTheProcessingPattern() public {
        _sellAndClose(1, 30);
        uint256 first = rng.next();
        for (uint256 i; i < 30; i++) { vm.prank(_holder(i % 17)); cards.open(1, 1); }
        uint256 snap = vm.snapshotState();
        for (uint256 i; i < 30; i++) rng.deliver(first + i, uint256(keccak256(abi.encode("w", i))));
        cards.process(type(uint256).max);
        uint256[] memory a = new uint256[](180);
        for (uint256 s = 1; s <= 180; s++) a[s - 1] = uint256(keccak256(abi.encode(cards.cardOf(s), cards.ownerOf(s))));
        vm.revertToState(snap);
        for (uint256 i; i < 30; i++) { rng.deliver(first + i, uint256(keccak256(abi.encode("w", i)))); cards.process(1); }
        for (uint256 s = 1; s <= 180; s++) assertEq(uint256(keccak256(abi.encode(cards.cardOf(s), cards.ownerOf(s)))), a[s - 1]);
    }

    // ---------- holo rates ----------

    function test_holoRatesConverge() public {
        uint256 n = 600; // 3,600 cards
        _sellAndClose(1, n);
        _openAll(1, n, 99);
        uint256[5] memory cnt; uint256[5] memory holo; uint256 diamondFull; uint256 diamondNone;
        for (uint256 s = 1; s <= n * 6; s++) {
            FireCards.Card memory c = cards.cardOf(s);
            cnt[c.material]++;
            if (c.holoFrame || c.holoPicture) holo[c.material]++;
            if (c.material == 4) { if (c.holoFrame && c.holoPicture) diamondFull++; if (!c.holoFrame && !c.holoPicture) diamondNone++; }
        }
        // paper 5%, wood 10%, fire 50% within 4 standard deviations
        _within(holo[0], cnt[0], 50_000);
        _within(holo[1], cnt[1], 100_000);
        _within(holo[2], cnt[2], 500_000);
        assertEq(diamondNone, 0, "Diamond always holo");
        assertEq(holo[4], cnt[4]);
        assertGt(cnt[4], 0);
        diamondFull; // split checked exactly in the CardRules test below
    }

    function _within(uint256 k, uint256 n, uint256 ratePpm) internal pure {
        // |k/n - r| < 4 sqrt(r(1-r)/n)  <=>  (k*1e6 - r*n)^2 < 16 r (1e6 - r) n
        int256 d = int256(k * 1e6) - int256(ratePpm * n);
        assertLt(uint256(d * d), 16 * ratePpm * (1e6 - ratePpm) * n, "holo rate off");
    }

    function test_rollHoloDiamondSplitAndRates() public pure {
        uint256[3] memory t;
        for (uint256 i; i < 3000; i++) {
            (bool f, bool p) = CardRules.rollHolo(4, i, 0);
            assertTrue(f || p);
            t[f && p ? 2 : f ? 0 : 1]++;
        }
        assertEq(t[0], 1000); assertEq(t[1], 1000); assertEq(t[2], 1000);
        // a roll hits exactly below the chance
        uint256 pp = CardRules.holoRollChance(0);
        (bool a,) = CardRules.rollHolo(0, pp - 1, 0);
        (bool b,) = CardRules.rollHolo(0, pp, 0);
        assertTrue(a); assertFalse(b);
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
        assertEq(cards.process(5), 0);
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
        cards.open(1, 11);
    }

    function test_onlySellerClosesAndOnlyOnce() public {
        vm.expectRevert(FireCards.NotSeller.selector);
        cards.closeFire(1);
        vm.prank(seller);
        cards.closeFire(1);
        vm.prank(seller);
        vm.expectRevert(FireCards.FireIsClosed.selector);
        cards.closeFire(1);
    }

    function test_onlyRandomnessDeliversAndRerequestRules() public {
        _sellAndClose(1, 1);
        vm.prank(_holder(0));
        cards.open(1, 1);
        vm.expectRevert(FireCards.NotRandomness.selector);
        cards.onRandomness(1, 5);
        vm.expectRevert(FireCards.NotStuck.selector);
        cards.rerequest(0); // too early
        vm.warp(block.timestamp + 1 days + 1);
        cards.rerequest(0); // now allowed: never answered
        uint256 newId = rng.next() - 1;
        rng.deliver(1, 42); // the old id is stale and ignored
        assertEq(cards.process(1), 0);
        rng.deliver(newId, 42);
        assertEq(cards.process(1), 1);
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
        assertEq(cards.process(5), 2);
        assertEq(cards.balanceOf(address(g)), 6);
        assertEq(cards.balanceOf(_holder(1)), 6);
    }

    function test_multiPackOpen() public {
        vm.prank(seller);
        packs.mint(_holder(0), 1, 10);
        vm.prank(seller);
        cards.closeFire(1);
        uint256 id = rng.next();
        vm.prank(_holder(0));
        cards.open(1, 10);
        rng.deliver(id, 77);
        cards.process(1);
        assertEq(cards.balanceOf(_holder(0)), 60);
    }

    // ---------- metadata and royalty ----------

    function test_tokenUriAndImage() public {
        _sellAndClose(1, 3);
        _openAll(1, 3, 5);
        FireCards.Card memory c = cards.cardOf(1);
        string memory file = cards.imageFile(c);
        assertTrue(bytes(file).length > 0);
        string memory uri = cards.tokenURI(1);
        assertTrue(_startsWith(uri, "data:application/json;base64,"));
        assertGt(c.editionOf, 0, "edition total known once every pack is dealt");
        (address r, uint256 amt) = cards.royaltyInfo(1, 10_000);
        assertEq(r, owner);
        assertEq(amt, 500);
        assertTrue(cards.supportsInterface(0x2a55205a)); // ERC-2981
        assertTrue(cards.supportsInterface(0x49064906)); // ERC-4906
        assertTrue(_startsWith(packs.uri(1), "data:application/json;base64,"));
    }

    function test_configLocks() public {
        vm.prank(owner);
        cards.lockFire(1);
        string[] memory names = new string[](1);
        string[] memory cats = new string[](1);
        for (uint256 k; k < cats.length; k++) cats[k] = "Person";
        vm.prank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.configureFire(1, names, cats, "x");
    }

    // ---------- Diamonds per Series (each Series stands alone) ----------

    event DiamondsSet(uint256 indexed fire, uint256 diamonds);

    function test_diamondsDefaultToOne() public {
        assertEq(cards.diamondsOf(1), 0);
        assertEq(cards.diamondsFor(1), 1);
        _sellAndClose(1, 150);
        assertEq(cards.poolOf(1, 4), 1);
        assertEq(cards.poolOf(1, 1), 270);
    }

    function test_setDiamonds() public {
        vm.expectEmit(address(cards));
        emit DiamondsSet(1, 3);
        vm.prank(owner);
        cards.setDiamonds(1, 3);
        assertEq(cards.diamondsOf(1), 3);
        assertEq(cards.diamondsFor(1), 3);
        vm.prank(owner);
        cards.setDiamonds(1, 2); // can change until the packs sell
        assertEq(cards.diamondsFor(1), 2);
        assertEq(cards.diamondsFor(2), 1, "other Series untouched");
    }

    function test_setDiamondsOnlyOwnerAndBounds() public {
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(this)));
        cards.setDiamonds(1, 2);
        vm.startPrank(owner);
        vm.expectRevert(FireCards.BadDiamonds.selector);
        cards.setDiamonds(1, 0);
        vm.expectRevert(FireCards.BadDiamonds.selector);
        cards.setDiamonds(1, 1001);
        cards.setDiamonds(1, 1000);
        cards.setDiamonds(1, 1);
        vm.stopPrank();
    }

    function test_setDiamondsLocks() public {
        // locked Series
        vm.startPrank(owner);
        cards.lockFire(1);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setDiamonds(1, 2);
        vm.stopPrank();
        // after the first pack sells
        _configure(2, 3);
        vm.prank(seller);
        packs.mint(_holder(0), 2, 1);
        vm.prank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setDiamonds(2, 2);
        // closed (even with no packs sold)
        _configure(3, 3);
        vm.prank(seller);
        cards.closeFire(3);
        vm.prank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setDiamonds(3, 2);
    }

    function test_diamondsSetTheClosedPool() public {
        vm.prank(owner);
        cards.setDiamonds(1, 3);
        _sellAndClose(1, 167);
        uint256[5] memory want = [uint256(501), 299, 150, 49, 3];
        for (uint256 m; m < 5; m++) assertEq(cards.poolOf(1, m), want[m]);
        (,,,,,,, uint32 charcoalLeft, uint32 diamondLeft, uint32 flexWood) = cards.fires(1);
        assertEq(charcoalLeft, 49);
        assertEq(diamondLeft, 3);
        assertEq(flexWood, 299 - 167);
        // every Diamond is dealt
        uint256[6][] memory perPack = _openAll(1, 167, 3);
        uint256 dia;
        for (uint256 p; p < 167; p++) for (uint256 k; k < 6; k++) if (perPack[p][k] == 4) dia++;
        assertEq(dia, 3);
    }

    function test_diamondsCappedAtOnePerPack() public {
        vm.prank(owner);
        cards.setDiamonds(1, 1000);
        _sellAndClose(1, 4);
        assertEq(cards.poolOf(1, 4), 4);
        assertEq(cards.poolOf(1, 1), 4, "Wood >= packs");
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
        for (uint256 m; m < 5; m++) assertEq(cards.poolOf(2, m), cards.poolOf(1, m), "same packs, same pool");
    }

    function _startsWith(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s); bytes memory b = bytes(p);
        if (a.length < b.length) return false;
        for (uint256 i; i < b.length; i++) if (a[i] != b[i]) return false;
        return true;
    }

    // ---------- audit fixes ----------

    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);

    function test_audit_lastPackDealtRefreshesEditions() public {
        _sellAndClose(1, 2);
        vm.prank(_holder(0)); cards.open(1, 1);
        vm.prank(_holder(1)); cards.open(1, 1);
        rng.deliver(1, 5);
        rng.deliver(2, 6);
        cards.process(1); // first pack: no refresh
        vm.expectEmit(address(cards));
        emit BatchMetadataUpdate(1, 12); // the last pack: every card's Edition becomes "k of N"
        cards.process(1);
    }

    function test_audit_textThatWouldBreakJsonIsRejected() public {
        string[] memory names = new string[](1);
        string[] memory cats = new string[](1);
        for (uint256 k; k < cats.length; k++) cats[k] = "Person";
        names[0] = 'Bad "quote';
        vm.prank(owner);
        vm.expectRevert(FireCards.BadText.selector);
        cards.configureFire(5, names, cats, "ipfs://x/");
        names[0] = "Fine";
        vm.prank(owner);
        vm.expectRevert(FireCards.BadText.selector);
        cards.configureFire(5, names, cats, "ipfs://x\\/");
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
        vm.prank(owner);
        cards.configureFire(9, names, cats, "ipfs://x/");
        _sellAndClose(9, 1);
        _openAll(9, 1, 3);
        string memory uri = cards.tokenURI(1);
        string memory json = string(_b64decode(_after(bytes(uri), 29))); // "data:application/json;base64,"
        assertTrue(_contains(json, unicode'{"trait_type":"Category","value":"Rock Stars é"}'), json);
        vm.parseJson(json); // still valid JSON
    }

    function test_categoryRules() public {
        string[] memory names;
        string[] memory cats;
        (names, cats) = _one("");
        vm.prank(owner);
        vm.expectRevert(FireCards.BadText.selector);
        cards.configureFire(5, names, cats, "ipfs://x/");

        (names, cats) = _one("123456789012345678901234567890123"); // 33 bytes
        vm.prank(owner);
        vm.expectRevert(FireCards.BadText.selector);
        cards.configureFire(5, names, cats, "ipfs://x/");

        string[4] memory bad = ['Say "hi"', "back\\slash", "tab\tin", "new\nline"];
        for (uint256 i; i < bad.length; i++) {
            (names, cats) = _one(bad[i]);
            vm.prank(owner);
            vm.expectRevert(FireCards.BadText.selector);
            cards.configureFire(5, names, cats, "ipfs://x/");
        }

        (names, cats) = _one("12345678901234567890123456789012"); // exactly 32 bytes is fine
        vm.prank(owner);
        cards.configureFire(5, names, cats, "ipfs://x/");
    }

    function test_categoryCountMustMatchNames() public {
        string[] memory names = new string[](2);
        string[] memory cats = new string[](1);
        names[0] = "A"; names[1] = "B"; cats[0] = "Person";
        vm.prank(owner);
        vm.expectRevert(FireCards.BadLength.selector);
        cards.configureFire(5, names, cats, "ipfs://x/");
    }

    function _after(bytes memory b, uint256 from) internal pure returns (bytes memory r) {
        r = new bytes(b.length - from);
        for (uint256 i; i < r.length; i++) r[i] = b[from + i];
    }

    function _contains(string memory s, string memory sub) internal pure returns (bool) {
        bytes memory a = bytes(s); bytes memory b = bytes(sub);
        if (b.length > a.length) return false;
        for (uint256 i; i + b.length <= a.length; i++) {
            bool ok = true;
            for (uint256 j; j < b.length && ok; j++) if (a[i + j] != b[j]) ok = false;
            if (ok) return true;
        }
        return false;
    }

    function _b64decode(bytes memory d) internal pure returns (bytes memory out) {
        bytes memory t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        uint8[256] memory v;
        for (uint256 i; i < 64; i++) v[uint8(t[i])] = uint8(i);
        uint256 pad = d.length > 0 && d[d.length - 1] == "=" ? (d[d.length - 2] == "=" ? 2 : 1) : 0;
        out = new bytes(d.length / 4 * 3 - pad);
        uint256 o;
        for (uint256 i; i < d.length; i += 4) {
            uint256 n = (uint256(v[uint8(d[i])]) << 18) | (uint256(v[uint8(d[i + 1])]) << 12)
                | (uint256(v[uint8(d[i + 2])]) << 6) | uint256(v[uint8(d[i + 3])]);
            for (uint256 k; k < 3 && o < out.length; k++) out[o++] = bytes1(uint8(n >> (16 - 8 * k)));
        }
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
        string[] memory names = new string[](5);
        string[] memory cats = new string[](5);
        for (uint256 k; k < cats.length; k++) cats[k] = "Person";
        for (uint256 i; i < 5; i++) names[i] = "X";
        vm.prank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.configureFire(1, names, cats, "ipfs://x/");
    }

    function test_audit2_stuckOpenCanBeCancelledAfterAWeek() public {
        _sellAndClose(1, 2);
        vm.prank(_holder(0)); cards.open(1, 1);
        vm.prank(_holder(1)); cards.open(1, 1);
        vm.warp(block.timestamp + 7 days);
        cards.cancelOpen(0); // randomness gone for good: the pack comes back sealed
        assertEq(packs.balanceOf(_holder(0), 1), 1);
        rng.deliver(2, 9);
        assertEq(cards.process(10), 2, "the queue moves past the cancelled open");
        assertEq(cards.balanceOf(_holder(1)), 6);
        vm.prank(_holder(0)); cards.open(1, 1); // and the returned pack can be opened later
        rng.deliver(3, 4);
        cards.process(10);
        assertEq(cards.balanceOf(_holder(0)), 6);
        vm.expectRevert(FirePacks.NotCards.selector);
        packs.returnPacks(_holder(0), 1, 1);
    }

    // ---------- audit round 3 ----------

    function _card(uint256 character, uint256 material, bool hf, bool hp, uint256 grade) internal pure returns (FireCards.Card memory c) {
        c.character = character;
        c.material = material;
        c.holoFrame = hf;
        c.holoPicture = hp;
        c.grade = grade;
    }

    function test_audit3_imageFileNames() public view {
        string[5] memory mats = ["paper", "wood", "fire", "coal", "diamond"];
        string[4] memory holos = ["none", "picture", "frame", "full"]; // bit 0 = picture, bit 1 = frame
        for (uint256 m; m < 5; m++) {
            for (uint256 h; h < 4; h++) {
                for (uint256 g; g <= 10; g++) {
                    string memory want = string.concat(
                        "c7-", mats[m], "-", holos[h], "-", g == 0 ? "u" : vm.toString(g), ".webp"
                    );
                    assertEq(cards.imageFile(_card(7, m, h & 2 != 0, h & 1 != 0, g)), want);
                }
            }
        }
        assertEq(cards.imageFile(_card(0, 3, true, true, 7)), "c0-coal-full-7.webp");
        assertEq(cards.imageFile(_card(2, 2, false, false, 0)), "c2-fire-none-u.webp");
        assertEq(cards.imageFile(_card(254, 4, false, true, 10)), "c254-diamond-picture-10.webp");
    }

    event ImagesBaseSet(uint256 indexed fire, string imagesBase);

    function test_audit3_imagesBaseMovesUntilLock() public {
        _sellAndClose(1, 2);
        _openAll(1, 2, 9); // serials 1..12 dealt
        vm.expectEmit(address(cards));
        emit ImagesBaseSet(1, "ar://moved/");
        vm.expectEmit(address(cards));
        emit BatchMetadataUpdate(1, 12);
        vm.prank(owner);
        cards.setImagesBase(1, "ar://moved/");
        assertEq(cards.imagesBase(1), "ar://moved/");
        string memory json = string(_b64decode(_after(bytes(cards.tokenURI(1)), 29)));
        assertTrue(_contains(json, '"image":"ar://moved/c'), json);

        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBAD)));
        cards.setImagesBase(1, "ipfs://y/");

        string[3] memory bad = ['ipfs://"x/', "ipfs://x\\/", "ipfs://x\n/"];
        for (uint256 i; i < bad.length; i++) {
            vm.prank(owner);
            vm.expectRevert(FireCards.BadText.selector);
            cards.setImagesBase(1, bad[i]);
        }

        vm.prank(owner);
        vm.expectRevert(FireCards.NotConfigured.selector);
        cards.setImagesBase(77, "ipfs://y/");

        vm.prank(owner);
        cards.lockFire(1);
        vm.prank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.setImagesBase(1, "ipfs://y/");
    }

    function test_audit3_nameLengthCapped() public {
        (string[] memory names, string[] memory cats) = _one("Person");
        names[0] = "1234567890123456789012345678901234567890123456789012345678901234"; // 64 bytes is fine
        vm.prank(owner);
        cards.configureFire(5, names, cats, "ipfs://x/");
        names[0] = "12345678901234567890123456789012345678901234567890123456789012345"; // 65
        vm.prank(owner);
        vm.expectRevert(FireCards.BadText.selector);
        cards.configureFire(5, names, cats, "ipfs://x/");
        names[0] = "back\\slash";
        vm.prank(owner);
        vm.expectRevert(FireCards.BadText.selector);
        cards.configureFire(5, names, cats, "ipfs://x/");
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
}




contract DeployCardsTest is Test {
    function test_deployWiresEverythingAndHandsOwnershipToTheMultisig() public {
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
        DeployCards.Params memory p = DeployCards.Params({
            router: drand, owner: safe, royaltyTo: safe, royaltyBps: 500, packBase: "ipfs://packs/",
            paper: address(paper), plank: address(plank), usdg: address(usdg),
            weth: address(weth), press: address(new MockERC20("PRESS", "PRESS")),
            ethUsd: ethUsd,
            plankUsd: address(twap), paperUsd: address(0),
            v2Router: address(new MockRouterInfo(address(weth), address(new MockV2Factory(twap.PAIR())))),
            revenueWallet: address(0xBEEF), burnWallet: address(0xB0B)
        });
        DeployCards.Deployed memory d = s.deploy(p, address(s));

        assertEq(address(d.cards.PACKS()), address(d.packs));
        assertEq(d.packs.cards(), address(d.cards));
        assertEq(d.packs.seller(), address(d.sale));
        assertEq(d.cards.seller(), address(d.sale));
        assertEq(d.cards.psa(), address(d.psa));
        assertEq(address(d.cards.randomness()), address(d.adapter));
        assertEq(d.adapter.FIRE(), address(d.cards));
        assertEq(address(d.psa.randomness()), address(d.psaAdapter));
        assertEq(d.psaAdapter.FIRE(), address(d.psa));
        assertEq(address(d.adapter.ROUTER()), drand);
        assertEq(address(d.sale.PACKS()), address(d.packs));
        assertEq(address(d.sale.CARDS()), address(d.cards));
        assertEq(d.sale.revenueWallet(), address(0xBEEF));
        assertEq(d.sale.burnWallet(), address(0xB0B));
        assertEq(d.sale.USDG_UNIT(), 1e6);
        assertEq(d.sale.owner(), safe, "the sale is the multisig's from the start");
        assertEq(d.packs.pendingOwner(), safe);
        assertEq(d.cards.pendingOwner(), safe);
        assertEq(d.psa.pendingOwner(), safe);
        vm.prank(safe); d.packs.acceptOwnership();
        vm.prank(safe); d.cards.acceptOwnership();
        vm.prank(safe); d.psa.acceptOwnership();
        assertEq(d.packs.owner(), safe);
        assertEq(d.cards.owner(), safe);
        assertEq(d.psa.owner(), safe);
        (address r, uint256 amt) = d.cards.royaltyInfo(1, 10_000);
        assertEq(r, safe); assertEq(amt, 500);
        assertEq(d.packs.packImageBase(), "ipfs://packs/");
        vm.setEnv("ALLOW_EOA_OWNER", "false");
        vm.expectRevert(bytes("OWNER should be a multisig (set ALLOW_EOA_OWNER=true to override)"));
        s.check(p); // 0x5AFE has no code here
        vm.setEnv("ALLOW_EOA_OWNER", "true");
        s.check(p);

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
        MockFeed paperUsd = new MockFeed(0.05e18);
        paperUsd.setDecimals(18);
        p.paperUsd = address(paperUsd);
        paperUsd.setIds(address(usdg), ethUsd);
        vm.expectRevert(bytes("PAPER_USD_FEED prices a different PAPER"));
        s.check(p);
        paperUsd.setIds(address(paper), address(0xE7));
        vm.expectRevert(bytes("PAPER_USD_FEED uses a different ETH_USD_FEED"));
        s.check(p);
        paperUsd.setIds(address(paper), ethUsd);
        s.check(p);
    }
}
