// Publishes a suggestion wave's results for the site: the shortlist the draw made (draw.mjs), the owner's picks and
// what happens next, into the site's results file (web/art/factory/forge/suggestions/results.json). The site shows
// every wave in that file: the 10 drawn per kind, the winners, the seed anyone can re-run the draw with, and a
// "You won a free pack" for a winner's wallet. Runs locally; nothing is sent.
//
//   cd ops
//   node suggestions/publish.mjs --draw draw-round-3-look.json --series 8 --picks 12,40 [--next "The characters wave is open"]
//   node suggestions/publish.mjs --draw draw-round-3-character.json --series 8 --picks 51,60,72,...
//   node suggestions/publish.mjs --draw draw-round-3-character.json --series 8 --rpc <url>   (after the on-chain pick)
//                                [--out ../web/art/factory/forge/suggestions/results.json] [--dry-run]
//
// --series is the Series the wave decides. The picks are made on chain ONCE per Series, at its drop setup
// (FireCredits.pickSuggestions(series, [theme, style and character ids]): the free packs are given then). The theme and
// the art style are announced before that, straight after the look wave, with --picks (the ids you chose from the
// shortlist). After the on-chain pick, publish again with --rpc: it reads the picks from FireCredits' SuggestionPicked
// events and fills in the pick transaction for every wave of that Series already in the file. A pick announced with
// --picks must be in the shortlist. An on-chain pick of this wave's kinds that isn't on the shortlist is printed as a
// loud WARNING and still published, marked offList (the site shows what the chain did). Publishing the same Series
// and wave again replaces that entry. The draw's closing block, drand round and signature go into the results file, so
// anyone can re-run it (draw.mjs --verify). A test draw (draw.mjs --seed) is refused unless --allow-test-draw. Then
// commit and push it: the site's build syncs it (web/package.json prebuild runs sync_forge.sh; nothing to run by hand).
import { createPublicClient, http, parseAbiItem, getAddress } from 'viem'
import { kindOf, checkDrawSource, checkSavedRound, deploymentsOf } from './draw.mjs'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { requirePatchedNode } from '../keeper/src/node-check.mjs'

export const KIND_LABEL = { theme: 'Theme', style: 'Art style', character: 'Character' }
const WAVE_OF = { look: 'look', theme: 'look', style: 'look', character: 'characters' }

/** One wave's results from a draw file (draw.mjs) and the picks: [{ id, by?, tx? }]. Throws if a pick isn't in the
 *  shortlist. `offList`: on-chain picks of this wave's kinds that aren't on the shortlist ([{ id, kind, by, title, text,
 *  tx }]): published as winners marked offList. `series`: the Series the wave decides. */
export function buildResults(draw, picks, { series, next = '', publishedAt = new Date().toISOString(), offList = [] } = {}) {
  if (!Number.isInteger(series) || series < 1) throw new Error('--series: the Series this wave decides (a whole number)')
  const kinds = Object.keys(draw.shortlists ?? {})
  if (!kinds.length) throw new Error('The draw file has no shortlists')
  const byId = new Map(picks.map((p) => [Number(p.id), p]))
  const listed = new Set(kinds.flatMap((k) => draw.shortlists[k].map((s) => Number(s.id))))
  const outside = [...byId.keys()].filter((id) => !listed.has(id))
  if (outside.length) throw new Error(`Picked but not in the shortlist: #${outside.join(', #')}. Picks come from the 10 drawn per kind.`)
  const out = {
    series, wave: WAVE_OF[draw.kind ?? kinds[0]] ?? 'look', round: draw.round, chainId: draw.chainId, credits: draw.credits,
    seed: draw.seed, drawnAt: draw.at, publishedAt, next, suggestions: draw.suggestions ?? null,
    fromBlock: draw.fromBlock ?? null, toBlock: draw.toBlock ?? null, toBlockHash: draw.toBlockHash ?? null,
    drand: draw.drand ? { chain: draw.drand.chain, round: draw.drand.round, randomness: draw.drand.randomness, signature: draw.drand.signature } : null,
    ...(draw.test ? { test: true } : {}),
    kinds: kinds.map((kind) => ({
      kind, label: KIND_LABEL[kind] ?? kind, pool: draw.pools?.[kind] ?? null,
      shortlist: draw.shortlists[kind].map((s) => ({
        id: Number(s.id), by: s.by, title: s.title, text: s.text, alsoBy: s.alsoBy ?? [], picked: byId.has(Number(s.id)),
      })),
    })),
    winners: [],
  }
  for (const k of out.kinds) for (const s of k.shortlist) if (s.picked) {
    const p = byId.get(s.id)
    out.winners.push({ kind: k.kind, id: s.id, by: s.by, title: s.title, text: s.text, tx: p.tx ?? null })
  }
  for (const o of offList) {
    out.winners.push({ kind: o.kind, id: Number(o.id), by: o.by, title: o.title ?? null, text: o.text ?? null, tx: o.tx ?? null, offList: true })
  }
  if (offList.length) out.offList = offList.map((o) => Number(o.id))
  return out
}

/** On-chain picks not on the shortlist that are of this draw's kinds (`text`: id -> its Suggested text; a pick whose
 *  text wasn't found counts as this wave's, to be safe). Picks of the other wave's kinds are that wave's. */
export function offListPicks(draw, rest, text) {
  const kinds = new Set(Object.keys(draw.shortlists ?? {}))
  const out = []
  for (const x of rest) {
    const t = text.get(Number(x.id))
    const k = t === undefined ? null : kindOf(t)
    if (k && !kinds.has(k.kind)) continue
    out.push({ id: Number(x.id), kind: k?.kind ?? [...kinds][0], by: x.by, title: k?.title ?? null, text: t ?? null, tx: x.tx })
  }
  return out
}

/** Fills in the on-chain pick transaction (picks: [{ id, tx }]) for the winners of every wave of `series`. */
export function fillPickTx(file, series, picks) {
  const tx = new Map(picks.map((p) => [Number(p.id), p.tx]))
  for (const w of file.waves) if (w.series === series) for (const x of w.winners) if (tx.has(x.id)) x.tx = tx.get(x.id)
  return file
}

/** The results file with this wave added, or replacing the same Series and wave; oldest first. */
export function mergeResults(file, entry) {
  const waves = (file?.waves ?? []).filter((w) => !(w.series === entry.series && w.wave === entry.wave))
  waves.push(entry)
  waves.sort((a, b) => a.series - b.series || (a.wave === b.wave ? 0 : a.wave === 'look' ? -1 : 1))
  return { version: 1, waves }
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => {
    if (x.startsWith('--')) a.push([x.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]])
    return a
  }, []))
  if (!args.draw) throw new Error('Give --draw <the file draw.mjs saved>')
  const draw = JSON.parse(readFileSync(args.draw, 'utf8'))
  if (draw.test && !args['allow-test-draw']) throw new Error(`${args.draw} is a TEST draw (draw.mjs --seed), not a real one. Draw again with --to-block (and the announced drand round), or --allow-test-draw for a test site.`)
  if (!draw.test && !draw.drand) console.warn('WARNING: this draw has no drand round and closing block (made before they were required): nobody can check it was fair.')
  // a hand-edited file doesn't publish: its seed must be its drand round's, and its FireCredits the deployments file's
  const bad = [...(draw.drand ? checkSavedRound(draw) : []), ...checkDrawSource(draw, { credits: deploymentsOf(draw.chainId).contracts.FireCredits })]
  if (bad.length) throw new Error(`${args.draw} doesn't check out: ${bad.join('; ')}. Run draw.mjs --verify on it.`)
  const series = Number(args.series)
  let picks, onChain = null, offList = []
  if (args.picks && args.picks !== 'true') picks = args.picks.split(',').map((x) => ({ id: Number(x.trim().replace(/^#/, '')) }))
  else {
    const rpc = args.rpc ?? process.env.RPC
    if (!rpc) throw new Error('Give --rpc <url> to read the picks from the chain, or --picks <ids>')
    const client = createPublicClient({ transport: http(rpc) })
    const ev = parseAbiItem('event SuggestionPicked(uint256 indexed fire, uint256 indexed id, address indexed by, uint256 credits)')
    const logs = await client.getLogs({ address: draw.credits, event: ev, args: { fire: BigInt(series) }, fromBlock: BigInt(args['from-block'] ?? 0), toBlock: 'latest' })
    onChain = logs.map((l) => ({ id: Number(l.args.id), by: getAddress(l.args.by), tx: l.transactionHash }))
    if (!onChain.length) throw new Error(`No picks on chain for Series ${series} yet (FireCredits.pickSuggestions, at its drop setup). Use --picks to announce them first.`)
    // one on-chain pick covers both waves: this wave's are the ones in its shortlists, and any other pick of this
    // wave's kinds (read from its Suggested event) was picked from outside the shortlist
    const listed = new Set(Object.values(draw.shortlists ?? {}).flat().map((x) => Number(x.id)))
    picks = onChain.filter((x) => listed.has(x.id))
    const rest = onChain.filter((x) => !listed.has(x.id))
    if (rest.length) {
      const sug = parseAbiItem('event Suggested(uint256 indexed id, address indexed by, uint32 indexed round, string text)')
      const logs = await client.getLogs({ address: draw.credits, event: sug, args: { id: rest.map((x) => BigInt(x.id)) }, fromBlock: BigInt(args['from-block'] ?? 0), toBlock: 'latest' })
      const text = new Map(logs.map((l) => [Number(l.args.id), l.args.text]))
      offList = offListPicks(draw, rest, text)
      if (offList.length) {
        console.warn(`\n*** WARNING: ${offList.length} on-chain pick(s) of this wave are NOT on the drawn shortlist:`)
        for (const o of offList) console.warn(`***   #${o.id} (${KIND_LABEL[o.kind] ?? o.kind}) by ${o.by}: ${o.title ?? '(text not found)'}  tx ${o.tx}`)
        console.warn('*** They are published anyway, marked offList: the site shows what was picked on chain.\n')
      }
    }
  }
  const entry = buildResults(draw, picks, { series, next: args.next && args.next !== 'true' ? args.next : '', offList })
  const out = args.out ?? new URL('../../web/art/factory/forge/suggestions/results.json', import.meta.url).pathname
  const file = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null
  const merged = mergeResults(file, entry)
  if (onChain) fillPickTx(merged, series, onChain)
  for (const k of entry.kinds) console.log(`${k.label}: ${k.shortlist.length} drawn from ${k.pool ?? '?'}; picked ${k.shortlist.filter((s) => s.picked).map((s) => `#${s.id} ${s.title}`).join(', ') || 'none'}`)
  if (args['dry-run']) { console.log(JSON.stringify(entry, null, 2)); return }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(merged, null, 2) + '\n')
  console.log(`\nSaved ${out} (${merged.waves.length} wave${merged.waves.length === 1 ? '' : 's'}). Commit and push it: the site's build syncs it (no script to run).`)
}

// reads an RPC: not on a Node with the Brotli bug (CVE-2026-111497)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) { requirePatchedNode(); await main() }
