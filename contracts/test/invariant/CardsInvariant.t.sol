// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {FireSale} from "../../src/cards/FireSale.sol";
import {FireCards} from "../../src/cards/FireCards.sol";
import {CardsHandler} from "./CardsHandler.sol";
import {CardRules} from "../../src/cards/CardRules.sol";

/// @dev Handler-based invariants over the whole card system: FireSale, FirePacks, FireCards, FirePsa.
/// forge-config: default.invariant.runs = 64
/// forge-config: default.invariant.depth = 60
/// forge-config: default.invariant.fail-on-revert = false
contract CardsInvariantTest is StdInvariant, Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    CardsHandler h;

    function setUp() public {
        h = new CardsHandler();
        h.bootstrap();
        targetContract(address(h));
        bytes4[] memory sels = new bytes4[](24);
        uint256 i;
        sels[i++] = h.buyWithPlank.selector;
        sels[i++] = h.buyWithPlank.selector; // weighted
        sels[i++] = h.buyWithEth.selector;
        sels[i++] = h.buyWithUsdg.selector;
        sels[i++] = h.claimStarter.selector;
        sels[i++] = h.useCredits.selector;
        sels[i++] = h.burnCards.selector;
        sels[i++] = h.suggest.selector;
        sels[i++] = h.configureDrop.selector;
        sels[i++] = h.pickSuggestions.selector;
        sels[i++] = h.endDrop.selector;
        sels[i++] = h.closeSoldOut.selector;
        sels[i++] = h.open.selector;
        sels[i++] = h.open.selector; // weighted
        sels[i++] = h.deliverCards.selector;
        sels[i++] = h.process.selector;
        sels[i++] = h.keeper.selector;
        sels[i++] = h.reveal.selector;
        sels[i++] = h.deliverPsa.selector;
        sels[i++] = h.finish.selector;
        sels[i++] = h.transferCard.selector;
        sels[i++] = h.warp.selector;
        sels[i++] = h.warp.selector; // weighted
        sels[i++] = h.routerMood.selector;
        // lower-weight actions ride along below
        bytes4[] memory all = new bytes4[](i + 5);
        for (uint256 j; j < i; j++) all[j] = sels[j];
        all[i] = h.setPrices.selector;
        all[i + 1] = h.setPaperPrice.selector;
        all[i + 2] = h.passPress.selector;
        all[i + 3] = h.setOdds.selector;
        all[i + 4] = h.setDiamonds.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: all}));
    }

    // ---------------------------------------------------------------- violations seen inside actions

    /// Covers: wallet limit before liftAfter (tracked per buy), pack guarantees (≥3 Paper, ≥1 Wood, slot 6
    /// Fire-or-better, from CardDealt logs), grades only 1..10 and never twice (from Graded logs), pending cards can't
    /// move, quotes equal what was charged, one starter per wallet and per press.
    function invariant_noViolationSeenInActions() public view {
        assertEq(h.violation(), "", h.violation());
    }

    // ---------------------------------------------------------------- the sale never holds anything

    function invariant_saleHoldsNothing() public view {
        FireSale sale = h.sale();
        assertEq(address(sale).balance, 0, "eth");
        assertEq(h.usdg().balanceOf(address(sale)), 0, "usdg");
        assertEq(h.plank().balanceOf(address(sale)), 0, "plank");
        assertEq(h.paper().balanceOf(address(sale)), 0, "paper");
        assertEq(h.usdg().allowance(address(sale), address(h.router())), 0, "router allowance");
        assertEq(h.plank().allowance(address(sale), address(h.router())), 0, "router plank allowance");
    }

    // ---------------------------------------------------------------- PAPER

    function invariant_everyPaperSpentWentToDead() public view {
        uint256 spent;
        for (uint256 i; i < h.actorCount(); i++) spent += h.PAPER0() - h.paper().balanceOf(h.actors(i));
        assertEq(h.paper().balanceOf(DEAD), spent, "dead == actors' PAPER spent");
        assertEq(spent, h.ghostPaperBurned(), "spent == what the rules charge");
    }

    // ---------------------------------------------------------------- money, per currency

    function invariant_moneyGoesWhereItShould() public view {
        address rev = h.revenue();
        address bw = h.burnW();
        // PLANK: 70% revenue, 30% straight to dead. The router's swap output is the only other PLANK at dead.
        uint256 plankSpent;
        uint256 ethSpent;
        uint256 usdgSpent;
        for (uint256 i; i < h.actorCount(); i++) {
            address a = h.actors(i);
            plankSpent += h.PLANK0() - h.plank().balanceOf(a);
            ethSpent += h.ETH0() - a.balance;
            usdgSpent += h.USDG0() - h.usdg().balanceOf(a);
        }
        assertEq(plankSpent, h.ghostPaid(0), "PLANK spent");
        assertEq(ethSpent, h.ghostPaid(1), "ETH spent");
        assertEq(usdgSpent, h.ghostPaid(2), "USDG spent");

        assertEq(h.plank().balanceOf(rev), h.ghostPaid(0) - h.ghostBurnShare(0), "PLANK revenue");
        assertEq(h.plank().balanceOf(DEAD) - h.router().plankOut(), h.ghostBurnShare(0), "PLANK burned directly");
        assertEq(h.plank().balanceOf(bw), 0, "burn wallet never gets PLANK");

        assertEq(rev.balance, h.ghostPaid(1) - h.ghostBurnShare(1), "ETH revenue");
        assertEq(bw.balance + h.router().ethSwapped(), h.ghostBurnShare(1), "ETH burn share: swapped or burn wallet");
        assertEq(address(h.router()).balance, h.router().ethSwapped(), "router ETH");

        assertEq(h.usdg().balanceOf(rev), h.ghostPaid(2) - h.ghostBurnShare(2), "USDG revenue");
        assertEq(h.usdg().balanceOf(bw) + h.router().usdgSwapped(), h.ghostBurnShare(2), "USDG burn share");
        assertEq(h.usdg().balanceOf(address(h.router())), h.router().usdgSwapped(), "router USDG");

        // the totals, as the spec states it
        assertEq(h.plank().balanceOf(rev) + h.plank().balanceOf(DEAD) - h.router().plankOut(), plankSpent, "PLANK total");
        assertEq(rev.balance + bw.balance + h.router().ethSwapped(), ethSpent, "ETH total");
        assertEq(h.usdg().balanceOf(rev) + h.usdg().balanceOf(bw) + h.router().usdgSwapped(), usdgSpent, "USDG total");
    }

    // ---------------------------------------------------------------- credits

    function invariant_creditsMatchBurnsAndPicks() public view {
        FireSale sale = h.sale();
        for (uint256 i; i < h.actorCount(); i++) {
            address a = h.actors(i);
            uint256 burned = h.ghostBurned(a);
            uint256 picks;
            for (uint256 f = 1; f <= h.FIRES(); f++) picks += h.ghostPicks(f, a);
            assertEq(sale.credits(a) + h.ghostBurnCreditsUsed(a), burned / 42 + picks, "credits == floor(burned / 42) + picks");
            assertEq(sale.burnCount(a), burned % 42, "running count");
        }
    }

    // ---------------------------------------------------------------- packs and cards per Fire

    function invariant_packsPerFire() public view {
        FireSale sale = h.sale();
        for (uint256 f = 1; f <= h.FIRES(); f++) {
            FireSale.Drop memory d = sale.dropOf(f);
            uint256 minted = h.packs().minted(f);
            assertLe(minted, uint256(d.packs) + d.starters, "packs minted <= packs + starters");
            assertEq(minted, uint256(d.paidSold) + d.creditPacks + d.startersClaimed, "minted == sold + credits + starters");
            assertLe(d.startersClaimed, d.starters, "starters");
            assertLe(h.packs().burned(f), minted, "opened <= minted");
        }
    }

    function invariant_cardsPerFire() public view {
        FireCards cards = h.cards();
        for (uint256 f = 1; f <= h.FIRES(); f++) {
            (bool closed,,, uint32 nPacks, uint32 dealt,,,,,) = cards.fires(f);
            uint256 dealtCards = h.ghostCards(f);
            if (!closed) { assertEq(dealtCards, 0, "cards before close"); continue; }
            assertEq(nPacks, h.packs().minted(f), "pack count frozen at close");
            assertLe(dealtCards, 6 * uint256(nPacks), "cards <= 6 x packs");
            assertEq(dealtCards, 6 * uint256(dealt), "6 per dealt pack");
            uint256 poolTotal;
            for (uint256 m; m < 5; m++) poolTotal += cards.poolOf(f, m);
            assertEq(poolTotal, 6 * uint256(nPacks), "pool == 6 x packs");
            // each Series stands alone: its pool is the rule applied to its own packs and Diamond setting
            uint256[5] memory want = CardRules.computePool(nPacks, cards.diamondsFor(f));
            for (uint256 m; m < 5; m++) assertEq(cards.poolOf(f, m), want[m], "pool == computePool(packs, diamonds)");
            if (nPacks > 0) assertGe(cards.poolOf(f, 4), 1, "at least one Diamond");
            if (dealt == nPacks) {
                for (uint256 m; m < 5; m++) assertEq(h.ghostMat(f, m), cards.poolOf(f, m), "fully dealt: totals == pool");
            } else {
                for (uint256 m; m < 5; m++) assertLe(h.ghostMat(f, m), cards.poolOf(f, m), "never more than the pool");
            }
        }
    }

    // ---------------------------------------------------------------- grades and pending marks

    function invariant_gradesAndPending() public view {
        FireCards cards = h.cards();
        uint256 total = cards.nextSerial() - 1;
        for (uint256 s = 1; s <= total; s++) {
            (bool exists,, uint256 grade) = cards.gradeInfo(s);
            if (!exists) continue;
            assertLe(grade, 10, "grade 0..10");
            assertEq(grade, h.ghostGrade(s), "grade only set by finish, as logged");
            bool p = h.psa().pending(s);
            assertEq(cards.gradePending(s), p, "card and PDA agree on pending");
            if (p) assertEq(grade, 0, "pending cards are ungraded");
        }
    }

    function test_bootstrapState() public view {
        assertEq(h.cards().balanceOf(h.actors(0)), 60);
        assertEq(h.cardReqsLeft(), 0);
    }
}
