"""Burn cards -> free pack. 12 months, 2 drops/month of 167 packs, ~120 buyers/drop buying 1-5 packs.
Burners burn only the cards they don't want (by rarity) whenever they have X of them, and redeem the free pack
right away in the live drop (it comes out of that drop's supply). Free-pack cards can be burned again (the loop).
Optional cap: at most K free packs per wallet per drop."""
import numpy as np
RATES = np.array([.50, .30, .15, .049, .001])        # paper wood fire charcoal diamond
HOLO = np.array([.05, .10, .50, .90, 1.0])
def run(X, burn_set, share, cap, rng, drops=24, supply=167, buyers=120, wallets=600):
    is_burner = rng.random(wallets) < share
    junk = np.zeros(wallets, int)                     # burnable cards held
    sold = free = 0
    for d in range(drops):
        left = supply; got = np.zeros(wallets, int)
        order = rng.choice(wallets, buyers, replace=False)
        def deal(w, packs):
            cards = rng.choice(5, size=6 * packs, p=RATES)
            holo = rng.random(cards.size) < HOLO[cards]
            ok = np.isin(cards, burn_set) & (~holo if 'noholo' in burn_set_flags else True)
            junk[w] += int(ok.sum())
        for w in order:
            n = min(int(rng.integers(1, 6)), left)
            if n <= 0: break
            left -= n; sold += n; deal(w, n)
            # burn + redeem right away while this drop has packs
            while is_burner[w] and junk[w] >= X and left > 0 and (cap is None or got[w] < cap):
                junk[w] -= X; left -= 1; free += 1; got[w] += 1; deal(w, 1)
    return sold, free
burn_set_flags = set()
rng = np.random.default_rng(1)
print("free packs per 100 sold (avg of 40 runs), 2 drops/mo x 12 mo, drops sell out")
for label, bs, flags in [("Paper only (no holo)", [0], {'noholo'}), ("Paper any", [0], set()), ("Paper + Wood", [0, 1], set())]:
    burn_set_flags = flags
    print(f"\n== burns {label} ==")
    print("X     " + "  ".join(f"{s:>9}" for s in ["25% burn", "50% burn", "100% burn", "100%,cap1"]))
    for X in [10, 12, 18, 24, 30, 36, 48, 60]:
        row = []
        for share, cap in [(.25, None), (.5, None), (1, None), (1, 1)]:
            r = [run(X, bs, share, cap, rng) for _ in range(40)]
            s, f = np.mean([a for a, _ in r]), np.mean([b for _, b in r])
            row.append(f"{100*f/(s+f):9.1f}")
        print(f"{X:<5} " + "  ".join(row))
