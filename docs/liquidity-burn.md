# The liquidity burn (owner-approved Oct 28 2026; built: contracts/src/cards/LiquidityBurner.sol)

Nothing on the site is burned outright any more. Everything that used to burn PAPER or PLANK goes to one new
contract, the **liquidity contract** (working name `LiquidityBurner`). It pairs PAPER with PLANK, adds the pair to the
PAPER/PLANK Uniswap V2 pool (the biggest PAPER pool) and burns the pool tokens: the liquidity is locked for good.
The only coins still burned outright are a side's amount over its $100 limit.

The model: `ops/models/lp_model.py` (its runs are summarised at the end of this page).

## What goes in

| Flow | Today | From now on |
|---|---|---|
| Group 1, Paper Press holders (1 PAPER a pack, no dollar price) | PAPER burned | PAPER to the liquidity contract |
| Group 2, PLANK holders ($2.50 in PLANK + 1 PAPER) | 10% PLANK burned, 20% sold for PAPER and burned, 70% revenue | **all** the PLANK and the 1 PAPER to the liquidity contract (no revenue) |
| Group 3, Everyone ($2.50 in PLANK, ETH or USDG + 1 PAPER) | 10% / 20% burned, 70% revenue | 70% revenue; 30% and the 1 PAPER to the liquidity contract |
| Group 4, Extra packs (ETH, $2.50 rising 4% a pack + 1 PAPER) | base split as group 3; the whole rise burns PAPER | base split as group 3 (70% revenue); the whole rise and the 1 PAPER to the liquidity contract |
| Free credit packs (1 PAPER) | burned | to the liquidity contract |
| "Buy with ETH only" (buys the pack's PAPER on the market) | burned | to the liquidity contract |
| Cases ($0.05) and gradings ($1), paid in PLANK, ETH or USDG | all buy PAPER, burned | all to the liquidity contract |
| Suggestions (1 PAPER, at most $1) | burned | to the liquidity contract |
| Game entries (1 PAPER or $0.10 of PAPER, whichever is less) | burned | to the liquidity contract |
| Resale royalties | royalty wallet | unchanged (revenue) |

The owner's revenue is only groups 3 and 4: 70% of the $2.50 base price, paid in the buyer's coin (PLANK, ETH or USDG
in group 3; ETH in group 4). It goes straight from the buyer to the revenue wallet and never passes through the
liquidity contract. Revenue share and the liquidity share stay per-group settings (set per Series).

## How it works

Two sides, each valued in dollars at the 30-minute price averages (PaperUsdTwap, PlankUsdTwap, Chainlink ETH/USD):

1. **PAPER arrives as PAPER** (packs, suggestions, games): it joins the PAPER side.
2. **Spendable money arrives** (ETH, USDG, PLANK: pack shares, the Extra-pack rise, case and grading fees):
   - while the PAPER side holds under **$50**, **60%** of it buys PAPER (PLANK paid in is sold for it in the
     PAPER/PLANK pool; ETH and USDG buy it);
   - the rest, and all of it once the PAPER side holds $50 or more, goes to **whichever side is short** (PLANK paid
     in simply stays PLANK).
3. **Pair and burn:** whenever both sides hold at least **$1**, the matching dollar amount of each is added to the
   PAPER/PLANK pool and the pool tokens go to the dead address. The rest waits for the other side to come in
   (each side arrives in its own transactions; nothing waits for both at once).
4. **The limit:** a side over **$100** burns its excess outright.
5. **Price guard:** every buy and every add is checked against the price averages (as the burners do today). If the
   pool's price is off, nothing is bought or added; the coins wait (still never over $100 a side).

Example: the contract holds $20 of PAPER from gradings. Two $5 PLANK payments come in: $10 of PAPER pairs with the
$10 of PLANK and burns as liquidity, $10 of PAPER keeps waiting.

## Safety (must hold)

- No withdraw, no owner path to the coins, no upgrade. The only ways out: liquidity burned to the dead address, or
  a side's excess over $100 burned.
- If adding liquidity ever fails, it falls back to waiting, and past $100 to burning: never stuck, never holding much.
- Before launch it is tested three ways: local tests on a real Uniswap V2 pool (lopsided amounts, tiny and huge
  amounts, price pushed before each run; after every run nothing over the limits is held and the pool tokens are
  at the dead address), the same tests on a copy of Robinhood Chain mainnet with the real PAPER/PLANK pool, and a
  testnet run with a page showing each pairing (in, added, burned, left).

## The model (Standard Series: 167 packs + 30 Extra, 200 game runs, 100 suggestions, PAPER at $0.08)

| Series | Into the contract | Burned as liquidity | PAPER bought | PLANK net | Over the limit |
|---|---|---|---|---|---|
| Quiet (120 packs) | $212 | $162 (76%) | $113 | −$47 | $0 |
| Standard | $404 | $355 (88%) | $187 | +$27 | $0 |
| Busy (300 packs, 60 Extra, 1,000 runs) | $1,252 | $1,207 (96%) | $528 | +$350 | $0 |

- PAPER gets most of the buying (about 7× PLANK's net on a Standard Series); PLANK still comes out ahead except in
  a quiet Series.
- PLANK sold: about $84 a Standard Series, in small pieces (group 2's PLANK buying PAPER).
- Revenue (groups 3 and 4): about $187 a Standard Series ($42 PLANK, $124 ETH, $21 USDG).
- Pausing the PAPER-first buying at $75 instead of $50: about $13 more PAPER bought, $25 less liquidity. $50 chosen.
- Assumptions to revisit with real numbers: buyers pay 30% PLANK / 55% ETH / 15% USDG; 15% of cards cased, 8%
  graded; price impact of the buys themselves not counted.
