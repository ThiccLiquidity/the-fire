"""Main grid: structure x price x demand scenario (300 runs per cell, wallet limit 5), plus bot defences,
wallet limits and the 50 starter packs. Writes out_packs.txt."""
import numpy as np, model, sys
rng = np.random.default_rng(7)
R = int(sys.argv[1]) if len(sys.argv) > 1 else 300
out = open('out_packs.txt' if len(sys.argv) < 3 else 'out_packs_extra.txt', 'w')
def P(*a):
    print(*a); print(*a, file=out); out.flush()
hdr = f"{'structure':12s} {'price':>5} {'sold':>6} {'sellout':>7} {'t_out h':>7} {'revenue':>8} {'served':>6} {'bot/flip':>8} {'floor':>7} {'prem':>5} {'PaperCard':>9} {'royalty':>7}"
def row(name, p, a):
    t = '-' if np.isnan(a['t_out']) else f"{a['t_out']:.1f}"
    P(f"{name:12s} {('$%g'%p):>5} {a['sold']:6.0f} {a['sold_out']*100:6.0f}% {t:>7} {('$%.0f'%a['rev']):>8} {a['served']*100:5.0f}% {a['spec']*100:7.0f}% {('$%.2f'%a['floor']):>7} {a['premium']:5.1f} {('$%.3f'%a['card']):>9} {('$%.0f'%a['royalty']):>7}")
RES = {}
GRID = len(sys.argv) < 3
for sn, sc in (model.SCEN.items() if GRID else []):
    P(f"\n=== {sn}: {sc} ==="); P(hdr)
    for p in (1, 2, 3, 5):
        for stn, st in model.structures().items():
            a = model.cell(st, p, sc, rng, R); RES[(sn, stn, p)] = a; row(stn, p, a)
if GRID: import pickle; pickle.dump(RES, open('res_grid.pkl', 'wb'))

P("\n=== Bot farm defences (fixed 167 / hybrid 167, $2, 200 bot wallets) ===")
P("gate = holders of ~$10 PLANK at a secret snapshot; 50% of humans hold it, 25% of farm wallets were pre-funded")
P(hdr)
for lim in (5, 2, 1):
    for gname, gate in (('none', None), ('24h', (24, .5, .25)), ('whole', (999, .5, .25))):
        for stn in ('fixed 167', 'hybrid 167'):
            a = model.cell(model.structures()[stn], 2, model.SCEN['bot farm'], rng, R, limit=lim, gate=gate)
            row(f"{stn[:6]} L{lim} {gname}", 2, a)

P("\n=== Wallet limit (hybrid 167 @ $2, normal and busy) ===")
P(hdr)
for sn in ('normal', 'busy'):
    for lim in (1, 2, 3, 5, 10):
        a = model.cell(model.structures()['hybrid 167'], 2, model.SCEN[sn], rng, R, limit=lim)
        row(f"{sn[:6]} L{lim}", 2, a)

P("\n=== 50 starter packs (1 PAPER, 1/wallet, PLANK snapshot, first come first served) ===")
P("farm parks a fixed $1,000 of PLANK spread over as many wallets as the threshold allows; 150 humans, 50% hold enough")
for thr in (10, 25, 50, 100):
    shares = []
    for _ in range(R):
        humans = rng.binomial(150, .5 if thr <= 10 else .5 * (10 / thr) ** .5)
        bots = int(1000 // thr)
        hum_claim = rng.binomial(humans, .7)                      # 70% of eligible humans claim in time
        bot_got = min(50, bots)                                   # bots claim in the first seconds
        hum_got = min(50 - bot_got, hum_claim)
        shares.append((bot_got / max(1, bot_got + hum_got), hum_got))
    s = np.array(shares)
    P(f"threshold ${thr:>3}: bots get {s[:,0].mean()*100:4.0f}% of starters, humans get {s[:,1].mean():4.1f} packs")
P("\nSame, but the 50 starters are dropped to random eligible wallets at the snapshot (no claim race):")
for thr in (10, 25, 50, 100):
    sh = []
    for _ in range(R):
        humans = rng.binomial(150, .5 if thr <= 10 else .5 * (10 / thr) ** .5); bots = int(1000 // thr)
        sh.append(bots / max(1, bots + humans))
    P(f"threshold ${thr:>3}: bots get {np.mean(sh)*100:4.0f}% of starters")
P("Drop to 50 random Paper Presses instead (a press costs ~$94, so a farm can't fake many): bots ~0% unless they buy presses")
