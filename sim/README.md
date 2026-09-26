# The Fire — simulation

Agent-based sim of the game in `../the-fire-v1-spec.md`.

- `fire_v2.py` — model. `python3 fire_sim.py` runs one 60-round game verbosely and prints a summary.
- `sweep_v2.py` — every scenario in the spec (participation, M0/controller, pot split, showdown PAPER destination, fuel split, ember/sticky, outside buying, min commit, 2,000 mills). `python3 sweep_v2.py`. 8 seeds per scenario, ~1 min.

Units are PAPER. PLANK fuel is a PAPER-equivalent inflow. The controller here moves M (mint cost) with R fixed; in the spec it moves R with M fixed — same ratio, so the results carry over. Not modelled: live PAPER price/AMM, OJ secondary market, referrals, seasons.

Requires numpy.
