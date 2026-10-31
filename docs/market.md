# The market

Cards and sealed packs for sale on our own site, at a fixed price in ETH, and offers on them. Nobody can pull a
listing or an offer but the person who made it.

Ways in: the **Market** button in the top bar, the **Market** sign in the workshop (by the best slabs; a station on
phones), and Menu › Market.

## How it works

- **Sell a card:** My cards › open a card › **Sell** › price › **List for sale**. The first time, the wallet asks to let
  the market sell your cards (once per wallet; packs ask once too). The card stays in your wallet until someone buys it;
  its detail says "For sale · 0.02 ETH" and opens the same screen to change the price or take it off sale.
- **Sell packs:** Market › Mine › **Sell packs**: the Series, how many, the price each.
- **Buy:** Menu › **Market**. Cards (filter by type, sort by price or grade; tap one to see it big) and Packs (pick how
  many). One confirmation in the wallet; the card or packs arrive in the same transaction.
- **Offers:** what people want, best first; the ones you can fill are lit, with **Sell yours**. **Make an offer**:
  - on one card (a listed card › **Make offer**), or "Or any card like this";
  - on any card that matches: Series, type, character, holo (none, frame, picture, full, any holo), lowest grade;
  - on packs: a Series, how many, the price each.
  How many you want, and how long it lasts (1, 7, 30 or 90 days). Your ETH stays in your wallet as WETH (the wallet
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

- It never holds cards or packs: a listing is a price, and the seller approves the market once (`setApprovalForAll`).
  The site's wallet gate (`web/src/lib/guard.ts`) allows that approval only for FireMarket.
- A buy pays exactly the listed price (the buyer's transaction carries the price they saw; a changed price fails, nothing
  charged), moves the card, pays the royalty (ERC-2981, the collection's 5%; at most 10% is ever paid) and the rest to
  the seller, all in one transaction. The market keeps nothing. If a seller's wallet refuses ETH, its money waits in
  the market (`owed`) and Market › Mine shows **Collect**.
- Offers: `makeOffer(kind, target, price, qty, expiry)`: kind 0 one card (target = serial), 1 any matching card
  (target = `matchKey(Series, type + 1, character + 1, holo, lowest grade)`, 0 = any), 2 packs (target = Series);
  at most 180 days. `acceptOffer(id, serial, amount, price)`: the WETH comes from the buyer, is turned into ETH and paid
  out like a sale; the card or packs go to the buyer. An offer whose buyer no longer has the WETH (or took the approval
  back), that expired or was ended by `cancelAll` can't be accepted, and anyone may clear it.
- A listing whose seller no longer holds the card (or the packs), or who took the approval back, can't be bought, and
  anyone may clear it. A card that comes back to its seller brings its old listing back: **Take off sale** or **Take
  everything off sale** (`cancelAll`) ends it.
- The wallet gate also allows wrapping and unwrapping WETH and a capped WETH approval for FireMarket (offers).
- The wallet gate caps one market buy at 10 ETH (other site transactions: 0.5 ETH). Raise `MARKET_MAX_ETH` in
  `guard.ts` if cards ever sell for more.

## Where it's checked

- `contracts/test/cards/Market.t.sol`: 29 tests (listing, buying, stale listings, grading lock, cancelAll, refused
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
