# Testnet rehearsal

A full practice launch on **Robinhood Chain testnet** (chain 46630): the real Fire, randomness and PLANK price feed,
on play tokens, with the keeper running and a copy of the site. Nothing costs real money. It's the same steps as
launch day, so by Oct 1 you've done them once.

What's different from mainnet: PAPER, PLANK and USDG are play tokens with a faucet; the PLANK pool and ETH/USD feed are
play copies anyone can move (so you can test a PLANK pump); there's no OpenSea, so the fire doesn't buy presses; the
site's swap is hidden (a "Get play tokens" button replaces it). Everything else is the real contract code.

## 1. Tools on your PC (once, ~10 minutes)
1. Download Foundry for Windows: https://github.com/foundry-rs/foundry/releases/latest →
   `foundry_stable_win32_amd64.zip`. Unzip to `C:\foundry`.
2. Add it to your PATH, in PowerShell:
   `[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\foundry", "User")`, then close and reopen PowerShell.
3. Check: `forge --version` prints a version.
4. Update your copy of the code: `cd C:\Users\DubT1\the-fire; git checkout wip/pending-approval; git pull`
5. Compile once: `cd contracts; forge build` (downloads the compiler the first time).

## 2. A testnet wallet (play money only)
1. In MetaMask, add a new account, name it **testnet deployer**. Copy its address.
2. Get free test ETH: https://faucet.testnet.chain.robinhood.com (or https://faucet.quicknode.com/robinhood/testnet).
3. Put its key in Foundry's keystore (practice for launch day):
   `cast wallet import testnet-deployer --interactive` → paste the private key into the hidden prompt, pick a password.
   The key is stored encrypted on your PC. It never goes in chat or a file.

## 3. Deploy (practice for launch day step 2)
From `C:\Users\DubT1\the-fire\contracts`:
1. **Dry run** (sends nothing):
   `forge script script/DeployTestnet.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com/rpc --account testnet-deployer --slow`
2. If it ends with "Script ran successfully", do it for real (add `--broadcast`):
   `forge script script/DeployTestnet.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com/rpc --account testnet-deployer --slow --broadcast`
3. It prints lines like `FIRE=0x…`, `PAPER=0x…`. **Paste all of them to Claude.** (Addresses are public; that's fine.)

Claude then puts the testnet site up on its own link.

## 4. Keeper on testnet (practice for launch day step 3, optional)
Same as `ops/README.md`, with a second small testnet wallet as the keeper (test ETH from the faucet), RPC
`https://rpc.testnet.chain.robinhood.com/rpc`, and one extra option in the `docker run` line:
`-e EXPECTED_CHAIN_ID=46630`. Without a keeper, the site shows a button to bring in each storm; that works too.

## 5. Play it for a few days
- Connect MetaMask on the testnet site, press **Get play tokens**, throw logs, watch the 8 PM storms.
- Try the edge cases: a buy right before 8 PM, a PLANK pump (Claude gives you the one-line `cast` command to move the
  play pool), a night nobody buys.
- Tell Claude anything that looks wrong. Fixes are free here; on mainnet they aren't.
