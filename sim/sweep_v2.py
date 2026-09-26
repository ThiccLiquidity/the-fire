import numpy as np, sys
from fire_v2 import P, run, summarize
def scen(**kw):
    rows=[]
    for s in range(6):
        p=P(seed=s,**kw); S,ws,wb=run(p); rows.append(summarize(S,ws,wb,p))
    out={}
    for k in rows[0]:
        v=rows[0][k]
        if isinstance(v,dict): out[k]={t:float(np.mean([r[k][t] for r in rows])) for t in v}
        else: out[k]=float(np.mean([r[k] for r in rows]))
    return out
def show(name,r):
    w=r['wins_by']; rr=r['return_ratio']
    print(f"{name:34s} fires/yr={r['fires']:4.0f} days={r['fire_days_mean']:4.1f} ({r['fire_days_min']:.0f}-{r['fire_days_max']:.0f}) pot med=${r['pot_usd_median']:6.0f} max=${r['pot_usd_max']:6.0f} "
          f"tix/day={r['tickets_per_day']:5.0f} paperBurn={r['paper_burned_vs_emitted']:.2f} plank$/wk={r['plank_burned_per_week_usd']:5.0f} "
          f"eth$/wk={r['eth_usd_per_week']:4.0f} mills={r['mills_eaten']:4.0f} wins w/m/s/o={w['whale']:.0f}/{w['mid']:.0f}/{w['small']:.0f}/{w['outsider']:.0f} ret w/m/s={rr['whale']:.2f}/{rr['mid']:.2f}/{rr['small']:.2f}")
print("== participation =="); [show(f"part={x}",scen(participation=x)) for x in (0.5,1.0,1.5)]
print("== rally =="); [show(f"rally={x}",scen(rally=x)) for x in (0.0,0.5,1.0)]
print("== bundle discounts =="); show("no discounts",scen(tiers=((1,1.0),))); show("10/100/1000 = .9/.8/.7",scen()); show("mild .95/.9/.85",scen(tiers=((1000,.85),(100,.9),(10,.95),(1,1.0))))
print("== plank per ticket =="); [show(f"plank/ticket={x/1e6:.0f}M",scen(plank_per_ticket=x)) for x in (5e6,10e6,20e6)]
print("== storm scale day =="); [show(f"storm_scale_day={x}",scen(storm_scale_day=x)) for x in (5,8,12)]
print("== outsiders/day =="); [show(f"outsiders={x}",scen(outsiders_per_day=x)) for x in (0,5,20)]
print("== storm randomness (user idea: random daily, fire size just an odd) =="); show("sigma .35 ramp 1.0",scen()); show("sigma .8 ramp 1.0",scen(storm_sigma=0.8)); show("sigma .8 ramp 0.5",scen(storm_sigma=0.8,age_power=0.5)); show("sigma 1.0 no ramp",scen(storm_sigma=1.0,age_power=0.0))
print("== 2000 mills =="); show("2000 mills",scen(mills=2000))
print("== low participation, no rally, no outsiders (worst case) =="); show("worst",scen(participation=0.5,rally=0.0,outsiders_per_day=0))
