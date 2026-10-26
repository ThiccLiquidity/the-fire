// Takes the secret holder snapshot for a drop's snapshot group (docs/drop-groups.md): the wallets holding at least a
// minimum of any ERC-20 or ERC-721 over several blocks, each with its own allowance (packs it may take in the group),
// and checks one against the chain.
//
//   $env:RPC = "https://rpc.mainnet.chain.robinhood.com"     (PowerShell; an archive RPC: it reads past blocks)
//   node snapshot.mjs --min-usd 69 --out fire-7-holders.json                  (PLANK, $69+, 1 pack each)
//   node snapshot.mjs --token plank --min 1000000 --tiers "1000000:1,10000000:2,100000000:5" --out g1.json
//   node snapshot.mjs --token press --min 1 --allowance 2 --out g0.json       (an NFT: hold 1+ Paper Press)
//   node snapshot.mjs --verify fire-7-holders.json            (rebuilds it from the chain and compares)
//
// Options:
//   --token <addr>|plank|press  the coin or NFT (ERC-721 detected by ERC-165, else ERC-20 by decimals()); default
//                         PLANK. "plank" / "press" are the deployments file's PLANK / MILL.
//   --min <amount>       the minimum holding, in whole tokens ("1000000", "0.5") or NFTs
//   --min-usd <dollars>  PLANK only: the minimum in dollars, priced with the same 30-minute PLANK average the sale uses
//                        (PlankUsdTwap, at the last block); then the tiers are in dollars too. PLANK with no minimum
//                        given: --min-usd 69.
//   --tiers "<min>:<packs>,..."  allowance tiers: a wallet's allowance is the highest tier it reaches (holding >= its
//                        min); the minimum defaults to the lowest tier. Below every tier (but at least --min):
//                        --allowance.
//   --allowance N        the flat allowance (default 1): every wallet's, with no tiers
//   --blocks 5 --days 7  each wallet's SMALLEST holding over N blocks in the past D days (the last one --block, default
//                        the latest; the others at random times from a seed it prints and saves; --seed to give one).
//                        Borrowing for one block doesn't get anyone in. Every block used is saved in the file.
//   --pairs a,b          more Uniswap V2 pools to count LP holders in (ERC-20s only)
//   --allow-stale        take a PLANK price older than 2 hours (FireSale wouldn't)
//
// What counts:
//   - the token in the wallet, plus (ERC-20s) its share of every Uniswap V2 pool of the token it provides liquidity
//     to: LP balance / LP totalSupply x the pool's token reserve. The pools: the factory's pairs of the token with
//     WETH, USDG, PAPER and PLANK (deployments inputs), PLANK_WETH_V2_PAIR for PLANK, plus --pairs. LP held by a
//     contract (a farm, a locker) isn't followed into that contract.
//   - regular wallets only: an address with code is a contract and doesn't count, except an EIP-7702 delegated wallet
//     (code 0xef0100 + an address), which is a normal wallet. 0x0 and 0x...dEaD never count.
//
// The file: "root" (ConfigureSeries' GROUP_ROOT_<i>), "wallets" { address: { allowance, proof } } (what a buyer
// passes), "holders" [{ wallet, balance, allowance }], and how it was taken (token, kind, decimals, unit, min, tiers,
// allowance, blocks, seed, days, pools, price). Leaves: keccak256(bytes.concat(keccak256(abi.encode(wallet,
// allowance)))), as FireGroups checks them (merkle.mjs).
// --verify <file> rebuilds the list from the chain at the file's blocks (and checks those blocks follow from its
// seed) and compares wallets, balances, allowances, proofs and root: GREEN or RED. VerifySeries runs the same check.
// Run it at a moment nobody knows in advance, before the drop is set up. Reads go through Multicall3 when the chain
// has it.
import { createPublicClient, http, parseAbiItem, parseAbi, formatUnits, parseUnits, getAddress, zeroAddress } from 'viem'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { buildTree, verify } from './merkle.mjs'
import { requirePatchedNode } from '../keeper/src/node-check.mjs'

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const DEAD = '0x000000000000000000000000000000000000dEaD'
const MAX_AGE = 2n * 3600n // FireSale's limit on the PLANK price's age and on its window
const CHUNK = 300 // calls per Multicall3 call
const MAX_ALLOWANCE = 1_000_000n
const ERC721_ID = '0x80ac58cd'
/** The --selftest vector: (wallet, allowance). */
export const SELFTEST = [['0x00000000000000000000000000000000000000A1', 1], ['0x00000000000000000000000000000000000000C3', 2], ['0x00000000000000000000000000000000000000D4', 5]]
const ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function supportsInterface(bytes4) view returns (bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function getPair(address, address) view returns (address)',
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
  'function prev() view returns (uint256, uint32)',
])
const transfer20 = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const transfer721 = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)')

/** A regular wallet: no code, or an EIP-7702 delegation (0xef0100 + the delegate's address). */
export const isWallet = (code) => !code || code === '0x' || /^0xef0100[0-9a-f]{40}$/i.test(code)

/** A V2 pool's token behind `lp` LP tokens. */
export const lpShare = (lp, totalSupply, reserve) => (totalSupply === 0n ? 0n : (lp * reserve) / totalSupply)

/** "1000000:1,10000000:2" (or [{ min, allowance }]) -> [{ min: "1000000", allowance: 1 }], lowest first. */
export function parseTiers(v) {
  if (v === undefined || v === null || v === '' || v === true) return []
  const list = Array.isArray(v) ? v.map((t) => [t.min, t.allowance]) : String(v).split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.split(':'))
  const out = list.map(([min, a]) => {
    const m = String(min ?? '').trim()
    if (!/^\d+(\.\d+)?$/.test(m) || Number(m) <= 0) throw new Error(`tier "${min}:${a}": the minimum is a positive amount`)
    if (!/^\d+$/.test(String(a ?? '').trim()) || BigInt(a) < 1n || BigInt(a) > MAX_ALLOWANCE) throw new Error(`tier "${min}:${a}": the allowance is a whole number of packs, 1 or more`)
    return { min: m, allowance: Number(a) }
  })
  out.sort((x, y) => Number(x.min) - Number(y.min))
  for (let i = 1; i < out.length; i++) if (Number(out[i].min) === Number(out[i - 1].min)) throw new Error(`tiers: ${out[i].min} is there twice`)
  return out
}

/** A holding's allowance: the highest tier (by its raw minimum) it reaches, else the flat allowance. */
export function allowanceFor(balance, tiers, flat) {
  let a = flat
  for (const t of tiers) if (balance >= BigInt(t.minRaw)) a = t.allowance
  return a
}

/** The times of the random blocks: n-1 of them in [lastTs - days, lastTs), from the seed (SHA-256 per index). */
export function blockTimes(seed, lastTs, days, n) {
  const span = BigInt(Math.round(Number(days) * 86400))
  const out = []
  for (let i = 0; i < n - 1; i++) {
    const h = BigInt('0x' + createHash('sha256').update(`${seed}:${i}`).digest('hex').slice(0, 12)) // 48 bits
    out.push(BigInt(lastTs) - 1n - ((h * span) >> 48n))
  }
  return out
}

/** Each wallet's smallest balance over the blocks (a wallet missing from a block held 0 there). */
export function minBalances(perBlock) {
  const [first, ...rest] = perBlock
  const out = new Map(first)
  for (const m of rest) for (const [w, v] of out) { const x = m.get(w) ?? 0n; if (x < v) out.set(w, x) }
  return out
}

/** First block at or after `ts` in [lo, hi] (binary search). */
async function blockAt(client, ts, lo, hi, cache) {
  const tsOf = async (n) => { if (!cache.has(n)) cache.set(n, (await client.getBlock({ blockNumber: n })).timestamp); return cache.get(n) }
  while (lo < hi) {
    const mid = (lo + hi) / 2n
    if ((await tsOf(mid)) < ts) lo = mid + 1n
    else hi = mid
  }
  return lo
}

/** The blocks: n-1 at the seed's random times in the `days` before `last`, then `last`; sorted, no repeats. */
export async function chooseBlocks(client, { seed, last, days, n, first = 0n }) {
  const cache = new Map()
  const lastTs = (await client.getBlock({ blockNumber: last })).timestamp
  const bs = new Set([last])
  for (const t of blockTimes(seed, lastTs, days, n)) bs.add(await blockAt(client, t, first, last, cache))
  return [...bs].sort((a, b) => (a < b ? -1 : 1))
}

/** Reads many calls at one block: through Multicall3 when it has code there, else a few at a time. Failed: undefined. */
function reader(client) {
  const has = new Map()
  return async function readMany(calls, blockNumber) {
    if (!has.has(blockNumber)) { const c = await client.getCode({ address: MULTICALL3, blockNumber }); has.set(blockNumber, !!c && c !== '0x') }
    const out = []
    for (let i = 0; i < calls.length; i += has.get(blockNumber) ? CHUNK : 20) {
      const part = calls.slice(i, i + (has.get(blockNumber) ? CHUNK : 20)).map((c) => ({ abi: ABI, ...c }))
      if (has.get(blockNumber)) {
        const r = await client.multicall({ contracts: part, allowFailure: true, blockNumber, multicallAddress: MULTICALL3, batchSize: 0 })
        out.push(...r.map((x) => (x.status === 'success' ? x.result : undefined)))
      } else {
        out.push(...(await Promise.all(part.map((c) => client.readContract({ ...c, blockNumber }).catch(() => undefined)))))
      }
    }
    return out
  }
}

/** ERC-721 (ERC-165 says so) or ERC-20 (has decimals()). Returns { kind, decimals, symbol }. */
export async function tokenInfo(client, token, blockNumber) {
  const r = (functionName, args = []) => client.readContract({ address: token, abi: ABI, functionName, args, blockNumber }).catch(() => undefined)
  const symbol = (await r('symbol')) ?? ''
  if ((await r('supportsInterface', [ERC721_ID])) === true) return { kind: 'erc721', decimals: 0, symbol }
  const decimals = await r('decimals')
  if (decimals === undefined) throw new Error(`${token} is neither an ERC-721 (supportsInterface) nor an ERC-20 (decimals)`)
  return { kind: 'erc20', decimals: Number(decimals), symbol }
}

/** The token's V2 pools: `pair`, the factory's pairs of the token with `quotes`, and `extra`; each must hold the token
 *  and have an LP token (totalSupply). Returns [{ pair, tokenIs0 }] and notes on the ones skipped. */
export async function findPairs(client, token, { pair, factory, quotes = [], extra = [] }, blockNumber) {
  const readMany = reader(client)
  const found = new Set([pair, ...extra].filter(Boolean).map(getAddress))
  const qs = [...new Set(quotes.filter(Boolean).map(getAddress))].filter((q) => q !== getAddress(token))
  if (factory && qs.length) {
    const r = await readMany(qs.map((q) => ({ address: factory, functionName: 'getPair', args: [token, q] })), blockNumber)
    for (const p of r) if (p && p !== zeroAddress) found.add(getAddress(p))
  }
  const pairs = []
  const notes = []
  for (const p of [...found].sort()) {
    const [t0, t1, ts] = await readMany([{ address: p, functionName: 'token0' }, { address: p, functionName: 'token1' }, { address: p, functionName: 'totalSupply' }], blockNumber)
    const is0 = t0 && getAddress(t0) === getAddress(token)
    if (!is0 && !(t1 && getAddress(t1) === getAddress(token))) { notes.push(`${p}: not a pool of the token, skipped`); continue }
    if (ts === undefined) { notes.push(`${p}: no LP token (totalSupply), skipped`); continue }
    pairs.push({ pair: p, tokenIs0: !!is0 })
  }
  return { pairs, notes }
}

/** The PLANK price (18 decimals) at `block`. Throws on a stale price unless allowStale. */
async function priceAt(client, feed, block, allowStale) {
  const { timestamp: now } = await client.getBlock({ blockNumber: block })
  const [, px, , updatedAt] = await client.readContract({ address: feed, abi: ABI, functionName: 'latestRoundData', blockNumber: block })
  if (px <= 0n) throw new Error('PLANK price feed has no price')
  const age = now - updatedAt
  const prev = await client.readContract({ address: feed, abi: ABI, functionName: 'prev', blockNumber: block }).catch(() => undefined)
  const window = prev ? updatedAt - BigInt(prev[1]) : 0n
  if ((age > MAX_AGE || window > MAX_AGE) && !allowStale) {
    throw new Error(`PLANK price is ${age / 60n} min old over a ${window / 60n} min window (the sale takes 2 h at most): checkpoint PlankUsdTwap (the keeper), wait for the next window, then run this again (or --allow-stale)`)
  }
  return px
}

/** Token base units worth `usd` dollars at `px` (18-decimal price): usd * 10^decimals * 1e18 / px. */
export const usdToRaw = (usd, px, decimals) => (BigInt(Math.round(Number(usd) * 100)) * 10n ** BigInt(decimals + 16)) / px

/** Refuses log searches that could miss holders without an error: a fromBlock after the token existed (every wallet
 *  that got it earlier and never moved it would be left out), or a logs RPC on another chain or behind `last`.
 *  Throws; no logsClient: the logs come from `client`. */
export async function checkLogSource({ client, logsClient, token, fromBlock, last }) {
  if (fromBlock > 0n) {
    const code = await client.getCode({ address: token, blockNumber: fromBlock - 1n })
    if (code && code !== '0x') throw new Error(`from block ${fromBlock}: ${token} already existed at block ${fromBlock - 1n}, so earlier holders would be missed. Leave --from-block out, or give a block from before the token was deployed`)
  }
  if (!logsClient) return
  const [want, got] = await Promise.all([client.getChainId(), logsClient.getChainId()])
  if (want !== got) throw new Error(`LOGS_RPC is chain ${got}, RPC is chain ${want}`)
  const head = await logsClient.getBlockNumber()
  if (head < last) throw new Error(`LOGS_RPC is at block ${head}, behind the last block ${last}: it would miss transfers`)
}

/**
 * Builds the holder list. opts: { client, token, feed (for minUsd), min | minUsd, tiers, allowance (1), block (the
 * last; default latest), blocks (5), days (7), seed, fromBlock, step, pairs ([{ pair, tokenIs0 }]: given, else found
 * with `discover`), discover, allowStale, log, logsClient (the log searches on another RPC: they need no history, while
 * the balance reads need an archive RPC; default `client`) }. Returns the file's content (no holders: count 0).
 */
export async function takeSnapshot(o) {
  const { client } = o
  const token = getAddress(o.token)
  const log = o.log ?? (() => {})
  const fromBlock = BigInt(o.fromBlock ?? 0)
  const step = BigInt(o.step ?? 50000)
  const n = Number(o.blocks ?? 5)
  const days = Number(o.days ?? 7)
  if (!(n >= 1) || !(days >= 0)) throw new Error('--blocks is 1 or more, --days 0 or more')
  const flat = Number(o.allowance ?? 1)
  if (!Number.isInteger(flat) || flat < 1 || flat > Number(MAX_ALLOWANCE)) throw new Error('--allowance is a whole number of packs, 1 or more')
  const last = o.block !== undefined ? BigInt(o.block) : await client.getBlockNumber()
  const seed = o.seed ?? randomBytes(16).toString('hex')
  await checkLogSource({ client, logsClient: o.logsClient, token, fromBlock, last })
  const info =await tokenInfo(client, token, last)
  const unit = o.minUsd !== undefined && o.minUsd !== null ? 'usd' : 'token'
  const tiers = parseTiers(o.tiers)
  const min = String(unit === 'usd' ? o.minUsd : o.min ?? tiers[0]?.min ?? '')
  if (!/^\d+(\.\d+)?$/.test(min) || Number(min) <= 0) throw new Error('give a minimum: --min <amount>, --min-usd <dollars> (PLANK) or --tiers')
  let px
  let toRaw
  if (unit === 'usd') {
    if (info.kind !== 'erc20' || !o.feed) throw new Error('--min-usd prices with the PLANK feed (PlankUsdTwap): PLANK only; use --min for other tokens')
    px = await priceAt(client, o.feed, last, o.allowStale)
    toRaw = (x) => usdToRaw(x, px, info.decimals)
  } else {
    toRaw = (x) => (info.kind === 'erc721' ? (/^\d+$/.test(String(x)) ? BigInt(x) : (() => { throw new Error(`${x}: NFTs come whole`) })()) : parseUnits(String(x), info.decimals))
  }
  const minRaw = toRaw(min)
  const tiersRaw = tiers.map((t) => ({ ...t, minRaw: toRaw(t.min).toString() }))
  const what = (raw) => (info.kind === 'erc721' ? `${raw} NFT(s)` : `${formatUnits(raw, info.decimals)} ${info.symbol || 'tokens'}`)
  log(`Last block ${last}. ${info.kind === 'erc721' ? 'ERC-721' : 'ERC-20'} ${info.symbol || ''} ${token}${px ? ` at $${formatUnits(px, 18)}` : ''}. Minimum ${what(minRaw)}${unit === 'usd' ? ` ($${min})` : ''}; allowance ${tiers.length ? tiersRaw.map((t) => `${t.allowance} from ${what(BigInt(t.minRaw))}`).join(', ') + `, else ${flat}` : flat}.`)
  let pairs = info.kind === 'erc20' ? o.pairs : []
  if (!pairs) {
    const f = await findPairs(client, token, o.discover ?? {}, last)
    pairs = f.pairs
    for (const x of f.notes) log(`pool ${x}`)
  }
  const blocks = await chooseBlocks(client, { seed, last, days, n, first: fromBlock })
  log(`Seed ${seed}: the smallest holding over ${blocks.length} block(s) in ${days} day(s): ${blocks.join(', ')}. ${pairs.length} pool(s) counted${pairs.length ? `: ${pairs.map((p) => p.pair).join(', ')}` : ''}.`)

  // Everyone who ever received the token or a pool's LP token (Transfer logs, in chunks)
  const seen = new Set()
  const lpSeen = pairs.map(() => new Set())
  for (const [k, addr] of [token, ...pairs.map((p) => p.pair)].entries()) {
    const event = k === 0 && info.kind === 'erc721' ? transfer721 : transfer20
    for (let b = fromBlock; b <= last; b += step) {
      const to = b + step - 1n > last ? last : b + step - 1n
      const logs = await (o.logsClient ?? client).getLogs({ address: addr, event, fromBlock: b, toBlock: to })
      for (const l of logs) { if (!l.args?.to) continue; const w = getAddress(l.args.to); seen.add(w); if (k > 0) lpSeen[k - 1].add(w) }
    }
  }
  for (const x of [zeroAddress, DEAD, ...pairs.map((p) => p.pair)]) seen.delete(getAddress(x))
  const readMany = reader(client)
  /** Each wallet's tokens plus its pools' share, at `block`. */
  async function effective(wallets, block) {
    const pool = await readMany(pairs.flatMap((p) => [{ address: p.pair, functionName: 'totalSupply' }, { address: p.pair, functionName: 'getReserves' }]), block)
    const calls = []
    for (const w of wallets) {
      calls.push({ address: token, functionName: 'balanceOf', args: [w] })
      pairs.forEach((p, k) => { if (lpSeen[k].has(w)) calls.push({ address: p.pair, functionName: 'balanceOf', args: [w] }) })
    }
    const r = await readMany(calls, block)
    const out = new Map()
    let i = 0
    for (const w of wallets) {
      let v = r[i++] ?? 0n
      pairs.forEach((p, k) => {
        if (!lpSeen[k].has(w)) return
        const lp = r[i++] ?? 0n
        const [ts, res] = [pool[2 * k], pool[2 * k + 1]]
        if (lp > 0n && ts !== undefined && res !== undefined) v += lpShare(lp, ts, BigInt(p.tokenIs0 ? res[0] : res[1]))
      })
      out.set(w, v)
    }
    return out
  }
  // the last block first: only who qualifies there can qualify at all (the minimum is never more)
  const atLast = await effective([...seen], last)
  let keep = [...atLast].filter(([, v]) => v >= minRaw).map(([w]) => w)
  const perBlock = [new Map(keep.map((w) => [w, atLast.get(w)]))]
  for (const b of blocks) if (b !== last) perBlock.push(await effective(keep, b))
  const mins = minBalances(perBlock)
  keep = keep.filter((w) => mins.get(w) >= minRaw)
  const holders = []
  for (const w of keep.sort()) {
    const code = await client.getCode({ address: w, blockNumber: last })
    if (!isWallet(code)) continue // contracts (pools, lockers, farms) aren't buyers
    holders.push({ wallet: w, balance: mins.get(w).toString(), allowance: allowanceFor(mins.get(w), tiersRaw, flat) })
  }
  const tree = holders.length ? buildTree(holders) : { root: null, proofs: {} }
  const wallets = {}
  for (const h of holders) {
    if (!verify(tree.proofs[h.wallet], tree.root, h.wallet, h.allowance)) throw new Error('proof failed for ' + h.wallet)
    wallets[h.wallet] = { allowance: h.allowance, proof: tree.proofs[h.wallet] }
  }
  return {
    version: 3, root: tree.root, token, kind: info.kind, symbol: info.symbol, decimals: info.decimals,
    unit, min, minRaw: minRaw.toString(), tiers: tiersRaw, allowance: flat,
    ...(unit === 'usd' ? { feed: getAddress(o.feed), tokenUsd: px.toString() } : {}),
    block: last.toString(), blocks: blocks.map(String), seed, days, blockCount: n, fromBlock: fromBlock.toString(), step: step.toString(),
    pairs: pairs.map((p) => ({ pair: p.pair, tokenIs0: p.tokenIs0 })), count: holders.length, holders, wallets,
  }
}

/** The differences between a snapshot file and one rebuilt (wallets, balances, allowances, root, settings), and the
 *  file's own tree (its root and every proof it serves). */
export function compareSnapshots(file, again) {
  const p = []
  for (const k of ['token', 'kind', 'minRaw', 'tokenUsd', 'block']) if (String(file[k]).toLowerCase() !== String(again[k]).toLowerCase()) p.push(`${k}: file ${file[k]}, chain ${again[k]}`)
  const tiers = (t) => (t ?? []).map((x) => `${x.minRaw}:${x.allowance}`).join()
  if (tiers(file.tiers) !== tiers(again.tiers) || Number(file.allowance) !== Number(again.allowance)) p.push(`allowances: file ${tiers(file.tiers) || '-'} else ${file.allowance}, rebuilt ${tiers(again.tiers) || '-'} else ${again.allowance}`)
  if ((file.blocks ?? []).join() !== again.blocks.join()) p.push(`blocks: file ${(file.blocks ?? []).join(', ')}, from the seed ${again.blocks.join(', ')}`)
  const row = (h) => `${h.balance}/${h.allowance}`
  const a = new Map((file.holders ?? []).map((h) => [getAddress(h.wallet), row(h)]))
  const b = new Map(again.holders.map((h) => [getAddress(h.wallet), row(h)]))
  for (const [w, v] of a) {
    if (!b.has(w)) p.push(`${w} is in the file but doesn't qualify on chain`)
    else if (b.get(w) !== v) p.push(`${w}: file ${v} (balance/allowance), chain ${b.get(w)}`)
  }
  for (const w of b.keys()) if (!a.has(w)) p.push(`${w} qualifies on chain but isn't in the file`)
  if (String(file.root).toLowerCase() !== String(again.root).toLowerCase()) p.push(`root: file ${file.root}, chain ${again.root}`)
  if (Number(file.count) !== (file.holders ?? []).length) p.push(`count ${file.count} but ${(file.holders ?? []).length} holders listed`)
  p.push(...ownTree(file))
  return p
}

/** A file's own consistency: its root is the tree of its holders, and every wallet's served proof and allowance
 *  verify (what the site hands buyers). */
export function ownTree(file) {
  const p = []
  const hs = file.holders ?? []
  if (!hs.length) return p
  const t = buildTree(hs)
  if (t.root.toLowerCase() !== String(file.root).toLowerCase()) p.push(`the file's root isn't the tree of its own holders (${t.root})`)
  const served = new Map(Object.entries(file.wallets ?? {}).map(([w, x]) => [getAddress(w), x]))
  const bad = hs.filter((h) => { const x = served.get(getAddress(h.wallet)); return !x || Number(x.allowance) !== Number(h.allowance) || !verify(x.proof ?? [], file.root, h.wallet, x.allowance) })
  if (bad.length) p.push(`${bad.length} wallet(s) in the file don't verify with the allowance and proof it serves (first ${bad[0].wallet})`)
  if (served.size !== hs.length) p.push(`${served.size} wallets served but ${hs.length} holders listed`)
  return p
}

/**
 * Rebuilds `snap` (a file's content) from the chain at its saved blocks and compares. `discover` (the pools to look
 * for, as takeSnapshot) also checks the file counted every pool. Returns { ok, problems, count, root }.
 */
export async function verifySnapshot({ client, logsClient, snap, discover, log }) {
  if (!snap.blocks?.length || !snap.seed || !(snap.version >= 3)) {
    return { ok: false, problems: ['the file has no saved blocks, seed or allowances (taken before snapshot groups): take it again'], count: 0, root: null }
  }
  const last = BigInt(snap.blocks.at(-1))
  const pairs = (snap.pairs ?? []).map((p) => ({ pair: getAddress(p.pair), tokenIs0: !!p.tokenIs0 }))
  const problems = []
  if (discover && snap.kind === 'erc20') {
    const f = await findPairs(client, snap.token, discover, last)
    const want = f.pairs.map((p) => p.pair).sort().join()
    if (want !== pairs.map((p) => p.pair).sort().join()) problems.push(`pools: file ${pairs.map((p) => p.pair).join(', ') || 'none'}, found ${f.pairs.map((p) => p.pair).join(', ') || 'none'}`)
  }
  const again = await takeSnapshot({
    client, logsClient, token: snap.token, feed: snap.feed, ...(snap.unit === 'usd' ? { minUsd: snap.min } : { min: snap.min }), tiers: snap.tiers, allowance: snap.allowance,
    block: last, blocks: snap.blockCount ?? snap.blocks.length, days: snap.days, seed: snap.seed, fromBlock: snap.fromBlock ?? 0, ...(snap.step ? { step: snap.step } : {}), pairs, allowStale: true, log,
  })
  problems.push(...compareSnapshots(snap, again))
  return { ok: problems.length === 0, problems, count: again.count, root: again.root }
}

// Addresses: PLANK, MILL and PLANK_USD_FEED from the environment, else from deployments/<chainId>.json.
function fromDeployments(chainId) {
  const path = process.env.DEPLOYMENTS_FILE ?? new URL(`../../deployments/${chainId}.json`, import.meta.url)
  if (!existsSync(path)) return {}
  const j = JSON.parse(readFileSync(path, 'utf8'))
  return { plank: j.inputs?.PLANK, feed: j.contracts?.PlankUsdTwap, inputs: j.inputs ?? {} }
}

/** The pools to look for: the factory's pairs of the token with WETH, USDG, PAPER and PLANK, PLANK_WETH_V2_PAIR for
 *  PLANK, and `extra`. */
export function discoverFor(token, inputs = {}, extra = []) {
  const isPlank = inputs.PLANK && getAddress(token) === getAddress(inputs.PLANK)
  return {
    pair: isPlank ? (process.env.PLANK_WETH_V2_PAIR ?? inputs.PLANK_WETH_V2_PAIR) : undefined, factory: process.env.UNIV2_FACTORY ?? inputs.UNIV2_FACTORY,
    quotes: [inputs.WETH, inputs.USDG, inputs.PAPER, inputs.PLANK], extra,
  }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]])
    return acc
  }, []))
  const str = (k) => (typeof args[k] === 'string' ? args[k] : undefined)

  if (args.selftest) {
    // Fixed vector, offline: the leaves are checked against cast's abi.encode + keccak in snapshot.test.mjs, and a
    // proof from this code buys in a snapshot group on the real FireGroups in ops/rehearsal.
    const entries = SELFTEST.map(([wallet, allowance]) => ({ wallet, allowance }))
    const { root, proofs } = buildTree(entries)
    for (const e of entries) if (!verify(proofs[getAddress(e.wallet)], root, e.wallet, e.allowance)) throw new Error('proof failed for ' + e.wallet)
    console.log(JSON.stringify({ root, proofs }, null, 2))
    return
  }

  const rpc = process.env.RPC
  if (!rpc) throw new Error('Set RPC first ($env:RPC = "...")')
  const client = createPublicClient({ transport: http(rpc, { retryCount: 3, timeout: 60_000 }) })
  // LOGS_RPC: the transfer-log searches on another RPC (a non-archive public node takes big searches; an archive plan
  // like Alchemy free allows only 10 blocks a search but keeps the past balances RPC must read)
  const logsClient = process.env.LOGS_RPC ? createPublicClient({ transport: http(process.env.LOGS_RPC, { retryCount: 3, timeout: 60_000 }) }) : undefined
  const chainId = await client.getChainId()
  const dep = fromDeployments(chainId)
  const inp = { ...(dep.inputs ?? {}) }
  const extra = str('pairs') ? str('pairs').split(',').map((s) => s.trim()) : []

  if (args.verify) {
    if (args.verify === true) throw new Error('--verify <the snapshot file>')
    const snap = JSON.parse(readFileSync(args.verify, 'utf8'))
    const v = await verifySnapshot({ client, logsClient, snap, discover: snap.token ? discoverFor(snap.token, inp, extra) : undefined, log: (l) => console.log(`  ${l}`) })
    for (const p of v.problems) console.log(`FAIL  ${p}`)
    console.log(v.ok ? `GREEN: rebuilt from the chain at its ${snap.blocks.length} blocks: the same ${v.count} wallets, balances, allowances and root ${v.root}.` : `RED: ${v.problems.length} difference(s). Don't use this file.`)
    process.exitCode = v.ok ? 0 : 1
    return
  }

  // the mainnet PLANK only as a last resort on mainnet itself: any other chain must name its own
  const PLANK = process.env.PLANK ?? dep.plank ?? (chainId === 4663 ? '0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc' : undefined)
  if (PLANK) inp.PLANK = getAddress(PLANK)
  const t = (str('token') ?? 'plank').toLowerCase()
  const token = t === 'plank' ? PLANK : t === 'press' ? process.env.MILL ?? inp.MILL : str('token')
  if (!token) throw new Error(t === 'press' ? `Set MILL (no MILL in deployments/${chainId}.json)` : `Set PLANK (no PLANK in deployments/${chainId}.json)`)
  const isPlank = PLANK && getAddress(token) === getAddress(PLANK)
  let minUsd = str('min-usd')
  if (minUsd !== undefined && !isPlank) throw new Error('--min-usd is for PLANK only (priced with PlankUsdTwap): use --min')
  if (minUsd === undefined && !str('min') && !str('tiers')) {
    if (!isPlank) throw new Error('give a minimum: --min <amount> or --tiers "<min>:<packs>,..."')
    minUsd = '69'
  }
  const feed = process.env.PLANK_USD_FEED ?? dep.feed
  if (minUsd !== undefined && !feed) throw new Error('Set PLANK_USD_FEED (the PlankUsdTwap address), or deploy first (deployments/<chainId>.json)')
  const out = str('out') ?? 'holders.json'
  const snap = await takeSnapshot({
    client, logsClient, token, feed, minUsd, min: str('min'), tiers: str('tiers'), allowance: str('allowance') ?? 1,
    block: str('block') === undefined ? undefined : BigInt(args.block), blocks: str('blocks') ?? 5, days: str('days') ?? 7, seed: str('seed'),
    fromBlock: str('from-block') ?? 0, step: str('step'), discover: discoverFor(token, inp, extra), allowStale: !!args['allow-stale'], log: console.log,
  })
  if (snap.count === 0) throw new Error('nobody qualifies')
  writeFileSync(out, JSON.stringify(snap, null, 2))
  console.log(`${snap.count} wallets qualify (${snap.holders.reduce((s, h) => s + h.allowance, 0)} packs of allowance). Root (the group's root, GROUP_ROOT_<i>): ${snap.root}`)
  console.log(`Wrote ${out} (with its seed and blocks: node snapshot.mjs --verify ${out} rebuilds it).`)
}

// reads RPCs: not on a Node with the Brotli bug (CVE-2026-111497)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) { requirePatchedNode(); await main() }
