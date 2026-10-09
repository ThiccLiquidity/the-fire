# Omni economy

How packs are sold, what they cost, and where every token goes. Implemented in
`contracts/src/cards/FireSale.sol` and `contracts/src/cards/FireCredits.sol` (free pack credits, card burning and
suggestions; tests: `contracts/test/cards/Sale.t.sol`), `contracts/src/cards/PlankBurner.sol` (the PLANK burn
fallback; tests: `contracts/test/cards/PlankBurner.t.sol`), `contracts/src/cards/FirePsa.sol`
(cases and grading; tests: `contracts/test/cards/Psa.t.sol`) and `contracts/src/cards/PaperBurner.sol` (fees burn
PAPER; tests: `contracts/test/cards/Burner.t.sol`). The models behind the numbers are in `sim/omni/`.

## The story

PLANK is the wood. It feeds the fire, and the fire runs the card minter. The minter needs PAPER: every card is
made of it. Each drop opens with PLANK lighting the forge.

## Every number is set per drop

The owner (the `OWNER` hardware wallet) sets these for each drop (each Series) before it launches (`configureDrop`). They lock when the drop opens
(its start time), so nothing can change while people are buying. The Series itself (its recipe: card types, pack
size and slots, holo odds, characters; see `docs/cards-contracts.md`) must be set up in the card contracts before its
drop can be set up, and locks when the drop is set up. The numbers below are the Standard sale (the studio's "Standard"
preset; its "Giant" preset is an example of a 10,000-pack drop with 100 per wallet and 100 per purchase). The full
list, with bounds, is in `docs/cards-contracts.md` ("Every sale and economy setting"). One number is **not** a
setting: cards burned per free pack is 42, forever.

| Setting | Start |
|---|---|
| Packs in the drop | 167 **total, starters included** (about 1,000 cards). Sold out means gone: no more packs for that Series, ever. |
| Gold cards | 2 per character (at least 1; set per Series in its recipe, before its drop is set up) |
| Full Art cards | 1 per character |
| Pack price | $2.50 |
| PAPER per pack | 1 |
| PAPER ceiling per pack | $1: a pack's PAPER is never worth more than this at the PAPER price (0 = no ceiling) |
| PLANK burn share | 30% |
| PLANK-only packs at the start | 50 |
| PLANK-only packs open to ETH/USDG after | 48 hours, sold or not |
| Press (starter) packs | 50 |
| Press packs per press / per wallet | 1 / 1 |
| Press pack price | 1 PAPER (can be free, a PAPER amount, a dollar price, or a dollar price + PAPER) |
| Press claim window | 24 hours |
| Holder window | 24 hours: only wallets with a Paper Press or $69+ of PLANK (secret snapshot) can buy paid packs |
| Wallet limit (paid packs) | 5 (0 = no limit) |
| Wallet limit lifts after | 48 hours |
| Regular wallets only for | 48 hours (0 = off) |
| Most packs per purchase | 50 |
| Credits per picked suggestion | 1 |
| Free (credit) packs per drop, in all / per wallet | 10% of the drop's packs (16 of 167) / 3 per wallet (0 = no limit) |
| Fresh PDA odds | 10: 1% · 9: 17% · 8: 25% · 7: 27% · 6: 20% · 5: 10% (grades 1-4 only from wear) |

## Setting up a drop

`configureDrop` counts **paid packs** only; starter packs come on top. A 167-pack drop with 50 starters is configured
as `packs = 117`, `starters = 50`. Setup is signed on the owner's hardware wallet; the public site has no admin pages.

## Holders first, and no bot contracts

- **The holder window (first 24 hours):** paid packs can only be bought by wallets that own at least one Paper
  Press, or that held at least $69 of PLANK at a secret snapshot taken before the drop.
  - **Press holders:** each press lets in one wallet per drop, so a press can't be passed around.
  - **PLANK holders:** the snapshot is taken with `ops/snapshot` (README there). It prints one code, the "root",
    which goes into the drop's settings. The live site is planned to load each buyer's proof automatically, so
    buyers do nothing extra (the site isn't connected to the chain yet).
  - **Not sold out after 24 hours:** it opens to everyone.
- **Regular wallets only for the first 48h** (its own setting, 0 = off; it used to be tied to the wallet limit).
  MetaMask, Rabby, OKX and the like are regular wallets. A bot contract can't spin up throwaway wallets to sweep a drop
  in one transaction.
- **Free pack credits** work at any time, including the holder window.

## A drop, start to finish

1. **Launch.** The holder window starts (24h: press holders and snapshot PLANK holders only). Two things open:
   - **Starter packs for press holders.**
   - **The paid sale, PLANK only, for the first 50 packs.**
2. **After 50 PLANK packs:** ETH and USDG can buy too. Safety valve: if the PLANK-only packs haven't sold by
   `plankOnlyFor` (48h; e.g. the PLANK price feed is down), ETH and USDG open anyway so a drop can't get stuck.
3. **24 hours:** the starter window closes. Unclaimed starters join the paid supply.
4. **48 hours, if not sold out:** the 5-per-wallet limit lifts completely.
5. **Sold out:** the drop is over.

## Buying packs

- **Every pack needs 1 PAPER, and it is burned.** "The minter needs paper." This includes starter and free packs.
  (Per drop: PAPER per paid/credit pack and PAPER per press pack are settings, 0 allowed.)
- **Never more than the drop's PAPER ceiling per pack** (`paperCapUsd`, per drop; Standard $1; 0 = no ceiling): if
  PAPER pumps past it, a pack takes the ceiling's worth (part of a PAPER) at the `PaperUsdTwap` price. Paid, press and
  free packs alike. While the feed is late, the last good PAPER price holds (`lastPaperUsd`); before the feed's first
  price, the set amount.
- **Packs are never paid for in PAPER.** The price is paid in PLANK, ETH or USDG only.
- **Paid pack:** $2.50 + 1 PAPER (at most $1 of PAPER in the Standard sale).
  - Every buy first checkpoints the PLANK price (`PlankUsdTwap.checkpoint()`, a cheap no-op when it isn't due; a
    failure is ignored). That keeps the price fresh only while buys or the keeper come at least every 2 hours: after a
    longer gap the checkpoint a buy makes spans more than 2 hours, so it can't refresh the price for itself; the keeper
    (or anyone) has to checkpoint twice, 30 minutes apart.
  - ETH uses the Chainlink price. PLANK uses the 30-minute pool average (`PlankUsdTwap`). USDG is taken at face value.
  - Every purchase carries the buyer's maximum. If a price moved past it, the purchase fails and costs nothing.
- **Where the money goes, in the same transaction:**
  - **30% burns PLANK.**
    - Paid in PLANK: 30% of that PLANK is burned directly.
    - Paid in ETH or USDG: the contract buys PLANK with 30% and burns it.
  - **If that swap fails** (e.g. PLANK's price jumped), the 30% goes to **`PlankBurner`** instead and the
    purchase still succeeds. A mint never fails because of PLANK. `PlankBurner` has no owner and no withdraw: anyone
    can call `flush`, which buys PLANK (at least 95% of what the 30-minute average says, trying half, a quarter and
    so on for a backlog) and sends it to the dead address; otherwise the share waits there.
  - **70% goes to the revenue wallet.**
  - The contract keeps nothing.
- **Up to 50 packs per purchase** by default (`maxPerTx`, set per drop; any number, e.g. 100 for a giant drop).
- **Gas (measured in tests, mock router; `test_gas`, `test_giantDrop_buy100InOneTx`):** about 98k for a PLANK buy and
  104k for ETH, the same for 1 pack or 100 (packs are one ERC-1155 mint). A real Uniswap swap adds about 60–90k more,
  so roughly 100k (PLANK) to 195k (ETH/USDG) per purchase. That's cents or less on Robinhood Chain.
- **The swap's floor:** it must get at least 90% of the PLANK that the 30-minute average price says. If the pool is
  pumped or manipulated beyond that, the swap is skipped and the burn share goes to `PlankBurner`.
- **If the drop never sells out:** the owner can end it (`endDrop`) once its last timed phase is over (press window,
  holder window, PLANK-only, wallet limit, regular wallets; 48h in the Standard sale), so every phase always runs in
  full. If the owner doesn't, anyone can, 7 days after that, so packs are never stranded. The Series closes with the
  packs that were minted.
- **One drop at a time.** The next drop can only be set up once the current one has closed.
- **Each Series stands alone.** Its cards come only from its own packs, by its own recipe. Standard recipe: Paper
  half, Fire 15%, Coal 4.9%, Gold 2 per character, Full Art 1 per character, Wood the rest. Nothing carries over
  between Series. Example: 167 packs, 20 characters make 501 Paper, 242 Wood, 150 Fire, 49 Coal, 40 Gold,
  20 Full Art.
- **Every purchase names its limits:** the most PLANK/USDG (or the ETH sent), and the most PAPER. If a number moved,
  the purchase fails and costs nothing.
- **Price feeds and the router** can be replaced by the owner only between drops (a retired Chainlink feed, a moved
  PLANK pool or a new router).
- **The PLANK price must be fresh:** the 30-minute average must have ended within the last 2 hours and cover at most
  2 hours. Otherwise PLANK purchases pause and the burn share of ETH/USDG sales goes to `PlankBurner`, until the
  price is fresh again (the keeper checkpoints every 30 minutes, and buys keep it fresh between those; after a gap
  over 2 hours it takes two checkpoints 30 minutes apart, which a buy can't do for itself).
- **Pause.** The owner can pause buying, press packs, credit spending and paid suggestions (`FireSale.setPaused`),
  and case and grading payments (`FirePsa.setPaused`). Opening packs, dealing, transfers, ending or closing a drop,
  burning cards, finishing or cancelling a grading and every keeper call never pause. A pause doesn't expire on its
  own: the owner lifts it.

## Starter packs

- **Who:** press holders only (Paper Press NFT). This is the bot filter: a press costs $94+. About 2,080
  presses exist.
- **Rules:** first come, first served. 1 per wallet. Each press counts once per drop, so passing one press
  around doesn't get extra packs. (Per drop: packs per press, e.g. 3, claimable in any split; packs per wallet.)
- **Price:** 1 PAPER, burned. No dollar price. (Per drop: free, a PAPER amount, a dollar price paid in PLANK, ETH or
  USDG like a paid pack with the same burn share, or a dollar price plus PAPER.)
- **Window:** 24 hours, then leftovers join the paid supply.
- **Trading:** starter packs are normal packs and can be traded sealed.
- **Known gap:** someone with many presses could spread them across wallets. Each one is still a real press.

## Free pack credits

Credits, card burning and suggestions live in `FireCredits` (split out of `FireSale` for contract size, same rules;
PAPER is still approved to `FireSale`, which takes it). Each wallet has a count of free pack credits. Credits **stack** and never expire. A credit is used in any live
drop: mint 1 pack for the drop's PAPER per pack (burned, within its PAPER ceiling), out of that drop's supply. If no drop is live, or it's sold out, the
credit waits for the next drop. **Credits work at any time during any live drop**: the holder
window, the PLANK-only packs and the wallet limit don't apply to them. A drop can cap how many free packs it gives
out in all (`creditPacksMax`) and per wallet (`creditPacksPerWallet`), so a big stack of credits can't take a large
share of a small drop; credits over a cap simply wait for another drop. The Standard sale caps free packs at 10% of
the drop's packs and 3 per wallet. Credits can't be spent on a Series whose packs hold 42 cards or more
(`FireCredits.useCredits` refuses it): burning one such pack would earn a free pack of itself.

Two ways to earn one:

- **Burn 42.0 cards.** Shown as "42.0" on the site. (`CARDS_PER_CREDIT`, a constant: it can **never** change, for
  any Series. Burn progress carries over from Series to Series, so changing the rate would change what people already
  burned toward.)
  - Each wallet keeps a running burn count that never resets: 3 one day + 2 the next = 5 of 42.
  - At 42 the wallet gets a credit, and extras carry over (burn 50 → 1 credit, 8 toward the next).
  - The count belongs to the wallet that burns.
  - Sim (`sim/omni/burn/`): about 1 free pack per 100 sold if people burn their Paper cards, about 5 per 100 if
    everyone burns all Paper and Wood. Below about 12 it gets close to an endless loop (a pack has 6 cards).
    Commons gain a floor of about 6¢ ($2.50 ÷ 42).
- **Your character suggestion gets picked.** The owner grants these while setting up that Series' drop (before it
  opens), no more picks than the Series has characters, and each suggestion once. Credits per pick are set per drop
  (1 to start; 0 = none). With one drop at a time, picks only
  happen while no drop is running. A picked credit is an ordinary credit: any drop, any time.

The site tells the two stories differently ("You burned 42.0" vs. "Your character made it"). The contract uses
one credit count for both.

## PAPER: value through use

Every PAPER spent anywhere is burned.

| Use | Cost |
|---|---|
| Any pack (paid, starter or free) | 1 PAPER per pack, never more than the drop's PAPER ceiling ($1 in the Standard sale) |
| Character suggestion | 1 PAPER, never more than $1 of PAPER (owner setting, `FireCredits.setSuggestionRules`, any amount incl. 0; the suggester names their most). Open all the time. The list clears after every picking session: picking for a Series takes the current list, new suggestions start the next list, and unpicked ones don't carry over. A suggestion is a character plus an optional personality and background, packed into one text (`Character: …` / `Personality: …` / `Background: …` lines, `docs/cards-contracts.md`); set the longest text to about 1,000 bytes. |
| Cases and grading | Paid in ETH, USDG or PLANK, not PAPER. 100% of it buys PAPER and burns it (`PaperBurner`). |

- **The PAPER price feed.** PAPER already has a live pool, but `PAPER_USD_FEED` must be the deployed `PaperUsdTwap`
  (step 2 of `docs/deploy.md`), never the pool itself. It prices the PAPER ceilings and guards the fee burn. The feed
  adopts a PAPER/WETH, PAPER/USDG or PAPER/PLANK pool (PLANK valued through `PlankUsdTwap`) only once it holds at least
  $10 on its other side (`MIN_LIQUIDITY_USD`; any real pool, however thin) and at least 1,000 PAPER
  (`MIN_PAPER_RESERVE`, so a lopsided pool like "$11 against a speck of PAPER" can't set the price) at every
  checkpoint for 20 hours; while the adopted pool holds under 1,000 PAPER its price reads 0 and any real pool can take
  over. Nothing reacts to price swings. It reports its first price one
  full 20-hour window later: about 40 hours after the first checkpoint. Until then packs take the set PAPER (no
  ceiling) and case and grading fees wait in `PaperBurner`. If the feed later goes quiet, the last good price holds. The owner
  can replace the sale's feed between drops (`FireSale.setFeeds`); the burner's feeds are set once.
- **Get PAPER on the site (planned):** a small box where you type how many PAPER you want, see the ETH price, and
  press one button. It would use the KyberSwap swap guard in `web/src/lib` with the 0.5% fee to the swap-fee wallet.
  In the buy panel it would show up when someone is short ("You need 1 PAPER per pack. Get 3 PAPER for $0.15").
- **Scale:** 167 packs × 2 drops a month burns about 334 PAPER a month against about 63,000 printed (about 2,080 presses). Case and grading fees add
  about 2,500 PAPER per Series at $0.08 (final numbers audit). This is a
  reason to hold PAPER more than a big burn.

## Cases and PDA grading

**PDA** stands for Professional Digital Authenticators, a nod to real-world card grading. (The contract keeps its
original name, `FirePsa`.) The full rules (hidden condition, wear, fresh odds, slabs) are in `docs/grading.md`.

- **Every card has a hidden condition.** It wears with time uncased and with every move between wallets. A **Case**
  freezes it. **Grading** reveals the PDA grade (1-10) once and seals the card in a **Slab**: final, no regrade.
- **Prices:** Case $0.05, grading $1 per card, paid in ETH, USDG or PLANK (never PAPER). The owner can change them
  (`setPrices`, each at most $100). Up to 20 cards per transaction (`setMaxBatch`, at most 100), cases and grades
  together (`protect`).
- **100% of every fee buys PAPER and burns it** (`PaperBurner`), none of it goes to us. The burner takes the best
  owner-set route (or half and half across two routes that share no pool) and refuses to buy below 95% of the PAPER
  the 20-hour price feed says the fee is worth (trying half, a quarter and so on if the whole amount is too much for
  the pools); then the fee waits in the burner for a later buy. It has no withdraw, and nobody can redirect it: its
  router is fixed, its feeds are set once, and its routes only pass through WETH, PLANK or USDG.
- **The holder names the most they'll pay;** if the price moved, the batch fails and costs nothing.
- **While a card is being graded it can't be transferred** (it can still be burned), so nobody can sell a card whose
  drand number they've already seen.
- **If randomness is gone for good** (no answer for 7 days), anyone can cancel a grading (`cancelGrading`): the cards
  unlock, still ungraded. The fee was burned. Opens work the same way: a stuck open can be cancelled after 7 days and
  the packs come back sealed.
- **Fresh odds** (a card cased or graded within 24 hours of opening): constants in `FirePsa` (`freshOdds`), fixed
  forever, the same for every Series and every material. Grades 1-4 come only from long raw holds:

| Grade | Fresh odds | Out of 10,000 | Wear frame |
|---|---|---|---|
| 10 | 1% | 100 | Clean frame + gold glow |
| 9 | 17% | 1,700 | Level 2 |
| 8 | 25% | 2,500 | Level 2 |
| 7 | 27% | 2,700 | Level 3 |
| 6 | 20% | 2,000 | Level 3 |
| 5 | 10% | 1,000 | Level 4 |
| 4 | - (wear only) | 0 | Level 4 |
| 3 | - (wear only) | 0 | Level 5 |
| 2 | - (wear only) | 0 | Level 5 |
| 1 | - (wear only) | 0 | Level 6 |

## Wallets (separate jobs)

| Wallet | Gets |
|---|---|
| Revenue | 70% of every sale. Nothing else. The wallets can only be changed while no drop is set up or running. |
| `PlankBurner` (a contract, not a wallet) | The 30% when a PLANK swap fails. No owner, no withdraw: it can only buy PLANK and burn it. The sale's pointer to it can only change while no drop is set up or running. |
| (none) | Case and grading fees: 100% to `PaperBurner`, which only buys and burns PAPER. No revenue to the team. |
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
