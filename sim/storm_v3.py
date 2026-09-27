"""
Storm balance sim (v3 rules).

Fire has a persistent size S (tickets). Each day players buy D tickets: S += D.
Each night a storm X is drawn: S -= X. If S <= 0 the fire dies. Night 1: no storm. Night 24: infinite.

Storm draw: X = ref * base(n) * L
  ref     = trailing 7-day avg daily tickets (self-scales to the community)
  base(n) = c * ((n-1)/8)^p           (median storm as a fraction of a normal day's buys)
  L       ~ lognormal(0, sigma(n))    (luck; sigma grows a little with age so old fires get wild nights)

We sweep c, p, sigma and report: lifetime distribution, chance a fire dies by night 3, chance it reaches 10/15/20,
how often night 24 is hit, and pot size. Goal: avg life ~7-9 nights, <10% die by night 3, ~10-20% reach 15,
night 24 rare but real, and a fire that's fed well survives bad nights while a neglected one dies.
"""
import numpy as np

def simulate(c, p, sig0, sig_slope, keep=0.6, days=4000, ref=500, seed=0, buy_noise=0.35, rally=0.5, neglect=False):
    rng = np.random.default_rng(seed)
    S = 0.0; night = 0; lives = []; pots = []; pot = 0.0
    trail = [ref]*7
    died_by = {3:0, 5:0}; reached = {10:0, 15:0, 20:0, 24:0}; n_fires = 0
    for d in range(days):
        night += 1
        r = ref                                   # community volume (exogenous; contract uses a trailing avg of it)
        # overnight burn-down: the fire keeps `keep` of yesterday's size before today's buys
        S *= keep
        # buys: normal day, noisy. Rally: when the fire is small relative to a "danger" level, people buy more.
        D = r * rng.lognormal(0, buy_noise)
        if neglect: D *= 0.3
        danger = r * c * ((night)/8)**p          # what tomorrow's median storm would take
        if S < danger and rally > 0: D *= 1 + rally * min(1.5, (danger - S)/max(1, danger))
        S += D
        pot += D * 0.5 * 0.9                      # half the PLANK ($0.90/ticket) → pot, in dollars
        # storm
        if night == 1: X = 0.0
        elif night >= 24: X = np.inf
        else:
            base = c * ((night-1)/8)**p
            L = rng.lognormal(0, sig0 + sig_slope*night)
            X = r * base * L
        S -= X
        if S <= 0:
            n_fires += 1; lives.append(night); pots.append(pot)
            if night <= 3: died_by[3] += 1
            if night <= 5: died_by[5] += 1
            for k in reached:
                if night >= k: reached[k] += 1
            pot *= 0.3; S = 0.0; night = 0
    lives = np.array(lives); pots = np.array(pots)
    return dict(fires=n_fires, life_mean=lives.mean(), life_med=np.median(lives), life_min=lives.min(), life_max=lives.max(),
                die_by3=died_by[3]/n_fires, die_by5=died_by[5]/n_fires,
                reach10=reached[10]/n_fires, reach15=reached[15]/n_fires, reach20=reached[20]/n_fires, hit24=reached[24]/n_fires,
                pot_med=np.median(pots), pot_max=pots.max())

def show(label, r):
    print(f"{label:34s} life={r['life_mean']:4.1f} (med {r['life_med']:2.0f}, {r['life_min']}-{r['life_max']:2.0f}) "
          f"die≤3={r['die_by3']*100:4.0f}% ≤5={r['die_by5']*100:3.0f}%  reach10={r['reach10']*100:3.0f}% 15={r['reach15']*100:3.0f}% 20={r['reach20']*100:3.0f}% n24={r['hit24']*100:3.0f}%  "
          f"pot med=${r['pot_med']:5.0f} max=${r['pot_max']:6.0f}")

if __name__ == "__main__":
    print("== burn-down keep (c=1, p=1.5, sigma=0.7) ==")
    for keep in (0.4, 0.5, 0.6, 0.75, 0.9):
        show(f"keep={keep}", simulate(1.0, 1.5, 0.7, 0.0, keep=keep))
    print("== age curve p (keep=0.6, c=1, sigma=0.7) ==")
    for p in (1.0, 1.5, 2.0):
        show(f"p={p}", simulate(1.0, p, 0.7, 0.0, keep=0.6))
    print("== scale c (keep=0.6, p=1.5, sigma=0.7) ==")
    for c in (0.6, 0.8, 1.0, 1.3, 1.6):
        show(f"c={c}", simulate(c, 1.5, 0.7, 0.0, keep=0.6))
    print("== luck spread (keep=0.6, c=1, p=1.5) ==")
    for s0, sl in ((0.5,0), (0.7,0), (0.9,0), (1.1,0), (0.6,0.03)):
        show(f"sigma={s0}+{sl}n", simulate(1.0, 1.5, s0, sl, keep=0.6))
