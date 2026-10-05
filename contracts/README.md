# Omni Forge — contracts

Foundry project.

- `src/cards/` — the card system: `FirePacks` (sealed packs, ERC-1155), `FireCards` (cards, ERC-721), `FireSale`
  (the pack sale), `FirePsa` (PDA reveals), `CardRules`. "Fire" in the names is historical: a Fire is a Series.
- `OpenDrandRouter.sol` + `OpenVRFAdapter.sol` bring in drand's number (one adapter each for FireCards and FirePsa).
- `PlankUsdTwap.sol` (FireSale's PLANK price) and `PaperUsdTwap.sol` (FirePsa's PAPER price). No owner on any of
  these four.

## Build and test

```shell
forge build
forge test --offline --use ~/.foundry/solc/solc-0.8.28
```

`--offline` and `--use` keep forge from downloading a compiler. On your own machine, `forge test` works as long as
forge can fetch solc. `test/RealRouter.t.sol` runs against a real drand proof; `test/cards/SaleFork.t.sol` runs
against the live chain when `FORK_RPC` is set.

## Deploy

Full runbook: `../docs/deploy.md` (DeployTwap, then DeployInfra, then DeployCards). Inputs: copy `.env.example` to
`.env`. Sign with a Foundry keystore (`cast wallet import deployer --interactive`) or `--ledger`.
**Never use `--private-key`**, and never put a key in `.env` or this repo.
