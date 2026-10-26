import { useMemo, useState } from 'react'
import { Notice, useAction } from '../components'
import { updateFire } from '../store'
import type { FireRecord } from '../types'
import { checkDraw, commandOr, kindsOf, pickCommand, publishCommand, roundTime, shortAddr, verifyCommand, type DrawEntry, type DrawFile, type DrawKind } from '../suggestDraw'

const LABEL: Record<DrawKind, string> = { theme: 'Themes', style: 'Art styles', character: 'Characters' }
type Wave = 'look' | 'character'

/** Suggestions: load a wave's fair draw (ops/suggestions/draw.mjs), pick from its shortlist by clicking, then copy the
 *  command that announces the picks (publish.mjs) and, once per Series, the Ledger transaction that marks them picked
 *  (FireCredits.pickSuggestions: the authors' free packs). Nothing here touches the chain. */
export function Suggestions({ fire }: { fire: FireRecord }) {
  const [busy, error, run] = useAction()
  const [copied, setCopied] = useState('')
  const sg = fire.suggest ?? {}
  const need = (fire.deal?.characterIds ?? fire.characterIds ?? []).length || 3
  const waves = useMemo(() => (['look', 'character'] as Wave[]).map((w) => {
    const f = sg[w]; if (!f) return null
    const d = f.draw as DrawFile
    return { wave: w, file: f.file, d, problems: checkDraw(d) }
  }).filter((x): x is NonNullable<typeof x> => !!x), [sg])
  const look = waves.find((w) => w.wave === 'look'), chars = waves.find((w) => w.wave === 'character')
  const save = (patch: Partial<NonNullable<FireRecord['suggest']>>) => updateFire(fire.number, { suggest: { ...sg, ...patch } })

  const load = (file: File | undefined) => run(async () => {
    if (!file) return
    let d: DrawFile
    try { d = JSON.parse(await file.text()) } catch { throw new Error(`${file.name} isn't a draw file (not JSON).`) }
    if (!d?.shortlists) throw new Error(`${file.name} isn't a draw file (ops/suggestions/draw.mjs makes them).`)
    const wave: Wave = d.kind === 'character' ? 'character' : 'look'
    // a new draw for a wave replaces its picks
    await save(wave === 'look' ? { look: { file: file.name, draw: d }, theme: undefined, style: undefined } : { character: { file: file.name, draw: d }, characters: [] })
  })
  const toggle = (kind: DrawKind, id: number) => run(async () => {
    if (kind === 'theme') await save({ theme: sg.theme === id ? undefined : id })
    else if (kind === 'style') await save({ style: sg.style === id ? undefined : id })
    else {
      const cur = sg.characters ?? []
      await save({ characters: cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= need ? cur : [...cur, id] })
    }
  })
  const copy = (key: string, text: string) => run(async () => { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500) })

  const picked = (kind: DrawKind, id: number) => (kind === 'theme' ? sg.theme === id : kind === 'style' ? sg.style === id : (sg.characters ?? []).includes(id))
  const entry = (w: typeof look, kind: DrawKind, id?: number): DrawEntry | undefined => (id == null ? undefined : w?.d.shortlists[kind]?.find((e) => e.id === id))
  const lookIds = [sg.theme, sg.style].filter((x): x is number => x != null)
  const charIds = sg.characters ?? []
  const allIds = [...lookIds, ...charIds]
  const ready = lookIds.length === 2 && charIds.length === need && waves.every((w) => !w.problems.length)
  const chainId = (look ?? chars)?.d.chainId ?? 46630

  /** A command to copy, or the reason there isn't one (an unsafe file name or a number that isn't whole). */
  const command = (key: string, testId: string, label: string, make: () => string) => {
    const c = commandOr(make)
    return c.error !== undefined
      ? <p className="warn-text small" data-testid={`${testId}-error`}>{c.error}</p>
      : <><pre data-testid={testId}>{c.cmd}</pre>
        <button onClick={() => copy(key, c.cmd)}>{copied === key ? 'Copied' : label}</button></>
  }

  const step = (n: number, label: string, done: boolean, on: boolean) => (
    <span className={`sg-step${done ? ' done' : on ? ' on' : ''}`}>{n} {label}{done ? ' ✓' : ''}</span>
  )
  return (
    <section className="suggestions">
      <h2>Suggestions · Series {fire.number}</h2>
      <p className="muted">Pick the theme, the art style and the characters from the ideas the fair draw shortlisted. Their authors get a free pack.</p>
      <div className="row wrap sg-steps">
        {step(1, 'Load the draw', !!look, !look)}
        {step(2, 'Pick', ready, !!look && !ready)}
        {step(3, 'Announce', false, lookIds.length === 2)}
        {step(4, 'Mark picked (Ledger)', false, ready)}
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      <div className="row wrap">
        <label className="btn">{look ? 'Load another draw file' : 'Load the draw file'}
          <input type="file" accept=".json,application/json" hidden disabled={busy} onChange={(e) => { load(e.target.files?.[0]); e.target.value = '' }} data-testid="sg-load" />
        </label>
        <span className="muted small">The file <code>draw.mjs</code> saved, e.g. <code>draw-round-3-look.json</code> (themes and art styles) or <code>draw-round-3-character.json</code>.</span>
      </div>

      {waves.map((w) => (
        <div key={w.wave} className={`sg-fair${w.problems.length ? ' bad' : ''}`} data-testid={`sg-fair-${w.wave}`}>
          {w.problems.length
            ? <><b>✗ This draw doesn't check out</b><ul>{w.problems.map((p) => <li key={p}>{p}</li>)}</ul></>
            : <><b>✓ Fair draw checked</b>
              <span>{w.wave === 'look' ? 'Look' : 'Characters'} wave closed at block {Number(w.d.toBlock).toLocaleString()}
                {w.d.toBlockTime ? ` (${new Date(w.d.toBlockTime * 1000).toLocaleString()})` : ''} · seed: drand round {Number(w.d.drand!.round).toLocaleString()}
                {' '}(out {new Date(Number(roundTime(w.d.drand!.round)) * 1000).toLocaleString()}, signature verified) · {w.d.suggestions} ideas → {w.d.count} per kind, drawn at random.
                {' '}<span className="muted small">Full re-run from the chain: <code>{commandOr(() => verifyCommand(w.file)).cmd ?? `(rename ${w.file} first)`}</code></span></span></>}
        </div>
      ))}

      {waves.map((w) => (
        <div key={w.wave} className="sg-cols">
          {kindsOf(w.d).map((kind) => (
            <div key={kind}>
              <h3 className="sg-h">{LABEL[kind]} <span className="muted small">{kind === 'character' ? `pick ${need} (${charIds.length} picked)` : 'pick 1'}</span></h3>
              <div className="sg-grid">
                {(w.d.shortlists[kind] ?? []).map((e) => (
                  <button key={e.id} type="button" className={`sg-idea${picked(kind, e.id) ? ' on' : ''}`} disabled={busy || !!w.problems.length}
                    onClick={() => toggle(kind, e.id)} data-testid={`sg-idea-${e.id}`} aria-pressed={picked(kind, e.id)}>
                    <q>{e.title}</q>
                    <span className="muted small">#{e.id} · by {shortAddr(e.by)}</span>
                    {e.alsoBy?.length ? <span className="sg-merged small"> +{e.alsoBy.length} similar merged</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}

      {look && (
        <div className="sg-panel">
          <h3>Your picks</h3>
          <dl className="sg-picks">
            <dt>Theme</dt><dd>{entry(look, 'theme', sg.theme) ? <>“{entry(look, 'theme', sg.theme)!.title}” · {shortAddr(entry(look, 'theme', sg.theme)!.by)}</> : <span className="muted">not picked</span>}</dd>
            <dt>Art style</dt><dd>{entry(look, 'style', sg.style) ? <>“{entry(look, 'style', sg.style)!.title}” · {shortAddr(entry(look, 'style', sg.style)!.by)}</> : <span className="muted">not picked</span>}</dd>
            <dt>Characters</dt><dd>{chars ? (charIds.length ? charIds.map((id) => `“${entry(chars, 'character', id)?.title ?? '#' + id}”`).join(', ') : <span className="muted">not picked</span>)
              : <span className="muted">After the characters wave (load its draw file)</span>}</dd>
          </dl>

          <h4>3 · Announce on the results page</h4>
          <p className="muted small">Run in PowerShell, then commit and push the results file it writes. Nothing on chain yet.</p>
          {lookIds.length === 2 && look && command('pl', 'sg-publish-look', 'Copy (theme and art style)', () => publishCommand(look.file, fire.number, lookIds))}
          {chars && charIds.length === need && command('pc', 'sg-publish-chars', 'Copy (characters)', () => publishCommand(chars.file, fire.number, charIds))}
          {lookIds.length < 2 && <p className="muted small">Pick a theme and an art style first.</p>}

          <h4>4 · Mark picked on chain (once, after the characters wave, before the Series starts)</h4>
          {ready ? (() => { const pk = commandOr(() => pickCommand(fire.number, allIds, chainId)); return pk.error !== undefined
            ? <p className="warn-text small" data-testid="sg-pick-cmd-error">{pk.error}</p> : (<>
            <pre data-testid="sg-pick-cmd">{pk.cmd}</pre>
            <div className="row wrap"><button className="primary" onClick={() => copy('pk', pk.cmd)}>{copied === 'pk' ? 'Copied' : 'Copy command'}</button>
              <span className="muted small">{allIds.length} authors get a free pack (theme, art style, {need} characters). After it, publish again with <code>--rpc &lt;url&gt;</code> so the results page shows the transaction.</span></div>
          </>) })() : <p className="muted small">Needs the theme, the art style and {need} characters picked.</p>}
        </div>
      )}
    </section>
  )
}
