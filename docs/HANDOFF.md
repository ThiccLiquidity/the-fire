# Handoff — where the work stands

Updated Sep 28 2026 (beta audit merged). Read this whole file before changing anything.

## Rules from the owner (ThiccLiquidity)

1. **Anything visual gets mocked and approved before it's pushed.** Build it, publish a mock (an artifact or
   a Vercel preview), wait for an explicit "yes".
2. **Nothing merges to `main` and nothing deploys without his OK.** `main` auto-deploys to Vercel
   (https://web-mu-mocha-95.vercel.app/). The site stays in demo mode (no contract addresses set) until he
   says to go live.
3. He gives edits as a numbered list and says when to do them. Keep the list below current.
4. He works in PowerShell. His clone is at `C:\Users\DubT1\the-fire` (`cd $HOME\the-fire`).
5. Direct and short. No hedging.

## Branches

- `main` — live site (demo mode). Has everything through edit #17 (beta audit).
- `wip/pending-approval` — **this branch.** Everything below that's "built, awaiting approval". Not merged.
  Vercel builds a preview for it automatically; that preview URL is a good way for him to review.

## The edit list

| # | Edit | Status |
|---|------|--------|
| 1 | Replace the "The fire went out … One of them wins" card with something fun | Built: no card; tickets rise out of the embers as glowing scraps, swirl, thin to one that glides to where the winner card appears (`scene.ts`, search "the reveal"). Awaiting approval. |
| 2 | Show a dollar amount for what the buyer puts in the fire | Built: $ under PLANK balance, "(+$4.50)" on the cost line, total for the $1 path, "$X short on PLANK" hint. No PAPER price exists yet, so PAPER shows no $. Awaiting approval. |
| 3 | Fix the press scene (v2): a) front-view wheel looked off, b) river ended in the grass, c) paper machine unreadable | Built: wheel is a projected cylinder (paddles foreshorten, rims are ellipses, water sheets over the top); river path runs off-screen at any width; machine reduced to posts + roller + one white roll. Behind the playground toggle "Press v2". **He wants the front-view wheel kept, just fixed.** Awaiting approval. |
| 4 | Under the pot, show what the winner takes home, smaller | Built: "winner takes $X" (38% of pot = 40% less 5% tithe). |
| 5 | Make that take-home number green | Built. |
| 6 | Buy panel is a mess, too many words | Built: rewrite — tiles, stepper, one cost line + button, a "No PAPER? Pay $1 a ticket instead" row with ETH/USDG, explanation behind "why $1?", green confirmation after a buy. Awaiting approval. |
| 7 | Wallet connect: where it is, show which wallet, switch wallets | Built: header chip (Connect / avatar+name), menu with full address, Switch wallet (MetaMask picker), Disconnect; follows MetaMask account changes; reconnects silently on load. Awaiting approval. |
| 8 | "How the fire works" explainer — the game and where the funds go | Built: overlay from a pill next to the title and a footer link; five steps, money-flow diagram, odds, "what nobody controls". Awaiting approval. |
| 9 | Paying with ETH/USDG felt like one tap spends real money | Built, mock https://claude.ai/artifact/EMB6Kj1pMCCk3EJ6vDPP4y: "Pay for the PAPER part with PAPER / ETH / USDG" is a choice that spends nothing; a "You pay" line shows exactly what leaves the wallet with a $ total; one "Throw N tickets in" button; ETH/USDG get a confirm step ("You're spending $1.90 … [Cancel] [Pay $1.90]"). **Approved Sep 28, on `wip/pending-approval`.** |
| 10 | Stop taking the 5% from the winner: 40% winner, 25% burn, 5% mill holders' pool, 30% next fire | **Contract done** (`WINNER_BPS 4000, BURN_BPS 2500, ROYALTY_BPS 500`, carry = remainder; no tickets → winner's + pool's shares carry), tests, sim, spec, README. **Site copy pending approval** with #9: "winner takes" becomes 40% of the pot (was 38%), How-it-works and footer text show the new split. **Site part approved Sep 28, on `wip/pending-approval`.** |
| 11 | Wording: the 5% read like an airdrop; "Arizona" should be "MST" | Built (mock v3): every "mill holders" / "every mill holder" now says "the Paper Mill royalty pool"; "8:00 PM Arizona" / "8 PM Arizona" now "MST". **Approved Sep 28, on `wip/pending-approval`.** |
| 12 | PAPER may trade high: don't let tickets get expensive (the prize is PLANK); swap must include PAPER | **Contract done:** a ticket takes 1 PAPER, or less once PAPER trades above $0.33 (`PAPER_USD_CAP`), moving ≤5%/night from a ≥20h average (`PaperUsdTwap`, which finds the PAPER/WETH or PAPER/USDG pool by itself once one exists, and switches to a pool with 2× the liquidity). No market → stays 1 PAPER. $1 ETH/USDG option unchanged. Keeper checkpoints the feed when `due()`. Sim table in `docs/sim-results.md`. **Site pending:** PAPER amount/$ on the buy panel (mock), multi-route swaps (PAPER tradable whatever it's paired with). **Site part approved Sep 28, on `wip/pending-approval`.** |
| 13 | Wording: "Pay for the PAPER part with" → "Pay with"; "half feeds the pot" → "half feeds the fire"; drop "paper from the fire" (→ "Every $1 paid in ETH or USDG goes toward buying mills off the floor and burning them", owner reviewing) | Pending, goes in the next mock. **Site part approved Sep 28, on `wip/pending-approval`.** |
| 14 | Animals walked over the trees instead of behind/in front | Built (mock v6): after each animal is drawn, trees nearer the viewer (trunk base lower on screen than its feet) that overlap it are redrawn on top, so it passes behind near trees and in front of far ones; a squirrel's own tree stays behind it. Checked frame by frame: the deer walks out behind the two big left trees. **Approved Sep 28, on `wip/pending-approval`.** |
| 15 | "Buy 10, get 1 free" instead of 3% off a full 10; must be obvious in the UI | **Contract done** (`ticketsFor(10) = 11`, `FREE_WITH_FULL_BUY`, `priceBps` removed; the free ticket counts toward the 500/day cap and adds no PLANK; `TicketsBought.tickets` = tickets received), tests, sim, spec. Site: "🎁 Buy 10, get 1 free" chip (jumps to 10) → "🎁 10 + 1 free = 11 tickets", button "Throw 11 tickets in", confirm step "(10 + 1 free)" (mock v7). **Approved Sep 28, on `wip/pending-approval`.** |
| 16 | Frog hopped sideways and "splashed" on grass | Built (mock v7): its three hops aim at the middle of the stream, and the splash lands on the water. **Approved Sep 28, on `wip/pending-approval`.** |
| 17 | Final audit (words, math, back end, user funds) + a demo friends can play on the live site | **Done, merged to `main` Sep 28 with his OK.** Five audits; every fund-safety finding fixed: max-price buys, winner claim, 7-day abandon/refund, non-reverting feeds, 2h reroll, exact approvals, receipt checks, swap slippage/impact guard, security headers, demo can't touch a wallet. Site: demo banner, persistent play wallet, simulated swaps, spoiler fix, copy/number/phone fixes. Go-live checklist: see the audit report artifact. |
| 18 | Forest + campfire sound that changes with the time of day (the site was silent until a storm) | Engine built (`web/src/components/ambience.ts`, 🔊/🔇 toggle in the header, remembered per browser): campfire crackle follows the fire's size and dies in the rain, birds by day with a dawn chorus, crickets + owl at night, wind, the stream, rain in storms; thunder goes through the same mute. His Pixabay recordings arrived Sep 28; cut to seamless loops and loudness-matched (7 MB, loaded only once sound is on). **Approved Sep 28, merged to `main`.** |
| 19 | PLANK has no logo or art anywhere on the site | Built with his art (`web/public/plank.webp`, background cut out; `plank-icon.webp` small): Plank beside the pot amount and the winner's prize (gentle bob), small Plank next to PLANK amounts (pot line, winner card, your balance, You pay, prize/refund), and Plank leaning by the fire in the scene, lit by the flames and dark at night. **Approved Sep 28, merged to `main`.** |
| 20 | Phone: wallet pill + storm tracker too low (should sit in the top-right corner); Playground didn't fit the screen | Built: phone header is title + pills on the left, wallet and a compact storm tracker in the top-right corner ("Connect" shortens on phones); Playground wraps to one column inside the panel. **Approved Sep 28, merged to `main`.** |
| 21 | Animals walked over Plank by the fire | Built: Plank stands a step nearer the viewer than every animal's path, and is redrawn over any animal passing behind him (same trick as the trees). Checked frame by frame with a deer and a skunk. **Approved Sep 28, merged to `main`.** |
| 22 | "Up to 1% more ETH is sent" felt sketchy | Built: an ETH buy sends exactly the ETH shown on "You pay", so the wallet shows the same number; the line is gone. The price is re-checked right before sending; if the feed ticked, it stops with "The ETH price just changed. Check the new price and try again." **Approved Sep 28, merged to `main`.** |
| 23 | Fire simulation (volume only, low to high) and his 4 decisions | Sim: `sim/fire_sim.py` mirrors the contract night for night (`contracts/test/FireSimParity.t.sol` checks 600 nights); results in `docs/fire-sim.md`. Decisions built: (1) fire counted in thousandths of a ticket (`fireSizeMilli`), so tiny fires aren't rounded away; (2) a fire nobody bought into carries its whole pot, no burn; (3) storm luck widened to lognormal(0, 1.5): avg life 7.5 nights, ~3% out by night 3, ~21% reach night 10; (4) site: full height = 2.5 days of buys, rain as heavy as the call was close. Contract + ABI + site + docs + economy sim updated. 113 tests. **Approved Sep 28, merged to `main`.** |
| 24 | Pot: simulate from a $250 seed; protect it; seed only by him | Contract: `Fire.seed(amount)`: deployer only, once, before the first storm, add-only (also `SEED_PLANK` in Deploy.s.sol). **Prize cap:** a fire pays out on at most 20x what its own tickets put in (`PRIZE_CAP_MULT`, `potCarriedIn`, `prizeNow()`); ~30 tickets in one fire unlock the full seed; never binds at normal volume. Site shows the capped "winner takes" ("grows with this fire, up to $X"). Sim + parity test now check the pot every night. Results: `docs/pot-sim.md` (incl. 5-10 tickets/day for 3 years). 119 tests. **Approved Sep 28, merged to `main`.** |
| 25 | He never meant half the ticket PLANK to burn up front | Built: all of a ticket's PLANK goes into the pot (`_takePlank`, `PLANK_BURN_BPS` removed); PLANK burns only when a fire pays out (25%). Prizes ~2x at every volume, PLANK burn ~1/2. ~15 tickets in one fire now unlock the full seed. Site/README/spec copy updated; sims + parity regenerated; `docs/pot-sim.md` new numbers. 119 tests. **Approved Sep 28, merged to `main`.** |
| 26 | A big fire in the moment should get a real shot; no too-early deaths, no small pots lingering | Built (option D): fire keeps 85% overnight; storm = its "normal level" x (night-1)/8 x luck, where the normal level follows the 7-night average up 3%/night and down 30%/night (`stormBaseMilli`); luck lognormal(0, 1.2). Steady volume: ~9.5 nights, ~4% out by night 3. A 10x night-17 surge then a fizzle: 26% still burning after night 20 (was 0%). Rallies reach night 20 up to ~10%. How-it-works storm text rewritten in plain words. 120 tests incl. parity. **Awaiting approval.** |
| 27 | Tickets are "logs" (still a ticket to win); early-buyer bonus: throw 10 on day 1 get 3 free, day 2 get 2, day 3+ get 1; low volume must not get longer fires than high volume | Built: site copy says logs everywhere ("every log is a ticket to win"); `Fire.ticketsFor` gives 3/2/1 free logs by the fire's day (free logs count toward the 500/day cap, add no PLANK). Low-volume bias fixed: the storm level drops fast only in a real slump (`SLUMP_BPS`, week under half the level), so steady volume gets the same odds at any level. 121 tests incl. parity. **Awaiting approval** with #26. |
| 28 | Storm model (his design): fixed storm sizes, odds that slowly flip from small to big, fire grows with logs and decays, every storm takes its size off the fire; storms never get stronger; storm takes logs, not a percent; keep night 24 | Built (replaces the storm math of #26/#27; the 3/2/1 free logs and "logs" copy stay): **storm ladder** of 20 fixed sizes, 5 to 25,000 logs (`STORM_LOGS`), drawn by `word % 10,000` against per-night running odds (`STORM_ODDS`, nights 2-23: a bell curve over the rungs centered 2 rungs up on night 2, moving up 0.75 rung a night). Fire keeps 85% overnight; a storm at least as big as the fire puts it out, otherwise its size comes off. `stormBaseMilli`/slump rule removed; `stormOdds(night, logs)` view added. Sim: 10/day ~3 nights, 30/day ~5, 100/day ~9, 300/day ~13, 1,000/day ~17, 3,000/day ~20, 10,000/day hits night 24 (`docs/fire-sim.md`). Pot at <30 logs/day: many 2-3 night fires, the $250 seed is paid out within weeks (`docs/pot-sim.md`). Parity test checks every rung + 600 nights. Site: demo, How it works storm copy, Playground "storm draw" slider, sky threat = chance tonight's storm beats the fire. **Approved Sep 28, merged to `main`.** Low-volume seed drain accepted as is. |
| 29 | Log price must follow PLANK in real time off the big V2 pool so nobody overpays after a pump | Built: the PLANK part of a log is $0.90 at `PlankUsdTwap`'s **30-minute** average of the PLANK/WETH pool (was a 20h average plus a 5%/night ratchet, ~2 weeks to catch a 2x move), read live at every buy (`plankPerTicket()`; `plankPerTicketLast` fallback if the feed breaks or is 2+ days old). He chose the 30-min average over instant spot: the 500/day cap is per wallet, so a flash loan + many wallets could buy thousands of logs at a fake price; a flash loan adds nothing to a time average. Keeper checkpoints every 30 min (~48 tiny txs/day). Wallet max-price protection unchanged. Pool is PLANK/WETH, 100k+ liquidity (his check). **Approved Sep 28, merged to `main`.** |
| 30 | Swap: use an aggregator with a fee to us; 0.5%; swap anything, our 4 coins as presets | Built: live swaps go through the KyberSwap aggregator (best price across every Robinhood Chain pool) with a 0.5% fee (`SWAP_FEE_BPS`) taken from what the buyer pays and sent by KyberSwap straight to `SWAP_FEE_WALLET` in the same transaction. ETH/PLANK/PAPER/USDG presets + any token by address (unchanged). Safety: `checkSwap()` decodes every transaction the API builds and blocks it unless it goes to KyberSwap's router, spends no more than asked, buys the right coin, pays the buyer's own wallet, meets the slippage minimum, sends fees only to our wallet, and sends the right ETH (10 checks pass); approvals are exact-amount only. Falls back to the direct Uniswap V2 route (no fee) if KyberSwap has no route. Demo shows the fee line. CSP allows aggregator-api.kyberswap.com. Fee wallet and router check are on the deploy checklist below. **Approved Sep 28, merged to `main`.** |
| 31 | The NFTs are Paper **Presses**, not Paper Mills | Built: every word on the site now says press / presses / Paper Press (royalty pool, press fund, "presses eaten", "the fire bought a press", Playground labels, demo notes); README and spec prose too. Contract and code names (`MILL`, `millBid`, `IMill`, events) are unchanged so nothing already built or deployed breaks; nobody sees them on the site. The forest scene's mill stays (his call). **Approved Sep 28, merged to `main`.** |
| 32 | Rehearse the whole launch on testnet before Oct 1 (he's never deployed a contract) | Built: `script/DeployTestnet.s.sol` deploys the real Fire, drand router, adapter and PLANK price feed on Robinhood Chain testnet (46630) with play tokens (`contracts/testnet/TestnetKit.sol`: faucet tokens, a movable PLANK pool, an always-fresh ETH/USD feed) and seeds $250 of play PLANK. Checked end to end on a local copy of the chain: deploy, seed, a buy of 10 → 13 logs, the 30-minute price checkpoint, the storm roll. Site: `VITE_CHAIN=testnet` switches to testnet, shows a "Get play tokens" banner, hides the swap. Walkthrough: `docs/testnet-rehearsal.md`; launch day: `docs/launch-day.md`. Also: the "price moved" message no longer says "at tonight's storm" (the PLANK price moves any time now). **Next: he installs Foundry and runs it.** |
| 33 | Prize cap 20x → 5x, and explain it in How it works | Built: `PRIZE_CAP_MULT = 5` (contract, site, sims); tests + parity regenerated, 124 pass. Grounded wild-year sim: pot under the $250 seed on 39% of days instead of 55%, year-end pot ~$743 instead of ~$209, prizes about the same. A fire now needs its own logs to be a fifth of the pot to pay the full 40% (~60 logs to unlock the full $250 seed). How it works: new "A small fire can't take a big pot" note with a worked example ($1,000 carried in, $20 of logs → $40 prize, ~$950 carries; $250 of logs → full $500). Spec, pot-sim and wild-year docs updated. **Awaiting approval.** |
| 34 | Redesign the site around the new scene (Ed, Edd n Eddy feel) | Built on `wip/pending-approval` from the approved mocks: the painted scene (Plank in his chair, the Plank & Paper press, WebGL fire, the original storm and sounds, deer/rabbit/frog/squirrel/bear/heron) replaces the old scene; Chewy + Nunito, the title with How it works beside it, an MST clock with a to-the-second countdown to the 8 PM storm (orange in the last 10 min), the pot floating right above the fire, story cards over the fire, dark ink-edged panels below. Fire height now follows the log count (`fireLook`, same count = same size), and the storm's look and sound follow its rung on the 20-step ladder (`stormLook`, drizzle to monster); sim mirrors both. Phones: frames Plank and the fire, drag to look around, the camera nudges over to a visiting animal, forecast in a strip under the scene; sideways = the whole scene. Wind/stream turned down when there's no storm. Skunk and birds wait on art. Checked with screenshots: day/night, survive, went out, you won, relight, phone drag/pan, sideways. **Awaiting approval.** |
| 35 | Scene fixes: deer nose, rabbit hop | Built on `wip/pending-approval`: the deer stops one pose short of the last bend frame (that frame had lost its nose tip); the rabbit only looks back while it sits, so it never hops backwards. A mill-splash rework was tried and reverted (owner didn't like it); the mill is back to the original painting. Awaiting owner OK. |
| 36 | Birds in the sky; skunk dropped | Built on `wip/pending-approval`: every 3–8 minutes by day a flock of 2–5 classic black "m" birds flaps (and now and then glides) across the sky; none at night or while storm clouds gather. A `birds` button in the Playground sends a flock. The skunk is dropped. Awaiting owner OK. |
| 37 | Storm at 21:00 UTC; the scene follows each player's own clock | Built on `wip/pending-approval`: the storm moves from 03:00 UTC (8 PM MST) to 21:00 UTC (5 PM ET, 10 PM UK, 2 PM MST), when the US and Europe are both awake. `ROLL_TIME_OF_DAY=75600` in the deploy settings (no contract code change; the keeper reads the time from the contract). The site shows the player's own time and the storm on their clock ("storm in 2:11:46", "storm at 5:00 PM"); sun, moon and stars follow their clock; the forecast clouds gather over the last 3 hours before the storm. Wording is now daily: "Day 3", "3 days survived", "the next storm". Docs and the launch-day timetable moved to the 2 PM MST storm. Awaiting owner OK. |

He also asked (answered, no code): "how do we track fake paper?" — there is none. ETH/USDG buyers get
tickets directly; `ticketsOf[fire][wallet]` and the `TicketsBought` event (flag `paperFromFire`) record
them on-chain. The panel copy was renamed from "buy paper from the fire" to "pay $1 a ticket instead" for
that reason. His ETH buy in the demo "didn't let him buy more" because he was out of PLANK — item 6 now says
so plainly.

## How to show him the mocks

- **Sandbox** (the whole site in demo mode with every edit): https://claude.ai/artifact/5KmWw8okEpANftasNN9RX3
  Rebuild: `cd web; npm run build`, then inline `dist/assets/index-*.js` and the CSS into one HTML page
  (replace `` await import(`./ccip-….js`) `` with `({offchainLookup:null,offchainLookupSignature:null})`;
  keep the Google Fonts `@import` as a `<link>`). The artifact has no `/thunder/` folder, so also inline the
  nine `web/public/thunder/*.mp3` clips as base64 and add a tiny `fetch` shim that answers `/thunder/<name>.mp3`
  from them (the current sandbox does this) — otherwise the storm is silent. Or just point him at the Vercel
  preview for this branch, which serves the real files.
- **Press side-by-side vs the reference render:** https://claude.ai/artifact/MEnjrp5NG9iEz9y1bJMjFU
- **Branch review + the four audit reports:** https://claude.ai/artifact/QVvsKS4C83jv7GfmRd5HwB
- The **Playground** drawer at the bottom of the demo site drives every state: force survive / out /
  you-win, storm luck, pending roll, prices, stale ETH feed, wallet balances, connect, crowd, time of day,
  visitors, Press v2 toggle, reset.

## Thunder (checked Sep 27, 5:55 PM)

Not lost in the code: the live site serves all nine clips (200, audio/mpeg) and a headless run of this
branch played 12 thunder claps in one storm. It was silent in the **sandbox artifact** only (no mp3 files
there) — fixed in sandbox v4. Browsers also block sound until the visitor has clicked or tapped the page
once, so someone who only watches never hears it. Suggested next item: a small sound toggle (🔊) in the
header so visitors can turn it on deliberately and see that sound exists.

## Open, not code

- Plank Press admin will call `PulpPool.addRewardToken(PLANK)` (owner: "that will get done for sure").
- PAPER contract address (Oct 1 2026).
- Starting mill bid: owner says ~$700 is far too high — listings so far are wild because there's no market yet.
  Suggested: start at the PLANK inside one mill (~$90); the bid only climbs while the fund can pay it, caps at 3x
  until a real purchase resets it. Not decided.
- Re-run `sim/economy.py` with real mill prices (~$786) and a moving PLANK price; refresh `docs/sim-results.md`.
- Spec vs code: `docs/spec.md` still lists a pause, a 3-night cap and fixed-PLANK pricing — none exist.
- README trust wording: router is now ownerless (`OpenDrandRouter`), keeper has no powers.

## Verify

```
cd contracts; forge test          # 121 passed
cd web; npx tsc -b; npm run build # clean
```

## Also on this machine, not pushed

A git stash `mill redraw WIP (press v2, not approved)` on the previous session's machine holds an early
press drawing. It's superseded by `drawMill2` in `web/src/components/wildlife.ts`; ignore it.

## Before deploy: every wallet, address and setting (he fills these in on deploy day)

Nothing here goes in the repo until he gives it. **Public addresses only; private keys never go in chat or the repo**
(entered only in PowerShell with `Read-Host -AsSecureString`, or on the keeper box).

| What | Used for | Status |
|---|---|---|
| Deployer wallet | Deploys everything; is `SEEDER` (the one-time $250 PLANK seed, `SEED_PLANK`) | He picks it |
| Keeper wallet | Nightly roll, randomness delivery, PLANK/PAPER price checkpoints (~48/day), press buying; ~$10 of ETH | He picks it (never the deployer) |
| Swap fee wallet | `SWAP_FEE_WALLET` in `web/src/data/types.ts`: gets the 0.5% swap fee, in the coin the buyer pays with | He picks it (public, a dedicated wallet) |
| PAPER token | `PAPER` | Not deployed yet (Oct 1) |
| PLANK / PLANK-WETH V2 pair | `PLANK`, `PlankUsdTwap` pair | Known: see `docs/addresses.md` |
| Press NFT, Pulp Pool (royalty pool), Seaport, USDG, Chainlink ETH/USD | `MILL`, `ROYALTY_POOL`, `SEAPORT`, `USDG`, `ETH_USD_FEED` | Known: see `docs/addresses.md` |
| PLANK as a Pulp Pool reward token | `PulpPool.addRewardToken(PLANK)`, by the Plank Press admin | **Done** (the admin added it) |
| Storm time | `ROLL_TIME_OF_DAY` = 75600 (21:00 UTC = 2 PM MST), fixed at deploy | **Chosen** (Sep 29): prefilled in `.env.example` |
| Starting press bid | `MILL_BID_BASE` | The press floor price on OpenSea at launch |
| Starting PLANK per log | `PLANK_PER_TICKET0` (within 10% of $0.90 at deploy) | Set from the pool price on deploy day |
| KyberSwap router on Robinhood Chain | The swap guard only allows `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | Check it has code on the explorer |
| Go live | Site out of demo mode (`VITE_FIRE_ADDRESS` etc. on Vercel), keeper running, dry run | Only on his word |

