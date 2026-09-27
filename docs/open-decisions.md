# Open decisions (from the Sep 27 2026 audit)

The clear bugs from the audit are fixed on branch `claude/practical-gates-va0gq1` (one commit each). These are the
items that change the game's rules or trust model, so they need a call from you before anyone writes code.
Each has a recommendation; none is implemented.

## 1. A stuck roll freezes the game forever (audit C2) — DONE

Decided: no long wait. Built on how OpenVRF works (it stores each fulfilled number on-chain, unchangeable):
- `adapter.settle(id)`: anyone delivers a number the router already holds if its callback didn't land.
- `Fire.reroll()`: anyone, after 30 min with no answer, and only while the router has no number for that request.
- Payouts that fail carry to the next pot; a broken PLANK feed can't revert the night.
- `ops/keeper` does all of this automatically; the site shows a button as a backup.

## 2. Who can hurt the game via OpenVRF (trust model)

Our deployer owns the OpenVRF router: it can de-authorize the adapter or raise the fee (either freezes the game, see 1),
and we run the only whitelisted relayer, which can delay any roll. It can't choose the number. The README says "the
deploy wallet has no special powers", which isn't true. **Recommendation:** after setup, transfer router ownership to a
multisig or renounce it if OpenVRF allows, whitelist a second independent relayer, and fix the README wording.

## 3. Adapter pays its whole balance per request (audit M2) — DONE (was a real bug)

OpenVRF requires the exact fee, so 1 wei sent to the adapter by anyone made every roll revert. The adapter now pays
exactly `requestFee()`. Tested against the real router code with a real drand proof.

## 4. Mill bid and Seaport (audit H4 / M5)

- Mill bid — DONE. It's now a reverse auction that tracks the floor: +25% of its start per day while nobody sells
  (capped at 3x), restarting at 90% of each price paid. The fire pays the listing's own price.
- Still open: a bot that finds the cheapest OpenSea listing and hands it to the fire. Needs an OpenSea API key and a
  look at a real listing (some OpenSea listings need an extra zone signature the basic fill can't provide).
- Still open: confirm the Seaport 1.6 address on Robinhood Chain (PowerShell check sent; waiting on its top lines).

## 4b. ETH/USD feed age — DONE

On-chain check (Sep 27 2026): the feed updates every ~0.4–6h. The old 1h staleness limit would have closed ETH
tickets and zeroed the PLANK price feed most of the day. Both now allow 25h (24h heartbeat + margin).

## 5. Tithe and mill PLANK go to a pool that doesn't count PLANK yet

PulpPool only counts whitelisted tokens and PLANK isn't one. Until the Plank Press admin calls
`addRewardToken(PLANK)`, every tithe and eaten-mill PLANK sits there uncounted. **Recommendation:** get that call done
(or a written yes) before launch.

## 6. Spec vs code

The spec still describes things the contract doesn't do. Pick which is true and update the other:
- Ticket priced as a fixed 10M PLANK with no oracle → code prices the PLANK leg in USD (ratchet) and ETH via Chainlink.
- A 48h-timelocked pause, and fire #1 capped at 3 nights until audit → neither exists in the contract.
- Pyro mode → removed; the deploy doc now says to seed fire #1 by buying tickets.

## 7. Smaller policy calls

- **Daily cap is per wallet**, so extra wallets bypass it. Fine if it's meant as a speed bump; don't market it as a
  hard limit.
- **Profiles have no moderation.** Any image (up to 12 KB) shows on the winner card and the ticker. Options: a
  site-side hide list, or show pictures only for wallets that have bought tickets.
- **Swap panel slippage is 3%** on a thin pool, which gives sandwich bots room. Consider 1% default with a user setting.
- **Storm balance:** a contract-faithful sim gives ~9.3-night average lives, 45% reach night 10 and only ~1.4% reach
  night 15 (the spec says 5%); night 24 is essentially never reached. Fine if intended; otherwise bump the age curve.
