# Omni Cardworks contracts

Foundry project.

- `src/cards/` — the card system (`../docs/cards-contracts.md`):
  - `FirePacks` (sealed packs, ERC-1155) and `FireCards` (cards, ERC-721, the opening queue, wear and grades)
  - `CardsRenderer` (each card's on-chain metadata and image name; no owner)
  - `RecipeDealer` (deals each Series from its own recipe; `IDealer` is the interface, `StandardRecipe` the original
    rules) and `RecipeCompiler` (the recipe checker, compiler and pool maths; pure, no owner)
  - `FireSale` (the pack sale), `FireCredits` (free pack credits, card burning, suggestions) and `PlankBurner` (the
    PLANK burn fallback; no owner, no withdraw)
  - `FirePsa` (cases and PDA grading) and `PaperBurner` (case and grading fees buy and burn PAPER; no withdraw)

  "Fire" in the names is historical: `Fire*` is the card system, and "fire" in identifiers is a Series number.
- `OpenDrandRouter.sol` + `OpenVRFAdapter.sol` bring in drand's number (one adapter each for FireCards and FirePsa).
- `PlankUsdTwap.sol` (the PLANK price) and `PaperUsdTwap.sol` (the PAPER price, for FireSale's PAPER ceilings and
  PaperBurner's guard). No owner on any of these four.

## Build and test

```shell
forge build
forge test --offline --use ~/.foundry/solc/solc-0.8.28
```

`--offline` and `--use` keep forge from downloading a compiler; plain `forge test` works wherever forge can fetch
solc. Dependencies (forge-std, OpenZeppelin, bls-solidity) are vendored in `lib/`.

Tests: `test/cards/` (cards, recipes, sale, PDA, both burners, image-name parity with the studio, the Series check),
`test/invariant/` (fuzz and invariant suites), the price feeds and the drand router. `test/RealRouter.t.sol` runs
against a real drand proof; `test/cards/SaleFork.t.sol` runs against the live chain when `FORK_RPC` is set and is
skipped otherwise. `--match-test gas -vv` prints the sale's and the opening's gas figures.

## Deploy

Full runbook: `../docs/deploy.md` (DeployTwap, then DeployInfra, then DeployCards; AcceptOwnership on the hardware
wallet and VerifyDeploy; then ConfigureSeries per Series; DevStack for the testnet and the rehearsal). Inputs: copy
`.env.example` to `.env`. The deployer signs with a Foundry keystore (`cast wallet import deployer --interactive`), the
owner with `--ledger` / `--trezor`.
**Never use `--private-key`**, and never put a key in `.env` or this repo.
