import { useMemo, useState } from 'react'
import { Field, Notice, NumberInput, useAction } from '../components'
import { hasCategory, hasValidName } from '../categories'
import { frameSetLabel } from '../frames'
import { randomSeed } from '../prng'
import { castWarning, checkRecipe, holoOdds, holoOddsGivenHolo, previewPool, slotTypeIndexes, standardRecipe, type Recipe } from '../recipe'
import { MAX_PACKS } from '../rules'
import { artNeeds, isReadyFor, missingArt } from '../series'
import { deleteFire, getStudio, saveFire, saveGlobal, updateFire, useStudio } from '../store'
import { fireStatus, type Character, type FireRecord } from '../types'

export function FireList({ selected, onSelect }: { selected: number | null; onSelect: (n: number) => void }) {
  const s = useStudio()
  const [busy, error, run] = useAction()
  const create = () => run(async () => {
    const n = getStudio().global.nextFireNumber
    const now = Date.now()
    const f: FireRecord = { number: n, characterIds: [], packs: 150, recipe: standardRecipe(), seed: randomSeed(), createdAt: now, updatedAt: now }
    await saveFire(f)
    await saveGlobal({ ...getStudio().global, nextFireNumber: n + 1 })
    onSelect(n)
  })
  return (
    <aside className="panel list-panel">
      <h3>Series</h3>
      <ul className="char-list" data-testid="fire-list">
        {s.fires.map((f) => (
          <li key={f.number} className={selected === f.number ? 'active' : ''} onClick={() => onSelect(f.number)} data-testid={`fire-${f.number}`}>
            <span className="char-name">Series {f.number}</span>
            <span className="muted small">{f.packs.toLocaleString()} packs · {f.characterIds.length} chars · {f.recipe.slots.reduce((n, x) => n + x.count, 0)}/pack</span>
            <span className={`badge status-${fireStatus(f)}`}>{fireStatus(f)}</span>
          </li>
        ))}
        {!s.fires.length && <li className="muted">No Series yet.</li>}
      </ul>
      <button className="primary" onClick={create} disabled={busy} data-testid="new-fire">New Series {s.global.nextFireNumber}</button>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="muted small global-info">Next global serial: <b data-testid="next-serial">#{s.global.nextSerial}</b></div>
    </aside>
  )
}

const PAGE = 100

export function FireSetup({ fire, onDeleted }: { fire: FireRecord; onDeleted: () => void }) {
  const s = useStudio()
  const [busy, error, run] = useAction()
  const [query, setQuery] = useState('')
  const [onlyReady, setOnlyReady] = useState(false)
  const [page, setPage] = useState(0)
  const locked = !!fire.deal
  const update = (patch: Partial<FireRecord>) => run(() => updateFire(fire.number, patch))
  const needs = useMemo(() => artNeeds(fire.recipe), [fire.recipe])
  const picked = useMemo(() => new Set(fire.characterIds), [fire.characterIds])
  const byId = useMemo(() => new Map(s.characters.map((c) => [c.id, c])), [s.characters])
  const ready = (c: Character) => isReadyFor(c, needs)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return s.characters.filter((c) => (!q || c.name.toLowerCase().includes(q) || (c.category ?? '').toLowerCase().includes(q) || c.shortId.toLowerCase().includes(q)) && (!onlyReady || isReadyFor(c, needs)))
  }, [s.characters, query, onlyReady, needs])
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const shown = list.slice(page * PAGE, page * PAGE + PAGE)

  const toggle = (id: string, on: boolean) => run(() => updateFire(fire.number, (f) => ({ characterIds: on ? [...f.characterIds, id] : f.characterIds.filter((x) => x !== id) })))
  const notReady = fire.characterIds.filter((id) => { const c = byId.get(id); return !c || !ready(c) })

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Series {fire.number}</h2>
        <span className={`badge status-${fireStatus(fire)}`}>{fireStatus(fire)}</span>
        <span className="spacer" />
        {!locked && (
          <button className="danger" onClick={() => {
            if (confirm(`Delete draft Series ${fire.number}?`)) void run(async () => { await deleteFire(fire.number); onDeleted() })
          }}>Delete draft</button>
        )}
      </div>
      {locked && <Notice kind="info">The deal for this Series is locked; its setup can't change. (Undo the lock on the Deal tab if it's the latest Series and not uploaded.)</Notice>}
      <div className="cols">
        <div>
          <h4>Characters ({fire.characterIds.length.toLocaleString()} picked, image order c0, c1, ...)</h4>
          <p className="muted small">
            Any number (the contract stores them in batches). A character needs a valid name and category, and the art this
            recipe uses: {[...needs].map(([set, vs]) => `${frameSetLabel(set)} ${[...vs].join(' + ')}`).join(', ')}.
          </p>
          <div className="row wrap">
            <input placeholder="Search name, category, short id" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} data-testid="char-search" style={{ width: 220 }} />
            <label className="check small"><input type="checkbox" checked={onlyReady} onChange={(e) => { setOnlyReady(e.target.checked); setPage(0) }} /> ready only</label>
            <span className="muted small">{list.length.toLocaleString()} shown</span>
          </div>
          <ul className="pick-list" data-testid="fire-chars">
            {shown.map((c) => {
              const ok = ready(c)
              const on = picked.has(c.id)
              const miss = missingArt(c, needs)
              return (
                <li key={c.id} className={ok ? '' : 'disabled'}>
                  <label className="check">
                    <input type="checkbox" checked={on} disabled={locked || (!on && !ok)} onChange={(e) => toggle(c.id, e.target.checked)} data-testid={`pick-${c.name}`} />
                    {on && <span className="muted small">c{fire.characterIds.indexOf(c.id)}</span>}
                    {c.name} {c.placeholder && <span className="tag">placeholder</span>}
                    <span className={`badge ${ok ? 'badge-ok' : 'badge-warn'}`} title={miss.join(', ')}>
                      {ok ? 'ready' : miss.length ? `${miss.length} image${miss.length === 1 ? '' : 's'} missing` : ''}{hasCategory(c) ? '' : ' · no category'}{hasValidName(c) ? '' : ' · bad name'}
                    </span>
                  </label>
                </li>
              )
            })}
            {!s.characters.length && <li className="muted">The library is empty.</li>}
          </ul>
          {pages > 1 && (
            <div className="row">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="muted small">Page {page + 1} of {pages}</span>
              <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
          {!locked && (
            <div className="row wrap">
              <button onClick={() => update({ characterIds: [...fire.characterIds, ...s.characters.filter((c) => !picked.has(c.id) && ready(c)).map((c) => c.id)] })} data-testid="pick-all">Pick all ready</button>
              {query && <button onClick={() => update({ characterIds: [...fire.characterIds, ...list.filter((c) => !picked.has(c.id) && ready(c)).map((c) => c.id)] })}>Pick the ready ones shown</button>}
              <button onClick={() => update({ characterIds: [] })}>Clear</button>
              {notReady.length > 0 && <button onClick={() => update({ characterIds: fire.characterIds.filter((id) => !notReady.includes(id)) })}>Unpick the {notReady.length} not ready</button>}
            </div>
          )}
          {notReady.length > 0 && <Notice kind="error">{notReady.length} picked character{notReady.length === 1 ? " isn't" : "s aren't"} ready for this recipe (art, name or category); finish them or unpick them.</Notice>}
          <div className="row wrap">
            <Field label="Packs" hint={`1 to ${MAX_PACKS.toLocaleString()}`}>
              <NumberInput min={1} max={MAX_PACKS} value={fire.packs} onChange={(n) => !locked && update({ packs: Math.min(MAX_PACKS, Math.max(0, Math.floor(n) || 0)) })} data-testid="packs" />
            </Field>
          </div>
          {fire.packs < 1 && !locked && <p className="field-msg err" data-testid="packs-problem">Packs: set at least 1 (a Series with no packs can't be dealt or uploaded).</p>}
        </div>
        <div>
          <SeriesMakes recipe={fire.recipe} packs={fire.packs} chars={fire.characterIds.length} />
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {busy && <span className="muted small">saving...</span>}
    </section>
  )
}

const fmtAbout = (x: number) => (x === 0 ? '0' : `≈ ${x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString()}`)

/** What this Series will make: exact card counts per type (the contract's pool maths) and the holos to expect. */
function SeriesMakes({ recipe, packs, chars }: { recipe: Recipe; packs: number; chars: number }) {
  const problems = useMemo(() => checkRecipe(recipe), [recipe])
  // per-character types (Gold, Full Art) scale with the cast: at least 1 so an empty cast still shows the shape
  const counts = useMemo(() => (problems.length ? null : previewPool(recipe, BigInt(Math.max(0, packs)), BigInt(Math.max(1, chars)))), [recipe, packs, chars, problems])
  if (!counts) return <Notice kind="warn">The recipe has problems: fix them on the Recipe tab to see the pool.</Notice>
  const S = recipe.slots.reduce((n, x) => n + x.count, 0)
  const rows = recipe.types.map((t, i) => {
    const n = Number(counts[i])
    const inMust = recipe.slots.some((x) => x.mustHolo && slotTypeIndexes(recipe, x).includes(i))
    const inPlain = recipe.slots.some((x) => !x.mustHolo && slotTypeIndexes(recipe, x).includes(i))
    const o = inMust && !inPlain ? holoOddsGivenHolo(t) : holoOdds(t)
    return { t, n, mixed: inMust && inPlain, h: { frame: n * o[1], picture: n * o[2], full: n * o[3] } }
  })
  const warn = castWarning(recipe, counts)
  return (
    <div data-testid="series-makes">
      <h4>This Series will make</h4>
      {warn && <Notice kind="warn">{warn}</Notice>}
      <table className="mini">
        <thead>
          <tr><th rowSpan={2}>Type</th><th rowSpan={2}>Cards</th><th colSpan={3}>Holos (about; random per card)</th></tr>
          <tr><th>Frame only</th><th>Picture only</th><th>Full</th></tr>
        </thead>
        <tbody>
          {rows.map(({ t, n, h, mixed }) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td data-testid={`pool-${t.slug}`}><b>{n.toLocaleString()}</b></td>
              {mixed ? <td colSpan={3} className="muted small">plain and must-holo slots: at least the plain-slot odds</td>
                : <><td>{fmtAbout(h.frame)}</td><td>{fmtAbout(h.picture)}</td><td>{fmtAbout(h.full)}</td></>}
            </tr>
          ))}
          <tr><td><b>Total</b></td><td><b>{(packs * S).toLocaleString()}</b></td><td colSpan={3} className="muted small">{S} per pack</td></tr>
        </tbody>
      </table>
      <p className="muted small">Card counts are exact (the contract's pool for this pack count). Change the types, slots and odds on the Recipe tab.</p>
    </div>
  )
}
