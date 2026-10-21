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
// events and fills in the pick transaction for every wave of that Series already in the file. Every pick must be in
// the shortlist. Publishing the same Series and wave again replaces that entry. Then sync and deploy the site
// (web/art/factory/sync_forge.sh).
import { createPublicClient, http, parseAbiItem, getAddress } from 'viem'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const KIND_LABEL = { theme: 'Theme', style: 'Art style', character: 'Character' }
const WAVE_OF = { look: 'look', theme: 'look', style: 'look', character: 'characters' }

/** One wave's results from a draw file (draw.mjs) and the picks: [{ id, by?, tx? }]. Throws if a pick isn't in the
 *  shortlist. `series`: the Series the wave decides. */
export function buildResults(draw, picks, { series, next = '', publishedAt = new Date().toISOString() } = {}) {
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
  const series = Number(args.series)
  let picks, onChain = null
  if (args.picks && args.picks !== 'true') picks = args.picks.split(',').map((x) => ({ id: Number(x.trim().replace(/^#/, '')) }))
  else {
    const rpc = args.rpc ?? process.env.RPC
    if (!rpc) throw new Error('Give --rpc <url> to read the picks from the chain, or --picks <ids>')
    const client = createPublicClient({ transport: http(rpc) })
    const ev = parseAbiItem('event SuggestionPicked(uint256 indexed fire, uint256 indexed id, address indexed by, uint256 credits)')
    const logs = await client.getLogs({ address: draw.credits, event: ev, args: { fire: BigInt(series) }, fromBlock: BigInt(args['from-block'] ?? 0), toBlock: 'latest' })
    onChain = logs.map((l) => ({ id: Number(l.args.id), by: getAddress(l.args.by), tx: l.transactionHash }))
    if (!onChain.length) throw new Error(`No picks on chain for Series ${series} yet (FireCredits.pickSuggestions, at its drop setup). Use --picks to announce them first.`)
    // one on-chain pick covers both waves: this wave's are the ones in its shortlists
    const listed = new Set(Object.values(draw.shortlists ?? {}).flat().map((x) => Number(x.id)))
    picks = onChain.filter((x) => listed.has(x.id))
  }
  const entry = buildResults(draw, picks, { series, next: args.next && args.next !== 'true' ? args.next : '' })
  const out = args.out ?? new URL('../../web/art/factory/forge/suggestions/results.json', import.meta.url).pathname
  const file = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null
  const merged = mergeResults(file, entry)
  if (onChain) fillPickTx(merged, series, onChain)
  for (const k of entry.kinds) console.log(`${k.label}: ${k.shortlist.length} drawn from ${k.pool ?? '?'}; picked ${k.shortlist.filter((s) => s.picked).map((s) => `#${s.id} ${s.title}`).join(', ') || 'none'}`)
  if (args['dry-run']) { console.log(JSON.stringify(entry, null, 2)); return }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(merged, null, 2) + '\n')
  console.log(`\nSaved ${out} (${merged.waves.length} wave${merged.waves.length === 1 ? '' : 's'}). Sync the site: web/art/factory/sync_forge.sh`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
