// The server's run approval against the real FireGames contract on a local Anvil chain: the contract's runDigest
// equals the server's EIP-712 hash, payRun accepts the server's signature (and refuses a tampered one), and the
// server's chain adapter (chain.js) reads FireGames' switches and the RunPaid event from the receipt.
// Needs Foundry (forge, anvil; FOUNDRY_BIN or ~/.foundry/bin); skipped without it. Compiles into a temp folder, so
// contracts/ is left as it is. Run: npm run test:games (from web/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, hashTypedData, http, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { FIRE_GAMES_ABI, RUN_TYPES, runDomain, runSigner, viemChain } from '../../api/games/_lib/chain.js';

const BIN = process.env.FOUNDRY_BIN || join(homedir(), '.foundry/bin');
const has = (b) => existsSync(join(BIN, b));
const SKIP = has('forge') && has('anvil') ? false : 'Foundry not found (set FOUNDRY_BIN)';
const CONTRACTS = fileURLToPath(new URL('../../../contracts/', import.meta.url));
// Anvil's well-known dev keys: never real ones
const OWNER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const PLAYER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'); // anvil #1
const SIGNER_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a'; // anvil #2

test('the approval matches FireGames on chain, end to end', { skip: SKIP, timeout: 300000 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'firegames-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const anvil = spawn(join(BIN, 'anvil'), ['--port', String(port), '--silent', '--chain-id', '31337'], { stdio: 'ignore' });
  try {
    const solc = join(BIN, 'solc'), args = ['build', 'src/cards/FireGames.sol', 'test/Mocks.sol', '--offline', '--out', join(out, 'out'), '--cache-path', join(out, 'cache')];
    if (existsSync(solc)) args.push('--use', solc);
    execFileSync(join(BIN, 'forge'), args, { cwd: CONTRACTS, stdio: 'pipe' });
    const art = (f, c) => JSON.parse(readFileSync(join(out, 'out', f, `${c}.json`), 'utf8'));
    const games = art('FireGames.sol', 'FireGames'), token = art('Mocks.sol', 'MockERC20'), feedArt = art('Mocks.sol', 'MockFeed');
    const rpc = `http://127.0.0.1:${port}`, transport = http(rpc);
    const pub = createPublicClient({ chain: foundry, transport });
    for (let i = 0; i < 100; i++) { try { await pub.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const owner = createWalletClient({ account: OWNER, chain: foundry, transport }), player = createWalletClient({ account: PLAYER, chain: foundry, transport });
    const deploy = async (a, args) => (await pub.waitForTransactionReceipt({ hash: await owner.deployContract({ abi: a.abi, bytecode: a.bytecode.object, args }) })).contractAddress;
    const paper = await deploy(token, ['Paper', 'PAPER']);
    const fg = await deploy(games, [OWNER.address, paper]);
    const feed = await deploy(feedArt, [2n * 10n ** 17n]); // PAPER at $0.20: the $0.10 ceiling makes a run 0.5 PAPER
    const send = async (w, address, abi, functionName, args) => pub.waitForTransactionReceipt({ hash: await w.writeContract({ address, abi, functionName, args }) });
    const signer = runSigner({ signerKey: SIGNER_KEY, chainId: 31337, gamesAddress: fg });
    for (const [f, a] of [['addGame', [1n, 10n ** 18n, 10_000_000n]], ['setPaperFeed', [feed]], ['setSeries', [7n]], ['setSigner', [signer.address]]]) await send(owner, fg, games.abi, f, a);
    await send(owner, paper, token.abi, 'mint', [PLAYER.address, 5n * 10n ** 18n]);
    await send(player, paper, token.abi, 'approve', [fg, 10n ** 18n]);

    const runId = keccak256(toHex('a run')), deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const message = { gameId: 1n, runId, player: PLAYER.address, series: 7n, deadline };
    // the digest: the contract's and the server's are the same
    const onChain = await pub.readContract({ address: fg, abi: FIRE_GAMES_ABI, functionName: 'runDigest', args: [1n, runId, PLAYER.address, 7n, deadline] });
    assert.equal(onChain, hashTypedData({ domain: runDomain(31337, fg), types: RUN_TYPES, primaryType: 'Run', message }));
    const sig = await signer.signRun({ gameId: 1, runId, player: PLAYER.address, series: 7, deadline: Number(deadline) });
    // a tampered approval (another Series) is refused; the real one pays
    await assert.rejects(pub.simulateContract({ account: PLAYER, address: fg, abi: games.abi, functionName: 'payRun', args: [1n, runId, 6n, deadline, 10n ** 18n, sig] }), /BadSignature/);
    await assert.rejects(pub.simulateContract({ account: OWNER, address: fg, abi: games.abi, functionName: 'payRun', args: [1n, runId, 7n, deadline, 10n ** 18n, sig] }), /BadSignature/); // another wallet
    assert.equal(await pub.readContract({ address: fg, abi: FIRE_GAMES_ABI, functionName: 'priceOf', args: [1n] }), 5n * 10n ** 17n);
    await assert.rejects(pub.simulateContract({ account: PLAYER, address: fg, abi: games.abi, functionName: 'payRun', args: [1n, runId, 7n, deadline, 4n * 10n ** 17n, sig] }), /PriceMoved/);
    const rc = await send(player, fg, games.abi, 'payRun', [1n, runId, 7n, deadline, 10n ** 18n, sig]);
    assert.equal(rc.status, 'success');
    assert.equal(await pub.readContract({ address: paper, abi: token.abi, functionName: 'balanceOf', args: [PLAYER.address] }), 45n * 10n ** 17n, 'burned 0.5 PAPER, not 1');
    // the server's chain adapter sees it
    const chain = viemChain({ rpcUrl: rpc, chainId: 31337, gamesAddress: fg, signerKey: SIGNER_KEY });
    assert.deepEqual(await chain.runPaid(rc.transactionHash), [{ gameId: 1, runId, player: PLAYER.address, series: 7 }]);
    const st = await chain.state(1);
    assert.deepEqual({ ...st, signer: st.signer.toLowerCase() }, { paused: false, open: true, series: 7, signer: signer.address.toLowerCase() });
  } finally {
    anvil.kill();
    rmSync(out, { recursive: true, force: true });
  }
});
