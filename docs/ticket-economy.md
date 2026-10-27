# Ticket economy: recommendation

Status: **shelved by the owner (Oct 27, 2026).** Not to be built. Both games use top-three leaderboard prizes (3/2/1 packs) instead. Kept as research only.

## 1. The idea in brief

Paid competitive runs in Fold and Flick and in Spit-Wad Sniper earn tickets. Free play and practice earn none. Players spend tickets in a prize shop on free cases, free gradings and free pack credits, with more items later. Tickets live in their own balance, separate from leaderboard scores, so spending never lowers a ranking.

Three rules keep it sustainable:
- **Tickets follow the PAPER price.** A run's tickets are set by the dollar value of the 1 PAPER it burned, so a PAPER crash can't make farming pay.
- **Shop stock is capped on chain each Series.** This holds even if the server is hacked.
- **Earning is throttled.** Each Series, the earn rate is set so tickets issued stay within what the shop can supply.

What it costs: at most **$7 of cash per Series** (4 packs). Everything else is PAPER burn that doesn't happen. At launch scale players get back about **20%** of the dollar value they burn on entries, which is the arcade norm.

## 2. How tickets are earned

**Tickets per run = curve(result) × M × k**, where:
- **M** = the lower of the PAPER price at the start of the Series, the live PAPER price (both from the `PaperUsdTwap` feed) and $1. The live price stops a mid-Series crash from making farming pay. The $1 cap matches the sale's ceiling.
- **k** = the throttle, between 0 and 1. It is reset each Series (see §5).

At M = $1 and k = 1:

| | Floor | Per step | Milestone bonuses | Cap |
|---|---|---|---|---|
| Fold and Flick (made streak) | 40 | +18 per make up to 10, then +25 | +60 at 8, +80 at 12, +100 at 16, +150 at 20 | 800 |
| Spit-Wad (rounds cleared) | 40 | +22 per round up to 8, then +30 | +50 at 5, +100 at 10, +100 at 15, +150 at 20 | 800 |

- 1 ticket = $0.0005 of prize value.
- The 800 cap means one run can never return more than **40%** of its PAPER's value. Only a perfect bot reaches the cap.
- Medians are about streak 8 in Fold and Flick and about round 7 in Spit-Wad. The milestones sit just past them, so a near miss feels close.
- At today's PAPER price ($0.05), M = 0.05. A run then earns 2 tickets at the floor, about 12 for an average run and 40 at most. Store fractional tickets.
- **What earns:** only runs that are paid (`RunPaid` seen on chain) and that pass the server's replay check. Practice kicks, re-dealt rounds and free play earn nothing. Spit-Wad runs marked `timing:unverified` earn nothing until reviewed.

## 3. The prize shop

| Item | Tickets | Value | On-chain stock per Series | Per wallet per Series |
|---|---|---|---|---|
| Case | 100 | $0.05 | 400 | 40 |
| Grading coupon | 2,000 | $1.00 | 200 | 10 |
| Pack credit | 10,000 | $2.50 (2x premium) | 4 | 1 |

- **Prices never change.** Tune earning instead, so tickets players hold never lose value.
- **Stock is released in thirds** (days 1, 6 and 11 of a Series), so nobody can buy out a restock in its first second.
- **A pack credit opens in a drop's free-pack group** and still burns 1 PAPER to open. The shop says "opens in the next drop" and "4 packs left this Series".
- **To redeem**, a wallet must have bought at least one pack and played at least 10 paid runs.
- **Shop screens show ticket prices only.** Where funds go stays behind Info/Help.
- **Later:** aspirational items (card backs, badges) at 2,000–5,000 tickets soak up tickets without costing packs.

## 4. What it costs (from the model, 10 Series)

"Payout" = value of prizes redeemed ÷ dollar value of PAPER burned on entries.

| Players | PAPER | Entries burned | Payout | Cash cost |
|---|---|---|---|---|
| 100 | $0.05 | $175 | 15.9% | $1.75 |
| 300 | $0.05 | $508 | 19.5% | $1.75 |
| 300 | $0.08 | $813 | 19.3% | $5.25 |
| 300 | $0.25 | $2,534 | 7.6% (throttled) | $5.44 |
| 1,000 | $0.08 | $2,616 | 6.3% (throttled) | $3.50 |
| 1,000 | $1.00 | $32,800 | 0.7% (throttled) | $7.00 |

- **Cash cost** is never more than $7 per Series: 4 packs × $1.75 of sale revenue. A pack only costs that if it would otherwise have sold.
- **Gradings and cases cost no cash.** They mean less PAPER bought and burned: at most $200 + $20 per Series.
- **What players get back:**
  - The median player gets about 8–9% back and the top 1% about 32–38%. No human reached 40%.
  - A casual player (about 6 runs per Series at $0.05) earns roughly a case every Series or two.
  - A regular player earns a grading every 4–5 Series.
  - A grinder earns a pack every 1–2 Series.
- **Growth:** at 1,000 players or a higher PAPER price, the throttle cuts the payout to single digits. Raising grading and case stock fixes that cheaply (see question 2).

## 5. Safeguards

1. **Stock caps on chain** (4 / 200 / 400 per Series), settable by the owner up to fixed maximums written into the code (6 / 400 / 800). The shop key can't change them.
2. **Throttle k.** Each Series, k is set so tickets issued come to about 80% of the stock's value ($230 face). It is set from the previous Series' run count × the PAPER price, and doesn't start at full rate. A **liability brake** halves k whenever unspent tickets pass 2 Series of stock (about $460).
3. **Per-run cap of 800** and the price rule M (min of the start price, the live price and $1).
4. **Expiry:** 12 months after the wallet's last paid run, with an in-app warning first. A 2-Series expiry was modelled and wiped out regulars' progress.
5. **Review hold:** the top 1% of earners, and wallets with flags (reactions under 180 ms, more than 90% hits after round 8), are held 48 hours before they can redeem. This takes about 30 minutes of owner time per Series.
6. **Transfers:** tickets never transfer and never convert to PAPER, ETH or USDG. Coupons and shop credits are non-transferable.
7. **Liability report every Series:** unspent tickets × $0.0005 × expected redemption rate (75–95%). Expect $40–120 at launch scale.
8. **What a stolen shop key or database login can do:** sign vouchers up to the remaining stock, at most 4 packs + 200 gradings + 400 cases. That is **$230 of value, $7 of it cash**, per Series. The owner then sets the signer to 0. A stolen `GAME_SIGNER_KEY` can't mint vouchers, and fake runs still need real PAPER burned.
9. **Bots:** 20 perfect bots burn about $1,600 of PAPER per Series and take about $180 of prizes, a net loss of about $1,400. The project doesn't lose money, but bots crowd out people: the human median fell from 8.9% to 2.5%. The redemption rules and the review hold are what protect players.

## 6. How it works under the hood

**Recommended: Option A, a ticket ledger in Neon with server-signed vouchers.**

- **Earning:**
  - A new append-only `ticket_ledger` table in Neon, with one earn row per `run_id`, so a run can only earn once.
  - `game_board` is untouched.
  - Earn rates, prices and k are server settings, so they change without contract transactions.
- **Redeeming:**
  1. A spend row is written to the ledger.
  2. A separate `SHOP_SIGNER_KEY` signs a voucher: wallet, item, quantity, voucher id, Series, and a deadline 1 hour out.
  3. The player sends the voucher and pays the gas.
  4. The contract marks the voucher id as used. Tickets are refunded only if the deadline passes and the id was never used on chain.
- **Contract changes, all before mainnet deploy** (nothing is deployed yet; FirePsa matters most because `setPsa` can be called only once):
  - **FireCredits, about 45 lines:** a `redeemShopPacks` function that checks the voucher, with its own shop cap per Series. It is separate from `MAX_PRIZE_CREDITS`, because Fold and Flick's 3/2/1 leaderboard prizes already use all 6 of game 1's slots.
  - **FirePsa, about 110 lines:** non-transferable grading and case coupons, a function to claim a coupon with a voucher, and a coupon path into `protect` alongside the paid one. A coupon used on a cancelled grading is not refunded. It also gets caps per Series and per wallet, and a signer setter. Check the contract size with `forge build --sizes`.
  - Foundry tests and audit rows for both.
- **Why not the other options:**
  - **Option B (a ticket balance on chain):** gas for every run, a hot wallet to keep funded, and a more token-like look. The server still decides who earns tickets.
  - **Option C (Merkle roots of balances):** more moving parts and the same trust in the server.
- **This reverses §11's "Rejected: server-signed vouchers".** That rejection was about fixed prizes. A shop needs vouchers or a hot wallet for every redemption, and vouchers mean the signing key holds no funds.
- **What you set up:**
  - Generate `SHOP_SIGNER_KEY` yourself, in the Foundry keystore or typed straight into Vercel. Never paste it in chat.
  - After accepting ownership, call `setShopSigner` on both contracts. The deploy leaves them at 0, so the shop stays shut until you do.
  - Approve the Neon migration and the shop screens.
  - To stop the shop: set the signer to 0, or pause FirePsa or the sale.

## 7. Risks

- **Legal (not legal advice):**
  - Tickets per run make every paid run a separate "pay, play, win a prize" event, like a redemption arcade machine. That is a bigger risk than leaderboard-only prizes.
  - The skill argument has to hold for every single run.
  - A pack is a random draw, which brings chance back in. Gradings and cases are fixed prizes. Keep packs rare.
  - The most one run can win is $0.40 of value, under the per-play caps redemption rules use ($5, or 7–10x the play price).
  - New Jersey licenses skill-ticket redemption games. Several states block paid skill play: AZ, AR, CT, DE, LA, MT, SC and SD are the common list. Consider turning off ticket earning there.
  - No lawyer review (decision 24). Add this to the plan's risk list.
- **Bots crowd out people.** Bounded in dollars, not in fairness.
- **PAPER price manipulation.** On a thin market someone could push the price feed. Taking the lower price limits the upside, and the stock caps limit everything.
- **Pack slots.** Each drop has 16 free-pack slots, 3 per wallet, shared with burn credits and leaderboard prizes. The 4 shop credits never expire and can push burn-credit holders back a drop.
- **Throttle perception.** "Fewer tickets per run this Series" can feel unfair. Show the rate before a run.

## 8. Questions for the owner

1. **Stock caps of 4 / 200 / 400 per Series, with in-code maximums of 6 / 400 / 800?** Recommend yes.
2. **When demand outgrows stock: cut earning, or raise grading and case stock?** Recommend raising grading and case stock first (it costs only burn) and keeping packs at 4.
3. **Spit-Wad leaderboard: top-three pack prizes, or none?** Recommend none, so pack slots go to the shop, with an optional ticket bonus for the top 10.
4. **Expiry 12 months after the wallet's last paid run?** Recommend yes.
5. **Turn off ticket earning in the commonly blocked states?** Recommend yes.
6. **Approve Option A, including the reversal of §11's rejection of vouchers?** Recommend yes, before FirePsa deploys.

## Owner decisions

1. **Stock caps approved (Oct 27):** 4 packs / 200 gradings / 400 cases per Series, settable up to fixed maximums of 6 / 400 / 800.

## Appendix: model tables

**Average ticket value per run, as a share of the run's value**

| Player | Fold and Flick | Spit-Wad |
|---|---|---|
| Casual | 8.9% | 4.4% |
| Average | 11.7% | 12.9% |
| Skilled | 29.5% | 35.4% |
| Perfect bot | 40% | 40% |

**Tickets by result** (at M = $1, k = 1)
- Fold and Flick: streak 3 → 94, 9 → 262, 15 → 485, 20+ → 800.
- Spit-Wad: 2 rounds → 84, 8 → 266, 15 → 676, 20+ → 800.

**Redemptions per Series** (packs / gradings / cases)

| Players, PAPER | Redeemed | Unspent tickets (value) | Top 1% get back |
|---|---|---|---|
| 100, $0.05 | 1 / 21 / 87 | $43 | 31.7% |
| 300, $0.08 | 3 / 136 / 259 | $104 | 37.8% |
| 300, $0.25 | 3.1 / 169 / 318 | $141 | 15.7% |
| 1,000, $0.08 | 2 / 139 / 400 | $404 | 16.1% |

**Abuse runs** (300 players unless noted)

| Case | Result |
|---|---|
| 20 perfect bots, $0.08 | Bots lose $1,412 per Series; the human median falls to 2.5% |
| No price scaling, $0.08 | Humans earn 117% median; $73,600 of tickets the shop can't supply |
| Crash $0.25 → $0.025, start price only | Earning hits 103% of the burn |
| Same crash, lower of start and live price | Earning stays at 41% |
| No on-chain caps, PAPER $1 | 69 packs and 901 gradings per Series |
| Stock of 4 / 100 / 200 instead, 300 players, $0.08 | Payout 10.6%; worst case $120 |

## Self-check changes

- **Removed the throttle's floor and added the liability brake.** With a floor of 0.1, at 1,000 players and PAPER at $1 unspent tickets grew to $9,699. With no floor and the brake, it ended at $4,756, mostly left over from starting the first Series at full rate (hence §5: set k from a forecast).
- **Caps are settable, with fixed maximums,** so raising stock never needs a FirePsa redeploy.
- **Per-wallet pack limit is 1.**
- **Shop pack cost is "up to $1.75":** a pack only costs a sale if it would otherwise have sold.
