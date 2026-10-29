// The game room's prizes for a finished Series: the places on a game's board win what web/art/factory/forge/prizes.json says for
// that game (free pack credits, free cases and free gradings, any mix), through
// FireCredits.awardPrizes(series, gameId, winners, packs, cases, grades). On chain, all games together are capped at
// 6 packs, 50 cases and 20 gradings per Series. Meant to run at each new Series launch, for the Series that just
// ended. docs/game-server.md.
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
// Options: --series N (the finished Series, required) · --game 1 (FireGames id; default 1, paper football) · --prizes
// file.json (default web/art/factory/forge/prizes.json) · --from-block N (where to look for this game's past prizes) · --site URL
// (or env GAMES_SITE: the board is <site>/api/games/<game>/board?series=N) · --board file.json (a saved board instead)
// · --exclude 0xa,0xb (wallets the owner's review took off; the next ones move up) · --chain 4663 · --credits 0x...
// (default: deployments/<chain>.json's FireCredits) · --send.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const CREDITS_ABI = parseAbi([
  'function awardPrizes(uint256 fire, uint256 gameId, address[] winners, uint256[] packs, uint256[] cases, uint256[] grades)',
  'function prizesOf(uint256 fire) view returns (uint64 packs, uint64 cases, uint64 grades)',
  'function prizeGame(uint256 gameId) view returns (bool)',
  'function prizeAwarder() view returns (address)',
  'function owner() view returns (address)',
  'function psa() view returns (address)',
  'function MAX_PRIZE_CREDITS() view returns (uint256)',
  'function MAX_PRIZE_CASES() view returns (uint256)',
  'function MAX_PRIZE_GRADES() view returns (uint256)',
  'event PrizeAwarded(uint256 indexed fire, uint256 indexed gameId, address indexed winner, uint256 packs, uint256 cases, uint256 grades)',
]);

const KINDS = ['packs', 'cases', 'grades'];
/** a game's prize table from the prizes file: one { packs, cases, grades } per place, each place winning something */
/** The prizes file the site shows (web/art/factory/forge/prizes.json): one source for both. */
export const PRIZES = new URL('../../web/art/factory/forge/prizes.json', import.meta.url);

export function prizeTable(file, gameId, series) {
  const all = JSON.parse(readFileSync(file, 'utf8'));
  // { default: { game: [...] }, series: { N: { game: [...] } } }: a Series' own table, else the default
  const t = all.default ? (all.series?.[String(series)]?.[String(gameId)] ?? all.default[String(gameId)]) : all[String(gameId)];
  if (!Array.isArray(t) || !t.length) throw new Error(`${file} has no prizes for game ${gameId}`);
  return t.map((p, i) => {
    const o = Object.fromEntries(KINDS.map((k) => [k, p[k] ?? 0]));
    if (!KINDS.every((k) => Number.isSafeInteger(o[k]) && o[k] >= 0) || !KINDS.some((k) => o[k] > 0)) throw new Error(`game ${gameId}, place ${i + 1}: prizes must be whole numbers, at least one above 0`);
    return o;
  });
}

const say = (p) => KINDS.filter((k) => p[k]).map((k) => `${p[k]} ${k === 'packs' ? 'pack' : k === 'cases' ? 'case' : 'grading'}${p[k] > 1 ? 's' : ''}`).join(' + ');

/** the winners from a board's rows (already ranked: streak, then the earliest), minus excluded wallets */
export function winnersFrom(rows, { exclude = [], table = [{ packs: 3 }, { packs: 2 }, { packs: 1 }] } = {}) {
  const out = new Set(exclude.map((a) => a.toLowerCase())), seen = new Set(), winners = [];
  for (const r of rows) {
    const w = String(r.wallet).toLowerCase();
    if (!isAddress(w) || out.has(w) || seen.has(w) || !(r.streak > 0)) continue;
    seen.add(w); winners.push({ wallet: getAddress(w), streak: r.streak, reachedAt: r.reachedAt });
    if (winners.length === table.length) break;
  }
  return winners.map((w, i) => ({ ...w, packs: table[i].packs ?? 0, cases: table[i].cases ?? 0, grades: table[i].grades ?? 0 }));
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
  const table = prizeTable(o.prizes ?? PRIZES, gameId, series);
  const winners = winnersFrom(rows, { exclude: (o.exclude ?? '').split(',').filter(Boolean), table });
  out(`Series ${series}, game ${gameId}: ${rows.length} on the board`);
  if (!winners.length) { out('No winners (an empty board): nothing to send.'); return { winners, sent: false }; }
  winners.forEach((w, i) => out(`  ${i + 1}. ${w.wallet}  streak ${w.streak}  -> ${say(w)}`));
  const wallets = winners.map((w) => w.wallet), lists = KINDS.map((k) => winners.map((w) => w[k]));
  const sum = Object.fromEntries(KINDS.map((k, j) => [k, lists[j].reduce((a, b) => a + b, 0)]));

  // the chain
  const rpc = env.RPC ?? env.RPC_URL ?? env.GAME_RPC_URL;
  let credits = o.credits, fromBlock = o['from-block'] != null ? BigInt(o['from-block']) : undefined;
  const f = new URL(`../../deployments/${chainId}.json`, import.meta.url);
  if (existsSync(f)) {
    const dep = JSON.parse(readFileSync(f, 'utf8'));
    credits ??= dep.contracts?.FireCredits;
    if (fromBlock === undefined && dep.startBlock != null) fromBlock = BigInt(dep.startBlock);
  }
  const call = `FireCredits(${credits ?? '?'}).awardPrizes(${series}, ${gameId}, [${wallets.join(',')}], ${lists.map((l) => `[${l.join(',')}]`).join(', ')})`;
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
  const [given, allowed, awarder, owner, psa, ...caps] = await Promise.all([read('prizesOf', [BigInt(series)]), read('prizeGame', [BigInt(gameId)]), read('prizeAwarder'), read('owner'), read('psa'), read('MAX_PRIZE_CREDITS'), read('MAX_PRIZE_CASES'), read('MAX_PRIZE_GRADES')]);
  out(`FireCredits ${address}: Series ${series} prizes so far (all games) ${KINDS.map((k, j) => `${given[j]}/${caps[j]} ${k}`).join(', ')}; game ${gameId} ${allowed ? 'allowed' : 'NOT allowed'}, prize wallet ${awarder}`);
  if (fromBlock === undefined) throw new Error('--from-block N is needed to check this game has no prizes for this Series yet');
  const past = await pub.getContractEvents({ address, abi: CREDITS_ABI, eventName: 'PrizeAwarded', args: { fire: BigInt(series), gameId: BigInt(gameId) }, fromBlock });
  if (past.length) { out(`This Series already has prizes for game ${gameId}: nothing to send.`); return { winners, sent: false, already: true }; }
  if (!allowed) throw new Error(`game ${gameId} isn't allowed prizes (FireCredits.setPrizeGame)`);
  KINDS.forEach((k, j) => { if (given[j] + BigInt(sum[k]) > caps[j]) throw new Error(`${k}: ${given[j]} given + ${sum[k]} here is over the Series cap of ${caps[j]} (all games together); edit the prizes file`); });
  if (sum.cases + sum.grades > 0 && /^0x0{40}$/i.test(psa)) throw new Error('FireCredits has no FirePsa yet (setPsa): cases and gradings can\'t be given');

  const key = env.GAME_AWARDER_KEY;
  if (!key) {
    out(`Dry run. To send, set env GAME_AWARDER_KEY (the prize wallet's key) and add --send. The call:\n  ${call}`);
    if (o.send) throw new Error('--send needs env GAME_AWARDER_KEY');
    return { winners, sent: false };
  }
  let account;
  try { account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`); } catch { throw new Error('GAME_AWARDER_KEY is not a valid private key'); } // never echo it
  if (![awarder, owner].some((a) => a.toLowerCase() === account.address.toLowerCase())) throw new Error(`the key's wallet (${account.address}) is not FireCredits' prize wallet or owner`);
  const { request } = await pub.simulateContract({ account, address, abi: CREDITS_ABI, functionName: 'awardPrizes', args: [BigInt(series), BigInt(gameId), wallets, ...lists.map((l) => l.map(BigInt))] });
  out(`Simulated OK from ${account.address}.`);
  if (!o.send) { out(`Dry run: add --send to send it.\n  ${call}`); return { winners, sent: false }; }
  const wallet = createWalletClient({ account, transport, chain });
  const hash = await wallet.writeContract(request);
  out(`Sent: ${hash}`);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== 'success') throw new Error(`the transaction failed: ${hash}`);
  out(`Done: ${say(sum)} awarded (block ${rc.blockNumber}).`);
  return { winners, sent: true, hash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  award(process.argv.slice(2)).catch((e) => { console.error(`STOP: ${e.shortMessage ?? e.message}`); process.exit(1); });
}
