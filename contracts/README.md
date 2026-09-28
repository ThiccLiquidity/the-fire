# The Fire — contracts

Foundry project. `src/Fire.sol` is the game; `OpenDrandRouter.sol` + `OpenVRFAdapter.sol` bring in drand's number;
`PlankUsdTwap.sol` and `PaperUsdTwap.sol` are the price feeds; `Profiles.sol` is names and pictures for wallets.
None has an owner.

## Build and test

```shell
forge build
FOUNDRY_SOLC=/root/.foundry/bin/solc forge test --offline   # 103 tests
```

`--offline` and `FOUNDRY_SOLC` (a local solc 0.8.x) keep forge from downloading a compiler. On your own machine,
`forge test` works as long as forge can fetch solc. Two suites run against a real drand proof and real Seaport 1.6 code.

## Deploy

Full runbook: `../docs/deploy.md`. Inputs: copy `.env.example` to `.env`; every variable is explained at the top of
`script/Deploy.s.sol`, which checks them all before it sends anything.

Sign with a Foundry keystore (`cast wallet import deployer --interactive`) or `--ledger`:

```shell
forge script script/Deploy.s.sol --rpc-url $RPC --account deployer --sender <deployer address> --slow --broadcast \
  --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
```

**Never use `--private-key`**, and never put a key in `.env` or this repo.
