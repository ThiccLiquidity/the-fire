# The liquidity contract, modelled (docs/liquidity-burn.md, owner's design, Oct 28). Run: python3 ops/models/lp_model.py [share|rev|traffic|price|cap] Everything that used to burn now arrives here:
#   - as PAPER: Press packs, the 1 PAPER per pack, credit packs, suggestions, game entries (and the pack PAPER that
#     "buy with ETH only" buys on the market);
#   - as spendable money (ETH / USDG / PLANK): the liquidity share of every $2.50 pack price, the whole Extra-pack rise,
#     case and grading fees.
# Spendable money: 60% buys PAPER while the PAPER side holds under $50; the rest (and all of it after) buys whichever side is short (PLANK paid in can simply stay
# PLANK). Whenever both sides hold $1+, the matching amount pairs and the LP is burned. A side over the cap burns the
# excess outright. All in dollars at the price averages.
import random, statistics as st

def events(seed, packs=167, extra=30, press=50, g2=40, credits=16, price=2.5, paper_usd=0.08, case_rate=0.15, grade_rate=0.08,
           suggestions=100, games=200, days=14, coin_mix=(0.3, 0.55, 0.15), eth_all=0.4, liq=0.30):
    R = random.Random(seed); ev = []; t = lambda: R.random() * days * 24
    pp = paper_usd  # one PAPER, in dollars
    def pack(at, usd, coin, rise=0.0):
        if usd: ev.append((at, 'spend', coin, usd * liq + rise))
        bought = coin == 'ETH' and R.random() < eth_all  # the buyer's 1 PAPER bought on the market
        ev.append((at, 'paper', 'bought' if bought else 'held', pp))
    for _ in range(press): pack(t() * 0.04, 0, None)                       # group 1: first 6 h, PAPER only
    for _ in range(g2):                                                     # group 2: all of it to the liquidity
        at = t() * 0.07; ev.append((at, 'spend', 'PLANK', price)); ev.append((at, 'paper', 'held', pp))
    for _ in range(packs - press - g2):                                     # group 3: any coin
        u = R.random(); coin = 'PLANK' if u < coin_mix[0] else 'ETH' if u < coin_mix[0] + coin_mix[1] else 'USDG'
        pack(24 + t() * 0.9, price, coin)
    for _ in range(credits): pack(24 + t() * 0.9, 0, None)                 # credit packs: 1 PAPER
    for k in range(extra):                                                  # group 4: ETH, rising 4% a pack
        p = price * 1.04 ** (k + 1); pack(days * 24 + R.random() * 48, price, 'ETH', rise=p - price)
    cards = (packs + extra + credits) * 6
    for usd in [0.05] * int(cards * case_rate) + [1.0] * int(cards * grade_rate):
        u = R.random(); ev.append((24 + t(), 'spend', 'PLANK' if u < 0.3 else 'ETH' if u < 0.85 else 'USDG', usd))
    for _ in range(suggestions): ev.append((t(), 'paper', 'held', min(pp, 1.0)))
    for _ in range(games): ev.append((t(), 'paper', 'held', min(pp, 0.10)))
    return sorted(ev, key=lambda e: e[0])

def run(ev, paper_first=0.6, cap=100.0, min_pair=1.0, soft=50.0):
    H = {'PAPER': 0.0, 'PLANK': 0.0}; lp = 0.0; over = {'PAPER': 0.0, 'PLANK': 0.0}
    buy_paper = 0.0; buy_plank = 0.0; sell_plank = 0.0; capped = 0; n = 0
    for _, kind, how, usd in ev:
        n += 1
        if kind == 'paper':
            H['PAPER'] += usd
            if how == 'bought': buy_paper += usd
        else:
            to_paper = usd * (paper_first if H['PAPER'] < soft else 0.0); rest = usd - to_paper  # PAPER first, until that side holds `soft`
            short = 'PAPER' if H['PAPER'] + to_paper < H['PLANK'] else 'PLANK'
            if short == 'PAPER': to_paper += rest; rest = 0.0
            # buy the PAPER (with PLANK paid in, that's selling PLANK for it)
            buy_paper += to_paper; H['PAPER'] += to_paper
            if how == 'PLANK': sell_plank += to_paper
            if rest:
                H['PLANK'] += rest
                if how != 'PLANK': buy_plank += rest  # ETH/USDG buy PLANK; PLANK paid in just stays PLANK
        m = min(H['PAPER'], H['PLANK'])
        if m >= min_pair: H['PAPER'] -= m; H['PLANK'] -= m; lp += 2 * m
        for s in H:
            if H[s] > cap: over[s] += H[s] - cap; H[s] = cap
        if max(H.values()) >= cap * 0.999: capped += 1
    total = sum(e[3] for e in ev)
    return dict(total=total, lp=lp, over_paper=over['PAPER'], over_plank=over['PLANK'], buy_paper=buy_paper,
                plank_net=buy_plank - sell_plank, plank_sold=sell_plank, left_paper=H['PAPER'], left_plank=H['PLANK'], capped=capped / n)

def avg(evkw, runkw, seeds=150):
    rs = [run(events(s, **evkw), **runkw) for s in range(seeds)]
    return {k: st.mean(r[k] for r in rs) for k in rs[0]}

def row(label, evkw, runkw):
    r = avg(evkw, runkw)
    print(f"| {label} | ${r['total']:.0f} | **${r['lp']:.0f}** ({r['lp']/r['total']*100:.0f}%) | ${r['buy_paper']:.0f} | ${r['plank_net']:+.0f} | ${r['over_paper']:.0f} / ${r['over_plank']:.0f} | {r['capped']*100:.0f}% | ${r['left_paper']:.0f} / ${r['left_plank']:.0f} |")

H = "| Setting | Into the contract | Burned as liquidity | PAPER bought | PLANK net bought | Over cap, PAPER / PLANK | Time a side is full | Left waiting, PAPER / PLANK |\n|---|---|---|---|---|---|---|---|"
import sys
which = sys.argv[1] if len(sys.argv) > 1 else 'all'
if which in ('all', 'share'):
    print("\n### Standard Series (167 packs + 30 Extra, 200 game runs), 70% revenue: the PAPER-first share\n" + H)
    for p in (0.4, 0.5, 0.6, 0.7, 0.8, 1.0): row(f"{int(p*100)}% buys PAPER first", {}, {'paper_first': p})
if which in ('all', 'rev'):
    print("\n### Revenue share (60% PAPER-first)\n" + H)
    for rev in (0.70, 0.75, 0.80): row(f"{int(rev*100)}% revenue", {'liq': 1 - rev}, {'paper_first': 0.6})
if which in ('all', 'traffic'):
    print("\n### Traffic (70% revenue, 60% PAPER-first)\n" + H)
    row("Quiet: 120 packs, 0 Extra, 50 runs", {'packs': 120, 'extra': 0, 'games': 50, 'suggestions': 40}, {'paper_first': 0.6})
    row("Standard", {}, {'paper_first': 0.6})
    row("Busy: 300 packs, 60 Extra, 1,000 runs, 15% graded", {'packs': 300, 'extra': 60, 'games': 1000, 'grade_rate': 0.15, 'suggestions': 200}, {'paper_first': 0.6})
if which in ('all', 'price'):
    print("\n### PAPER's price (70% revenue, 60% PAPER-first)\n" + H)
    for pp in (0.02, 0.08, 0.25, 1.0): row(f"PAPER at ${pp}", {'paper_usd': pp}, {'paper_first': 0.6})
if which in ('all', 'cap'):
    print("\n### The cap (70% revenue, 60% PAPER-first)\n" + H)
    for c in (50, 100, 250): row(f"${c} cap", {}, {'paper_first': 0.6, 'cap': float(c)})
