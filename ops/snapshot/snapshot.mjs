// Takes the secret PLANK-holder snapshot for a drop's holder window (docs/omni-economy.md).
//
//   $env:RPC = "https://rpc.mainnet.chain.robinhood.com"     (PowerShell)
//   node snapshot.mjs --min-usd 69 --out fire-7-holders.json
//
// It lists every regular wallet (not a contract) that holds at least $69 of PLANK right now, priced with the same
// 30-minute PLANK average the sale uses (PlankUsdTwap), builds the Merkle tree, checks every proof, and writes a file
// for the site. The one value you need is the "root": paste it as holderRoot when you set up the drop.
// Run it at a moment nobody knows in advance, before the drop is set up.
// It refuses a PLANK price older than 2 hours (FireSale wouldn't take it either) unless --allow-stale.
import { createPublicClient, http, parseAbiItem, formatUnits, getAddress } from 'viem'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { buildTree, verify } from './merkle.mjs'

// Addresses: PLANK and PLANK_USD_FEED from the environment, else from deployments/<chainId>.json (the deploy writes it).
function fromDeployments(chainId) {
  const path = process.env.DEPLOYMENTS_FILE ?? new URL(`../../deployments/${chainId}.json`, import.meta.url)
  if (!existsSync(path)) return {}
  const j = JSON.parse(readFileSync(path, 'utf8'))
  return { plank: j.inputs?.PLANK, feed: j.contracts?.PlankUsdTwap }
}
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
  process.exit(0)
}

const rpc = process.env.RPC
if (!rpc) throw new Error('Set RPC first ($env:RPC = "...")')
const client = createPublicClient({ transport: http(rpc) })
const dep = fromDeployments(await client.getChainId())
const MAX_AGE = 2n * 3600n // FireSale's limit on the PLANK price's age and on its window
const chainId = await client.getChainId()
// the mainnet PLANK only as a last resort on mainnet itself: any other chain must name its own
const PLANK = process.env.PLANK ?? dep.plank ?? (chainId === 4663 ? '0x69420eaf0eBF43E08F621B014f25cEfDfA7e2DDc' : undefined)
if (!PLANK) throw new Error(`Set PLANK (no PLANK in deployments/${chainId}.json)`)
const feed = process.env.PLANK_USD_FEED ?? dep.feed
if (!feed) throw new Error('Set PLANK_USD_FEED (the PlankUsdTwap address), or deploy first (deployments/<chainId>.json)')
const minUsd = Number(args['min-usd'] ?? 69)
const fromBlock = BigInt(args['from-block'] ?? 0)
const out = args.out ?? 'holders.json'

const block = await client.getBlockNumber()
const { timestamp: now } = await client.getBlock({ blockNumber: block })
const twapAbi = [parseAbiItem('function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'), parseAbiItem('function prev() view returns (uint256,uint32)')]
const [, px, , updatedAt] = await client.readContract({ address: feed, abi: twapAbi, functionName: 'latestRoundData', blockNumber: block })
if (px <= 0n) throw new Error('PLANK price feed has no price')
const age = now - updatedAt
const prev = await client.readContract({ address: feed, abi: twapAbi, functionName: 'prev', blockNumber: block }).catch(() => undefined)
const window = prev ? updatedAt - BigInt(prev[1]) : 0n
if ((age > MAX_AGE || window > MAX_AGE) && !args['allow-stale']) {
  throw new Error(`PLANK price is ${age / 60n} min old over a ${window / 60n} min window (the sale takes 2 h at most): checkpoint PlankUsdTwap (the keeper), wait for the next window, then run this again (or --allow-stale)`)
}
// PLANK wei worth minUsd: usd * 1e18 (wei per PLANK) * 1e18 (feed decimals) / px
const minPlank = (BigInt(Math.round(minUsd * 100)) * 10n ** 34n) / px
console.log(`Block ${block}. PLANK $${formatUnits(px, 18)}. Minimum ${formatUnits(minPlank, 18)} PLANK ($${minUsd}).`)

// Everyone who ever received PLANK, from Transfer logs (in chunks), then their balances at the snapshot block.
const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
const seen = new Set()
const step = BigInt(args.step ?? 50000)
for (let b = fromBlock; b <= block; b += step) {
  const to = b + step - 1n > block ? block : b + step - 1n
  const logs = await client.getLogs({ address: PLANK, event: transfer, fromBlock: b, toBlock: to })
  for (const l of logs) seen.add(getAddress(l.args.to))
}
const balanceOf = parseAbiItem('function balanceOf(address) view returns (uint256)')
const holders = []
for (const w of seen) {
  const bal = await client.readContract({ address: PLANK, abi: [balanceOf], functionName: 'balanceOf', args: [w], blockNumber: block })
  if (bal < minPlank) continue
  const code = await client.getCode({ address: w, blockNumber: block })
  if (code && code !== '0x') continue // contracts can't buy during the limited phase anyway (pools, lockers)
  holders.push({ wallet: w, plank: bal.toString() })
}
if (holders.length === 0) throw new Error('nobody qualifies')
const { root, proofs } = buildTree(holders.map((h) => h.wallet))
for (const h of holders) if (!verify(proofs[h.wallet], root, h.wallet)) throw new Error('proof failed for ' + h.wallet)
writeFileSync(out, JSON.stringify({ root, block: block.toString(), minUsd, minPlank: minPlank.toString(), plankUsd: px.toString(), count: holders.length, holders, proofs }, null, 2))
console.log(`${holders.length} wallets qualify. Root (paste as holderRoot): ${root}`)
console.log(`Wrote ${out}: give it to the site so buyers' proofs load automatically.`)
