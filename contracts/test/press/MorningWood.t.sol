// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC1155Receiver} from "openzeppelin-contracts/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC2981} from "openzeppelin-contracts/contracts/interfaces/IERC2981.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {MorningWood} from "../../src/press/MorningWood.sol";
import {PaperBurner} from "../../src/cards/PaperBurner.sol";
import {MockERC20, MockUSDG, MockFeed} from "../Mocks.sol";

/// @dev A buyer contract that refuses ETH (refunds must then fail the buy, not vanish).
contract NoEthBuyer {
    function buy(MorningWood w, uint256 issue, uint256 qty, uint256 maxCost) external payable {
        w.buy{value: msg.value}(issue, qty, MorningWood.Pay.ETH, maxCost);
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }
}

contract MorningWoodTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address owner = address(0xA11CE);
    address editor = address(0xED);
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address royalty = address(0x5);

    MockERC20 paper;
    MockUSDG usdg;
    MockFeed ethUsd;
    PaperBurner burner;
    MorningWood press;

    uint64 T0;

    function setUp() public {
        vm.warp(1_800_000_000);
        T0 = uint64(block.timestamp);
        paper = new MockERC20("PAPER", "PAPER");
        usdg = new MockUSDG();
        ethUsd = new MockFeed(2_500e8); // $2,500
        burner = new PaperBurner(owner, address(paper), address(0x91A), address(usdg), 6, address(0x3E7), address(0x707));
        press = new MorningWood(owner, address(paper), address(usdg), address(burner), address(ethUsd), royalty);
        vm.prank(owner);
        press.setEditor(editor);
        for (uint256 i; i < 2; i++) {
            address who = i == 0 ? alice : bob;
            paper.mint(who, 1_000e18);
            usdg.mint(who, 1_000e6);
            vm.deal(who, 10 ether);
            vm.startPrank(who);
            paper.approve(address(press), type(uint256).max);
            usdg.approve(address(press), type(uint256).max);
            vm.stopPrank();
        }
    }

    /// @dev at == 0 (open now) is the owner's: the editor must publish EDITOR_LEAD ahead.
    function _publish(uint256 issue, uint64 at) internal {
        vm.prank(at == 0 ? owner : editor);
        press.publish(issue, string.concat("ipfs://issue-", vm.toString(issue)), at);
    }

    // ---------------------------------------------------------------- buying

    function test_buyWithEth_burnsPaper_paysBurner_refunds() public {
        _publish(1, 0);
        (uint256 cost, uint256 p) = press.quote(1, 3, MorningWood.Pay.ETH);
        assertEq(p, 3e18);
        uint256 want = (uint256(15e6) * 1e18 + 2_500e8 - 1) / 2_500e8;
        assertEq(cost, want); // $0.15 at $2,500
        uint256 before = alice.balance;
        vm.prank(alice);
        press.buy{value: 1 ether}(1, 3, MorningWood.Pay.ETH, cost);
        assertEq(press.balanceOf(alice, 1), 3);
        assertEq(paper.balanceOf(DEAD), 3e18);
        assertEq(paper.balanceOf(alice), 997e18);
        assertEq(address(burner).balance, cost);
        assertEq(alice.balance, before - cost); // the rest came back
        assertEq(address(press).balance, 0);
        assertEq(uint256(press.issueOf(1).sold), 3);
    }

    function test_buyWithUsdg() public {
        _publish(1, 0);
        vm.prank(alice);
        press.buy(1, 2, MorningWood.Pay.USDG, 0.1e6);
        assertEq(press.balanceOf(alice, 1), 2);
        assertEq(usdg.balanceOf(address(burner)), 0.1e6);
        assertEq(usdg.balanceOf(alice), 1_000e6 - 0.1e6);
        assertEq(paper.balanceOf(DEAD), 2e18);
    }

    function test_usdgBuyRefundsStrayEth() public {
        _publish(1, 0);
        uint256 before = alice.balance;
        vm.prank(alice);
        press.buy{value: 0.5 ether}(1, 1, MorningWood.Pay.USDG, 0.05e6);
        assertEq(alice.balance, before);
        assertEq(address(press).balance, 0);
    }

    function test_maxCost() public {
        _publish(1, 0);
        vm.prank(alice);
        vm.expectRevert(MorningWood.PriceMoved.selector);
        press.buy(1, 2, MorningWood.Pay.USDG, 0.1e6 - 1);
        (uint256 cost,) = press.quote(1, 1, MorningWood.Pay.ETH);
        ethUsd.set(2_000e8); // ETH falls: a copy costs more ETH than the buyer agreed to
        vm.prank(alice);
        vm.expectRevert(MorningWood.PriceMoved.selector);
        press.buy{value: 1 ether}(1, 1, MorningWood.Pay.ETH, cost);
    }

    function test_ethTooLittleSent() public {
        _publish(1, 0);
        (uint256 cost,) = press.quote(1, 1, MorningWood.Pay.ETH);
        vm.prank(alice);
        vm.expectRevert(MorningWood.PriceMoved.selector);
        press.buy{value: cost - 1}(1, 1, MorningWood.Pay.ETH, cost);
    }

    function test_qtyBounds() public {
        _publish(1, 0);
        vm.startPrank(alice);
        vm.expectRevert(MorningWood.BadQty.selector);
        press.buy(1, 0, MorningWood.Pay.USDG, type(uint256).max);
        vm.expectRevert(MorningWood.BadQty.selector);
        press.buy(1, 1001, MorningWood.Pay.USDG, type(uint256).max);
        press.buy(1, 1000, MorningWood.Pay.USDG, type(uint256).max); // unlimited supply, 1,000 a go
        vm.stopPrank();
        assertEq(press.balanceOf(alice, 1), 1000);
        assertEq(paper.balanceOf(DEAD), 1000e18);
    }

    function test_noPaperNoCopy() public {
        _publish(1, 0);
        address carol = makeAddr("carol");
        usdg.mint(carol, 1e6);
        vm.startPrank(carol);
        usdg.approve(address(press), type(uint256).max);
        vm.expectRevert();
        press.buy(1, 1, MorningWood.Pay.USDG, 1e6);
        vm.stopPrank();
    }

    function test_staleFeed() public {
        _publish(1, 0);
        vm.warp(block.timestamp + 25 hours + 1);
        _publish(2, 0);
        vm.prank(alice);
        vm.expectRevert(MorningWood.FeedUnavailable.selector);
        press.buy{value: 1 ether}(2, 1, MorningWood.Pay.ETH, type(uint256).max);
        vm.prank(alice);
        press.buy(2, 1, MorningWood.Pay.USDG, type(uint256).max); // USDG needs no feed
    }

    function test_refundToContractThatRefusesEthReverts() public {
        _publish(1, 0);
        NoEthBuyer b = new NoEthBuyer();
        paper.mint(address(b), 1e18);
        vm.prank(address(b));
        paper.approve(address(press), type(uint256).max);
        (uint256 cost,) = press.quote(1, 1, MorningWood.Pay.ETH);
        b.buy{value: cost}(press, 1, 1, cost); // exact: nothing to refund, fine
        assertEq(press.balanceOf(address(b), 1), 1);
        paper.mint(address(b), 1e18);
        vm.expectRevert(MorningWood.TransferFailed.selector);
        b.buy{value: cost + 1}(press, 1, 1, cost);
    }

    // ---------------------------------------------------------------- the window

    function test_windowOpensAndClosesForever() public {
        _publish(7, T0 + 8 hours);
        assertFalse(press.onSale(7));
        vm.prank(alice);
        vm.expectRevert(MorningWood.NotOnSale.selector);
        press.buy(7, 1, MorningWood.Pay.USDG, type(uint256).max);

        vm.warp(T0 + 8 hours);
        assertTrue(press.onSale(7));
        vm.prank(alice);
        press.buy(7, 1, MorningWood.Pay.USDG, type(uint256).max);

        vm.warp(T0 + 8 hours + 24 hours - 1);
        vm.prank(bob);
        press.buy(7, 1, MorningWood.Pay.USDG, type(uint256).max);

        vm.warp(T0 + 8 hours + 24 hours);
        assertFalse(press.onSale(7));
        vm.prank(bob);
        vm.expectRevert(MorningWood.NotOnSale.selector);
        press.buy(7, 1, MorningWood.Pay.USDG, type(uint256).max);
        // and it can't be published again
        vm.prank(owner);
        vm.expectRevert(MorningWood.AlreadyOpen.selector);
        press.publish(7, "ipfs://again", 0);
        assertEq(uint256(press.issueOf(7).sold), 2);
    }

    function test_unpublishedIssueNotForSale() public {
        vm.prank(alice);
        vm.expectRevert(MorningWood.NotOnSale.selector);
        press.buy(3, 1, MorningWood.Pay.USDG, type(uint256).max);
    }

    function test_publishRules() public {
        vm.startPrank(editor);
        vm.expectRevert(MorningWood.BadIssue.selector);
        press.publish(0, "ipfs://x", 0);
        vm.expectRevert(MorningWood.BadIssue.selector);
        press.publish(1, "", 0);
        vm.expectRevert(MorningWood.BadTime.selector);
        press.publish(1, "ipfs://x", T0 - 1);
        vm.expectRevert(MorningWood.BadTime.selector);
        press.publish(1, "ipfs://x", T0 + 7 days + 1);
        vm.expectRevert(MorningWood.BadTime.selector); // the editor can't open an issue at once
        press.publish(1, "ipfs://x", 0);
        vm.expectRevert(MorningWood.BadTime.selector); // nor with less than EDITOR_LEAD for the owner to look
        press.publish(1, "ipfs://x", T0 + 1 hours - 1);
        press.publish(1, "ipfs://x", T0 + 6 hours);
        press.publish(1, "ipfs://y", T0 + 7 hours); // re-publish before it opens
        vm.stopPrank();
        assertEq(press.uri(1), "ipfs://y");
        assertEq(uint256(press.issueOf(1).opensAt), uint256(T0 + 7 hours));
        vm.warp(T0 + 7 hours);
        vm.prank(editor);
        vm.expectRevert(MorningWood.AlreadyOpen.selector);
        press.publish(1, "ipfs://z", 0);
    }

    function test_editorCantSwapInTheLastHour() public {
        _publish(1, T0 + 3 hours);
        vm.warp(T0 + 2 hours); // exactly EDITOR_LEAD before: the swap is still allowed (to a later time)
        _publish(1, T0 + 4 hours);
        vm.warp(T0 + 3 hours + 1); // within the last hour before it opens
        vm.prank(editor);
        vm.expectRevert(MorningWood.TooLate.selector);
        press.publish(1, "ipfs://swapped", T0 + 6 hours);
        // the owner can always fix it (or open it now)
        vm.prank(owner);
        press.publish(1, "ipfs://fixed", 0);
        assertEq(press.uri(1), "ipfs://fixed");
        assertTrue(press.onSale(1));
    }

    function test_royaltyAndContractUriEvents() public {
        vm.startPrank(owner);
        vm.expectEmit(address(press));
        emit MorningWood.RoyaltySet(alice, 100);
        press.setRoyalty(alice, 100);
        vm.expectEmit(address(press));
        emit MorningWood.ContractURIUpdated();
        press.setContractURI("ipfs://c");
        vm.stopPrank();
        assertEq(press.contractURI(), "ipfs://c");
    }

    function test_ownerVetoBeforeOpen() public {
        _publish(5, T0 + 6 hours);
        vm.prank(editor);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, editor));
        press.unpublish(5);
        vm.prank(owner);
        press.unpublish(5);
        assertEq(press.uri(5), "");
        vm.warp(T0 + 6 hours);
        assertFalse(press.onSale(5));
        _publish(6, 0);
        vm.prank(owner);
        vm.expectRevert(MorningWood.AlreadyOpen.selector);
        press.unpublish(6);
    }

    function test_pricesFixedAtPublish() public {
        _publish(1, 0);
        vm.prank(owner);
        press.setPrices(2e18, 10e6, 3e18);
        _publish(2, 0);
        vm.startPrank(alice);
        press.buy(1, 1, MorningWood.Pay.USDG, 0.05e6); // old prices
        press.buy(2, 1, MorningWood.Pay.USDG, 0.1e6); // new prices
        vm.stopPrank();
        assertEq(paper.balanceOf(DEAD), 3e18);
        assertEq(usdg.balanceOf(address(burner)), 0.15e6);
    }

    function test_priceBounds() public {
        vm.startPrank(owner);
        vm.expectRevert(MorningWood.OutOfBounds.selector);
        press.setPrices(10e18 + 1, 5e6, 1e18);
        vm.expectRevert(MorningWood.OutOfBounds.selector);
        press.setPrices(1e18, 1e8 + 1, 1e18);
        vm.expectRevert(MorningWood.OutOfBounds.selector);
        press.setPrices(1e18, 5e6, 10e18 + 1);
        press.setPrices(0, 0, 0); // free paper day
        vm.stopPrank();
        _publish(1, 0);
        vm.prank(alice);
        press.buy(1, 4, MorningWood.Pay.ETH, 0);
        assertEq(press.balanceOf(alice, 1), 4);
        assertEq(paper.balanceOf(DEAD), 0);
    }

    function test_paused() public {
        _publish(1, 0);
        vm.prank(alice);
        press.buy(1, 1, MorningWood.Pay.USDG, type(uint256).max);
        vm.prank(owner);
        press.setPaused(true);
        vm.startPrank(alice);
        vm.expectRevert(MorningWood.IsPaused.selector);
        press.buy(1, 1, MorningWood.Pay.USDG, type(uint256).max);
        vm.expectRevert(MorningWood.IsPaused.selector);
        press.submitLetter(1, "hello");
        vm.stopPrank();
        vm.prank(owner);
        press.setPaused(false);
        vm.prank(alice);
        press.buy(1, 1, MorningWood.Pay.USDG, type(uint256).max);
    }

    // ---------------------------------------------------------------- letters

    function test_letterHolderOnly_burnsPaper_emits() public {
        _publish(1, 0);
        vm.prank(bob);
        vm.expectRevert(MorningWood.NotHolder.selector);
        press.submitLetter(1, "let me in");
        vm.prank(alice);
        press.buy(1, 1, MorningWood.Pay.USDG, type(uint256).max);
        vm.expectEmit(true, true, false, true, address(press));
        emit MorningWood.Letter(1, alice, "Dear Editor, the wood was hard this morning.");
        vm.prank(alice);
        press.submitLetter(1, "Dear Editor, the wood was hard this morning.");
        assertEq(paper.balanceOf(DEAD), 2e18); // copy + letter
        // a holder of issue 1 only: not issue 2
        _publish(2, 0);
        vm.prank(alice);
        vm.expectRevert(MorningWood.NotHolder.selector);
        press.submitLetter(2, "hi");
        // passing the copy on passes the right to write in
        vm.prank(alice);
        press.safeTransferFrom(alice, bob, 1, 1, "");
        vm.prank(bob);
        press.submitLetter(1, "AD: one slightly used copy, read once");
        vm.prank(alice);
        vm.expectRevert(MorningWood.NotHolder.selector);
        press.submitLetter(1, "wait");
    }

    function test_letterLength() public {
        _publish(1, 0);
        vm.startPrank(alice);
        press.buy(1, 1, MorningWood.Pay.USDG, type(uint256).max);
        vm.expectRevert(MorningWood.BadLetter.selector);
        press.submitLetter(1, "");
        bytes memory long = new bytes(201);
        for (uint256 i; i < long.length; i++) long[i] = "a";
        vm.expectRevert(MorningWood.BadLetter.selector);
        press.submitLetter(1, string(long));
        bytes memory ok = new bytes(200);
        for (uint256 i; i < ok.length; i++) ok[i] = "a";
        press.submitLetter(1, string(ok));
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- access control and admin

    function test_accessControl() public {
        vm.startPrank(alice);
        vm.expectRevert(MorningWood.NotEditor.selector);
        press.publish(1, "ipfs://x", 0);
        bytes memory na = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice);
        vm.expectRevert(na);
        press.setEditor(alice);
        vm.expectRevert(na);
        press.setPrices(1, 1, 1);
        vm.expectRevert(na);
        press.setWiring(address(1), address(ethUsd));
        vm.expectRevert(na);
        press.setPaused(true);
        vm.expectRevert(na);
        press.setRoyalty(alice, 100);
        vm.expectRevert(na);
        press.setUri(1, "x");
        vm.expectRevert(na);
        press.setContractURI("x");
        vm.stopPrank();
        // the editor can only publish
        vm.startPrank(editor);
        press.publish(1, "ipfs://x", T0 + 2 hours);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, editor));
        press.setUri(1, "ipfs://evil");
        vm.stopPrank();
        // the owner can publish too, and fix a URI after opening
        vm.startPrank(owner);
        press.publish(2, "ipfs://two", 0);
        vm.warp(T0 + 2 hours);
        press.setUri(1, "ipfs://fixed");
        press.setEditor(address(0));
        vm.stopPrank();
        assertEq(press.uri(1), "ipfs://fixed");
        vm.prank(editor);
        vm.expectRevert(MorningWood.NotEditor.selector);
        press.publish(3, "ipfs://x", 0);
    }

    function test_ownershipTwoStepNoRenounce() public {
        vm.prank(owner);
        press.transferOwnership(bob);
        assertEq(press.owner(), owner);
        vm.prank(bob);
        press.acceptOwnership();
        assertEq(press.owner(), bob);
        vm.prank(bob);
        vm.expectRevert(MorningWood.RenounceDisabled.selector);
        press.renounceOwnership();
    }

    function test_wiringChecks() public {
        MockFeed bad = new MockFeed(1);
        bad.setDecimals(18);
        vm.startPrank(owner);
        vm.expectRevert(MorningWood.FeedUnavailable.selector);
        press.setWiring(address(burner), address(bad));
        vm.expectRevert(MorningWood.ZeroAddress.selector);
        press.setWiring(address(0), address(ethUsd));
        vm.stopPrank();
    }

    function test_royaltiesAndInterfaces() public {
        (address to, uint256 amt) = press.royaltyInfo(1, 10_000);
        assertEq(to, royalty);
        assertEq(amt, 250);
        vm.prank(owner);
        vm.expectRevert(MorningWood.OutOfBounds.selector);
        press.setRoyalty(royalty, 1001);
        assertTrue(press.supportsInterface(type(IERC2981).interfaceId));
        assertTrue(press.supportsInterface(0xd9b67a26)); // ERC-1155
        assertEq(press.name(), "The Morning Wood");
    }

    function testFuzz_buyEth(uint256 qty, uint256 px) public {
        qty = bound(qty, 1, 1000);
        px = bound(px, 100e8, 100_000e8);
        ethUsd.set(int256(px));
        _publish(1, 0);
        (uint256 cost,) = press.quote(1, qty, MorningWood.Pay.ETH);
        assertGe(cost * px, qty * 5e6 * 1e18); // never under the dollar price
        vm.deal(alice, cost + 1 ether);
        vm.prank(alice);
        press.buy{value: cost + 1 ether}(1, qty, MorningWood.Pay.ETH, cost);
        assertEq(address(burner).balance, cost);
        assertEq(alice.balance, 1 ether);
        assertEq(address(press).balance, 0);
    }
}

import {DeployPress} from "../../script/DeployPress.s.sol";

/// @dev The deploy script's checks and wiring, against mocks (no broadcast, nothing written).
contract DeployPressTest is Test {
    function test_deployScriptWiresEverything() public {
        MockERC20 paper = new MockERC20("PAPER", "PAPER");
        MockUSDG usdg = new MockUSDG();
        MockFeed eth = new MockFeed(2_500e8);
        PaperBurner burner = new PaperBurner(address(0xA11CE), address(paper), address(0x91A), address(usdg), 6, address(0x3E7), address(0x707));
        DeployPress s = new DeployPress();
        MorningWood press = s.deploy(DeployPress.Params({
            paper: address(paper), usdg: address(usdg), ethUsd: address(eth), burner: address(burner),
            owner: address(0xA11CE), royaltyTo: address(0x5), editor: address(0xED), contractUri: "ipfs://collection"
        }));
        assertEq(press.editor(), address(0xED));
        assertEq(press.contractURI(), "ipfs://collection");
        assertEq(press.pendingOwner(), address(0xA11CE));
        assertEq(press.paperBurner(), address(burner));
        vm.prank(address(0xA11CE));
        press.acceptOwnership();
        assertEq(press.owner(), address(0xA11CE));
    }
}
