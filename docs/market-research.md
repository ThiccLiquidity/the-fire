# Marketplace research

Omni Cardworks market, November 2026. This report pulls together seven research tracks: industry standards, finding cards, selling and liquidity, safety, outside tools, fun ideas, and a review of our own code. It then went through a skeptical review.

## The short answer

What to build, in order:

1. **Stop old listings coming back.** A listing should end when the card leaves the wallet, and every listing should have an end date (default 30 days, longest 180). Today a card that comes back to its seller brings its old price back. OpenSea had this same bug in January 2022 and refunded about 750 ETH. Fix it in the contracts (FireCards and FireMarket) before the audit.
2. **Lock in the card the buyer saw.** A buy or an accepted offer should fail if the card's grade, cased state or move count changed after the price was set. Today a listing survives grading at its old price. Age wear grows every second, so it is shown, never checked exactly.
3. **Stop dead offers coming back.** An old offer becomes live again when the buyer wraps WETH. One WETH balance can also back any number of offers. Count every open offer and show how much WETH really backs it.
4. **Add price-safety checks on every sell screen.** Ask for a second tap when a price is under 50% of the floor or the suggested price. Separate "an offer for this card" from "an offer for any Paper card", so a cheap broad offer never looks like a fair price for a PDA 10.
5. **Make the "no signatures, ever" rule hard to break.** The site refuses to send any signing request, wallet_sendCalls batch or EIP-7702 authorization. It warns if the connected wallet is already delegated to a contract. It says plainly: "We never ask you to sign a message."
6. **Lock down how the site is built and hosted.** Pin exact versions, add a 7-day wait before new package versions can be installed (npm 11.10+), and never load scripts from a CDN at runtime. Add a registrar lock, DNSSEC and CAA records. The service worker never caches market data. A tampered page beats any contract.
7. **Move the work of checking listings to the indexer, but never trust it for money.** The indexer serves only listings that can be bought now, with filters, sorting and pages. The browser re-reads the price and state from the chain before any buy, sell or accept. If the indexer is down, the market still works from the chain with an "out of date" banner.
8. **Build real filters.** Series, Type, Character, Holo, Graded/PDA range, Cased, Wear, Price, and "missing from my binder". Show a count and a floor next to each value, show applied filters as removable chips, use a bottom sheet on phones, and keep the filter state in the URL.
9. **Show honest prices.** Each card group shows Lowest ask, the median of recent sales (with how many sales it is based on) and Best offer. Leave wash trades out of every number.
10. **Add "Sell now" and "Want".** "Sell now for X" shows a preview, then fills the best offer that fits the card. "Want" keeps a free want list on the device, can be turned into an on-chain "any matching card" offer, and links from empty binder slots.
11. **Make the other pre-audit contract additions in the same change.** These are: moves and cased options in match offers, a "buy several" function that skips gone listings, bulk list and cancel, and the missing tests. Then run the audit.
12. **Legal, accessibility and phone speed before launch.** Terms, 18+, sanctions stance, WCAG 2.2 AA, fast on a mid-range phone. All need the owner's OK before going live.
13. **Then the fun layer.** A live sales ticker, seller stalls, set-completion ranks and badges (opt-in, never spending ranks), and share links.

## What the best markets do

### Finding cards
- **Trait filters with counts and floors.** OpenSea and Magic Eden (before it left EVM) show each trait value with a count, and OpenSea's trait pages also show a floor and a top offer. For us, each value reads like "Fire (12) from 0.004 ETH". Values with no matches are greyed out, not hidden. Choices inside one filter combine as OR; different filters combine as AND. Today we only filter by material (market.js:218-254).
- **Applied filters as chips.** Baymard's testing found that people lose track and narrow their search more slowly when the filters they applied aren't listed. A chip such as "Holo: Picture ×", plus "Clear all", fixes that. On phones, use a sticky [Filter] [Sort] bar that opens a bottom sheet with a live "Show 37 cards" button.
- **A search box that understands card words.** For example, "fire ember pda 9", "gold #1", "full art", a token ID or a wallet. Each word it recognises becomes a filter chip (the Ludex and Jupiter pattern).
- **Sorts people use.** Newly listed (the default with no filters), Price low to high (the default for searches), Best deal vs recent median, Lowest edition #, Best grade, Least worn, and Price high to low. Remember each viewer's choice in localStorage.
- **Graded vs ungraded split.** In 2024 eBay replaced "Used" for single cards with Graded and Ungraded. For us: an All / Graded (PDA) / Ungraded toggle. Ungraded cards show a wear band (Fresh / Light / Played / Heavy), worked out from moves and age as of now.
- **Browse by Series.** A checklist of characters × types, where each cell shows whether you own it, the floor and how many are listed. Tapping a gap opens the market already filtered to that card. Top Shot built its retention around set completion.
- **Empty results always offer a next step.** For example: "No PDA 9+ listed. Lowest listed: PDA 7 at 0.003 [show]", "[Remove Holo filter: 4 cards]" or "[Post a Want offer]".

### Card pages
- **Price strip.** Lowest ask, the recent sale median ("median of 7 sales, 30 days") and Best offer. TCGplayer separates its sales-based Market Price from Low and Listed Median. Never show an average of asking prices as a value.
- **Confidence label.** "Based on 3 sales · Low confidence". With fewer than 3 sales, show "No price guide yet" (the Alt Value pattern).
- **Compare copies table.** Edition #, Holo, PDA grade, Wear, Cased, Price, Seller, sortable by each. Top Shot lets you sort copies by serial, and outside extensions were built just to add that.
- **Pop on the page.** A grade histogram, "Pop 10: 3 · Pop higher than this copy: 5" and "Ungraded: 140 of 200". Because everything is on-chain, our pop is exact.
- **Sold history.** Recent sales with explorer links, and grade chips so grades are never mixed in one list. Use a dot chart, with no smoothed line when there are only a few sales.
- **"Genuine Omni Cardworks" check.** It links to the contract on the explorer. We never show text or images from other contracts (OpenSea hides unverified collections by default).

### Selling
- **Sell now.** It fills the best offer that fits the card (Magic Eden's "Instant sell", Phantom's "Instant Sell"). It is never one tap. A preview sheet ("Sell Rex · Fire · PDA 9. You get about X") comes first, then the wallet. Offers below the lowball line are left out unless the seller turns on "show all". Our acceptOffer already takes the price the seller saw, so if the offer drops, the sale fails instead of paying less. Show the net amount only, using royaltyInfo read from the chain.
- **Suggested price.** Use the median of the last 5-10 clean sales in the same group (Series, type, character, holo, grade band) over 30-60 days. If there are fewer than 3, fall back to the type floor times a grade premium, and if that is missing too, show nothing. Quick buttons: Match floor / Suggested / Best offer +5%. The suggestion never fills the price field by itself. The seller taps a button.
- **Two-sided spread per group.** For example "Buy now 0.04 / Sell now 0.032" with a small depth bar. Add a "Wanted" board of the top match offers in plain words. A ladder of bids makes a market feel live. Copy only the display, never Blur-style points or rewards.
- **Bulk list.** Multi-select cards, see a preview table, approve once. Players who open many packs end up with many duplicates. The same price checks run on every row.
- **Offer length choices.** 1, 3, 7 or 30 days, with 7 as the default (StockX offers similar choices). The contract allows up to 180.

### Offers
- **Present match offers as "Want any copy".** FireMarket checks Series, type, character, holo and minimum grade on-chain. That is safer than OpenSea's trait offers, which depend on OpenSea's server checking traits at fill time. Add preset chips ("Any Fire", "Any Gold 7+"), Top bid / +5% buttons, and "42 cards could sell to you".
- **Want list.** It is free and stays on the device (localStorage), up to about 20 cards. Pokemon TCG Pocket is reported to have added a wishlist in 2025. Buyers get an in-app note when a match is listed. "Back it with an offer" turns a want into a real WETH match offer. On-chain match offers are the only public "N collectors want this" count, because they cost something and can't be faked by anyone other than their owner.

**Choice between tracks:** one track suggested "buy several" as a series of separate buys, another as one contract function. I chose the contract function `buyCards` for the pre-audit change set. Until it exists, the screen does separate confirmed buys and shows the total.

## Safety

### What we already do well (keep all of it)
- **Listings and offers live on-chain, and the site never asks for a signature** (guard.ts:15-18). Off-chain signatures (Seaport orders, Permit) are the main tool of wallet-drainer phishing. Scam Sniffer counted $494M lost to drainers in 2024 across all assets and $83.85M in 2025. Kevin Rose lost about $1M+ in NFTs from one signed bundle in 2023.
- **No owner, no fee, no upgrade, and the market never holds anyone's cards or ETH** (FireMarket.sol:47-51). The one exception is payouts that failed, which wait in `owed` until collected (FireMarket.sol:418-425).
- **Buyers and sellers pass the exact price they saw** (FireMarket.sol:188, 233, 320). cancelAll works like Seaport's counter (FireMarket.sol:362-365). nonReentrant is on every function that moves value.
- **The guard is strict.** It only allows approval toward FireMarket, a buy must send exactly the listed price, and market buys are capped at 10 ETH (0.5 ETH for everything else) (guard.ts:48, 80-88).
- **Demo activity is already kept off the live site.** feed.js only makes the demo crowd when Live is off and labels it "Demo pulls".
- **The Content Security Policy is strict:** script-src 'self' and frame-ancestors 'none' (web/vercel.json).
- **Robinhood Chain currently orders transactions first-come first-served with no public mempool** (secondary source), so buys can't be sandwiched. Recheck if Timeboost (Arbitrum's express-lane auction) is ever switched on.

### Must-do: contract (before the audit)
1. **Listings die on transfer.** FireCards gets a separate, unbounded per-card transfer counter, bumped on every wallet-to-wallet move, cased or not. The listing stores it, and buyCard requires it to be unchanged. *Conflict resolved:* one track suggested `cardOf().moves`, but `moves` stops counting on cased cards and caps at 15. Packs (ERC-1155) can't carry a counter, so they rely on expiry.
2. **Listing expiry** for card and pack listings: 30 days by default, 180 at most. This also limits the revival after a seller removes the market's approval and later grants it again. That path has no clean on-chain fix, so the site also warns: "Turning the market back on will reopen N old listings. Cancel them first?"
3. **Expected-state check.** buyCard and acceptOffer take the grade and cased state the buyer saw (moves are covered by the transfer counter), and fail if they differ. Age wear is never checked exactly, because it grows every second; the screen shows it "as of now". Single-card offers record grade and cased state when made. This is the idea behind ERC-7496 and SIP-15.
4. **Moves and cased options in match offers.** For example "at most N moves" and "cased only / uncased only / any". Without them, "any Fire holo" is always filled with the most-worn copy. Spare bits exist in matchKey (bits above 92).
5. **`buyCards` safety.** It skips listings that went stale, and unspent ETH goes to `owed` (pull), not a direct send. It is capped at about 20 cards. The guard gets a matching rule: the ETH sent equals the sum of prices, at most 10 ETH.
6. **Tests that fail today:** relisting after approval is revoked and re-granted, a listing surviving setGrade or setCased, a card returning to its seller with its old listing, an offer coming back when WETH is topped up, one balance backing many offers, and a single-card offer filled after the card was graded. Add an invariant that the market's ETH equals `owed`. Then run Slither, Aderyn and Foundry fuzz tests.

### Must-do: front end
- **Block signing at the wallet connection.** Refuse to send eth_sign, personal_sign, eth_signTypedData*, wallet_sendCalls and EIP-7702 authorizations. The vendored Reown bundle exposes these methods, so wrap its request function. On connect, read the account's code. If it starts with `0xef0100` (an EIP-7702 delegation), show: "This wallet is set to run outside code. If you didn't do this, stop and get help." More than 97% of early EIP-7702 delegations pointed to "sweeper" contracts (Wintermute).
- **Price checks.** Under 50% of the floor or suggested price: a second tap. Catch decimal mistakes (0.5 vs 0.05) and allow at most 6 decimals. USD is optional: show it only from a source we trust, labelled "about", and hide it when older than 10 minutes. Warn on any list price above 10 ETH, because our guard blocks buys above that. Floors used by these checks come from the indexer and can be wrong, so the checks only warn and never set or change a price. Examples of what this prevents: BAYC #3547 was listed at 0.75 instead of 75 ETH, and EtherRock #44 was sold for 444 wei.
- **Lowball guard on offers.** Label every offer with "% below floor / your listing / last sale". Hide offers under about 25% of the type floor from the tab badge. Don't preselect a card the user has listed higher (market.js:319).
- **Pre-check every transaction** with a free eth_call (viem simulateContract), so Stale or PriceChanged shows a friendly message instead of a failed transaction. Build transaction arguments from a fresh chain read, never from indexer data alone. Re-read the offer right before accept.
- **Show a plain preview before the wallet opens,** for example "Buy Rex · Fire · PDA 9 for 0.042 ETH. You get the card." Prices only, never where funds go.
- **Supply chain.** Pin exact versions (viem is `^2.56.9` in web today; the indexer already pins). Add web/.npmrc with `min-release-age=7`, which needs npm 11.10+ and fails silently on older npm, so check `npm -v` in CI. A real security fix can skip the wait with `--min-release-age=0` after review. Always install from the lockfile (`npm ci`), and rebuild the wallet bundle only from a reviewed lockfile. Lessons: Ledger Connect Kit 2023 was loaded from a CDN at runtime and lost about $600k; chalk/debug 2025 and the Shai-Hulud worm poisoned npm packages.
- **Domain and hosting.** Registrar lock, hardware-key 2FA, DNSSEC, CAA records, and an alert when DNS or the certificate changes. Deploy only from CI. Show the commit hash in the footer. Lessons: the Squarespace DNS hijacks in 2024 (Compound, Celer), and Bybit's $1.5B loss in 2025 through a tampered JS file in the Safe{Wallet} interface.
- **The service worker never caches market data.** Listings, offers, prices and balances are network-only. A cached page must never show a card as buyable.
- **Text people write themselves** (profile names, stall titles) is always inserted as text, never HTML. Names like "Omni", "Support", "Admin" or "Official" are reserved, and lookalike characters are flagged. A chosen name is always shown next to a short address.
- **Keep demo activity off the live site.** Add a test that fails if feed.js makes demo rows while Live.on is true.

### Must-do: for users
- **One promise on the footer and Info:** "We never ask you to sign a message. If a site that looks like us does, close it." Also: "We never airdrop cards, and we never DM you first."
- **In Mine:** "Market can move your cards: On/Off" with one revoke button (setApprovalForAll false, and WETH approve 0), plus a link to revoke.cash if it supports Robinhood Chain.
- **In Mine:** "Old offers that would come back if you wrap WETH [cancel]" and "Your old listings".
- **An official links page** with the domain, contract addresses and social handles. Register the obvious lookalike domains, report clones to MetaMask eth-phishing-detect and Scam Sniffer, and check our own flows with Blockaid on testnet so we don't get flagged by mistake.

### Should-do (gaps after the musts)
- **Tighten the approval cap.** MAX_APPROVAL = 2^128 is unlimited in practice (guard.ts:40). Cap WETH approval at the sum of open offers plus the new one.
- **Publish ERC-7730 clear-signing files** for FireMarket so Ledger and other wallets show "Buy card #123 for 0.02 ETH".
- **Tighten the CSP further:** narrow img-src to our own image host, add HSTS preload, upgrade-insecure-requests and report-to.
- **Fight address poisoning.** It caused a measured $83.8M in losses (USENIX Security 2025). Show a name plus address chunks, never a short address alone, and filter dust events out of Activity.
- **Stolen-card handling.** It is off-chain only, never an admin key in the contract. It needs evidence (a police or exchange report and transaction hashes), manual review and an appeal. The label reads "Reported. Under review", never "Stolen", and it is a notice, not a block. Write the policy down before turning it on.
- **A short incident runbook:** SEAL 911, a site read-only switch, and a notice template. Consider the SEAL Safe Harbor agreement and a bug bounty after the audit.
- **A gentle "trading elsewhere" note behind Info.** OpenSea reportedly added Robinhood Chain in July 2026 (secondary press; it uses off-chain Seaport signatures), and our guard can't protect approvals given on other sites.

### Abuse of offers and listings
- **Spam and dust offers.** A small minimum offer in the contract, hiding offers under the lowball line from badges, and no free-text messages on offers. There is no message channel to abuse.
- **One balance backing many offers.** Each buyer's offers show "backed X of Y". Offers without backing are greyed out and never fill "Sell now".
- **Offers pulled just before accept** are harmless: the transaction fails and no money moves. Show a friendly message.
- **Wash trading to push prices up.** Medians need at least 3 clean sales from different, unrelated wallets. Wash-flagged sales are left out of medians, suggested prices and floors.
- **Wash flags are internal.** They change which sales count in the numbers. They are never shown as a label on a wallet.

### If the indexer or the chain is down
- **Indexer down or slow:** the market falls back to direct chain reads (docs/indexer.md:73-76). It shows "Live prices may be out of date" and disables filters it can't serve. Buys still work, because every buy is checked against the chain.
- **Indexer wrong or tampered with:** it can mislead what people see, but it can't move money. The contract enforces the exact price, the guard caps value, and the site re-reads from the chain before signing. Precomputed floors and medians are shown as "guide" numbers only.
- **Chain halted** (it happened for about 13 minutes on Sep 4 2026, per a single source): show "Robinhood Chain is paused. Nothing you send will go through until it's back", and stop retries so people don't queue several transactions.

## Back end

### Contract: yes, one small pre-audit change set
**Recommendation:** keep FireMarket. Don't switch to Seaport, thirdweb or Zora. Add, in one change:
- a per-card transfer counter in FireCards, and listing expiry (cards and packs) in FireMarket
- the expected-state check (grade, cased) on buy and accept, and a state snapshot on single-card offers
- moves and cased bits in matchKey
- `buyCards(serials[], prices[])`, which skips stale listings, sends unspent ETH to `owed` and is capped at about 20
- bulk `listCards` and `cancelCards`
- a small minimum offer, so dust offers can't clutter the market

**Why:** each is small, and the contract can't be changed after deploy. Optional later items, which need the owner's decision: a buyer-only "counter" listing, bundles or lots, Dutch-price pack listings, and swaps.

### Indexer: keep self-hosted Ponder
**Why:** the outside services keep closing. Reservoir's NFT API ended Oct 15 2025, SimpleHash ended in March 2025, and Magic Eden ended EVM trading on Mar 9 2026. Ponder is pinned at 0.18.3 (still pre-1.0). Upgrades:
1. **A `live` column** kept up to date from FireCards Transfer, ApprovalForAll, AllCancelled, grade and case events, and WETH balance and approval changes. /market then serves only buyable rows.
2. **Card traits as indexed columns,** so a URL like `/market?series=&type=&char=&holo=&gradeMin=&cased=&priceMax=&sort=&cursor=` is answered by the database, 40 per page.
3. **Precomputed floors, best offers, sale medians and counts** for each card group, plus how much WETH backs each buyer's offers.
4. **Wash flags.** Buyer equals seller, A→B→A within 30 days, wallets funded by each other, and outliers above 3x or below 1/3 of the median. These sales show in raw Activity but are left out of every number. Flags are internal only.
5. **A fast events feed** for Activity and alerts.
6. **Health and freshness.** Each answer carries the last indexed block. The site shows "as of" and the out-of-date banner when that block is more than 2 minutes behind the chain.

**Backup sources:** Alchemy's NFT API and webhooks support Robinhood Chain (mainnet live July 1 2026), and we already use Alchemy for RPC. Goldsky is the managed fallback if Ponder ever becomes a burden. The Graph does not list the chain.

### Search: in the browser, no search server
Load the /market JSON and search it with **Orama** (Apache-2.0, small, self-hosted), which handles text search and filter counts. Meilisearch or Typesense only make sense past tens of thousands of listings, and they add a server and a key to protect.

### Prices and history
Show medians, the number of sales and a confidence label, never a single "last sale" headline. Charts use **TradingView Lightweight Charts v5** (its licence needs a visible TradingView link; put it in the chart corner or Info), and tiny sparklines are hand-drawn SVG. Gaps in the data stay gaps. Charts show prices only.

### Phones and speed
- 40 cards per page, with images loaded only as they scroll into view, as static WebP thumbnails made at build time.
- Load the search index (Orama) only when the search box is used.
- Targets: first screen usable in under 2.5 s on a mid-range phone over 4G, and no layout jumps when prices arrive.
- Keep animations cheap and respect reduced-motion.

### Accessibility (WCAG 2.2 AA)
- Everything works by keyboard and screen reader. Filter chips, the bottom sheet and the compare table have proper roles and labels.
- Grade, wear and holo are never shown by colour alone. Tap targets are at least 24×24 px, and price changes are announced politely.
- Text contrast is at least 4.5:1, including over card art.

### Legal, tax and privacy (needs a lawyer before live)
- **Terms and privacy page:** 18+, "cards are collectibles, not investments", no promises of value or returns, and no "profit" wording anywhere.
- **Sanctions:** the owner and a lawyer decide whether to block sanctioned wallets or regions. Any check runs on the front end only, never in the contract, and sends no wallet address to a third party without saying so in the privacy page.
- **Loot-box and gambling rules** apply to paid random packs in some countries (for example Belgium and the Netherlands), and to anything near the pack opening (repacks, buybacks). We avoid all of these (see Avoid).
- **Tax:** offer each wallet a CSV of its own buys, sales and royalties paid. Don't give tax advice. The US may treat NFTs as collectibles. Point to a tax advisor.
- **Privacy:** no tracking scripts. Web Push subscriptions store only what is needed and can be deleted from settings.

## Tools we can use or copy

| Tool | What for | Cost | Risk | Verdict |
|---|---|---|---|---|
| Ponder (self-hosted) | Market index, filters, floors | One Railway service + Neon | Pre-1.0, so pin it (pinned at 0.18.3) | **Keep, extend** |
| Alchemy NFT API + Webhooks | Backup wallet data, alert triggers | Existing account | Vendor; simulation support on this chain unconfirmed | Use as backup only |
| Goldsky | Managed indexer fallback | Paid | Robinhood support is the vendor's own claim | Later, if needed |
| Orama | Search and filter counts in the browser | Free | Small; self-host the file | **Use** |
| Meilisearch / Typesense | Search server | ~$7-30/mo | Server plus API key | Not at our size |
| Lightweight Charts v5 | Price charts | Free | Attribution required | **Use** |
| viem simulateContract / simulateCalls | Pre-check every transaction | Free (eth_simulateV1 on Chainstack) | Asset tracing is ERC-20 only, so confirm card ownership after | **Use** |
| ERC-7730 registry | Readable wallet prompts | Free | None; it improves display only | **Use** |
| OpenZeppelin 5.x / Solady | Building blocks for contract changes | Free | Use audited tags; check EIP-1153 support before the transient guard | **Use** |
| Slither, Aderyn, Foundry fuzz | Pre-audit checks | Free | None | **Use** |
| Web Push (VAPID, `web-push`) | Bid, sale and expiry alerts | Free | iOS needs 16.4+ and the app installed on the home screen; stores push data | **Use, opt-in only** |
| Satori + resvg on Cloudflare Workers | Share-link preview images | Free tier | Remote images render blank; embed the art; user text inserted as text | Use later |
| revoke.cash | Approval review link | Free | Check Robinhood Chain support | Link to it if supported |
| Reown AppKit | Phone wallet QR connect | Free project ID | Largest third-party code we ship; exposes signing methods | Only bundled, pinned, domain-locked, signing wrapped |
| Seaport 1.6 | Order book | Free | Off-chain signatures, server, larger audit | **Avoid** |
| thirdweb MarketplaceV3 | Ready-made market | Free | Admin proxy; 2023 library flaw (ERC-2771 + Multicall) | **Avoid** |
| Zora modules | Auctions and market | Free | Unmaintained; project pivoted away | **Avoid** |
| sudoswap v2 | AMM pools | Free | AGPL; custody; fits only identical items | Copy the idea only (packs, later) |
| ERC-721C (Limit Break) | Royalties enforced on other markets | Free | Restricts holders, depends on outside allowlist | Avoid unless the owner chooses royalties over freedom |
| Push Protocol / XMTP | On-chain messaging | XMTP now charges fees | Pivoting; a message channel invites scams | **Avoid** |
| Vercel Image Optimization | Thumbnails | About $0.05 per 1K transforms | Bill grows with traffic | Use static WebP made at build time instead |

## Fun on the front end

Ranked by fun for the effort. Most of these reuse code we already have. Anything that shows other people's wallets is opt-in.

1. **"Find the ones I'm missing."** An empty binder slot (binder.js) opens the market already filtered to that card. If none is listed, "Ask for it" prefills a match offer. *Small.*
2. **Want list.** Kept on the device. It alerts you in the app when a match lists, and "Back it with an offer" makes it public and real. *Medium.*
3. **Live sales ticker.** A Sales tab in feed.js and a thin ticker on the market front: picture, grade, price, "just now". Prices only, real sales only. *Small.*
4. **Last 5 sales** in the Buy, List and Accept sheets (Sorare's placement), with wash trades removed and "3x the recent median" in neutral words. *Medium.*
5. **Seller stalls** built on showcase.js: pinned cards, "For sale", "Make an offer on anything here", cosmetic backgrounds. Settings are stored through FireProfiles (on-chain, the owner's own transaction), not a server anyone could edit. *Medium.*
6. **Set-completion ranks and badges.** % of a binder done, first to finish a row, number of PDA 10s. Rewards are cosmetic only. Being on a public board is opt-in, and boards show profile names. Pair or replace "Top stokers" in feed.js, which ranks packs bought. *Medium.*
7. **Share links with preview images** on our own domain (/l/<id>) for listings and stalls. Never "investment" or "profit" wording. *Medium.*
8. **Short celebrations** when your sale or buy lands or a row is filled, using the existing sounds and haptics (fx.js, sound.js). "Big" is relative to the card type. Respect reduced-motion. Haptics only after the transaction is confirmed. *Small.*
9. **Series event wall.** A real countdown or sell-out progress bar that never resets (the Topps NOW model). *Small.*
10. **Weekly collecting challenges** with badges, each at least a week long, never requiring buying or trading. *Small.*
11. **Seasonal skins** and a card-of-the-week spotlight. *Small.*
12. **Watch openings** of players who turned on "show my openings", with reactions only, no picking. *Small.*
13. **A "spot the scam" mini-game** in the demo that gives a badge. *Small.*
14. **Later, after audit work:** card-for-card swaps, where the confirm screen says "This will move X uncased cards and add wear" (*large*); timed auctions built on offers with a soft close (*large*); a fixed trade-up such as 5 Paper → 1 Wood, which is an owner design decision first (*large*).

**Avoid:** buyer-made mystery bundles and repacks, instant buybacks after a pack opens, paid "pick from their pack", re-rolls or boosted odds, spending or volume leaderboards, casino sounds or "JACKPOT" wording, and fake timers, fake "only 2 left" or "X people viewing".

## Our market today: strengths and gaps

**Strengths**
- On-chain orders with no signatures, plus the guard (guard.ts:15-18, 80-88).
- Exact-price buys and accepts (FireMarket.sol:188, 233, 320). cancelAll uses a round counter (FireMarket.sol:362-365). Pull payouts (FireMarket.sol:418-425). Offers already expire (at most 180 days).
- Match offers checked on-chain (FireMarket.sol:271-288). These beat the trait offers of the big markets.
- Self-hosted indexer that falls back to reading the chain (docs/indexer.md:73-76).
- Demo feed already fenced off from live and labelled (feed.js).
- Accessible tiles with aria-labels (market.js:235-237).

**Gaps**
- **Listings never expire and come back** after a card returns or the approval is re-granted (FireMarket.sol:77-81, 385-392). Packs too (402-406). The test Market.t.sol:314-338 shows the card case on purpose. Re-approval happens in market.ts:213-218.
- **A listing survives grading at its old price** (FireCards.sol:354-397; test Market.t.sol:299-312). Buy and accept don't commit to the card's state (FireMarket.sol:185-197, 317-352).
- **Zombie offers and over-committed WETH** (FireMarket.sol:396-399). `committed` counts only live offers (market.ts:197-205, 257-263).
- **Lowball trap.** Broad offers show as "Offer: X [Accept]" on any card (market.js:279-282, 463, 503-507). The badge lights up for dust offers (market.js:496-500).
- **No price check when listing.** Any price from 0 to 1e6 is accepted (market.js:28, 446-493).
- **Filters.** Only material, 3 sorts, floors that mix Series, no URL state, no paging (market.js:218-254).
- **Read path.** About 4 RPC reads per listing ever seen (market.ts:79-140; reads.ts:486-493). The indexer's cheapest 2,000 rows are never cleaned of dead listings (api/index.ts:47-55; indexer market.ts:10-59). wethOf() runs a full scan on every offer (market.ts:202).
- **Royalty hard-coded** at 5% for "You get about" (market.js:16, 326, 452). Read royaltyInfo instead.
- **Prices pass through JS numbers** and break below 1e-6 (market.js:148, 185; market.ts:63-70). Use bigint wei and strings throughout.
- **cancelAll** ends listings and offers together. Label it clearly (market.js:414).
- **Approval cap is effectively unlimited** at 2^128 (guard.ts:40).
- **Loose version pin:** viem is `^2.56.9` in web/package.json, and there is no web/.npmrc.
- **The card page lacks context:** last sale, pop, listing age, seller line. Activity rows can't be tapped (market.js:383-387, 419-434).
- **Dust offers** only need price > 0 (FireMarket.sol:294).

## A build plan in phases

**Phase 1: Contract safety, before the audit** (*medium*)
- Transfer counter (FireCards) and expiry on listings, expected-state check (grade, cased), offer state snapshot, moves and cased bits in matchKey, `buyCards` with pull refunds, bulk list and cancel, minimum offer.
- The failing-then-passing tests and the invariant. Slither, Aderyn and fuzz runs.

**Phase 2: Front-end safety** (*small to medium*)
- Signing blocked at the wallet connection, 7702-delegated wallet warning, price and lowball checks, offer labels, eth_call pre-check from fresh chain reads, and plain preview.
- Revoke button and old-offer and old-listing cleanup in Mine. "We never ask you to sign" text. Royalty read from the chain, bigint prices, 10 ETH list warning, approval cap, guard rule for buyCards.
- Pinned dependencies, .npmrc wait period (npm 11.10+), domain hardening, a service worker that never caches market data, safe handling of user text, and a test that keeps the demo feed off the live site.

**Phase 3: Indexer and finding** (*large*)
- `live` column, trait columns, server filters and paging, floors and medians, offer backing, internal wash flags, freshness and "as of".
- Front end: filter chips, bottom sheet, search with Orama, new sorts, URL state, Graded/Ungraded toggle, empty-state next steps, out-of-date and chain-paused banners.

**Phase 4: Selling and prices** (*medium*)
- Sell now (preview first), suggested price with confidence label, Buy now / Sell now spread, Wanted board, bulk list screen, offer length picker.
- Card page with price strip, compare-copies table, pop and sold history, plus charts.
- Accessibility pass (WCAG 2.2 AA) and phone speed targets.

**Phase 5: Audit, legal, then launch with the owner's OK** (*medium*)
- Professional audit or contest, ERC-7730 files, runbook, official links page, test with Blockaid on testnet.
- Terms, privacy page, sanctions decision and stolen-card policy reviewed by a lawyer. CSV export of each wallet's own trades.

**Phase 6: Fun and return visits** (*medium*)
- Want list and binder links, sales ticker, last-5-sales, stalls (via FireProfiles), opt-in completion ranks and badges, opt-in Web Push alerts, share links, celebrations, event wall, challenges.

**Phase 7: Later, owner decisions** (*large*)
- Swaps, offer-based auctions for rare cards, bundles, Dutch pack listings, a published project floor bid using plain match offers, trade-up.

## Things to avoid
- Off-chain signed orders, gasless listing, Permit or Permit2, bulk-sign, Seaport, zones or conduits. Any signature request, including "sign in with your wallet".
- Admin-run marketplace contracts (thirdweb, Zora). Any admin, pause or blocklist key in FireMarket.
- Depending on outside NFT data or order-book APIs for listings or prices to buy at. Building transactions from indexer data without a fresh chain read.
- Server-side storage that anyone can edit for another wallet (want lists, stall settings) without proof of ownership.
- Token, points or badge rewards for trading volume. Spending leaderboards. LooksRare's rewards led to roughly 84-98% wash volume, depending on the study.
- A single "last sale" or "floor" as the headline value. Averages of asking prices as "value".
- House buybacks, "insured value" anchors, mystery bundles, repacks, paid random picks, re-rolls.
- NFT AMM pools for single cards, sealed-bid auctions, ERC-6551 on cards.
- ERC-721C by default. It trades holder freedom for royalties, so it is the owner's call.
- Loading any script from a CDN at runtime. Caching market data in the service worker. Short addresses or self-chosen names as the only identifier.
- Public labels on wallets ("wash trader", "stolen"). Showing other people's wallets or openings without their opt-in.
- Fake urgency, fake scarcity or fake activity on the live site.
- Explaining where funds go on buy, open, case or grade screens. Prices and "You get about X" are fine; fund flows live behind Info.

## Sources

**Our code:** contracts/src/cards/FireMarket.sol, contracts/src/cards/FireCards.sol, contracts/test/cards/Market.t.sol, web/art/factory/forge/market.js, web/public/forge/feed.js, web/src/lib/chain/market.ts, web/src/lib/chain/reads.ts, web/src/lib/guard.ts, web/src/lib/wallet.ts, web/vercel.json, web/package.json, ops/indexer/package.json, ops/indexer/src/market.ts, ops/indexer/src/api/index.ts, docs/market.md, docs/indexer.md.

**Stale listings and dynamic traits:** decrypt.co/91513 (OpenSea refunds), blockworks.co/news/opensea-redunds-nft-losses, elliptic.co/blog/bug-allows-nfts-worth-over-1-million-to-be-stolen, therecord.media/hacker-abuses-opensea-to-buy-nfts-at-older-cheaper-prices, halborn.com/explained-the-opensea-nft-listing-vulnerability, eips.ethereum.org/EIPS/eip-7496, docs.opensea.io/docs/dynamic-traits, Seaport docs (github.com/ProjectOpenSea/seaport).

**Phishing and signatures:** drops.scamsniffer.io (2024 and 2025 reports; airdrop case study), decrypt.co/357450, blockworks.co (Kevin Rose), cointelegraph (Kevin Rose), theblock.co/news 2025-06-01 (Wintermute EIP-7702), zealynx.io (7702), usenix.org (address poisoning, USENIX Security 2025), kb.etherscan.com.

**Supply chain, hosting, DNS:** revoke.cash/blog/2023/ledger-connect-kit-hack-retrospective, socket.dev, semgrep.dev (chalk/debug), elastic.co (Shai-Hulud), slowmist.medium.com and bleepingcomputer (Bybit), cointelegraph and decrypt (Squarespace DNS), frameworks.securityalliance.org, github.com/MetaMask/eth-phishing-detect, github.com/npm/cli/pull/8825 and jfrog.com (npm min-release-age).

**Market structure and shutdowns:** [cryptonews.net/news/nft/30856993](https://cryptonews.net/news/nft/30856993/) (Reservoir), [docs.moralis.com](https://docs.moralis.com/get-started/tutorials/migration-guides/migrating-from-reservoir-to-moralis.md) (Reservoir migration), simplehash.com/blog, alchemy.com/docs (SimpleHash migration), decrypt.co/312443 (X2Y2), [blockspace.media](https://blockspace.media/insight/magic-eden-to-shutter-bitcoin-and-evm-marketplaces-sunset-multi-chain-wallet) and [crypto.news](https://crypto.news/nft-marketplace-magic-eden-exits-bitcoin-evm-trading/) (Magic Eden), [tekedia.com](https://www.tekedia.com/robinhood-chain-memecoins-explode-as-opensea-integration-signals-a-growing-on-chain-ecosystem/) and [coinfomania.com](https://coinfomania.com/opensea-news-welcomed-by-robinhood-chain-and-why-its-not-just-hype/) (OpenSea on Robinhood Chain), opensea.io/blog (ERC-721C, verification), theblock.co/post/246095 (optional royalties), github.com/limitbreakinc/creator-token-standards.

**Robinhood Chain:** [blog.arbitrum.io/robinhood-chain-mainnet](https://blog.arbitrum.io/robinhood-chain-mainnet/), [galaxy.com research](https://www.galaxy.com/insights/research/robinhood-chain-launch-analysis-base-comparison-memecoins-distribution-thesis), [forum.arbitrum.foundation factsheet](https://forum.arbitrum.foundation/t/arbitrumdao-factsheet-robinhood-chain-mainnet-launch/31041), [cryptobriefing.com](https://cryptobriefing.com/arbitrum-robinhood-chain-decentralization-concerns/), docs.arbitrum.io (Timeboost).

**Wash trading:** dune.com/blog/nft-wash-trading-on-ethereum, dune.com/blog/wash-trading-2-blur, coingecko.com/research, arxiv.org (2403.10879, 2212.01225, 2311.18717), thedefiant.io, decrypt.co/91510, forkast.news.

**Finding and pricing:** baymard.com (applied filters), support.opensea.io and opensea.io/blog (offer management), help.magiceden.io, TCGplayer pricing (storepass, tcgsync, help.tcgplayer.com), pages.ebay.com/price-guide, valueaddedresource.net (eBay conditions), support.alt.xyz and alt.xyz (Alt Value), cardladder.com, help.cardmarket.com (Wants, Shopping Wizard), medium.com/sorare (price history), stockx.com/help, thecardshopfinder.com (pop), blog.nbatopshot.com and support.nbatopshot.com (sets, offers, challenges).

**Liquidity and auctions:** alearesearch.io/deep-dives/blur, mirror.xyz/blurdao.eth, phantom.com (Instant Sell), github.com/sudoswap/lssvm2, medium.com/cyfrin (sudoswap audit), Nouns AuctionHouse source, codehawks.cyfrin.io (Bid Beasts), econweb.ucsd.edu (market makers).

**Gambling, regulation, accessibility:** si.com, valueaddedresource.net and natlawreview.com (Whatnot breaks), sccgmanagement.com (Fanatics Live suit), gamedeveloper.com (Genshin $20M), fortune.com (Courtyard), docs.jup.ag (Collector Crypt buyback), Blockworks Collector Crypt Q2 2026 report, research.4pillars.io, FTC dark patterns report (ftc.gov) and dglaw.com, w3.org/TR/WCAG22.

**Tools:** github.com/ponder-sh/ponder, alchemy.com/blog/robinhood-chain-mainnet-is-live-on-alchemy, goldsky.com/chains/robinhood, thegraph.com/docs (supported networks), github.com/oramasearch/orama, tradingview.com/blog (Lightweight Charts v5), viem.sh (simulateCalls), docs.chainstack.com (Robinhood eth_simulateV1), developers.ledger.com (ERC-7730), github.com/crytic/slither, github.com/Cyfrin/aderyn, OpenZeppelin release notes, cantina.xyz (Solady review), webkit.org (Web Push on iOS), developers.cloudflare.com (OG images), vercel.com (image pricing).

**Caveat:** several primary pages could not be opened from the research sessions: help.tcgplayer.com, help.cardmarket.com, support.alt.xyz, docs.jup.ag, intercom.help, dune.com, theblock.co, blog.nbatopshot.com, alchemy.com and goldsky.com. For those, findings rest on search summaries of the pages. Several other claims also rest on secondary press: OpenSea on Robinhood Chain, the Sep 4 chain halt, first-come first-served ordering, and the Pokemon TCG Pocket wishlist. Allow these sites in the session's network settings if exact figures need checking. Some Top Shot and OpenSea Deals details date from 2022-2023.

## Reviewer notes

What I changed after checking the code and the web:

1. **Wear check fixed.** Age wear grows every second (FireCards `wearOf`), so the expected-state check now covers grade and cased state, and moves through the transfer counter. Age is shown, never checked exactly. Match-offer wear options are now "at most N moves" and cased/uncased.
2. **Transfer counter assigned to FireCards.** It is separate and unbounded, because `moves` caps at 15 and stops when a card is cased. Packs rely on expiry only, since ERC-1155 packs are all the same.
3. **`buyCards`** now sends unspent ETH to `owed` instead of a direct send. Added a matching guard rule (ETH sent equals the sum of prices, at most 10 ETH).
4. **Demo feed** moved from "must-do" to "already done, add a test" (feed.js already checks `Live.on` and labels "Demo pulls").
5. **npm `min-release-age`:** noted that it needs npm 11.10+, the unit is days, and how to skip it for a reviewed security fix.
6. **EIP-7702:** added detection of wallets that are already delegated. Refusing requests alone can't protect them.
7. **Corrected scope and wording:** Scam Sniffer's figure covers all drainers, not only NFTs. Removed the unsourced thirdweb "2025 drain" and ERC-721C "OZ 4.8". Softened the Orama size. Marked the Robinhood ordering, the Sep 4 halt and the OpenSea listing as secondary sources. Noted Timeboost.
8. **Safety conflicts fixed:**
   - "Sell now" needs a preview before the wallet.
   - Want lists stay on the device, and stalls are stored through FireProfiles. A server anyone could edit would be open to abuse, since we never use signatures.
   - The stolen label reads "Reported. Under review", with an evidence and appeal policy.
   - Wash flags stay internal.
   - Ranks and watching openings are opt-in.
   - Self-chosen names always show next to an address, and lookalike names are reserved.
   - USD is optional and hidden when stale.
   - Price checks only warn and never set a price, because the indexer can be wrong.
9. **New sections:** abuse of offers and listings; what happens when the indexer or chain is down; phones and speed (including no market data in the service worker); accessibility (WCAG 2.2 AA); legal, tax and privacy. The legal work was added to Phase 5.
10. **Gaps list:** added the loose viem pin and the missing .npmrc. Strengths now note that offers already expire and that the demo feed is already fenced.
11. **Sources:** added Robinhood Chain, npm and WCAG sources.

Sources checked in this review: [npm/cli PR 8825](https://github.com/npm/cli/pull/8825), [JFrog npm min-release-age](https://jfrog.com/help/r/artifactory-recently-published-npm-packages-may-be-blocked-for-24-hours-new-client-enforcements), [Arbitrum blog: Robinhood Chain mainnet](https://blog.arbitrum.io/robinhood-chain-mainnet/), [Galaxy research](https://www.galaxy.com/insights/research/robinhood-chain-launch-analysis-base-comparison-memecoins-distribution-thesis), [crypto.news Magic Eden](https://crypto.news/nft-marketplace-magic-eden-exits-bitcoin-evm-trading/), [blockspace.media Magic Eden](https://blockspace.media/insight/magic-eden-to-shutter-bitcoin-and-evm-marketplaces-sunset-multi-chain-wallet), [cryptonews Reservoir](https://cryptonews.net/news/nft/30856993/), [Moralis Reservoir migration](https://docs.moralis.com/get-started/tutorials/migration-guides/migrating-from-reservoir-to-moralis.md), [Tekedia OpenSea](https://www.tekedia.com/robinhood-chain-memecoins-explode-as-opensea-integration-signals-a-growing-on-chain-ecosystem/), [Coinfomania OpenSea](https://coinfomania.com/opensea-news-welcomed-by-robinhood-chain-and-why-its-not-just-hype/), [Crypto Briefing NFT volume](https://cryptobriefing.com/robinhood-chain-surpasses-ethereum-nft-volume/), [Ponder GitHub](https://github.com/namehash/ponder).

