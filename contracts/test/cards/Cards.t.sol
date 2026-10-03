// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {FirePacks} from "../../src/cards/FirePacks.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {CardRules} from "../../src/cards/CardRules.sol";
import {DeployCards} from "../../script/DeployCards.s.sol";

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
    function pool(int256[5] memory before, uint256 packs) external pure returns (uint256[5] memory, int256[5] memory) {
        return CardRules.computePool(before, packs);
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
        uint8[] memory cats = new uint8[](n);
        for (uint256 i; i < n; i++) { names[i] = string.concat("Char", vm.toString(i)); cats[i] = uint8(i % 7); }
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

    function test_poolParityWithStudio() public {
        PoolHarness h = new PoolHarness();
        string memory json = vm.readFile("test/cards/pool-fixture.json");
        uint256 rows = 300;
        for (uint256 i; i < rows; i++) {
            string memory p = string.concat(".rows[", vm.toString(i), "]");
            uint256 n = json.readUint(string.concat(p, ".packs"));
            int256[] memory before = json.readIntArray(string.concat(p, ".before"));
            uint256[] memory counts = json.readUintArray(string.concat(p, ".counts"));
            int256[] memory after_ = json.readIntArray(string.concat(p, ".after"));
            int256[5] memory b;
            for (uint256 m; m < 5; m++) b[m] = before[m];
            (uint256[5] memory c, int256[5] memory a) = h.pool(b, n);
            for (uint256 m; m < 5; m++) {
                assertEq(c[m], counts[m], string.concat("count row ", vm.toString(i)));
                assertEq(a[m], after_[m], string.concat("carry row ", vm.toString(i)));
            }
        }
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
        vm.warp(block.timestamp + 1 hours + 1);
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
        uint8[] memory cats = new uint8[](1);
        vm.prank(owner);
        vm.expectRevert(FireCards.FireIsLocked.selector);
        cards.configureFire(1, names, cats, "x");
    }

    function test_carryOverAcrossFires() public {
        _sellAndClose(1, 150);
        int256[5] memory acc = cards.accumulators();
        assertEq(acc[3], 10_000); // Charcoal 44.1 -> 44, carries 0.1
        assertEq(acc[4], -10_000); // Diamond 0.9 -> 1, owes 0.1
    }

    function _startsWith(string memory s, string memory p) internal pure returns (bool) {
        bytes memory a = bytes(s); bytes memory b = bytes(p);
        if (a.length < b.length) return false;
        for (uint256 i; i < b.length; i++) if (a[i] != b[i]) return false;
        return true;
    }
}


contract DeployCardsTest is Test {
    function test_deployWiresEverythingAndHandsOwnershipToTheMultisig() public {
        DeployCards s = new DeployCards();
        address safe = address(0x5AFE);
        address router = address(0xD5A1);
        DeployCards.Deployed memory d = s.deploy(router, safe, safe, 500, "ipfs://packs/", address(s));
        assertEq(address(d.cards.PACKS()), address(d.packs));
        assertEq(d.packs.cards(), address(d.cards));
        assertEq(address(d.cards.randomness()), address(d.adapter));
        assertEq(d.adapter.FIRE(), address(d.cards));
        assertEq(address(d.adapter.ROUTER()), router);
        assertEq(d.packs.pendingOwner(), safe);
        assertEq(d.cards.pendingOwner(), safe);
        vm.prank(safe); d.packs.acceptOwnership();
        vm.prank(safe); d.cards.acceptOwnership();
        assertEq(d.packs.owner(), safe);
        assertEq(d.cards.owner(), safe);
        (address r, uint256 amt) = d.cards.royaltyInfo(1, 10_000);
        assertEq(r, safe); assertEq(amt, 500);
        assertEq(d.packs.packImageBase(), "ipfs://packs/");
    }
}
