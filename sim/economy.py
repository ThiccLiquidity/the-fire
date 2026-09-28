"""
The Fire — full economy simulation (v3 rules, matched to contracts/src/Fire.sol).

Everything on the site and in the contract, day by day, per wallet, vectorized:

  Mills → PAPER emission (1/mill/day) → wallets accumulate PAPER (claimed), sell some, buy tickets
  Ticket = PAPER leg + $0.90 PLANK (or $1.00 ETH/USDG + $0.90 PLANK for outsiders); max 10 paid per buy;
    buy 10, get 1 free; 500 tickets *received* per wallet per day (the free ones count)
  PAPER leg = min(1 PAPER, $0.33 worth), ratcheting at most 5% a night toward that
  PAPER burned 100%; PLANK 50% burned / 50% pot; ETH/USDG 100% → mill fund
  Storm (integers, as the contract): floor(trail7 × ageBps[n] × luckBps[rnd & 31] / 1e8), where trail7 is the
    floored average of the last 7 nights' tickets — today's buys not included. Size -= storm; ×0.6 overnight (floored).
  Night 1 no storm; night 24 infinite. Dead → one ticket wins 40%, 25% burned, 5% to the royalty pool, 30% carried.
  Mill bid (USD): starts at MILL_BID_BASE, climbs 25% of its start per day while the fund can pay it, capped at 3×
    its start and at the fund's value; after a purchase it restarts at 90% of the price paid (floor base/10).
    The keeper sweeps the floor listing whenever bid ≥ floor and the fund can pay floor + burn fee (checked hourly).
  Mill burned; its PLANK → royalty pool; emission -1/day forever. Royalty pool splits evenly across live mills.

Prices are held fixed — this sim is about flows, not price. PLANK $1.056e-9 (Uniswap V2 pair: ~28.1 WETH / 88.7T
PLANK at $3,333/ETH, Sep 27 2026), ETH $3,333, PAPER a scenario input.

  python3 economy.py            full grid (4 mill counts × 3 participation × 3 outsider rates × 3 floors × 3 seeds)
  python3 economy.py --quick    smaller grid
  python3 economy.py --paper    PAPER price scenarios
Writes economy_results.csv (or paper_results.csv) in the current directory.
"""
from __future__ import annotations
import numpy as np, itertools, csv, sys, time
from dataclasses import dataclass, asdict

ETH_USD = 3333.0
PLANK_USD = 28.1 * ETH_USD / 88.7e12          # ≈ $1.056e-9
PLANK_SUPPLY = 888_420_069_420_888            # PLANK total supply
PLANK_PER_MILL = 88_842_006_942               # plankPerNFT (= supply / 10,000), ≈ $94 at this price
MILL_BURN_FEE_USD = 0.0003 * ETH_USD          # Plank Press burnFee, paid in ETH by the fund
PLANK_LEG_USD = 0.90
ETH_LEG_USD = 1.00
TX_CAP, DAY_CAP = 10, 500
MAX_PAID_PER_DAY = 455                        # 455 paid = 45 full buys (495) + 5 → exactly 500 received
KEEP_BPS = 6000
PAPER_USD_CAP = 0.33                          # Fire.PAPER_USD_CAP
RATCHET = 0.05                                # legs move ≤5% a night
BID_RISE_PER_DAY, BID_RESTART, BID_MAX_MULT = 0.25, 0.90, 3
# Fire._ageBps: ((n-1)/8)^1.5 in bps for n = 2..23
AGE_BPS = [442, 1250, 2296, 3536, 4941, 6495, 8185, 10000, 11932, 13975, 16123,
           18371, 20715, 23150, 25674, 28284, 30977, 33750, 36601, 39528, 42530, 45604]
# Fire._luckBps: 32-point quantile table of e^(0.9 z)
LUCK_BPS = [395, 810, 1192, 1581, 1986, 2417, 2877, 3373, 3910, 4493, 5129, 5826, 6593, 7440, 8381, 9429,
            10605, 11932, 13440, 15167, 17163, 19496, 22258, 25578, 29647, 34756, 41378, 50343, 63268, 83871, 123531, 253002]  # e^(1.5 z)

@dataclass
class Scenario:
    mills: int = 1000
    participation: str = "med"     # low / med / high
    outsiders_per_day: float = 5   # ETH/USDG ticket buyers per day (Poisson)
    mill_floor_usd: float = 300.0  # price of the cheapest mill listing
    mill_bid_base: float = 0.0     # MILL_BID_BASE; 0 = 85% of the floor
    paper_usd: float = 0.25        # PAPER's market price; above PAPER_USD_CAP a ticket takes less than 1 PAPER
    # When PAPER is worth more than the cap, a ticket needs less of it. "tickets": holders buy as many tickets as they
    # would anyway and keep the PAPER they save (conservative). "paper": they burn as much PAPER as before and so buy
    # more tickets (optimistic; needs proportionally more PLANK).
    paper_demand: str = "tickets"
    days: int = 365
    seed: int = 0
    rally: bool = True

PART = {  # fraction of daily PAPER a wallet tends to spend on tickets, by tier
    "low":  dict(whale=0.25, mid=0.18, small=0.10, sell=0.5),
    "med":  dict(whale=0.50, mid=0.40, small=0.30, sell=0.3),
    "high": dict(whale=0.75, mid=0.65, small=0.55, sell=0.15),
}

def make_wallets(mills, rng):
    tiers, counts = [], []
    rem = mills
    for _ in range(max(2, mills // 400)):
        m = min(int(rng.integers(40, 120)), max(1, rem - 100)); tiers.append(0); counts.append(m); rem -= m
    for _ in range(max(5, mills // 60)):
        m = min(int(rng.integers(8, 30)), max(1, rem - 50)); tiers.append(1); counts.append(m); rem -= m
    while rem > 0:
        m = min(int(rng.choice([1, 1, 1, 2, 2, 3, 4, 5])), rem); tiers.append(2); counts.append(m); rem -= m
    return np.array(tiers), np.array(counts, dtype=float)

def storm(trail_avg: int, night: int, luck_idx: int) -> float:
    if night >= 24: return float("inf")
    if night <= 1: return 0
    return trail_avg * AGE_BPS[night - 2] * LUCK_BPS[luck_idx] // (10_000 * 10_000)

def run(sc: Scenario) -> dict:
    rng = np.random.default_rng(sc.seed)
    tier, mills_of = make_wallets(sc.mills, rng)
    n = len(tier)
    pp = PART[sc.participation]
    spend = np.where(tier == 0, pp["whale"], np.where(tier == 1, pp["mid"], pp["small"])) * rng.lognormal(0, 0.4, n)
    spend = np.clip(spend, 0.02, 0.95)
    rally_frac = np.clip(np.where(tier == 0, 0.5, np.where(tier == 1, 0.4, 0.3)) * rng.lognormal(0, 0.4, n), 0, 0.9)
    paper = np.zeros(n)                       # PAPER held (claimed, unspent)
    won_usd = np.zeros(n); spent_usd = np.zeros(n); tickets_bought = np.zeros(n)

    # game state
    fire_size = 0; night = 0; pot_plank = 0.0; fire_id = 1
    trail: list[int] = []
    ppt = 1.0                                 # PAPER per ticket (Fire.paperPerTicket), starts at 1 PAPER
    ppt_target = min(1.0, PAPER_USD_CAP / sc.paper_usd)
    # mill fund (USD; ETH and USDG sides lumped together) and the bid, time in days
    fund = 0.0; mills_eaten = 0; royalty_plank = 0.0
    base = sc.mill_bid_base or sc.mill_floor_usd * 0.85
    bid_start = base; bid_banked = base; bid_since = 0.0; fund_at = 0.0
    def bid_now(t):
        if fund_at <= bid_banked: return bid_banked
        ceiling = min(fund_at, bid_start * BID_MAX_MULT)
        b = bid_banked + bid_start * BID_RISE_PER_DAY * (t - bid_since)
        return b if b <= ceiling else max(ceiling, bid_banked)
    def poke(t):
        nonlocal bid_banked, bid_since, fund_at
        bid_banked = bid_now(t); bid_since = t; fund_at = fund
    # tallies
    T = dict(emitted=0.0, paper_burned=0.0, paper_sold=0.0, plank_in=0.0, plank_burned=0.0, plank_paid=0.0,
             eth_in=0.0, outsider_tickets=0.0, holder_tickets=0.0, cap_hits=0, tx_count=0.0)
    fires = []  # (nights, pot_usd, winner_tier, tickets_in_fire)
    fire_ticket_owner = np.zeros(n)  # tickets per wallet this fire
    outsider_tickets_fire = 0
    daily = []; ppt_days = 0

    for d in range(sc.days):
        night += 1
        live_mills = mills_of.sum()
        # --- emission
        mint = mills_of.copy(); paper += mint; T["emitted"] += mint.sum()
        # --- decide buys: fraction of held paper, plus rally when the fire looks in danger
        r = float(np.mean(trail[-7:])) if trail else max(1.0, live_mills * 0.3)
        # spend a share of today's fresh PAPER, plus a 10%/day trickle of the stockpile
        want = mint * spend + (paper - mint) * spend * 0.10
        if sc.rally and night > 1:
            danger = r * ((night) / 8) ** 1.5
            if fire_size / 1000 < danger:
                want += paper * rally_frac * 0.5 * min(1.5, (danger - fire_size / 1000) / max(1, danger))
        want = np.minimum(want, paper)
        if sc.paper_demand == "paper": want = want / ppt  # same PAPER burned buys more tickets
        # PLANK leg: assume holders buy the PLANK they need (it's $0.90/ticket) — no PLANK balance constraint
        tix = np.floor(want)                                       # tickets paid for
        capped = tix > MAX_PAID_PER_DAY; T["cap_hits"] += capped.sum(); tix = np.minimum(tix, MAX_PAID_PER_DAY)
        # buy 10, get 1 free: every full 10 paid for brings a free 11th ticket (no PAPER or PLANK for it)
        full_tens = np.floor(tix / TX_CAP); rest = tix - full_tens * TX_CAP
        paper_cost = tix * ppt
        plank_cost_usd = tix * PLANK_LEG_USD
        T["tx_count"] += (full_tens + (rest > 0)).sum()
        spent_usd += paper_cost * sc.paper_usd + plank_cost_usd
        tix = tix + full_tens  # tickets received (≤ 500)
        paper -= paper_cost; T["paper_burned"] += paper_cost.sum()
        plank_in = plank_cost_usd.sum() / PLANK_USD
        # --- outsiders (ETH or USDG), spread over the day; the keeper checks the floor every hour
        n_out = rng.poisson(sc.outsiders_per_day)
        buys = sorted((float(rng.random()), int(rng.choice([1, 1, 5, 10, 10, 10]))) for _ in range(n_out))
        out_t = 0; bi = 0
        for h in range(24):
            t = d + h / 24
            while bi < len(buys) and buys[bi][0] * 24 < h + 1:
                k = buys[bi][1]; bi += 1
                fund += k * ETH_LEG_USD; T["eth_in"] += k * ETH_LEG_USD
                plank_in += k * PLANK_LEG_USD / PLANK_USD; out_t += k + (1 if k == TX_CAP else 0)
                poke(t)
            while live_mills > 0 and bid_now(t) >= sc.mill_floor_usd and fund >= sc.mill_floor_usd + MILL_BURN_FEE_USD:
                fund -= sc.mill_floor_usd + MILL_BURN_FEE_USD; mills_eaten += 1
                royalty_plank += PLANK_PER_MILL
                bid_start = max(sc.mill_floor_usd * BID_RESTART, base / 10)
                bid_banked = bid_start; bid_since = t; fund_at = fund
                # the seller is a small holder at the floor
                smalls = np.where((tier == 2) & (mills_of > 0))[0]
                if len(smalls): mills_of[rng.choice(smalls)] -= 1
                live_mills = mills_of.sum()
        T["outsider_tickets"] += out_t; T["holder_tickets"] += tix.sum()
        # --- PLANK split
        T["plank_in"] += plank_in; pot_plank += plank_in  # all of a ticket's PLANK goes into the pot
        # --- sell some of what's left
        sold = paper * pp["sell"] * 0.1; paper -= sold; T["paper_sold"] += sold.sum()
        # --- fire
        today = int(tix.sum()) + out_t
        fire_size += today * 1000; fire_ticket_owner += tix; outsider_tickets_fire += out_t
        tickets_bought += tix
        # --- the roll: storm from the trailing average *before* today's buys join it
        trail_avg = (sum(trail[-7:]) * 1000 // len(trail[-7:])) if trail else today * 1000  # thousandths, like the contract
        X = storm(trail_avg, night, int(rng.integers(0, 32)))
        trail.append(today)
        poke(d + 1)
        # PAPER leg ratchets ≤5% a night toward min(1 PAPER, $0.33 worth)
        if ppt != ppt_target:
            ppt = min(max(ppt_target, ppt * (1 - RATCHET)), ppt * (1 + RATCHET), 1.0); ppt_days += 1
        survived = night == 1 or (night < 24 and fire_size > X)
        if survived:
            fire_size = (fire_size - int(X)) * KEEP_BPS // 10_000
        else:
            total = fire_ticket_owner.sum() + outsider_tickets_fire
            winner_tier = -1; pot0 = pot_plank
            paid, royalty, burn = pot0 * 0.40, pot0 * 0.05, pot0 * 0.25  # 30% carries
            if total > 0:
                u = rng.random() * total
                if u < outsider_tickets_fire: winner_tier = 3
                else:
                    cum = np.cumsum(fire_ticket_owner); idx = int(np.searchsorted(cum, u - outsider_tickets_fire)); winner_tier = int(tier[idx])
                    won_usd[idx] += paid * PLANK_USD
                royalty_plank += royalty; T["plank_paid"] += paid
                carry = pot0 - paid - royalty - burn
            else:
                burn = 0; carry = pot0  # nobody had a ticket: nothing burns, the whole pot carries
            T["plank_burned"] += burn
            fires.append((night, pot0 * PLANK_USD, winner_tier, total))
            pot_plank = carry; fire_size = 0; night = 0; fire_id += 1
            fire_ticket_owner[:] = 0; outsider_tickets_fire = 0
        daily.append((today, fire_size / 1000, pot_plank * PLANK_USD, live_mills))

    # ---- summary
    lives = np.array([f[0] for f in fires]) if fires else np.array([0])
    pots = np.array([f[1] for f in fires]) if fires else np.array([0.0])
    wt = np.array([f[2] for f in fires]) if fires else np.array([])
    wins = {k: int((wt == v).sum()) for k, v in (("whale", 0), ("mid", 1), ("small", 2), ("outsider", 3))}
    ret = {}
    for k, v in (("whale", 0), ("mid", 1), ("small", 2)):
        m = tier == v; ret[k] = float(won_usd[m].sum() / max(1, spent_usd[m].sum()))
    D = np.array(daily)
    return dict(
        **asdict(sc),
        wallets=n, fires=len(fires),
        life_mean=float(lives.mean()), life_min=int(lives.min()), life_max=int(lives.max()),
        die_by3=float((lives <= 3).mean()), reach10=float((lives >= 10).mean()), reach15=float((lives >= 15).mean()),
        pot_med=float(np.median(pots)), pot_max=float(pots.max()),
        tickets_per_day=float(D[:, 0].mean()),
        paper_per_ticket_end=float(ppt), paper_ratchet_nights=ppt_days,
        paper_burned_pct=float(T["paper_burned"] / T["emitted"]),
        paper_sold_pct=float(T["paper_sold"] / T["emitted"]),
        paper_stockpile_end=float(paper.sum()), paper_stockpile_days=float(paper.sum() / max(1, mills_of.sum())),
        plank_burned_usd_yr=float(T["plank_burned"] * PLANK_USD * 365 / sc.days),
        plank_burned_pct_supply=float(T["plank_burned"] / PLANK_SUPPLY * 100 * 365 / sc.days),
        plank_locked_in_pot_usd=float(pot_plank * PLANK_USD),
        eth_usd_yr=float(T["eth_in"] * 365 / sc.days), mills_eaten=mills_eaten,
        days_per_mill=float(sc.days / mills_eaten) if mills_eaten else float("inf"),
        emission_end=float(mills_of.sum()), emission_drop_pct=float(1 - mills_of.sum() / sc.mills),
        royalty_usd_per_mill_yr=float(royalty_plank * PLANK_USD / max(1, mills_of.sum()) * 365 / sc.days),
        outsider_share=float(T["outsider_tickets"] / max(1, T["outsider_tickets"] + T["holder_tickets"])),
        cap_hits_per_day=float(T["cap_hits"] / sc.days),
        wins_whale=wins["whale"], wins_mid=wins["mid"], wins_small=wins["small"], wins_outsider=wins["outsider"],
        ret_whale=ret["whale"], ret_mid=ret["mid"], ret_small=ret["small"],
    )

def write(path, rows):
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    print(f"wrote {path}", len(rows), "rows")

if __name__ == "__main__":
    seeds = [0, 1, 2]
    rows = []; t0 = time.time()
    if "--paper" in sys.argv:
        for px, demand in itertools.product([0.001, 0.1, 0.33, 1.0, 5.0], ["tickets", "paper"]):
            for s in seeds:
                rows.append(run(Scenario(paper_usd=px, paper_demand=demand, seed=s)))
            print(f"paper=${px} demand={demand}  ({time.time()-t0:.0f}s)", file=sys.stderr)
        write("paper_results.csv", rows)
        sys.exit()
    grid = dict(mills=[1000, 2500, 5000, 10000], participation=["low", "med", "high"], outsiders_per_day=[0, 5, 25], mill_floor_usd=[100, 300, 786])
    if "--quick" in sys.argv: grid = dict(mills=[1000, 5000], participation=["low", "med", "high"], outsiders_per_day=[0, 5, 25], mill_floor_usd=[300])
    combos = list(itertools.product(*grid.values()))
    for i, (m, p, o, f) in enumerate(combos):
        for s in seeds:
            rows.append(run(Scenario(mills=m, participation=p, outsiders_per_day=o, mill_floor_usd=f, seed=s)))
        print(f"[{i+1}/{len(combos)}] mills={m} part={p} out={o} floor={f}  ({time.time()-t0:.0f}s)", file=sys.stderr)
    write("economy_results.csv", rows)
