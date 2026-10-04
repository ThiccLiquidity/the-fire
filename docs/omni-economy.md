# Omni economy

Decided with the owner on Oct 3 2026, one piece at a time. This replaces the earlier economy notes in
`docs/cards-contracts.md`. Built in `contracts/src/cards/FireSale.sol` (tests: `contracts/test/cards/Sale.t.sol`) and
`contracts/src/cards/FirePsa.sol` (the PSA reveal; tests: `contracts/test/cards/Psa.t.sol`).
Sims are in `sim/omni/`. The visual map is `docs/omni-money-map.html` (also published as the "Omni Money Map" artifact).

## The story

PLANK is the wood. It feeds the fire, and the fire runs the card minter. The minter needs PAPER: every card is
made of it. Each drop opens with PLANK lighting the forge.

## Every number is set per drop

The owner sets these for each drop (each Fire) before it launches (`configureDrop`). They lock when the drop opens
(its start time), so nothing can change while people are buying. The Fire's characters must be set in the card
contract (`configureFire`) before its drop can be set up. The
numbers below are the starting values.

| Setting | Start |
|---|---|
| Packs in the drop | 167 (about 1,000 cards). Sold out means gone: no more packs for that Fire, ever. |
| Pack price | $2.50 |
| PAPER per pack | 1 |
| PLANK burn share | 30% |
| PLANK-only packs at the start | 50 |
| Starter packs | 50 |
| Starter window | 24 hours |
| Wallet limit (paid packs) | 5 |
| Wallet limit lifts after | 48 hours |
| PSA odds | 2 / 10 / 38 / 38 / 10 / 2% |

## A drop, start to finish

1. **Launch.** Two things open at once:
   - **Starter packs for press holders.**
   - **The paid sale, PLANK only, for the first 50 packs.**
2. **After 50 PLANK packs:** ETH and USDG can buy too. Safety valve: if the PLANK-only packs haven't sold by the time
   the wallet limit lifts (e.g. the PLANK price feed is down), ETH and USDG open anyway so a drop can't get stuck.
3. **24 hours:** the starter window closes. Unclaimed starters join the paid supply.
4. **48 hours, if not sold out:** the 5-per-wallet limit lifts completely.
5. **Sold out:** the drop is over.

## Buying packs

- **Every pack needs 1 PAPER, and it is burned.** "The minter needs paper." This includes starter and free packs.
- **Packs are never paid for in PAPER.** The price is paid in PLANK, ETH or USDG only.
- **Paid pack:** $2.50 + 1 PAPER.
  - ETH uses the Chainlink price. PLANK uses the 30-minute pool average (`PlankUsdTwap`). USDG is taken at face value.
  - Every purchase carries the buyer's maximum. If a price moved past it, the purchase fails and costs nothing.
- **Where the money goes, in the same transaction:**
  - **30% burns PLANK.**
    - Paid in PLANK: 30% of that PLANK is burned directly.
    - Paid in ETH or USDG: the contract buys PLANK with 30% and burns it.
  - **If that swap fails** (e.g. PLANK's price jumped), the 30% goes to the **burn wallet** instead and the
    purchase still succeeds. A mint never fails because of PLANK. The burn wallet only ever buys and burns PLANK.
  - **70% goes to the revenue wallet.** It's the owner's; the owner announces what they do with it.
  - The contract keeps nothing.
- **Gas (measured in tests, mock router):** about 93k for a 1-pack PLANK buy and 95k for ETH. A real Uniswap swap adds
  about 60–90k more, so roughly 100k (PLANK) to 180k (ETH/USDG) per purchase, any number of packs. That's cents or less
  on Robinhood Chain.
- **The swap's floor:** it must get at least 90% of the PLANK that the 30-minute average price says. If the pool is
  pumped or manipulated beyond that, the swap is skipped and the burn share goes to the burn wallet.
- **If the drop never sells out:** the owner can end it (`endDrop`), but only after the wallet limit has lifted (48h),
  so the starter window and the limited phase always run in full. The Fire closes with the packs that were minted.
- **The PLANK price must be fresh:** the 30-minute average must have ended within the last 2 hours and cover at most
  2 hours. Otherwise PLANK purchases pause and the burn share of ETH/USDG sales goes to the burn wallet, until the
  keeper checkpoints again (it does every 30 minutes).

## Starter packs

- **Who:** press holders only (Paper Press NFT). This is the bot filter: a press costs $94+.
- **Rules:** first come, first served. 1 per wallet. Each press counts once per drop, so passing one press
  around doesn't get extra packs.
- **Price:** 1 PAPER, burned. No dollar price.
- **Window:** 24 hours, then leftovers join the paid supply.
- **Trading:** starter packs are normal packs and can be traded sealed.
- **Known gap:** someone with many presses could spread them across wallets. Each one is still a real press.

## Free pack credits

Each wallet has a count of free pack credits. Credits **stack** and never expire. A credit is used in any live
drop: mint 1 pack for 1 PAPER (burned), out of that drop's supply. If no drop is live, or it's sold out, the
credit waits for the next drop. Two ways to earn one:

- **Burn 42.0 cards.** Shown as "42.0" on the site.
  - Each wallet keeps a running burn count that never resets: 3 one day + 2 the next = 5 of 42.
  - At 42 the wallet gets a credit, and extras carry over (burn 50 → 1 credit, 8 toward the next).
  - The count belongs to the wallet that burns.
  - Sim (`sim/omni/burn/`): about 1 free pack per 100 sold if people burn their Paper cards, about 5 per 100 if
    everyone burns all Paper and Wood. Below about 12 it gets close to an endless loop (a pack has 6 cards).
    Commons gain a floor of about 6¢ ($2.50 ÷ 42).
- **Your character suggestion gets picked.** The owner grants these while setting up that Fire's drop (before it
  opens), at most one per character, and each suggestion once. A picked credit can only be used in **that Fire's
  drop** (burn credits work in any drop), so picks can never take packs from another drop.

The site tells the two stories differently ("You burned 42.0" vs. "Your character made it"). The contract uses
one credit count for both.

## PAPER: value through use

Every PAPER spent anywhere is burned.

| Use | Cost |
|---|---|
| Any pack (paid, starter or free) | 1 PAPER per pack |
| Character suggestion | 1 PAPER. Open all the time. The list clears after every picking session: picking for a Fire takes the current list, new suggestions start the next list, and unpicked ones don't carry over. |
| PSA reveal | The most whole PAPER that stays under $0.25 (at least 1). PAPER $0.05 → 5; $0.03 → 8; $0.30 → 1. Uses `PaperUsdTwap`; a set number until PAPER has a real market. PAPER only. |

- **Get PAPER on the site:** a small box where you type how many PAPER you want, see the ETH price, and press one
  button. It uses the existing KyberSwap swap with the 0.5% fee to the swap-fee wallet. In the buy panel it shows
  up when someone is short ("You need 1 PAPER per pack. Get 3 PAPER for $0.15").
- **Scale:** 167 packs × 2 drops a month burns about 334 PAPER a month against about 30,000 printed. This is a
  reason to hold PAPER more than a big burn.

## PSA reveal

- Once per card, up to 10 at a time. The PAPER is burned, then drand picks the grade. It sets the grade, and the card
  switches to that wear frame and seal ring colour.
- Before PAPER has a price, a reveal costs a set number of PAPER (5 to start, the owner can change it).
- The owner can give a Fire different odds, but only before its first pack exists, so every buyer knows the odds.
- **The holder names the most PAPER they'll pay;** if the price moved, the reveal fails and costs nothing.
- **While a card is being graded it can't be transferred** (it can still be burned), so nobody can sell a card
  whose drand number they've already seen as "Unrevealed".
- **During a gap in the PAPER price feed,** reveals cost the last price-based amount, not the starting number.
- **Odds** are a perfect curve, the same for every material:

| Grade | Odds |
|---|---|
| 10 | 2% |
| 9–8 | 10% |
| 7–6 | 38% |
| 5–4 | 38% |
| 3–2 | 10% |
| 1 | 2% |

## Wallets (separate jobs)

| Wallet | Gets |
|---|---|
| Revenue | 70% of every sale. Nothing else. The wallets can only be changed while no drop is set up or running. |
| Burn | The 30% when a PLANK swap fails. Only ever buys and burns PLANK. |
| Royalty | 5% resale royalty (ERC-2981), where marketplaces honour it. |
| Swap fee | 0.5% of site swaps (existing `SWAP_FEE_WALLET`). |

## Money, roughly

At $2.50 and 70% to revenue:

| Packs per week | Per month to revenue |
|---|---|
| 100 | ~$760 |
| 150 | ~$1,140 |
| 200 | ~$1,520 |

Plus small royalties and swap fees. Running costs:
- gas to deal opened packs, about 1–3¢ a pack
- image storage and hosting, about $20–40 a month
- an audit before launch, which is the big one

PLANK burned at that pace: about $3,900–7,800 a year.

## Why these numbers (from the sims)

- **167 packs** is the size that sells out with normal demand. A sold-out Fire's packs resell above their
  price, and bigger or open-ended drops don't.
  - Viral demand is answered with more drops, not bigger ones.
- **A flat $2.50** is fair to everyone.
  - At $1, flippers took the gap (packs resold at up to 14×). At $5, nothing sold out.
  - Price steps were rejected as unfair to later buyers.
- **Bots:** a wallet limit is a fairness rule, not bot protection. The press gate is what keeps bots off the
  starter packs.
  - Alternatives that were rejected:
    - first come, first served for anyone: bots took ~100%
    - a PLANK-holding snapshot: ~57%
    - random presses: rejected as too limiting

## Still open

- Gas measured against the real Uniswap router: `test/cards/SaleFork.t.sol` is ready to run from PowerShell.
- The site screens for all of this (with the redesign).
- Marketplace support on Robinhood Chain.
- Before launch: a trademark search, a lawyer's read on sealed packs, an audit, and a testnet run.
