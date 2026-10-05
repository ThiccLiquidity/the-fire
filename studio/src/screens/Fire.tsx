import { useMemo } from 'react'
import { Field, Notice, NumberInput, useAction } from '../components'
import { computePool, effectiveDiamonds } from '../deal'
import { randomSeed } from '../prng'
import { CARDS_PER_PACK, MATERIALS, MATERIAL_LABEL, MAX_DIAMONDS, expectedHolos, type Material } from '../rules'
import { completeness, deleteFire, isReady, getStudio, saveFire, saveGlobal, updateFire, useStudio } from '../store'
import { fireStatus, type FireRecord } from '../types'

export function FireList({ selected, onSelect }: { selected: number | null; onSelect: (n: number) => void }) {
  const s = useStudio()
  const [busy, error, run] = useAction()
  const create = () => run(async () => {
    const n = getStudio().global.nextFireNumber
    const now = Date.now()
    const f: FireRecord = { number: n, characterIds: [], packs: 150, diamonds: 1, seed: randomSeed(), createdAt: now, updatedAt: now }
    await saveFire(f)
    await saveGlobal({ ...getStudio().global, nextFireNumber: n + 1 })
    onSelect(n)
  })
  return (
    <aside className="panel list-panel">
      <h3>Series</h3>
      <ul className="char-list" data-testid="fire-list">
        {s.fires.map((f) => (
          <li key={f.number} className={selected === f.number ? 'active' : ''} onClick={() => onSelect(f.number)}>
            <span className="char-name">Series {f.number}</span>
            <span className="muted small">{f.packs} packs · {f.characterIds.length} chars</span>
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

export function FireSetup({ fire, onDeleted }: { fire: FireRecord; onDeleted: () => void }) {
  const s = useStudio()
  const [busy, error, run] = useAction()
  const locked = !!fire.deal
  const update = (patch: Partial<FireRecord>) => run(() => updateFire(fire.number, patch))

  const diamonds = effectiveDiamonds(fire.diamonds)
  const counts = useMemo(() => {
    if (fire.deal) return fire.deal.pool
    try {
      return computePool(fire.packs, diamonds)
    } catch {
      return null
    }
  }, [fire.deal, fire.packs, diamonds])

  const toggle = (id: string, on: boolean) => update({ characterIds: on ? [...fire.characterIds, id] : fire.characterIds.filter((x) => x !== id) })
  const missing = fire.characterIds.filter((id) => {
    const c = s.characters.find((x) => x.id === id)
    return !c || !isReady(c)
  })

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
          <h4>Characters ({fire.characterIds.length} picked)</h4>
          <ul className="pick-list" data-testid="fire-chars">
            {s.characters.map((c) => {
              const n = completeness(c)
              const ok = isReady(c)
              const on = fire.characterIds.includes(c.id)
              return (
                <li key={c.id} className={ok ? '' : 'disabled'}>
                  <label className="check">
                    <input type="checkbox" checked={on} disabled={locked || (!ok && !on)} onChange={(e) => toggle(c.id, e.target.checked)} data-testid={`pick-${c.name}`} />
                    {c.name} {c.placeholder && <span className="tag">placeholder</span>}
                    <span className={`badge ${ok ? 'badge-ok' : 'badge-warn'}`}>{n}/10{c.category ? '' : ' · no category'}</span>
                  </label>
                </li>
              )
            })}
            {!s.characters.length && <li className="muted">The library is empty.</li>}
          </ul>
          {!locked && (
            <div className="row">
              <button onClick={() => update({ characterIds: s.characters.filter(isReady).map((c) => c.id) })}>Pick all complete</button>
              <button onClick={() => update({ characterIds: [] })}>Clear</button>
            </div>
          )}
          {missing.length > 0 && <Notice kind="error">Some picked characters are incomplete; finish their 10 images or unpick them.</Notice>}
          <div className="row wrap">
            <Field label="Packs" hint="6 cards per pack">
              <NumberInput min={0} value={fire.packs} onChange={(n) => !locked && update({ packs: Math.max(0, Math.floor(n)) })} data-testid="packs" />
            </Field>
            <Field label="Diamonds" hint="at least 1">
              <NumberInput min={1} max={MAX_DIAMONDS} value={diamonds} onChange={(n) => !locked && update({ diamonds: Math.min(MAX_DIAMONDS, Math.max(1, Math.floor(n) || 1)) })} data-testid="diamonds" />
            </Field>
          </div>
        </div>
        <div>
          {counts ? <SeriesMakes counts={counts} packs={fire.packs} diamonds={diamonds} /> : <Notice kind="error">Invalid pack count.</Notice>}
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {busy && <span className="muted small">saving...</span>}
    </section>
  )
}

const fmtAbout = (x: number) => (x === 0 ? '0' : `≈ ${x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString()}`)

/** What this Series will make: exact card counts per material, and the holos to expect (holo is random per card). */
function SeriesMakes({ counts, packs, diamonds }: { counts: Record<Material, number>; packs: number; diamonds: number }) {
  const rows = MATERIALS.map((m) => ({ m, n: counts[m], h: expectedHolos(m, counts[m]) }))
  const sum = (k: 'frame' | 'picture' | 'full' | 'total') => rows.reduce((t, r) => t + r.h[k], 0)
  return (
    <div data-testid="series-makes">
      <h4>This Series will make</h4>
      <table className="mini">
        <thead>
          <tr><th rowSpan={2}>Material</th><th rowSpan={2}>Cards</th><th colSpan={4}>Holos (about; holo is random per card)</th></tr>
          <tr><th>Frame only</th><th>Picture only</th><th>Full</th><th>Total</th></tr>
        </thead>
        <tbody>
          {rows.map(({ m, n, h }) => (
            <tr key={m}>
              <td>{MATERIAL_LABEL[m]}</td>
              <td data-testid={`pool-${m}`}><b>{n.toLocaleString()}</b></td>
              <td>{fmtAbout(h.frame)}</td><td>{fmtAbout(h.picture)}</td><td>{fmtAbout(h.full)}</td><td>{fmtAbout(h.total)}</td>
            </tr>
          ))}
          <tr>
            <td><b>Total</b></td><td><b>{(packs * CARDS_PER_PACK).toLocaleString()}</b></td>
            <td>{fmtAbout(sum('frame'))}</td><td>{fmtAbout(sum('picture'))}</td><td>{fmtAbout(sum('full'))}</td><td>{fmtAbout(sum('total'))}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">
        Card counts are exact: each Series stands alone. Paper is half, Fire 15%, Coal 4.9%, Diamond as set
        {packs > 0 && diamonds > packs ? ` (capped at one per pack: ${counts.diamond})` : ''}, Wood the rest. Every pack still
        gets 3 Paper, a Wood and a Fire-or-better.
      </p>
    </div>
  )
}
