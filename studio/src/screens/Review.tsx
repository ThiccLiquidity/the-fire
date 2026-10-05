import { useEffect, useMemo, useRef, useState } from 'react'
import { BatchRenderer, renderKey } from '../builder'
import { Notice, ProgressBar, useAction } from '../components'
import { blobKeys, deleteBlobsWithPrefix, getBlob, putBlobs } from '../db'
import type { DealtCard } from '../deal'
import { hasFrame } from '../frames'
import { GRADE_STATES, IMAGES_PER_CHARACTER, gridSize, holosFor, lookFileName, lookKey, lookOf, seriesGrid, type Look } from '../looks'
import { cardTitle } from '../render'
import { HOLO_LABEL, HOLO_TYPES, MATERIALS, MATERIAL_LABEL, WEAR_LABEL, wearLookOf, type HoloType, type Material } from '../rules'
import { lastAssetChange, updateFire, useStudio } from '../store'
import { BUILD_GRID_VERSION, type FireRecord } from '../types'

interface Sample {
  key: string
  characterId: string
  material: Material
  holo: HoloType
  card: DealtCard
  dealt: number
  url?: string
}

/** One sample per character x material x holo type (19 per character: Diamond is always holo), ungraded, from the
 *  first dealt card of that kind when there is one. */
function sampleCards(fire: FireRecord): Sample[] {
  const deal = fire.deal!
  const first = new Map<string, DealtCard>()
  const count = new Map<string, number>()
  for (const c of deal.cards) {
    const k = `${c.characterId}:${c.material}:${c.holo}`
    if (!first.has(k)) first.set(k, c)
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  const out: Sample[] = []
  for (const characterId of deal.characterIds) {
    for (const material of MATERIALS) {
      for (const holo of holosFor(material)) {
        const key = `${characterId}:${material}:${holo}`
        const card: DealtCard = { ...(first.get(key) ?? {
          serial: 0, fire: fire.number, pack: 0, slot: 0, material, characterId,
          holoFrame: holo === 'frame' || holo === 'full', holoPicture: holo === 'picture' || holo === 'full', holo, edition: 1, editionOf: 1,
        }), grade: null }
        out.push({ key, characterId, material, holo, card, dealt: count.get(key) ?? 0 })
      }
    }
  }
  return out
}

/** Frames the full grid needs (every material x holo x grade state) that aren't built in. */
function missingGridFrames(): string[] {
  const out = new Set<string>()
  for (const m of MATERIALS) {
    for (const h of holosFor(m)) {
      const v = h === 'frame' || h === 'full' ? 'holo' : 'normal'
      for (const g of GRADE_STATES) {
        const w = wearLookOf(g)
        if (!hasFrame(m, v, w)) out.add(`${MATERIAL_LABEL[m]} ${v}${g == null ? '' : ` ${WEAR_LABEL[w]}`}`)
      }
    }
  }
  return [...out]
}

const fmtMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`

export function Review({ fire }: { fire: FireRecord }) {
  const s = useStudio()
  if (!fire.deal) return <section className="panel grow"><Notice kind="warn">Lock the deal for Series {fire.number} first (Deal tab).</Notice></section>
  return <ReviewInner fire={fire} names={Object.fromEntries(s.characters.map((c) => [c.id, c.name]))} />
}

function ReviewInner({ fire, names }: { fire: FireRecord; names: Record<string, string> }) {
  const deal = fire.deal!
  const [samples, setSamples] = useState<Sample[]>(() => sampleCards(fire))
  const [progress, setProgress] = useState<{ done: number; total: number; what: string } | null>(null)
  const [busy, error, run] = useAction()
  const [big, setBig] = useState<{ url: string; title: string; detail: string } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const grid = useMemo(() => seriesGrid(fire.number, deal.characterIds), [fire.number, deal.characterIds])
  const assetsChanged = lastAssetChange(deal.characterIds)
  const approvalStale = !!fire.approvedAt && assetsChanged > fire.approvedAt
  const b = fire.build
  const buildOld = !!b && (b.grid !== BUILD_GRID_VERSION || b.format !== 'webp')
  const buildStale = !!b && (assetsChanged > b.builtAt || buildOld || b.count !== grid.length)
  const samplesReady = samples.every((x) => x.url)
  const missing = useMemo(missingGridFrames, [])

  // free sample object URLs on unmount
  const urls = useRef<string[]>([])
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u) }, [])

  const renderSamples = () => run(async () => {
    const list = sampleCards(fire)
    setSamples(list)
    const r = await BatchRenderer.create(deal.characterIds)
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

  /** The full grid: every character x material x holo x grade state (209 per character), WEBP only. Rendered on the
   *  worker pool two at a time; each finished batch goes straight to IndexedDB and is dropped, so memory stays flat
   *  however big the Series is. */
  const build = () => run(async () => {
    const ctrl = new AbortController()
    abort.current = ctrl
    await deleteBlobsWithPrefix(`render:${fire.number}:`)
    await updateFire(fire.number, { build: undefined })
    const t0 = performance.now()
    let bytes = 0
    const r = await BatchRenderer.create(deal.characterIds, true)
    try {
      await r.renderAll(grid.map((g) => g.card), 'webp', {
        batchSize: 2,
        signal: ctrl.signal,
        onProgress: (p) => setProgress({ ...p, what: `Building ${grid.length} images (${deal.characterIds.length} x ${IMAGES_PER_CHARACTER}), WEBP (${r.mode})` }),
        onBatch: (_cards, blobs, start) => {
          for (const b of blobs) bytes += b.size
          return putBlobs(blobs.map((b, i) => [renderKey(fire.number, grid[start + i].key), b]))
        },
      })
    } finally {
      r.dispose()
      setProgress(null)
      abort.current = null
    }
    const have = new Set(await blobKeys(`render:${fire.number}:`))
    const count = grid.filter((g) => have.has(renderKey(fire.number, g.key))).length
    const ms = performance.now() - t0
    await updateFire(fire.number, { build: { format: 'webp', count, builtAt: Date.now(), grid: BUILD_GRID_VERSION, bytes, ms } })
    console.info(`Card Studio: built ${count} images (${fmtMB(bytes)}) in ${(ms / 1000).toFixed(1)}s`)
  })

  const openSample = (x: Sample) => x.url && setBig({
    url: x.url,
    title: `${names[x.characterId]} · ${MATERIAL_LABEL[x.material]} · holo: ${HOLO_LABEL[x.holo]}`,
    detail: x.dealt ? `${x.dealt} card(s) like this in Series ${fire.number}; showing it ungraded.` : 'Not dealt in this Series (sample render only).',
  })

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Build &amp; Review · Series {fire.number}</h2>
        <span className="spacer" />
        {fire.approvedAt && !approvalStale ? <span className="badge badge-ok" data-testid="approved">Approved {new Date(fire.approvedAt).toLocaleString()}</span> : null}
      </div>
      {approvalStale && <Notice kind="warn">Art, frames, layouts or fonts changed after approval. Re-render the samples and approve again.</Notice>}

      {missing.length > 0 && <Notice kind="warn">The full image grid needs frames that aren't delivered yet: {missing.join(', ')}. Approval is blocked until they're added.</Notice>}

      <h3>1. Samples: one per character x material x holo type, ungraded ({samples.length})</h3>
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

      <h3>2. Build the images: the full grid ({grid.length} = {deal.characterIds.length} character{deal.characterIds.length === 1 ? '' : 's'} x {IMAGES_PER_CHARACTER})</h3>
      <p className="muted small">
        Every character x material x holo type (19: Diamond is always holo) x grade state (ungraded and PDA 1-10, each
        with its wear frame and seal number) = {IMAGES_PER_CHARACTER} images per character, whatever the sample deal
        dealt: grades are revealed on-chain later and every card's image must already be in the folder. WEBP only (q 0.92),
        named c&lt;character&gt;-&lt;material&gt;-&lt;holo&gt;-&lt;grade&gt;.webp as the card contract expects.
      </p>
      <div className="row wrap">
        <button className="primary" onClick={build} disabled={busy} data-testid="build-all">Build all {grid.length} images</button>
        {abort.current && <button onClick={() => abort.current?.abort()} data-testid="cancel-build">Cancel</button>}
        {b && (
          <span className={`badge ${buildStale ? 'badge-warn' : 'badge-ok'}`} data-testid="build-status">
            Built {b.count} of {gridSize(deal.characterIds.length)} images, {b.format.toUpperCase()}
            {b.bytes != null ? ` · ${fmtMB(b.bytes)}` : ''}{b.ms != null ? ` · ${(b.ms / 1000).toFixed(0)} s` : ''}
            {' · '}{new Date(b.builtAt).toLocaleTimeString()}
            {buildOld ? ' · older build, rebuild' : buildStale ? ' · stale, rebuild' : ''}
          </span>
        )}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {b && !buildOld && b.count > 0 && <GridViewer fire={fire} names={names} onOpen={setBig} />}

      <h3>3. All cards</h3>
      <CardList fire={fire} names={names} onOpen={setBig} />

      {big && (
        <div className="modal" onClick={() => setBig(null)} data-testid="modal">
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <img src={big.url} alt={big.title} />
            <div>
              <h3>{big.title}</h3>
              <p className="muted" data-testid="modal-detail">{big.detail}</p>
              <button onClick={() => setBig(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/** Look up any built image of the grid by character, material, holo and grade, with its file name. */
function GridViewer({ fire, names, onOpen }: { fire: FireRecord; names: Record<string, string>; onOpen: (b: { url: string; title: string; detail: string }) => void }) {
  const deal = fire.deal!
  const [ch, setCh] = useState(0)
  const [mat, setMat] = useState<Material>('wood')
  const [holo, setHolo] = useState<HoloType>('none')
  const [grade, setGrade] = useState<string>('u')
  const holos = holosFor(mat)
  const h = holos.includes(holo) ? holo : holos[0]
  const g = grade === 'u' ? null : Number(grade)
  const look: Look = {
    characterId: deal.characterIds[ch], material: mat, holoFrame: h === 'frame' || h === 'full', holoPicture: h === 'picture' || h === 'full',
    grade: g, fire: fire.number,
  }
  const file = lookFileName(look, ch)
  const open = async () => {
    const blob = await getBlob(renderKey(fire.number, lookKey(look)))
    if (!blob) { alert('Not built yet: use "Build all" first.'); return }
    onOpen({
      url: URL.createObjectURL(blob),
      title: file,
      detail: `${names[look.characterId]} · ${MATERIAL_LABEL[mat]} · holo ${HOLO_LABEL[h]} · ${g == null ? 'ungraded' : `PDA ${g} (${WEAR_LABEL[wearLookOf(g)]} frame)`} · ${(blob.size / 1024).toFixed(0)} KB`,
    })
  }
  return (
    <div className="row wrap" data-testid="grid-viewer">
      <span className="muted small">Check a built image:</span>
      <select value={ch} onChange={(e) => setCh(Number(e.target.value))} data-testid="gv-char">
        {deal.characterIds.map((id, i) => <option key={id} value={i}>c{i} {names[id]}</option>)}
      </select>
      <select value={mat} onChange={(e) => setMat(e.target.value as Material)} data-testid="gv-mat">
        {MATERIALS.map((m) => <option key={m} value={m}>{MATERIAL_LABEL[m]}</option>)}
      </select>
      <select value={h} onChange={(e) => setHolo(e.target.value as HoloType)} data-testid="gv-holo">
        {holos.map((x) => <option key={x} value={x}>{HOLO_LABEL[x]}</option>)}
      </select>
      <select value={grade} onChange={(e) => setGrade(e.target.value)} data-testid="gv-grade">
        {GRADE_STATES.map((x) => <option key={x ?? 'u'} value={x ?? 'u'}>{x == null ? 'Ungraded' : `PDA ${x}`}</option>)}
      </select>
      <code data-testid="gv-file">{file}</code>
      <button onClick={() => void open()} data-testid="gv-open">Open</button>
    </div>
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
              <td>{HOLO_LABEL[c.holo]}</td><td>{c.edition} of {c.editionOf} · Series {c.fire}</td><td>{c.pack}/{c.slot}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {limit < filtered.length && <button onClick={() => setLimit((l) => l + 200)}>Show more ({filtered.length - limit} left)</button>}
    </div>
  )
}
