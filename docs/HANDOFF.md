# Handoff — where the work stands

Updated Sep 27 2026, 5:35 PM Arizona. Read this whole file before changing anything.

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

- `main` — live site (demo mode). Has the merged audit work (`claude/practical-gates-va0gq1`, merge `c8c6d70`).
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
| 15 | "Buy 10, get 1 free" instead of 3% off a full 10; must be obvious in the UI | **Contract done** (`ticketsFor(10) = 11`, `FREE_WITH_FULL_BUY`, `priceBps` removed; the free ticket counts toward the 500/day cap and adds no PLANK; `TicketsBought.tickets` = tickets received), tests, sim, spec. **Site pending (mock).** |
| 16 | Frog hopped sideways and "splashed" on grass | Built, pending (mock): its three hops aim at the middle of the stream, and the splash lands on the water. |

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
cd contracts; forge test          # 75 passed
cd web; npx tsc -b; npm run build # clean
```

## Also on this machine, not pushed

A git stash `mill redraw WIP (press v2, not approved)` on the previous session's machine holds an early
press drawing. It's superseded by `drawMill2` in `web/src/components/wildlife.ts`; ignore it.
