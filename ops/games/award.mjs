// The game room's prizes for a finished Series: the top three on a game's board get 3, 2 and 1 free pack credits
// (FireCredits.awardPrizes(series, gameId, winners, counts); capped on chain at 6 per game per Series). Meant to run
// at each new Series launch, for the Series that just ended. docs/game-server.md.
//
// A dry run by default: it reads the board, checks the chain and prints what it would send. --send sends it from the
// game server's prize wallet (FireCredits' prizeAwarder), whose key is read from env GAME_AWARDER_KEY and never printed.
//
//   PowerShell, from the repo:
//   $s = Read-Host "RPC URL" -AsSecureString; $env:RPC = [System.Net.NetworkCredential]::new("", $s).Password
//   node ops\games\award.mjs --series 7 --site https://omnicardworks.com             (dry run)
//   $k = Read-Host "Prize wallet key" -AsSecureString; $env:GAME_AWARDER_KEY = [System.Net.NetworkCredential]::new("", $k).Password
//   node ops\games\award.mjs --series 7 --site https://omnicardworks.com --send ; Remove-Item Env:GAME_AWARDER_KEY
//
// Options: --series N (the finished Series, required) · --game 1 (FireGames id; default 1, paper football) · --site URL
// (or env GAMES_SITE: the board is <site>/api/games/<game>/board?series=N) · --board file.json (a saved board instead)
// · --exclude 0xa,0xb (wallets the owner's review took off; the next ones move up) · --chain 4663 · --credits 0x...
// (default: deployments/<chain>.json's FireCredits) · --send.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const PRIZES = [3, 2, 1];
const CREDITS_ABI = parseAbi([
  'function awardPrizes(uint256 fire, uint256 gameId, address[] winners, uint256[] counts)',
  'function prizesOf(uint256 fire, uint256 gameId) view returns (uint256)',
  'function prizeGame(uint256 gameId) view returns (bool)',
  'function prizeAwarder() view returns (address)',
  'function owner() view returns (address)',
  'function MAX_PRIZE_CREDITS() view returns (uint256)',
]);

/** the winners from a board's rows (already ranked: streak, then the earliest), minus excluded wallets */
export function winnersFrom(rows, { exclude = [] } = {}) {
  const out = new Set(exclude.map((a) => a.toLowerCase())), seen = new Set(), winners = [];
  for (const r of rows) {
    const w = String(r.wallet).toLowerCase();
    if (!isAddress(w) || out.has(w) || seen.has(w) || !(r.streak > 0)) continue;
    seen.add(w); winners.push({ wallet: getAddress(w), streak: r.streak, reachedAt: r.reachedAt });
    if (winners.length === PRIZES.length) break;
  }
  return winners.map((w, i) => ({ ...w, packs: PRIZES[i] }));
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--send') o.send = true;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
  }
  return o;
}

export async function award(argv, { env = process.env, out = console.log, fetchImpl = fetch } = {}) {
  const o = args(argv), series = Number(o.series), gameId = Number(o.game ?? 1), chainId = Number(o.chain ?? 4663);
  if (!Number.isSafeInteger(series) || series < 1) throw new Error('--series N (the finished Series) is required');
  // the board
  let rows;
  if (o.board) rows = JSON.parse(readFileSync(o.board, 'utf8')).rows;
  else {
    const site = o.site ?? env.GAMES_SITE;
    if (!site) throw new Error('--site https://... (or env GAMES_SITE), or --board file.json');
    const url = `${site.replace(/\/$/, '')}/api/games/${gameId}/board?series=${series}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`board: ${res.status} from ${url}`);
    rows = (await res.json()).rows;
  }
  const winners = winnersFrom(rows, { exclude: (o.exclude ?? '').split(',').filter(Boolean) });
  out(`Series ${series}, game ${gameId}: ${rows.length} on the board`);
  if (!winners.length) { out('No winners (an empty board): nothing to send.'); return { winners, sent: false }; }
  winners.forEach((w, i) => out(`  ${i + 1}. ${w.wallet}  streak ${w.streak}  -> ${w.packs} free pack${w.packs > 1 ? 's' : ''}`));
  const counts = winners.map((w) => w.packs), wallets = winners.map((w) => w.wallet);

  // the chain
  const rpc = env.RPC ?? env.RPC_URL ?? env.GAME_RPC_URL;
  let credits = o.credits;
  if (!credits) {
    const f = new URL(`../../deployments/${chainId}.json`, import.meta.url);
    if (existsSync(f)) credits = JSON.parse(readFileSync(f, 'utf8')).contracts?.FireCredits;
  }
  const call = `FireCredits(${credits ?? '?'}).awardPrizes(${series}, ${gameId}, [${wallets.join(',')}], [${counts.join(',')}])`;
  if (!rpc || !credits) {
    out(`No ${!rpc ? 'RPC (env RPC)' : 'FireCredits address'}: can't check the chain. The call would be:\n  ${call}`);
    if (o.send) throw new Error('--send needs env RPC and the FireCredits address');
    return { winners, sent: false };
  }
  const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const transport = http(rpc), pub = createPublicClient({ chain, transport });
  if ((await pub.getChainId()) !== chainId) throw new Error(`the RPC is not chain ${chainId}`);
  const address = getAddress(credits);
  const read = (functionName, a = []) => pub.readContract({ address, abi: CREDITS_ABI, functionName, args: a });
  const [given, allowed, awarder, owner, cap] = await Promise.all([read('prizesOf', [BigInt(series), BigInt(gameId)]), read('prizeGame', [BigInt(gameId)]), read('prizeAwarder'), read('owner'), read('MAX_PRIZE_CREDITS')]);
  out(`FireCredits ${address}: prizes given so far ${given}/${cap}, game ${gameId} ${allowed ? 'allowed' : 'NOT allowed'}, prize wallet ${awarder}`);
  if (given > 0n) { out('This Series already has prizes for this game: nothing to send.'); return { winners, sent: false, already: true }; }
  if (!allowed) throw new Error(`game ${gameId} isn't allowed prizes (FireCredits.setPrizeGame)`);

  const key = env.GAME_AWARDER_KEY;
  if (!key) {
    out(`Dry run. To send, set env GAME_AWARDER_KEY (the prize wallet's key) and add --send. The call:\n  ${call}`);
    if (o.send) throw new Error('--send needs env GAME_AWARDER_KEY');
    return { winners, sent: false };
  }
  let account;
  try { account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`); } catch { throw new Error('GAME_AWARDER_KEY is not a valid private key'); } // never echo it
  if (![awarder, owner].some((a) => a.toLowerCase() === account.address.toLowerCase())) throw new Error(`the key's wallet (${account.address}) is not FireCredits' prize wallet or owner`);
  const { request } = await pub.simulateContract({ account, address, abi: CREDITS_ABI, functionName: 'awardPrizes', args: [BigInt(series), BigInt(gameId), wallets, counts.map(BigInt)] });
  out(`Simulated OK from ${account.address}.`);
  if (!o.send) { out(`Dry run: add --send to send it.\n  ${call}`); return { winners, sent: false }; }
  const wallet = createWalletClient({ account, transport, chain });
  const hash = await wallet.writeContract(request);
  out(`Sent: ${hash}`);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`the transaction failed: ${hash}`);
  out(`Done: ${counts.reduce((a, b) => a + b, 0)} free pack credits awarded (block ${rc.blockNumber}).`);
  return { winners, sent: true, hash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  award(process.argv.slice(2)).catch((e) => { console.error(`STOP: ${e.shortMessage ?? e.message}`); process.exit(1); });
}
