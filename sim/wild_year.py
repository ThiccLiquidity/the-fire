"""
Wild years: random, moody buying over a year, run through the exact contract mirror (fire_sim.Fire, parity-tested
against Fire.sol). Nothing here is a forecast; it's a stress test with as much variety as we could think of.

Each day's logs come from:
  - a mood that drifts between dead (~1/day), quiet (~12), steady (~60), busy (~300) and hype (~1,500), lasting days to weeks
  - FOMO: the bigger the pot, the more people buy (x1.4 at a $2k pot, x3.3 at $20k, x10 at $200k), plus a "save it" rush
    when an old fire is carrying a big pot
  - dry spells: now and then 5-14 days where almost nobody buys
  - whales: a few days a year someone throws in hundreds to thousands of logs
  - day-to-day noise and busier weekends
PLANK's price wanders (6% a day, with occasional pumps and dumps); a log always costs $0.90 of PLANK at the day's price,
so the pot is counted in PLANK and shown in dollars at that day's price. $250 seed, 40/25/5/30 split, 20x prize cap,
3/2/1 free logs per 10.

  python3 sim/wild_year.py [years=2000] [grounded|wild]
"""
import math, random, statistics as st, sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
from fire_sim import Fire, poisson, PRIZE_CAP_MULT

PROFILES = {
    # grounded: centered on the owner's expectation (5-100 a day most of the time); FOMO milder and capped at x4
    "grounded": dict(moods=[1, 5, 20, 80, 400], fomo=0.3, fomo_cap=4.0, whale=(50, 1000)),
    # wild: hype is common and FOMO feeds on itself (x10 at a $200k pot)
    "wild": dict(moods=[1, 12, 60, 300, 1500], fomo=0.5, fomo_cap=1e9, whale=(200, 5000)),
}
START_PRICE = 1.0558e-9


def year(r, prof, days=365):
    f = Fire(); price = START_PRICE
    pot = 250 / price; carried = pot  # PLANK
    mood = r.choices(range(5), weights=[1, 4, 4, 2, 0.5])[0]
    dry = 0
    out = dict(days=[], fires=[], logs=0)
    for d in range(days):
        # PLANK price: 6%/day wander, 2%/day a pump or dump
        price *= math.exp(r.gauss(0, 0.06))
        if r.random() < 0.02: price *= r.choice([1 / 3, 1 / 2, 2 / 3, 1.5, 2, 3])
        pot_usd = pot * price
        # mood drifts: on average every ~10 days, usually one step, sometimes a jump
        if r.random() < 0.1:
            mood = max(0, min(4, mood + (r.choice([-1, 1]) if r.random() < 0.8 else r.choice([-2, 2]))))
        if dry == 0 and r.random() < 0.015: dry = r.randint(5, 14)
        lam = prof["moods"][mood]
        lam *= min(prof["fomo_cap"], (1 + pot_usd / 2000) ** prof["fomo"])  # FOMO on the pot
        if f.night >= 12 and pot_usd > 5000: lam *= 1.3               # "save the fire" rush
        lam *= math.exp(r.gauss(0, 0.7) - 0.245)                      # day-to-day noise (mean 1)
        if d % 7 in (5, 6): lam *= 1.4
        if dry: lam *= 0.02; dry -= 1
        logs = poisson(r, lam)
        if r.random() < 0.01: logs += int(math.exp(r.uniform(math.log(prof["whale"][0]), math.log(prof["whale"][1]))))  # a whale
        free = 3 if f.night == 0 else 2 if f.night == 1 else 1
        pot += logs * (0.90 * 10 / (10 + free)) / price
        f.buy(logs); out["logs"] += logs
        rec = f.roll(r.randrange(10000))
        if not rec["survived"]:
            prize = 0.0
            if rec["tickets"] > 0:
                base = min(pot, PRIZE_CAP_MULT * max(0.0, pot - carried))
                prize = base * 0.40
                out["fires"].append(dict(day=d, nights=rec["night"], logs=rec["tickets"], pot=pot * price, prize=prize * price,
                                         burned=base * 0.25 * price, royalty=base * 0.05 * price))
                pot -= base * 0.70
            else:
                out["fires"].append(dict(day=d, nights=rec["night"], logs=0, pot=pot * price, prize=0.0, burned=0.0, royalty=0.0))
            carried = pot
        out["days"].append(dict(logs=logs, pot=pot * price, mood=mood, dry=dry > 0, size=f.fire_size / 1000, night=f.night))
    return out


def pct(xs, p): xs = sorted(xs); return xs[min(len(xs) - 1, int(p * len(xs)))]


def main(n=2000, name="grounded"):
    prof = PROFILES[name]
    ys = [year(random.Random(7000 + i), prof) for i in range(n)]
    per = []
    for y in ys:
        won = [x for x in y["fires"] if x["logs"] > 0]
        per.append(dict(
            logs=y["logs"], fires=len(y["fires"]), winners=len(won),
            longest=max((x["nights"] for x in y["fires"]), default=0),
            biggest_prize=max((x["prize"] for x in won), default=0), median_prize=st.median([x["prize"] for x in won]) if won else 0,
            paid=sum(x["prize"] for x in won), burned=sum(x["burned"] for x in won), royalty=sum(x["royalty"] for x in won),
            max_pot=max(dd["pot"] for dd in y["days"]), end_pot=y["days"][-1]["pot"],
            below_seed=sum(dd["pot"] < 250 for dd in y["days"]) / 365, dry_days=sum(dd["dry"] for dd in y["days"]),
            pot10k=any(dd["pot"] > 10_000 for dd in y["days"]), pot100k=any(dd["pot"] > 100_000 for dd in y["days"]),
            reach20=sum(x["nights"] >= 20 for x in y["fires"]), hit24=sum(x["nights"] == 24 for x in y["fires"])))
    allf = [x for y in ys for x in y["fires"]]
    won = [x for x in allf if x["logs"] > 0]
    row = lambda k, money=True: " | ".join((f"${pct([p[k] for p in per], q):,.0f}" if money else f"{pct([p[k] for p in per], q):,.0f}") for q in (0.1, 0.5, 0.9)) + " | " + (f"${max(p[k] for p in per):,.0f}" if money else f"{max(p[k] for p in per):,.0f}")
    print(f"\n## {name}: {n} simulated years\n")
    print("| Per year | Bad year (10%) | Typical | Great year (90%) | Best of all |")
    print("|---|---|---|---|---|")
    for k, lab, m in [("logs", "Logs thrown", False), ("fires", "Fires", False), ("winners", "Winners", False), ("longest", "Longest fire (nights)", False),
                      ("median_prize", "Typical prize", True), ("biggest_prize", "Biggest prize", True), ("paid", "Paid to winners", True),
                      ("burned", "PLANK burned ($)", True), ("royalty", "To the Paper Press pool", True), ("max_pot", "Biggest pot", True), ("end_pot", "Pot at year end", True),
                      ("dry_days", "Dry-spell days", False)]:
        print(f"| {lab} | {row(k, m)} |")
    print()
    print(f"Years the pot ever passed $10k: {sum(p['pot10k'] for p in per) / n:.0%}; $100k: {sum(p['pot100k'] for p in per) / n:.0%}")
    print(f"Share of days the pot sat under the $250 seed: typical {pct([p['below_seed'] for p in per], 0.5):.0%}, bad year {pct([p['below_seed'] for p in per], 0.9):.0%}")
    lives = [x["nights"] for x in allf]
    print(f"All fires: {len(allf) / n:.0f}/yr; out by night 3 {sum(l <= 3 for l in lives) / len(lives):.0%}; reach 10 {sum(l >= 10 for l in lives) / len(lives):.0%}; reach 15 {sum(l >= 15 for l in lives) / len(lives):.1%}; reach 20 {sum(l >= 20 for l in lives) / len(lives):.2%}; hit night 24 {sum(l == 24 for l in lives) / len(lives):.2%}")
    print(f"Years with a fire reaching night 20: {sum(p['reach20'] > 0 for p in per) / n:.0%}; night 24: {sum(p['hit24'] > 0 for p in per) / n:.0%}")
    buckets = [(0, 10), (10, 100), (100, 1000), (1000, 10000), (10000, 1e9)]
    print("Prizes: " + ", ".join(f"${a:,.0f}-{'' if b > 1e8 else f'${b:,.0f}'}: {sum(a <= x['prize'] < b for x in won) / len(won):.0%}" for a, b in buckets))
    # big fires: what made them
    top = sorted(won, key=lambda x: -x["prize"])[: max(1, len(won) // 100)]
    print(f"Top 1% of prizes: ${pct([x['prize'] for x in top], 0):,.0f}+, fires of {pct([x['nights'] for x in top], 0.5)} nights (median), {pct([x['logs'] for x in top], 0.5):,.0f} logs")
    # three example years by total logs
    order = sorted(range(n), key=lambda i: per[i]["logs"])
    for lab, i in [("quiet", order[n // 10]), ("typical", order[n // 2]), ("wild", order[9 * n // 10])]:
        y = ys[i]; mo = []
        for m in range(12):
            dd = y["days"][m * 30:(m + 1) * 30] if m < 11 else y["days"][330:]
            mo.append(f"{sum(x['logs'] for x in dd):,}/{max(x['pot'] for x in dd):,.0f}")
        w = [x for x in y["fires"] if x["logs"] > 0]
        print(f"\nExample {lab} year: {y['logs']:,} logs, {len(y['fires'])} fires, biggest prize ${max((x['prize'] for x in w), default=0):,.0f}, longest fire {max(x['nights'] for x in y['fires'])} nights")
        print("  month by month (logs / top pot $): " + " · ".join(mo))
    json.dump(per, open(os.path.join(os.path.dirname(__file__), f"wild_year_{name}.json"), "w"))


if __name__ == "__main__":
    for name in (sys.argv[2:] or ["grounded", "wild"]): main(int(sys.argv[1]) if len(sys.argv) > 1 else 2000, name)
