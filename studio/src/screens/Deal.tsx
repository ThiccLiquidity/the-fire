import { useMemo, useState } from 'react'
import { Field, Notice, useAction } from '../components'
import { nameProblem, normalizeName, hasCategory } from '../categories'
import { deleteBlobsWithPrefix } from '../db'
import { holoCounts, type DealInput, type DealResult } from '../deal'
import { dealInputKey, useDealPreview } from '../dealPreview'
import { randomSeed } from '../prng'
import { cardsPerPack, checkRecipe } from '../recipe'
import { HOLO_LABEL, HOLO_TYPES, MAX_DEAL_CARDS } from '../rules'
import { artNeeds, missingArt } from '../series'
import { getStudio, saveGlobal, updateFire, useStudio } from '../store'
import type { FireRecord } from '../types'

export function Deal({ fire }: { fire: FireRecord }) {
  const s = useStudio()
  const [busy, error, run] = useAction()
  const [packsShown, setPacksShown] = useState(12)
  const locked = !!fire.deal
  const names = useMemo(() => Object.fromEntries(s.characters.map((c) => [c.id, c.name])), [s.characters])
  const recipe = fire.recipe
  const S = cardsPerPack(recipe)
  const recipeProblems = useMemo(() => checkRecipe(recipe), [recipe])

  const problems: string[] = []
  if (recipeProblems.length) problems.push(`The recipe has ${recipeProblems.length} problem${recipeProblems.length === 1 ? '' : 's'} (Recipe tab): ${recipeProblems[0].message}`)
  if (!fire.characterIds.length) problems.push('Pick at least one character on the Series tab.')
  if (fire.packs < 1) problems.push('Set at least 1 pack on the Series tab.')
  if (fire.packs * S > MAX_DEAL_CARDS) problems.push(`The sample deal deals at most ${MAX_DEAL_CARDS.toLocaleString()} cards (${fire.packs.toLocaleString()} packs x ${S}). Lower the packs to preview a deal; the pool preview on the Recipe tab covers any size.`)
  const needs = artNeeds(recipe)
  const byId = new Map(s.characters.map((c) => [c.id, c]))
  let notReady = 0
  for (const id of fire.characterIds) {
    const c = byId.get(id)
    if (!c) { problems.push('A picked character no longer exists.'); continue }
    const miss = missingArt(c, needs)
    const np = nameProblem(normalizeName(c.name))
    if (miss.length || np || !hasCategory(c)) {
      if (++notReady <= 5) problems.push(miss.length ? `${c.name} is missing ${miss.join(', ')} art (Library).` : np ? `"${c.name}": name can't go on-chain: ${np} (Library).` : `${c.name} has no usable category (Library).`)
    }
  }
  if (notReady > 5) problems.push(`... and ${notReady - 5} more characters not ready.`)
  const earlierOpen = s.fires.filter((f) => f.number < fire.number && !f.deal)
  if (earlierOpen.length) problems.push(`Lock Series ${earlierOpen.map((f) => f.number).join(', #')} first (serials go in Series order).`)
  if (!fire.seed.trim()) problems.push('Enter a seed.')

  // the preview is dealt in a worker, debounced, so a big Series (or typing a seed) never freezes the tab
  const canDeal = !fire.deal && fire.characterIds.length > 0 && !!fire.seed.trim() && fire.packs * S <= MAX_DEAL_CARDS && !recipeProblems.length
  const input: DealInput | null = useMemo(() => {
    if (!canDeal) return null
    return { fire: fire.number, packs: fire.packs, characterIds: fire.characterIds, seed: fire.seed.trim(), recipe, firstSerial: s.global.nextSerial }
  }, [canDeal, fire.number, fire.packs, fire.characterIds, fire.seed, recipe, s.global.nextSerial])
  const live = useDealPreview(input)
  const current = !!input && live.key === dealInputKey(input)
  const preview: DealResult | null = fire.deal ?? (current ? live.result : null)
  const dealing = !fire.deal && !!input && (live.pending || !current)

  const lock = () => run(async () => {
    if (problems.length) throw new Error(problems[0])
    if (!preview || !input || dealInputKey(input) !== live.key) throw new Error('The preview is still being dealt; try again in a moment.')
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

  const hc = useMemo(() => (preview ? holoCounts(preview.cards, recipe.types.length) : null), [preview, recipe.types.length])
  const anyHolo = useMemo(() => preview?.cards.reduce((n, c) => n + (c.holo !== 'none' ? 1 : 0), 0) ?? 0, [preview])
  // cards are sorted by serial and serials are one contiguous block, so a serial's card is found by offset
  const cardOf = (serial: number) => preview!.cards[serial - preview!.firstSerial]
  const typeName = (t: number) => recipe.types[t]?.name ?? `type ${t}`

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Deal · Series {fire.number}</h2>
        <span className="badge">{locked ? 'locked' : 'preview (not saved)'}</span>
      </div>
      <Notice kind="info">
        A sample deal on this Series' recipe (src/deal.ts, the contract's dealing with the studio's own randomness). The seed
        stands in for the drand randomness; the same seed always gives the same deal. On-chain, each pack is dealt when it's
        opened.
      </Notice>
      <div className="row wrap">
        <Field label="Seed (drand stand-in)">
          <input className="seed" value={fire.seed} disabled={locked} onChange={(e) => void run(() => updateFire(fire.number, { seed: e.target.value }))} data-testid="seed" />
        </Field>
        <button disabled={locked} onClick={() => void run(() => updateFire(fire.number, { seed: randomSeed() }))}>Randomize</button>
        <span className="spacer" />
        {dealing && <span className="muted small" data-testid="dealing">Dealing{fire.packs * S >= 60_000 ? ` ${(fire.packs * S).toLocaleString()} cards` : ''}...</span>}
        {!locked && <button className="primary" disabled={busy || !preview || dealing || problems.length > 0} onClick={lock} data-testid="lock-deal">Lock deal</button>}
        {canUnlock && <button className="danger" disabled={busy} onClick={unlock}>Undo lock</button>}
      </div>
      {problems.length > 0 && !locked && <Notice kind="warn">{problems.map((p) => <div key={p}>{p}</div>)}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {!locked && live.error && current && <Notice kind="error">{live.error}</Notice>}
      {preview && hc && (
        <>
          <div className="stats-row">
            <div className="stat"><b data-testid="deal-total">{preview.cards.length.toLocaleString()}</b><span>cards</span></div>
            <div className="stat"><b>{preview.packs.toLocaleString()}</b><span>packs of {preview.cardsPerPack}</span></div>
            <div className="stat"><b data-testid="deal-serials">#{preview.firstSerial}{preview.cards.length ? `-#${preview.nextSerial - 1}` : ''}</b><span>serials</span></div>
            <div className="stat"><b>{anyHolo.toLocaleString()}</b><span>holo (any)</span></div>
          </div>
          <table className="mini" data-testid="holo-table">
            <thead>
              <tr><th>Type</th><th>Cards</th>{HOLO_TYPES.map((h) => <th key={h}>{HOLO_LABEL[h]}</th>)}<th>Holo %</th></tr>
            </thead>
            <tbody>
              {recipe.types.map((t, i) => {
                const n = preview.pool[i] ?? 0
                return (
                  <tr key={t.id}>
                    <td>{t.name}</td><td>{n.toLocaleString()}</td>
                    {HOLO_TYPES.map((h) => <td key={h}>{hc[i]?.[h] ?? 0}</td>)}
                    <td>{n ? (((n - (hc[i]?.none ?? 0)) / n) * 100).toFixed(1) : '-'}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <h4>Packs (first {Math.min(packsShown, preview.packs)} of {preview.packs.toLocaleString()}; in dealing order: most specific slot group first)</h4>
          <div className="packs" data-testid="deal-packs">
            {preview.packContents.slice(0, packsShown).map((pack, i) => (
              <div className="pack" key={i}>
                <span className="pack-no">Pack {i + 1}</span>
                {pack.map((serial) => {
                  const c = cardOf(serial)
                  const t = recipe.types[c.type]
                  return (
                    <span key={serial} className={`chip mat-${t?.frameSet ?? 'x'}`} title={`#${c.serial} ${names[c.characterId]} ${typeName(c.type)} holo:${c.holo} ${c.edition} of ${c.editionOf} · slot group ${c.group + 1}`}>
                      {typeName(c.type).slice(0, 4)} {names[c.characterId]?.slice(0, 6)} #{c.serial}{c.holo !== 'none' ? ` ✦${c.holo[0].toUpperCase()}` : ''}
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
