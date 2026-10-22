// Takes the secret PLANK-holder snapshot for a drop's holder window (docs/omni-economy.md), and checks one against the
// chain.
//
//   $env:RPC = "https://rpc.mainnet.chain.robinhood.com"     (PowerShell; an archive RPC: it reads past blocks)
//   node snapshot.mjs --min-usd 69 --out fire-7-holders.json [--blocks 5] [--days 7] [--block <n>] [--seed <hex>]
//   node snapshot.mjs --verify fire-7-holders.json            (rebuilds it from the chain and compares)
//
// It lists every regular wallet holding at least $69 of PLANK, priced with the same 30-minute PLANK average the sale
// uses (PlankUsdTwap, at the last block), builds the Merkle tree, checks every proof, and writes a file for the site.
// The one value you need is the "root": paste it as holderRoot when you set up the drop.
//
// What counts:
//   - PLANK in the wallet, plus its share of every PLANK Uniswap V2 pool it provides liquidity to: LP balance /
//     LP totalSupply x the pool's PLANK reserve. The pools: PLANK_WETH_V2_PAIR and the factory's PLANK pairs with WETH,
//     USDG and PAPER (deployments inputs), plus --pairs a,b. LP held by a contract (a farm, a locker) isn't followed
//     into that contract: those holders don't count through it.
//   - regular wallets only: an address with code is a contract and doesn't count, except an EIP-7702 delegated wallet
//     (code 0xef0100 + an address), which is a normal wallet. 0x0 and 0x...dEaD never count.
//   - each wallet's SMALLEST holding over several blocks: --blocks N (default 5) over the past --days D (default 7),
//     the last one --block (default the latest), the others at random times from a seed it prints and saves (--seed
//     to give one). Borrowing PLANK for one block doesn't get anyone in. Every block used is saved in the file.
// --verify <file> rebuilds the list from the chain at the file's blocks (and checks those blocks follow from its
// seed) and compares wallets, amounts and root: GREEN or RED. VerifySeries runs the same check.
// Run it at a moment nobody knows in advance, before the drop is set up. It refuses a PLANK price older than 2 hours
// (FireSale wouldn't take it either) unless --allow-stale. Reads go through Multicall3 when the chain has it.
import { createPublicClient, http, parseAbiItem, parseAbi, formatUnits, getAddress, zeroAddress } from 'viem'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { buildTree, verify } from './merkle.mjs'

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const DEAD = '0x000000000000000000000000000000000000dEaD'
const MAX_AGE = 2n * 3600n // FireSale's limit on the PLANK price's age and on its window
const CHUNK = 300 // calls per Multicall3 call
const ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function getPair(address, address) view returns (address)',
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
  'function prev() view returns (uint256, uint32)',
])
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')

/** A regular wallet: no code, or an EIP-7702 delegation (0xef0100 + the delegate's address). */
export const isWallet = (code) => !code || code === '0x' || /^0xef0100[0-9a-f]{40}$/i.test(code)

/** A V2 pool's PLANK behind `lp` LP tokens. */
export const lpShare = (lp, totalSupply, reserve) => (totalSupply === 0n ? 0n : (lp * reserve) / totalSupply)

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

/** The PLANK V2 pools: `pair`, the factory's PLANK pairs with `quotes`, and `extra`; each must hold PLANK and have an
 *  LP token (totalSupply). Returns [{ pair, plankIs0 }] and notes on the ones skipped. */
export async function findPairs(client, plank, { pair, factory, quotes = [], extra = [] }, blockNumber) {
  const readMany = reader(client)
  const found = new Set([pair, ...extra].filter(Boolean).map(getAddress))
  const qs = quotes.filter(Boolean).map(getAddress).filter((q) => q !== getAddress(plank))
  if (factory && qs.length) {
    const r = await readMany(qs.map((q) => ({ address: factory, functionName: 'getPair', args: [plank, q] })), blockNumber)
    for (const p of r) if (p && p !== zeroAddress) found.add(getAddress(p))
  }
  const pairs = []
  const notes = []
  for (const p of [...found].sort()) {
    const [t0, t1, ts] = await readMany([{ address: p, functionName: 'token0' }, { address: p, functionName: 'token1' }, { address: p, functionName: 'totalSupply' }], blockNumber)
    const is0 = t0 && getAddress(t0) === getAddress(plank)
    if (!is0 && !(t1 && getAddress(t1) === getAddress(plank))) { notes.push(`${p}: not a PLANK pool, skipped`); continue }
    if (ts === undefined) { notes.push(`${p}: no LP token (totalSupply), skipped`); continue }
    pairs.push({ pair: p, plankIs0: !!is0 })
  }
  return { pairs, notes }
}

/** The PLANK price at `block` and the PLANK wei worth `minUsd`. Throws on a stale price unless allowStale. */
async function priceAt(client, feed, block, minUsd, allowStale) {
  const { timestamp: now } = await client.getBlock({ blockNumber: block })
  const [, px, , updatedAt] = await client.readContract({ address: feed, abi: ABI, functionName: 'latestRoundData', blockNumber: block })
  if (px <= 0n) throw new Error('PLANK price feed has no price')
  const age = now - updatedAt
  const prev = await client.readContract({ address: feed, abi: ABI, functionName: 'prev', blockNumber: block }).catch(() => undefined)
  const window = prev ? updatedAt - BigInt(prev[1]) : 0n
  if ((age > MAX_AGE || window > MAX_AGE) && !allowStale) {
    throw new Error(`PLANK price is ${age / 60n} min old over a ${window / 60n} min window (the sale takes 2 h at most): checkpoint PlankUsdTwap (the keeper), wait for the next window, then run this again (or --allow-stale)`)
  }
  // PLANK wei worth minUsd: usd * 1e18 (wei per PLANK) * 1e18 (feed decimals) / px
  return { px, minPlank: (BigInt(Math.round(Number(minUsd) * 100)) * 10n ** 34n) / px }
}

/**
 * Builds the holder list. opts: { client, plank, feed, minUsd, block (the last; default latest), blocks (n, default 5),
 * days (7), seed, fromBlock, step, pairs ([{ pair, plankIs0 }]: given, else found with `discover`), discover, allowStale,
 * log }. Returns the file's content (no holders: count 0).
 */
export async function takeSnapshot(o) {
  const { client, plank, feed } = o
  const log = o.log ?? (() => {})
  const minUsd = Number(o.minUsd ?? 69)
  const fromBlock = BigInt(o.fromBlock ?? 0)
  const step = BigInt(o.step ?? 50000)
  const n = Number(o.blocks ?? 5)
  const days = Number(o.days ?? 7)
  if (!(n >= 1) || !(days >= 0)) throw new Error('--blocks is 1 or more, --days 0 or more')
  const last = o.block !== undefined ? BigInt(o.block) : await client.getBlockNumber()
  const seed = o.seed ?? randomBytes(16).toString('hex')
  const { px, minPlank } = await priceAt(client, feed, last, minUsd, o.allowStale)
  log(`Last block ${last}. PLANK $${formatUnits(px, 18)}. Minimum ${formatUnits(minPlank, 18)} PLANK ($${minUsd}).`)
  let pairs = o.pairs
  if (!pairs) {
    const f = await findPairs(client, plank, o.discover ?? {}, last)
    pairs = f.pairs
    for (const x of f.notes) log(`pool ${x}`)
  }
  const blocks = await chooseBlocks(client, { seed, last, days, n, first: fromBlock })
  log(`Seed ${seed}: the smallest holding over ${blocks.length} block(s) in ${days} day(s): ${blocks.join(', ')}. ${pairs.length} PLANK pool(s) counted${pairs.length ? `: ${pairs.map((p) => p.pair).join(', ')}` : ''}.`)

  // Everyone who ever received PLANK or a pool's LP token (Transfer logs, in chunks)
  const seen = new Set()
  const lpSeen = pairs.map(() => new Set())
  for (const [k, token] of [plank, ...pairs.map((p) => p.pair)].entries()) {
    for (let b = fromBlock; b <= last; b += step) {
      const to = b + step - 1n > last ? last : b + step - 1n
      const logs = await client.getLogs({ address: token, event: transfer, fromBlock: b, toBlock: to })
      for (const l of logs) { const w = getAddress(l.args.to); seen.add(w); if (k > 0) lpSeen[k - 1].add(w) }
    }
  }
  for (const x of [zeroAddress, DEAD, ...pairs.map((p) => p.pair)]) seen.delete(getAddress(x))
  const readMany = reader(client)
  /** Each wallet's PLANK plus its pools' share, at `block`. */
  async function effective(wallets, block) {
    const pool = await readMany(pairs.flatMap((p) => [{ address: p.pair, functionName: 'totalSupply' }, { address: p.pair, functionName: 'getReserves' }]), block)
    const calls = []
    for (const w of wallets) {
      calls.push({ address: plank, functionName: 'balanceOf', args: [w] })
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
        if (lp > 0n && ts !== undefined && res !== undefined) v += lpShare(lp, ts, BigInt(p.plankIs0 ? res[0] : res[1]))
      })
      out.set(w, v)
    }
    return out
  }
  // the last block first: only who qualifies there can qualify at all (the minimum is never more)
  const atLast = await effective([...seen], last)
  let keep = [...atLast].filter(([, v]) => v >= minPlank).map(([w]) => w)
  const perBlock = [new Map(keep.map((w) => [w, atLast.get(w)]))]
  for (const b of blocks) if (b !== last) perBlock.push(await effective(keep, b))
  const mins = minBalances(perBlock)
  keep = keep.filter((w) => mins.get(w) >= minPlank)
  const holders = []
  for (const w of keep.sort()) {
    const code = await client.getCode({ address: w, blockNumber: last })
    if (!isWallet(code)) continue // contracts can't buy during the limited phase anyway (pools, lockers, farms)
    holders.push({ wallet: w, plank: mins.get(w).toString() })
  }
  const tree = holders.length ? buildTree(holders.map((h) => h.wallet)) : { root: null, proofs: {} }
  for (const h of holders) if (!verify(tree.proofs[h.wallet], tree.root, h.wallet)) throw new Error('proof failed for ' + h.wallet)
  return {
    version: 2, root: tree.root, block: last.toString(), blocks: blocks.map(String), seed, days, blockCount: n, fromBlock: fromBlock.toString(),
    plank: getAddress(plank), feed: getAddress(feed), pairs: pairs.map((p) => ({ pair: p.pair, plankIs0: p.plankIs0 })),
    minUsd, minPlank: minPlank.toString(), plankUsd: px.toString(), count: holders.length, holders, proofs: tree.proofs,
  }
}

/** The differences between a snapshot file and one rebuilt (wallets, amounts, root, settings). */
export function compareSnapshots(file, again) {
  const p = []
  for (const k of ['plank', 'minPlank', 'plankUsd', 'block']) if (String(file[k]).toLowerCase() !== String(again[k]).toLowerCase()) p.push(`${k}: file ${file[k]}, chain ${again[k]}`)
  if ((file.blocks ?? []).join() !== again.blocks.join()) p.push(`blocks: file ${(file.blocks ?? []).join(', ')}, from the seed ${again.blocks.join(', ')}`)
  const a = new Map((file.holders ?? []).map((h) => [getAddress(h.wallet), String(h.plank)]))
  const b = new Map(again.holders.map((h) => [getAddress(h.wallet), String(h.plank)]))
  for (const [w, v] of a) {
    if (!b.has(w)) p.push(`${w} is in the file but doesn't qualify on chain`)
    else if (b.get(w) !== v) p.push(`${w}: file ${v} PLANK wei, chain ${b.get(w)}`)
  }
  for (const w of b.keys()) if (!a.has(w)) p.push(`${w} qualifies on chain but isn't in the file`)
  if (String(file.root).toLowerCase() !== String(again.root).toLowerCase()) p.push(`root: file ${file.root}, chain ${again.root}`)
  if (Number(file.count) !== (file.holders ?? []).length) p.push(`count ${file.count} but ${(file.holders ?? []).length} holders listed`)
  // the file's own tree: the root and every proof the site serves
  const wallets = (file.holders ?? []).map((h) => h.wallet)
  if (wallets.length) {
    const t = buildTree(wallets)
    if (t.root.toLowerCase() !== String(file.root).toLowerCase()) p.push(`the file's root isn't the tree of its own wallets (${t.root})`)
    const bad = wallets.filter((w) => !verify(file.proofs?.[getAddress(w)] ?? [], file.root, w))
    if (bad.length) p.push(`${bad.length} proof(s) in the file don't verify (first ${bad[0]})`)
  }
  return p
}

/**
 * Rebuilds `snap` (a file's content) from the chain at its saved blocks and compares. `discover` (the pools to look
 * for, as takeSnapshot) also checks the file counted every PLANK pool. Returns { ok, problems, count, root }.
 */
export async function verifySnapshot({ client, snap, discover, log }) {
  if (!snap.blocks?.length || !snap.seed || snap.version < 2) {
    return { ok: false, problems: ['the file has no saved blocks and seed (taken before the multi-block snapshot): take it again'], count: 0, root: null }
  }
  const last = BigInt(snap.blocks.at(-1))
  const pairs = (snap.pairs ?? []).map((p) => ({ pair: getAddress(p.pair), plankIs0: !!p.plankIs0 }))
  const problems = []
  if (discover) {
    const f = await findPairs(client, snap.plank, discover, last)
    const want = f.pairs.map((p) => p.pair).sort().join()
    if (want !== pairs.map((p) => p.pair).sort().join()) problems.push(`PLANK pools: file ${pairs.map((p) => p.pair).join(', ') || 'none'}, found ${f.pairs.map((p) => p.pair).join(', ') || 'none'}`)
  }
  const again = await takeSnapshot({
    client, plank: snap.plank, feed: snap.feed, minUsd: snap.minUsd, block: last, blocks: snap.blockCount ?? snap.blocks.length, days: snap.days,
    seed: snap.seed, fromBlock: snap.fromBlock ?? 0, pairs, allowStale: true, log,
  })
  problems.push(...compareSnapshots(snap, again))
  return { ok: problems.length === 0, problems, count: again.count, root: again.root }
}

// Addresses: PLANK and PLANK_USD_FEED from the environment, else from deployments/<chainId>.json (the deploy writes it).
function fromDeployments(chainId) {
  const path = process.env.DEPLOYMENTS_FILE ?? new URL(`../../deployments/${chainId}.json`, import.meta.url)
  if (!existsSync(path)) return {}
  const j = JSON.parse(readFileSync(path, 'utf8'))
  return { plank: j.inputs?.PLANK, feed: j.contracts?.PlankUsdTwap, inputs: j.inputs ?? {} }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]])
    return acc
  }, []))

  if (args.selftest) {
    // Fixed vector, also checked on-chain by contracts/test/cards/Sale.t.sol (test_snapshotScriptRootMatches).
    const wallets = ['0x00000000000000000000000000000000000000A1', '0x00000000000000000000000000000000000000C3', '0x00000000000000000000000000000000000000D4']
    const { root, proofs } = buildTree(wallets)
    for (const w of wallets) if (!verify(proofs[getAddress(w)], root, w)) throw new Error('proof failed for ' + w)
    console.log(JSON.stringify({ root, proofs }, null, 2))
    return
  }

  const rpc = process.env.RPC
  if (!rpc) throw new Error('Set RPC first ($env:RPC = "...")')
  const client = createPublicClient({ transport: http(rpc, { retryCount: 3, timeout: 60_000 }) })
  const chainId = await client.getChainId()
  const dep = fromDeployments(chainId)
  const inp = dep.inputs ?? {}
  const discover = {
    pair: process.env.PLANK_WETH_V2_PAIR ?? inp.PLANK_WETH_V2_PAIR, factory: process.env.UNIV2_FACTORY ?? inp.UNIV2_FACTORY,
    quotes: [inp.WETH, inp.USDG, inp.PAPER], extra: typeof args.pairs === 'string' ? args.pairs.split(',').map((s) => s.trim()) : [],
  }

  if (args.verify) {
    if (args.verify === true) throw new Error('--verify <the snapshot file>')
    const snap = JSON.parse(readFileSync(args.verify, 'utf8'))
    const v = await verifySnapshot({ client, snap, discover, log: (l) => console.log(`  ${l}`) })
    for (const p of v.problems) console.log(`FAIL  ${p}`)
    console.log(v.ok ? `GREEN: rebuilt from the chain at its ${snap.blocks.length} blocks: the same ${v.count} wallets, amounts and root ${v.root}.` : `RED: ${v.problems.length} difference(s). Don't use this file.`)
    process.exitCode = v.ok ? 0 : 1
    return
  }

  // the mainnet PLANK only as a last resort on mainnet itself: any other chain must name its own
  const PLANK = process.env.PLANK ?? dep.plank ?? (chainId === 4663 ? '0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc' : undefined)
  if (!PLANK) throw new Error(`Set PLANK (no PLANK in deployments/${chainId}.json)`)
  const feed = process.env.PLANK_USD_FEED ?? dep.feed
  if (!feed) throw new Error('Set PLANK_USD_FEED (the PlankUsdTwap address), or deploy first (deployments/<chainId>.json)')
  const out = args.out ?? 'holders.json'
  const snap = await takeSnapshot({
    client, plank: PLANK, feed, minUsd: args['min-usd'] ?? 69, block: args.block === undefined || args.block === true ? undefined : BigInt(args.block),
    blocks: args.blocks ?? 5, days: args.days ?? 7, seed: typeof args.seed === 'string' ? args.seed : undefined,
    fromBlock: args['from-block'] ?? 0, step: args.step, discover, allowStale: !!args['allow-stale'], log: console.log,
  })
  if (snap.count === 0) throw new Error('nobody qualifies')
  writeFileSync(out, JSON.stringify(snap, null, 2))
  console.log(`${snap.count} wallets qualify. Root (paste as holderRoot): ${snap.root}`)
  console.log(`Wrote ${out} (with its seed and blocks: node snapshot.mjs --verify ${out} rebuilds it): give it to the site so buyers' proofs load automatically.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
