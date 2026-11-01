# The market

Cards and sealed packs for sale on our own site, at a fixed price in ETH, and offers on them. Nobody can pull a
listing or an offer but the person who made it.

Way in: **Market**, one of the five places (the top bar on computers, the tab bar on phones). Its badge counts the
offers you can accept now.

## How it works

- **Sell a card:** My cards › open a card › **Sell** › price › **List for sale**. The first time, the wallet asks to let
  the market sell your cards (once per wallet; packs ask once too). The card stays in your wallet until someone buys it;
  its detail says "For sale · 0.02 ETH" and opens the same screen to change the price or take it off sale. A listing
  lasts 30 days (at most 180), and it ends for good the moment the card moves, is cased or goes for grading: a card
  that comes back never brings its old price back. List again to sell it as it is now.
- **Prices (a guide, never set for you):** a card's page, a listed card and Sell show a strip: the lowest ask of the same
  kind (Series, type, character, holo look, grade or ungraded), the median of the clean sales of that kind in the last
  60 days (live: the indexer's numbers, trades with yourself left out; under 3 sales it says there's no guide yet), and
  the best offer. Sell has quick prices (Match lowest, Suggested, Best offer +5%) that fill the box only when tapped,
  and **Sell now** when there's an offer that fits (a preview, then the wallet). A listed card also shows its other
  copies for sale in a table you can sort (print #, holo, grade, wear, price), the pop for its grade, and its recent
  sales as a dot chart and a list.
- **List several:** Market › Mine › **List several**: pick up to 20 (copies you have more of come first), a price each
  (or "Use suggested prices" for the empty ones), how long; one confirmation (`listCards`). The same price checks run on
  every row.
- **Old listings:** if you switched the market off for your cards (the approval), your listings sleep; switching it on
  again would wake the ones that haven't ended, so the site lists them first: **Take them off sale first** or **Keep
  them for sale**.
- **Sell packs:** Market › Mine › **Sell packs**: the Series, how many, the price each.
- **Buy:** Market › Cards: a search box that understands card words ("fire pda 9", "gold", "pigeon", "s7", "holo",
  "ungraded", "missing"; each word it knows becomes a filter chip, the rest searches names); **Filter** (Series, type,
  character, holo, grade, cased, wear for ungraded cards, a top price, and "only cards missing from my binder"; each
  value shows how many are for sale and the lowest price, choices in one filter are OR, filters together are AND, with a
  live "Show N cards"); All / Graded / Ungraded; sorts (newly listed, price both ways, best grade, lowest print #, least
  worn; remembered per visitor). The link keeps the filters. 40 at a time. Nothing matching offers a next step: drop a
  filter (with how many it would show) or ask for one with an offer. An empty binder slot opens the market filtered to
  that card. Packs: pick how many. One confirmation in the wallet; the card or packs arrive in the same transaction.
- **Offers:** what people want, best first; the ones you can fill are lit, with **Sell yours**. **Make an offer**:
  - on one card (a listed card › **Make offer**), or "Or any card like this";
  - on any card that matches: Series, type, character, holo (none, frame, picture, full, any holo), lowest grade, most
    moves, cased or not;
  - on packs: a Series, how many, the price each.
  How many you want, and how long it lasts (1, 3, 7 or 30 days; 7 by default). Your ETH stays in your wallet as WETH (the wallet
  asks to wrap just what your open offers don't already cover, and to let the market use it) until someone accepts.
- **A card's page** shows its best offer with **Accept**; **Sell** shows it too.
- **Activity:** the newest sales (listings bought and offers accepted). **Cards** starts with each type's floor price.
- **Mine:** your listings, your offers, your WETH (turn what offers don't need back into ETH), money waiting from a sale;
  **Take everything off sale and cancel my offers** ends all of them in one transaction.
- A card being graded can't be bought or sold to an offer until its grading is done. A sale counts as a move (wear) on
  an uncased card.
- Demo: made-up sellers, buyers and offers, and the demo wallet's ETH; something you list is bought a little later.

## The contract (FireMarket)

No owner, no fees, no admin, no pause, no upgrade (`contracts/src/cards/FireMarket.sol`, `docs/cards-contracts.md`).

- It never holds cards or packs: a listing is a price, an end date and the card's change count, and the seller
  approves the market once (`setApprovalForAll`).
- **FireCards.changes(serial)** counts every move to another wallet and every casing, grading start, grading cancel
  and grade, never capped. A listing stores it; `buyCard(serial, price, changes)` needs the listing's count to equal
  the card's now and the buyer's to equal the listing's. So a card that moved or changed can't be bought at an old
  listing, and the buyer gets exactly the card they looked at. Packs (ERC-1155) rely on the end date.
- `listCard(serial, price, expiry)`, `listCards(serials, prices, expiry)` (up to 20), `cancelCards(serials)`;
  `listPacks(series, amount, pricePer, expiry)`. Expiry: at most 180 days out, from the chain's clock.
- `buyCards(serials, prices, changes)` buys up to 20 at once: send the sum; a card gone by then is skipped and its ETH
  comes back (or waits in `owed` if the wallet refuses it).
  The site's wallet gate (`web/src/lib/guard.ts`) allows that approval only for FireMarket.
- A buy pays exactly the listed price (the buyer's transaction carries the price they saw; a changed price fails, nothing
  charged), moves the card, pays the royalty (ERC-2981, the collection's 5%; at most 10% is ever paid) and the rest to
  the seller, all in one transaction. The market keeps nothing. If a seller's wallet refuses ETH, its money waits in
  the market (`owed`) and Market › Mine shows **Collect**.
- Offers: `makeOffer(kind, target, price, qty, expiry)`: at least `MIN_OFFER` (0.00001 ETH) each; kind 0 one card (target = serial; it records the card's grade and cased state, and accepting needs them unchanged), 1 any matching card
  (target = `matchKey(Series, type + 1, character + 1, holo, lowest grade, most moves + 1, cased: 1 only / 2 not)`, 0 = any), 2 packs (target = Series);
  at most 180 days. `acceptOffer(id, serial, amount, price)`: the WETH comes from the buyer, is turned into ETH and paid
  out like a sale; the card or packs go to the buyer. An offer whose buyer no longer has the WETH (or took the approval
  back), that expired or was ended by `cancelAll` can't be accepted, and anyone may clear it.
- A listing whose seller no longer holds the card (or the packs), or who took the approval back, can't be bought, and
  anyone may clear it. A card that comes back to its seller brings its old listing back: **Take off sale** or **Take
  everything off sale** (`cancelAll`) ends it.
- The wallet gate also allows wrapping and unwrapping WETH and a capped WETH approval for FireMarket (offers).
- The wallet gate: `buyCards` must send exactly the sum of its prices; WETH approvals for offers are capped at 1,000 WETH.
- The wallet gate caps one market buy at 10 ETH (other site transactions: 0.5 ETH). Raise `MARKET_MAX_ETH` in
  `guard.ts` if cards ever sell for more.

## Where it's checked

- `contracts/test/cards/Market.t.sol`: 40 tests (the six cases the research flagged: a card coming back with its old listing, a listing surviving grading, a re-granted approval, an offer filled after the card was graded, an unfunded offer coming back, a buyer who saw an older card; `buyCards`, bulk, expiry, minimum offer); `test/invariant/MarketInvariant.t.sol`: the market's ETH always equals what it owes, it never keeps WETH, a listing it called dead is never bought. Before those: (listing, buying, stale listings, grading lock, cancelAll, refused
  payouts, re-entry, royalty cap, offers on a card / any matching card / packs, unfunded and expired offers, fuzzed
  payouts); `Psa.t.sol` `test_marketSale_isAMove_andWaitsOutGrading` on the real FireCards (a sale, a grading lock, packs,
  a match offer).
- The site's chain test (`npm run test:chain`): list, buy, re-price, take down, offers with WETH wrapped and approved,
  a match offer for 2, cancel, unwrap, Activity.
- The rehearsal (`ops/rehearsal`): DeployCards deploys it; a graded card is listed and bought (the 5% royalty and the
  seller's 95% checked), and an offer in WETH is accepted.
- The testnet's WETH (DevStack's `DevWeth`) wraps and unwraps real ETH, so offers work there.
- The indexer (`ops/indexer`) keeps the listings and sales (`/market`, `/sales`); without it the site reads the
  market's events from the chain. Either way each listing is checked on the chain before it's shown.
- Deploy: comes with `DeployCards`; on an older deploy, `script/DeployMarket.s.sol`. `VerifyDeploy` checks it.

Before mainnet: the market goes into the professional audit with the other contracts.

Next: a notification when someone offers on your card, and a market stall drawn into the workshop scene.
