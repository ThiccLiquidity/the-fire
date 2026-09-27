"""
The Fire — full economy simulation (v3 rules).

Everything on the site and in the contract, day by day, per wallet, vectorized:

  Mills → PAPER emission (1/mill/day) → wallets accumulate PAPER (claimed), sell some, buy tickets
  Ticket = 1 PAPER + $0.90 PLANK (or $1.00 ETH + $0.90 PLANK for outsiders); max 10/tx, 500/wallet/day; 3% off a full 10
  PAPER burned 100%; PLANK 50% burned / 50% pot; ETH 100% → mill fund
  Fire size += tickets; each night: storm = trail7 × ((n-1)/8)^1.5 × lognormal(0,0.9); size -= storm; ×0.6 overnight
  Night 1 no storm; night 24 infinite. Dead → one ticket wins 40% (5% of that to royalty pool), 30% burned, 30% carried.
  Mill fund buys the floor mill when it can; mill burned; its PLANK → royalty pool; emission -1/day forever.
  Royalty pool splits evenly across live mills (we track $ paid per mill).

Prices are held fixed (PLANK $0.00009375, ETH $3,333, PAPER a scenario input) — this sim is about flows, not price.
"""
from __future__ import annotations
import numpy as np, itertools, csv, sys, time
from dataclasses import dataclass, asdict

PLANK_USD = 750_000 / 8e12
PLANK_PER_MILL = 800_000_000
ETH_USD = 3333.0
PLANK_LEG_USD = 0.90
ETH_LEG_USD = 1.00
TX_CAP, DAY_CAP = 10, 500
KEEP = 0.6
C, P, SIGMA = 1.0, 1.5, 0.9

@dataclass
class Scenario:
    mills: int = 1000
    participation: str = "med"     # low / med / high
    outsiders_per_day: float = 5   # ETH ticket buyers per day (Poisson)
    mill_floor_usd: float = 100.0  # what the fire pays for a mill
    paper_usd: float = 0.25        # only used to report $ values of PAPER
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
    fire_size = 0.0; night = 0; pot_plank = 0.0; fire_id = 1
    trail = []; ref = None
    eth_fund = 0.0; mills_eaten = 0; royalty_plank = 0.0
    mill_bid = sc.mill_floor_usd * 0.85; bought_since_roll = False
    # tallies
    T = dict(emitted=0.0, paper_burned=0.0, paper_sold=0.0, plank_in=0.0, plank_burned=0.0, plank_paid=0.0,
             eth_in=0.0, outsider_tickets=0.0, holder_tickets=0.0, cap_hits=0, tx_count=0.0)
    fires = []  # (nights, pot_usd, winner_tier, tickets_in_fire)
    tickets_in_fire = 0.0; fire_ticket_owner = np.zeros(n)  # tickets per wallet this fire
    outsider_tickets_fire = 0.0
    daily = []

    for d in range(sc.days):
        night += 1
        live_mills = mills_of.sum()
        # --- emission
        mint = mills_of.copy(); paper += mint; T["emitted"] += mint.sum()
        # --- burn-down
        fire_size *= KEEP
        # --- decide buys: fraction of held paper, plus rally when the fire looks in danger
        r = ref if ref is not None else max(1.0, live_mills * 0.3)
        # spend a share of today's fresh PAPER, plus a 10%/day trickle of the stockpile
        want = mint * spend + (paper - mint) * spend * 0.10
        if sc.rally and night > 1:
            danger = r * C * ((night) / 8) ** P
            if fire_size < danger:
                want += paper * rally_frac * 0.5 * min(1.5, (danger - fire_size) / max(1, danger))
        want = np.minimum(want, paper)
        # PLANK leg: assume holders buy the PLANK they need (it's $0.90/ticket) — no PLANK balance constraint
        tix = np.floor(want)
        capped = tix > DAY_CAP; T["cap_hits"] += capped.sum(); tix = np.minimum(tix, DAY_CAP)
        # per-tx cap only affects discount: full 10s get 3% off the PAPER+PLANK legs
        full_tens = np.floor(tix / TX_CAP); rest = tix - full_tens * TX_CAP
        paper_cost = full_tens * TX_CAP * 0.97 + rest
        plank_cost_usd = (full_tens * TX_CAP * 0.97 + rest) * PLANK_LEG_USD
        T["tx_count"] += (full_tens + (rest > 0)).sum()
        paper -= paper_cost; T["paper_burned"] += paper_cost.sum()
        plank_in = plank_cost_usd.sum() / PLANK_USD
        # --- outsiders
        n_out = rng.poisson(sc.outsiders_per_day)
        out_t = 0.0
        for _ in range(n_out):
            k = int(rng.choice([1, 1, 5, 10, 10, 10]))
            eth_usd = k * ETH_LEG_USD * (0.97 if k >= 10 else 1); eth_fund += eth_usd; T["eth_in"] += eth_usd
            plank_in += k * PLANK_LEG_USD * (0.97 if k >= 10 else 1) / PLANK_USD; out_t += k
        T["outsider_tickets"] += out_t; T["holder_tickets"] += tix.sum()
        # --- PLANK split
        T["plank_in"] += plank_in; pot_plank += plank_in * 0.5; T["plank_burned"] += plank_in * 0.5
        # --- sell some of what's left
        sold = paper * pp["sell"] * 0.1; paper -= sold; T["paper_sold"] += sold.sum()
        # --- fire
        today = tix.sum() + out_t
        fire_size += today; tickets_in_fire += today; fire_ticket_owner += tix; outsider_tickets_fire += out_t
        tickets_bought += tix; spent_usd += tix * (1 * sc.paper_usd + PLANK_LEG_USD)
        trail.append(today); trail = trail[-7:]; ref = float(np.mean(trail))
        # --- mill fund eats mills
        if not bought_since_roll: mill_bid *= 1.05
        else: mill_bid = sc.mill_floor_usd * 0.85
        bought_since_roll = False
        while eth_fund >= max(mill_bid, sc.mill_floor_usd) and live_mills > 0:
            price = max(mill_bid, sc.mill_floor_usd)
            eth_fund -= price; mills_eaten += 1; bought_since_roll = True
            royalty_plank += PLANK_PER_MILL
            # the seller is a small holder at the floor
            smalls = np.where((tier == 2) & (mills_of > 0))[0]
            if len(smalls): mills_of[rng.choice(smalls)] -= 1
            live_mills = mills_of.sum()
        # --- storm
        if night == 1: X = 0.0
        elif night >= 24: X = np.inf
        else: X = ref * C * ((night - 1) / 8) ** P * rng.lognormal(0, SIGMA)
        survived = night == 1 or (night < 24 and fire_size > X)
        if survived:
            fire_size = max(0.0, fire_size - X)
        else:
            total = fire_ticket_owner.sum() + outsider_tickets_fire
            winner_tier = -1; paid = pot_plank * 0.4; tithe = paid * 0.05
            if total > 0:
                u = rng.random() * total
                if u < outsider_tickets_fire: winner_tier = 3
                else:
                    cum = np.cumsum(fire_ticket_owner); idx = int(np.searchsorted(cum, u - outsider_tickets_fire)); winner_tier = int(tier[idx])
                    won_usd[idx] += (paid - tithe) * PLANK_USD
                royalty_plank += tithe; T["plank_paid"] += paid - tithe
            else:
                pot_plank -= paid; paid = 0  # nobody: winner slice rolls forward (handled below)
                pot_plank += 0
            burn = (pot_plank if total > 0 else pot_plank + paid) * 0.3
            T["plank_burned"] += burn
            carry = pot_plank - (paid if total > 0 else 0) - burn
            fires.append((night, pot_plank * PLANK_USD, winner_tier, total))
            pot_plank = carry; fire_size = 0.0; night = 0; fire_id += 1
            fire_ticket_owner[:] = 0; outsider_tickets_fire = 0.0; tickets_in_fire = 0.0
        daily.append((today, fire_size, pot_plank * PLANK_USD, live_mills))

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
        paper_burned_pct=float(T["paper_burned"] / T["emitted"]),
        paper_sold_pct=float(T["paper_sold"] / T["emitted"]),
        paper_stockpile_end=float(paper.sum()), paper_stockpile_days=float(paper.sum() / max(1, mills_of.sum())),
        plank_burned_usd_yr=float(T["plank_burned"] * PLANK_USD * 365 / sc.days),
        plank_burned_pct_supply=float(T["plank_burned"] / 8e12 * 100),
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

if __name__ == "__main__":
    quick = "--quick" in sys.argv
    grid = dict(mills=[1000, 2500, 5000, 10000], participation=["low", "med", "high"], outsiders_per_day=[0, 5, 25], mill_floor_usd=[60, 100, 150])
    if quick: grid = dict(mills=[1000, 5000], participation=["low", "med", "high"], outsiders_per_day=[0, 5, 25], mill_floor_usd=[100])
    seeds = [0, 1, 2]
    rows = []; t0 = time.time()
    combos = list(itertools.product(*grid.values()))
    for i, (m, p, o, f) in enumerate(combos):
        for s in seeds:
            rows.append(run(Scenario(mills=m, participation=p, outsiders_per_day=o, mill_floor_usd=f, seed=s)))
        print(f"[{i+1}/{len(combos)}] mills={m} part={p} out={o} floor={f}  ({time.time()-t0:.0f}s)", file=sys.stderr)
    with open("economy_results.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    print("wrote economy_results.csv", len(rows), "rows")
