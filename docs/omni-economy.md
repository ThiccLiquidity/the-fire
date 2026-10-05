# Omni economy

How packs are sold, what they cost, and where every token goes. Implemented in
`contracts/src/cards/FireSale.sol` (tests: `contracts/test/cards/Sale.t.sol`) and `contracts/src/cards/FirePsa.sol`
(the PDA reveal; tests: `contracts/test/cards/Psa.t.sol`). The models behind the numbers are in `sim/omni/`.

## The story

PLANK is the wood. It feeds the fire, and the fire runs the card minter. The minter needs PAPER: every card is
made of it. Each drop opens with PLANK lighting the forge.

## Every number is set per drop

The owner (the `OWNER` multisig) sets these for each drop (each Series) before it launches (`configureDrop`). They lock when the drop opens
(its start time), so nothing can change while people are buying. The Series' characters must be set in the card
contract (`configureFire`) before its drop can be set up. The
numbers below are the starting values.

| Setting | Start |
|---|---|
| Packs in the drop | 167 **total, starters included** (about 1,000 cards). Sold out means gone: no more packs for that Series, ever. |
| Diamonds | 1 (at least 1; set per Series in the card contract, `setDiamonds`, before its packs sell) |
| Pack price | $2.50 |
| PAPER per pack | 1 |
| PLANK burn share | 30% |
| PLANK-only packs at the start | 50 |
| Starter packs | 50 |
| Starter window | 24 hours |
| Holder window | 24 hours: only wallets with a Paper Press or $69+ of PLANK (secret snapshot) can buy paid packs |
| Wallet limit (paid packs) | 5 |
| Wallet limit lifts after | 48 hours |
| PDA odds | 10: 1% · 9: 17% · 8: 24% · 7: 25% · 6: 18% · 5: 7% · 4: 3.5% · 3: 2% · 2: 1.5% · 1: 1% |

## Setting up a drop

`configureDrop` counts **paid packs** only; starter packs come on top. A 167-pack drop with 50 starters is configured
as `packs = 117`, `starters = 50`. Setup is a multisig transaction; the public site has no admin pages.

## Holders first, and no bot contracts

- **The holder window (first 24 hours):** paid packs can only be bought by wallets that own at least one Paper
  Press, or that held at least $69 of PLANK at a secret snapshot taken before the drop.
  - **Press holders:** each press lets in one wallet per drop, so a press can't be passed around.
  - **PLANK holders:** the snapshot is taken with `ops/snapshot` (README there). It prints one code, the "root",
    which goes into the drop's settings. The live site is planned to load each buyer's proof automatically, so
    buyers do nothing extra (the site isn't connected to the chain yet).
  - **Not sold out after 24 hours:** it opens to everyone.
- **Regular wallets only while the wallet limit is on (48h).** MetaMask, Rabby, OKX and the like are regular wallets.
  A bot contract can't spin up throwaway wallets to sweep a drop in one transaction.
- **Free pack credits** work at any time, including the holder window.

## A drop, start to finish

1. **Launch.** The holder window starts (24h: press holders and snapshot PLANK holders only). Two things open:
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
  - **70% goes to the revenue wallet.**
  - The contract keeps nothing.
- **Up to 50 packs per purchase** (`MAX_PER_TX`).
- **Gas (measured in tests, mock router; `test_gas`):** about 96k for a 1-pack PLANK buy and 101k for ETH. A real
  Uniswap swap adds about 60–90k more, so roughly 100k (PLANK) to 190k (ETH/USDG) per purchase, whether it is 1 pack
  or 50. That's cents or less on Robinhood Chain.
- **The swap's floor:** it must get at least 90% of the PLANK that the 30-minute average price says. If the pool is
  pumped or manipulated beyond that, the swap is skipped and the burn share goes to the burn wallet.
- **If the drop never sells out:** the owner can end it (`endDrop`) once the wallet limit has lifted (48h), so the
  starter window and the limited phase always run in full. If the owner doesn't, anyone can, 7 days after that, so
  packs are never stranded. The Series closes with the packs that were minted.
- **One drop at a time.** The next drop can only be set up once the current one has closed.
- **Each Series stands alone.** Its cards come only from its own packs: Paper half, Fire 15%,
  Coal 4.9%, Diamond as set (at least 1), Wood the rest. Nothing carries over between Series. Example: 167 packs
  and 1 Diamond make 501 Paper, 301 Wood, 150 Fire, 49 Coal, 1 Diamond.
- **Every purchase names its limits:** the most PLANK/USDG (or the ETH sent), and the most PAPER. If a number moved,
  the purchase fails and costs nothing.
- **Price feeds and the router** can be replaced by the owner only between drops (a retired Chainlink feed, a moved
  PLANK pool or a new router).
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
credit waits for the next drop. **Credits work at any time during any live drop**: the holder
window, the PLANK-only packs and the wallet limit don't apply to them. Two ways to earn one:

- **Burn 42.0 cards.** Shown as "42.0" on the site.
  - Each wallet keeps a running burn count that never resets: 3 one day + 2 the next = 5 of 42.
  - At 42 the wallet gets a credit, and extras carry over (burn 50 → 1 credit, 8 toward the next).
  - The count belongs to the wallet that burns.
  - Sim (`sim/omni/burn/`): about 1 free pack per 100 sold if people burn their Paper cards, about 5 per 100 if
    everyone burns all Paper and Wood. Below about 12 it gets close to an endless loop (a pack has 6 cards).
    Commons gain a floor of about 6¢ ($2.50 ÷ 42).
- **Your character suggestion gets picked.** The owner grants these while setting up that Series' drop (before it
  opens), no more picks than the Series has characters, and each suggestion once. With one drop at a time, picks only
  happen while no drop is running. A picked credit is an ordinary credit: any drop, any time.

The site tells the two stories differently ("You burned 42.0" vs. "Your character made it"). The contract uses
one credit count for both.

## PAPER: value through use

Every PAPER spent anywhere is burned.

| Use | Cost |
|---|---|
| Any pack (paid, starter or free) | 1 PAPER per pack |
| Character suggestion | 1 PAPER. Open all the time. The list clears after every picking session: picking for a Series takes the current list, new suggestions start the next list, and unpicked ones don't carry over. |
| PDA reveal | The most whole PAPER that stays at or under $0.25. Past $0.25 a PAPER, 1 PAPER, capped at $1: past $1 a PAPER, $1 worth (part of a PAPER, never 0). PAPER $0.05 → 5; $0.03 → 8; $0.30 → 1; $4 → 0.25. Priced by `PaperUsdTwap`; a set number of PAPER until it has a price. PAPER only. |

- **The PAPER price feed.** PAPER already has a live pool, but `PAPER_USD_FEED` must be the deployed `PaperUsdTwap`
  (step 2 of `docs/deploy.md`), never the pool itself. The feed adopts a PAPER/WETH or PAPER/USDG pool only once it
  holds at least $1,000 on its dollar side (`MIN_LIQUIDITY_USD`) at every checkpoint for 20 hours, then reports its
  first price one full 20-hour window later: about 40 hours after the first checkpoint. Until then reveals cost the
  set number of PAPER. The owner can replace the feed later (`FirePsa.setPaperFeed`, only a feed for this PAPER).
- **Get PAPER on the site (planned):** a small box where you type how many PAPER you want, see the ETH price, and
  press one button. It would use the KyberSwap swap guard in `web/src/lib` with the 0.5% fee to the swap-fee wallet.
  In the buy panel it would show up when someone is short ("You need 1 PAPER per pack. Get 3 PAPER for $0.15").
- **Scale:** 167 packs × 2 drops a month burns about 334 PAPER a month against about 30,000 printed. This is a
  reason to hold PAPER more than a big burn.

## PDA reveal

**PDA** stands for Professional Digital Authenticators, a nod to real-world card grading. (The contract keeps its
original name, `FirePsa`.)

- Once per card, up to 10 at a time. The PAPER is burned, then drand picks the grade. It sets the grade, and the card
  switches to that wear frame and seal ring colour.
- Before PAPER has a price, a reveal costs a set number of PAPER (5 to start, the owner can change it).
- The owner can give a Series different odds, but only before its first pack exists, so every buyer knows the odds.
- **If randomness is gone for good** (no answer for 7 days), anyone can cancel a reveal: the cards unlock, still
  unrevealed. The PAPER was burned. Opens work the same way: a stuck open can be cancelled after 7 days and the packs
  come back sealed.
- **The holder names the most PAPER they'll pay;** if the price moved, the reveal fails and costs nothing.
- **While a card is being graded it can't be transferred** (it can still be burned), so nobody can sell a card
  whose drand number they've already seen as "Unrevealed".
- **During a gap in the PAPER price feed,** reveals cost the last price-based amount, not the starting number.
- **Odds** (defaults in `FirePsa.oddsOf`; most cards land 6-9 and a 10 is rare), the same for every material:

| Grade | Odds | Out of 10,000 | Wear frame |
|---|---|---|---|
| 10 | 1% | 100 | Clean frame + gold glow |
| 9 | 17% | 1,700 | Level 2 |
| 8 | 24% | 2,400 | Level 2 |
| 7 | 25% | 2,500 | Level 3 |
| 6 | 18% | 1,800 | Level 3 |
| 5 | 7% | 700 | Level 4 |
| 4 | 3.5% | 350 | Level 4 |
| 3 | 2% | 200 | Level 5 |
| 2 | 1.5% | 150 | Level 5 |
| 1 | 1% | 100 | Level 6 |

## Wallets (separate jobs)

| Wallet | Gets |
|---|---|
| Revenue | 70% of every sale. Nothing else. The wallets can only be changed while no drop is set up or running. |
| Burn | The 30% when a PLANK swap fails. Only ever buys and burns PLANK. |
| Royalty | 5% resale royalty (ERC-2981), where marketplaces honour it. |
| Swap fee | 0.5% of site swaps, once the site's swap is live (`SWAP_FEE_WALLET` in `web/src/lib/config.ts`, not set yet). |

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
- security review before launch

PLANK burned at that pace: about $3,900–7,800 a year.

## Why these numbers (from the sims)

- **167 packs** is the size that sells out with normal demand. A sold-out Series' packs resell above their
  price, and bigger or open-ended drops don't.
  - Viral demand is answered with more drops, not bigger ones.
- **A flat $2.50** is fair to everyone.
  - At $1, flippers took the gap (packs resold at up to 14×). At $5, nothing sold out.
  - Price steps were rejected as unfair to later buyers.
- **Bots:** a wallet limit is a fairness rule, not bot protection. The press gate is what keeps bots off the
  starter packs.
  - Starter-pack gates that were rejected:
    - first come, first served for anyone: bots took ~100%
    - a PLANK-holding snapshot alone: bots took ~57%
    - random presses: too limiting
  - For the paid sale, the holder window (presses plus the PLANK snapshot) and the regular-wallets rule keep one
    bot contract from sweeping a drop.

## Still open

See `docs/roadmap.md`.
