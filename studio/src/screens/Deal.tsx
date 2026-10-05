import { useMemo, useState } from 'react'
import { Field, Notice, useAction } from '../components'
import { hasCategory, nameProblem, normalizeName } from '../categories'
import { deleteBlobsWithPrefix } from '../db'
import { effectiveDiamonds, holoCounts, type DealInput, type DealResult } from '../deal'
import { dealInputKey, useDealPreview } from '../dealPreview'
import { randomSeed } from '../prng'
import { HOLO_LABEL, HOLO_TYPES, MATERIALS, MATERIAL_LABEL, MAX_CHARACTERS, MAX_PACKS, type Material } from '../rules'
import { completeness, getStudio, saveGlobal, updateFire, useStudio } from '../store'
import type { FireRecord } from '../types'

export function Deal({ fire }: { fire: FireRecord }) {
  const s = useStudio()
  const [busy, error, run] = useAction()
  const [packsShown, setPacksShown] = useState(12)
  const locked = !!fire.deal
  const names = Object.fromEntries(s.characters.map((c) => [c.id, c.name]))

  const problems: string[] = []
  if (!fire.characterIds.length) problems.push('Pick at least one character on the Series tab.')
  if (fire.characterIds.length > MAX_CHARACTERS) problems.push(`A Series has at most ${MAX_CHARACTERS} characters (${fire.characterIds.length} picked).`)
  if (fire.packs < 1) problems.push('Set at least 1 pack on the Series tab.')
  if (fire.packs > MAX_PACKS) problems.push(`At most ${MAX_PACKS.toLocaleString()} packs per Series.`)
  for (const id of fire.characterIds) {
    const c = s.characters.find((x) => x.id === id)
    if (!c) problems.push('A picked character no longer exists.')
    else if (completeness(c) < 10) problems.push(`${c.name} has ${completeness(c)}/10 images.`)
    else if (nameProblem(normalizeName(c.name))) problems.push(`"${c.name}": name can't go on-chain: ${nameProblem(normalizeName(c.name))} (Library).`)
    else if (!hasCategory(c)) problems.push(`${c.name} has no usable category (Library).`)
  }
  const earlierOpen = s.fires.filter((f) => f.number < fire.number && !f.deal)
  if (earlierOpen.length) problems.push(`Lock Series ${earlierOpen.map((f) => f.number).join(', #')} first (serials go in Fire order).`)
  if (!fire.seed.trim()) problems.push('Enter a seed.')

  // the preview is dealt in a worker, debounced, so a big Series (or typing a seed) never freezes the tab
  const input: DealInput | null = useMemo(() => {
    if (fire.deal || !fire.characterIds.length || !fire.seed.trim() || fire.packs > MAX_PACKS || fire.characterIds.length > MAX_CHARACTERS) return null
    return {
      fire: fire.number, packs: fire.packs, characterIds: fire.characterIds, seed: fire.seed.trim(),
      diamonds: effectiveDiamonds(fire.diamonds), firstSerial: s.global.nextSerial,
    }
  }, [fire.deal, fire.number, fire.packs, fire.characterIds, fire.seed, fire.diamonds, s.global.nextSerial])
  const live = useDealPreview(input)
  const current = !!input && live.key === dealInputKey(input)
  const preview: DealResult | null = fire.deal ?? (current ? live.result : null)
  const dealing = !fire.deal && !!input && (live.pending || !current)

  const lock = () => run(async () => {
    if (problems.length) throw new Error(problems[0])
    if (!preview || !input || dealInputKey(input) !== live.key) throw new Error('The preview is still being dealt; try again in a moment.')
    // Commit: the deal is stored on the Series and the global serial counter moves on.
    await updateFire(fire.number, { deal: preview, approvedAt: undefined, build: undefined })
    await saveGlobal({ ...getStudio().global, nextSerial: preview.nextSerial })
  })

  const latestLocked = Math.max(0, ...s.fires.filter((f) => f.deal).map((f) => f.number))
  const canUnlock = locked && fire.number === latestLocked && !fire.upload?.imagesCid && !fire.upload?.metadataCid
  const unlock = () => run(async () => {
    if (!fire.deal) return
    if (!confirm(`Undo the deal lock of Series ${fire.number}? The serial counter goes back to before this Series, and its approval and built images are discarded.`)) return
    await saveGlobal({ ...getStudio().global, nextSerial: fire.deal.firstSerial })
    await deleteBlobsWithPrefix(`render:${fire.number}:`)
    await updateFire(fire.number, { deal: undefined, approvedAt: undefined, build: undefined })
  })

  const hc = useMemo(() => (preview ? holoCounts(preview.cards) : null), [preview])
  const anyHolo = useMemo(() => preview?.cards.reduce((n, c) => n + (c.holo !== 'none' ? 1 : 0), 0) ?? 0, [preview])
  // cards are sorted by serial and serials are one contiguous block, so a serial's card is found by offset
  const cardOf = (serial: number) => preview!.cards[serial - preview!.firstSerial]

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Deal · Series {fire.number}</h2>
        <span className="badge">{locked ? 'locked' : 'preview (not saved)'}</span>
      </div>
      <Notice kind="info">
        Sample deal on the real rules (src/deal.ts). The seed stands in for the drand round drawn after the Series ends;
        the same seed always gives the same deal. When the pack contract exists, its result replaces this step.
      </Notice>
      <div className="row wrap">
        <Field label="Seed (drand stand-in)">
          <input className="seed" value={fire.seed} disabled={locked} onChange={(e) => void run(() => updateFire(fire.number, { seed: e.target.value }))} data-testid="seed" />
        </Field>
        <button disabled={locked} onClick={() => void run(() => updateFire(fire.number, { seed: randomSeed() }))}>Randomize</button>
        <span className="spacer" />
        {dealing && <span className="muted small" data-testid="dealing">Dealing{fire.packs >= 10_000 ? ` ${(fire.packs * 6).toLocaleString()} cards` : ''}...</span>}
        {!locked && <button className="primary" disabled={busy || !preview || dealing || problems.length > 0} onClick={lock} data-testid="lock-deal">Lock deal</button>}
        {canUnlock && <button className="danger" disabled={busy} onClick={unlock}>Undo lock</button>}
      </div>
      {problems.length > 0 && !locked && <Notice kind="warn">{problems.map((p) => <div key={p}>{p}</div>)}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {!locked && live.error && current && <Notice kind="error">{live.error}</Notice>}
      {preview && hc && (
        <>
          <div className="stats-row">
            <div className="stat"><b data-testid="deal-total">{preview.cards.length}</b><span>cards</span></div>
            <div className="stat"><b>{preview.packs}</b><span>packs</span></div>
            <div className="stat"><b data-testid="deal-serials">#{preview.firstSerial}{preview.cards.length ? `-#${preview.nextSerial - 1}` : ''}</b><span>serials</span></div>
            <div className="stat"><b>{anyHolo}</b><span>holo (any)</span></div>
          </div>
          <table className="mini" data-testid="holo-table">
            <thead>
              <tr><th>Material</th><th>Cards</th>{HOLO_TYPES.map((h) => <th key={h}>{HOLO_LABEL[h]}</th>)}<th>Holo %</th></tr>
            </thead>
            <tbody>
              {MATERIALS.map((m) => {
                const n = preview.pool[m]
                return (
                  <tr key={m}>
                    <td>{MATERIAL_LABEL[m]}</td><td>{n}</td>
                    {HOLO_TYPES.map((h) => <td key={h}>{hc[m][h]}</td>)}
                    <td>{n ? (((n - hc[m].none) / n) * 100).toFixed(1) : '-'}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <h4>Packs (first {Math.min(packsShown, preview.packs)} of {preview.packs})</h4>
          <div className="packs">
            {preview.packContents.slice(0, packsShown).map((pack, i) => (
              <div className="pack" key={i}>
                <span className="pack-no">Pack {i + 1}</span>
                {pack.map((serial) => {
                  const c = cardOf(serial)
                  return (
                    <span key={serial} className={`chip mat-${c.material}`} title={`#${c.serial} ${names[c.characterId]} ${c.material} holo:${c.holo} ${c.edition} of ${c.editionOf}`}>
                      {short(c.material)} {names[c.characterId]?.slice(0, 6)} #{c.serial}{c.holo !== 'none' ? ` ✦${c.holo[0].toUpperCase()}` : ''}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
          {packsShown < preview.packs && <button onClick={() => setPacksShown((n) => n + 50)}>Show more packs</button>}
        </>
      )}
    </section>
  )
}

function short(m: Material): string {
  return MATERIAL_LABEL[m].slice(0, 2)
}
