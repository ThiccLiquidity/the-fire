"""Omni card-pack economics: PLANK in the mint, Idea A (presses), Idea B (liquidity).
Plain-number model, prices held flat unless stated. Run: python3 model.py > model_out.txt"""
import math

# ---- facts (docs/addresses.md, docs/spec.md) ----
ETH = 3333.0
PLANK_P = 1.056e-9            # $ per PLANK at 1x
SUPPLY = 888.42e12            # PLANK
POOL_WETH = 28.1              # V2 PLANK/WETH reserves at 1x
POOL_PLANK = 88.7e12
FEE = 0.003                   # Uniswap V2 swap fee
PRESSES = 1000
PRESS_PLANK_USD = 94.0        # PLANK inside a press at 1x
PAPER_PER_PRESS_DAY = 1.0

DROP_SIZES = [167, 250, 500]
DROPS_PM = [1, 2, 3, 4]
MULTS = [0.5, 1.0, 3.0]

def pool_at(m):
    """V2 reserves if PLANK price moves m-fold with k fixed (no LP adds/removes)."""
    k = POOL_WETH * POOL_PLANK
    weth = math.sqrt(k * m * PLANK_P / ETH * POOL_PLANK / POOL_PLANK) if False else POOL_WETH * math.sqrt(m)
    return weth, k / weth

def buy_impact(usd, m, weth=None):
    """Price rise of PLANK after buying `usd` of ETH->PLANK in one go (x*y=k)."""
    w, p = pool_at(m) if weth is None else (weth, None)
    dx = usd / ETH * (1 - FEE)
    return ((w + dx) / w) ** 2 - 1

def section(t): print("\n## " + t)

# ================= 1. PLANK in the mint =================
section("1. PLANK in the mint (per year)")
def plank_row(name, usd_per_pack, burned=True, uptake=1.0):
    print(f"\n### {name}")
    print("| packs/drop | drops/mo | packs/yr | $ in PLANK/yr | % supply/yr @0.5x | @1x | @3x | yr buy impact @0.5x | @1x | @3x |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for s in DROP_SIZES:
        for d in DROPS_PM:
            n = s * d * 12
            usd = n * usd_per_pack * uptake
            pct = [usd / (PLANK_P * m) / SUPPLY * 100 if burned else 0 for m in MULTS]
            imp = [buy_impact(usd, m) * 100 for m in MULTS]
            print(f"| {s} | {d} | {n:,} | ${usd:,.0f} | {pct[0]:.2f}% | {pct[1]:.2f}% | {pct[2]:.3f}% | +{imp[0]:.1f}% | +{imp[1]:.1f}% | +{imp[2]:.1f}% |")

plank_row("(i) PLANK log $0.10/pack, swapped from the ETH paid and burned in the same tx", 0.10)
plank_row("(i') PLANK log $0.25/pack", 0.25)
plank_row("(ii) Pay in PLANK at 10% off a $2 pack, all burned (assume 20% of buyers use it -> $0.36/pack avg)", 1.80, uptake=0.20)
plank_row("(iv) $0.10/pack of PLANK sent to PulpPool instead of burned (same buy, no burn)", 0.10, burned=False)
print("\nPer-pack price impact of a single $0.10 log buy at 1x: "
      f"{buy_impact(0.10,1)*100:.5f}% (invisible); a $0.25 log: {buy_impact(0.25,1)*100:.5f}%")
print("(iii) Allowlist only: no burn. One-off buying if N newcomers buy $10 to qualify: "
      + ", ".join(f"N={n}: ${n*10:,} -> +{buy_impact(n*10,1)*100:.1f}% (and they can sell after the snapshot)" for n in (100, 300, 1000)))
# per-tx gas for in-tx swap on Robinhood Chain (L2): ~110k gas extra; at 0.01-0.05 gwei
for g in (0.01, 0.05, 0.5):
    print(f"Extra gas for the in-tx swap+burn (~110k gas) at {g} gwei: ${110e3*g*1e-9*ETH:.4f}")

# ================= revenue table =================
section("4. Revenue sensitivity ($/yr), 250-pack drops")
prices = [1, 1.5, 2, 3]
print("| drops/mo | " + " | ".join(f"${p}/pack" for p in prices) + " |")
print("|---|" + "---|" * len(prices))
for d in [0, 1, 2, 3, 4]:
    print(f"| {d} | " + " | ".join(f"${250*p*d*12:,.0f}" for p in prices) + " |")
BASE = 250 * 2 * 2 * 12   # $12,000/yr base case
print(f"\nBase case: 250 packs x $2 x 2 drops/mo = ${BASE:,}/yr")

# ================= 2. Idea A: presses =================
section("2. Idea A: X% of revenue -> press fund (buy floor press, burn, PLANK to PulpPool)")
def idea_a(rev, x, floor, m=1.0):
    usd = rev * x
    fee_usd = 0.0003 * ETH
    n = usd / (floor + fee_usd)            # presses burned per year (floor held flat)
    left = PRESSES - n
    plank_released = n * PRESS_PLANK_USD * m
    per_press_plank = plank_released / left
    paper_cut = n * PAPER_PER_PRESS_DAY * 365  # PAPER/yr no longer printed (from next year on; ~half in year 1)
    return n, left, plank_released, per_press_plank, paper_cut
print("| revenue/yr | X% | press floor | presses burned/yr | emission cut | PLANK to PulpPool | royalty $/press/yr (press fund) | royalty $/press/yr (same $ straight to PulpPool) |")
print("|---|---|---|---|---|---|---|---|")
for rev in [3000, 12000, 36000]:
    for x in [0.25, 0.5]:
        for floor in [300, 500, 800]:
            n, left, pr, pp, cut = idea_a(rev, x, floor)
            direct = rev * x / PRESSES
            print(f"| ${rev:,} | {x:.0%} | ${floor} | {n:.1f} | -{n/PRESSES*100:.1f}% ({n:.0f} PAPER/day) | ${pr:,.0f} | ${pp:.2f} | ${direct:.2f} |")

# ================= 3. Idea B: liquidity =================
section("3. Idea B: X% of revenue -> PAPER/ETH LP (half buys PAPER, half paired; LP tokens burned)")
def slip(trade, side_usd):
    """$ lost to price impact + fee on a buy of `trade` $ into a V2 pool with `side_usd` per side."""
    out_frac = (side_usd / (side_usd + trade * (1 - FEE)))   # effective price ratio
    # tokens received vs spot: trade*(1-fee)*side/(side+trade*(1-fee)) / trade
    return 1 - (1 - FEE) * side_usd / (side_usd + trade * (1 - FEE))
print("| PAPER LP now ($ per side) | revenue/yr | X% | LP added/yr (both sides) | depth after 12 mo ($/side) | $100 trade cost now | after 12 mo | PAPER bought by the zap |")
print("|---|---|---|---|---|---|---|---|")
for side in [500, 1000, 2500]:
    for rev in [3000, 12000, 36000]:
        for x in [0.25, 0.5]:
            add = rev * x
            # zap: half buys PAPER (lifts price), half paired. Approx: each side grows by add/2.
            after = side + add / 2
            print(f"| ${side:,} | ${rev:,} | {x:.0%} | ${add:,.0f} | ${after:,.0f} | {slip(100, side)*100:.1f}% | {slip(100, after)*100:.1f}% | ${add/2:,.0f} |")
print("\nDo nothing: depth stays put (or thins as presses sell 365k PAPER/yr into it); $100 trade cost unchanged.")
print("PAPER printed per year: %d PAPER; at $0.01 = $%d, at $0.25 = $%d of sell supply."
      % (PRESSES * 365, PRESSES * 365 * 0.01, PRESSES * 365 * 0.25))
