# Randomness: OpenDrandRouter (drand evmnet)

One random number a night decides the storm and, if the fire goes out, the winner. It comes from drand, a public
randomness beacon, through our own router. Nobody owns it, nobody is paid, and nobody can pick the number.

## How a roll works
1. After 21:00 UTC anyone calls `Fire.roll()`. The Fire asks `OpenVRFAdapter`, which calls
   `OpenDrandRouter.requestRandomness`. The router commits the request to the drand evmnet round **30–33 seconds in
   the future** (rounds are 3 s apart). Nobody, us included, knows that round's value yet. Buying is closed while the
   roll is pending.
2. drand publishes the round. **Anyone** calls `router.fulfill(id, signature)` with its BLS signature: our keeper, the
   site's button, or a stranger. The router checks the signature on-chain against drand's pinned evmnet key and derives
   the request's word. There is exactly one valid word per request, so whoever delivers it can't change it.
3. The router calls the adapter, the adapter calls `Fire.onRandomness(id, word)`, and the night resolves:
   storm luck = `word & 31` (a 32-point table), winner ticket = `keccak256(abi.encode(word, "winner")) % tickets + 1`.

## When something goes wrong
- **Callback didn't land** (out of gas, a revert that has since cleared): the router still holds the word. Anyone
  calls `router.retryCallback(id, gas)` or `adapter.settle(id)` to deliver the same word.
- **drand stalled** — no word after **2 hours**: anyone calls `Fire.reroll()` for a fresh request. It reverts if the
  router already has a word for the pending request, so a known result can't be thrown away. The wait is long on
  purpose: drand's value is public ~30 s after the roll, so a short wait would let someone who dislikes it re-roll
  whenever nobody had delivered it yet. Two hours gives the keeper, its alarm and anyone on the site time to deliver.
  The keeper rerolls only when the drand relays report the round isn't published — never just because it can't reach
  drand.
- **Stuck for 7 days** (randomness gone for good, or a word that can't be delivered): anyone calls `Fire.abandon()`.
  The game ends for good: buys and rolls stop, and each ticket holder of the current fire calls `refund()` for
  pot × their tickets ÷ total tickets. With no tickets in the fire, the pot is burned. The mill fund keeps working.

## Why not OpenVRF as deployed
[Robinhood-OSS/OpenVRF](https://github.com/Robinhood-OSS/OpenVRF) (Apache-2.0) is the base: same round selection,
same drand verification, same word derivation. But its `fulfill()` is relayer-only, and it has an owner, fees and
allowlists. A single relayer could sit on a number it dislikes until the Fire re-rolls. `OpenDrandRouter` is OpenVRF
with those removed: no owner, no fee (`requestFee()` is 0), `fulfill()` and `retryCallback()` open to anyone. Nobody
can pause, re-point or re-price it.

## Verify a roll (anyone)
1. Find `RandomnessFulfilled(id, word)` on the router. Read the round: `router.requests(id)` (second field).
2. Fetch drand: `https://api.drand.sh/04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3/public/<round>`
   (also api2/api3.drand.sh). Take `signature`.
3. Compute
   `word = keccak256(abi.encode(CHAIN_HASH, sha256(signature), chainid, router, id, adapter))` with
   `CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3`, `chainid = 4663`, `router` =
   the OpenDrandRouter address, `adapter` = the OpenVRFAdapter address (the request's consumer). `sha256(signature)`
   is also stored on-chain as `router.roundRandomness(round)`.
4. It matches the event. The router already rejected any signature drand didn't make.

## Alternatives checked
- **Chainlink VRF** — not on Robinhood Chain ([supported networks](https://docs.chain.link/vrf/v2-5/supported-networks)).
- **Gelato VRF, Pyth Entropy** — Robinhood Chain support unconfirmed; both add an operator we'd have to trust. Not used.
- **blockhash / prevrandao** — never. A single centralized sequencer can grind it.
