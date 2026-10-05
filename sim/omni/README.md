# Economy sims

Python models (numpy) used to size the card economy. The final numbers the contracts use are in
`docs/omni-economy.md`; these folders hold the models behind them and their recorded output.

| Folder | Model | Run | Output |
|---|---|---|---|
| `packs/` | Pack supply, price, wallet limits, bot defences, starter packs, drop cadence | `python3 sim_packs.py`, `python3 sim_cadence.py` | `out_packs.txt`, `out_cadence.txt`, `results.md` |
| `burn/` | Burning cards for free pack credits (cards per credit, loop risk) | `python3 burn_sim.py > out.txt` | `out.txt` |
| `paper/` | PAPER sinks vs. print, PDA reveal pricing | `python3 paper_model.py > out.txt` | `out.txt`, `results.md` |
| `plank/` | PLANK in the mint, press value, liquidity | `python3 model.py > model_out.txt` | `model_out.txt`, `results.md` |

Run each from its own folder. `sim_packs.py` takes several minutes; the others take seconds. Some early recommendations in the results (price steps, for example) were superseded;
`docs/omni-economy.md` is the source of truth.
