# The market

Cards and sealed packs for sale on our own site, at a fixed price in ETH. Nobody can pull a listing but its seller.

## How it works

- **Sell a card:** My cards › open a card › **Sell** › price › **List for sale**. The first time, the wallet asks to let
  the market sell your cards (once per wallet; packs ask once too). The card stays in your wallet until someone buys it;
  its detail says "For sale · 0.02 ETH" and opens the same screen to change the price or take it off sale.
- **Sell packs:** Market › Mine › **Sell packs**: the Series, how many, the price each.
- **Buy:** Menu › **Market**. Cards (filter by type, sort by price or grade; tap one to see it big) and Packs (pick how
  many). One confirmation in the wallet; the card or packs arrive in the same transaction.
- **Mine:** your listings; **Take everything off sale** ends all of them in one transaction.
- A card being graded can't be bought until its grading is done. A sale counts as a move (wear) on an uncased card.
- Demo: made-up sellers and the demo wallet's ETH; something you list is bought by a demo buyer a little later.

## The contract (FireMarket)

No owner, no fees, no admin, no pause, no upgrade (`contracts/src/cards/FireMarket.sol`, `docs/cards-contracts.md`).

- It never holds cards or packs: a listing is a price, and the seller approves the market once (`setApprovalForAll`).
  The site's wallet gate (`web/src/lib/guard.ts`) allows that approval only for FireMarket.
- A buy pays exactly the listed price (the buyer's transaction carries the price they saw; a changed price fails, nothing
  charged), moves the card, pays the royalty (ERC-2981, the collection's 5%; at most 10% is ever paid) and the rest to
  the seller, all in one transaction. The market keeps nothing. If a seller's wallet refuses ETH, its money waits in
  the market (`owed`) and Market › Mine shows **Collect**.
- A listing whose seller no longer holds the card (or the packs), or who took the approval back, can't be bought, and
  anyone may clear it. A card that comes back to its seller brings its old listing back: **Take off sale** or **Take
  everything off sale** (`cancelAll`) ends it.
- The wallet gate caps one market buy at 10 ETH (other site transactions: 0.5 ETH). Raise `MARKET_MAX_ETH` in
  `guard.ts` if cards ever sell for more.

## Where it's checked

- `contracts/test/cards/Market.t.sol`: 20 tests (listing, buying, stale listings, grading lock, cancelAll, refused
  payouts, re-entry, royalty cap, fuzzed payouts); `Psa.t.sol` `test_marketSale_isAMove_andWaitsOutGrading` on the
  real FireCards.
- The rehearsal (`ops/rehearsal`): DeployCards deploys it; a graded card is listed and bought, the 5% royalty and the
  seller's 95% checked.
- The indexer (`ops/indexer`) keeps the listings and sales (`/market`, `/sales`); without it the site reads the
  market's events from the chain. Either way each listing is checked on the chain before it's shown.
- Deploy: comes with `DeployCards`; on an older deploy, `script/DeployMarket.s.sol`. `VerifyDeploy` checks it.

Before mainnet: the market goes into the professional audit with the other contracts.
