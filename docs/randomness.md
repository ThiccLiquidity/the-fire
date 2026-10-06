# Randomness: OpenDrandRouter (drand evmnet)

Card opens (`FireCards.open`) and PDA grading (`FirePsa.protect`) need a random number nobody knows in advance. It
comes from drand, a public randomness beacon, through our own router. Nobody owns it, nobody is paid, and nobody can
pick the number. FireCards and FirePsa each have their own `OpenVRFAdapter` (its `FIRE()` is the contract it serves;
the name is historical).

## How a request works
1. A holder opens packs or sends cards for grading. The contract asks its adapter, which calls
   `OpenDrandRouter.requestRandomness`. The router commits the request to the drand evmnet round **30–33 seconds in
   the future** (rounds are 3 s apart). Nobody, us included, knows that round's value yet.
2. drand publishes the round. **Anyone** calls `router.fulfill(id, signature)` with its BLS signature: the keeper, the
   site, or a stranger. The router checks the signature on-chain against drand's pinned evmnet key and derives the
   request's word. There is exactly one valid word per request, so whoever delivers it can't change it.
3. The router calls the adapter, the adapter calls `onRandomness(id, word)`. Both consumers only store the word:
   - FireCards: anyone then calls `FireCards.process(fire, maxCards)`, which deals that Series' ready opens in the
     order they were made (up to `maxCards` cards per call; a big pack can take several calls).
   - FirePsa: anyone then calls `FirePsa.finish(index)`, which sets that grading's grades.

   The live site is planned to make these calls right away; the keeper can make them too.

## When something goes wrong
- **Callback didn't land** (out of gas, a revert that has since cleared): the router still holds the word. Anyone
  calls `router.retryCallback(id, gas)` or `adapter.settle(id)` to deliver the same word.
- **drand stalled**, no word after **1 day**: anyone calls `FireCards.rerequest(fire, index)` or
  `FirePsa.rerequest(index)` (on the consumer, not the router) for a fresh request. It reverts if the router already
  has a word, so a known result can't be thrown away, and it reverts once the open or grading is ready, finished or
  cancelled.
- **No word for 7 days** after the first request (randomness gone for good; a re-request doesn't restart the clock):
  anyone calls `FireCards.cancelOpen(fire, index)` (the packs go back, sealed) or `FirePsa.cancelGrading(index)` (the
  cards unlock, still ungraded; the fee is not refunded: it goes to the PAPER burn).
- **An open that is ready but can't be dealt** for 7 days (a dealer that can't deal it): anyone calls
  `FireCards.skipStuck(fire)`; its unstarted packs go back, sealed, and that Series' queue moves on.

## Why not OpenVRF as deployed
[Robinhood-OSS/OpenVRF](https://github.com/Robinhood-OSS/OpenVRF) (Apache-2.0) is the base: same round selection,
same drand verification, same word derivation. But its `fulfill()` is relayer-only, and it has an owner, fees and
allowlists. A single relayer could sit on a number it dislikes until the consumer asks again. `OpenDrandRouter` is OpenVRF
with those removed: no owner, no fee (`requestFee()` is 0), `fulfill()` and `retryCallback()` open to anyone. Nobody
can pause, re-point or re-price it.

## Verify a number (anyone)
1. Find `RandomnessFulfilled(id, word)` on the router. Read the round: `router.requests(id)` (second field).
2. Fetch drand: `https://api.drand.sh/04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3/public/<round>`
   (also api2/api3.drand.sh). Take `signature`.
3. Compute
   `word = keccak256(abi.encode(CHAIN_HASH, sha256(signature), chainid, router, id, adapter))` with
   `CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3`, `chainid = 4663`, `router` =
   the OpenDrandRouter address, `adapter` = the OpenVRFAdapter address (the request's consumer: the cards' or the PDA's). `sha256(signature)`
   is also stored on-chain as `router.roundRandomness(round)`.
4. It matches the event. The router already rejected any signature drand didn't make.

## Alternatives checked
- **Chainlink VRF** — not on Robinhood Chain ([supported networks](https://docs.chain.link/vrf/v2-5/supported-networks)).
- **Gelato VRF, Pyth Entropy** — Robinhood Chain support unconfirmed; both add an operator we'd have to trust. Not used.
- **blockhash / prevrandao** — never. A single centralized sequencer can grind it.
