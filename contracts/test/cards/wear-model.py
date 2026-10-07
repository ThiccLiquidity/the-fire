#!/usr/bin/env python3
"""The PDA wear model (docs/grading.md), and the fixed table FirePsa reads.

  python3 wear-model.py table    -> the Solidity constants (FirePsa's WEAR_TIMES / WEAR_CDFS)
  python3 wear-model.py vectors  -> wear-vectors.json, checked against FirePsa.oddsFor by Psa.t.sol
  python3 wear-model.py odds     -> the odds tables in docs/grading.md

Time damage D ~ Poisson(1.45 * years^0.68), years = time uncased after the free first day. The contract doesn't do
that math: it reads D's distribution from a table at fixed ages (BREAKS) and blends linearly between the two nearest
(a blend of two distributions is a distribution). This file is the reference for exactly that table math, so the
contract and this model agree to rounding.
"""
import json
import math
import sys

DAY = 86400
YEAR = 365 * DAY  # the contract's year
FREE = DAY  # the first day is free
L, P = 1.45, 0.68
P_MOVE_NUM, P_MOVE_DEN = 1, 5  # 20% per move
MOVE_CAP = 10
FADE = {4: YEAR // 12, 3: YEAR // 2, 2: YEAR, 1: 2 * YEAR}  # grade -> opens at (fully open at twice that)
DMAX = 9  # D = 0..8 stored; 9+ is the rest (any card loses everything to 1 by then)
SCALE = 1 << 23  # CDF resolution (fits the 24-bit cells)

BREAK_DAYS = [0, 1, 2, 4, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 240, 300, 365, 456, 548, 730, 913, 1095, 1460,
              1825, 2190, 2555, 2920, 3650, 4380, 5475, 7300, 10950]
BREAKS = [d * DAY for d in BREAK_DAYS]
STANDARD = [0, 0, 0, 0, 1000, 2000, 2700, 2500, 1700, 100]  # fresh grade 1..10 weights (out of 10,000), fixed forever


def poisson_cdf(lam):
    out, acc = [], 0.0
    for k in range(DMAX):
        acc += math.exp(-lam) * lam ** k / math.factorial(k)
        out.append(acc)
    return out  # P(D <= k), k = 0..8


def table():
    rows = []
    for t in BREAKS:
        lam = L * (t / YEAR) ** P if t > 0 else 0.0
        cdf = [min(SCALE, round(c * SCALE)) for c in poisson_cdf(lam)]
        for k in range(1, DMAX):  # monotone after rounding
            cdf[k] = max(cdf[k], cdf[k - 1])
        rows.append(cdf)
    return rows


TABLE = table()


def time_pmf(t):
    """Distribution of D at time-uncased t (seconds past the free day), as integers out of SCALE (index 9 = 9+)."""
    if t >= BREAKS[-1]:
        cdf = TABLE[-1]
    else:
        i = max(j for j in range(len(BREAKS)) if BREAKS[j] <= t)
        a, b = TABLE[i], TABLE[i + 1]
        span, into = BREAKS[i + 1] - BREAKS[i], t - BREAKS[i]
        cdf = [(a[k] * (span - into) + b[k] * into) // span for k in range(DMAX)]
    pmf = [cdf[0]] + [cdf[k] - cdf[k - 1] for k in range(1, DMAX)]
    pmf.append(SCALE - cdf[-1])
    return pmf


def fade(g, t):
    """Share of grade g (< 5) that is open at t, out of 1e18."""
    if g >= 5:
        return 10 ** 18
    u = FADE[g]
    if t <= u:
        return 0
    if t >= 2 * u:
        return 10 ** 18
    return (t - u) * 10 ** 18 // u


def odds(age, moves, weights=STANDARD):
    """Chance of each grade 1..10 (out of 1e18, integer math as in the contract) for a card `age` seconds uncased
    since it was dealt, with `moves` moves while uncased."""
    one = 10 ** 18
    t = max(0, age - FREE)
    m = min(moves, MOVE_CAP)
    tp = time_pmf(t)
    total_w = sum(weights)
    raw = [0] * 11
    for g0 in range(5, 11):
        w = weights[g0 - 1]
        if w == 0:
            continue
        kmax = min(m, g0 - 5)
        bw = [math.comb(m, k) * (P_MOVE_DEN - P_MOVE_NUM) ** (m - k) * P_MOVE_NUM ** k for k in range(kmax + 1)]
        bsum = sum(bw)
        for k in range(kmax + 1):
            pm = one * w // total_w * bw[k] // bsum
            g1 = g0 - k
            for d in range(DMAX + 1):
                raw[max(1, g1 - d)] += pm * tp[d] // SCALE
    out = [0] * 11
    carry = 0
    for g in range(1, 11):
        mass = raw[g] + carry
        keep = mass * fade(g, t) // one
        out[g] = keep
        carry = mass - keep
    return out[1:]


def sol_table():
    times = ''.join(f'{t:08x}' for t in BREAKS)
    cdfs = ''.join(''.join(f'{c:06x}' for c in row) for row in TABLE)
    return times, cdfs


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'odds'
    if cmd == 'table':
        times, cdfs = sol_table()
        print(f'    uint256 internal constant WEAR_BREAKS = {len(BREAKS)};')
        print(f'    bytes internal constant WEAR_TIMES = hex"{times}";')
        print(f'    bytes internal constant WEAR_CDFS = hex"{cdfs}";')
    elif cmd == 'vectors':
        cases = []
        ages = [0, DAY // 2, DAY, DAY + 1, 3 * DAY, 7 * DAY + 5, 29 * DAY, 45 * DAY + 7, 61 * DAY, 100 * DAY, 200 * DAY,
                365 * DAY, 400 * DAY, 2 * YEAR + DAY, 3 * YEAR, 5 * YEAR + 12345, 10 * YEAR, 31 * YEAR, 80 * YEAR]
        for a in ages:
            for m in (0, 1, 3, 10, 25):
                cases.append({'age': a, 'moves': m, 'odds': [str(x) for x in odds(a, m)]})
        json.dump({'cases': cases}, open(sys.argv[2] if len(sys.argv) > 2 else 'wear-vectors.json', 'w'), indent=1)
    else:
        rows = [('≤ 24 hours', 0), ('1 week', 7 * DAY), ('1 month', 30 * DAY), ('3 months', 91 * DAY),
                ('6 months', 182 * DAY), ('1 year', YEAR), ('2 years', 2 * YEAR), ('3 years', 3 * YEAR),
                ('5 years', 5 * YEAR), ('10 years', 10 * YEAR)]
        for label, age in rows:
            o = odds(age + FREE, 0)
            avg = sum((g + 1) * o[g] for g in range(10)) / 1e18
            print(f'| {label} | ' + ' | '.join(f'{o[g] / 1e16:.1f}' if o[g] >= 5e14 else '' for g in range(9, -1, -1)) + f' | {avg:.2f} |')
        for m in (0, 1, 2, 3, 5, 10, 20):
            o = odds(0, m)
            avg = sum((g + 1) * o[g] for g in range(10)) / 1e18
            print(f'| {m} moves | ' + ' | '.join(f'{o[g] / 1e16:.1f}' if o[g] >= 5e14 else '' for g in range(9, -1, -1)) + f' | {avg:.2f} |')
