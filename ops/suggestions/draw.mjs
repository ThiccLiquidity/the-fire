// The suggestion draw: reads one round of suggestions from FireCredits, keeps one per wallet per kind, merges the same
// idea written differently, and draws a shortlist at random for the owner to pick from. Runs locally; nothing is sent.
//
//   cd ops
//   node suggestions/draw.mjs --rpc <url> --to-block <n> [--drand-round <r>] [--kind look|theme|style|character]
//                             [--count 10] [--round <n>] [--series <n>] [--from-block <n>] [--out draw.json]
//   node suggestions/draw.mjs --rpc <url> --verify draw-round-3-look.json      (anyone: re-runs a published draw)
//                             [--expect-to-block <n>] [--expect-round <drand round>]   (as announced with the wave)
//   node suggestions/draw.mjs --rpc <url> --plan --close "2026-11-08 18:00"    (what to announce when a wave opens)
//
// A fair draw needs two things fixed before anyone can know the result, both announced when the wave opens:
//   - the closing block (--to-block): only suggestions mined up to it are in. The draw refuses to run before that block
//     is final, and saves it (with its hash and time) and the block it read from (--from-block, default 0).
//   - the drand round (--drand-round): a drand quicknet round that comes out after the closing block. Its randomness
//     (sha256 of drand's BLS signature, checked against quicknet's public key: beacon.mjs) is the seed. Without
//     --drand-round it takes the first round after the closing block's time + --drand-margin seconds (default 60).
//     The round, its randomness and its signature are saved, so anyone can check them and re-run the draw (--verify).
// --plan --close "<local time>" estimates the closing block from the chain's recent block time and gives a drand round
// an hour after it: announce both with the wave.
// --seed <hex> is for tests and dry runs only: the file is marked test (not a real draw), and publish.mjs refuses it.
// --kind look (the first wave) draws themes and art styles, each its own shortlist; character draws characters.
// Without --round it takes the round new suggestions are going into now (FireCredits.currentRound).
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
import { createHash } from 'node:crypto'
import { fetchRound, firstRoundAfter, roundTime, verifyRound, randomnessOf, QUICKNET } from './beacon.mjs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { requirePatchedNode } from '../keeper/src/node-check.mjs'

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

const KINDS = { look: ['theme', 'style'], theme: ['theme'], style: ['style'], character: ['character'] }
const LABEL = { theme: 'Themes', style: 'Art styles', character: 'Characters' }
const suggestedEv = parseAbiItem('event Suggested(uint256 indexed id, address indexed by, uint32 indexed round, string text)')
const iso = (ts) => new Date(Number(ts) * 1000).toISOString().replace('.000Z', 'Z')

/** Every suggestion of `round` mined in [fromBlock, toBlock], in chunks of `step` blocks. */
export async function readSuggestions(client, credits, round, fromBlock, toBlock, step = 50000n) {
  const all = []
  for (let b = BigInt(fromBlock); b <= BigInt(toBlock); b += step) {
    const to = b + step - 1n > BigInt(toBlock) ? BigInt(toBlock) : b + step - 1n
    const logs = await client.getLogs({ address: credits, event: suggestedEv, args: { round }, fromBlock: b, toBlock: to })
    for (const l of logs) all.push({ id: Number(l.args.id), by: getAddress(l.args.by), text: l.args.text, ...kindOf(l.args.text), block: l.blockNumber })
  }
  return all
}

/** The draw itself: per kind, the entries in it (ids) and the first `count` of the seeded shuffle. */
export function runDraw(all, kinds, seed, count) {
  const out = { pools: {}, entryIds: {}, shortlists: {} }
  for (const kind of kinds) {
    const pool = entries(all.filter((s) => s.kind === kind))
    out.pools[kind] = pool.length
    out.entryIds[kind] = pool.map((s) => s.id)
    out.shortlists[kind] = draw(pool, seed + ':' + kind, count).map(({ id, by, title, text, alsoBy }) => ({ id, by, title, text, alsoBy }))
  }
  return out
}

/** What differs between a saved draw and the same draw run again from the chain and drand (empty: the same). */
export function compareDraws(saved, again) {
  const p = []
  if (saved.suggestions != null && again.suggestions != null && saved.suggestions !== again.suggestions) p.push(`suggestions read: file ${saved.suggestions}, chain ${again.suggestions}`)
  for (const k of new Set([...Object.keys(saved.shortlists ?? {}), ...Object.keys(again.shortlists ?? {})])) {
    if (saved.pools?.[k] !== again.pools?.[k]) p.push(`${k}: ${saved.pools?.[k]} in the draw in the file, ${again.pools?.[k]} again`)
    const a = (saved.shortlists?.[k] ?? []).map((s) => Number(s.id))
    const b = (again.shortlists?.[k] ?? []).map((s) => Number(s.id))
    if (a.join() !== b.join()) p.push(`${k} shortlist: file #${a.join(', #')}; again #${b.join(', #')}`)
  }
  return p
}

/** The drand round that seeds a draw: the announced one (it must come out after the closing block, or its number
 *  could have been known while entries were open), else the first round after the close + `margin` seconds. */
export function drawRound({ closeTs, announced, margin = 60 }) {
  if (announced !== undefined) {
    const r = BigInt(announced)
    if (roundTime(r) <= BigInt(closeTs)) throw new Error(`drand round ${r} came out at ${iso(roundTime(r))}, not after the closing block (${iso(closeTs)}): use a later round`)
    return r
  }
  return firstRoundAfter(BigInt(closeTs) + BigInt(margin))
}

/** The newest block the RPC calls final; without the 'finalized' tag, 64 blocks behind the latest. */
export async function finalBlock(client) {
  try { return (await client.getBlock({ blockTag: 'finalized' })).number } catch { return (await client.getBlockNumber()) - 64n }
}

/** A saved draw's own seed is its drand round's (signature verified, randomness = sha256(signature)). */
export function checkSavedRound(saved) {
  const p = []
  const d = saved.drand
  if (!verifyRound(d.round, d.signature)) p.push(`the saved signature isn't drand quicknet's for round ${d.round}`)
  if (randomnessOf(d.signature) !== String(d.randomness).toLowerCase()) p.push('the saved randomness isn\'t sha256(signature)')
  if (String(saved.seed).toLowerCase() !== String(d.randomness).toLowerCase()) p.push('the seed isn\'t the round\'s randomness')
  if (saved.toBlockTime !== undefined && roundTime(d.round) <= BigInt(saved.toBlockTime)) p.push(`round ${d.round} came out before the closing block`)
  return p
}

const sameAddress = (a, b) => { try { return getAddress(String(a)) === getAddress(String(b)) } catch { return false } }

/** Checks a saved draw against what the file can't vouch for itself: its FireCredits is the deployments file's
 *  (`credits`), no suggestion of its round was mined before its fromBlock (`early`: those, read from the deploy block),
 *  and, when given, its closing block and drand round are the ones announced with the wave. */
export function checkDrawSource(saved, { credits, early = [], expectToBlock, expectRound } = {}) {
  const p = []
  if (!sameAddress(saved.credits, credits)) p.push(`FireCredits: file ${saved.credits}, deployments file ${credits ?? 'none'}`)
  if (early.length) p.push(`${early.length} suggestion(s) of round ${saved.round} were mined before the draw's fromBlock ${saved.fromBlock} and left out (first #${early[0].id})`)
  if (expectToBlock !== undefined && String(saved.toBlock) !== String(BigInt(expectToBlock))) p.push(`closing block: file ${saved.toBlock}, announced ${expectToBlock}`)
  if (expectRound !== undefined && String(saved.drand?.round) !== String(BigInt(expectRound))) p.push(`drand round: file ${saved.drand?.round}, announced ${expectRound}`)
  return p
}

/** deployments/<chainId>.json (DEPLOYMENTS_FILE points it at another file: rehearsals, like every other tool). */
export function deploymentsOf(chainId) {
  const depFile = process.env.DEPLOYMENTS_FILE || fileURLToPath(new URL(`../../deployments/${chainId}.json`, import.meta.url))
  const dep = JSON.parse(readFileSync(depFile, 'utf8'))
  if (!dep.contracts?.FireCredits) throw new Error(`No FireCredits in ${depFile}`)
  return dep
}

async function verifyDraw(client, file, expect = {}) {
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  if (saved.test) throw new Error(`${file} is a test draw (--seed), not a real one: nothing to verify`)
  if (!saved.drand || saved.toBlock === undefined) throw new Error(`${file} has no closing block and drand round (made before they were required): it can't be verified`)
  const problems = []
  const chainId = await client.getChainId()
  if (chainId !== saved.chainId) throw new Error(`the RPC is chain ${chainId}; the draw was on ${saved.chainId}`)
  const close = await client.getBlock({ blockNumber: BigInt(saved.toBlock) })
  if (saved.toBlockHash && close.hash !== saved.toBlockHash) problems.push(`closing block ${saved.toBlock}: hash ${close.hash} on chain, ${saved.toBlockHash} in the file`)
  problems.push(...checkSavedRound({ ...saved, toBlockTime: Number(close.timestamp) }))
  const beacon = await fetchRound(saved.drand.round)
  if (beacon.signature !== String(saved.drand.signature).toLowerCase()) problems.push(`drand's signature for round ${saved.drand.round} isn't the saved one`)
  console.log(`Closing block ${saved.toBlock} (${iso(close.timestamp)}), drand quicknet round ${saved.drand.round} (${iso(roundTime(saved.drand.round))}) from ${beacon.relay}: randomness ${beacon.randomness}`)
  // from the deploy block, whatever the file says: suggestions of the round before its fromBlock would be left out
  const dep = deploymentsOf(chainId)
  const credits = getAddress(dep.contracts.FireCredits)
  const from = BigInt(saved.fromBlock ?? 0), start = BigInt(dep.startBlock ?? 0)
  const read = await readSuggestions(client, credits, saved.round, start < from ? start : from, BigInt(saved.toBlock))
  const all = read.filter((s) => !(s.block < from))
  problems.push(...checkDrawSource(saved, { credits, early: read.filter((s) => s.block < from), ...expect }))
  const again = runDraw(all, Object.keys(saved.shortlists), beacon.randomness, Number(saved.count ?? 10))
  problems.push(...compareDraws(saved, { ...again, suggestions: all.length }))
  for (const p of problems) console.log(`FAIL  ${p}`)
  console.log(problems.length ? `RED: the draw in ${file} doesn't re-run the same (${problems.length} difference(s)).` : `GREEN: ${all.length} suggestions up to block ${saved.toBlock}, the same entries and the same shortlist${Object.keys(again.shortlists).length > 1 ? 's' : ''}.`)
  process.exitCode = problems.length ? 1 : 0
}

async function plan(client, args) {
  if (!args.close || args.close === 'true') throw new Error('--plan --close "YYYY-MM-DD HH:MM" (your local time, when the wave closes)')
  const { parseStart } = await import('../series/launch.mjs')
  const closeTs = parseStart(args.close)
  const latest = await client.getBlock()
  const back = await client.getBlock({ blockNumber: latest.number > 20000n ? latest.number - 20000n : 0n })
  const perBlock = latest.number > back.number ? Number(latest.timestamp - back.timestamp) / Number(latest.number - back.number) : 1
  if (closeTs <= latest.timestamp) throw new Error('--close is in the past')
  const block = latest.number + BigInt(Math.ceil(Number(closeTs - latest.timestamp) / (perBlock || 1)))
  const round = firstRoundAfter(closeTs + 3600n)
  console.log(`Blocks lately: one every ${perBlock.toFixed(2)} s. Announce with the wave:
  The wave closes at block ${block} (about ${iso(closeTs)}): suggestions mined up to it are in.
  The draw's seed is drand quicknet round ${round} (out at ${iso(roundTime(round))}, an hour after the close):
  https://api.drand.sh/${QUICKNET.chain}/public/${round}
Then, once block ${block} is final and the round is out:
  node suggestions/draw.mjs --rpc <url> --kind <look|character> --to-block ${block} --drand-round ${round}
(If the chain slows down so much that block ${block} comes after the round, the draw refuses: announce a new round.)`)
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => {
    if (x.startsWith('--')) a.push([x.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]])
    return a
  }, []))
  const rpc = args.rpc ?? process.env.RPC
  if (!rpc) throw new Error('Give --rpc <url> (or set RPC)')
  const client = createPublicClient({ transport: http(rpc) })
  if (args.plan) return plan(client, args)
  if (args.verify) {
    if (args.verify === 'true') throw new Error('--verify <the draw file>')
    // the closing block and drand round announced with the wave, when the checker has them
    const given = (k) => (args[k] !== undefined && args[k] !== 'true' ? args[k] : undefined)
    return verifyDraw(client, args.verify, { expectToBlock: given('expect-to-block'), expectRound: given('expect-round') })
  }
  const chainId = Number(args.chain ?? await client.getChainId())
  const credits = deploymentsOf(chainId).contracts.FireCredits
  const kinds = KINDS[args.kind ?? 'look']
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

  // the closing block and the seed
  const test = args.seed !== undefined && args.seed !== 'true'
  const hasTo = args['to-block'] !== undefined && args['to-block'] !== 'true'
  if (!test && !hasTo) throw new Error('Give --to-block <n>: the closing block announced when the wave opened (--plan helps pick it). --seed <hex> is for test runs only.')
  const latest = await client.getBlockNumber()
  const toBlock = hasTo ? BigInt(args['to-block']) : latest
  if (toBlock > latest) throw new Error(`The closing block ${toBlock} isn't mined yet (latest ${latest}). The wave is still open.`)
  if (!test) {
    const fin = await finalBlock(client)
    if (fin < toBlock) throw new Error(`The closing block ${toBlock} isn't final yet (final: ${fin}, latest: ${latest}). Run again once it is.`)
  }
  const close = await client.getBlock({ blockNumber: toBlock })
  const fromBlock = BigInt(args['from-block'] ?? 0)
  let seed, drand = null
  if (test) {
    seed = args.seed
    console.warn(`\n*** TEST DRAW: --seed ${seed} was given by hand. This is NOT a real draw: whoever runs it chooses the seed.
*** The file is marked test and publish.mjs refuses it. A real draw: --to-block <n> [--drand-round <r>].\n`)
  } else {
    const r = drawRound({ closeTs: close.timestamp, announced: args['drand-round'] === 'true' ? undefined : args['drand-round'], margin: args['drand-margin'] ?? 60 })
    const at = roundTime(r)
    const now = BigInt(Math.floor(Date.now() / 1000))
    if (now < at) throw new Error(`drand quicknet round ${r} comes out at ${iso(at)} (in ${at - now} s). Run again after that.`)
    drand = await fetchRound(r)
    seed = drand.randomness
  }
  const all = await readSuggestions(client, credits, round, fromBlock, toBlock, BigInt(args.step ?? 50000))
  const d = runDraw(all, kinds, seed, count)
  const result = {
    chainId, credits, round, kind: args.kind ?? 'look', fromBlock: String(fromBlock), toBlock: String(toBlock), toBlockHash: close.hash,
    toBlockTime: Number(close.timestamp), seed, seedSource: test ? 'manual --seed: a TEST draw, not a real one' : `drand quicknet round ${drand.round}`,
    ...(test ? { test: true } : { drand }), count, at: new Date().toISOString(), suggestions: all.length, pools: d.pools, entryIds: d.entryIds, shortlists: d.shortlists,
  }
  console.log(`Round ${round}: ${all.length} suggestions in blocks ${fromBlock}-${toBlock} (closed ${iso(close.timestamp)}). Seed ${seed}${drand ? ` (drand quicknet round ${drand.round}, signature checked, from ${drand.relay})` : ' (TEST)'}.`)
  for (const kind of kinds) {
    console.log(`\n${LABEL[kind]}: ${d.pools[kind]} in the draw, ${d.shortlists[kind].length} drawn`)
    d.shortlists[kind].forEach((s, i) => console.log(`  ${String(i + 1).padStart(2)}. #${s.id}  ${s.title}${s.alsoBy.length ? `  (+${s.alsoBy.length} more suggested it)` : ''}`))
  }
  const out = args.out ?? `draw-round-${round}-${args.kind ?? 'look'}${test ? '-TEST' : ''}.json`
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  console.log(`\nSaved ${out}. Anyone can re-run it: node suggestions/draw.mjs --rpc <url> --verify ${out}
Announce the picks with suggestions/publish.mjs --picks <ids>. On chain they're picked once, at the
Series' drop setup: FireCredits.pickSuggestions(<series>, [theme, style and character ids]).`)
}

// reads RPCs (and drand relays): not on a Node with the Brotli bug (CVE-2026-111497)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) { requirePatchedNode(); await main() }
