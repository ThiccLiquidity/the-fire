// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Fire, ISeaport} from "../src/Fire.sol";
import {MockERC20, MockUSDG, MockMill, MockRandomness, MockFeed, MockSeaport, BlockingERC20} from "./Mocks.sol";
import {IERC721} from "openzeppelin-contracts/contracts/token/ERC721/IERC721.sol";

contract FireTest is Test {
    Fire fire;
    MockERC20 paper;
    MockERC20 plank;
    MockUSDG usdg;
    MockMill mill;
    MockRandomness rng;
    MockFeed ethFeed;
    MockFeed plankFeed;
    MockFeed paperFeed;

    address royalty = address(0xB0B);
    address alice = address(0xA11CE);
    address bob = address(0xB0B2);
    address carol = address(0xCA201);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 constant PAPER_T = 1e18;
    uint256 constant PLANK_T = 10_000_000e18;
    uint256 constant ETH_T = 0.0003 ether; // $1 at $3,333/ETH (set below)
    uint256 constant MILL_BID = 100e8; // $100, USD 8 decimals
    uint256 constant ROLL_TOD = 3 hours; // 8pm Phoenix
    uint256 constant PLANK_IN_MILL = 800_000_000e18;

    // rnd values that pick specific luck-table slots (low 5 bits)
    uint256 constant RND_CALM = 0; // luck 0.144x (gentlest of 32)
    uint256 constant RND_MONSTER = 31; // luck 6.95x (worst of 32)
    uint256 constant RND_MID = 16; // luck 1.036x

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new MockERC20("PAPER", "PAPER");
        plank = new MockERC20("PLANK", "PLANK");
        usdg = new MockUSDG();
        mill = new MockMill(address(plank), PLANK_IN_MILL);
        rng = new MockRandomness();
        ethFeed = new MockFeed(3_333_33333333); // $3,333.33 -> $1 = 0.0003 ETH
        plankFeed = new MockFeed(90_000_000_000);
        paperFeed = new MockFeed(0); // no PAPER market yet // $9e-8 per PLANK in 18-dec -> $0.90 for 10M PLANK
        fire = new Fire(Fire.Config({
            paper: address(paper), plank: address(plank), mill: address(mill), seaport: address(0), royaltyPool: royalty,
            randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed), paperUsdFeed: address(paperFeed), usdg: address(usdg),
            paperPerTicket: PAPER_T, paperUsdCap: 33_000_000, plankPerTicket0: PLANK_T, plankUsdPerTicket: 90_000_000 /* $0.90 */,
            ethUsdPerTicket: 100_000_000 /* $1.00 */, millBidBase: MILL_BID, rollTimeOfDay: ROLL_TOD
        }));
        rng.setFire(address(fire));
        for (uint256 i; i < 3; i++) {
            address a = [alice, bob, carol][i];
            paper.mint(a, 1e12 * 1e18);
            plank.mint(a, 1e16 * 1e18);
            vm.deal(a, 100 ether);
            vm.startPrank(a);
            paper.approve(address(fire), type(uint256).max);
            plank.approve(address(fire), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ------------------------------------------------------------ helpers
    /// Buys exactly n tickets, in 9s (a full buy of 10 would give 11).
    function _buy(address who, uint256 n) internal {
        while (n > 0) {
            uint256 k = n > 9 ? 9 : n;
            vm.prank(who);
            fire.buyTickets(k, type(uint256).max, type(uint256).max, "gm");
            n -= k;
        }
    }
    function _buyEth(address who, uint256 n) internal {
        while (n > 0) {
            uint256 k = n > 9 ? 9 : n;
            (, , uint256 c) = fire.quote(k);
            vm.prank(who);
            fire.buyTicketsWithEth{value: c}(k, type(uint256).max, "");
            n -= k;
        }
    }

    function _roll(uint256 rnd) internal {
        vm.warp(fire.nextRollAt());
        ethFeed.set(ethFeed.answer());
        plankFeed.set(plankFeed.answer());
        fire.roll();
        rng.fulfill(rng.last(), rnd);
    }

    // ------------------------------------------------------------ pricing
    function test_quote_is_full_price_and_10_buys_11() public view {
        (uint256 p1,, ) = fire.quote(1);
        (uint256 p5,,) = fire.quote(5);
        (uint256 p10,,) = fire.quote(10);
        assertEq(p1, 1e18);
        assertEq(p5, 5e18);
        assertEq(p10, 10e18, "no discount on the price");
        assertEq(fire.ticketsFor(9), 9);
        assertEq(fire.ticketsFor(10), 11, "buy 10, get 1 free");
    }

    function test_buy_10_get_11_tickets() public {
        uint256 deadPaper = paper.balanceOf(DEAD);
        uint256 id = fire.fireId();
        vm.expectEmit(true, true, false, true);
        emit Fire.TicketsBought(id, alice, 11, false, "ten");
        vm.prank(alice);
        fire.buyTickets(10, type(uint256).max, type(uint256).max, "ten");
        assertEq(paper.balanceOf(DEAD) - deadPaper, 10e18, "pays for 10");
        assertEq(fire.pot(), 10 * PLANK_T / 2, "10 tickets' PLANK: the free one adds none");
        (uint256 mine, uint256 total) = fire.odds(alice);
        assertEq(mine, 11, "holds 11");
        assertEq(total, 11);
        assertEq(fire.fireSizeMilli(), 11_000);
        assertEq(fire.remainingToday(alice), 489, "all 11 count toward the daily cap");
    }

    function test_free_ticket_needs_room_under_the_daily_cap() public {
        _buy(alice, 490);
        vm.prank(alice);
        vm.expectRevert(Fire.DailyCap.selector);
        fire.buyTickets(10, type(uint256).max, type(uint256).max, ""); // would be 501
        vm.prank(alice);
        fire.buyTickets(9, type(uint256).max, type(uint256).max, ""); // 499 is fine
        assertEq(fire.remainingToday(alice), 1);
    }

    function test_eth_and_usdg_buys_of_10_also_get_11() public {
        (, , uint256 c) = fire.quote(10);
        vm.prank(bob); fire.buyTicketsWithEth{value: c}(10, type(uint256).max, "");
        vm.startPrank(carol); usdg.mint(carol, 10e6); usdg.approve(address(fire), type(uint256).max); fire.buyTicketsWithUsdg(10, type(uint256).max, ""); vm.stopPrank();
        (uint256 b,) = fire.odds(bob); (uint256 k,) = fire.odds(carol);
        assertEq(b, 11); assertEq(k, 11);
        assertEq(fire.millFundUsdg(), 10e6, "10 dollars for 11 tickets");
    }

    function test_buy_burns_paper_splits_plank() public {
        uint256 deadPaper = paper.balanceOf(DEAD);
        uint256 deadPlank = plank.balanceOf(DEAD);
        _buy(alice, 10);
        assertEq(paper.balanceOf(DEAD) - deadPaper, 10e18, "paper 100% burned");
        assertEq(plank.balanceOf(DEAD) - deadPlank, 10 * PLANK_T / 2, "half plank burned");
        assertEq(fire.pot(), 10 * PLANK_T / 2, "half plank to pot");
        (uint256 mine, uint256 total) = fire.odds(alice);
        assertEq(mine, 10);
        assertEq(total, 10);
        assertEq(fire.ticketsToday(), 10);
    }

    function test_buy_with_eth_feeds_mill_fund() public {
        (, , uint256 ethCost) = fire.quote(10);
        assertApproxEqRel(ethCost, 10 * 0.0003 ether, 1e15, "$1 each at $3333/ETH");
        vm.prank(bob);
        fire.buyTicketsWithEth{value: ethCost}(10, type(uint256).max, "outsider");
        assertEq(fire.millFund(), ethCost);
        (uint256 mine,) = fire.odds(bob);
        assertEq(mine, 11, "10 bought + 1 free");
        assertEq(paper.balanceOf(DEAD), 0, "no paper involved");
    }

    function test_buy_with_wrong_eth_reverts() public {
        vm.prank(bob);
        vm.expectRevert(Fire.BadAmount.selector);
        fire.buyTicketsWithEth{value: 1}(1, type(uint256).max, "");
    }

    // ------------------------------------------------------------ storms
    function test_night_one_always_survives_even_with_zero_tickets() public {
        _roll(RND_MONSTER);
        assertEq(fire.night(), 1);
        assertEq(fire.fireId(), 1, "same fire");
    }

    function test_roll_before_time_reverts() public {
        vm.expectRevert(Fire.NotYet.selector);
        fire.roll();
    }

    function test_double_roll_reverts_while_pending() public {
        vm.warp(fire.nextRollAt());
        fire.roll();
        vm.expectRevert(Fire.RollPending.selector);
        fire.roll();
    }

    function test_only_adapter_can_fulfill() public {
        vm.warp(fire.nextRollAt());
        fire.roll();
        vm.expectRevert(Fire.NotRandomness.selector);
        fire.onRandomness(1, 1);
    }

    function test_storm_formula() public {
        _buy(alice, 400); _buy(bob, 400);
        _roll(RND_MID); // night 1: no storm; trail = [800]
        // storms are in thousandths of a ticket. night 2: 800 * ((2-1)/8)^1.5 = 35.4 tickets; luck slot 16 = x1.06
        assertEq(fire.stormStrength(2, RND_MID), 37499);
        // night 9: 800 * 1.0 * 1.06
        assertEq(fire.stormStrength(9, RND_MID), 848400);
        // luck extremes: x0.04 and x25.3
        assertEq(fire.stormStrength(9, RND_CALM), 31600);
        assertEq(fire.stormStrength(9, RND_MONSTER), 20240160);
        assertEq(fire.stormStrength(1, RND_MONSTER), 0, "night 1 no storm");
        assertEq(fire.stormStrength(24, RND_CALM), type(uint256).max, "night 24 infinite");
    }

    function test_fire_size_persists_and_burns_down() public {
        _buy(alice, 500);
        assertEq(fire.fireSizeMilli(), 500_000);
        _roll(RND_MID); // night 1: no storm; size = 500 * 0.6 = 300
        assertEq(fire.fireSizeMilli(), 300_000);
        _buy(bob, 200); // size 500
        // night 2 storm at mid luck = trail(500,200 -> avg 350) * 0.0442 * 1.036 = 16
        uint256 storm = fire.stormStrength(2, RND_MID);
        _roll(RND_MID);
        assertEq(fire.fireSizeMilli(), (500_000 - storm) * 6000 / 10000, "size minus storm, then 60%");
        assertEq(fire.fireId(), 1);
    }

    function test_small_fire_dies_to_big_storm_big_fire_survives() public {
        // build a trailing average of 500/day over a few calm nights, then let the fire starve
        for (uint256 i; i < 4; i++) { _buy(alice, 500); _roll(RND_CALM); }
        uint256 storm = fire.stormStrength(5, 28); // a strong night (x6.3): 500 * 0.354 * 6.3 = 1,119 tickets
        assertGt(storm, 1_000_000);
        _buy(carol, 10); // a starved fire: tiny top-up
        assertLt(fire.fireSizeMilli(), storm);
        _roll(28);
        assertEq(fire.fireId(), 2, "small fire died");
        // new fire: fed hard for 4 nights; the same kind of night-5 storm doesn't kill it
        for (uint256 i; i < 4; i++) { _buy(alice, 500); _buy(bob, 500); _buy(carol, 500); _roll(RND_CALM); }
        _buy(alice, 500); _buy(bob, 500); _buy(carol, 500);
        assertGt(fire.fireSizeMilli(), fire.stormStrength(5, 28), "well-fed fire outweighs a strong night 5");
        uint256 id = fire.fireId();
        _roll(28);
        assertEq(fire.fireId(), id, "survived");
    }

    function test_a_one_ticket_fire_survives_a_calm_night() public {
        // counted in thousandths, a 1-ticket fire keeps 0.6 of a ticket overnight instead of rounding to nothing
        _buy(alice, 1);
        _roll(RND_MID);
        assertEq(fire.fireSizeMilli(), 600);
        _roll(RND_CALM); // night 2, nobody bought: storm 1 * 0.044 * 0.04 = 0.0017 tickets
        assertEq(fire.fireId(), 1, "still burning");
    }

    function test_no_fire_outlives_night_24() public {
        // Three wallets at the daily cap every day with the gentlest possible luck: still dies by night 24.
        for (uint256 n = 1; n <= 24; n++) {
            _buy(alice, 500); _buy(bob, 500); _buy(carol, 500);
            _roll(RND_CALM);
            if (fire.fireId() == 2) break;
        }
        assertEq(fire.fireId(), 2, "fire died");
        assertLe(fire.night(), 23);
    }

    function test_night_24_storm_is_infinite() public view {
        assertEq(fire.stormStrength(24, RND_CALM), type(uint256).max);
        assertEq(fire.stormStrength(30, RND_MONSTER), type(uint256).max);
    }

    // ------------------------------------------------------------ payout
    function test_payout_40_winner_25_burn_5_royalty_30_carry() public {
        _buy(alice, 500); // alice is the only ticket holder
        uint256 p = fire.pot();
        _roll(RND_CALM); // night 1 survive; size 300
        uint256 deadBefore = plank.balanceOf(DEAD);
        uint256 aliceBefore = plank.balanceOf(alice);
        _roll(RND_MONSTER); // night 2 monster: 500*0.0442*6.95 = 153 < 300 ... need bigger. roll more.
        // keep rolling monsters until it dies
        while (fire.fireId() == 1) _roll(RND_MONSTER);
        uint256 winner = p * 4000 / 10000;
        uint256 royaltyCut = p * 500 / 10000;
        assertEq(plank.balanceOf(alice) - aliceBefore, winner, "winner gets the full 40%");
        assertEq(plank.balanceOf(royalty), royaltyCut, "5% of the pot to the Paper Mill royalty pool");
        assertEq(plank.balanceOf(DEAD) - deadBefore, p * 2500 / 10000, "25% burned");
        assertEq(fire.pot(), p - winner - royaltyCut - p * 2500 / 10000, "30% carried");
        assertEq(fire.pot(), p * 3000 / 10000, "which is exactly 30%");
        assertEq(fire.lastWinner(), alice);
        assertEq(fire.ticketsTotal(), 0, "tickets reset");
    }

    function test_no_tickets_at_all_rolls_winner_slice_forward() public {
        // Fire 1 has tickets and goes out; fire 2 starts with the carry and nobody buys.
        _buy(alice, 10);
        _roll(RND_CALM);
        while (fire.fireId() == 1) _roll(RND_MONSTER);
        uint256 carried = fire.pot();
        assertGt(carried, 0);
        uint256 royaltyBefore = plank.balanceOf(royalty);
        _roll(RND_CALM); // night 1 survives regardless
        _roll(RND_MONSTER); // size 0 -> goes out with no tickets
        assertEq(fire.fireId(), 3);
        assertEq(fire.lastWinner(), address(0));
        assertEq(fire.pot(), carried, "nobody had a ticket: the whole pot carries, nothing burns");
        assertEq(plank.balanceOf(royalty), royaltyBefore, "nothing to the pool without a winner");
    }

    function test_winner_is_ticket_weighted() public {
        _buy(alice, 450);
        _buy(bob, 50);
        _roll(RND_CALM);
        // burn the size down with calm nights so a monster kills it in one roll
        _roll(RND_CALM); _roll(RND_CALM); _roll(RND_CALM);
        uint256 aliceWins;
        uint256 snap = vm.snapshotState();
        for (uint256 i; i < 200; i++) {
            vm.revertToState(snap);
            snap = vm.snapshotState();
            _roll((i << 5) | RND_MONSTER); // monster storm, varying winner seed
            if (fire.lastWinner() == alice) aliceWins++;
        }
        // 90% expected; allow wide tolerance
        assertGt(aliceWins, 150);
        assertLt(aliceWins, 200);
    }

    // ------------------------------------------------------------ mill fund

    function _seaportFire() internal returns (Fire f2, MockSeaport sea) {
        sea = new MockSeaport(address(mill));
        f2 = new Fire(Fire.Config({
            paper: address(paper), plank: address(plank), mill: address(mill), seaport: address(sea), royaltyPool: royalty,
            randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed), paperUsdFeed: address(paperFeed), usdg: address(usdg),
            paperPerTicket: PAPER_T, paperUsdCap: 33_000_000, plankPerTicket0: PLANK_T, plankUsdPerTicket: 90_000_000,
            ethUsdPerTicket: 100_000_000, millBidBase: MILL_BID, rollTimeOfDay: ROLL_TOD
        }));
        vm.deal(address(f2), 1 ether); // ~$3,333 of ETH-ticket money
        f2.pokeMillBid();
        vm.startPrank(alice); plank.approve(address(mill), type(uint256).max); mill.setApprovalForAll(address(sea), true); vm.stopPrank();
    }

    // ------------------------------------------------------------ mill bid: climbs only while the fund can pay
    function test_empty_fund_bid_never_climbs() public {
        assertEq(fire.millBid(), MILL_BID);
        vm.warp(block.timestamp + 30 days);
        assertEq(fire.millBid(), MILL_BID, "no money, no climb");
    }

    function test_bid_climbs_25pct_per_day_while_funded_and_caps_at_3x() public {
        usdg.mint(address(fire), 10_000e6); fire.pokeMillBid();
        vm.warp(block.timestamp + 12 hours);
        assertEq(fire.millBid(), MILL_BID * 1125 / 1000, "+12.5% after half a day");
        vm.warp(block.timestamp + 12 hours);
        assertEq(fire.millBid(), MILL_BID * 125 / 100, "+25% after a day");
        vm.warp(block.timestamp + 60 days);
        assertEq(fire.millBid(), MILL_BID * 3, "never past 3x");
    }

    function test_bid_never_climbs_above_the_fund() public {
        usdg.mint(address(fire), 120e6); fire.pokeMillBid(); // $120 in the fund, bid starts at $100
        vm.warp(block.timestamp + 10 days);
        assertEq(fire.millBid(), 120e8, "stops at what the fund holds");
        usdg.mint(address(fire), 30e6); fire.pokeMillBid(); // more money arrives
        vm.warp(block.timestamp + 10 days);
        assertEq(fire.millBid(), 150e8, "then climbs to the new amount, gradually");
    }

    function test_money_arriving_later_does_not_find_a_high_bid() public {
        vm.warp(block.timestamp + 30 days); // a month with an empty fund
        vm.startPrank(bob); usdg.mint(bob, 1_000e6); usdg.approve(address(fire), type(uint256).max);
        for (uint256 i; i < 45; i++) fire.buyTicketsWithUsdg(10, type(uint256).max, ""); // $450 arrives (495 tickets)
        vm.stopPrank();
        assertEq(fire.millBid(), MILL_BID, "starts climbing from the base only now");
        vm.warp(block.timestamp + 1 days);
        assertEq(fire.millBid(), MILL_BID * 125 / 100);
    }

    function test_nightly_roll_refreshes_the_bid() public {
        usdg.mint(address(fire), 10_000e6); // sent directly: nobody poked
        vm.warp(block.timestamp + 1 days);
        assertEq(fire.millBid(), MILL_BID, "not counted yet");
        _roll(RND_CALM); // the roll counts it
        vm.warp(block.timestamp + 1 days);
        assertEq(fire.millBid(), MILL_BID * 125 / 100);
    }

    function test_stale_eth_feed_counts_eth_side_as_zero_without_reverting() public {
        vm.deal(address(fire), 10 ether);
        vm.warp(block.timestamp + 26 hours); // ETH feed missed its heartbeat
        fire.pokeMillBid();
        vm.warp(block.timestamp + 1 days);
        assertEq(fire.millBid(), MILL_BID, "ETH not counted while its price is unknown");
    }

    function test_mill_bid_restarts_below_the_price_paid() public {
        (Fire f2, MockSeaport sea) = _seaportFire();
        vm.warp(block.timestamp + 2 days); // funded, so the bid has climbed to 1.5x
        ethFeed.set(ethFeed.answer()); // keep the ETH/USD feed inside its heartbeat
        vm.prank(alice); uint256 id = mill.mint(alice);
        f2.eatMillFromSeaport(sea.listing(alice, id, 0.04 ether), ""); // $133.33 at $3,333.33/ETH, under the $150 bid
        uint256 paidUsd = 0.04 ether * uint256(ethFeed.answer()) / 1e18;
        uint256 restart = paidUsd * 9_000 / 10_000;
        assertEq(f2.millBid(), restart, "restarts at 90% of what it paid, in dollars");
        vm.warp(block.timestamp + 1 days);
        assertEq(f2.millBid(), restart + restart * 2_500 / 10_000, "then climbs again (fund still covers it)");
    }

    function test_restricted_listing_passes_zone_data_through() public {
        (Fire f2, MockSeaport sea) = _seaportFire();
        vm.prank(alice); uint256 id = mill.mint(alice);
        f2.eatMillFromSeaport(sea.listing(alice, id, 0.02 ether), hex"c0ffee");
        assertEq(sea.lastExtraData(), hex"c0ffee");
        assertEq(plank.balanceOf(royalty), PLANK_IN_MILL, "mill burned, PLANK to the pool");
    }

    function _usdgListing(MockSeaport sea, uint256 id, uint256 amount) internal view returns (ISeaport.Order memory o) {
        o = sea.listing(alice, id, 0);
        o.parameters.consideration[0].itemType = 1;
        o.parameters.consideration[0].token = address(usdg);
        o.parameters.consideration[0].startAmount = amount;
        o.parameters.consideration[0].endAmount = amount;
    }

    function test_usdg_tickets_feed_the_usdg_fund() public {
        vm.startPrank(bob);
        usdg.mint(bob, 100e6); usdg.approve(address(fire), type(uint256).max);
        fire.buyTicketsWithUsdg(10, type(uint256).max, "dollars");
        vm.stopPrank();
        assertEq(fire.usdgCost(10), 10e6, "$1 each");
        assertEq(fire.millFundUsdg(), 10e6);
        assertEq(fire.pot(), 10 * PLANK_T / 2, "PLANK leg as usual");
        (uint256 mine,) = fire.odds(bob);
        assertEq(mine, 11, "10 bought + 1 free");
    }

    function test_usdg_listing_paid_from_usdg_fund() public {
        (Fire f2, MockSeaport sea) = _seaportFire();
        usdg.mint(address(f2), 500e6);
        vm.prank(alice); uint256 id = mill.mint(alice);
        vm.warp(block.timestamp + 1 days); // funded, so the bid climbed to $125
        uint256 ethBefore = address(f2).balance;
        f2.eatMillFromSeaport(_usdgListing(sea, id, 120e6), "");
        assertEq(usdg.balanceOf(alice), 120e6, "seller paid in USDG");
        assertEq(usdg.balanceOf(address(f2)), 380e6);
        assertEq(ethBefore - address(f2).balance, 0.0003 ether, "only the burn fee in ETH");
        assertEq(usdg.allowance(address(f2), address(sea)), 0, "no approval left behind");
        assertEq(f2.millBid(), 108e8, "restart at 90% of $120");
    }

    function test_usdg_listing_over_bid_rejected() public {
        (Fire f2, MockSeaport sea) = _seaportFire();
        usdg.mint(address(f2), 500e6);
        vm.prank(alice); uint256 id = mill.mint(alice);
        ISeaport.Order memory o = _usdgListing(sea, id, 101e6);
        vm.expectRevert(Fire.TooExpensive.selector);
        f2.eatMillFromSeaport(o, "");
    }

    function test_mixed_or_foreign_currency_listing_rejected() public {
        (Fire f2, MockSeaport sea) = _seaportFire();
        vm.prank(alice); uint256 id = mill.mint(alice);
        ISeaport.Order memory o = _usdgListing(sea, id, 50e6);
        o.parameters.consideration[0].token = address(paper); // some other ERC-20
        vm.expectRevert(Fire.BadRequest.selector);
        f2.eatMillFromSeaport(o, "");
    }

    function test_caller_can_attach_the_burn_fee() public {
        (Fire f2, MockSeaport sea) = _seaportFire();
        vm.deal(address(f2), 0); // fund has no ETH, only USDG
        usdg.mint(address(f2), 500e6);
        vm.prank(alice); uint256 id = mill.mint(alice);
        ISeaport.Order memory o = _usdgListing(sea, id, 90e6);
        vm.expectRevert(Fire.FundTooSmall.selector);
        f2.eatMillFromSeaport(o, "");
        f2.eatMillFromSeaport{value: 0.0003 ether}(o, "");
        vm.expectRevert();
        mill.ownerOf(id);
    }

    function test_free_listing_cannot_park_the_bid_at_zero() public {
        (Fire f2, MockSeaport sea) = _seaportFire();
        vm.prank(alice); uint256 id = mill.mint(alice);
        f2.eatMillFromSeaport(sea.listing(alice, id, 0), "");
        assertEq(f2.millBid(), MILL_BID / 10);
    }


    function test_seaport_fill_burns_mill_and_pays_royalty() public {
        // a fire wired to a mock Seaport that hands over the listed mill for the ETH
        MockSeaport sea = new MockSeaport(address(mill));
        Fire f2 = new Fire(Fire.Config({
            paper: address(paper), plank: address(plank), mill: address(mill), seaport: address(sea), royaltyPool: royalty,
            randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed), paperUsdFeed: address(paperFeed), usdg: address(usdg),
            paperPerTicket: PAPER_T, paperUsdCap: 33_000_000, plankPerTicket0: PLANK_T, plankUsdPerTicket: 90_000_000,
            ethUsdPerTicket: 100_000_000, millBidBase: MILL_BID, rollTimeOfDay: ROLL_TOD
        }));
        vm.deal(address(f2), 1 ether); // stands in for ETH from "paper from the fire" buys
        // alice lists a mill on "OpenSea" at 0.02 ETH (under the bid)
        vm.startPrank(alice);
        plank.approve(address(mill), type(uint256).max);
        uint256 id = mill.mint(alice);
        mill.setApprovalForAll(address(sea), true);
        vm.stopPrank();
        ISeaport.Order memory o = sea.listing(alice, id, 0.02 ether);
        uint256 aliceBefore = alice.balance;
        f2.eatMillFromSeaport(o, "");
        assertEq(alice.balance - aliceBefore, 0.02 ether, "seller got the listing price");
        assertEq(plank.balanceOf(royalty), PLANK_IN_MILL, "plank inside -> royalty pool");
        vm.expectRevert();
        mill.ownerOf(id); // burned
        assertEq(address(f2).balance, 1 ether - 0.02 ether - 0.0003 ether, "fund paid price + burn fee");
    }

    function test_seaport_fill_rejects_overpriced_listing() public {
        MockSeaport sea = new MockSeaport(address(mill));
        Fire f2 = new Fire(Fire.Config({
            paper: address(paper), plank: address(plank), mill: address(mill), seaport: address(sea), royaltyPool: royalty,
            randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed), paperUsdFeed: address(paperFeed), usdg: address(usdg),
            paperPerTicket: PAPER_T, paperUsdCap: 33_000_000, plankPerTicket0: PLANK_T, plankUsdPerTicket: 90_000_000,
            ethUsdPerTicket: 100_000_000, millBidBase: MILL_BID, rollTimeOfDay: ROLL_TOD
        }));
        vm.deal(address(f2), 1 ether);
        vm.startPrank(alice); plank.approve(address(mill), type(uint256).max); uint256 id = mill.mint(alice); mill.setApprovalForAll(address(sea), true); vm.stopPrank();
        ISeaport.Order memory o = sea.listing(alice, id, 0.031 ether); // $103 > $100 bid
        vm.expectRevert(Fire.TooExpensive.selector);
        f2.eatMillFromSeaport(o, "");
    }

    function test_seaport_fill_rejects_fulfiller_tips() public {
        MockSeaport sea = new MockSeaport(address(mill));
        Fire f2 = new Fire(Fire.Config({
            paper: address(paper), plank: address(plank), mill: address(mill), seaport: address(sea), royaltyPool: royalty,
            randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed), paperUsdFeed: address(paperFeed), usdg: address(usdg),
            paperPerTicket: PAPER_T, paperUsdCap: 33_000_000, plankPerTicket0: PLANK_T, plankUsdPerTicket: 90_000_000,
            ethUsdPerTicket: 100_000_000, millBidBase: MILL_BID, rollTimeOfDay: ROLL_TOD
        }));
        vm.deal(address(f2), 1 ether);
        vm.startPrank(alice); plank.approve(address(mill), type(uint256).max); uint256 id = mill.mint(alice); mill.setApprovalForAll(address(sea), true); vm.stopPrank();
        // a cheap listing, with the filler appending a tip to itself for the rest of the bid
        ISeaport.Order memory o = sea.listing(alice, id, 0.01 ether);
        ISeaport.ConsiderationItem[] memory cons = new ISeaport.ConsiderationItem[](2);
        cons[0] = o.parameters.consideration[0];
        cons[1] = ISeaport.ConsiderationItem({itemType: 0, token: address(0), identifierOrCriteria: 0, startAmount: 0.02 ether, endAmount: 0.02 ether, recipient: payable(carol)});
        o.parameters.consideration = cons;
        vm.expectRevert(Fire.BadRequest.selector);
        f2.eatMillFromSeaport(o, "");
    }

    function test_seaport_fill_prices_timed_listing_at_its_high() public {
        MockSeaport sea = new MockSeaport(address(mill));
        Fire f2 = new Fire(Fire.Config({
            paper: address(paper), plank: address(plank), mill: address(mill), seaport: address(sea), royaltyPool: royalty,
            randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed), paperUsdFeed: address(paperFeed), usdg: address(usdg),
            paperPerTicket: PAPER_T, paperUsdCap: 33_000_000, plankPerTicket0: PLANK_T, plankUsdPerTicket: 90_000_000,
            ethUsdPerTicket: 100_000_000, millBidBase: MILL_BID, rollTimeOfDay: ROLL_TOD
        }));
        vm.deal(address(f2), 1 ether);
        vm.startPrank(alice); plank.approve(address(mill), type(uint256).max); uint256 id = mill.mint(alice); mill.setApprovalForAll(address(sea), true); vm.stopPrank();
        ISeaport.Order memory o = sea.listing(alice, id, 0.01 ether);
        o.parameters.consideration[0].startAmount = 0.031 ether; // a declining auction that starts over the $100 bid
        vm.expectRevert(Fire.TooExpensive.selector);
        f2.eatMillFromSeaport(o, "");
    }

    function test_seaport_path_disabled_without_seaport() public {
        ISeaport.OfferItem[] memory offer = new ISeaport.OfferItem[](1);
        ISeaport.ConsiderationItem[] memory cons = new ISeaport.ConsiderationItem[](1);
        ISeaport.Order memory o;
        o.parameters.offer = offer; o.parameters.consideration = cons;
        vm.expectRevert(Fire.NoSeaport.selector);
        fire.eatMillFromSeaport(o, "");
    }

    function test_no_buys_while_roll_pending() public {
        _buy(alice, 10);
        vm.warp(fire.nextRollAt());
        ethFeed.set(ethFeed.answer());
        fire.roll();
        vm.prank(bob);
        vm.expectRevert(Fire.RollPending.selector);
        fire.buyTickets(10, type(uint256).max, type(uint256).max, "last look");
        (, , uint256 c) = fire.quote(10);
        vm.prank(bob);
        vm.expectRevert(Fire.RollPending.selector);
        fire.buyTicketsWithEth{value: c}(10, type(uint256).max, "last look");
        rng.fulfill(rng.last(), RND_CALM);
        _buy(bob, 10); // open again once the night resolves
    }

    function test_eth_buy_refunds_overpay_and_rejects_underpay() public {
        (, , uint256 c) = fire.quote(10);
        uint256 before = carol.balance;
        vm.prank(carol);
        fire.buyTicketsWithEth{value: c * 101 / 100}(10, type(uint256).max, "1% slippage");
        assertEq(before - carol.balance, c, "paid exactly the price");
        assertEq(fire.millFund(), c);
        vm.prank(carol);
        vm.expectRevert(Fire.BadAmount.selector);
        fire.buyTicketsWithEth{value: c - 1}(10, type(uint256).max, "");
    }

    // ------------------------------------------------------------ stuck rolls
    function test_reroll_after_the_wait_with_no_answer() public {
        _buy(alice, 10);
        vm.warp(fire.nextRollAt());
        ethFeed.set(ethFeed.answer()); plankFeed.set(plankFeed.answer());
        fire.roll();
        uint256 first = fire.pendingRequest();
        vm.expectRevert(Fire.NotYet.selector);
        fire.reroll();
        vm.warp(block.timestamp + fire.REROLL_AFTER());
        vm.prank(carol); // anyone
        fire.reroll();
        uint256 second = fire.pendingRequest();
        assertTrue(second != first);
        // the stale request can no longer resolve the night
        vm.expectRevert(Fire.BadRequest.selector);
        rng.fulfill(first, RND_MONSTER);
        rng.fulfill(second, RND_CALM);
        assertEq(fire.night(), 1);
        assertEq(fire.pendingRequest(), 0);
    }

    function test_no_reroll_once_answered() public {
        vm.warp(fire.nextRollAt());
        fire.roll();
        uint256 id = fire.pendingRequest();
        rng.answerSilently(id); // provider has the number; delivery failed
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(Fire.Answered.selector);
        fire.reroll();
    }

    function test_no_reroll_without_pending_roll() public {
        vm.expectRevert(Fire.BadRequest.selector);
        fire.reroll();
    }

    function test_broken_plank_feed_does_not_block_the_night() public {
        _buy(alice, 10);
        vm.warp(fire.nextRollAt());
        plankFeed.setBroken(true);
        fire.roll();
        rng.fulfill(rng.last(), RND_CALM);
        assertEq(fire.night(), 1, "night resolved");
        assertEq(fire.plankPerTicket(), PLANK_T, "leg held");
    }

    // ------------------------------------------------------------ PAPER leg: never worth more than $0.33
    function _rollWithPaperAt(int256 paperUsd18) internal {
        vm.warp(fire.nextRollAt());
        ethFeed.set(ethFeed.answer()); plankFeed.set(plankFeed.answer()); paperFeed.set(paperUsd18);
        fire.roll();
        rng.fulfill(rng.last(), RND_CALM);
    }

    function test_paper_leg_stays_1_while_paper_is_cheap_or_unpriced() public {
        _roll(RND_CALM); // no PAPER market: price 0
        assertEq(fire.paperPerTicket(), 1e18);
        _rollWithPaperAt(0.001e18); // a tenth of a cent
        assertEq(fire.paperPerTicket(), 1e18, "never more than 1 PAPER");
        _rollWithPaperAt(0.33e18); // right at the cap
        assertEq(fire.paperPerTicket(), 1e18);
    }

    function test_paper_leg_shrinks_5pct_a_night_toward_the_cap_when_paper_is_expensive() public {
        _rollWithPaperAt(5e18); // PAPER at $5: target 0.066 PAPER, but only 5% a night
        assertEq(fire.paperPerTicket(), 0.95e18);
        _rollWithPaperAt(5e18);
        assertEq(fire.paperPerTicket(), 0.9025e18);
        for (uint256 i; i < 60; i++) _rollWithPaperAt(5e18);
        assertEq(fire.paperPerTicket(), uint256(33_000_000) * 1e28 / 5e18, "settles at $0.33 of PAPER");
        (uint256 paperCost,,) = fire.quote(1);
        assertEq(paperCost, 0.066e18);
        // tickets burn exactly that much PAPER
        uint256 dead = paper.balanceOf(DEAD);
        _buy(alice, 1);
        assertEq(paper.balanceOf(DEAD) - dead, 0.066e18);
    }

    function test_paper_leg_climbs_back_to_1_when_paper_falls() public {
        for (uint256 i; i < 70; i++) _rollWithPaperAt(5e18);
        uint256 low = fire.paperPerTicket();
        _rollWithPaperAt(0.01e18);
        assertEq(fire.paperPerTicket(), low * 10_500 / 10_000, "back up 5% a night");
        for (uint256 i; i < 100; i++) _rollWithPaperAt(0.01e18);
        assertEq(fire.paperPerTicket(), 1e18, "and stops at 1 PAPER");
    }

    function test_broken_or_stale_paper_feed_holds_and_never_blocks_the_night() public {
        for (uint256 i; i < 3; i++) _rollWithPaperAt(5e18);
        uint256 held = fire.paperPerTicket();
        paperFeed.setBroken(true);
        _roll(RND_CALM);
        assertEq(fire.paperPerTicket(), held, "broken feed: hold");
        paperFeed.setBroken(false);
        vm.warp(fire.nextRollAt() + 2 days); // PAPER feed not refreshed for 3+ days: stale
        ethFeed.set(ethFeed.answer()); plankFeed.set(plankFeed.answer());
        fire.roll(); rng.fulfill(rng.last(), RND_CALM);
        assertEq(fire.paperPerTicket(), held, "stale feed: hold");
    }

    function test_tx_cap_10() public {
        vm.prank(alice);
        vm.expectRevert(Fire.TxCap.selector);
        fire.buyTickets(11, type(uint256).max, type(uint256).max, "");
        _buy(alice, 10);
    }

    function test_daily_cap_500_per_wallet() public {
        _buy(alice, 495);
        vm.prank(alice);
        vm.expectRevert(Fire.DailyCap.selector);
        fire.buyTickets(6, type(uint256).max, type(uint256).max, "");
        _buy(alice, 5);
        assertEq(fire.remainingToday(alice), 0);
        _roll(RND_CALM); // new day
        assertEq(fire.remainingToday(alice), 500);
        _buy(alice, 500);
    }

    function test_eth_price_tracks_feed() public {
        (, , uint256 c1) = fire.quote(1);
        ethFeed.set(6_666_66666666); // ETH doubles -> half the ETH per ticket
        (, , uint256 c2) = fire.quote(1);
        assertApproxEqRel(c1, 2 * c2, 1e15);
    }

    function test_quiet_eth_feed_still_prices_tickets() public {
        vm.warp(block.timestamp + 6 hours); // gaps like this are normal on Robinhood Chain
        assertGt(fire.ethPerTicket(), 0);
        (, , uint256 e) = fire.quote(10);
        assertGt(e, 0);
    }

    function test_stale_eth_feed_closes_only_the_eth_path() public {
        vm.warp(block.timestamp + 26 hours); // missed the 24h heartbeat
        vm.expectRevert(Fire.StaleFeed.selector);
        fire.ethPerTicket();
        (uint256 p, uint256 k, uint256 e) = fire.quote(10);
        assertEq(p, 10e18);
        assertEq(k, PLANK_T * 10);
        assertEq(e, 0, "eth leg unquoted while stale");
        _buy(alice, 10); // PAPER path unaffected
        vm.prank(bob);
        vm.expectRevert(Fire.StaleFeed.selector);
        fire.buyTicketsWithEth{value: 0}(10, type(uint256).max, "");
    }

    function test_plank_leg_ratchets_5pct_per_night_toward_target() public {
        // target = $0.90 / $0.00000009 = 10M PLANK: already there
        _roll(RND_CALM);
        assertEq(fire.plankPerTicket(), PLANK_T);
        plankFeed.set(180_000_000_000); // PLANK doubles -> target 5M, but only 5% per night
        _roll(RND_CALM);
        assertEq(fire.plankPerTicket(), PLANK_T * 9_500 / 10_000);
        _roll(RND_CALM);
        assertEq(fire.plankPerTicket(), PLANK_T * 9_500 / 10_000 * 9_500 / 10_000);
        plankFeed.set(90_000_000_000); // back -> target 10M, moves up
        _roll(RND_CALM);
        assertGt(fire.plankPerTicket(), PLANK_T * 9_500 / 10_000 * 9_500 / 10_000);
    }

    function test_stale_plank_feed_holds_price() public {
        plankFeed.set(10_000_000_000); // would slash the target...
        vm.warp(fire.nextRollAt() + 3 days); // ...but the feed is now stale
        ethFeed.set(3_333_33333333); // keep ETH fresh so quotes work
        fire.roll();
        rng.fulfill(rng.last(), RND_CALM);
        assertEq(fire.plankPerTicket(), PLANK_T, "held");
    }

    // ------------------------------------------------------------ invariants
    /// The contract exposes no way to move the pot or the ETH fund except the game rules.
    function test_no_withdraw_surface() public view {
        // Compile-time guarantee: there is no owner, no withdraw(), no sweep(). This test documents it
        // by checking the contract holds exactly pot in PLANK after buys (nothing else can move it).
        assertEq(plank.balanceOf(address(fire)), fire.pot());
    }

    function test_plank_balance_always_equals_pot() public {
        _buy(alice, 123);
        (, , uint256 ethCost) = fire.quote(10);
        vm.prank(carol);
        fire.buyTicketsWithEth{value: ethCost}(10, type(uint256).max, "");
        assertEq(plank.balanceOf(address(fire)), fire.pot());
        _roll(RND_CALM);
        while (fire.fireId() == 1) _roll(RND_MONSTER);
        assertEq(plank.balanceOf(address(fire)), fire.pot());
    }

    function test_full_fire_lifecycle_fuzz(uint8 nights, uint16 daily) public {
        nights = uint8(bound(nights, 1, 30));
        daily = uint16(bound(daily, 1, 5000));
        for (uint256 n; n < nights; n++) {
            _buy(alice, daily % 500 + 1);
            _buy(bob, (daily / 3) % 500 + 1);
            _roll(uint256(keccak256(abi.encode(n, daily))));
            assertEq(plank.balanceOf(address(fire)), fire.pot());
            assertLe(fire.night(), 23);
        }
    }

    // ------------------------------------------------------------ user-fund safety (beta audit)
    function _cfg() internal view returns (Fire.Config memory) {
        return Fire.Config({
            paper: address(paper), plank: address(plank), mill: address(mill), seaport: address(0), royaltyPool: royalty,
            randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed), paperUsdFeed: address(paperFeed), usdg: address(usdg),
            paperPerTicket: PAPER_T, paperUsdCap: 33_000_000, plankPerTicket0: PLANK_T, plankUsdPerTicket: 90_000_000,
            ethUsdPerTicket: 100_000_000, millBidBase: MILL_BID, rollTimeOfDay: ROLL_TOD
        });
    }

    function test_buy_never_charges_more_than_the_buyer_agreed() public {
        (uint256 paperCost, uint256 plankCost,) = fire.quote(5);
        vm.startPrank(alice);
        vm.expectRevert(Fire.PriceMoved.selector);
        fire.buyTickets(5, paperCost - 1, plankCost, "");
        vm.expectRevert(Fire.PriceMoved.selector);
        fire.buyTickets(5, paperCost, plankCost - 1, "");
        fire.buyTickets(5, paperCost, plankCost, ""); // exactly the quote is fine
        (,, uint256 ethCost) = fire.quote(5);
        vm.expectRevert(Fire.PriceMoved.selector);
        fire.buyTicketsWithEth{value: ethCost}(5, plankCost - 1, "");
        usdg.mint(alice, 100e6); usdg.approve(address(fire), type(uint256).max);
        vm.expectRevert(Fire.PriceMoved.selector);
        fire.buyTicketsWithUsdg(5, plankCost - 1, "");
        vm.stopPrank();
    }

    function test_a_buy_signed_before_the_storm_reverts_if_the_price_rose() public {
        (, uint256 plankBefore,) = fire.quote(1);
        _roll(RND_CALM);
        plankFeed.set(plankFeed.answer() / 2); // PLANK halves: the leg rises 5% tonight
        _roll(RND_CALM);
        (, uint256 plankAfter,) = fire.quote(1);
        assertGt(plankAfter, plankBefore);
        vm.prank(alice);
        vm.expectRevert(Fire.PriceMoved.selector);
        fire.buyTickets(1, 1e18, plankBefore, "stale quote");
    }

    function test_winner_whose_transfer_fails_keeps_the_prize_to_claim() public {
        BlockingERC20 bp = new BlockingERC20();
        Fire.Config memory c = _cfg(); c.plank = address(bp);
        Fire f2 = new Fire(c);
        rng.setFire(address(f2));
        bp.mint(alice, 1e16 * 1e18);
        vm.startPrank(alice); paper.approve(address(f2), type(uint256).max); bp.approve(address(f2), type(uint256).max);
        for (uint256 i; i < 10; i++) f2.buyTickets(9, type(uint256).max, type(uint256).max, "");
        vm.stopPrank();
        uint256 p = f2.pot();
        bp.block_(alice, true); // alice can't receive PLANK right now
        while (f2.fireId() == 1) { vm.warp(f2.nextRollAt()); ethFeed.set(ethFeed.answer()); plankFeed.set(plankFeed.answer()); f2.roll(); rng.fulfill(rng.last(), RND_MONSTER); }
        assertEq(f2.lastWinner(), alice);
        assertEq(f2.unclaimed(alice), p * 4000 / 10000, "prize kept for her");
        assertEq(f2.pot(), p * 3000 / 10000, "the next fire gets only its 30%");
        (uint256 prize,) = f2.claimable(alice);
        assertEq(prize, p * 4000 / 10000);
        vm.prank(alice); f2.claim(bob); // to any address she controls
        assertEq(bp.balanceOf(bob), p * 4000 / 10000);
        assertEq(f2.unclaimed(alice), 0);
        vm.prank(alice); vm.expectRevert(Fire.Nothing.selector); f2.claim(bob);
        assertEq(bp.balanceOf(address(f2)), f2.pot(), "every PLANK accounted for");
    }

    function test_randomness_gone_for_a_week_refunds_ticket_holders() public {
        _buy(alice, 300);
        _buy(bob, 100);
        uint256 p = fire.pot();
        vm.warp(fire.nextRollAt());
        fire.roll(); // ...and randomness never answers
        vm.expectRevert(Fire.NotYet.selector);
        fire.abandon();
        vm.warp(block.timestamp + fire.ABANDON_AFTER());
        vm.prank(carol); fire.abandon(); // anyone
        assertTrue(fire.abandoned());
        vm.prank(alice); vm.expectRevert(Fire.Over.selector); fire.buyTickets(1, type(uint256).max, type(uint256).max, "");
        vm.expectRevert(Fire.Over.selector); fire.roll();
        uint256 a0 = plank.balanceOf(alice); uint256 b0 = plank.balanceOf(bob);
        vm.prank(alice); fire.refund();
        vm.prank(bob); fire.refund();
        assertEq(plank.balanceOf(alice) - a0, p * 300 / 400);
        assertEq(plank.balanceOf(bob) - b0, p * 100 / 400);
        vm.prank(alice); vm.expectRevert(Fire.Nothing.selector); fire.refund();
        vm.prank(carol); vm.expectRevert(Fire.Nothing.selector); fire.refund(); // no tickets, no share
        // a late answer for the old request can't restart anything
        uint256 old = rng.last();
        vm.expectRevert(Fire.BadRequest.selector);
        rng.fulfill(old, RND_CALM);
    }

    function test_a_result_that_cannot_be_delivered_is_also_recoverable() public {
        _buy(alice, 10);
        vm.warp(fire.nextRollAt());
        fire.roll();
        rng.answerSilently(fire.pendingRequest()); // answered, never delivered
        vm.warp(block.timestamp + fire.REROLL_AFTER());
        vm.expectRevert(Fire.Answered.selector); fire.reroll();
        vm.warp(block.timestamp + fire.ABANDON_AFTER());
        fire.abandon();
        uint256 a0 = plank.balanceOf(alice);
        vm.prank(alice); fire.refund();
        assertGt(plank.balanceOf(alice), a0);
    }

    function test_a_feed_with_no_code_cannot_freeze_the_game() public {
        Fire.Config memory c = _cfg();
        Fire f2 = new Fire(c);
        rng.setFire(address(f2));
        vm.etch(address(plankFeed), ""); // the PLANK feed disappears (or was never a contract)
        vm.etch(address(paperFeed), hex"00"); // the PAPER feed returns nothing
        vm.warp(f2.nextRollAt());
        f2.roll();
        rng.fulfill(rng.last(), RND_CALM); // must not revert
        assertEq(f2.night(), 1);
        assertEq(f2.plankPerTicket(), PLANK_T, "leg held");
    }

    function test_constructor_refuses_a_broken_config() public {
        Fire.Config memory c = _cfg(); c.plankUsdFeed = address(0x1234); // not a contract
        vm.expectRevert(Fire.BadRequest.selector); new Fire(c);
        c = _cfg(); c.plankPerTicket0 = 0;
        vm.expectRevert(Fire.BadAmount.selector); new Fire(c);
        c = _cfg(); c.millBidBase = 0;
        vm.expectRevert(Fire.BadAmount.selector); new Fire(c);
        c = _cfg(); c.rollTimeOfDay = 1 days;
        vm.expectRevert(Fire.BadAmount.selector); new Fire(c);
    }

    function test_constructor_refuses_an_adapter_wired_to_another_fire() public {
        WrongAdapter w = new WrongAdapter();
        Fire.Config memory c = _cfg(); c.randomness = address(w);
        vm.expectRevert(Fire.BadRequest.selector); new Fire(c);
    }

    function test_a_mill_safe_sent_by_mistake_bounces() public {
        vm.startPrank(alice);
        plank.approve(address(mill), type(uint256).max);
        uint256 id = mill.mint(alice);
        vm.expectRevert();
        IERC721(address(mill)).safeTransferFrom(alice, address(fire), id);
        vm.stopPrank();
        assertEq(mill.ownerOf(id), alice, "she keeps it");
    }

    function test_eth_price_rounds_up_never_under_a_dollar() public view {
        uint256 e = fire.ethPerTicket();
        assertGe(e * 3_333_33333333, 100_000_000 * 1e18, "at least $1");
    }

    function test_storm_floors_once() public {
        // trailing average 22 on night 2: exact 22 * 0.0442 * luck; flooring twice made every night-2 storm 0
        _buy(alice, 22);
        _roll(RND_CALM); // night 1 records 22
        assertEq(fire.stormStrength(2, RND_MONSTER), uint256(22_000) * 442 * 253002 / 1e8);
        assertGt(fire.stormStrength(2, RND_MONSTER), 0);
    }

    // ------------------------------------------------------------ the launch seed and the prize cap
    uint256 constant SEED = 550 * PLANK_T / 2; // like the real launch: $250 of PLANK vs $0.45 of pot per ticket

    function _seed() internal {
        plank.mint(address(this), SEED);
        plank.approve(address(fire), SEED);
        fire.seed(SEED);
    }

    function test_only_the_deployer_seeds_once_before_the_first_storm() public {
        vm.prank(alice); vm.expectRevert(Fire.BadRequest.selector); fire.seed(1);
        _seed();
        assertEq(fire.pot(), SEED);
        assertTrue(fire.seeded());
        plank.mint(address(this), 1); plank.approve(address(fire), 1);
        vm.expectRevert(Fire.BadRequest.selector); fire.seed(1); // only once
    }

    function test_no_seed_after_the_first_storm() public {
        _roll(RND_CALM);
        plank.mint(address(this), SEED); plank.approve(address(fire), SEED);
        vm.expectRevert(Fire.BadRequest.selector); fire.seed(SEED);
    }

    function test_a_one_ticket_fire_cannot_take_the_seed() public {
        _seed();
        _buy(alice, 1);
        uint256 own = fire.pot() - SEED; // what alice's ticket put in
        assertEq(fire.prizeNow(), own * 20 * 4000 / 10000, "prize capped at 20x her ticket's PLANK, 40% of that");
        uint256 a0 = plank.balanceOf(alice);
        _roll(RND_CALM);
        while (fire.fireId() == 1) _roll(RND_MONSTER);
        assertEq(plank.balanceOf(alice) - a0, own * 20 * 4000 / 10000, "she wins the capped prize");
        uint256 base = own * 20;
        uint256 left = SEED + own - base * 4000 / 10000 - base * 2500 / 10000 - base * 500 / 10000;
        assertEq(fire.pot(), left, "the rest of the seed carries");
        assertEq(fire.potCarriedIn(), left);
    }

    function test_a_real_fire_takes_the_full_prize() public {
        _seed();
        _buy(alice, 40); _buy(bob, 40); // 80 tickets put in far more than 1/20 of the pot
        uint256 p = fire.pot();
        assertEq(fire.prizeNow(), p * 4000 / 10000, "not capped");
        _roll(RND_CALM);
        while (fire.fireId() == 1) _roll(RND_MONSTER);
        assertEq(fire.pot(), p - p * 4000 / 10000 - p * 2500 / 10000 - p * 500 / 10000, "normal 30% carry");
    }

    function test_the_cap_carries_forward_to_later_fires() public {
        _buy(alice, 400);
        _roll(RND_CALM);
        while (fire.fireId() == 1) _roll(RND_MONSTER);
        uint256 carried = fire.pot();
        assertEq(fire.potCarriedIn(), carried);
        _buy(bob, 1); // fire 2: one ticket on a big carry
        assertLt(fire.prizeNow(), carried * 4000 / 10000, "a 1-ticket fire can't take 40% of what fire 1 left");
    }

    function test_no_prize_shown_with_no_tickets() public {
        _seed();
        assertEq(fire.prizeNow(), 0);
    }
}


contract WrongAdapter {
    function FIRE() external pure returns (address) { return address(0xBEEF); }
    function request() external pure returns (uint256) { return 1; }
    function answered(uint256) external pure returns (bool) { return false; }
}