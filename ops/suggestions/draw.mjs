// The suggestion draw: reads one round of suggestions from FireCredits, keeps one per wallet per kind, merges the same
// idea written differently, and draws a shortlist at random for the owner to pick from. Runs locally; nothing is sent.
//
//   cd ops
//   node suggestions/draw.mjs --rpc <url> [--chain 4663] [--kind look|theme|style|character] [--count 10]
//                             [--round <n>] [--seed <hex>] [--series <n>] [--from-block <n>] [--out draw.json]
//
// --kind look (the first wave) draws themes and art styles, each its own shortlist; character draws characters.
// Without --round it takes the round new suggestions are going into now (FireCredits.currentRound). The seed is
// printed and saved, so the same seed always gives the same shortlist (post it if anyone asks).
//
// Both waves of a Series sit in the same round: a round only moves on when a picking session starts. So:
//   1. the look wave closes: draw it (--kind look), choose the theme and the art style from the 10 drawn per kind and
//      ANNOUNCE them (suggestions/publish.mjs --picks <ids>). Nothing is picked on chain yet.
//   2. the characters wave closes: draw it (--kind character), choose the characters.
//   3. at the Series' drop setup (a configured drop that hasn't started), pick ONCE on chain:
//      FireCredits.pickSuggestions(series, [theme id, style id, character ids...]). That gives the free packs and
//      starts the picking session, which moves new suggestions to the next round.
//   4. only then open the next Series' look wave: anything suggested before step 3 lands in the round that session
//      takes, and can never be picked.
// --series <n> (the Series this draw is for) checks that the round can still be picked for it.
import { createPublicClient, http, parseAbiItem, getAddress } from 'viem'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

/** Invisible characters someone could add to make one idea look like a different one: bidi controls and zero-width
 *  characters. */
const INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g
export const visible = (t) => String(t).replace(INVISIBLE, '')

/** "Theme: X" / "Art style: X" / character lines ("Character: X\nPersonality: ..."): its kind and the text to show. */
export function kindOf(text) {
  const t = visible(text)
  const m = t.match(/^\s*(theme|art style)\s*:\s?([\s\S]*)$/i)
  if (m) return { kind: m[1].toLowerCase() === 'theme' ? 'theme' : 'style', title: m[2].trim() }
  const c = t.match(/^\s*character\s*:\s?(.*)$/im)
  return { kind: 'character', title: (c ? c[1] : t.split('\n')[0]).trim() }
}

/** The same idea written differently: lowercase, no accents, punctuation or articles, single spaces, in any script
 *  ("幽霊" keys as itself). A title of only symbols (e.g. emoji) keys on its own text, so no idea is ever dropped. */
export function sameIdea(title) {
  const t = visible(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  const words = t.replace(/[^\p{L}\p{M}\p{N} ]+/gu, ' ').replace(/(?<![\p{L}\p{N}])(a|an|the)(?![\p{L}\p{N}])/gu, ' ').replace(/\s+/g, ' ').trim()
  return words || t.replace(/\s+/g, ' ').trim()
}

/** One per wallet per kind (its first), then one per idea (the first to suggest it): the entries in the draw. The
 *  others who sent the same idea are listed (alsoBy), but only the first suggester can be credited the free pack. */
export function entries(suggestions) {
  const byWallet = new Set(), byIdea = new Map()
  for (const s of [...suggestions].sort((a, b) => a.id - b.id)) {
    const wk = s.kind + '|' + s.by.toLowerCase()
    if (byWallet.has(wk)) continue
    byWallet.add(wk)
    // every entry stays in: an idea with nothing to compare on (an empty title) is its own
    const key = s.kind + '|' + (sameIdea(s.title) || '#' + s.id)
    const first = byIdea.get(key)
    if (first) { first.alsoBy.push(s.by); continue }
    byIdea.set(key, { ...s, alsoBy: [] })
  }
  return [...byIdea.values()]
}

/** Why this round can't (all) be picked for `series` any more, or null. sessionFire/sessionRound/picks: FireCredits'
 *  sessionFire(), sessionRound() and picksOf(series). */
export function sessionWarning({ series, round, sessionFire, sessionRound, picks }) {
  if (BigInt(sessionFire) !== BigInt(series) || BigInt(picks) === 0n) return null
  if (round !== sessionRound) return `Series ${series}'s picks were already made (from round ${sessionRound}). Round ${round} can no longer be picked for it.`
  return `Series ${series}'s picks were already made (${picks} so far). Only picks left under its cap can still be added.`
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
  if (args.series && args.series !== 'true') {
    // a round can be picked for a Series only before its picking session starts, or as that session's round
    const series = BigInt(args.series)
    const read = (fn, out, a = []) => client.readContract({ address: credits, abi: [parseAbiItem(`function ${fn}(${a.length ? 'uint256' : ''}) view returns (${out})`)], functionName: fn, args: a })
    const [sessionFire, sessionRound, picks] = await Promise.all([read('sessionFire', 'uint256'), read('sessionRound', 'uint32'), read('picksOf', 'uint256', [series])])
    const w = sessionWarning({ series, round, sessionFire, sessionRound: Number(sessionRound), picks })
    if (w) console.warn('WARNING: ' + w)
  }
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
  const result = { chainId, credits, round, kind: args.kind ?? 'look', seed, at: new Date().toISOString(), suggestions: all.length, pools: {}, shortlists: {} }
  console.log(`Round ${round}: ${all.length} suggestions. Seed ${seed}.`)
  for (const kind of kinds) {
    const pool = entries(all.filter((s) => s.kind === kind))
    const picks = draw(pool, seed + ':' + kind, count)
    result.pools[kind] = pool.length
    result.shortlists[kind] = picks.map(({ id, by, title, text, alsoBy }) => ({ id, by, title, text, alsoBy }))
    console.log(`\n${{ theme: 'Themes', style: 'Art styles', character: 'Characters' }[kind]}: ${pool.length} in the draw, ${picks.length} drawn`)
    picks.forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. #${s.id}  ${s.title}${s.alsoBy.length ? `  (+${s.alsoBy.length} more suggested it)` : ''}`))
  }
  const out = args.out ?? `draw-round-${round}-${args.kind ?? 'look'}.json`
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  console.log(`\nSaved ${out}. Announce the picks with suggestions/publish.mjs --picks <ids>. On chain they're picked once, at the
Series' drop setup: FireCredits.pickSuggestions(<series>, [theme, style and character ids]).`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
