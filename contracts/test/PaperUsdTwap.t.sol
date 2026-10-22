// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PaperUsdTwap} from "../src/PaperUsdTwap.sol";
import {MockFeed} from "./Mocks.sol";
import {MockPair} from "./PlankUsdTwap.t.sol";

contract MockFactory {
    mapping(address => mapping(address => address)) public pairs;
    function add(address a, address b, address p) external { pairs[a][b] = p; pairs[b][a] = p; }
    function getPair(address a, address b) external view returns (address) { return pairs[a][b]; }
}

contract PaperUsdTwapTest is Test {
    address paper = address(0xAA); address weth = address(0xBB); address usdg = address(0xCC); address plank = address(0xDD);
    MockFactory factory; MockFeed eth; MockFeed plankUsd; PaperUsdTwap twap;

    function setUp() public {
        vm.warp(1_800_000_000);
        factory = new MockFactory();
        eth = new MockFeed(2_500_00000000); // $2,500
        plankUsd = new MockFeed(1e9); // $0.000000001 per PLANK, 18 decimals
        twap = new PaperUsdTwap(address(factory), paper, weth, usdg, 6, address(eth), plank, address(plankUsd));
    }

    function _price() internal view returns (uint256) { (, int256 a,,,) = twap.latestRoundData(); return uint256(a); }
    function _day() internal {
        vm.warp(block.timestamp + 21 hours);
        eth.set(eth.answer());
        plankUsd.set(plankUsd.answer());
        twap.checkpoint();
    }

    function test_no_pool_reports_zero() public {
        twap.checkpoint(); _day(); _day();
        assertEq(address(twap.pair()), address(0));
        assertEq(_price(), 0);
    }

    /// @dev A pool that qualifies is recorded as the candidate, then adopted once it has qualified for a full window.
    function _adopt() internal { twap.checkpoint(); _day(); }

    function test_weth_pool_adopted_then_priced_after_a_window() public {
        MockPair p = new MockPair(paper, weth);
        p.set(1_000_000e18, 40e18); // 1M PAPER / 40 WETH -> $0.10 per PAPER ($100k of WETH)
        factory.add(paper, weth, address(p));
        twap.checkpoint();
        assertEq(twap.candidate(), address(p), "candidate first");
        assertEq(address(twap.pair()), address(0), "not adopted on sight");
        _day();
        assertEq(address(twap.pair()), address(p));
        assertEq(_price(), 0, "no price until a full window");
        _day();
        assertApproxEqRel(_price(), 0.1e18, 1e15);
    }

    function test_usdg_pool_priced_with_6_decimals() public {
        MockPair p = new MockPair(usdg, paper); // USDG is token0 here
        p.set(5_000e6, 1_000e18); // $5,000 / 1,000 PAPER -> $5 per PAPER
        factory.add(paper, usdg, address(p));
        _adopt(); _day();
        assertApproxEqRel(_price(), 5e18, 1e15);
    }

    function test_dust_pool_is_never_the_reference() public {
        MockPair tiny = new MockPair(paper, weth);
        tiny.set(1_000e18, 0.001e18); // $2.50 of WETH
        factory.add(paper, weth, address(tiny));
        _adopt(); _day();
        assertEq(address(twap.pair()), address(0), "under the liquidity floor");
        assertEq(_price(), 0);
    }

    function test_a_thin_real_pool_is_adopted() public {
        MockPair p = new MockPair(paper, weth);
        p.set(100_000e18, 0.01e18); // $25 of WETH, $0.00025 per PAPER
        factory.add(paper, weth, address(p));
        _adopt(); _day();
        assertEq(address(twap.pair()), address(p));
        assertApproxEqRel(_price(), 0.00025e18, 1e15);
    }

    function test_small_first_pool_is_replaced_by_the_real_market() public {
        MockPair small = new MockPair(paper, weth);
        small.set(1_000_000e18, 0.8e18); // $2,000 of WETH, $0.002 per PAPER
        factory.add(paper, weth, address(small));
        _adopt();
        assertEq(address(twap.pair()), address(small));
        MockPair real = new MockPair(paper, usdg);
        real.set(100_000e18, 20_000e6); // $20,000 of USDG, $0.20 per PAPER
        factory.add(paper, usdg, address(real));
        _adopt();
        assertEq(address(twap.pair()), address(real), "switched to the pool with the liquidity");
        assertApproxEqRel(_price(), 0.002e18, 1e15, "the old pool's last price holds until the new pool has a window");
        (,,, uint256 at,) = twap.latestRoundData();
        assertEq(at, twap.heldTs(), "dated when that window ended");
        _day();
        assertApproxEqRel(_price(), 0.2e18, 1e15);
    }

    function test_flash_liquidity_cannot_force_a_switch() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $10,000 of WETH
        factory.add(paper, weth, address(a));
        _adopt();
        MockPair b = new MockPair(paper, usdg);
        factory.add(paper, usdg, address(b));
        b.set(100_000e18, 1_000_000e6); // flash: $1M appears...
        twap.checkpoint();
        assertEq(twap.candidate(), address(b));
        b.set(100_000e18, 10e6); // ...and leaves in the same transaction
        assertTrue(twap.due(), "keeper sees the candidate stopped qualifying");
        twap.checkpoint();
        assertEq(twap.candidate(), address(0), "dropped");
        vm.warp(block.timestamp + 21 hours); eth.set(eth.answer()); plankUsd.set(plankUsd.answer());
        b.set(100_000e18, 1_000_000e6); // flash again a window later
        twap.checkpoint();
        assertEq(address(twap.pair()), address(a), "still the real pool: the clock restarted");
        assertEq(twap.candidate(), address(b));
    }

    /// A late PLANK price holds the switch but doesn't throw away a candidate's progress.
    function test_a_late_feed_keeps_the_candidate() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18);
        factory.add(paper, weth, address(a));
        _adopt();
        MockPair b = new MockPair(paper, usdg);
        b.set(100_000e18, 1_000_000e6); // $1M: a real contender
        factory.add(paper, usdg, address(b));
        twap.checkpoint();
        assertEq(twap.candidate(), address(b));
        vm.warp(block.timestamp + 3 hours); eth.set(eth.answer()); // the PLANK feed is now late: hold
        assertFalse(twap.due() && twap.candidate() == address(0));
        twap.checkpoint();
        assertEq(twap.candidate(), address(b), "kept through the hold");
    }

    function test_no_switch_while_the_eth_feed_is_stale() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18);
        factory.add(paper, weth, address(a));
        _adopt();
        MockPair b = new MockPair(paper, usdg);
        b.set(100_000e18, 1_000e6); // $1,000 of USDG: would win if WETH counted as $0
        factory.add(paper, usdg, address(b));
        vm.warp(block.timestamp + 26 hours); // ETH feed now stale
        twap.checkpoint();
        assertEq(twap.candidate(), address(0));
        vm.warp(block.timestamp + 21 hours); twap.checkpoint();
        assertEq(address(twap.pair()), address(a));
    }

    function test_a_slightly_bigger_pool_does_not_flip_the_reference() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $10,000 of WETH
        factory.add(paper, weth, address(a));
        _adopt(); _day();
        MockPair b = new MockPair(paper, usdg);
        b.set(100_000e18, 15_000e6); // $15,000: bigger, but not 2x
        factory.add(paper, usdg, address(b));
        _day(); _day();
        assertEq(address(twap.pair()), address(a));
    }

    function test_frequent_checkpoints_cannot_shorten_the_window() public {
        MockPair p = new MockPair(paper, weth);
        p.set(1_000_000e18, 40e18);
        factory.add(paper, weth, address(p));
        _adopt();
        vm.warp(block.timestamp + 1 hours); twap.checkpoint();
        assertEq(_price(), 0, "1h is not a window");
    }

    function test_due_only_when_there_is_work() public {
        assertFalse(twap.due(), "no pool: nothing to do");
        MockPair p = new MockPair(paper, weth);
        p.set(1_000_000e18, 40e18);
        factory.add(paper, weth, address(p));
        assertTrue(twap.due(), "a candidate to record");
        twap.checkpoint();
        assertFalse(twap.due(), "candidate waiting out its window");
        vm.warp(block.timestamp + 21 hours); eth.set(eth.answer()); plankUsd.set(plankUsd.answer());
        assertTrue(twap.due(), "candidate to adopt");
        twap.checkpoint();
        assertFalse(twap.due(), "just adopted");
        vm.warp(block.timestamp + 21 hours); eth.set(eth.answer()); plankUsd.set(plankUsd.answer());
        assertTrue(twap.due(), "window to roll");
    }

    /// Most PAPER liquidity sits against PLANK: that pool counts, valued (and priced) through the PLANK feed.
    function test_plank_pool_priced_through_the_plank_feed() public {
        MockPair p = new MockPair(paper, plank);
        // 1M PAPER / 80T PLANK at $1e-9 = $80,000 of PLANK -> 80M PLANK per PAPER -> $0.08 per PAPER
        p.set(1_000_000e18, 80_000_000_000_000e18);
        factory.add(paper, plank, address(p));
        _adopt();
        assertEq(address(twap.pair()), address(p));
        assertEq(twap.quote(), plank);
        _day();
        assertApproxEqRel(_price(), 0.08e18, 1e15);
        // while the PLANK feed is stale the price reads 0 (never a stale guess)
        vm.warp(block.timestamp + 3 hours);
        assertEq(_price(), 0);
    }

    function test_plank_pool_ignored_without_a_fresh_plank_price() public {
        MockPair p = new MockPair(paper, plank);
        p.set(1_000_000e18, 80_000_000_000_000e18);
        factory.add(paper, plank, address(p));
        vm.warp(block.timestamp + 3 hours); // PLANK feed stale: its pool is worth $0
        eth.set(eth.answer());
        twap.checkpoint();
        assertEq(twap.candidate(), address(0));
    }

    // ---------------------------------------------------------------- lopsided pools (pre-testnet audit M-2)

    /// $11 of USDG against 1 wei of PAPER clears the $10 floor but has no PAPER to trade: never a candidate.
    function test_lopsided_pool_is_never_the_reference() public {
        MockPair p = new MockPair(usdg, paper);
        p.set(11e6, 1);
        factory.add(paper, usdg, address(p));
        assertFalse(twap.due(), "nothing to record");
        _adopt(); _day();
        assertEq(twap.candidate(), address(0));
        assertEq(address(twap.pair()), address(0));
        assertEq(_price(), 0);
        p.set(1_000_000e6, 999e18); // deep dollars, but still under 1,000 PAPER
        _adopt(); _day();
        assertEq(address(twap.pair()), address(0), "under MIN_PAPER_RESERVE");
        p.set(11e6, 1_000e18); // $11 against 1,000 PAPER: a real (thin) pool
        _adopt();
        assertEq(address(twap.pair()), address(p), "qualifies at the minimum");
        _day();
        assertApproxEqRel(_price(), 0.011e18, 1e15);
    }

    /// A lopsided pool with the most dollars doesn't hide the real pool next to it.
    function test_lopsided_pool_does_not_mask_the_real_one() public {
        MockPair junk = new MockPair(paper, usdg);
        junk.set(1, 1_000_000e6);
        factory.add(paper, usdg, address(junk));
        MockPair real = new MockPair(paper, weth);
        real.set(100_000e18, 0.01e18); // $25 of WETH
        factory.add(paper, weth, address(real));
        _adopt(); _day();
        assertEq(address(twap.pair()), address(real));
        assertApproxEqRel(_price(), 0.00025e18, 1e15);
    }

    /// A candidate that goes lopsided is dropped like one that loses its dollars.
    function test_candidate_dropped_when_it_goes_lopsided() public {
        MockPair p = new MockPair(paper, weth);
        p.set(100_000e18, 4e18);
        factory.add(paper, weth, address(p));
        twap.checkpoint();
        assertEq(twap.candidate(), address(p));
        p.set(10e18, 4e18); // the PAPER side drains
        assertTrue(twap.due());
        twap.checkpoint();
        assertEq(twap.candidate(), address(0));
    }

    /// An adopted pool whose PAPER side drops under the minimum reads 0 (no price from a pool nobody can trade), and any
    /// real pool can take over; once it holds enough PAPER again its average reads normally.
    function test_adopted_pool_going_lopsided_reads_zero_and_is_replaced() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $0.10 per PAPER
        factory.add(paper, weth, address(a));
        _adopt(); _day();
        assertApproxEqRel(_price(), 0.1e18, 1e15);
        a.set(999e18, 0.04e18); // the LP pulls out: under 1,000 PAPER
        assertEq(_price(), 0, "no price while lopsided");
        a.set(100_000e18, 4e18);
        assertApproxEqRel(_price(), 0.1e18, 1e15, "back once it holds PAPER again");
        a.set(999e18, 0.04e18);
        MockPair b = new MockPair(paper, usdg);
        b.set(10_000e18, 20e6); // $20, any real pool: the lopsided one counts $0
        factory.add(paper, usdg, address(b));
        _adopt();
        assertEq(address(twap.pair()), address(b), "replaced");
        _day();
        assertApproxEqRel(_price(), 0.002e18, 1e15);
    }

    // ---------------------------------------------------------------- per-pool clocks (wallet audit, Oct 2026)

    function _feeds() internal { eth.set(eth.answer()); plankUsd.set(plankUsd.answer()); }

    /// The keeper: checkpoint whenever due, polled every `step` seconds for `span` seconds.
    function _keeper(uint256 span, uint256 step) internal {
        uint256 end = block.timestamp + span;
        while (block.timestamp < end) {
            vm.warp(block.timestamp + step); _feeds();
            if (twap.due()) twap.checkpoint();
        }
    }

    /// A pool that qualifies for an instant (a flash loan) every few hours can't reset the real pool's clock.
    function test_flash_pool_cannot_stall_the_first_adoption() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $10,000: the real market
        factory.add(paper, weth, address(a));
        MockPair b = new MockPair(paper, usdg);
        b.set(10_000e18, 1e6); // $1: too small to count
        factory.add(paper, usdg, address(b));
        twap.checkpoint();
        for (uint256 i; i < 4; i++) {
            _keeper(5 hours, 600);
            b.set(200_000e18, 20_000e6); // flash: $20,000 for one checkpoint...
            twap.checkpoint();
            b.set(10_000e18, 1e6); // ...gone again
        }
        _keeper(2 hours, 600);
        assertEq(address(twap.pair()), address(a), "the real pool, on time");
    }

    /// Two pools of about the same size whose order flips with trading still get one adopted.
    function test_two_similar_pools_still_adopt() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $10,000
        factory.add(paper, weth, address(a));
        MockPair b = new MockPair(paper, usdg);
        b.set(100_000e18, 9_900e6); // $9,900
        factory.add(paper, usdg, address(b));
        twap.checkpoint();
        for (uint256 i; i < 4; i++) {
            _keeper(5 hours, 600);
            if (i % 2 == 0) b.set(99_000e18, 10_100e6); else b.set(100_000e18, 9_900e6);
        }
        _keeper(1 hours, 600);
        assertTrue(address(twap.pair()) != address(0), "adopted");
        _keeper(21 hours, 600);
        assertGt(_price(), 0, "priced");
    }

    /// When several runs finish, the pool with the most liquidity all along wins: a flash at the deciding checkpoint
    /// can't crown a thin pool.
    function test_most_liquidity_all_along_wins_not_a_flash() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $10,000
        factory.add(paper, weth, address(a));
        MockPair b = new MockPair(paper, usdg);
        b.set(10_000e18, 20e6); // $20, thin but real
        factory.add(paper, usdg, address(b));
        twap.checkpoint();
        _keeper(20 hours - 600, 600);
        vm.warp(block.timestamp + 600); _feeds();
        b.set(10_000e18, 1_000_000e6); // flash $1M at the deciding checkpoint
        twap.checkpoint();
        assertEq(address(twap.pair()), address(a));
    }

    /// A pool whose liquidity drops 10% from its recorded least makes due() true, so the record follows it down.
    function test_run_least_liquidity_follows_the_pool_down() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $10,000
        factory.add(paper, weth, address(a));
        twap.checkpoint();
        assertFalse(twap.due());
        a.set(100_000e18, 3.8e18); // -5%: not worth a checkpoint
        assertFalse(twap.due());
        a.set(100_000e18, 3e18); // -25%
        assertTrue(twap.due());
        twap.checkpoint();
        (, uint32 since, uint256 least) = twap.runOf(0);
        assertGt(since, 0);
        assertEq(least, 7_500e8, "$7,500");
    }

    /// Moving the same capital between pools every 20 hours no longer turns the price off: each switch keeps
    /// serving the last full window's price (consumers still drop it once it's 2 days old).
    function test_switch_keeps_the_last_price() public {
        MockPair a = new MockPair(paper, weth);
        a.set(100_000e18, 4e18); // $10,000, $0.10 per PAPER
        factory.add(paper, weth, address(a));
        twap.checkpoint(); _keeper(21 hours, 600); _keeper(21 hours, 600);
        assertApproxEqRel(_price(), 0.1e18, 1e15);
        MockPair u = new MockPair(paper, usdg);
        factory.add(paper, usdg, address(u));
        u.set(250_000e18, 25_000e6); // someone parks $25,000: 2.5x the real pool
        _keeper(21 hours, 600);
        assertEq(address(twap.pair()), address(u), "a real takeover");
        u.set(1_000e18, 100e6); // and pulls it straight out
        _keeper(1 hours, 600);
        assertApproxEqRel(_price(), 0.1e18, 1e15, "the last full window's price still reads");
    }
}
