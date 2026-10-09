# Randomness: OpenDrandRouter (drand evmnet)

Card opens (`FireCards.open`) and PDA grading (`FirePsa.protect`) need a random number nobody knows in advance. It
comes from drand, a public randomness beacon, through our own router. Nobody owns it, nobody is paid, and nobody can
pick the number. FireCards and FirePsa each have their own `OpenVRFAdapter` (its `FIRE()` is the contract it serves;
the name is historical).

## How a request works
1. A holder opens packs or sends cards for grading. The contract asks its adapter, which calls
   `OpenDrandRouter.requestRandomness`. The router commits the request to the drand evmnet round **90–93 seconds in
   the future** (`MIN_DELAY` = 90 s; rounds are 3 s apart). Nobody, us included, knows that round's value yet, and the
   margin covers a sequencer clock that lags real time by up to about a minute.
2. drand publishes the round. **Anyone** calls `router.fulfill(id, signature)` with its BLS signature: the keeper, the
   site, or a stranger. The router checks the signature on-chain against drand's pinned evmnet key and derives the
   request's word. There is exactly one valid word per request, so whoever delivers it can't change it.
   - Several requests often share a round. Once a round is proven, the router keeps its randomness and later requests
     on that round skip the signature check (about a third of the gas; any signature, even empty, is accepted then).
   - `router.fulfillMany(ids, signatures)` delivers several requests in one transaction and skips any already
     delivered, so a batch can't be blocked by someone delivering one of them first.
3. The router calls the adapter, the adapter calls `onRandomness(id, word)`. Both consumers only store the word:
   - FireCards: anyone then calls `FireCards.process(fire, maxCards)`, which deals that Series' ready opens in the
     order they were made (up to `maxCards` cards per call; a big pack can take several calls).
   - FirePsa: anyone then calls `FirePsa.finish(index, ids)`, which sets that grading's grades. `ids` is the list of
     cards sent for grading, from the grading's `Protected` event (FirePsa stores only its hash).

   The live site is planned to make these calls right away; the keeper can make them too.

## When something goes wrong
- **Callback didn't land** (out of gas, a revert that has since cleared): the router still holds the word. Anyone
  calls `router.retryCallback(id, gas)` or `adapter.settle(id)` to deliver the same word.
- **There is no re-request.** One open or grading, one request, one number. A re-request after a stall used to be
  possible a day on; it was removed because drand publishes each round before anyone delivers it, so a re-request
  could act as a re-roll for someone who had already seen their number.
- **No word for 7 days** after the request (randomness gone for good): anyone calls `FireCards.cancelOpen(fire, index)`
  (the packs go back, sealed) or `FirePsa.cancelGrading(index, ids)` (the cards unlock, still ungraded; the fee is
  not refunded: it went to the PAPER burn). Both refuse while the request's source holds a word: deliver it instead.
- **An open that is ready but can't be dealt** for 7 days (a dealer that can't deal it): anyone calls
  `FireCards.skipStuck(fire)`; its unstarted packs go back, sealed, and that Series' queue moves on.

## Switching the randomness source
The owner can point FireCards and FirePsa at a new source at any time (`setRandomness`, no delay; the owner announces
it publicly first). Every switch emits `RandomnessSet(source)`.
- Only **new** opens and gradings use the new source.
- Each open and grading remembers the source that took its request (`source`, `requestId` in `openOf` /
  `gradingOf`). Only that source can answer it: an answer from any other address, or for a request it never took,
  is refused. Request ids from different sources can't collide.
- A request still waiting on the old source can be answered by it as usual, or cancelled after 7 days as above.

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
   `CHAIN_HASH = 0x04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3`, `chainid = 4663` on mainnet
   (46630 on the testnet), `router` =
   the OpenDrandRouter address, `adapter` = the OpenVRFAdapter address (the request's consumer: the cards' or the PDA's). `sha256(signature)`
   is also stored on-chain as `router.roundRandomness(round)`.
4. It matches the event. The router already rejected any signature drand didn't make.

## Alternatives checked
- **Chainlink VRF** — not on Robinhood Chain ([supported networks](https://docs.chain.link/vrf/v2-5/supported-networks)).
- **Gelato VRF, Pyth Entropy** — Robinhood Chain support unconfirmed; both add an operator we'd have to trust. Not used.
- **blockhash / prevrandao** — never. A single centralized sequencer can grind it.
