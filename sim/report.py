"""Summarize economy_results.csv into a markdown report."""
import csv, statistics as st, sys
from collections import defaultdict

rows = list(csv.DictReader(open("economy_results.csv")))
for r in rows:
    for k, v in r.items():
        try: r[k] = float(v)
        except: pass
    r["mills"] = int(r["mills"]); r["outsiders_per_day"] = int(float(r["outsiders_per_day"])); r["mill_floor_usd"] = int(float(r["mill_floor_usd"]))

def agg(keys, fields):
    g = defaultdict(list)
    for r in rows: g[tuple(r[k] for k in keys)].append(r)
    out = []
    for key, rs in sorted(g.items(), key=lambda kv: [ (["vlow","low","med","high"].index(x) if isinstance(x,str) else x) for x in kv[0]]):
        out.append((key, {f: st.mean(r[f] for r in rs) for f in fields}))
    return out

def money(v): return f"${v:,.0f}"
def pct(v): return f"{v*100:.0f}%"

L = []
L.append("# The Fire — full economy simulation\n")
L.append("324 year-long runs: mills ∈ {1k, 2.5k, 5k, 10k} × participation ∈ {low, medium, high} × outsiders ∈ {0, 5, 25}/day × mill floor ∈ {$60, $100, $150} × 3 seeds. Prices fixed (PLANK $0.0000938, ETH $3,333, PAPER $0.25 for reporting only). Model: `sim/economy.py`.\n")
L.append("**Participation** = share of each day's fresh PAPER a wallet spends on tickets (whale/mid/small): low 25/18/10%, medium 50/40/30%, high 75/65/55%, plus a 10%/day trickle of stockpiles and rallies when the fire looks threatened.\n")

L.append("## 1. Participation is the whole game (1,000 mills, 5 outsiders/day, $100 floor)\n")
L.append("| Participation | Tickets/day | PAPER burned | PAPER sold | Stockpile (days of emission) | Fire life (min–max) | Pot median / max | PLANK burned/yr | Wins whale/mid/small/outsider |\n|---|---|---|---|---|---|---|---|---|")
for key, a in agg(["participation"], ["tickets_per_day","paper_burned_pct","paper_sold_pct","paper_stockpile_days","life_mean","life_min","life_max","pot_med","pot_max","plank_burned_usd_yr","wins_whale","wins_mid","wins_small","wins_outsider"]):
    sub=[r for r in rows if r["participation"]==key[0] and r["mills"]==1000 and r["outsiders_per_day"]==5 and r["mill_floor_usd"]==100]
    if not sub: continue
    m=lambda f: st.mean(r[f] for r in sub)
    L.append(f"| {key[0]} | {m('tickets_per_day'):.0f} | {pct(m('paper_burned_pct'))} | {pct(m('paper_sold_pct'))} | {m('paper_stockpile_days'):.1f} | {m('life_mean'):.1f} ({m('life_min'):.0f}–{m('life_max'):.0f}) | {money(m('pot_med'))} / {money(m('pot_max'))} | {money(m('plank_burned_usd_yr'))} | {m('wins_whale'):.0f}/{m('wins_mid'):.0f}/{m('wins_small'):.0f}/{m('wins_outsider'):.0f} |")

L.append("\n## 2. Scale: more mills (medium participation, 5 outsiders/day, $100 floor)\n")
L.append("| Mills | Wallets | Tickets/day | Pot median / max | PLANK burned/yr | % of PLANK supply/yr | PLANK sitting in pot | Fire life |\n|---|---|---|---|---|---|---|---|")
for m_ in (1000,2500,5000,10000):
    sub=[r for r in rows if r["participation"]=="med" and r["mills"]==m_ and r["outsiders_per_day"]==5 and r["mill_floor_usd"]==100]
    m=lambda f: st.mean(r[f] for r in sub)
    L.append(f"| {m_:,} | {m('wallets'):.0f} | {m('tickets_per_day'):.0f} | {money(m('pot_med'))} / {money(m('pot_max'))} | {money(m('plank_burned_usd_yr'))} | {m('plank_burned_pct_supply'):.0f}% | {money(m('plank_locked_in_pot_usd'))} | {m('life_mean'):.1f} |")

L.append("\n## 3. The mill fund: how fast the fire eats mills (medium participation, 1,000 mills)\n")
L.append("| Outsiders/day | ETH in/yr | Mill floor | Mills eaten/yr | Days per mill | Emission drop | Royalty $/mill/yr | Outsider share of tickets |\n|---|---|---|---|---|---|---|---|")
for o in (0,5,25):
    for f in (60,100,150):
        sub=[r for r in rows if r["participation"]=="med" and r["mills"]==1000 and r["outsiders_per_day"]==o and r["mill_floor_usd"]==f]
        m=lambda k: st.mean(r[k] for r in sub)
        dpm = m('days_per_mill'); dpm = "—" if dpm==float('inf') else f"{dpm:.1f}"
        L.append(f"| {o} | {money(m('eth_usd_yr'))} | ${f} | {m('mills_eaten'):.0f} | {dpm} | {pct(m('emission_drop_pct'))} | ${m('royalty_usd_per_mill_yr'):.2f} | {pct(m('outsider_share'))} |")

L.append("\n## 4. Fairness: return per dollar by tier (all scenarios averaged)\n")
a = {f: st.mean(r[f] for r in rows) for f in ("ret_whale","ret_mid","ret_small")}
L.append(f"Whales get back {pct(a['ret_whale'])} of what they spend, mids {pct(a['ret_mid'])}, small holders {pct(a['ret_small'])}. Differences are noise — the 10/500 caps and 3% max discount make the raffle proportional. It's a burn game: ~20¢ back per dollar in expectation, the rest is destroyed PAPER/PLANK and the tithe.\n")

L.append("## 5. Fire lifetimes across everything\n")
lives=[r["life_mean"] for r in rows]; d3=[r["die_by3"] for r in rows]; r10=[r["reach10"] for r in rows]; r15=[r["reach15"] for r in rows]; mx=[r["life_max"] for r in rows]
L.append(f"Across all 324 runs: average fire lives {min(lives):.1f}–{max(lives):.1f} nights (mean {st.mean(lives):.1f}); {pct(st.mean(d3))} of fires die by night 3; {pct(st.mean(r10))} reach night 10; {pct(st.mean(r15))} reach night 15; longest fire seen: {max(mx):.0f} nights. The storm scales to the community's own volume, so this barely moves with mills or participation — which is the point.\n")

L.append("## 6. Daily cap\n")
c=[r["cap_hits_per_day"] for r in rows]
L.append(f"Wallets hitting the 500/day cap: {st.mean(c):.2f} per day on average, max {max(c):.1f} — only whales at high participation with 10k mills. The cap is almost never binding; it exists for the one whale who tries to buy the fire in an evening.\n")

open("../docs/simulation-report.md","w").write("\n".join(L))
print("\n".join(L))
