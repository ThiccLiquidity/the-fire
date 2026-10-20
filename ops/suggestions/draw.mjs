// The suggestion draw: reads one round of suggestions from FireCredits, keeps one per wallet per kind, merges the same
// idea written differently, and draws a shortlist at random for the owner to pick from. Runs locally; nothing is sent.
//
//   cd ops
//   node suggestions/draw.mjs --rpc <url> [--chain 4663] [--kind look|theme|style|character] [--count 10]
//                             [--round <n>] [--seed <hex>] [--from-block <n>] [--out draw.json]
//
// --kind look (the first wave) draws themes and art styles, each its own shortlist; character draws characters.
// Without --round it takes the round new suggestions are going into now (FireCredits.currentRound). The seed is
// printed and saved, so the same seed always gives the same shortlist (post it if anyone asks). Picking the winners
// afterwards is FireCredits.pickSuggestions(series, ids) from the owner (ids are in the output).
import { createPublicClient, http, parseAbiItem, getAddress } from 'viem'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

/** "Theme: X" / "Art style: X" / character lines ("Character: X\nPersonality: ..."): its kind and the text to show. */
export function kindOf(text) {
  const t = String(text).replace(/[؜‎‏‪-‮⁦-⁩]/g, '')
  const m = t.match(/^\s*(theme|art style)\s*:\s?([\s\S]*)$/i)
  if (m) return { kind: m[1].toLowerCase() === 'theme' ? 'theme' : 'style', title: m[2].trim() }
  const c = t.match(/^\s*character\s*:\s?(.*)$/im)
  return { kind: 'character', title: (c ? c[1] : t.split('\n')[0]).trim() }
}

/** The same idea written differently: lowercase, no punctuation or articles, single spaces. */
export function sameIdea(title) {
  return title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(a|an|the)\b/g, ' ').replace(/\s+/g, ' ').trim()
}

/** One per wallet per kind (its first), then one per idea (the first to suggest it): the entries in the draw. */
export function entries(suggestions) {
  const byWallet = new Set(), byIdea = new Map()
  for (const s of [...suggestions].sort((a, b) => a.id - b.id)) {
    const wk = s.kind + '|' + s.by.toLowerCase()
    if (byWallet.has(wk)) continue
    byWallet.add(wk)
    const key = s.kind + '|' + sameIdea(s.title)
    if (!key.endsWith('|')) {
      const first = byIdea.get(key)
      if (first) { first.alsoBy.push(s.by); continue }
      byIdea.set(key, { ...s, alsoBy: [] })
    }
  }
  return [...byIdea.values()]
}

/** A seeded shuffle (SHA-256 counter stream, Fisher-Yates): the first `count` are the shortlist. */
export function draw(list, seedHex, count) {
  const out = [...list]
  let ctr = 0, pool = Buffer.alloc(0)
  const next32 = () => {
    if (pool.length < 4) { pool = Buffer.concat([pool, createHash('sha256').update(seedHex + ':' + ctr++).digest()]) }
    const v = pool.readUInt32BE(0); pool = pool.subarray(4); return v
  }
  for (let i = out.length - 1; i > 0; i--) {
    const lim = Math.floor(0x100000000 / (i + 1)) * (i + 1) // no modulo bias
    let r; do r = next32(); while (r >= lim)
    const j = r % (i + 1);
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out.slice(0, count)
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => {
    if (x.startsWith('--')) a.push([x.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]])
    return a
  }, []))
  const rpc = args.rpc ?? process.env.RPC
  if (!rpc) throw new Error('Give --rpc <url> (or set RPC)')
  const client = createPublicClient({ transport: http(rpc) })
  const chainId = Number(args.chain ?? await client.getChainId())
  const dep = JSON.parse(readFileSync(new URL(`../../deployments/${chainId}.json`, import.meta.url), 'utf8'))
  const credits = dep.contracts?.FireCredits
  if (!credits) throw new Error(`No FireCredits in deployments/${chainId}.json`)
  const kinds = { look: ['theme', 'style'], theme: ['theme'], style: ['style'], character: ['character'] }[args.kind ?? 'look']
  if (!kinds) throw new Error('--kind is look, theme, style or character')
  const count = Number(args.count ?? 10)
  const roundAbi = parseAbiItem('function currentRound() view returns (uint32)')
  const round = Number(args.round ?? await client.readContract({ address: credits, abi: [roundAbi], functionName: 'currentRound' }))
  const ev = parseAbiItem('event Suggested(uint256 indexed id, address indexed by, uint32 indexed round, string text)')
  const latest = await client.getBlockNumber()
  const step = BigInt(args.step ?? 50000)
  const all = []
  for (let b = BigInt(args['from-block'] ?? 0); b <= latest; b += step) {
    const to = b + step - 1n > latest ? latest : b + step - 1n
    const logs = await client.getLogs({ address: credits, event: ev, args: { round }, fromBlock: b, toBlock: to })
    for (const l of logs) all.push({ id: Number(l.args.id), by: getAddress(l.args.by), text: l.args.text, ...kindOf(l.args.text) })
  }
  const seed = args.seed ?? randomBytes(16).toString('hex')
  const result = { chainId, credits, round, seed, at: new Date().toISOString(), shortlists: {} }
  console.log(`Round ${round}: ${all.length} suggestions. Seed ${seed}.`)
  for (const kind of kinds) {
    const pool = entries(all.filter((s) => s.kind === kind))
    const picks = draw(pool, seed + ':' + kind, count)
    result.shortlists[kind] = picks.map(({ id, by, title, text, alsoBy }) => ({ id, by, title, text, alsoBy }))
    console.log(`\n${{ theme: 'Themes', style: 'Art styles', character: 'Characters' }[kind]}: ${pool.length} in the draw, ${picks.length} drawn`)
    picks.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. #${s.id}  ${s.title}${s.alsoBy.length ? `  (+${s.alsoBy.length} more suggested it)` : ''}`))
  }
  const out = args.out ?? `draw-round-${round}-${args.kind ?? 'look'}.json`
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  console.log(`\nSaved ${out}. Pick: FireCredits.pickSuggestions(<series>, [ids]) once the drop is set up.`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
