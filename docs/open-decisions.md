# Open decisions (from the Sep 27 2026 audit)

The clear bugs from the audit are fixed on branch `claude/practical-gates-va0gq1` (one commit each). These are the
items that change the game's rules or trust model, so they need a call from you before anyone writes code.
Each has a recommendation; none is implemented.

## 1. A stuck roll freezes the game forever (audit C2) — decide before mainnet

If the randomness callback never lands (relayer down for good, router owner de-authorizes the adapter or raises the
fee, or the callback reverts — e.g. a PLANK transfer fails), `pendingRequest` stays set, `roll()` reverts forever,
and the pot is locked. There is no admin to fix it. Since the C1 fix, buying is also paused while a roll is pending,
so a slow relayer now stops sales too.

| Option | Upside | Downside |
|---|---|---|
| **A. Public re-request after a timeout** (e.g. 6h) | Anyone can unstick it; no admin | A re-request is a second draw. Whoever can see the first word (the relayer operator) could withhold a bad one and wait for the timeout. Mitigate: long timeout, and the re-request only allowed if the *router* never fulfilled (check its state). |
| **B. Emergency "end the fire" after a long timeout** (e.g. 7 days) — refunds nothing, burns the pot or carries it | Guarantees funds never sit frozen | Players lose their shot at that pot |
| **C. Timelocked admin that can swap the randomness adapter** | Handles every failure mode | Adds the owner the README says doesn't exist |

**Recommendation: A with a long timeout plus the router-state check, and wrap the winner/tithe PLANK transfers so a
single bad recipient can't revert the whole night.**

## 2. Who can hurt the game via OpenVRF (trust model)

Our deployer owns the OpenVRF router: it can de-authorize the adapter or raise the fee (either freezes the game, see 1),
and we run the only whitelisted relayer, which can delay any roll. It can't choose the number. The README says "the
deploy wallet has no special powers", which isn't true. **Recommendation:** after setup, transfer router ownership to a
multisig or renounce it if OpenVRF allows, whitelist a second independent relayer, and fix the README wording.

## 3. Adapter pays its whole balance per request (audit M2)

`OpenVRFAdapter.request()` forwards `address(this).balance`. With `REQUEST_FEE_WEI=0` it doesn't matter; with a fee,
the first request spends every night's pre-funding (or reverts if the router wants the exact fee). Needs the real
router's fee getter. **Recommendation:** read the fee from the router and forward exactly that — once the OpenVRF
interface is pinned (it's still a TODO in the adapter).

## 4. Mill bid and Seaport (audit H4 / M5)

- `millBid` rises 5% every night with no cap (4.3x after 30 nights; overflows after ~7 years and would then brick
  rolls). **Recommendation:** cap it, e.g. at 3x `MILL_BID_BASE`.
- If `SEAPORT` is left unset at deploy, the ETH from every ETH ticket is locked in the Fire forever (no setter).
  **Recommendation:** don't deploy until the Seaport 1.6 address is confirmed; otherwise, disable the ETH ticket path
  while Seaport is unset.

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
