// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Fire, ISeaport} from "../src/Fire.sol";
import {MockERC20, MockMill, MockRandomness, MockFeed, MockSeaport} from "./Mocks.sol";

contract FireTest is Test {
    Fire fire;
    MockERC20 paper;
    MockERC20 plank;
    MockMill mill;
    MockRandomness rng;
    MockFeed ethFeed;
    MockFeed plankFeed;

    address royalty = address(0xB0B);
    address alice = address(0xA11CE);
    address bob = address(0xB0B2);
    address carol = address(0xCA201);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 constant PAPER_T = 1e18;
    uint256 constant PLANK_T = 10_000_000e18;
    uint256 constant ETH_T = 0.0003 ether; // $1 at $3,333/ETH (set below)
    uint256 constant MILL_BID = 0.03 ether;
    uint256 constant ROLL_TOD = 3 hours; // 8pm Phoenix
    uint256 constant PLANK_IN_MILL = 800_000_000e18;

    // rnd values that pick specific noise-table slots (low 4 bits)
    uint256 constant RND_CALM = 0; // luck 0.144x (gentlest of 32)
    uint256 constant RND_MONSTER = 31; // luck 6.95x (worst of 32)
    uint256 constant RND_MID = 16; // luck 1.036x

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new MockERC20("PAPER", "PAPER");
        plank = new MockERC20("PLANK", "PLANK");
        mill = new MockMill(address(plank), PLANK_IN_MILL);
        rng = new MockRandomness();
        ethFeed = new MockFeed(3_333_33333333); // $3,333.33 -> $1 = 0.0003 ETH
        plankFeed = new MockFeed(90_000_000_000); // $9e-8 per PLANK in 18-dec -> $0.90 for 10M PLANK
        fire = new Fire(Fire.Config({
            paper: address(paper), plank: address(plank), mill: address(mill), seaport: address(0), royaltyPool: royalty,
            randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed),
            paperPerTicket: PAPER_T, plankPerTicket0: PLANK_T, plankUsdPerTicket: 90_000_000 /* $0.90 */,
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
    function _buy(address who, uint256 n) internal {
        while (n > 0) {
            uint256 k = n > 10 ? 10 : n;
            vm.prank(who);
            fire.buyTickets(k, "gm");
            n -= k;
        }
    }
    function _buyEth(address who, uint256 n) internal {
        while (n > 0) {
            uint256 k = n > 10 ? 10 : n;
            (, , uint256 c) = fire.quote(k);
            vm.prank(who);
            fire.buyTicketsWithEth{value: c}(k, "");
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
    function test_quote_bundles() public view {
        (uint256 p1,, ) = fire.quote(1);
        (uint256 p5,,) = fire.quote(5);
        (uint256 p10,,) = fire.quote(10);
        assertEq(p1, 1e18);
        assertEq(p5, 5e18);
        assertEq(p10, 9.7e18);
    }

    function test_buy_burns_paper_splits_plank() public {
        uint256 deadPaper = paper.balanceOf(DEAD);
        uint256 deadPlank = plank.balanceOf(DEAD);
        _buy(alice, 10);
        assertEq(paper.balanceOf(DEAD) - deadPaper, 9.7e18, "paper 100% burned");
        assertEq(plank.balanceOf(DEAD) - deadPlank, 97 * PLANK_T / 20, "half plank burned");
        assertEq(fire.pot(), 97 * PLANK_T / 20, "half plank to pot");
        (uint256 mine, uint256 total) = fire.odds(alice);
        assertEq(mine, 10);
        assertEq(total, 10);
        assertEq(fire.ticketsToday(), 10);
    }

    function test_buy_with_eth_feeds_mill_fund() public {
        (, , uint256 ethCost) = fire.quote(10);
        assertApproxEqRel(ethCost, 9.7 * 0.0003 ether, 1e15, "$1 each at $3333/ETH, 3% off");
        vm.prank(bob);
        fire.buyTicketsWithEth{value: ethCost}(10, "outsider");
        assertEq(fire.millFund(), ethCost);
        (uint256 mine,) = fire.odds(bob);
        assertEq(mine, 10);
        assertEq(paper.balanceOf(DEAD), 0, "no paper involved");
    }

    function test_buy_with_wrong_eth_reverts() public {
        vm.prank(bob);
        vm.expectRevert(Fire.BadAmount.selector);
        fire.buyTicketsWithEth{value: 1}(1, "");
    }

    function test_stoke_no_tickets() public {
        vm.prank(carol);
        fire.stoke(1_000e18);
        assertEq(fire.pot(), 500e18);
        assertEq(fire.ticketsTotal(), 0);
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
        // night 2: base = 800 * ((2-1)/8)^1.5 = 800 * 0.0442 = 35.4; luck mid 1.036 -> 36
        assertEq(fire.stormStrength(2, RND_MID), 36);
        // night 9: base = 800 * 1.0 -> 800 * 1.036 = 828
        assertEq(fire.stormStrength(9, RND_MID), 828);
        // luck extremes
        assertEq(fire.stormStrength(9, RND_CALM), 115);
        assertEq(fire.stormStrength(9, RND_MONSTER), 5558);
        assertEq(fire.stormStrength(1, RND_MONSTER), 0, "night 1 no storm");
        assertEq(fire.stormStrength(24, RND_CALM), type(uint256).max, "night 24 infinite");
    }

    function test_fire_size_persists_and_burns_down() public {
        _buy(alice, 500);
        assertEq(fire.fireSize(), 500);
        _roll(RND_MID); // night 1: no storm; size = 500 * 0.6 = 300
        assertEq(fire.fireSize(), 300);
        _buy(bob, 200); // size 500
        // night 2 storm at mid luck = trail(500,200 -> avg 350) * 0.0442 * 1.036 = 16
        uint256 storm = fire.stormStrength(2, RND_MID);
        _roll(RND_MID);
        assertEq(fire.fireSize(), (500 - storm) * 6000 / 10000, "size minus storm, then 60%");
        assertEq(fire.fireId(), 1);
    }

    function test_small_fire_dies_to_big_storm_big_fire_survives() public {
        // build a trailing average of ~500/day over a few calm nights
        for (uint256 i; i < 4; i++) { _buy(alice, 500); _roll(RND_CALM); }
        // night 5: monster luck. base = 500*0.3536 = 177; x6.95 = 1229
        uint256 storm = fire.stormStrength(5, RND_MONSTER);
        assertGt(storm, 1000);
        // fire has ~500*0.6 + ... buffer; check it's below the storm -> dies
        uint256 size = fire.fireSize();
        _buy(carol, 10); // tiny top-up
        if (size + 10 <= storm) {
            _roll(RND_MONSTER);
            assertEq(fire.fireId(), 2, "small fire died");
        }
        // new fire: feed it hard for 4 nights, then a monster on night 5 should NOT kill it
        for (uint256 i; i < 4; i++) { _buy(alice, 500); _buy(bob, 500); _buy(carol, 500); _roll(RND_CALM); }
        uint256 before = fire.fireSize();
        uint256 storm2 = fire.stormStrength(5, RND_MONSTER);
        _buy(alice, 500); _buy(bob, 500); _buy(carol, 500);
        assertGt(before + 1500, storm2, "well-fed fire outweighs a monster night 5");
        uint256 id = fire.fireId();
        _roll(RND_MONSTER);
        assertEq(fire.fireId(), id, "survived");
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
    function test_payout_40_30_30_and_tithe() public {
        _buy(alice, 500); // alice is the only ticket holder
        uint256 p = fire.pot();
        _roll(RND_CALM); // night 1 survive; size 300
        uint256 deadBefore = plank.balanceOf(DEAD);
        uint256 aliceBefore = plank.balanceOf(alice);
        _roll(RND_MONSTER); // night 2 monster: 500*0.0442*6.95 = 153 < 300 ... need bigger. roll more.
        // keep rolling monsters until it dies
        while (fire.fireId() == 1) _roll(RND_MONSTER);
        uint256 winner = p * 4000 / 10000;
        uint256 tithe = winner * 500 / 10000;
        assertEq(plank.balanceOf(alice) - aliceBefore, winner - tithe, "winner 40% minus tithe");
        assertEq(plank.balanceOf(royalty), tithe, "tithe to royalty pool");
        assertEq(plank.balanceOf(DEAD) - deadBefore, p * 3000 / 10000, "30% burned");
        assertEq(fire.pot(), p - winner - p * 3000 / 10000, "30% carried");
        assertEq(fire.lastWinner(), alice);
        assertEq(fire.ticketsTotal(), 0, "tickets reset");
    }

    function test_no_tickets_at_all_rolls_winner_slice_forward() public {
        vm.prank(carol);
        fire.stoke(1_000e18); // pot 500, no tickets, size 0
        _roll(RND_CALM); // night 1 survives regardless
        _roll(RND_MONSTER); // size 0 -> goes out
        assertEq(fire.lastWinner(), address(0));
        assertEq(fire.pot(), 350e18, "40% + 30% carried");
        assertEq(plank.balanceOf(royalty), 0);
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
    function test_mill_bid_ratchets_and_resets() public {
        assertEq(fire.millBid(), MILL_BID);
        _roll(RND_CALM);
        assertEq(fire.millBid(), MILL_BID * 10500 / 10000);
        _roll(RND_CALM);
        assertEq(fire.millBid(), MILL_BID * 10500 / 10000 * 10500 / 10000);
    }

    function test_seaport_fill_burns_mill_and_pays_royalty() public {
        // a fire wired to a mock Seaport that hands over the listed mill for the ETH
        MockSeaport sea = new MockSeaport(address(mill));
        Fire f2 = new Fire(Fire.Config({
            paper: address(paper), plank: address(plank), mill: address(mill), seaport: address(sea), royaltyPool: royalty,
            randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed),
            paperPerTicket: PAPER_T, plankPerTicket0: PLANK_T, plankUsdPerTicket: 90_000_000,
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
        f2.eatMillFromSeaport(o);
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
            randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed),
            paperPerTicket: PAPER_T, plankPerTicket0: PLANK_T, plankUsdPerTicket: 90_000_000,
            ethUsdPerTicket: 100_000_000, millBidBase: MILL_BID, rollTimeOfDay: ROLL_TOD
        }));
        vm.deal(address(f2), 1 ether);
        vm.startPrank(alice); plank.approve(address(mill), type(uint256).max); uint256 id = mill.mint(alice); mill.setApprovalForAll(address(sea), true); vm.stopPrank();
        ISeaport.Order memory o = sea.listing(alice, id, MILL_BID + 1);
        vm.expectRevert(Fire.TooExpensive.selector);
        f2.eatMillFromSeaport(o);
    }

    function test_seaport_path_disabled_without_seaport() public {
        ISeaport.OfferItem[] memory offer = new ISeaport.OfferItem[](1);
        ISeaport.ConsiderationItem[] memory cons = new ISeaport.ConsiderationItem[](1);
        ISeaport.Order memory o;
        o.parameters.offer = offer; o.parameters.consideration = cons;
        vm.expectRevert(Fire.NoSeaport.selector);
        fire.eatMillFromSeaport(o);
    }

    function test_tx_cap_10() public {
        vm.prank(alice);
        vm.expectRevert(Fire.TxCap.selector);
        fire.buyTickets(11, "");
        _buy(alice, 10);
    }

    function test_daily_cap_500_per_wallet() public {
        _buy(alice, 495);
        vm.prank(alice);
        vm.expectRevert(Fire.DailyCap.selector);
        fire.buyTickets(6, "");
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

    function test_stale_eth_feed_reverts() public {
        vm.warp(block.timestamp + 2 hours);
        vm.expectRevert(Fire.StaleFeed.selector);
        fire.quote(1);
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
        vm.prank(bob);
        fire.stoke(777e18);
        (, , uint256 ethCost) = fire.quote(10);
        vm.prank(carol);
        fire.buyTicketsWithEth{value: ethCost}(10, "");
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
}
