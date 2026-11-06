# PAPER and PLANK: utility and economics review

Scope: I read `docs/liquidity-burn.md`, `omni-economy.md`, `drop-groups.md`, `ticket-economy.md`, `grading.md`, `review-2026-10.md`, `addresses.md`, `morning-wood.md`, `paper-football.md` and `spitwad-plan.md`. On the code side I read `contracts/src/cards/{FireSale,FireCredits,FireGames,FirePsa,FireMarket,LiquidityBurner,FireProfiles}.sol`, `contracts/src/press/MorningWood.sol`, `contracts/script/DeployCards.s.sol`, `studio/src/sale.ts` and `web/art/factory/forge/prizes.json`. I also looked at the demo site (Stations open, grade, games, suggest, cards). Nothing in the repo was changed. Screenshots are in `/tmp/claude-0/-home-user-the-fire/a657ee05-915e-5a02-8bde-55d7d85c376e/scratchpad/qa/econ/`.

The card frames, holo and text looks are locked, and none of the proposals touches them. Every proposal follows the money-talk rule: screens show prices only, and fund flows stay behind Info/Help.

---

## 1. Verified problems

| # | Severity | Where | What's wrong | Why it matters | Minimal fix |
|---|---|---|---|---|---|
| 1 | Medium | `docs/omni-economy.md:280-290` ("Money, roughly") | The doc says to scale the revenue table by about 0.7 because "117 of 167 packs are paid". But in the Standard preset the 40 PLANK-holder packs send 100% of their PLANK to LiquidityBurner and give no revenue (`studio/src/sale.ts:164`: `plankBurnPercent: '100', paperBurnPercent: '0'`; `FireSale._collect` line 522). Up to 16 free credit packs, game prize packs included, are also taken out of Everyone's 77 (`FireSale.creditPacks`, `creditGroup: 2`). Only 61-77 base packs a Series earn revenue, a factor of 0.37-0.46 of 167, not 0.7. | The table overstates monthly revenue by about 50-90%. For example, it implies about $530 a month at 100 packs a week; the real figure is about $280-350, plus Extra packs. `liquidity-burn.md`'s $187 a Series is the right figure, but only if no credit packs are used. Business decisions read this table. | Rewrite the table as revenue per Series = (Everyone packs sold − credit packs used) × $1.75 + Extra packs × $1.75, which gives $107-187 per Standard Series. Note that the PLANK-holder group gives no revenue. |
| 2 | Low | `docs/omni-economy.md:43` and the table at `:258-263` | Fresh PDA odds are listed as 10: 1%, 7: 29%. The contract has `FRESH_10 = 300` and `FRESH_7 = 2700` (`FirePsa.sol:77-80`), which is 3% and 27%. `docs/grading.md` and the site both show 3% (screenshot: `/tmp/claude-0/-home-user-the-fire/a657ee05-915e-5a02-8bde-55d7d85c376e/scratchpad/qa/econ/grade.png`). | The economy doc contradicts the chain on the main chase odds. Anyone pricing gradings or slabs from it is off by 3×. | Change both places to 3% / 30% / 40% / 27%. |

No fund-flow wording turned up on the open, grade, games, suggest or cards screens. They show prices only ("$1 each", "1 PAPER each"). The header still shows the "Liquidity locked / Burned all time" tally everywhere; that is an owner-approved tally (task 15) and doesn't explain where funds go.

---

## 2. Where PAPER and PLANK go today

### PAPER

| Flow | Amount | Where it goes | Source |
|---|---|---|---|
| **Earned: Paper Press printing** (off-site, PAPER contract `0x0642…b3e6`) | 1 PAPER per press per day, stacking until claimed, forever until the press is burned. About 2,080 presses make **about 2,080 a day, about 63,000 a month** | To press holders | `review-2026-10.md` #29, `omni-economy.md:228` |
| Earned on the site | **None.** Game prizes are pack credits and case or grading coupons, never PAPER | n/a | `FireCredits.awardPrizes` |
| Every pack: press claim, paid, credit or Extra | 1 PAPER (per group; Standard is 1), at most `paperCapUsd` = $1 of PAPER | LiquidityBurner | `FireSale._burnPaper` (566-580) |
| `buyWithEthAll` | The pack's PAPER bought on the market with ETH (via ETH→PAPER or ETH→PLANK→PAPER) | LiquidityBurner | `FireSale._burnPaper` / `_paperRoute` |
| Suggestions (theme, art style, character) | 1 PAPER each (`SUGGESTION_PAPER` default 1e18), at most $1, up to 3 per transaction | LiquidityBurner (via `FireSale.burnPaperFor`) | `FireCredits.suggest` / `suggestMany` |
| Competitive game runs (Fold and Flick id 1, Spit-Wad id 2) | min(1 PAPER, $0.10 of PAPER), fixed forever per game id; at most 10 paid runs per wallet per day (server rule) | LiquidityBurner | `FireGames.payRun`, `DeployCards.s.sol:116-118` |
| Morning Wood copies and letters (Coming soon) | 1 PAPER + $0.05 a copy; 1 PAPER a letter (`MAX_PAPER` 10) | LiquidityBurner | `MorningWood.sol:67-69, 208, 229` |
| Cases and grading | **Can't be paid in PAPER.** The fee is paid in PLANK, ETH or USDG, 100% to LiquidityBurner, which then buys PAPER and PLANK | LiquidityBurner | `FirePsa._pay` |
| Pack dollar price | **Never PAPER** | n/a | `omni-economy.md:93` |
| LiquidityBurner's market buys | While the PAPER side is under $50, 60% of incoming ETH and USDG buys PAPER; after that, whichever side is short. A PLANK side heavier than the PAPER side sells half the gap for PAPER | Paired into PAPER/PLANK V2 liquidity, LP tokens sent to `0xdEaD`; either side over $100 is burned outright | `LiquidityBurner._spend`, `paperShare`, `_evenOut`, `_pair`, `_cap` |
| FireMarket | Paid in ETH only; no PAPER or PLANK, no fee; 5% ERC-2981 royalty (capped at 10%) to the royalty wallet | Royalty wallet | `FireMarket._payOut` |
| Site "Get PAPER" swap | A 0.5% fee to the swap-fee wallet (not set yet) | Swap-fee wallet | `omni-economy.md:224-226` |

**PAPER taken in per Standard Series** (167 packs + about 30 Extra, 200 runs, 100 suggestions, PAPER at $0.05-0.08):

- Pack PAPER: about 197
- Game entries: about 200
- Suggestions: about 100
- LiquidityBurner's buys: about $187, which is 2,340-3,740 PAPER

That is about 2,800-4,200 PAPER a Series. At 2 Series a month it comes to **about 5,700-8,500 PAPER a month, about 9-13% of what the presses print.** The owner accepted this in review #29 ("print outpaces the sinks; the goal is value to holders").

**Locked liquidity is not burned supply.** PAPER paired into the pool and locked stays in the pool's reserves, and buyers can take it out. What locking does is turn it into permanent two-sided market depth. Only the over-$100 excess is truly burned. Locking is good for price stability and for exit liquidity (largely press holders selling what they printed), but it is weaker than a burn as a supply sink. This matters when new sinks are sized:

- **PAPER that arrives as PAPER partly replaces LiquidityBurner's own PAPER buys.** Once the PAPER side holds $50 or more, ETH and USDG go to the short side, usually PLANK.
- **Large new PAPER sinks would keep the PAPER side between $50 and $100.** LiquidityBurner's ETH would then mostly buy PLANK, and PAPER above $100 would burn outright. That is a real sink.

### PLANK

| Flow | Amount | Where it goes |
|---|---|---|
| **Held: snapshot gate** | $69+ of PLANK held for 7 days opens group 2: 40 packs, 5 per wallet; allowance tiers are possible per leaf | n/a (a reason to hold) |
| Group 2 packs (PLANK holders) | $2.50 in PLANK + 1 PAPER; **100% of the PLANK** goes to LiquidityBurner, no revenue | LiquidityBurner |
| Group 3 packs paid in PLANK | $2.50: 30% to LiquidityBurner, 70% revenue (in PLANK) | LiquidityBurner / revenue wallet |
| Cases ($0.05) and grading ($1) paid in PLANK | 100% | LiquidityBurner |
| LiquidityBurner selling PLANK | About $84 a Standard Series (half of any PLANK-over-PAPER gap is sold for PAPER) | Market (sell pressure) |
| LiquidityBurner buying PLANK | The short-side share of ETH and USDG | Market (buy pressure) |
| PLANK paired or burned | Paired with PAPER into LP sent to dead; over $100 burned | Locked or burned |
| Revenue wallet | About $42 of PLANK a Standard Series | Owner (sell pressure if sold) |
| Earned on the site | None | n/a |
| Press burns (external `PlankPress.burn`) | Releases **88.8B PLANK (about $94) per press** to the burner and stops that press's PAPER | Unlocks PLANK supply |

Model result (`liquidity-burn.md`): PLANK comes out **+$27 net a Standard Series** (−$47 in a quiet one), and PAPER gets about 7× PLANK's net buying.

---

## 3. Proposed utilities (12)

The ideas are ordered roughly by value for PAPER. Each one keeps these rules:

- **Not pay-to-win.** Nothing changes pack odds, grade odds or game physics.
- **No PAPER payouts.** No new faucet.
- **No random paid boxes.**
- **Prices only on the screen.** Fund flows stay behind Info/Help.

Sizing assumes Standard scale (2 Series a month, a few hundred players) and PAPER at $0.05-0.08.

### 3.1 Pay cases and grading in PAPER (with a small "Mill price" discount)

- **What the player does:** in the Case & grade review step, picks "Pay in PAPER (10% off)" next to PLANK, ETH and USDG.
- **Why it's fun:** press holders have a daily trickle of PAPER and nothing much to spend it on. This turns PAPER into "my grading money", the most common recurring purchase on the site.
- **Token flow:** PAPER goes to LiquidityBurner. With heavy PAPER inflow the PAPER side caps at $100 and the excess burns outright (a true burn), while ETH and USDG from other buyers shift toward buying PLANK.
- **Sizing:** the model assumes 15% of cards cased and 8% graded, about $87 of fees a Series. If half is paid in PAPER, that is about 500-900 PAPER a Series (**about 1,000-1,800 a month**). It grows with card count and any rise in grading.
- **Complexity:** a contract change. Add `Pay.PAPER` to `FirePsa._pay`/`quote` and `LiquidityBurner.quote`, priced from the burner's 30-minute PAPER average (`prices()`). FirePsa isn't on mainnet yet, so this is cheap to do now and impossible later.
- **Risks and security:**
  - Pushing the PAPER price for cheap gradings is bounded: there is the 30-minute average plus the 2× sanity check against PaperUsdTwap, every batch carries a `maxCost`, and the most at stake is $1 a card.
  - Keep the discount at 10% or less, so pushing the price never pays.
  - This **reverses the documented "Not payable in PAPER" rule** (`omni-economy.md:211, 243`), so it needs the owner's decision.

### 3.2 Turn up PAPER per pack (no contract change)

- **What the player does:** nothing new. The press claim costs, say, 5-10 PAPER instead of 1, and paid packs 2 PAPER.
- **Why it matters:** a press claim at 1 PAPER is a pack for 1 day of printing. Ten days of printing for a pack is still a gift to holders.
- **Token flow:** PAPER goes to LiquidityBurner. `paperCapUsd` ($1) still caps every pack.
- **Sizing:** press packs 50 × 9 = 450, plus paid packs about 147 × 1 = 147, so **about +600 PAPER a Series (+1,200 a month)**.
- **Complexity:** studio preset (`sale.ts` `standardSale`) and `configureDrop` per drop.
- **Risks:** extra cost for newcomers. `buyWithEthAll` and "Get N PAPER" already cover them, and 1 extra PAPER is about $0.05-0.08 on a $2.50 pack. Keep paid packs at 2 or less.

### 3.3 Set Plaques (soulbound collection trophies)

- **What the player does:** completes a set and claims a plaque for their profile and binder:
  - "Paper Set": every character of a Series in Paper
  - "Rainbow": one character in every material
  - "Master Set": everything
- **Why it's fun:** it gives collectors a goal, drives trading for the last missing card, and shows off. It builds on the site's existing completion badges (`badges.js`) and makes them permanent.
- **Token flow:** a claim fee in PAPER to LiquidityBurner, for example 25, 50 or 150 PAPER by tier.
- **Sizing:** 20-60 claims a Series × 25-150 PAPER is **about 1,000-5,000 PAPER a Series**.
- **Complexity:** a new small contract (`FirePlaques`, ERC-5192 non-transferable). At claim it checks `ownerOf` and `cardOf` (Series, character, type) for the serials given. It needs its own exact PAPER approval and sends the PAPER straight to the burner. Plus site work.
- **Risks and security:**
  - A set could be passed between wallets to claim several times. Fix: each serial counts toward one plaque per set type, ever, recorded on chain.
  - Rent-a-set through the market costs real royalties and adds wear (moves), which is acceptable.
  - It's cosmetic, with no payout.

### 3.4 Cosmetics shop: game skins, binder covers, profile rings

- **What the player does:** buys a Fold and Flick ball skin or kick trail, a Spit-Wad straw or wad skin, a binder cover, a showcase shelf style or a profile-picture ring, with PAPER, at fixed prices (10-60 PAPER).
- **Why it's fun:** personal expression, and visible in shared clips and on profiles.
- **Token flow:** PAPER to LiquidityBurner.
- **Sizing:** **about 1,000-4,000 PAPER a Series**.
- **Complexity:** one small ERC-1155 contract (`FireCosmetics`, non-transferable, fixed prices, PAPER straight to the burner), plus site rendering.
- **Risks:**
  - **Pay-to-win:** skins must not change physics, hitboxes or contrast in ways that help aim. Show trails only after a shot, and keep the server replay untouched.
  - **Gambling:** no random cosmetic boxes.
  - **Locked looks:** no card frames or card looks; those are locked.

### 3.5 Tournament Nights (a second game id with a higher entry)

- **What the player does:** a weekly 2-hour event board (for example "Friday Flick") with a 5-PAPER entry capped at $0.50. Prizes are plaques, cosmetics or titles only, plus a share of the existing on-chain prize caps if wanted.
- **Why it's fun:** an appointment to show up, a tight leaderboard, bragging rights.
- **Token flow:** entries to LiquidityBurner, through `FireGames` as it stands.
- **Sizing:** 50 players × 5 runs × 5 PAPER is **about 1,250 PAPER a week (about 5,000 a month)**.
- **Complexity:** almost none on chain. The owner calls `addGame(3, 5e18, 50_000_000)` and toggles `setGameOpen`; the event board is server and site work.
- **Risks:**
  - **Paid-entry contest law** (`paper-football-plan.md` risk list). Cosmetic-only prizes keep prize value low; keep the 18+ and location checks and the 10-runs-a-day cap.
  - **Bots:** the existing replay checks and review flags.

### 3.6 Gift-wrapped packs

- **What the player does:** sends a sealed pack to a friend with a wrapping-paper style and a short note. The friend gets an unwrap moment.
- **Why it's fun:** it's social and gets friends to try the site.
- **Token flow:** 1-2 PAPER per gift to LiquidityBurner.
- **Sizing:** small, about 100-300 PAPER a Series. It's mainly for growth.
- **Complexity:** a small `FireGifts` contract. The sender calls `PACKS.safeTransferFrom(self, Gifts, series, n, abi.encode(to, style, note))`, and `onERC1155Received` forwards the packs to `to` and pulls the PAPER, with an exact approval. There is **no setApprovalForAll**. Plus site work.
- **Risks:**
  - The note could be abusive: show it only to the recipient, behind a "Show note" tap.
  - Sealed packs don't wear. Gifting cards would add a move, so the screen must say so, or allow packs only.

### 3.7 Suggestion stamps ("Back this one")

- **What the player does:** stamps someone else's suggestion for 1 PAPER, at most once per wallet per suggestion. The most-stamped suggestion of each kind gets a guaranteed seat among the 10 drawn. Stampers of a picked suggestion get a "Called it" badge.
- **Why it's fun:** the community gets a voice and something to follow before each Series.
- **Token flow:** PAPER to LiquidityBurner.
- **Sizing:** about 100 suggestions × 5 stamps is **about 500 PAPER a Series**.
- **Complexity:** a tiny new contract (events, a per-wallet stamped bitmap, PAPER straight to the burner), plus a change to the draw script (`ops/suggestions/draw.mjs`).
- **Risks:**
  - Whales buying a seat: it's only 1 of 10 seats, the owner still picks, and the prize is 1 free pack.
  - Sybil stamping costs real PAPER.

### 3.8 The Bonfire (a community goal at the end of each Series)

- **What the player does:** in the last week of a Series, throws PAPER into a shared fire meter. Each tier unlocks a community reward for the next Series, such as a special pack wrapper (pack art only, not card looks), a drop-day Morning Wood edition once it is live, or an extra theme finalist. Contributors get bronze, silver or gold badges, capped per wallet.
- **Why it's fun:** a shared goal and a spectacle (the furnace is already part of the brand).
- **Token flow:** PAPER to LiquidityBurner. Heavy inflow spills over the $100 cap and burns outright.
- **Sizing:** depends on press holders taking part: **about 2,000-20,000 PAPER a Series**. This is the only idea big enough to move the emissions gap.
- **Complexity:** a tiny "Tribute" contract (per-Series totals, PAPER straight to the burner, events), plus the meter on the site.
- **Risks:**
  - **Financial language:** it must never be marketed as "burn to pump". Keep the unlocks creative or cosmetic, and keep any fund-flow wording behind Info.
  - Badge tiers capped per wallet so whales don't own the event.

### 3.9 PLANK holder tiers (config only)

- **What the player does:** holds more PLANK for a bigger group-2 allowance, for example $69+ = 2 packs, $690+ = 5 packs, held 7 days. LP positions count too (`ops/snapshot` already supports this).
- **Why it matters:** holding PLANK gets a clear, fair ladder.
- **Token flow:** none directly; it rewards holding. Group 2's PLANK already goes 100% to the burner.
- **Complexity:** a snapshot setting only (allowance per leaf, `docs/drop-groups.md`).
- **Risks:** whale concentration, bounded by the group's 40 packs and the per-wallet cap.

### 3.10 The Workbench: PLANK-weighted theme polls

- **What the player does:** PLANK holders vote with a signature (no gas, no spend) on the drawn theme and art-style finalists. Weight is the square root of PLANK held over 7 days. Results show on the Suggest screen, and the owner keeps the final pick.
- **Why it's fun:** holders shape the next Series.
- **Token flow:** none; it's a reason to hold PLANK.
- **Complexity:** site and server only (EIP-712 signed votes, a snapshot from `ops/snapshot`).
- **Risks:** it could read as governance. Label it a non-binding poll and keep the owner's veto. Square-root weighting limits whales.

### 3.11 A PLANK lane on Everyone

- **What the player does:** pays a bit less when paying in PLANK, for example $2.40 in PLANK against $2.50 in ETH or USDG.
- **Token flow:** more PLANK demand at purchase. Revenue comes in as PLANK.
- **Complexity:** either no contract change (a second open group, PLANK only, at $2.40, splitting Everyone's packs) or a per-coin price multiplier in FireGroups.
- **Sizing:** shifts the payment mix from the model's 30% PLANK toward 50%. About +$30-50 of PLANK demand a Series.
- **Risks:** slightly less revenue. The owner holds more PLANK (price exposure). It also widens the gap with ETH buyers, which can feel unfair, so keep it at 5% or less.

### 3.12 Retire a Press (lowers PAPER emissions)

- **What the player does:** burns a Paper Press through Cardworks and gets a permanent "Pressman" plaque and a commemorative profile ring, with the press's PLANK returned as usual.
- **Why it matters:** each retired press cuts 365 PAPER a year of printing for good. 100 retirements cut about 36,500 a year, about 5% of emissions, with no ongoing buying needed.
- **Token flow:** PAPER emissions go down. But `PlankPress.burn` releases **88.8B PLANK (about $94) per press** (`docs/addresses.md`), which is PLANK sell pressure, and the press group shrinks.
- **Complexity:** medium.
  - A new contract takes the press in `onERC721Received`, calls `burn{value: 0.0003 ether}`, forwards the PLANK and records the plaque, all in one transaction.
  - Check `pulpPool.releaseBurned` and the burn-fee path on a fork first.
- **Risks:**
  - It is good for PAPER and bad for PLANK. Cap the number of retirements per Series, or pair each one with a PLANK option such as "keep 50% of the PLANK in burned LP" (the user chooses).
  - Do not give pack credits as the reward unless FireCredits gets a capped path for it.

### Do not build

- PAPER staking or yield.
- Sending revenue or royalties to the PulpPool (a securities-like profit share).
- PAPER wagers or player-vs-player pots.
- Paid rerolls of grades or odds (pay-to-win, and grades are final by design).
- Random paid boxes.
- Any game that pays out PAPER (it adds to emissions).

### Rough total

At today's activity, 3.1-3.8 plus 3.12 could take in about **15,000-45,000 PAPER a month**, against about 63,000 printed (today about 6,000-8,500). Only the Bonfire and Set Plaques are large, and both depend on press holders taking part.

---

## 4. Is the revenue model sustainable?

**Small scale (Standard drop, 2 Series a month):**

- **Revenue:** $107-187 a Series, which is about $215-375 a month or $2.6k-4.5k a year, plus 5% royalties on FireMarket ETH sales (about $15 a month on $300 of volume).
- **Costs:**
  - Hosting $20-40 a month
  - Dealing gas 1-3¢ a pack
  - Keeper gas
  - Game server and database
  - Image pinning
  - The one-time security review (not covered by revenue)
- **Net:** about $150-300 a month. That's a self-funding hobby, not a business.
- **Strengths:**
  - Revenue is in dollars and doesn't depend on the PAPER price.
  - LiquidityBurner has no withdraw, so there is nothing to drain.
  - Prize caps are fixed on chain: at most 6 packs, 20 gradings and 50 cases a Series.
- **Weaknesses:**
  - Up to 16 free packs a Series displace paid Everyone packs, about $28 of revenue.
  - About 22% of revenue comes in as PLANK (exposure to its price).
  - Game prizes at the caps have about $37 of face value against about $10-16 of entries at launch.

**Large scale (for example the Giant preset, 10,000 packs):**

- **Revenue:** about 8,000 Everyone packs × $1.75 is about $14k per drop, plus Extra packs. That is healthy.
- **LiquidityBurner** would take in $7.5k or more per drop and runs into pool depth:
  - Buys must get 95% of the averages' value, and liquidity is added only within 3% of the pool's own average, so big buys stall. ETH and USDG have **no cap** while they wait (`liquidity-burn.md:71-73`).
  - A large, visible ETH balance with a known keeper schedule invites traders to move the price ahead of the 30-minute averages.
  - Mitigations:
    - pace runs, at most about $X per run in small pieces (it already tries down to 1/64);
    - add a keeper alert threshold that scales with the drop;
    - before big drops, think about a deeper PAPER route (the router is fixed per LiquidityBurner, so this means a new LiquidityBurner between drops).
- **PAPER:** at about 10× today's activity, pack, game and fee sinks plus the burner's buys come close to the printing rate even without new utilities.
- **PLANK:** it gains from bigger PLANK-side buying once the PAPER side holds $50 or more. The group-2 sell-for-PAPER leak stays small.

**Overall:** sustainable as a small project that pays its own costs. It becomes a business only through more Series and more players, not through token prices. On the token side, the design keeps building market depth rather than removing supply. That fits the owner's stated goal ("value to holders, not a price target"), but it won't offset press emissions on its own. Proposals 3.3, 3.5 and 3.8 (plus 3.1 if the owner reverses the no-PAPER rule) are the ones that close the gap in a way players will enjoy.
