import { useEffect, useMemo, useRef, useState } from 'react'
import { BatchRenderer, renderKey } from '../builder'
import { Notice, ProgressBar, useAction } from '../components'
import { blobKeys, deleteBlobsWithPrefix, getBlob, putBlobs } from '../db'
import type { DealtCard } from '../deal'
import { hasFrame } from '../frames'
import { distinctLooks, lookKey, lookOf } from '../looks'
import { cardTitle } from '../render'
import { HOLO_LABEL, HOLO_TYPES, MATERIALS, MATERIAL_LABEL, WEAR_LABEL, wearLookOf, type HoloType, type Material } from '../rules'
import { lastAssetChange, updateFire, useStudio } from '../store'
import type { FireRecord, OutputFormat } from '../types'

interface Sample {
  key: string
  characterId: string
  material: Material
  holo: HoloType
  card: DealtCard
  dealt: number
  url?: string
}

function sampleCards(fire: FireRecord): Sample[] {
  const deal = fire.deal!
  const out: Sample[] = []
  for (const characterId of deal.characterIds) {
    for (const material of MATERIALS) {
      for (const holo of HOLO_TYPES) {
        const matching = deal.cards.filter((c) => c.characterId === characterId && c.material === material && c.holo === holo)
        const card: DealtCard = matching[0] ?? {
          serial: 0, fire: fire.number, pack: 0, slot: 0, material, characterId,
          holoFrame: holo === 'frame' || holo === 'full', holoPicture: holo === 'picture' || holo === 'full', holo, edition: 1, editionOf: 1,
        }
        out.push({ key: `${characterId}:${material}:${holo}`, characterId, material, holo, card, dealt: matching.length })
      }
    }
  }
  return out
}

export function Review({ fire }: { fire: FireRecord }) {
  const s = useStudio()
  if (!fire.deal) return <section className="panel grow"><Notice kind="warn">Lock the deal for Fire #{fire.number} first (Deal tab).</Notice></section>
  return <ReviewInner fire={fire} names={Object.fromEntries(s.characters.map((c) => [c.id, c.name]))} />
}

function ReviewInner({ fire, names }: { fire: FireRecord; names: Record<string, string> }) {
  const deal = fire.deal!
  const [samples, setSamples] = useState<Sample[]>(() => sampleCards(fire))
  const [progress, setProgress] = useState<{ done: number; total: number; what: string } | null>(null)
  const [busy, error, run] = useAction()
  const [big, setBig] = useState<{ url: string; title: string; detail: string } | null>(null)
  const [format, setFormat] = useState<OutputFormat>(fire.build?.format ?? 'webp')
  const abort = useRef<AbortController | null>(null)
  const assetsChanged = lastAssetChange(deal.characterIds)
  const approvalStale = !!fire.approvedAt && assetsChanged > fire.approvedAt
  const buildStale = !!fire.build && assetsChanged > fire.build.builtAt
  const samplesReady = samples.every((x) => x.url)
  // frames this Fire's cards need that haven't been delivered yet
  const missing = [...new Set(deal.cards.filter((c) => !hasFrame(c.material, c.holoFrame ? 'holo' : 'normal', wearLookOf(c.grade)))
    .map((c) => `${MATERIAL_LABEL[c.material]} ${c.holoFrame ? 'holo' : 'normal'}${c.grade == null ? '' : ` ${WEAR_LABEL[wearLookOf(c.grade)]}`}`))]

  // free sample object URLs on unmount
  const urls = useRef<string[]>([])
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u) }, [])

  const renderSamples = () => run(async () => {
    const list = sampleCards(fire)
    setSamples(list)
    const r = await BatchRenderer.create(deal.characterIds, deal.cards.some((c) => c.grade != null))
    try {
      const next = [...list]
      await r.renderAll(list.map((x) => x.card), 'webp', {
        batchSize: 2,
        onProgress: (p) => setProgress({ ...p, what: `Rendering samples (${r.mode})` }),
        onBatch: (_cards, blobs, start) => {
          blobs.forEach((b, j) => {
            const url = URL.createObjectURL(b)
            urls.current.push(url)
            next[start + j] = { ...next[start + j], url }
          })
          setSamples([...next])
        },
      })
    } finally {
      r.dispose()
      setProgress(null)
    }
  })

  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current) return // StrictMode runs effects twice in dev
    autoStarted.current = true
    void renderSamples()
  }, [])

  const approve = () => run(async () => {
    if (!samplesReady) throw new Error('Render the samples first.')
    if (missing.length) throw new Error(`Missing frames: ${missing.join(', ')}.`)
    await updateFire(fire.number, { approvedAt: Date.now() })
  })

  const build = () => run(async () => {
    abort.current = new AbortController()
    await deleteBlobsWithPrefix(`render:${fire.number}:`)
    await updateFire(fire.number, { build: undefined })
    const r = await BatchRenderer.create(deal.characterIds, deal.cards.some((c) => c.grade != null))
    const t0 = performance.now()
    // one image per look, shared by every card that looks the same
    const looks = distinctLooks(deal.cards)
    try {
      await r.renderAll(looks.map((l) => l.card), format, {
        batchSize: 4,
        signal: abort.current.signal,
        onProgress: (p) => setProgress({ ...p, what: `Building ${looks.length} images for ${deal.cards.length} cards, ${format.toUpperCase()} (${r.mode})` }),
        onBatch: (_cards, blobs, start) => putBlobs(blobs.map((b, i) => [renderKey(fire.number, looks[start + i].key), b])),
      })
    } finally {
      r.dispose()
      setProgress(null)
      abort.current = null
    }
    const count = (await blobKeys(`render:${fire.number}:`)).length
    await updateFire(fire.number, { build: { format, count, builtAt: Date.now() } })
    console.info(`Card Studio: built ${count} images in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
  })

  const openSample = (x: Sample) => x.url && setBig({
    url: x.url,
    title: `${names[x.characterId]} · ${MATERIAL_LABEL[x.material]} · holo: ${HOLO_LABEL[x.holo]}`,
    detail: x.dealt ? `${x.dealt} card(s) like this in Fire #${fire.number}; showing #${x.card.serial}.` : 'Not dealt in this Fire (sample render only).',
  })

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Build &amp; Review · Fire #{fire.number}</h2>
        <span className="spacer" />
        {fire.approvedAt && !approvalStale ? <span className="badge badge-ok" data-testid="approved">Approved {new Date(fire.approvedAt).toLocaleString()}</span> : null}
      </div>
      {approvalStale && <Notice kind="warn">Art, frames, layouts or fonts changed after approval. Re-render the samples and approve again.</Notice>}

      {missing.length > 0 && <Notice kind="warn">This Fire deals cards whose frame isn't delivered yet: {missing.join(', ')}. Approval is blocked until they're added.</Notice>}

      <h3>1. Samples: one per character x material x holo type ({samples.length})</h3>
      <div className="row wrap">
        <button onClick={renderSamples} disabled={busy}>Re-render samples</button>
        <button className="primary" onClick={approve} disabled={busy || !samplesReady || missing.length > 0 || (!!fire.approvedAt && !approvalStale)} data-testid="approve-all">Approve all</button>
        <span className="muted small">Nothing is uploaded before approval.</span>
      </div>
      {progress && <ProgressBar value={progress.done / Math.max(1, progress.total)} label={`${progress.what}: ${progress.done} / ${progress.total}`} />}
      <div className="sample-grid" data-testid="sample-grid">
        {samples.map((x) => (
          <figure key={x.key} className={`sample ${x.dealt ? '' : 'not-dealt'}`} onClick={() => openSample(x)}>
            {x.url ? <img src={x.url} alt={x.key} loading="lazy" /> : <div className="sample-ph">...</div>}
            <figcaption>
              <b>{names[x.characterId]}</b> {MATERIAL_LABEL[x.material]} · {HOLO_LABEL[x.holo]}
              <span className="muted small">{x.dealt ? ` ${x.dealt} dealt` : ' not dealt'}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <h3>2. Build the images ({distinctLooks(deal.cards).length} shared by {deal.cards.length} cards)</h3>
      <div className="row wrap">
        <label className="check"><input type="radio" checked={format === 'webp'} onChange={() => setFormat('webp')} /> WEBP (q 0.92)</label>
        <label className="check"><input type="radio" checked={format === 'png'} onChange={() => setFormat('png')} /> PNG</label>
        <button className="primary" onClick={build} disabled={busy} data-testid="build-all">Build all images</button>
        {abort.current && <button onClick={() => abort.current?.abort()}>Cancel</button>}
        {fire.build && <span className={`badge ${buildStale ? 'badge-warn' : 'badge-ok'}`} data-testid="build-status">Built {fire.build.count} images, {fire.build.format.toUpperCase()} · {new Date(fire.build.builtAt).toLocaleTimeString()}{buildStale ? ' · stale, rebuild' : ''}</span>}
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      <h3>3. All cards</h3>
      <CardList fire={fire} names={names} onOpen={setBig} />

      {big && (
        <div className="modal" onClick={() => setBig(null)} data-testid="modal">
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <img src={big.url} alt={big.title} />
            <div>
              <h3>{big.title}</h3>
              <p className="muted">{big.detail}</p>
              <button onClick={() => setBig(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function CardList({ fire, names, onOpen }: { fire: FireRecord; names: Record<string, string>; onOpen: (b: { url: string; title: string; detail: string }) => void }) {
  const deal = fire.deal!
  const [ch, setCh] = useState('')
  const [mat, setMat] = useState('')
  const [holo, setHolo] = useState('')
  const [limit, setLimit] = useState(100)
  const filtered = useMemo(
    () => deal.cards.filter((c) => (!ch || c.characterId === ch) && (!mat || c.material === mat) && (!holo || c.holo === holo)),
    [deal.cards, ch, mat, holo],
  )
  const counts = useMemo(() => {
    const byMat = Object.fromEntries(MATERIALS.map((m) => [m, filtered.filter((c) => c.material === m).length]))
    const byHolo = Object.fromEntries(HOLO_TYPES.map((h) => [h, filtered.filter((c) => c.holo === h).length]))
    return { byMat, byHolo }
  }, [filtered])

  const open = async (c: DealtCard) => {
    const b = await getBlob(renderKey(fire.number, lookKey(lookOf(c))))
    if (!b) {
      alert('Not built yet: use "Build all" first.')
      return
    }
    onOpen({
      url: URL.createObjectURL(b),
      title: cardTitle(c, names[c.characterId]),
      detail: `${MATERIAL_LABEL[c.material]} · holo ${HOLO_LABEL[c.holo]} · ${c.edition} of ${c.editionOf} · pack ${c.pack} slot ${c.slot}`,
    })
  }

  return (
    <div>
      <div className="row wrap">
        <select value={ch} onChange={(e) => setCh(e.target.value)} data-testid="filter-char">
          <option value="">All characters</option>
          {deal.characterIds.map((id) => <option key={id} value={id}>{names[id]}</option>)}
        </select>
        <select value={mat} onChange={(e) => setMat(e.target.value)} data-testid="filter-mat">
          <option value="">All materials</option>
          {MATERIALS.map((m) => <option key={m} value={m}>{MATERIAL_LABEL[m]}</option>)}
        </select>
        <select value={holo} onChange={(e) => setHolo(e.target.value)} data-testid="filter-holo">
          <option value="">All holo types</option>
          {HOLO_TYPES.map((h) => <option key={h} value={h}>{HOLO_LABEL[h]}</option>)}
        </select>
        <b data-testid="filter-count">{filtered.length} cards</b>
        <span className="muted small">
          {MATERIALS.map((m) => `${MATERIAL_LABEL[m]} ${counts.byMat[m]}`).join(' · ')} | {HOLO_TYPES.map((h) => `${HOLO_LABEL[h]} ${counts.byHolo[h]}`).join(' · ')}
        </span>
      </div>
      <table className="cards-table">
        <thead><tr><th>Serial</th><th>Name</th><th>Material</th><th>Holo</th><th>Edition</th><th>Pack/slot</th></tr></thead>
        <tbody>
          {filtered.slice(0, limit).map((c) => (
            <tr key={c.serial} onClick={() => void open(c)}>
              <td>#{c.serial}</td><td>{names[c.characterId]}</td><td><span className={`chip mat-${c.material}`}>{MATERIAL_LABEL[c.material]}</span></td>
              <td>{HOLO_LABEL[c.holo]}</td><td>{c.edition} of {c.editionOf} · Fire #{c.fire}</td><td>{c.pack}/{c.slot}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {limit < filtered.length && <button onClick={() => setLimit((l) => l + 200)}>Show more ({filtered.length - limit} left)</button>}
    </div>
  )
}
