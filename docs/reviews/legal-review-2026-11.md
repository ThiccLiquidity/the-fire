# Legal and regulatory review — for counsel

**Project:** Omni Cardworks (NFT trading cards on Robinhood Chain), repo `/home/user/the-fire`
**Date:** 2026-11-06
**What this is:** a list of issues for a lawyer to look at, written by someone who is not a lawyer. It is not legal advice and not legal clearance. Every finding comes from code I read or from the running demo (`/forge/`, served locally). Nothing in the repo was changed.

**Screenshots** (demo, phone width):
- `/tmp/claude-0/-home-user-the-fire/a657ee05-915e-5a02-8bde-55d7d85c376e/scratchpad/qa/legal/suggest.png`: the suggestion box ("Get picked, win a free pack. Costs 1 PAPER")
- `/tmp/claude-0/-home-user-the-fire/a657ee05-915e-5a02-8bde-55d7d85c376e/scratchpad/qa/legal/arcade-comp.png`: the competitive start screen (one 18+ box, prizes)
- `/tmp/claude-0/-home-user-the-fire/a657ee05-915e-5a02-8bde-55d7d85c376e/scratchpad/qa/legal/arcade.png`: the Arcade list with the prize table
- `/tmp/claude-0/-home-user-the-fire/a657ee05-915e-5a02-8bde-55d7d85c376e/scratchpad/qa/legal/terms-testnet.png`: the Terms page as shown on testnet

**Context that matters:** the docs record that **there will be no lawyer review**:
- `docs/paper-football.md` decision 24: "There's no lawyer review (owner's call)".
- `docs/ticket-economy.md` §7: "No lawyer review (decision 24)".
- Yet `docs/paper-football-plan.md` §12 says "Before the switch: one fixed-fee review by a gaming lawyer".
- `docs/launch-plan.md:144` and `docs/roadmap.md:44` list "a legal read on selling packs with random contents" as an open item.

Most of what follows is the brief that review would need.

---

## Summary table

| # | Area | Risk | Today | Ask counsel / change |
|---|---|---|---|---|
| 1 | Paid suggestions → random draw → free-pack prize | **High** | 1 PAPER per entry, random shortlist of 10, hand-picked winners win packs; no free way to enter, no official rules | Lottery? Add a free entry route + rules, or make suggestions free |
| 2 | Paid random packs + paid random grading, freely resellable | **High** | Odds shown; no country or age limits on packs or grading | Loot-box / gambling status by country (BE, NL, UK, AU…); geo/age limits |
| 3 | Tokens: PAPER, PLANK, Press yield, liquidity fire | **High** | Sales revenue buys PAPER/PLANK and locks it as liquidity; homepage shows "Liquidity locked"; holders get perks | Howey/MiCA analysis; marketing wording; the team's link to PLANK |
| 4 | Sanctions / OFAC | **High** | No screening anywhere; the game server never blocks any country | Front-end and server screening of wallets and countries; a sanctions line in the Terms |
| 5 | Paid skill game for prizes (geo list, age, repeat entries) | Medium-High | 11 US states blocked by IP; one 18+ box; unlimited paid runs | Confirm the list; 19 in AL/NE and 21 in MS; residency; cap repeat entries; full official rules |
| 6 | Terms of service | Medium-High | No operator, no age limit, no governing law, no NFT/IP licence; nobody actively agrees | A proper Terms + sign-up/purchase agreement |
| 7 | Privacy | Medium | No privacy notice; game server keeps IP + wallet + input; tester reports keep wallet + browser | Privacy notice, how long data is kept, deletion; GDPR/CCPA |
| 8 | Consumer protection (refunds, wear pressure, wording) | Medium | "Final, no refunds"; cards wear unless cased; "pack tax" | EU 14-day withdrawal waiver; dark-pattern review; rename "pack tax" |
| 9 | IP: AI art, suggested content, "PDA", Plank | Medium | ChatGPT art; anything users suggest can become a card; "PDA" slabs saying "GEM MINT"; Plank looks like a known cartoon character | IP assignment/licence; content policy; trademark clearance |
| 10 | Tax | Low-Medium | Terms: "pay any taxes that apply"; prizes small | Sales tax/VAT on NFT sales; 1099 thresholds; the operator's own tax |
| 11 | KYC/AML | Low-Medium | No KYC; contracts open to anyone | Confirm no money-transmitter status; AML stance for the market and liquidity fire |
| 12 | Testnet run | Low | Tester guide says "play money"; Terms on testnet say nothing about testnet | Say: test items are worthless, nothing carries over to mainnet, no airdrop |

---

## 1. Paid suggestions that win prizes by random draw — High

**What the code and docs do today:**
- **Paid entry.** Each suggestion costs PAPER:
  - `FireCredits.suggest` / `suggestMany` (`contracts/src/cards/FireCredits.sol:270-290`).
  - The price is `suggestionPaper`, default 1 PAPER (`contracts/script/DeployCards.s.sol:174`), capped at $1.
- **The screen** (verified on the demo, `suggest.png`) reads: "Get weird. Jokes cost PAPER too, and the best ones can get picked. **Get picked, win a free pack.** Costs 1 PAPER".
- **Chance.**
  - `ops/suggestions/draw.mjs` draws a random shortlist of 10 per kind, seeded by drand ("one entry per wallet").
  - The owner then picks from that shortlist by hand.
  - The Info screen confirms it: "10 ideas of each kind are drawn at random … From that random shortlist, the final picks are chosen by hand" (`web/art/factory/forge/info.js:405-406`).
- **Prize.** `FireCredits.pickSuggestions` gives free pack credits (`FireCredits.sol:141-167`). A pack has random contents and can be resold.
- **The public announcement** says the same: "1 PAPER per suggestion … 10 themes and 10 styles are drawn at random … Whoever suggested each wins a free pack" (`docs/announcement-draft.md`, post 2).
- **No free way to enter**, no official rules, no eligibility rules (age, region) and no country blocking. The state geo-block only applies to the game server, not to `suggest`.

**Why it matters:** paying to enter + chance + a prize is the classic definition of a lottery in most US states and many other countries. The hand-picked final step may not remove the chance element, because only the 10 drawn entries can win. The Info line "Every suggestion feeds PAPER to the liquidity fire, so even your jokes do something good for the community" (`info.js:408`) also ties the entry fee to token value.

**Ask counsel:** is this an unlawful lottery or an unregistered sweepstakes (NY/FL registration and bonding rules apply above certain prize values)? Can the hand-picked final step make it a skill contest?

**Possible minimal fixes (pick one):**
- Make suggestions free while prizes are attached (`setSuggestionRules(0, …)` is allowed: "0 = free").
- Or add a free way to enter (for example a free signed form the owner adds to the draw), plus official rules: sponsor, eligibility (18+, places where it is void), dates, prize value, how winners are chosen, odds depending on the number of entries.
- Or drop the random shortlist and judge every entry on published criteria.
- In any case, change the announcement wording before posting.

---

## 2. Paid random packs and paid random grading that can be resold (loot boxes / gambling) — High

**What the code does today:**
- **Packs.**
  - $2.50 + 1 PAPER buys 6 random cards dealt by drand (`docs/omni-economy.md`, `FireSale.sol`).
  - Rare outcomes are explicit chase prizes (Gold, Full Art "one per character", holo flips).
  - Cards can be resold on the built-in FireMarket and outside marketplaces, so outcomes have money value.
- **Grading.**
  - $1 buys a random PDA grade from 1 to 10 (`FirePsa.sol`, fresh odds `FRESH_7..FRESH_10` = 27/40/30/3 % at lines 75-80).
  - The PDA 10 is advertised as "a 1-in-33 chase card" (`docs/grading.md`).
- **Burning.** 42 cards burned earn a free pack (`FireCredits.burnCards`), which is another random draw.
- **Odds are shown** (good):
  - Info shows per-slot, holo and grade odds (`info.js:83-170`, `:358`, `:380-390`).
  - The Terms say "odds are fixed before it sells".
- **No country or age limit on packs or grading.**
  - The Terms ask only "Don't use Cardworks where it isn't allowed" (`terms.html:64`).
  - `docs/market-research.md:157` names Belgium and the Netherlands but nothing is blocked.

**Why it matters:** where outcomes can be sold for money, several regulators treat paid random items as gambling, for example:
- Belgium (paid loot boxes are banned).
- The Netherlands (KSA enforcement on items that can be traded).
- The UK Gambling Commission (items with money's worth).
- Some Australian states (classification and age rules).

In the US, state "chance + consideration + prize" tests and recent sweepstakes-casino laws may reach paid grading with resaleable results, because it is a pure chance outcome paid for separately. Prizes made of packs and gradings (game prizes, burn credits) also bring chance back into the skill game (`docs/ticket-economy.md` §7 already says so).

**Ask counsel:**
- Is a paid pack or paid grade "gambling" or a "loot box" in each target country?
- Do the fixed per-slot odds and the "nothing you pay raises your odds" design help?
- Is the built-in market (with "Sell now") a cash-out route that changes the analysis?

**Minimal changes:**
- A country block for packs, grading and paid suggestions on the site (at least BE and NL, plus whatever counsel adds).
- 18+ in the Terms and at first purchase.
- Keep the odds disclosure on the buy and grade screens (prices yes, no fund flows).

---

## 3. Tokens and securities risk (PAPER, PLANK, Paper Press, liquidity fire) — High

**What the code and docs do today:**
- **Revenue goes into the tokens.** 30% of pack revenue, all of the PLANK holders' group PLANK, every pack's PAPER, case and grading fees, suggestions and game entries go to `LiquidityBurner`. It **buys PAPER (and PLANK)** and adds permanent liquidity to the PAPER/PLANK pool, burning anything over $100 (`docs/liquidity-burn.md`, `docs/omni-economy.md:105-114`, `info.js:416`).
- **The homepage counts it.** It shows a running "LIQUIDITY LOCKED $8.36K / BURNED ALL TIME" counter (verified on the demo; `ui.js:65-67`, `:494-514`).
- **Yield and perks.**
  - Paper Presses were minted by locking PLANK and each mints 1 PAPER a day (`info.js:417-418`).
  - Holders get early, cheaper pack groups (`docs/drop-groups.md`, Standard preset).
- **The model is about buying tokens.** `ops/models/lp_model.py` runs are summed up as "PAPER gets most of the buying … PLANK still comes out ahead" (`docs/liquidity-burn.md`, "The model").
- **People close to the project launched PLANK.** `docs/morning-wood-sources.md:7` lists "One of the two devs who launched PLANK".
- **Mitigating wording exists:**
  - "meme coins" (`info.js:412`).
  - "They're not an investment. Nothing here promises value, profit or a resale" (`terms.html`).

**Why it matters:** sending sales revenue into buying a token, locking liquidity, burns, holder perks and yield from locked tokens are the "efforts of others" and "expectation of profit" facts US regulators look at (Howey). The EU's MiCA may need a white paper or a public-offer analysis for PAPER/PLANK if they are promoted in the EU. Showing "Liquidity locked $" on the homepage reads as value support.

**Ask counsel:**
- Are PAPER, PLANK or the Press securities or crypto-assets needing disclosure in each target market, given the team's role in launching PLANK?
- Does the liquidity-fire mechanism count as a buy-back?
- Can the homepage tally and the line "your jokes do something good for the community" stay?

**Minimal changes:**
- Move the dollar "Liquidity locked" figure behind Info, or show token counts without dollar values.
- Remove value-benefit wording (`info.js:408`).
- Have counsel approve all token marketing before launch.

---

## 4. Sanctions / OFAC — High

**What the code does today:**
- No sanctions screening in the site, the APIs or ops. A search for `ofac|sanction|chainalysis` finds only planning notes (`docs/market-research.md:20,156,256`).
- The game server blocks only `country === 'US' && blocked.includes(region)` (`web/api/games/_lib/server.js:53-55`).
  - Any other country, including comprehensively sanctioned ones (Cuba, Iran, North Korea, Syria, Russia-occupied regions of Ukraine), is approved, paid and can win prizes.
- `award.mjs` sends prizes to any wallet on the board after the owner approves each one by name (`ops/games/award.mjs:99-106`). There is no sanctions check at prize time.

**Why it matters:** US persons may not provide services to, or transfer value (prizes, pack credits) to, sanctioned persons or regions. Contracts are open to anyone, so front-end checks can be bypassed. Even so, regulators expect reasonable screening on the services the operator controls (the site, the game server approvals, the prize sends).

**Minimal changes:**
- Add sanctioned countries/regions to the game server block, before the US-state check.
- Screen wallets (an SDN-list or vendor API) at `create`, in `award.mjs` before `--send`, and before `pickSuggestions`.
- Add a sanctions statement to the Terms.
- Ask counsel about screening on the market and the sale front end.

---

## 5. Paid skill game with prizes (Fold and Flick) — Medium-High

**What the code does today:**

*Geo-blocking*
- **The list.** `BLOCKED_US_STATES = ['AZ','AR','CT','DE','LA','MT','SC','SD','TN','IN','ME']` (`web/api/games/_lib/config.js:5`).
  - That is the nine states usually cited as restricting paid skill contests (AZ, AR, CT, DE, LA, MT, SC, SD, TN), plus IN and ME, matching plan §12.
  - Info shows the same list (`info.js:434`).
- **How it is checked.** Location comes from Vercel IP headers only (`server.js:53`). A missing header is refused unless `GAMES_ALLOW_NO_GEO` is set.
  - That variable is not in the `docs/game-server.md` table, so it could be set on production by accident.
- **The override.** `GAMES_BLOCKED_REGIONS` **replaces** the list instead of adding to it (`config.js:35`). A typo or a partial list silently unblocks states.
- **Residency.** Only the checkbox text "competitive play is allowed where I live" (`games.js:180`). There is no separate residency statement, and nothing stops a VPN.

*Age*
- One checkbox, "I'm 18 or older" (`games.js:162-180`); the server checks `adult === true` (`server.js:57`).
- Plan §12 calls for **19 in AL and NE, 21 in MS, re-checked at prize time**. Neither is built: `award.mjs` has no age or residency step.

*Repeat entries*
- No daily cap (decision 21, `docs/paper-football.md`). The plan noted best-of-N rises with runs bought (`docs/paper-football-plan.md:444,670`) and meant to cap it at 10 a day.

*Bots*
- `docs/game-server.md` says a script can solve the public sim. "Before mainnet the shot conditions get a server-side secret part" is still to do; prizes rely on the owner's manual review.

*Official rules*
- The "Official rules" link opens Info → Arcade (`info.js:427-437`). It covers price, format, ties, prizes, the 18+ rule and blocked states.
- **Missing:** the sponsor's name and address, the start and end dates of each competition, the approximate prize value (packs are random), how and when winners are told, what happens to winners who turn out ineligible, a statement that winners pay their own taxes, disputes and governing law, and where it is void.

*Good points*
- Entry fees do not fund the prizes. Prizes are fixed and capped on chain at 6 packs, 50 cases and 20 gradings per Series (`FireCredits.sol:46-48`).
- Every condition is shown before the kick and replays are deterministic, which supports the skill argument.

**Ask counsel:**
- Confirm the blocked-state list for 2026–27, including recent sweepstakes/skill-game laws (plan §12 names CA, NY, TN, ME), and whether a crypto entry fee changes anything.
- Are prizes with random value (packs, gradings) a problem in a skill contest?
- Does unlimited paid replay weaken the skill defence?

**Minimal fixes:**
- Make `GAMES_BLOCKED_REGIONS` add to the default list, not replace it.
- Add `GAMES_ALLOW_NO_GEO` to the docs as "never on production", or refuse it when `GAME_CHAIN_ID` is 4663.
- Ask for the date of birth or state and apply 19/21 where required.
- Have `award.mjs` require a recorded age/residency/sanctions check for each winner before `--send`.
- Restore a daily paid-run cap.
- Expand the official rules (list above).

---

## 6. Terms of service — Medium-High

**What `web/art/factory/forge/terms.html` has today:**
- Not an investment, prices can fall to zero.
- Transactions final, no refunds.
- Pause rights, wear, random and final grades.
- A short paragraph on fees (fund flows belong here, which is allowed).
- A royalty of up to 10%.
- "Follow your local laws and pay any taxes", "as is".

**Missing:**
- Who operates it (legal entity and contact).
- An age limit (no age in the Terms at all; 18+ exists only for paid games).
- Governing law, dispute resolution or arbitration, limitation of liability beyond "as is".
- Eligibility: banned countries, a sanctions statement.
- **What NFT holders may do with the art (the IP licence).**
- Rights in user suggestions (see §9).
- A privacy section or link.
- Rules for prizes and suggestions.
- How changes are announced: "These terms can change. The date below shows the last change" is passive.

**How people agree:**
- The Terms say "Using Cardworks means you accept these terms" (browsewrap).
- The page is linked only from menus (`info.js:487`, `ui.js:936,985`). There is no click-to-agree at wallet connect, first purchase, grading or paid play.
- Browsewrap is often unenforceable, especially for arbitration clauses.

**Testnet/mainnet copy:** the "Right now Cardworks is a demo" box is hidden on live builds (`keep-live.js:11`). Nothing replaces it on testnet, so testers see no "testnet / play money" note (`terms-testnet.png`).

**Change:**
- Have counsel draft full Terms (and a privacy notice).
- Add a one-time "I agree to the Terms (18+)" checkbox at wallet connect or first paid action, and store that it was accepted.

---

## 7. Privacy — Medium

**What is collected today:**
- **Game server.** `game_runs` stores `wallet` + `ip` for every run. `game_kicks` and `game_rejects` keep raw pointer input. All of it sits in Neon with no retention limit (`web/api/games/_lib/schema.sql`; `server.js:66` writes `ip: ipOf(req)`).
  - Plan §8 said "The privacy line goes behind Info/Help ('anonymous kick data…')", but no such line exists. Searching Info, Terms, Help and games.js finds nothing.
  - The data is not anonymous: it is tied to wallet and IP.
- **Tester reports** (`web/api/report/_lib/server.js`, `store.js`) store wallet, page, network, full user-agent, screen size, the last 5 page errors and free text, with no retention limit.
  - It is disclosed at the point of sending: "Sent with it: your wallet address, this page, your browser and screen size, and any errors the page saw" (`ui.js:839`). Good.
- **Web push** (`web/api/push/_lib/schema.sql`) stores push endpoint + wallet.
- **No privacy notice anywhere.** `docs/market-research.md:154-159` planned one.

**Why it matters:** IP + wallet together are personal data under GDPR/UK GDPR. CCPA and other US state laws also need notice. Public on-chain data linked to IP increases the sensitivity.

**Change:**
- Publish a privacy notice: what is kept, why, for how long, who processes it (Vercel, Neon), and how to ask for deletion.
- Set retention (for example, delete IPs after the Series' prizes are sent; delete reports after the test).
- Hash or truncate IPs used only for rate limits.
- Link the notice from the report sheet, the push opt-in and the competitive start screen.

---

## 8. Consumer protection — Medium

**What the code and docs do today:**
- **Refunds.** "Transactions are final … Grades are random and final: no refunds" (`terms.html`, `info.js:382`).
  - EU/UK consumers have a 14-day withdrawal right for digital content. It is lost only with express prior consent and acknowledgement at purchase, and there is none.
- **Wear pressure.**
  - Cards wear daily unless cased ($0.05) or graded ($1) within 24 h.
  - "After 14 days raw a PDA 10 is gone for good" (`info.js:380`, `docs/grading.md`).
  - This deliberately pushes people to pay fast and may be looked at under FTC/EU dark-pattern guidance. It is disclosed, which helps.
- **"Pack tax"** (`info.js:260,314`, contract `taxBps`): the 4% rising price is called a "tax" although it is a price rise that goes to the liquidity contract. That can mislead people into thinking it is a government tax.
- **Odds consistency.**
  - The contract (`FirePsa.sol:77-80`) and the site (`wear.js`, "1 in 33") agree: 3/30/40/27.
  - `docs/omni-economy.md:43` still says "10: 1% · 9: 30% · 8: 40% · 7: 29%". It is only a doc, but if copied into marketing it would be a misstatement.
- **Scarcity promise.** "No reprints, ever" (`docs/announcement-draft.md`) is a marketing promise. Make sure the contracts back it (the Series closes for good) and that it does not conflict with "After sell-out" extra packs.

**Change:**
- Ask counsel about the EU waiver wording at checkout.
- Rename "pack tax" to "rising price".
- Fix the odds line in `omni-economy.md`.
- Keep odds on the purchase and grade screens.

---

## 9. Intellectual property — Medium

**What the docs and code do today:**
- **AI-made art.** Character art comes from ChatGPT (`docs/paper-football-art.md:3-9`, `docs/card-studio.md`).
  - In the US, purely AI-generated images may not be protected by copyright. That limits enforcement and what can be licensed to holders.
  - The Terms grant holders no licence at all.
- **Anything suggested can become a card.** "Go full degen. Ridiculous, raunchy, unhinged: send it" (`info.js:408`).
  - Suggestion text is stored on chain for good (in events, `FireCredits.sol:38`).
  - There is no content policy and no ban on real people, brands or third-party characters.
  - There is no transfer or licence of the suggester's rights in their idea.
- **"PDA (Professional Digital Authenticators)"** slabs with "GEM MINT, MINT" (`info.js:382`), plus contract and docs names `FirePsa`.
  - This is close to PSA (Professional Sports Authenticator, a registered mark) and its slab look.
- **Plank** "resembles the Plank character from a well-known cartoon" (`docs/paper-football-plan.md` §12; decision 24 keeps his look).
- **Morning Wood (intentionally "Coming soon").** It plans AI writers "copying a famous writer's style", Imgflip meme templates (the templates are often copyrighted images) and real named accounts (`docs/morning-wood.md`, `docs/morning-wood-sources.md`). Defamation and publicity-rights review is needed before it launches.
- **Royalties.** Capped at 10% (`FireCards.sol:63`), honoured only by marketplaces that choose to. The Terms say so (good).

**Change:**
- Terms: a licence to NFT holders (personal / limited commercial use).
- Suggester terms: a licence or transfer of rights in their idea, plus a content policy (no real people, brands or third-party IP; nothing obscene).
- A trademark search on "Omni Cardworks" (already listed at `launch-plan.md:144`) and on "PDA" slabs.
- Counsel's view on Plank's resemblance before paid launch.

---

## 10. Tax — Low-Medium

**What the code and docs do today:**
- The Terms say "pay any taxes that apply".
- Plan §12 says prizes are about $2.50 a pack, "well under the $2,000 reporting threshold". In practice, top-place prizes in `prizes.json` are 2 packs + 4 gradings + 10 cases, about $9.50 at list price (verified on the demo).
- `docs/market-research.md:158` plans a per-wallet CSV export.

**Ask counsel:**
- Sales tax or VAT on NFT and grading sales in target states and countries (several US states tax NFTs as digital goods).
- Whether prize value (random packs) needs reporting, and the current 1099 threshold.
- How the operator treats its own crypto revenue.
- Whether any 1099-DA broker duty applies to the built-in market (it probably does not, since it is peer-to-peer and holds no customer funds, but confirm).

---

## 11. KYC / AML — Low-Medium

**What the code does today:**
- No KYC.
- Contracts are open to anyone and hold no customer funds (FireSale "never holding funds"; LiquidityBurner has no withdraw path).
- Payments are in ETH, USDG and PLANK.
- The built-in market is peer-to-peer.

**Ask counsel:**
- Confirm that selling your own NFTs and running a peer-to-peer market does not make the operator a money transmitter or VASP (FinCEN; MiCA/AMLR in the EU).
- Whether the liquidity contract's swaps change anything.
- Whether a stolen-card policy is needed (planned at `docs/market-research.md:256`).

---

## 12. The testnet run (play money) — Low

**What the docs and site do today:**
- **Tester guide** (`docs/test-run-playbook.md:128-140`): "Everything here is play money on a test network: nothing costs real money"; testers use fresh wallets. Good.
- **Data collected from testers.**
  - Testers send their wallet address by chat.
  - The report sheet sends wallet, browser and screen size (disclosed on the sheet).
  - The game server would log IP + wallet for any competitive run testers play (`test-run-playbook.md:99`).
- **The Terms page on testnet** shows no testnet note (the demo box is hidden; `terms-testnet.png`).

**Add to the tester guide and the testnet banner:**
- Testnet tokens, cards, prizes and credits have no value, cannot be sold for money and **do not carry over to mainnet**.
- There is **no airdrop, allowlist or reward** for taking part. This avoids a later claim that the test was a paid promotion, and avoids "consideration" for future perks.
- What data is collected (reports, game IPs) and when it will be deleted.
- Testers must be 18+ for competitive runs, as on live.

---

## Smaller items found along the way (not legal, but they affect accuracy)

- `contracts/src/cards/FireCredits.sol:271` NatSpec still says the suggestion PAPER "is burned". It now goes to `LiquidityBurner` (`docs/liquidity-burn.md`). If shown on a block explorer, it misdescribes where funds go.
- `docs/paper-football.md` decision 22 says "Prizes go out automatically … no manual step". `docs/game-server.md` and `ops/games/award.mjs:104-106` require manual approval of each winner, which is the safer, actual behaviour. Align the docs so the rules do not promise automatic payout.

---

## Questions to bring to counsel, in priority order

1. The suggestion draw (§1): lottery or not; is a free way to enter or free suggestions enough?
2. Paid packs and paid grading (§2): which countries to block; is the built-in market a cash-out?
3. Tokens (§3): PAPER, PLANK and the Press under Howey and MiCA; the liquidity fire as buy-back; homepage figures.
4. Sanctions screening scope (§4).
5. The skill game (§5): state list, age (19/21), repeat entries, prizes with random value, official rules.
6. Terms, how people agree, the privacy notice, the EU withdrawal waiver (§6–8).
7. IP: holder licence, suggester rights and content policy, "PDA"/PSA, Plank (§9).
8. Sales tax/VAT and prize reporting (§10).
