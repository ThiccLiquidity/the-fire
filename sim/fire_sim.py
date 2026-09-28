"""
The fire, night by night, exactly as Fire.sol runs it. The only input is how many tickets people buy each day.

Contract rules mirrored here (integer math, same order as Fire.onRandomness):
  - buys add to ticketsToday and to fireSizeMilli (the fire is measured in thousandths of a ticket)
  - at the roll: night += 1; storm = base * AGE[night] * LUCK[rnd & 31] / 1e8   (floored once, in thousandths)
      base = the storm's normal level (stormBaseMilli); before the first roll ever: today's buys x 1000
      AGE[night] = (night-1)/8; LUCK = 32 quantiles of lognormal(0, 1.2). night 1: no storm. night 24: infinite.
  - then today's count goes into the 7-night window, and the normal level moves toward that window's average
    (trailingMilli): up by 3% of the gap; down by 3%, or by 30% in a real slump (the week under half the level)
  - survive if night == 1 or (night < 24 and size > storm): size = (size - storm) * 8500 / 10000
  - otherwise it goes out: a new fire is lit with size 0, night 0 (the trailing window carries over). A fire nobody
    bought into carries its whole pot; otherwise 40% winner, 25% burned, 5% royalty pool, 30% carried.
On the site the storm "looks" (intensity) and the fire's drawn height use the site's formulas (web/src/data/types.ts).

Usage:
  python3 sim/fire_sim.py                 # every scenario, Monte Carlo, writes docs/fire-sim.md + sim/fire_sim_results.json
  python3 sim/fire_sim.py --pots          # the pot from a $250 seed over a year, per buying pattern
  python3 sim/fire_sim.py --difftest      # also writes contracts/test/FireSimParity.t.sol (the contract replays the same
                                           # nights and must match this file night for night)
"""
import json, math, random, statistics as st, sys, os

AGE = [1250 * (n - 1) for n in range(2, 24)]  # (night-1)/8 in bps, nights 2..23
LUCK = [754, 1338, 1824, 2286, 2744, 3211, 3691, 4192, 4717, 5272, 5862, 6491, 7166, 7894, 8682, 9541,
        10481, 11518, 12668, 13955, 15406, 17059, 18967, 21198, 23855, 27091, 31147, 36438, 43747, 54814, 74717, 132586]  # e^(1.2 z)
BASE_UP_BPS, BASE_DOWN_BPS, SLUMP_BPS = 300, 3000, 5000  # normal level: 3% of the gap a night; 30% down in a real slump (week under half of normal)
MAX_NIGHTS, KEEP_BPS, BPS, TRAILING, MILLI = 24, 8500, 10000, 7, 1000
FULL_DAYS = 2.5  # site: a fire worth 2.5 days of buys is drawn full height
INF = 2**256 - 1


def storm_look(storm, size):
    """0.15..1: how heavy the rain is drawn. Light for a storm that barely touched the fire, full for a near miss."""
    if size <= 0: return 1.0
    return max(0.15, min(1.0, 0.15 + 0.85 * (storm / size) ** 0.8))


class Fire:
    """State machine identical to the contract's fire state."""
    def __init__(self):
        self.night = 0; self.fire_size = 0; self.tickets_today = 0; self.tickets_total = 0
        self.trail = [0] * TRAILING; self.trail_count = 0; self.trail_idx = 0; self.fire_id = 1
        self.base = 0  # stormBaseMilli

    def storm_base(self):
        return self.tickets_today * MILLI if self.trail_count == 0 else self.base

    def trailing_milli(self):
        if self.trail_count == 0: return self.tickets_today * MILLI
        c = min(self.trail_count, TRAILING)
        return sum(self.trail[:c]) * MILLI // c

    def storm(self, n, luck_idx):
        if n >= MAX_NIGHTS: return INF
        if n <= 1: return 0
        return self.storm_base() * AGE[n - 2] * LUCK[luck_idx] // (BPS * BPS)

    def buy(self, t):
        self.tickets_today += t; self.tickets_total += t; self.fire_size += t * MILLI

    def roll(self, luck_idx):
        self.night += 1
        avg = self.trailing_milli()
        storm = self.storm(self.night, luck_idx)
        size_before = self.fire_size
        base = self.storm_base()
        today = self.tickets_today
        self.trail[self.trail_idx] = today; self.trail_idx = (self.trail_idx + 1) % TRAILING; self.trail_count += 1
        recent = self.trailing_milli()
        if recent >= base: self.base = base + (recent - base) * BASE_UP_BPS // BPS
        else: self.base = base - (base - recent) * (BASE_DOWN_BPS if recent * BPS < base * SLUMP_BPS else BASE_UP_BPS) // BPS
        self.tickets_today = 0
        rec = {"fire": self.fire_id, "night": self.night, "size": size_before, "storm": storm, "avg": avg, "today": today}  # sizes in thousandths
        if self.night == 1 or (self.night < MAX_NIGHTS and size_before > storm):
            self.fire_size = (size_before - storm) * KEEP_BPS // BPS
            rec.update(survived=True, after=self.fire_size)
        else:
            rec.update(survived=False, after=0, tickets=self.tickets_total)
            self.fire_id += 1; self.night = 0; self.fire_size = 0; self.tickets_total = 0
        # what the site shows (types.ts stormLook / drawnHeight): the rain is as heavy as the call was close, and the fire
        # is drawn against 2.5 days of buys
        rec["look"] = 1.0 if not rec["survived"] else storm_look(storm, size_before)
        rec["drawn"] = min(1.0, rec["after"] / (avg * FULL_DAYS)) if avg > 0 else 0.0
        return rec


def run(days, luck):
    f = Fire(); out = []
    for d, t in enumerate(days):
        f.buy(t); out.append(f.roll(luck[d]))
    return out


# ---------------------------------------------------------------- volume scenarios (tickets bought per day, all buyers)
def poisson(r, lam):
    if lam <= 0: return 0
    if lam > 50: return max(0, int(round(r.gauss(lam, math.sqrt(lam)))))
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= r.random()
        if p <= L: return k
        k += 1


def scenario(name, r, n):
    """Daily ticket counts for one simulated run of n days. Every scenario is only a volume pattern."""
    nz = lambda lam: poisson(r, lam)
    ln = lambda mean, s: nz(mean * math.exp(r.gauss(0, s) - s * s / 2))  # lognormal day-to-day swings, same mean
    k, arg = name.split(":") if ":" in name else (name, "")
    v = float(arg) if arg else 0
    if k == "flat": return [nz(v) for _ in range(n)]
    if k == "swingy": return [ln(v, 0.8) for _ in range(n)]
    if k == "weekends": return [nz(v * (2.0 if d % 7 in (5, 6) else 0.6)) for d in range(n)]
    if k == "growth": return [nz(10 * (100 ** (d / (n - 1)))) for d in range(n)]            # 10 -> 1,000 a day
    if k == "decline": return [nz(1000 * (0.01 ** (d / (n - 1)))) for d in range(n)]        # 1,000 -> 10 a day
    if k == "launch": return [nz(2000 if d < 7 else 50 + 1950 * math.exp(-(d - 7) / 20)) for d in range(n)]
    if k == "deaddays": return [0 if r.random() < 0.4 else nz(v / 0.6) for _ in range(n)]  # 40% of days nobody buys
    if k == "whales": return [nz(v) + (nz(20 * v) if r.random() < 0.05 else 0) for _ in range(n)]
    if k == "drought": return [0 if (d % 60) in range(40, 54) else nz(v) for d in range(n)]  # two quiet weeks every 2 months
    if k == "crash": return [nz(v) if d % 90 < 60 else nz(v / 20) for d in range(n)]        # volume drops 20x for a month
    raise ValueError(name)


SCENARIOS = [
    # (key, label)
    ("flat:0.3", "0.3 a day (a ticket every few days)"), ("flat:1", "1 a day"), ("flat:3", "3 a day"),
    ("flat:10", "10 a day"), ("flat:30", "30 a day"), ("flat:100", "100 a day"), ("flat:300", "300 a day"),
    ("flat:1000", "1,000 a day"), ("flat:3000", "3,000 a day"), ("flat:10000", "10,000 a day"),
    ("flat:100000", "100,000 a day"),
    ("swingy:5", "5 a day, very uneven days"), ("swingy:100", "100 a day, very uneven days"),
    ("swingy:5000", "5,000 a day, very uneven days"),
    ("weekends:100", "100 a day, busy weekends"), ("deaddays:20", "20 a day, 40% of days empty"),
    ("whales:50", "50 a day + a whale day (20x) 1 day in 20"), ("drought:200", "200 a day, 2 empty weeks every 2 months"),
    ("crash:500", "500 a day, drops 20x for a month every quarter"),
    ("growth", "Grows 10 -> 1,000 a day over the year"), ("decline", "Shrinks 1,000 -> 10 a day over the year"),
    ("launch", "Launch week 2,000 a day, settles to 50"),
]


def summarize(recs, days):
    fires = [x for x in recs if not x["survived"]]
    lives = [x["night"] for x in fires]
    nights = len(recs)
    s = {"fires_per_year": len(fires) / days * 365, "fires": len(fires)}
    if lives:
        s.update(mean_life=st.mean(lives), median_life=st.median(lives), max_life=max(lives),
                 died_n2=sum(l == 2 for l in lives) / len(lives), died_by3=sum(l <= 3 for l in lives) / len(lives),
                 reach10=sum(l >= 10 for l in lives) / len(lives), reach15=sum(l >= 15 for l in lives) / len(lives),
                 reach20=sum(l >= 20 for l in lives) / len(lives), hit24=sum(l == 24 for l in lives) / len(lives),
                 empty=sum(x["tickets"] == 0 for x in fires) / len(fires),
                 tickets_per_fire=st.mean(x["tickets"] for x in fires))
        hist = [0] * 25
        for l in lives: hist[l] += 1
        s["life_hist"] = [h / len(lives) for h in hist]
    storms = [x for x in recs if x["night"] >= 2 and x["survived"]] + [x for x in fires if x["night"] < 24]
    s["zero_storms"] = sum(x["storm"] == 0 for x in recs if 2 <= x["night"] < 24) / max(1, sum(2 <= x["night"] < 24 for x in recs))
    looks = [x["look"] for x in recs if 2 <= x["night"] and x["survived"]]
    s["look_mean"] = st.mean(looks) if looks else 0
    s["look_big"] = sum(l >= 0.7 for l in looks) / max(1, len(looks))
    s["look_tiny"] = sum(l <= 0.15 for l in looks) / max(1, len(looks))
    drawn = [x["drawn"] for x in recs if x["survived"] and x["night"] >= 2]
    s["drawn_mean"] = st.mean(drawn) if drawn else 0
    s["drawn_full"] = sum(d >= 0.99 for d in drawn) / max(1, len(drawn))
    return s


def monte_carlo(key, runs=150, days=365, seed=1):
    allrecs = []
    for i in range(runs):
        r = random.Random(hash((key, i, seed)) & 0xffffffff)
        d = scenario(key, r, days)
        luck = [r.randrange(32) for _ in range(days)]
        allrecs += run(d, luck)
    return summarize(allrecs, days * runs)


# ---------------------------------------------------------------- contract parity test
PARITY = [("flat:1", 70), ("flat:3", 70), ("swingy:5", 70), ("deaddays:20", 70), ("flat:25", 70), ("swingy:100", 70),
          ("drought:200", 70), ("whales:50", 70), ("launch", 40)]


PARITY_SEED = 10000  # wei; each parity ticket adds 2 wei of PLANK to the pot
PRIZE_CAP_MULT = 20


def pot_wei(recs, days_t, seed=PARITY_SEED):
    """The contract's pot, in wei, after each night (integer mirror of Fire._goOut with the prize cap)."""
    pot, carried, out = seed, seed, []
    for rec, t in zip(recs, days_t):
        pot += 2 * t
        if not rec["survived"]:
            if rec["tickets"] > 0:
                base = min(pot, PRIZE_CAP_MULT * (pot - carried))
                pot -= base * 4000 // 10000 + base * 2500 // 10000 + base * 500 // 10000
            carried = pot
        out.append(pot)
    return out


def write_parity_test(path):
    cases = []
    for i, (key, n) in enumerate(PARITY):
        r = random.Random(1000 + i)
        d = scenario(key, r, n)
        luck = [r.randrange(32) for _ in range(n)]
        recs = run(d, luck)
        cases.append((key, d, luck, recs))
    arr = lambda xs: "[" + ", ".join(f"uint256({x})" if j == 0 else str(x) for j, x in enumerate(xs)) + "]"
    body = []
    for i, (key, d, luck, recs) in enumerate(cases):
        n = len(d)
        body.append(f"""
    /// {key}: {n} nights, {sum(d)} tickets. Expected values come from sim/fire_sim.py.
    function test_parity_{i}_{key.replace(':', '_').replace('.', '_')}() public {{
        uint256[{n}] memory buys = {arr(d)};
        uint256[{n}] memory luck = {arr(luck)};
        uint256[{n}] memory storm = {arr([min(x["storm"], 2**255) if x["storm"] != INF else 0 for x in recs])};
        uint256[{n}] memory sizeAfter = {arr([x["after"] for x in recs])};
        uint256[{n}] memory fireId = {arr([x["fire"] + (0 if x["survived"] else 1) for x in recs])};
        uint256[{n}] memory pot = {arr(pot_wei(recs, d))};
        _seed();
        for (uint256 d; d < {n}; d++) {{
            _day(d, buys[d], luck[d], storm[d], sizeAfter[d], fireId[d]);
            assertEq(fire.pot(), pot[d], string.concat("pot, day ", vm.toString(d)));
        }}
    }}""")
    sol = f"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// GENERATED by sim/fire_sim.py --difftest. Do not edit by hand.
// The real Fire contract replays the simulator's nights (same daily buys, same storm luck, a launch seed) and must land
// on the same storm, the same fire size, the same fire and the same pot every night. If this passes, the simulation is
// the contract.

import {{Test}} from "forge-std/Test.sol";
import {{Fire}} from "../src/Fire.sol";
import {{MockERC20, MockUSDG, MockMill, MockRandomness, MockFeed}} from "./Mocks.sol";

contract FireSimParityTest is Test {{
    Fire fire; MockERC20 paper; MockERC20 plank; MockRandomness rng; MockFeed ethFeed; MockFeed plankFeed;
    uint256 nextWallet = 1;
    uint256 walletLeft; // tickets the current wallet can still buy today
    address wallet;

    function setUp() public {{
        vm.warp(1_800_000_000);
        paper = new MockERC20("PAPER", "PAPER"); plank = new MockERC20("PLANK", "PLANK");
        rng = new MockRandomness();
        ethFeed = new MockFeed(3_333_33333333); plankFeed = new MockFeed(90_000_000_000);
        fire = new Fire(Fire.Config({{
            paper: address(paper), plank: address(plank), mill: address(new MockMill(address(plank), 1)), seaport: address(0),
            royaltyPool: address(0xB0B), randomness: address(rng), ethUsdFeed: address(ethFeed), plankUsdFeed: address(plankFeed),
            paperUsdFeed: address(0), usdg: address(new MockUSDG()), paperPerTicket: 1, paperUsdCap: 33_000_000, plankPerTicket0: 2,
            plankUsdPerTicket: 90_000_000, ethUsdPerTicket: 100_000_000, millBidBase: 100e8, rollTimeOfDay: 3 hours
        }}));
        rng.setFire(address(fire));
    }}

    function _seed() internal {{
        plank.mint(address(this), {PARITY_SEED}); plank.approve(address(fire), {PARITY_SEED}); fire.seed({PARITY_SEED});
    }}

    /// Buy exactly t tickets today (9 at a time, a fresh wallet whenever one hits the daily cap), roll, check.
    function _day(uint256 d, uint256 t, uint256 luck, uint256 storm, uint256 afterSize, uint256 fireId) internal {{
        walletLeft = 0;
        while (t > 0) {{
            if (walletLeft == 0) {{
                wallet = address(uint160(0x10000 + nextWallet++));
                paper.mint(wallet, 1e30); plank.mint(wallet, 1e30);
                vm.startPrank(wallet); paper.approve(address(fire), type(uint256).max); plank.approve(address(fire), type(uint256).max); vm.stopPrank();
                walletLeft = 495; // 55 buys of 9
            }}
            uint256 k = t > 9 ? 9 : t;
            if (k > walletLeft) k = walletLeft;
            vm.prank(wallet); fire.buyTickets(k, type(uint256).max, type(uint256).max, "");
            t -= k; walletLeft -= k;
        }}
        vm.warp(fire.nextRollAt());
        ethFeed.set(ethFeed.answer()); plankFeed.set(plankFeed.answer());
        uint256 night = fire.night() + 1;
        uint256 expectStorm = night >= 24 ? type(uint256).max : storm;
        assertEq(fire.stormStrength(night, luck), expectStorm, string.concat("storm, day ", vm.toString(d)));
        fire.roll();
        rng.fulfill(rng.last(), luck);
        assertEq(fire.fireSizeMilli(), afterSize, string.concat("fire size, day ", vm.toString(d)));
        assertEq(fire.fireId(), fireId, string.concat("fire id (did it go out?), day ", vm.toString(d)));
    }}
{''.join(body)}
}}
"""
    open(path, "w").write(sol)
    return cases


# ---------------------------------------------------------------- report
def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if "--difftest" in sys.argv:
        cases = write_parity_test(os.path.join(root, "contracts/test/FireSimParity.t.sol"))
        print(f"wrote parity test: {len(cases)} scenarios, {sum(len(c[1]) for c in cases)} nights")
    res = {}
    for key, label in SCENARIOS:
        res[key] = dict(label=label, **monte_carlo(key))
        s = res[key]
        print(f"{label:52s} fires/yr {s['fires_per_year']:5.1f}  life {s.get('mean_life', 0):5.2f} (med {s.get('median_life', 0)})  "
              f"by3 {s.get('died_by3', 0):5.1%}  r10 {s.get('reach10', 0):5.1%}  r15 {s.get('reach15', 0):5.1%}  "
              f"max {s.get('max_life', 0):2d}  zero-storms {s['zero_storms']:5.1%}  empty {s.get('empty', 0):5.1%}  look {s['look_mean']:.2f}")
    json.dump(res, open(os.path.join(root, "sim/fire_sim_results.json"), "w"), indent=1)


if __name__ == "__main__" and "--pots" not in sys.argv:
    main()


# ---------------------------------------------------------------- the pot
# Each ticket's PLANK is $0.90 and all of it goes into the pot. A buy of 10 gets 11 tickets for 10 paid, and the free
# one adds no PLANK, so (conservatively) every buy is a 10-pack: the pot gets $0.90 x 10/11 per ticket. PLANK's price is
# held flat, so the pot is in today's dollars. When a fire with tickets goes out, the split is taken from the pot or from
# 20x what that fire's own tickets put in, whichever is smaller: 40% winner, 25% burned, 5% royalty pool, the rest
# carries. A fire nobody bought into carries 100%. The seed counts as carried-in pot.
POT_PER_TICKET = 0.90 * 10 / 11  # a log thrown on day 3+ (10 paid + 1 free)
def pot_per_log(night):  # night = nights the fire has survived when the log is thrown (0 = its first day)
    free = 3 if night == 0 else 2 if night == 1 else 1
    return 0.90 * 10 / (10 + free)
SEED = 250.0

POT_SCENARIOS = [
    ("flat:0", "Nobody ever buys"), ("oneweek", "1 ticket a week"), ("flat:1", "1 a day"), ("flat:3", "3 a day"),
    ("flat:10", "10 a day"), ("flat:30", "30 a day"), ("flat:100", "100 a day"), ("flat:300", "300 a day"),
    ("flat:1000", "1,000 a day"), ("flat:10000", "10,000 a day"),
    ("mixdays", "Mixed days: each day either 10 or 1,000"), ("mixweeks", "Mixed weeks: a quiet week (10/day), a busy week (1,000/day)"),
    ("mixmonths", "Mixed months: a dead month (0-2/day), then a busy month (500/day)"),
    ("launchfade", "Launch 1,000/day, fades to 5/day by month 4"), ("fadetozero", "Starts at 300/day, fades to nothing by month 6"),
    ("growth", "Grows 10 -> 1,000 a day over the year"), ("drought:200", "200 a day, 2 empty weeks every 2 months"),
]


def pot_scenario(key, r, n):
    nz = lambda lam: poisson(r, lam)
    if key == "oneweek": return [1 if d % 7 == 3 else 0 for d in range(n)]
    if key == "mixdays": return [nz(10 if r.random() < 0.5 else 1000) for _ in range(n)]
    if key == "mixweeks": return [nz(10 if (d // 7) % 2 == 0 else 1000) for d in range(n)]
    if key == "mixmonths": return [nz(r.choice([0, 0.5, 2])) if (d // 30) % 2 == 0 else nz(500) for d in range(n)]
    if key == "launchfade": return [nz(max(5, 1000 * math.exp(-d / 25))) for d in range(n)]
    if key == "fadetozero": return [nz(300 * max(0.0, 1 - d / 180) ** 2) for d in range(n)]
    if key == "flat:0": return [0] * n
    return scenario(key, r, n)


def pot_run(days_t, luck):
    """Nightly pot (after the roll) and one record per fire that went out."""
    f = Fire(); pot = SEED; carried = SEED; nightly = []; ends = []
    for d, t in enumerate(days_t):
        pot += t * pot_per_log(f.night); f.buy(t)
        rec = f.roll(luck[d])
        if not rec["survived"]:
            if rec["tickets"] > 0:
                base = min(pot, PRIZE_CAP_MULT * (pot - carried))  # a fire pays out on at most 20x what its tickets put in
                ends.append(dict(day=d, pot=pot, prize=base * 0.40, burned=base * 0.25, royalty=base * 0.05, tickets=rec["tickets"], nights=rec["night"], capped=base < pot))
                pot -= base * 0.70
            else:
                ends.append(dict(day=d, pot=pot, prize=0.0, burned=0.0, royalty=0.0, tickets=0, nights=rec["night"], capped=False))
            carried = pot
        nightly.append(pot)
    return nightly, ends


def pot_monte_carlo(key, runs=200, days=365):
    curves, ends = [], []
    for i in range(runs):
        r = random.Random(hash((key, "pot", i)) & 0xffffffff)
        d = pot_scenario(key, r, days); luck = [r.randrange(32) for _ in range(days)]
        c, e = pot_run(d, luck); curves.append(c); ends += [dict(x, run=i) for x in e]
    q = lambda xs, p: sorted(xs)[min(len(xs) - 1, int(p * len(xs)))]
    band = [(q([c[t] for c in curves], 0.1), q([c[t] for c in curves], 0.5), q([c[t] for c in curves], 0.9)) for t in range(days)]
    won = [x for x in ends if x["tickets"] > 0]
    tot = lambda k: sum(x[k] for x in ends) / runs
    added = sum(sum(pot_scenario(key, random.Random(hash((key, "pot", i)) & 0xffffffff), days)) for i in range(runs)) / runs * POT_PER_TICKET
    out = dict(band=band, fires_won=len(won) / runs,
               median_prize=q([x["prize"] for x in won], 0.5) if won else 0, top_prize=max((x["prize"] for x in won), default=0),
               median_pot_at_end=q([x["pot"] for x in won], 0.5) if won else 0,
               snipes=sum(1 for x in won if x["tickets"] <= 3) / runs,  # fires won with 3 or fewer tickets in them
               snipe_prize=q([x["prize"] for x in won if x["tickets"] <= 3], 0.5) if any(x["tickets"] <= 3 for x in won) else 0,
               paid=tot("prize"), burned=tot("burned"), royalty=tot("royalty"), added=added,
               below_seed=sum(1 for c in curves for v in c if v < SEED) / (runs * days))
    for t in (30, 90, 180, 364): out[f"d{t}"] = band[t]
    return out


def pots_main(root):
    res = {}
    for key, label in POT_SCENARIOS:
        s = pot_monte_carlo(key); s["label"] = label; res[key] = s
        print(f"{label:62s} pot day30 {s['d30'][1]:>8,.0f} day180 {s['d180'][1]:>8,.0f} day365 {s['d364'][1]:>8,.0f} (10-90%: {s['d364'][0]:,.0f}-{s['d364'][2]:,.0f})  "
              f"prize med {s['median_prize']:>7,.0f} top {s['top_prize']:>8,.0f}  fires won/yr {s['fires_won']:4.1f}  snipes/yr {s['snipes']:4.1f}  "
              f"in {s['added']:>9,.0f} paid {s['paid']:>9,.0f} burned {s['burned']:>8,.0f}  below seed {s['below_seed']:.0%}")
    json.dump(res, open(os.path.join(root, "sim/pot_sim_results.json"), "w"))
    return res


if __name__ == "__main__" and "--pots" in sys.argv:
    pots_main(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
