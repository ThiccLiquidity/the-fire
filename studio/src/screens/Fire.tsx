import { useMemo } from 'react'
import { AccumulatorBars, Field, Notice, NumberInput, useAction } from '../components'
import { computePool } from '../deal'
import { randomSeed } from '../prng'
import { MATERIALS, MATERIAL_LABEL } from '../rules'
import { completeness, deleteFire, isReady, getStudio, saveFire, saveGlobal, updateFire, useStudio } from '../store'
import { fireStatus, type FireRecord } from '../types'

export function FireList({ selected, onSelect }: { selected: number | null; onSelect: (n: number) => void }) {
  const s = useStudio()
  const [busy, error, run] = useAction()
  const create = () => run(async () => {
    const n = getStudio().global.nextFireNumber
    const now = Date.now()
    const f: FireRecord = { number: n, characterIds: [], packs: 150, seed: randomSeed(), createdAt: now, updatedAt: now }
    await saveFire(f)
    await saveGlobal({ ...getStudio().global, nextFireNumber: n + 1 })
    onSelect(n)
  })
  return (
    <aside className="panel list-panel">
      <h3>Fires</h3>
      <ul className="char-list" data-testid="fire-list">
        {s.fires.map((f) => (
          <li key={f.number} className={selected === f.number ? 'active' : ''} onClick={() => onSelect(f.number)}>
            <span className="char-name">Fire #{f.number}</span>
            <span className="muted small">{f.packs} packs · {f.characterIds.length} chars</span>
            <span className={`badge status-${fireStatus(f)}`}>{fireStatus(f)}</span>
          </li>
        ))}
        {!s.fires.length && <li className="muted">No Fires yet.</li>}
      </ul>
      <button className="primary" onClick={create} disabled={busy} data-testid="new-fire">New Fire #{s.global.nextFireNumber}</button>
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

  const projection = useMemo(() => {
    if (fire.deal) return { before: fire.deal.accumulatorsBefore, after: fire.deal.accumulatorsAfter, counts: fire.deal.pool }
    try {
      const p = computePool(s.global.accumulators, fire.packs)
      return { before: p.before, after: p.after, counts: p.counts }
    } catch {
      return null
    }
  }, [fire.deal, fire.packs, s.global.accumulators])

  const toggle = (id: string, on: boolean) => update({ characterIds: on ? [...fire.characterIds, id] : fire.characterIds.filter((x) => x !== id) })
  const missing = fire.characterIds.filter((id) => {
    const c = s.characters.find((x) => x.id === id)
    return !c || !isReady(c)
  })

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Fire #{fire.number}</h2>
        <span className={`badge status-${fireStatus(fire)}`}>{fireStatus(fire)}</span>
        <span className="spacer" />
        {!locked && (
          <button className="danger" onClick={() => {
            if (confirm(`Delete draft Fire #${fire.number}?`)) void run(async () => { await deleteFire(fire.number); onDeleted() })
          }}>Delete draft</button>
        )}
      </div>
      {locked && <Notice kind="info">The deal for this Fire is locked; its setup can't change. (Undo the lock on the Deal tab if it's the latest Fire and not uploaded.)</Notice>}
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
            <Field label="Packs sold (sample)" hint="6 cards per pack">
              <NumberInput min={0} value={fire.packs} onChange={(n) => !locked && update({ packs: Math.max(0, Math.floor(n)) })} data-testid="packs" />
            </Field>
          </div>
          {projection && (
            <table className="mini">
              <thead><tr><th>Material</th>{MATERIALS.map((m) => <th key={m}>{MATERIAL_LABEL[m]}</th>)}<th>Total</th></tr></thead>
              <tbody><tr><td>Pool</td>{MATERIALS.map((m) => <td key={m} data-testid={`pool-${m}`}>{projection.counts[m]}</td>)}<td>{fire.packs * 6}</td></tr></tbody>
            </table>
          )}
        </div>
        <div>
          {projection ? (
            <>
              <AccumulatorBars acc={projection.before} title={locked ? 'Accumulators before this Fire' : 'Accumulators now (carried from previous Fires)'} />
              <AccumulatorBars acc={projection.after} title={locked ? 'Accumulators after this Fire' : 'After this Fire (projected)'} />
            </>
          ) : <Notice kind="error">Invalid pack count.</Notice>}
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {busy && <span className="muted small">saving...</span>}
    </section>
  )
}
