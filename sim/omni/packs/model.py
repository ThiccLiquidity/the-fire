"""Pack sale model for Omni ("Forged in Fire"). Shared by sim_packs.py and sim_cadence.py.

Plain-language assumptions (all tunable below):
- A Fire's sale window is 7 days (the Fire's life; spec says 3-20 nights depending on ticket volume).
- The main crowd shows up in the first 48h (viral: most in the first ~3h). Each person visits 1 + ~1.5 return
  visits (2-12h apart) and buys on a visit with 60% chance (hesitation). Willingness to pay (WTP) is lognormal.
- A smaller "late" crowd (40% of the main crowd) finds the drop on days 3-7. If packs are still on sale they buy
  them there; if sold out they become secondary-market buyers.
- After the sale, new "aftermarket" collectors (30% of the crowd) show up. Sold-out drops get a collector premium:
  WTP x1.25 for late/aftermarket buyers ("it's gone, I want one").
- Flippers: 8% of humans are flippers. Bots (bot-farm scenario): 200 wallets that hit the sale in the first minutes.
  Both only buy when they expect a flip profit: expected floor > price x 1.10 (marketplace fee + 5% royalty + gas).
  Their expected floor comes from a bot-free pre-run of the same cell.
- Secondary floor: everyone left wanting a pack bids their WTP; flippers/bots list everything at 0.7-1.3x cost;
  15% of regular buyers' packs are listed at 0.6-1.2x their WTP. Aftermarket crowd is halved if not sold out. The book is matched; the floor is the cheapest listing left
  (or the last trade if nothing is left). Premium = floor / primary price.
- Card values: Paper 1, Wood 2, Fire 5, Charcoal 20, Diamond 200 (relative). Rarity 50/30/15/4.9/0.1 gives an
  average card of 3.03 Paper-units, 18.2 per pack. Opened cards sell for 85% of a sealed pack in total (the
  gamble premium), so Paper-card floor = 0.85 x pack floor / 18.2.
"""
import numpy as np, math

WINDOW = 168.0          # sale open for the Fire's life (hours)
MAIN = 48.0             # main crowd arrives over this
SIGMA = 0.9             # lognormal spread of WTP
CONV = 0.6              # chance to buy on a visit
FLIP_SHARE = 0.08
FEE = 1.10
LATE, AFTER, PREM = 0.4, 0.3, 1.25
HOLDER_LIST = 0.15
PAPER_UNITS_PER_PACK = 6 * (.5*1 + .3*2 + .15*5 + .049*20 + .001*200)
CARD_SHARE = 0.85

SCEN = {
    'quiet':    dict(n=40,   wtp=1.0),
    'normal':   dict(n=150,  wtp=1.5),
    'busy':     dict(n=400,  wtp=2.5),
    'viral':    dict(n=2000, wtp=4.0, rush=True),
    'bot farm': dict(n=150,  wtp=1.5, bots=200),
}

def structures():
    S = {'open-ended': dict(supply=None, steps=None)}
    for s in (100, 167, 250, 500):
        S[f'fixed {s}'] = dict(supply=s, steps=None)
    for s in (167, 250):
        S[f'hybrid {s}'] = dict(supply=s, steps=(1.0, 1.25, 1.5, 1.75))   # 4 tranches, +25% each
    return S

def price_at(st, p, sold):
    if st['steps'] is None: return p
    k = min(len(st['steps']) - 1, sold * len(st['steps']) // st['supply'])
    return p * st['steps'][k]

def want_qty(rng, m):
    r = rng.random(m)
    return np.where(r < .6, rng.integers(1, 3, m), np.where(r < .9, rng.integers(3, 6, m), rng.integers(6, 16, m)))

def run(st, p, sc, rng, limit=5, exp_floor=None, scale=(1.0, 1.0), gate=None):
    """gate=(hours, human_holder_share, bot_holder_share): only PLANK holders at the snapshot may buy in the first hours."""
    n = max(1, int(round(sc['n'] * scale[0]))); med = sc['wtp'] * scale[1]
    nl = int(round(n * LATE))
    m = n + nl
    wtp = rng.lognormal(math.log(med), SIGMA, m)
    q = want_qty(rng, m)
    flip = rng.random(m) < FLIP_SHARE
    arr = np.empty(m)
    arr[:n] = (rng.exponential(3.0, n) if sc.get('rush') else rng.uniform(0, MAIN, n)).clip(0, MAIN)
    arr[n:] = rng.uniform(MAIN, WINDOW, nl)
    # flippers act only if they expect profit
    flip_ok = exp_floor is not None and exp_floor > p * FEE
    cap = np.where(flip, limit if flip_ok else 0, np.minimum(q, limit))
    # visits
    nv = 1 + rng.poisson(1.5, m)
    who = np.repeat(np.arange(m), nv)
    off = np.concatenate([np.concatenate([[0.], np.cumsum(rng.uniform(2, 12, k - 1))]) for k in nv])
    t = arr[who] + off
    keep = (t < WINDOW) & (rng.random(len(t)) < np.where(flip[who], 1.0, CONV)) & (cap[who] > 0)
    # cheapest price any human could face is p; drop visits from people who can never afford it
    keep &= (wtp[who] >= p) | flip[who]
    who, t = who[keep], t[keep]
    # bots: one visit each in the first 3 minutes, buy to the wallet limit if they expect profit
    nb = sc.get('bots', 0)
    bot_ok = nb and exp_floor is not None and exp_floor > p * FEE
    if bot_ok:
        who = np.concatenate([who, m + np.arange(nb)]); t = np.concatenate([t, rng.uniform(0, 0.05, nb)])
    if gate:
        gh, hs, bs = gate
        holder = np.concatenate([rng.random(m) < hs, rng.random(nb) < bs])
        late = (t < gh) & ~holder[who]
        t = np.where(late, gh + rng.uniform(0, 0.05, len(t)), t)  # non-holders come back when it opens
        ok = t < WINDOW; who, t = who[ok], t[ok]
    order = np.argsort(t, kind='stable')
    who, t = who[order], t[order]
    got = np.zeros(m + nb, dtype=int); paid = np.zeros(m + nb)
    supply = st['supply'] if st['supply'] else 10**9
    sold = 0; rev = 0.0; t_out = None
    for i, ti in zip(who.tolist(), t.tolist()):
        if sold >= supply: break
        while got[i] < (limit if i >= m else cap[i]) and sold < supply:
            pr = price_at(st, p, sold)
            if i < m and not flip[i] and pr > wtp[i]: break
            if (i >= m or flip[i]) and exp_floor is not None and pr * FEE >= exp_floor: break
            got[i] += 1; sold += 1; rev += pr; paid[i] += pr
        if sold >= supply and t_out is None: t_out = ti
    sold_out = st['supply'] is not None and sold >= supply
    spec = np.zeros(m + nb, bool); spec[:m] = flip; spec[m:] = True
    # ---- secondary market ----
    prem = PREM if sold_out else 1.0
    unmet = np.where(flip, 0, np.maximum(0, np.minimum(q, limit) - got[:m]))
    lw = np.where(np.arange(m) >= n, wtp * prem, wtp)
    bids = [np.repeat(lw, unmet)]
    na = int(round(n * (AFTER if sold_out else AFTER / 2)))
    bids.append(np.repeat(rng.lognormal(math.log(med), SIGMA, na) * prem, want_qty(rng, na).clip(max=limit)))
    bids = np.sort(np.concatenate(bids))[::-1]
    spec_packs = got[spec]; avg_cost = rev / max(1, sold)
    asks = [np.repeat(1, spec_packs.sum()) * avg_cost * rng.uniform(0.7, 1.3, spec_packs.sum())]
    hold = (~spec[:m]) & (got[:m] > 0)
    lst = rng.binomial(got[:m][hold], HOLDER_LIST)
    asks.append(np.repeat(wtp[:m][hold], lst) * rng.uniform(0.6, 1.2, lst.sum()))
    asks = np.sort(np.concatenate(asks))
    k = 0
    K = min(len(bids), len(asks))
    while k < K and bids[k] >= asks[k]: k += 1
    if k < len(asks): floor = asks[k]
    elif k > 0: floor = (bids[k-1] + asks[k-1]) / 2
    else: floor = avg_cost if sold else p
    vol = sum((bids[j] + asks[j]) / 2 for j in range(k))
    humans_main = np.arange(n)
    served = np.mean(got[:m][~flip] > 0) if True else 0
    # demand served: of humans (non-flippers) willing to pay the base price, share who got >=1 pack
    willing = (~flip) & (wtp >= p)
    served = float(np.mean(got[:m][willing] > 0)) if willing.any() else 1.0
    return dict(sold=sold, sold_out=float(sold_out), t_out=t_out if sold_out else np.nan, rev=rev,
                served=served, spec=float(got[spec].sum() / max(1, sold)), bots=float(got[m:].sum() / max(1, sold)),
                floor=floor, premium=floor / p, royalty=0.05 * vol,
                card=CARD_SHARE * floor / PAPER_UNITS_PER_PACK)

def cell(st, p, sc, rng, runs=300, limit=5, scale=(1.0, 1.0), gate=None):
    # flippers/bots' expectation: average floor from a bot/flipper-free pre-run (100 runs)
    pre = [run(st, p, {k: v for k, v in sc.items() if k != 'bots'}, rng, limit, None, scale)['floor'] for _ in range(100)]
    ef = float(np.mean(pre))
    rs = [run(st, p, sc, rng, limit, ef, scale, gate) for _ in range(runs)]
    out = {k: float(np.nanmean([r[k] for r in rs])) if k != 't_out' else
           (float(np.nanmedian([r[k] for r in rs])) if any(not np.isnan(r[k]) for r in rs) else np.nan) for k in rs[0]}
    out['exp_floor'] = ef
    return out
