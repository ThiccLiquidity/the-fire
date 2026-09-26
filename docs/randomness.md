# Randomness on Robinhood Chain — findings (Sep 26 2026)

**Conclusion: use OpenVRF.** Robinhood publishes its own open-source, drand-backed randomness router built for Robinhood Chain: [Robinhood-OSS/OpenVRF](https://github.com/Robinhood-OSS/OpenVRF) (Apache-2.0).

## How it works
- Consumer contract requests randomness → router commits the request to a *future* drand round → drand publishes its beacon → a relayer submits the BLS proof → router verifies on-chain → derives a request-specific random word → calls the consumer back.
- The relayer can't invent or alter the randomness; it can only be *late*. Trust = drand (public, verifiable) + relayer liveness.
- Consumer inherits `RandomnessConsumer`, calls `requestRandomness{value: fee}(callbackGas)` → `uint256 requestId`, and implements `rawFulfillRandomness(uint256 requestId, uint256 randomWord)`.
- Fees: configurable at router deployment (zero-fee or paid; fee goes to the relayer on fulfil).
- Relayer: self-hosted containerized Node.js with a funded gas wallet. We run one. Anyone else can run one too (router verifies proofs, so extra relayers only add liveness).
- Testnet chain ID 46630. Mainnet/testnet router addresses aren't in the README — check the repo's deployments folder or deploy our own router (it's open source and small).

## Fit with Fire.sol
`Fire.roll()` calls `IRandomness.request()`; the adapter calls `Fire.onRandomness(id, word)`. Write a thin `OpenVRFAdapter` that inherits `RandomnessConsumer`, forwards `request()` → `requestRandomness`, and forwards `rawFulfillRandomness` → `Fire.onRandomness`. No change to Fire.sol.

Important operational note: OpenVRF commits to a drand round a couple of seconds in the future, so the storm's random word is unknown to everyone — us included — at the moment `roll()` is called. Anyone can call `roll()`, so nobody can time it.

## Alternatives checked
- **Chainlink VRF** — not on Robinhood Chain (Data Feeds/Streams/CCIP only): [Chainlink VRF supported networks](https://docs.chain.link/vrf/v2-5/supported-networks).
- **Gelato VRF** — also drand-backed, built for Arbitrum Orbit chains ([Arbitrum docs](https://docs.arbitrum.io/for-devs/third-party-docs/Gelato/gelato-vrf)); its [supported-networks page](https://docs.gelato.cloud/vrf/additional-resources/supported-networks) didn't render a list in this session, so Robinhood Chain support is unconfirmed. Fallback #1 if OpenVRF has a problem.
- **Pyth Entropy** — [chainlist](https://docs.pyth.network/entropy/chainlist) is a dynamic table; Robinhood Chain not confirmed. Fallback #2.
- **blockhash / prevrandao** — never. Single centralized sequencer can grind it.
