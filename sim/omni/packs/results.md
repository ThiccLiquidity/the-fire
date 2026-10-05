# Omni pack supply and pricing: results (Oct 3 2026)

Sims: `model.py` (the model and every assumption), `sim_packs.py` (structure x price x demand grid, bot defences,
wallet limits, starter packs, 300 runs per cell -> `out_packs.txt`), `sim_cadence.py` (Fires per month -> `out_cadence.txt`).

## Recommendation
- **Supply:** 167 packs per Fire (~1,000 cards), fixed. When they're gone, they're gone.
- **Price:** four steps of ~42 packs: **$2 / $2.50 / $3 / $3.50**, the same dollar price in PAPER, PLANK, ETH or USDG.
- **Wallet limit:** 5. Drop it to 3 once Fires sell out in under a day.
- **Starters:** 50 packs at 1 PAPER on top. Send them to 50 random Paper Presses (or to random wallets in the snapshot) rather than first come, first served.
- **Cadence:** 2 Fires a month. Move to 3 or 4 only after two Fires in a row sell out within 24h.

## Key numbers (base price $2, 5 per wallet)
| Structure | Normal: sold out / time | Normal: revenue | Normal: people served | Busy: revenue | Busy: resale vs price | Flippers+bots (normal) |
|---|---|---|---|---|---|---|
| Open-ended | never | $476 | 83% | $1,786 | 1.2x | 35% |
| Fixed 100 | 100% / 30h | $200 | 34% | $200 | 7.6x | 37% |
| **Fixed 167** | 100% / 48h | $334 | 58% | $334 | 7.3x | 36% |
| Fixed 250 | 36% | $467 | 81% | $500 | 6.5x | 34% |
| Fixed 500 | 0% | $480 | 84% | $1,000 | 3.7x | 35% |
| **Steps 167** | 78% / ~4.5 days | $451 | 50% | $458 | 7.0x | 45% |

Resale in normal demand: fixed 167 at 2.1x the price, steps 167 at 1.7x, open-ended and 500 at about 1x.
A Paper card is worth about 1/20 of a sealed pack.
- **Quiet** (40 people): nothing sells out at any size (~47 packs, ~$95).
- **Viral** (2,000 people): every fixed drop sells out in under 30 minutes and resells at 10-30x. Open-ended would earn ~$11k.
- **Bot farm** (200 wallets): any fixed drop is gone in under a minute, all of it to bots, whatever the wallet limit.
  Requiring a PLANK snapshot for the whole sale with 2 per wallet still leaves 72% to bots.
- **Starters, first come first served:** at a $10 PLANK threshold a $1,000 farm takes 100%. Sent to random snapshot wallets it takes 57% (37% at $50). Sent to random Presses it gets ~0%.
- **Fires a month** (normal demand, steps 167): 1 a month sells out at 3.5x, 2 a month sells out 83% of the time at 1.7x, and 3 or more stop selling out.

## Why
1. 167 packs is the size that sells out with normal demand. A sell-out is what gives a sealed pack a resale floor above its price. Open-ended sales and 500-pack drops resell at about the price.
2. The price steps earn ~35% more ($451 vs $334) and shrink the easy flip, so less of the value goes to flippers.
3. $1 is too cheap. In busy demand packs resell at 14x and the gap goes to flippers. At $5 nothing sells out in normal demand.

## Risks
- **Bots** are the biggest one. A wallet limit doesn't stop a farm. The only real defences are a small flip margin (the price steps) and identity that costs money (Presses).
- **Viral demand:** a fixed supply leaves a lot of money unearned. The fix is more Fires, not bigger ones.
- **Quiet demand:** a drop that doesn't sell out looks dead. Start with 167, not 500.
- **The model rests on guesses:** crowd sizes, how much people will pay, and a rough resale model. Thin markets swing widely. Treat the numbers as directions, not forecasts.
