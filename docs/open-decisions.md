# Open decisions (from the Sep 27 2026 audit)

The audit's items that changed the game's rules or trust model. Items marked DONE are built and tested in
`contracts/` (103 tests); the rest still need a call from you.

## 1. A stuck roll freezes the game forever (audit C2) — DONE

Decided: no long wait. Built on how OpenVRF works (it stores each fulfilled number on-chain, unchangeable):
- `adapter.settle(id)`: anyone delivers a number the router already holds if its callback didn't land.
- `Fire.reroll()`: anyone, after 2 hours with no answer, and only while the router has no number for that request.
  (It was 30 min. drand's number is public ~30 s after the roll, so a short wait let someone re-roll a known bad
  result whenever nobody had delivered it.)
- `Fire.abandon()`: anyone, after 7 days stuck (randomness gone, or a result that can't be delivered). The game ends for
  good; each ticket holder of the current fire calls `refund()` for pot × their tickets ÷ total. No tickets → the pot
  burns. The mill fund keeps working.
- A winner whose PLANK transfer fails keeps the prize in `unclaimed[winner]` and calls `claim(to)`. Failed royalty or
  burn transfers carry to the next pot. Feed reads can't revert the night.
- `ops/keeper` does all of this automatically; the site shows a button as a backup.

## 2. Who can hurt the game via randomness — DONE

Review finding (merge blocker): OpenVRF's `fulfill()` is relayer-only, so the relayer could withhold a number it
disliked, wait for the re-roll window, and have the Fire re-roll — as many times as it liked. Fixed by deploying our
own `OpenDrandRouter` (OpenVRF with no owner, no fees, no allowlists): anyone can submit drand's signature, so a
withheld number can be delivered by anyone. `reroll()` still opens after 2 hours if nobody delivered — the keeper, its
healthcheck alarm and the site's button are what make sure someone does — and never once the router holds the number. There is no router
owner left to freeze or re-price anything; the deploy wallet has no powers after deploy.

## 3. Adapter pays its whole balance per request (audit M2) — DONE (was a real bug)

OpenVRF requires the exact fee, so 1 wei sent to the adapter by anyone made every roll revert. The adapter now pays
exactly `requestFee()`. Tested against the real router code with a real drand proof.

## 4. Mill buying and Seaport (audit H4 / M5) — DONE

- Seaport 1.6 is deployed on Robinhood Chain (`0x0000000000000068F116a894984e2DB1123eB395`); Deploy.s.sol requires it.
- Live OpenSea listings are priced in USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`), plain open orders, split
  seller / OpenSea 1% / creator royalty 10%. Later ones may be in ETH, so the fire handles both: "paper from the fire"
  takes $1 of ETH or USDG, each kept on its own side of the fund (no swaps), and the fire pays each listing in its own
  currency.
- The bid is in USD: +25% of its start per day (~1%/hour) while nobody sells, restarts at 90% of each price paid,
  capped at 3x — and only while the fund could pay it, never above what the fund holds (review finding: an empty fund
  used to build up a high bid for the first dollars to be sold into). Starting bid (MILL_BID_BASE, USD 8 decimals) is set at deploy; mills are still minting, so there's no
  real floor yet — start at or below the expected floor and let it climb.
- Fills use fulfillAdvancedOrder (works for open and zone-restricted listings); tested against real Seaport 1.6 code.
- `ops/keeper` sweeps the floor with an OpenSea API key: cheapest listing at or under the bid that the fund can pay.
- The bid is a standing offer: anyone can fill it with any Seaport listing (their own included) at or under the bid.
  `eatMillFromSeaport` refunds any ETH attached above the burn fee.
- The sim at 5 outsiders/day (~$11k/yr): ~110 mills eaten a year at a $100 floor, ~37 at $300, ~13 at the ~$786 listings
  seen so far.

## 4b. ETH/USD feed age — DONE

On-chain check (Sep 27 2026): the feed updates every ~0.4–6h. The old 1h staleness limit would have closed ETH
tickets and zeroed the PLANK price feed most of the day. Both now allow 25h (24h heartbeat + margin).

## 5. Tithe and mill PLANK go to a pool that doesn't count PLANK yet

PulpPool only counts whitelisted tokens and PLANK isn't one. Until the Plank Press admin calls
`addRewardToken(PLANK)`, every tithe and eaten-mill PLANK sits there uncounted. **Recommendation:** get that call done
(or a written yes) before launch.

## 6. Spec vs code — DONE

`docs/spec.md` now matches the contract: USD-priced legs with 5%/night ratchets, max-price buys, no pause, no launch
cap, no Pyro mode, drand via `OpenDrandRouter`, 2h reroll and 7-day abandon.

## 7. Smaller policy calls

- **Daily cap is per wallet**, so extra wallets bypass it. Fine if it's meant as a speed bump; don't market it as a
  hard limit.
- **Profiles have no moderation.** Any image (up to 12 KB) shows on the winner card and the ticker. Options: a
  site-side hide list, or show pictures only for wallets that have bought tickets.
- **Swap panel slippage is 3%** on a thin pool, which gives sandwich bots room. Consider 1% default with a user setting.
- **Storm balance:** the contract-faithful sim (`docs/sim-results.md`) gives ~9.6-night average lives, about half reach
  night 10, ~5% reach night 15, longest 19; night 24 is never reached. Fine if intended; otherwise bump the age curve.
