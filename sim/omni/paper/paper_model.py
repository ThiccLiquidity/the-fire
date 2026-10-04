"""PAPER as a utility token: sinks vs print, floor, press value. Run: python3 paper_model.py > out.txt"""
import itertools

PACK_USD = 1.00          # dollar price of a normal pack
LANE_RATE = 100          # PAPER-lane pack: min(100 PAPER, $1 of PAPER at TWAP)  -> floor $0.01
LANE_SHARE = 0.25        # share of each drop's packs sold in the PAPER lane
LANE_WALLET_CAP = 5      # PAPER-lane packs per wallet per drop
PSA_PAPER = 5            # PDA reveal: min(5 PAPER, $0.25 at TWAP), or $0.25 in ETH/USDG -> floor $0.05
PSA_USD = 0.25
STARTER = 50             # 1-PAPER starter packs per drop
SUGGEST_USD_CAP = 0.25   # suggestion: min(1 PAPER, $0.25 at TWAP)
PLANK_IN_PRESS = 94.0
PRESSES0 = 1000

# participation: packs sold / month at 1 drop/mo, suggestions/drop, share of cards PDA-revealed,
# share of reveals paid in PAPER, presses the press fund burns / month
PART = {
    "low":  dict(packs=500,  sugg=50,  psa=0.10, psa_paper=0.6, press_burn=2),
    "med":  dict(packs=1500, sugg=200, psa=0.25, psa_paper=0.7, press_burn=5),
    "high": dict(packs=4000, sugg=500, psa=0.50, psa_paper=0.8, press_burn=10),
}
CADENCE_BOOST = {1: 1.0, 2: 1.4, 4: 2.0}   # more drops sell more packs, with diminishing returns
PRICES = [0.01, 0.05, 0.25]

def lane_cost(price):  return min(LANE_RATE, PACK_USD / price)
def psa_cost(price):   return min(PSA_PAPER, PSA_USD / price)
def sugg_cost(price):  return min(1, SUGGEST_USD_CAP / price)

def sim(cad, price, p):
    P = PART[p]; presses = PRESSES0; printed = burned = util_usd = 0.0
    lane_fill = 1.0 if price <= PACK_USD / LANE_RATE else 0.8   # at/below floor arbs fill it; above, holders mostly do
    for m in range(12):
        printed += presses * 30.4
        packs = P["packs"] * CADENCE_BOOST[cad]
        lane = packs * LANE_SHARE * lane_fill
        cards = (packs + STARTER * cad) * 6
        b_lane = lane * lane_cost(price)
        b_start = STARTER * cad * 1
        b_sugg = P["sugg"] * cad * sugg_cost(price)
        psa_n = cards * P["psa"] * P["psa_paper"]
        b_psa = psa_n * psa_cost(price)
        burned += b_lane + b_start + b_sugg + b_psa
        # $ of utility delivered: lane pack worth $1, starter pack $1, PDA reveal $0.25, suggestion valued at market
        util_usd += lane * PACK_USD + STARTER * cad * PACK_USD + psa_n * PSA_USD + b_sugg * price
        presses -= P["press_burn"]
    return dict(printed=printed, burned=burned, net=printed - burned, util=util_usd,
                util_per_paper=util_usd / burned, presses_end=presses,
                press_day=min(burned, printed) / burned * util_usd / printed)  # $ utility a printed PAPER can reach

def main():
    print("## 1. Per-PAPER utility of each sink (the floor each one sets)\n")
    print("| Sink | PAPER cost | $ it replaces | Floor $/PAPER | Arbitrage? |\n|---|---|---|---|---|")
    rows = [("Suggestion", "1", "none (fun)", "0", "no: nothing resellable"),
            ("Starter pack (50/drop, 1/wallet, PLANK allowlist)", "1", "$1 pack", "$1.00 (only 50 PAPER/drop)", "bots/sybils; allowlist + 1/wallet"),
            ("PDA reveal", "min(5, $0.25 TWAP)", "$0.25 fee", "$0.05", "no: reveal is per card, not resellable"),
            ("PAPER lane pack", "min(100, $1 TWAP)", "$1 pack", "$0.01", "yes below $0.01 -> capped 25%/drop, 5/wallet"),
            ("Fixed 100 PAPER, uncapped", "100", "$1 pack", "$0.01", "YES: at $0.002 a pack costs $0.20, whole sale drains"),
            ("Forging (burn N cards + PAPER)", "-", "-", "-", "breaks the exact per-Fire pool; skip"),
            ("Burn cards -> free pack", "0", "-", "0 (no PAPER)", "keep, but it's not a PAPER sink")]
    for r in rows: print("| " + " | ".join(r) + " |")

    print("\n## 2. Arbitrage: uncapped fixed 100 PAPER/pack vs capped TWAP lane (med, 2 drops/mo)\n")
    print("| PAPER $ | Uncapped: $ per pack via PAPER | Owner gives up / drop | Capped lane: give-up / drop |\n|---|---|---|---|")
    packs = PART["med"]["packs"] * CADENCE_BOOST[2] / 2
    for pr in [0.001, 0.005, 0.01, 0.05]:
        c = LANE_RATE * pr
        up = f"${packs*(PACK_USD-c):,.0f} (every pack)" if c < PACK_USD else "$0 (nobody uses it, $1 is cheaper)"
        print(f"| {pr} | ${c:.2f} | {up} | ${packs*LANE_SHARE*(PACK_USD-min(c,1)):,.0f} (25% of packs max) |")

    print("\n## 3. 12-month sim (start 1,000 presses = 365k PAPER/yr)\n")
    print("| Drops/mo | PAPER $ | Part. | Printed | Burned | Net supply | Burn/print | $ utility/PAPER burned | Utility $/press/day |")
    print("|---|---|---|---|---|---|---|---|---|")
    res = {}
    for cad, pr, p in itertools.product([1, 2, 4], PRICES, ["low", "med", "high"]):
        r = sim(cad, pr, p); res[(cad, pr, p)] = r
        print(f"| {cad} | {pr} | {p} | {r['printed']:,.0f} | {r['burned']:,.0f} | {r['net']:+,.0f} | "
              f"{r['burned']/r['printed']:.0%} | ${r['util_per_paper']:.3f} | ${r['press_day']*1:.4f} |")

    print("\n## 4. Press value = $94 PLANK + PAPER utility/yr x payback years (2 drops/mo)\n")
    print("| PAPER $ | Part. | PAPER $/press/yr | Press @2y | Press @3y |\n|---|---|---|---|---|")
    for pr, p in itertools.product(PRICES, ["low", "med", "high"]):
        r = res[(2, pr, p)]; yr = r['press_day'] * 365
        print(f"| {pr} | {p} | ${yr:.2f} | ${PLANK_IN_PRESS+2*yr:.0f} | ${PLANK_IN_PRESS+3*yr:.0f} |")

    print("\n## 5. If PAPER pumps (fixed costs vs TWAP-capped costs)\n")
    print("| PAPER $ | Fixed 100/pack ($) | Capped lane (PAPER / $) | PDA fixed 5 ($) | PDA capped (PAPER) | Suggestion capped (PAPER) |\n|---|---|---|---|---|---|")
    for pr in [0.01, 0.05, 0.25, 1.0, 5.0]:
        print(f"| {pr} | ${100*pr:,.0f} | {lane_cost(pr):g} / ${lane_cost(pr)*pr:.2f} | ${5*pr:.2f} | {psa_cost(pr):g} | {sugg_cost(pr):g} |")

def balance_price(cad, p):
    """PAPER price at which a year's sinks burn exactly a year's print (below it, buyers must bid PAPER up)."""
    lo, hi = 1e-4, 10.0
    for _ in range(60):
        mid = (lo * hi) ** 0.5
        r = sim(cad, mid, p)
        lo, hi = (mid, hi) if r["burned"] > r["printed"] else (lo, mid)
    return mid

def fmt(x):
    return "never: print > all sinks" if x < 2e-4 else f"${x:.3f}"

def main2():
    print("\n## 6. Balance price: PAPER price where burn = print (the demand-backed floor)\n")
    print("| Drops/mo | low | med | high |\n|---|---|---|---|")
    for cad in [1, 2, 4]:
        print(f"| {cad} | " + " | ".join(fmt(balance_price(cad, p)) for p in ["low", "med", "high"]) + " |")
    print("\nNote: burns above print can't really happen (they'd need PAPER that doesn't exist); "
          "it means at that price PAPER is under-priced and buyers bid it up toward the balance price.")

if __name__ == "__main__":
    main(); main2()
    raise SystemExit
    main()
