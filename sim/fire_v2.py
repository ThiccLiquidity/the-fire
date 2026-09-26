"""
The Fire v2 — storm-night simulation.

Daily model. A "fire" lasts until the nightly storm beats the day's ticket volume
(or day 24). Tickets = 1 PAPER + PLANK_PER_TICKET PLANK (bundle discounts), or
ETH_PAPER_USD in ETH + PLANK for outsiders. PAPER burns 100%; PLANK 50% burn / 50% pot.
Payout 40% winner / 30% burn / 30% carry to next fire.
"""
from __future__ import annotations
import numpy as np
from dataclasses import dataclass, field

@dataclass
class P:
    seed: int = 1
    mills: int = 1000
    days: int = 365
    paper_usd: float = 0.30
    plank_usd: float = 750_000 / 8_000_000_000_000
    plank_per_ticket: float = 10_000_000
    eth_paper_usd: float = 1.00
    tiers: tuple = ((1000, 0.70), (100, 0.80), (10, 0.90), (1, 1.0))   # (tickets, price mult)
    # storm
    storm_scale_day: float = 8.0      # storm ≈ trailing-avg daily tickets at this fire age
    storm_sigma: float = 0.35         # lognormal noise on storm strength
    age_power: float = 1.0            # storm base ∝ (day/scale)**age_power; 0 = pure random, no ramp
    max_days: int = 24
    ref_window: int = 7
    # behaviour
    participation: float = 1.0        # scales base ticket-buy fraction
    rally: float = 1.0                # 0 = nobody rallies; 1 = normal
    outsiders_per_day: float = 5.0    # ETH-paper buyers/day (Poisson), scales with pot
    stoke_usd_per_day: float = 0.0
    pot_pull: float = 1.0             # how strongly pot size raises buying (elasticity-ish)
    win_winner: float = 0.40
    win_burn: float = 0.30
    win_carry: float = 0.30
    tithe: float = 0.05               # of payout to royalty pool (from winner slice)
    mill_floor_usd: float = 100.0

@dataclass
class W:
    tier: str
    mills: int
    paper: float = 0.0
    buy_frac: float = 0.3     # of daily mint spent on tickets
    rally_frac: float = 0.3   # of held PAPER willing to throw in a rally
    tickets: float = 0.0
    spent_usd: float = 0.0
    wins: int = 0
    won_usd: float = 0.0

def make_wallets(p: P, rng):
    ws=[]; rem=p.mills
    for _ in range(max(2,p.mills//250)):
        m=min(int(rng.integers(40,120)),rem-100); ws.append(W("whale",m,buy_frac=0.5,rally_frac=0.5)); rem-=m
    for _ in range(max(5,p.mills//40)):
        m=min(int(rng.integers(8,30)),rem-50); ws.append(W("mid",m,buy_frac=0.4,rally_frac=0.4)); rem-=m
    while rem>0:
        m=min(int(rng.integers(1,6)),rem); ws.append(W("small",m,buy_frac=0.3,rally_frac=0.3)); rem-=m
    for w in ws:
        w.buy_frac=float(np.clip(w.buy_frac*p.participation*rng.lognormal(0,0.4),0,0.95))
        w.rally_frac=float(np.clip(w.rally_frac*p.rally*rng.lognormal(0,0.4),0,0.95))
    return ws

def buy(w: W, paper_budget: float, p: P, S):
    """Spend up to paper_budget PAPER on the best bundle tiers. Returns tickets bought."""
    got=0.0; paper=paper_budget
    for n,mult in p.tiers:
        cost_paper=n*mult
        while paper>=cost_paper:
            paper-=cost_paper; got+=n
            plank=n*mult*p.plank_per_ticket
            S["paper_burned"]+=cost_paper; S["plank_in"]+=plank
            w.spent_usd+=cost_paper*p.paper_usd+plank*p.plank_usd
    w.paper-=paper_budget-paper
    w.tickets+=got
    return got

def run(p: P, verbose=False):
    rng=np.random.default_rng(p.seed); ws=make_wallets(p,rng)
    S=dict(paper_burned=0.0,plank_in=0.0,plank_burned=0.0,eth_usd=0.0,tithe_plank=0.0,paid_plank=0.0,
           mills_eaten=0,fires=[],daily_tickets=[],emitted=0.0)
    pot=0.0; carry=0.0; fire_day=0; hist=[]; fund_usd=0.0; wins_by={"whale":0,"mid":0,"small":0,"outsider":0}
    outsider_tickets=0.0
    for d in range(p.days):
        fire_day+=1
        today=0.0; plank_before=S["plank_in"]
        # pot pull: bigger pot → more buying (log-ish)
        ref=np.mean(hist[-p.ref_window:]) if hist else None
        pot_usd=pot*p.plank_usd
        pull=1.0+p.pot_pull*np.log1p(pot_usd/200.0)*0.15
        for w in ws:
            mint=w.mills; S["emitted"]+=mint; w.paper+=mint
            today+=buy(w, min(w.paper, mint*min(0.95,w.buy_frac*pull)), p, S)
        # outsiders
        n_out=rng.poisson(p.outsiders_per_day*pull)
        for _ in range(n_out):
            n=int(rng.choice([1,1,1,10,10,100],p=[.4,.2,.1,.15,.1,.05]))
            mult=min((m for t,m in p.tiers if t<=n), default=1.0)
            S["eth_usd"]+=n*mult*p.eth_paper_usd; fund_usd+=n*mult*p.eth_paper_usd
            S["plank_in"]+=n*mult*p.plank_per_ticket; today+=n; outsider_tickets+=n
        # stoke
        stoke_plank=p.stoke_usd_per_day/p.plank_usd
        # storm forecast & rally
        storm=None
        if fire_day>1:
            base=(ref if ref else today)*(fire_day/p.storm_scale_day)**p.age_power
            storm=base*rng.lognormal(0,p.storm_sigma)
            forecast_mid=base
            gap=forecast_mid*1.15-today
            if gap>0 and p.rally>0:
                # rally: wallets throw held paper proportional to willingness, until gap closed
                order=rng.permutation(len(ws))
                for i in order:
                    if gap<=0: break
                    w=ws[i]
                    if w.paper<1: continue
                    spend=min(w.paper*w.rally_frac, gap)
                    t=buy(w, spend, p, S); today+=t; gap-=t
        hist.append(today); S["daily_tickets"].append(today)
        plank_today=S["plank_in"]-plank_before+stoke_plank
        pot+=0.5*plank_today; S["plank_burned"]+=0.5*plank_today
        # mill fund eats mills
        while fund_usd>=p.mill_floor_usd:
            fund_usd-=p.mill_floor_usd; S["mills_eaten"]+=1
            # emission drops: remove a mill from a random small holder (floor seller)
            smalls=[w for w in ws if w.tier=="small" and w.mills>0]
            if smalls: rng.choice(smalls).mills-=1
            S["tithe_plank"]+=800_000_000   # plank inside → royalty pool
        # storm resolution
        out = fire_day>=p.max_days or (storm is not None and today<storm)
        if out:
            total=sum(w.tickets for w in ws)+outsider_tickets
            r=rng.random()*total; winner=None; acc=0.0
            for w in ws:
                acc+=w.tickets
                if r<acc: winner=w; break
            tier=winner.tier if winner else "outsider"
            wins_by[tier]+=1
            pay=pot*p.win_winner; t=pay*p.tithe
            S["paid_plank"]+=pay-t; S["tithe_plank"]+=t; S["plank_burned"]+=pot*p.win_burn
            if winner: winner.wins+=1; winner.won_usd+=(pay-t)*p.plank_usd
            S["fires"].append(dict(days=fire_day,pot_usd=pot*p.plank_usd,tickets=total,winner=tier,
                                   rally_saved=0))
            pot=pot*p.win_carry; fire_day=0
            for w in ws: w.tickets=0.0
            outsider_tickets=0.0
    return S, ws, wins_by

def summarize(S, ws, wins_by, p: P):
    f=S["fires"]; days=np.array([x["days"] for x in f]); pots=np.array([x["pot_usd"] for x in f])
    spent={t:sum(w.spent_usd for w in ws if w.tier==t) for t in ("whale","mid","small")}
    won={t:sum(w.won_usd for w in ws if w.tier==t) for t in ("whale","mid","small")}
    return dict(
        fires=len(f), fire_days_mean=float(days.mean()), fire_days_min=int(days.min()), fire_days_max=int(days.max()),
        pot_usd_median=float(np.median(pots)), pot_usd_max=float(pots.max()),
        tickets_per_day=float(np.mean(S["daily_tickets"])),
        paper_burned_vs_emitted=float(S["paper_burned"]/S["emitted"]),
        plank_burned_per_week_usd=float(S["plank_burned"]*p.plank_usd/p.days*7),
        plank_burned_pct_supply=float(S["plank_burned"]/8e12*100),
        eth_usd_per_week=float(S["eth_usd"]/p.days*7), mills_eaten=S["mills_eaten"],
        royalty_pool_usd=float(S["tithe_plank"]*p.plank_usd),
        wins_by=wins_by,
        return_ratio={t: (won[t]/spent[t] if spent[t] else 0) for t in spent},
    )

if __name__=="__main__":
    import json
    p=P(); S,ws,wb=run(p)
    print(json.dumps(summarize(S,ws,wb,p),indent=1,default=float))
