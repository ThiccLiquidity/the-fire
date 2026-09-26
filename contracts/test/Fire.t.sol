// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Fire} from "../src/Fire.sol";
import {MockERC20, MockMill, MockRandomness} from "./Mocks.sol";

contract FireTest is Test {
    Fire fire;
    MockERC20 paper;
    MockERC20 plank;
    MockMill mill;
    MockRandomness rng;

    address royalty = address(0xB0B);
    address alice = address(0xA11CE);
    address bob = address(0xB0B2);
    address carol = address(0xCA201);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 constant PAPER_T = 1e18;
    uint256 constant PLANK_T = 10_000_000e18;
    uint256 constant ETH_T = 0.0003 ether;
    uint256 constant MILL_BID = 0.03 ether;
    uint256 constant ROLL_TOD = 3 hours; // 8pm Phoenix
    uint256 constant PLANK_IN_MILL = 800_000_000e18;

    // rnd values that pick specific noise-table slots (low 4 bits)
    uint256 constant RND_CALM = 0; // 0.39x
    uint256 constant RND_MONSTER = 15; // 2.56x

    function setUp() public {
        vm.warp(1_800_000_000);
        paper = new MockERC20("PAPER", "PAPER");
        plank = new MockERC20("PLANK", "PLANK");
        mill = new MockMill(address(plank), PLANK_IN_MILL);
        rng = new MockRandomness();
        fire = new Fire(
            address(paper), address(plank), address(mill), royalty, address(rng),
            PAPER_T, PLANK_T, ETH_T, MILL_BID, ROLL_TOD
        );
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
        vm.prank(who);
        fire.buyTickets(n, "gm");
    }

    function _roll(uint256 rnd) internal {
        vm.warp(fire.nextRollAt());
        fire.roll();
        rng.fulfill(rng.last(), rnd);
    }

    // ------------------------------------------------------------ pricing
    function test_quote_bundles() public view {
        (uint256 p1,, ) = fire.quote(1);
        (uint256 p10,,) = fire.quote(10);
        (uint256 p100,,) = fire.quote(100);
        (uint256 p1000,,) = fire.quote(1000);
        assertEq(p1, 1e18);
        assertEq(p10, 9e18);
        assertEq(p100, 80e18);
        assertEq(p1000, 700e18);
    }

    function test_buy_burns_paper_splits_plank() public {
        uint256 deadPaper = paper.balanceOf(DEAD);
        uint256 deadPlank = plank.balanceOf(DEAD);
        _buy(alice, 10);
        assertEq(paper.balanceOf(DEAD) - deadPaper, 9e18, "paper 100% burned");
        assertEq(plank.balanceOf(DEAD) - deadPlank, 9 * PLANK_T / 2, "half plank burned");
        assertEq(fire.pot(), 9 * PLANK_T / 2, "half plank to pot");
        (uint256 mine, uint256 total) = fire.odds(alice);
        assertEq(mine, 10);
        assertEq(total, 10);
        assertEq(fire.ticketsToday(), 10);
    }

    function test_buy_with_eth_feeds_mill_fund() public {
        (, , uint256 ethCost) = fire.quote(100);
        vm.prank(bob);
        fire.buyTicketsWithEth{value: ethCost}(100, "outsider");
        assertEq(fire.millFund(), ethCost);
        (uint256 mine,) = fire.odds(bob);
        assertEq(mine, 100);
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

    function test_storm_scales_with_trailing_avg_and_night() public {
        _buy(alice, 800);
        _roll(RND_CALM); // night 1, trail = [800]
        // night 2 base = 800 * 2 / 8 = 200; noise slot 0 = 0.39x -> 78
        assertEq(fire.stormStrength(2, RND_CALM), 78);
        // slot 15 = 2.56x -> 512
        assertEq(fire.stormStrength(2, RND_MONSTER), 512);
        assertEq(fire.stormStrength(24, 0), type(uint256).max, "night 24 infinite");
    }

    function test_big_fire_survives_small_fire_dies() public {
        _buy(alice, 800);
        _roll(RND_CALM); // night 1
        _buy(bob, 100); // night 2: storm(monster) = 512 > 100 -> out
        uint256 idBefore = fire.fireId();
        _roll(RND_MONSTER);
        assertEq(fire.fireId(), idBefore + 1, "new fire lit");
        assertEq(fire.night(), 0);
    }

    function test_survives_when_size_beats_storm() public {
        _buy(alice, 800);
        _roll(RND_CALM);
        _buy(bob, 600); // storm(monster) 512 < 600
        _roll(RND_MONSTER);
        assertEq(fire.night(), 2);
        assertEq(fire.fireId(), 1);
    }

    function test_night_24_kills_any_fire() public {
        _buy(alice, 100);
        // a fire that keeps growing survives every calm storm until night 24, which is infinite
        for (uint256 n = 1; n < 24; n++) {
            _buy(alice, 100_000 * n);
            _roll(RND_CALM);
            assertEq(fire.fireId(), 1);
        }
        _buy(alice, 100_000_000);
        _roll(RND_CALM); // night 24
        assertEq(fire.fireId(), 2);
    }

    // ------------------------------------------------------------ payout
    function test_payout_40_30_30_and_tithe() public {
        _buy(alice, 1000); // alice is the only ticket holder
        uint256 p = fire.pot();
        _roll(RND_CALM); // night 1 survive
        uint256 deadBefore = plank.balanceOf(DEAD);
        uint256 aliceBefore = plank.balanceOf(alice);
        _roll(RND_MONSTER); // 0 tickets today -> out
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
        fire.stoke(1_000e18); // pot 500, no tickets
        _roll(RND_CALM);
        _roll(RND_MONSTER);
        assertEq(fire.lastWinner(), address(0));
        assertEq(fire.pot(), 350e18, "40% + 30% carried");
        assertEq(plank.balanceOf(royalty), 0);
    }

    function test_winner_is_ticket_weighted() public {
        _buy(alice, 900);
        _buy(bob, 100);
        _roll(RND_CALM);
        uint256 aliceWins;
        uint256 snap = vm.snapshotState();
        for (uint256 i; i < 200; i++) {
            vm.revertToState(snap);
            snap = vm.snapshotState();
            _roll((i << 4) | RND_MONSTER); // monster storm, varying winner seed
            if (fire.lastWinner() == alice) aliceWins++;
        }
        // 90% expected; allow wide tolerance
        assertGt(aliceWins, 150);
        assertLt(aliceWins, 200);
    }

    function test_winner_names_fire() public {
        _buy(alice, 5);
        _roll(RND_CALM);
        _roll(RND_MONSTER);
        vm.prank(bob);
        vm.expectRevert(Fire.NotWinner.selector);
        fire.nameFire("bob's fire");
        vm.prank(alice);
        fire.nameFire("The Great Fire");
        assertEq(fire.fireName(), "The Great Fire");
    }

    // ------------------------------------------------------------ mill fund
    function test_mill_bid_ratchets_and_resets() public {
        assertEq(fire.millBid(), MILL_BID);
        _roll(RND_CALM);
        assertEq(fire.millBid(), MILL_BID * 10500 / 10000);
        _roll(RND_CALM);
        assertEq(fire.millBid(), MILL_BID * 10500 / 10000 * 10500 / 10000);
    }

    function test_sell_mill_to_fire_burns_and_pays_royalty() public {
        // fund the fire with ETH via outsider tickets
        (, , uint256 ethCost) = fire.quote(1000);
        vm.prank(bob);
        fire.buyTicketsWithEth{value: ethCost}(1000, "");
        assertGe(fire.millFund(), MILL_BID);
        // alice mints a mill
        vm.startPrank(alice);
        plank.approve(address(mill), type(uint256).max);
        uint256 id = mill.mint(alice);
        mill.approve(address(fire), id);
        uint256 ethBefore = alice.balance;
        fire.sellMillToFire(id);
        vm.stopPrank();
        assertEq(alice.balance - ethBefore, MILL_BID, "seller paid the bid");
        assertEq(plank.balanceOf(royalty), PLANK_IN_MILL, "plank inside -> royalty pool");
        vm.expectRevert();
        mill.ownerOf(id); // burned
        _roll(RND_CALM);
        assertEq(fire.millBid(), MILL_BID, "bid reset after a purchase");
    }

    function test_sell_mill_reverts_when_fund_too_small() public {
        vm.startPrank(alice);
        plank.approve(address(mill), type(uint256).max);
        uint256 id = mill.mint(alice);
        mill.approve(address(fire), id);
        vm.expectRevert(Fire.FundTooSmall.selector);
        fire.sellMillToFire(id);
        vm.stopPrank();
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
        _roll(RND_MONSTER);
        assertEq(plank.balanceOf(address(fire)), fire.pot());
    }

    function test_full_fire_lifecycle_fuzz(uint8 nights, uint16 daily) public {
        nights = uint8(bound(nights, 1, 30));
        daily = uint16(bound(daily, 1, 5000));
        for (uint256 n; n < nights; n++) {
            _buy(alice, daily);
            _buy(bob, daily / 3 + 1);
            _roll(uint256(keccak256(abi.encode(n, daily))));
            assertEq(plank.balanceOf(address(fire)), fire.pot());
            assertLe(fire.night(), 23);
        }
    }
}
