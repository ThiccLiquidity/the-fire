"""How many Fires per month? Same model, recommended drop (hybrid 167 packs, $2 base, +25% per tranche, 5/wallet).
Assumption: the monthly crowd is fixed. Calibrated so the 'normal'/'busy' crowds are what a Fire sees at 2 Fires/month.
More Fires = each one sees fewer people (people skip some: crowd x (2/f)^0.5) and each has a thinner budget
(WTP x (2/f)^0.3). Fewer Fires = the reverse. 300 runs per cell. Writes out_cadence.txt."""
import numpy as np, model
rng = np.random.default_rng(3)
st = model.structures()['hybrid 167']
out = open('out_cadence.txt', 'w')
def P(*a): print(*a); print(*a, file=out)
P(f"{'demand':7s} {'Fires/mo':>8} {'sellout':>7} {'packs/mo':>8} {'rev/mo':>7} {'prem':>5} {'served':>6}")
for sn in ('quiet', 'normal', 'busy'):
    for f in (1, 2, 3, 4, 6, 8):
        a = model.cell(st, 2, model.SCEN[sn], rng, 300, limit=5, scale=((2 / f) ** .5, (2 / f) ** .3))
        P(f"{sn:7s} {f:8d} {a['sold_out']*100:6.0f}% {a['sold']*f:8.0f} {('$%.0f' % (a['rev']*f)):>7} {a['premium']:5.1f} {a['served']*100:5.0f}%")
