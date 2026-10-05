# Omni Forge contracts

Foundry project.

- `src/cards/` — the card system: `FirePacks` (sealed packs, ERC-1155), `FireCards` (cards, ERC-721, the opening
  queue), `RecipeDealer` (deals each Series from its own recipe; `IDealer` is the interface, `StandardRecipe` the
  original rules), `FireSale` (the pack sale), `FirePsa` (PDA reveals). "Fire" in the names is historical: `Fire*` is
  the card system, and "fire" in identifiers is a Series number.
- `OpenDrandRouter.sol` + `OpenVRFAdapter.sol` bring in drand's number (one adapter each for FireCards and FirePsa).
- `PlankUsdTwap.sol` (FireSale's PLANK price) and `PaperUsdTwap.sol` (FirePsa's PAPER price). No owner on any of
  these four.

## Build and test

```shell
forge build
forge test --offline --use ~/.foundry/solc/solc-0.8.28
```

`--offline` and `--use` keep forge from downloading a compiler; plain `forge test` works wherever forge can fetch
solc. Dependencies (forge-std, OpenZeppelin, bls-solidity) are vendored in `lib/`.

Tests: `test/cards/` (cards, sale, PDA), `test/invariant/` (fuzz and invariant suites), the price feeds and the drand
router. `test/RealRouter.t.sol` runs against a real drand proof; `test/cards/SaleFork.t.sol` runs against the live
chain when `FORK_RPC` is set and is skipped otherwise. `--match-test test_gas -vv` prints the sale's gas figures.

## Deploy

Full runbook: `../docs/deploy.md` (DeployTwap, then DeployInfra, then DeployCards; then ConfigureSeries per Series). Inputs: copy `.env.example` to
`.env`. Sign with a Foundry keystore (`cast wallet import deployer --interactive`) or `--ledger`.
**Never use `--private-key`**, and never put a key in `.env` or this repo.
