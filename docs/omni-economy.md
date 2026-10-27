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
(its start time), so nothing can change while people are buying. The Series itself (its recipe: card types, the pack's
slots and their odds, holo odds, characters and optionally their odds; see `docs/cards-contracts.md`) must be set up in the card contracts before its
drop can be set up, and locks when the drop is set up. The numbers below are the Standard sale (the studio's "Standard"
preset; its "Giant" preset is an example of a 10,000-pack drop with 50 per wallet and 100 per purchase). The full
list, with bounds, is in `docs/cards-contracts.md` ("Every sale and economy setting"). One number is **not** a
setting: cards burned per free pack is 42, forever.

| Setting | Start |
|---|---|
| Packs in the drop | 167 **total, every group included** (about 1,000 cards). Sold out means gone: no more packs for that Series, ever. |
| Groups | 4 (below): Press holders 50, PLANK holders 40, Everyone 77 (+ leftovers), After sell-out (no pack count: the Series is 167 packs plus whatever sells after the sell-out) |
| Pack (every pack, same odds) | 6 cards: 3 Paper · 1 Wood · 1 Wood or better (Wood 44.9%, Fire 30%, Coal 12%, Gold 8.6%, Full Art 4.5%) · 1 Fire or better (Fire 59.82%, Coal 17.34%, Gold 15.34%, Full Art 7.5%). Per pack on average 3 Paper, 1.449 Wood, 0.8982 Fire, 0.2934 Coal, 0.2394 Gold, 0.12 Full Art: of all cards Paper 50%, Wood 24.15%, Fire 14.97%, Coal 4.89%, Gold 3.99%, Full Art 2% (the Standard recipe; set per Series, before its drop is set up) |
| Character odds | Equal (optional weights per Series) |
| Pack price | $2.50 (the PLANK and Everyone groups; press packs have no dollar price) |
| PAPER per pack | 1 (every group) |
| PAPER ceiling per pack | $1: a pack's PAPER is never worth more than this at the PAPER price (0 = no ceiling) |
| PLANK burn share | 10% (every group; each group sets its own) |
| PAPER buy & burn share | 20% (every group; to `PaperBurner`, which buys PAPER on the market and burns it) |
| Group 1: Paper Press holders | 50 packs, 1 PAPER each, 1 per press, opens with the drop, up to 6 hours, leftovers to Everyone |
| Group 2: PLANK holders | 40 packs, snapshot ($69+ of PLANK held for 7 days), $2.50 + 1 PAPER, PLANK only, 5 per wallet, opens with the drop, up to 24 hours, leftovers to Everyone |
| Group 3: Everyone | 77 packs + leftovers, $2.50 + 1 PAPER, any coin, 5 per wallet, opens when group 2 ends, until sold |
| Group 4: After sell-out | no pack count, $2.50 rising 4% a pack (the k-th costs $2.50 × 1.04^k; everything above $2.50 buys and burns PAPER) + 1 PAPER, ETH only, 1 pack per purchase, no wallet limit, opens the moment Everyone sells out, ends 15 minutes after its last sale (no time limit otherwise) |
| Regular wallets only for | 48 hours (0 = off) |
| Most packs per purchase | 50 |
| Credits per picked suggestion | 1 |
| Free (credit) packs per drop, in all / per wallet | 10% of the drop's packs (16 of 167) / 3 per wallet (0 = no limit), from group 3 |
| Fresh PDA odds | 10: 1% · 9: 30% · 8: 40% · 7: 29% (grades 1-6 only from wear) |

## Setting up a drop

`configureDrop` takes the **total** packs and the groups that split them (1 to 6; `docs/drop-groups.md`, the JSON
shape in `docs/cards-contracts.md`). Each group says who can buy (anyone, holders of an NFT, or wallets in a
snapshot), how many, at what price and PAPER, in which coins, how many per wallet, when it opens (with the drop, or
when another group ends, plus a delay), how long it stays open, and where its unsold packs go (another group, or
nowhere). Setup is signed on the owner's hardware wallet; the public site has no admin pages.

## Groups, holders first, and no bot contracts

- **Holders first, by group.** The Standard drop opens with two holder groups side by side:
  - **Paper Press holders** (an NFT group): each press claims 1 pack per drop, for 1 PAPER. Each press is checked live
    and spent once its allowance is used, whoever holds it later, so passing a press around never claims again.
  - **PLANK holders** (a snapshot group): wallets that held $69+ of PLANK for 7 days, from `ops/snapshot` (README
    there). It prints one code, the "root", which goes into the group. Each wallet's entry carries its allowance (so
    tiers like "1M PLANK = 2 packs, 10M = 5" are possible); the group's wallet limit (5) still caps it. The live site
    loads each buyer's proof, so buyers do nothing extra.
  - **Everyone** opens when the PLANK group ends: when its 40 packs are gone, or after 24 hours.
- **A group ends** the moment its packs are gone (and no leftovers can still arrive), or when its time runs out. Its
  unsold packs then go where it says: the press and PLANK groups' leftovers go to Everyone, so every pack still sells.
- **Regular wallets only for the first 48h** (its own setting, 0 = off). MetaMask, Rabby, OKX and the like are regular
  wallets. A bot contract can't spin up throwaway wallets to sweep a drop in one transaction.
- **Free pack credits** spend packs from the credit group (Everyone in the Standard drop) while it is open.

## A drop, start to finish (Standard)

1. **Launch.** The press group and the PLANK group open together. Press holders claim their packs (PAPER only);
   snapshot PLANK holders buy theirs, in PLANK.
2. **The PLANK group ends** (sold out, or 24 hours): Everyone opens straight away, any coin, 5 per wallet.
3. **6 hours** (or sooner if every press pack is claimed): the press group ends; unclaimed press packs join Everyone.
4. **Everyone sells out:** "After sell-out" opens at once: extra packs, one per purchase, whose price rises 4% with
   every pack sold (the 50th costs about $17.8, the 100th about $126); the whole rise buys and burns PAPER. There is
   no count and no time limit: the rising price caps demand, and the group ends 15 minutes after its last sale. (A
   safety bound on the maths refuses any pack past 1e9 times $2.50, about pack 528: not a sales cap.)
5. **The Series closes the moment its last pack that can still be made is minted**, however early. If Everyone sells
   out while the press group still has packs, the Series stays open: press holders can still claim until their 6
   hours are up, and whatever they leave then rolls into Everyone, which sells it. Leftovers that roll nowhere are
   never made (the Series is smaller); then anyone (the keeper) calls `close`.

## Buying packs

- **Every pack needs 1 PAPER, and it is burned.** "The minter needs paper." This includes press and free packs.
  (Per group: PAPER per pack is a setting, 0 allowed; credit packs take their group's.)
- **Never more than the drop's PAPER ceiling per pack** (`paperCapUsd`, per drop; Standard $1; 0 = no ceiling): if
  PAPER pumps past it, a pack takes the ceiling's worth (part of a PAPER) at the `PaperUsdTwap` price. Every group's
  packs and free packs alike. While the feed is late, the last good PAPER price holds (`lastPaperUsd`); before the feed's first
  price, the set amount.
- **Packs are never paid for in PAPER.** The price is paid in PLANK, ETH or USDG only, in the coins the group takes.
- **A purchase names its group** (`buy(fire, group, n, pay, maxCost, maxPaper, access)`; `access` shows the buyer's
  NFTs or snapshot proof for a holder group).
- **Paid pack:** $2.50 + 1 PAPER (at most $1 of PAPER in the Standard sale). A group can also be PAPER only (the
  press group) or free.
  - Every buy first checkpoints the PLANK price (`PlankUsdTwap.checkpoint()`, a cheap no-op when it isn't due; a
    failure is ignored). That keeps the price fresh only while buys or the keeper come at least every 2 hours: after a
    longer gap the checkpoint a buy makes spans more than 2 hours, so it can't refresh the price for itself; the keeper
    (or anyone) has to checkpoint twice, 30 minutes apart.
  - ETH uses the Chainlink price. PLANK uses the 30-minute pool average (`PlankUsdTwap`). USDG is taken at face value.
  - Every purchase carries the buyer's maximum. If a price moved past it, the purchase fails and costs nothing.
- **Where the money goes, in the same transaction:**
  - **20% buys PAPER and burns it.** It goes to **`PaperBurner`** in the coin it was paid in (ETH, PLANK or USDG);
    the keeper flushes it, buying PAPER on the market (95% guard against the 20-hour PAPER price) and sending it to
    the dead address. This is the sale's market buy pressure on PAPER (goal 1). While the PAPER price feed has no
    price yet, or the guard says no, it waits in `PaperBurner` (no withdraw) for a later buy.
  - **10% burns PLANK.**
    - Paid in PLANK: 10% of that PLANK is burned directly.
    - Paid in ETH or USDG: the contract buys PLANK with 10% and burns it.
  - **If that swap fails** (e.g. PLANK's price jumped), the 10% goes to **`PlankBurner`** instead and the
    purchase still succeeds. A mint never fails because of PLANK. `PlankBurner` has no owner and no withdraw: anyone
    can call `flush`, which buys PLANK (at least 95% of what the 30-minute average says, trying half, a quarter and
    so on for a backlog) and sends it to the dead address; otherwise the share waits there.
  - **70% goes to the revenue wallet.**
  - Both shares are set per group, with the drop (`plankBurnBps`, `paperBurnBps` on each group; together at most
    100%), and lock when it opens. The Standard drop uses 10% / 20% in every group; the PLANK holders' group could
    instead burn 100% of the PLANK it takes (nothing to PaperBurner or revenue from those sales).
  - The buyer pays exactly the quoted cost, whatever the shares: nothing can take more.
  - The contract keeps nothing.
- **ETH alone:** `buyWithEthAll` takes the price and the packs' PAPER in one ETH payment: FireSale buys that PAPER
  on the market (the cheaper of ETH -> PAPER and ETH -> PLANK -> PAPER, through the same V2 router) and burns it. One
  confirmation, no approval, and every such pack's PAPER is a real market buy. The site offers it whenever a buyer pays
  in ETH and is short of PAPER ("Pay the PAPER in ETH too"); `quotePaperInEth` says what it costs.
- **Getting PAPER on the site:** the Get PAPER sheet (and the "Get N PAPER" button wherever a buyer is short) buys
  exactly the PAPER asked for, paid in ETH, PLANK or USDG: on mainnet through KyberSwap (the best price across every
  Robinhood Chain pool; the transaction is checked before the wallet sees it), otherwise, or if KyberSwap doesn't
  answer, straight from the PAPER pools. ETH is one confirmation; PLANK or USDG need an exact approval first.
- **Up to 50 packs per purchase** by default (`maxPerTx`, set per drop; any number, e.g. 100 for a giant drop).
- **Gas (measured in tests, mock router; `test_gas`, `test_gas_standardGroups`, `test_giantDrop_buy100InOneTx`):**
  about 46k to 106k for a PLANK buy and 79k to 125k for ETH, nearly the same for 1 pack or 100 (packs are one ERC-1155
  mint; a wallet's first buy in a group pays for its new counters). A first press claim (NFT check, new per-press
  and per-wallet counters) is about 215k. A real Uniswap swap adds about 60–90k more,
  so roughly 100k (PLANK) to 195k (ETH/USDG) per purchase. That's cents or less on Robinhood Chain.
- **The swap's floor:** it must get at least 90% of the PLANK that the 30-minute average price says. If the pool is
  pumped or manipulated beyond that, the swap is skipped and the burn share goes to `PlankBurner`.
- **If the drop never sells out:** the owner can end it (`endDrop`) once its schedule is over: every timed group has
  run its full time and every until-sold group has opened (24h in the Standard sale), and at least a day after the
  start. If the owner doesn't, anyone can, 7 days after that, so packs are never stranded. The Series closes with the
  packs that were minted.
- **One drop at a time.** The next drop can only be set up once the current one has closed.
- **Each Series stands alone.** Its cards come only from its own packs, by its own recipe: every pack has the same slots and
  every card is rolled on its own from its slot's fixed odds, the same for the first and the last pack (no pool, no
  caps). Standard: 3 Paper · 1 Wood · 1 Wood or better · 1 Fire or better; of all cards Paper 50%, Wood 24.15%, Fire
  14.97%, Coal 4.89%, Gold 3.99%, Full Art 2%. Nothing carries over between
  Series. Example: 167 packs (1,002 cards) make on average 501 Paper, 242 Wood, 150 Fire, 49 Coal, 40 Gold, 20 Full
  Art; the real counts vary around these.
- **Every purchase names its limits:** the most PLANK/USDG (or the ETH sent), and the most PAPER. If a number moved,
  the purchase fails and costs nothing.
- **Price feeds and the router** can be replaced by the owner only between drops (a retired Chainlink feed, a moved
  PLANK pool or a new router).
- **The PLANK price must be fresh:** the 30-minute average must have ended within the last 2 hours and cover at most
  2 hours. Otherwise PLANK purchases pause and the burn share of ETH/USDG sales goes to `PlankBurner`, until the
  price is fresh again (the keeper checkpoints every 30 minutes, and buys keep it fresh between those; after a gap
  over 2 hours it takes two checkpoints 30 minutes apart, which a buy can't do for itself).
- **Pause.** The owner can pause buying (every group), credit spending and paid suggestions (`FireSale.setPaused`),
  and case and grading payments (`FirePsa.setPaused`). Opening packs, dealing, transfers, ending or closing a drop,
  burning cards, finishing or cancelling a grading and every keeper call never pause. A pause doesn't expire on its
  own: the owner lifts it.

## Press holders' packs

- **Who:** press holders only (Paper Press NFT; an NFT group). This is the bot filter: a press costs $94+. About 2,080
  presses exist.
- **Rules:** first come, first served. Each press claims 1 pack per drop (per group: packs per press, e.g. 3,
  claimable in any split; a wallet limit on top if wanted), checked live; a press is spent once its packs are
  claimed, whoever holds it later.
- **Price:** 1 PAPER, burned. No dollar price. (Per group: free, a PAPER amount, a dollar price paid in the coins it
  takes with the group's burn shares, or a dollar price plus PAPER.)
- **Window:** 6 hours (or until claimed), then leftovers roll into Everyone.
- **Trading:** press packs are normal packs and can be traded sealed.
- **Known gap:** someone with many presses could spread them across wallets. Each one is still a real press.

## Free pack credits

Credits, card burning and suggestions live in `FireCredits` (split out of `FireSale` for contract size, same rules;
PAPER is still approved to `FireSale`, which takes it). Each wallet has a count of free pack credits. Credits **stack** and never expire. A credit is used in any live
drop: mint 1 pack from the drop's credit group while it is open, for that group's PAPER per pack (burned, within the
PAPER ceiling), out of that group's packs. If no drop is live, its credit group isn't open (yet), or it's sold out, the
credit waits. The credit group's gate, price, coins and wallet limit, and the regular-wallets rule, don't apply to
credits. A drop can cap how many free packs it gives
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
| Any pack (paid, press or free) | 1 PAPER per pack, never more than the drop's PAPER ceiling ($1 in the Standard sale) |
| Character suggestion | 1 PAPER, never more than $1 of PAPER (owner setting, `FireCredits.setSuggestionRules`, any amount incl. 0; the suggester names their most). Open all the time. The list clears after every picking session: picking for a Series takes the current list, new suggestions start the next list, and unpicked ones don't carry over. A suggestion is a character plus an optional personality and background, packed into one text (`Character: …` / `Personality: …` / `Background: …` lines, `docs/cards-contracts.md`); set the longest text to about 1,000 bytes. |
| Cases and grading | Paid in PLANK, ETH or USDG; 100% of it buys PAPER and burns it (`PaperBurner`). Not payable in PAPER. |

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
- **Scale:** 167 packs × 2 drops a month burns about 334 PAPER a month as pack PAPER. The 20% sale share adds about
  5× that: 117 paid packs a drop × $0.50 = about $58, about 730 PAPER at $0.08, so about 1,800 PAPER a month in all
  (more with the after-sell-out rise), against about 63,000 printed (about 2,080 presses). Case and grading fees add
  about 2,500 PAPER per Series at $0.08 (final numbers audit). This is a reason to hold PAPER more than a big burn.

## Cases and PDA grading

**PDA** stands for Professional Digital Authenticators, a nod to real-world card grading. (The contract keeps its
original name, `FirePsa`.) The full rules (condition, wear, fresh odds, slabs) are in `docs/grading.md`.

- **A card's condition is decided by public randomness when it is graded** (drand, asked for after payment), from
  its wear: it wears with time uncased and with every move between wallets. A **Case** freezes the wear. **Grading**
  sets the PDA grade (1-10) once and seals the card in a **Slab**: final, no regrade.
- **Prices:** Case $0.05 per card (flat); grading $1 per card, one price for every card type. The owner can change
  them (`setPrices`, each at most $100 a card). Up to 20 cards per transaction (`setMaxBatch`, at most 100), cases and
  grades together (`protect`); `quote(cases, grades, pay)` is exactly what it charges.
- **Paid in PLANK, ETH or USDG.** Not in PAPER.
- **100% of every fee is burned as PAPER,** none of it goes to us. Every fee goes to `PaperBurner`, which
  buys PAPER with that fee (and only that fee) in the same transaction: it takes the best owner-set route (or half and
  half across two routes that share no pool) and refuses to buy below 95% of the PAPER the 20-hour price feed says the
  fee is worth (trying half if the whole fee is too much for the pools); then the fee waits in the burner for the
  keepers' flush. It has no withdraw, and nobody can redirect it: its router is fixed, its feeds are set once, and its
  routes only pass through WETH, PLANK or USDG. A case or grading never spends the burner's backlog (the sale's 20%
  share waiting for the keeper), so nobody can sandwich it through `protect`.
- **The holder names the most they'll pay;** if the price moved, the batch fails and costs nothing.
- **While a card is being graded it can't be transferred** (it can still be burned), so nobody can sell a card whose
  drand number they've already seen.
- **If randomness is gone for good** (no answer 24 hours after the request), anyone can cancel a grading
  (`cancelGrading`): the cards unlock, still ungraded. The fee was burned. Opens work the same way: a stuck open can be
  cancelled after 24 hours and the packs come back sealed.
- **Fresh odds** (a card cased or graded within 24 hours of opening): constants in `FirePsa` (`freshOdds`), fixed
  forever, the same for every Series and every material. Grades 1-6 come only from wear:

| Grade | Fresh odds | Out of 10,000 | Wear |
|---|---|---|---|
| 10 | 1% | 100 | Pristine + gold glow |
| 9 | 30% | 3,000 | Level 2 |
| 8 | 40% | 4,000 | Level 2 |
| 7 | 29% | 2,900 | Level 3 |
| 6 | - (wear only) | 0 | Level 3 |
| 5 | - (wear only) | 0 | Level 4 |
| 4 | - (wear only) | 0 | Level 4 |
| 3 | - (wear only) | 0 | Level 5 |
| 2 | - (wear only) | 0 | Level 5 |
| 1 | - (wear only) | 0 | Level 6 |

## Wallets (separate jobs)

| Wallet | Gets |
|---|---|
| Revenue | 70% of every sale. Nothing else. The wallets can only be changed while no drop is set up or running. |
| `PaperBurner` (a contract, not a wallet) | The 20% PAPER share of every sale, and every case and grading fee paid in ETH, PLANK or USDG. No withdraw: it can only buy PAPER and burn it. The sale's pointer to it can only change while no drop is set up or running. |
| `PlankBurner` (a contract, not a wallet) | The 10% when a PLANK swap fails. No owner, no withdraw: it can only buy PLANK and burn it. The sale's pointer to it can only change while no drop is set up or running. |
| Royalty | 5% resale royalty (ERC-2981), where marketplaces honour it. |
| Swap fee | 0.5% of site swaps, once the site's swap is live (`SWAP_FEE_WALLET` in `web/src/lib/config.ts`, not set yet). |

## Money, roughly

At $2.50 and 70% to revenue, counting every pack as paid (press packs and free credit packs pay no dollar price: in
the Standard drop 117 of 167 packs are paid, so scale these by about 0.7):

| Packs per week | Per month to revenue |
|---|---|
| 100 | ~$760 |
| 150 | ~$1,140 |
| 200 | ~$1,520 |

Plus small royalties and swap fees. Running costs:
- gas to deal opened packs, about 1–3¢ a pack
- image storage and hosting, about $20–40 a month
- security review before launch

At that pace, PAPER bought and burned from sales: about $2,600–5,200 a year; PLANK burned: about $1,300–2,600 a year.

## Why these numbers (from the sims)

- **167 packs** is the size that sells out with normal demand. A sold-out Series' packs resell above their
  price, and bigger or open-ended drops don't.
  - Viral demand is answered with more drops, not bigger ones.
- **A flat $2.50** is fair to everyone.
  - At $1, flippers took the gap (packs resold at up to 14×). At $5, nothing sold out.
  - Price steps were rejected as unfair to later buyers.
- **Bots:** a wallet limit is a fairness rule, not bot protection. The press gate is what keeps bots off the
  press packs.
  - Starter-pack gates that were rejected:
    - first come, first served for anyone: bots took ~100%
    - a PLANK-holding snapshot alone: bots took ~57%
    - random presses: too limiting
  - For the paid sale, the holder groups (presses and the PLANK snapshot) first and the regular-wallets rule keep one
    bot contract from sweeping a drop.

## Still open

See `docs/roadmap.md`.
