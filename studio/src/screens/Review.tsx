import { useEffect, useMemo, useRef, useState } from 'react'
import { BatchRenderer, renderKey } from '../builder'
import { Notice, ProgressBar, useAction } from '../components'
import { blobKeys, deleteBlobsWithPrefix, getBlob, putBlobs } from '../db'
import type { DealtCard } from '../deal'
import { GRADE_STATES, imagesPerCharacter, lookFileName, lookKey, lookOf, seriesGrid, type Look } from '../looks'
import { cardTitle, faceOf } from '../render'
import { checkRecipe, holoLooksFor, type Recipe } from '../recipe'
import { HOLO_LABEL, HOLO_TYPES, WEAR_LABEL, wearLookOf, type HoloType } from '../rules'
import { buildGridKey, buildRates, frameSetsOf, missingFrames } from '../series'
import { lastAssetChange, updateFire, useStudio } from '../store'
import { BUILD_GRID_VERSION, type FireRecord } from '../types'

interface Sample {
  key: string
  characterId: string
  type: number
  holo: HoloType
  card: DealtCard
  dealt: number
  url?: string
}

/** Characters per page of samples (each brings one sample per type x holo look). */
const SAMPLE_PAGE = 12

/** One sample per character x type x holo look, ungraded, for the characters of one page, from the first dealt card of
 *  that kind when there is one. */
function sampleCards(fire: FireRecord, page: number): Sample[] {
  const deal = fire.deal!
  const r = fire.recipe
  const chars = deal.characterIds.slice(page * SAMPLE_PAGE, page * SAMPLE_PAGE + SAMPLE_PAGE)
  const want = new Set(chars)
  const first = new Map<string, DealtCard>()
  const count = new Map<string, number>()
  for (const c of deal.cards) {
    if (!want.has(c.characterId)) continue
    const k = `${c.characterId}:${c.type}:${c.holo}`
    if (!first.has(k)) first.set(k, c)
    count.set(k, (count.get(k) ?? 0) + 1)
  }
  const out: Sample[] = []
  for (const characterId of chars) {
    r.types.forEach((_, type) => {
      for (const holo of holoLooksFor(r, type)) {
        const key = `${characterId}:${type}:${holo}`
        const card: DealtCard = { ...(first.get(key) ?? {
          serial: 0, fire: fire.number, pack: 0, slot: 0, group: 0, type, characterId,
          holoFrame: holo === 'frame' || holo === 'full', holoPicture: holo === 'picture' || holo === 'full', holo, edition: 1, editionOf: 1,
        }), grade: null }
        out.push({ key, characterId, type, holo, card, dealt: count.get(key) ?? 0 })
      }
    })
  }
  return out
}

const fmtMB = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`)
const fmtTime = (ms: number) => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`)

export function Review({ fire }: { fire: FireRecord }) {
  const s = useStudio()
  if (!fire.deal) return <section className="panel grow"><Notice kind="warn">Lock the deal for Series {fire.number} first (Deal tab).</Notice></section>
  return <ReviewInner fire={fire} names={Object.fromEntries(s.characters.map((c) => [c.id, c.name]))} />
}

function ReviewInner({ fire, names }: { fire: FireRecord; names: Record<string, string> }) {
  const s = useStudio()
  const deal = fire.deal!
  const r = fire.recipe
  const [page, setPage] = useState(0)
  const [samples, setSamples] = useState<Sample[]>(() => sampleCards(fire, 0))
  const [progress, setProgress] = useState<{ done: number; total: number; what: string } | null>(null)
  const [busy, error, run] = useAction()
  const [big, setBig] = useState<{ url: string; title: string; detail: string } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const grid = useMemo(() => seriesGrid(fire.number, deal.characterIds, r), [fire.number, deal.characterIds, r])
  const gridKey = useMemo(() => buildGridKey(r, deal.characterIds), [r, deal.characterIds])
  const assetsChanged = lastAssetChange(deal.characterIds)
  const approvalStale = !!fire.approvedAt && assetsChanged > fire.approvedAt
  const b = fire.build
  const buildOld = !!b && (b.grid !== BUILD_GRID_VERSION || b.format !== 'webp')
  const buildStale = !!b && (assetsChanged > b.builtAt || buildOld || b.count !== grid.length || b.gridKey !== gridKey)
  const samplesReady = samples.length > 0 && samples.every((x) => x.url)
  const missing = useMemo(() => missingFrames(r), [r])
  const recipeProblems = useMemo(() => checkRecipe(r), [r])
  const pages = Math.max(1, Math.ceil(deal.characterIds.length / SAMPLE_PAGE))
  const rates = buildRates(s.fires)
  const sets = frameSetsOf(r)

  // free sample object URLs on unmount
  const urls = useRef<string[]>([])
  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u) }, [])

  const renderSamples = (p = page) => run(async () => {
    const list = sampleCards(fire, p)
    setSamples(list)
    const rr = await BatchRenderer.create(list.map((x) => x.characterId).filter((v, i, a) => a.indexOf(v) === i), false, sets)
    try {
      const next = [...list]
      await rr.renderAll(list.map((x) => faceOf(x.card, r)), 'webp', {
        batchSize: 2,
        onProgress: (pr) => setProgress({ ...pr, what: `Rendering samples (${rr.mode})` }),
        onBatch: (_cards, blobs, start) => {
          blobs.forEach((bl, j) => {
            const url = URL.createObjectURL(bl)
            urls.current.push(url)
            next[start + j] = { ...next[start + j], url }
          })
          setSamples([...next])
        },
      })
    } finally {
      rr.dispose()
      setProgress(null)
    }
  })

  const autoStarted = useRef(false)
  useEffect(() => {
    if (autoStarted.current) return // StrictMode runs effects twice in dev
    autoStarted.current = true
    void renderSamples(0)
  }, [])

  const blockers: string[] = []
  if (recipeProblems.length) blockers.push(`The recipe has problems (Recipe tab): ${recipeProblems[0].message}`)
  for (const m of missing) blockers.push(`Missing frames for ${m.type}: ${m.missing.join(', ')}. Build them with frames-src/clean_frames.py (README), or give the type another frame set on the Recipe tab.`)

  const approve = () => run(async () => {
    if (blockers.length) throw new Error(blockers[0])
    if (!samplesReady) throw new Error('Render the samples first.')
    await updateFire(fire.number, { approvedAt: Date.now() })
  })

  /** The full grid of the recipe: every character x type x holo look x grade state, WEBP only. Rendered on the worker
   *  pool two at a time; each finished batch goes straight to IndexedDB and is dropped, so memory stays flat however
   *  big the Series is. */
  const build = () => run(async () => {
    if (blockers.length) throw new Error(blockers[0])
    const ctrl = new AbortController()
    abort.current = ctrl
    await deleteBlobsWithPrefix(`render:${fire.number}:`)
    await updateFire(fire.number, { build: undefined })
    const t0 = performance.now()
    let bytes = 0
    const rr = await BatchRenderer.create(deal.characterIds, true, sets)
    try {
      await rr.renderAll(grid.map((g) => faceOf(g.card, r)), 'webp', {
        batchSize: 2,
        signal: ctrl.signal,
        onProgress: (p) => setProgress({ ...p, what: `Building ${grid.length.toLocaleString()} images (${deal.characterIds.length} x ${imagesPerCharacter(r)}), WEBP (${rr.mode})` }),
        onBatch: (_cards, blobs, start) => {
          for (const bl of blobs) bytes += bl.size
          return putBlobs(blobs.map((bl, i) => [renderKey(fire.number, grid[start + i].key), bl]))
        },
      })
    } finally {
      rr.dispose()
      setProgress(null)
      abort.current = null
    }
    const have = new Set(await blobKeys(`render:${fire.number}:`))
    const count = grid.filter((g) => have.has(renderKey(fire.number, g.key))).length
    const ms = performance.now() - t0
    await updateFire(fire.number, { build: { format: 'webp', count, builtAt: Date.now(), grid: BUILD_GRID_VERSION, bytes, ms, gridKey } })
    console.info(`Card Studio: built ${count} images (${fmtMB(bytes)}) in ${(ms / 1000).toFixed(1)}s`)
  })

  const openSample = (x: Sample) => x.url && setBig({
    url: x.url,
    title: `${names[x.characterId]} · ${r.types[x.type].name} · holo: ${HOLO_LABEL[x.holo]}`,
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
      {blockers.length > 0 && <Notice kind="error"><div data-testid="build-blockers">{blockers.map((x) => <div key={x}>{x}</div>)}</div></Notice>}

      <h3>1. Samples: one per character x type x holo look, ungraded</h3>
      <div className="row wrap">
        {pages > 1 && (
          <>
            <button disabled={busy || page === 0} onClick={() => { setPage(page - 1); void renderSamples(page - 1) }}>Previous characters</button>
            <span className="muted small">Characters {page * SAMPLE_PAGE + 1}-{Math.min(deal.characterIds.length, (page + 1) * SAMPLE_PAGE)} of {deal.characterIds.length}</span>
            <button disabled={busy || page >= pages - 1} onClick={() => { setPage(page + 1); void renderSamples(page + 1) }}>Next characters</button>
          </>
        )}
        <button onClick={() => void renderSamples()} disabled={busy}>Re-render samples</button>
        <button className="primary" onClick={approve} disabled={busy || !samplesReady || blockers.length > 0 || (!!fire.approvedAt && !approvalStale)} data-testid="approve-all">Approve all</button>
        <span className="muted small">Nothing is uploaded before approval.{pages > 1 ? ' Page through the characters to check them all.' : ''}</span>
      </div>
      {progress && <ProgressBar value={progress.done / Math.max(1, progress.total)} label={`${progress.what}: ${progress.done.toLocaleString()} / ${progress.total.toLocaleString()}`} />}
      <div className="sample-grid" data-testid="sample-grid">
        {samples.map((x) => (
          <figure key={x.key} className={`sample ${x.dealt ? '' : 'not-dealt'}`} onClick={() => openSample(x)}>
            {x.url ? <img src={x.url} alt={x.key} loading="lazy" /> : <div className="sample-ph">...</div>}
            <figcaption>
              <b>{names[x.characterId]}</b> {r.types[x.type].name} · {HOLO_LABEL[x.holo]}
              <span className="muted small">{x.dealt ? ` ${x.dealt} dealt` : ' not dealt'}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <h3>2. Build the images: the full grid of this recipe ({grid.length.toLocaleString()} = {deal.characterIds.length.toLocaleString()} character{deal.characterIds.length === 1 ? '' : 's'} x {imagesPerCharacter(r)})</h3>
      <p className="muted small">
        Every character x card type x the holo looks that type can have x grade state (ungraded and PDA 1-10, each with its
        wear frame and seal number): {r.types.map((t, i) => `${t.name} ${holoLooksFor(r, i).length}`).join(', ')} looks, x 11 = {imagesPerCharacter(r)} images per
        character, whatever the sample deal dealt (grades are revealed on-chain later, so every card's image must already be in
        the folder). WEBP only (q 0.92), named c&lt;character&gt;-&lt;type slug&gt;-&lt;holo&gt;-&lt;grade&gt;.webp as the card contract expects.
      </p>
      <p className="small" data-testid="build-estimate">
        Estimate: <b>{grid.length.toLocaleString()} images</b>, about <b>{fmtMB(grid.length * rates.bytes)}</b> and <b>{fmtTime(grid.length * rates.ms)}</b>
        <span className="muted"> ({rates.measured ? 'from earlier builds on this machine' : 'a first guess: ~450 KB and ~0.15 s per image; refined after the first build'}). Stored in this browser; keep enough disk free.</span>
      </p>
      <div className="row wrap">
        <button className="primary" onClick={build} disabled={busy || blockers.length > 0} data-testid="build-all">Build all {grid.length.toLocaleString()} images</button>
        {abort.current && <button onClick={() => abort.current?.abort()} data-testid="cancel-build">Cancel</button>}
        {b && (
          <span className={`badge ${buildStale ? 'badge-warn' : 'badge-ok'}`} data-testid="build-status">
            Built {b.count.toLocaleString()} of {grid.length.toLocaleString()} images, {b.format.toUpperCase()}
            {b.bytes != null ? ` · ${fmtMB(b.bytes)}` : ''}{b.ms != null ? ` · ${fmtTime(b.ms)}` : ''}
            {' · '}{new Date(b.builtAt).toLocaleTimeString()}
            {buildOld ? ' · older build, rebuild' : buildStale ? ' · stale, rebuild' : ''}
          </span>
        )}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {b && !buildOld && b.count > 0 && <GridViewer fire={fire} recipe={r} names={names} onOpen={setBig} />}

      <h3>3. All cards (sample deal)</h3>
      <CardList fire={fire} recipe={r} names={names} onOpen={setBig} />

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

/** Look up any built image of the grid by character, type, holo and grade, with its file name. */
function GridViewer({ fire, recipe, names, onOpen }: { fire: FireRecord; recipe: Recipe; names: Record<string, string>; onOpen: (b: { url: string; title: string; detail: string }) => void }) {
  const deal = fire.deal!
  const [ch, setCh] = useState(0)
  const [type, setType] = useState(0)
  const [holo, setHolo] = useState<HoloType>('none')
  const [grade, setGrade] = useState<string>('u')
  const ty = Math.min(type, recipe.types.length - 1)
  const holos = holoLooksFor(recipe, ty)
  const h = holos.includes(holo) ? holo : holos[0]
  const g = grade === 'u' ? null : Number(grade)
  const c = Math.min(Math.max(0, ch), deal.characterIds.length - 1)
  const look: Look = {
    characterId: deal.characterIds[c], type: ty, slug: recipe.types[ty].slug, holoFrame: h === 'frame' || h === 'full', holoPicture: h === 'picture' || h === 'full',
    grade: g, fire: fire.number,
  }
  const file = lookFileName(look, c)
  const open = async () => {
    const blob = await getBlob(renderKey(fire.number, lookKey(look)))
    if (!blob) { alert('Not built yet: use "Build all" first.'); return }
    onOpen({
      url: URL.createObjectURL(blob),
      title: file,
      detail: `${names[look.characterId]} · ${recipe.types[ty].name} · holo ${HOLO_LABEL[h]} · ${g == null ? 'ungraded' : `PDA ${g} (${WEAR_LABEL[wearLookOf(g)]} frame)`} · ${(blob.size / 1024).toFixed(0)} KB`,
    })
  }
  return (
    <div className="row wrap" data-testid="grid-viewer">
      <span className="muted small">Check a built image:</span>
      {deal.characterIds.length <= 300 ? (
        <select value={c} onChange={(e) => setCh(Number(e.target.value))} data-testid="gv-char">
          {deal.characterIds.map((id, i) => <option key={id} value={i}>c{i} {names[id]}</option>)}
        </select>
      ) : (
        <span>c<input type="number" min={0} max={deal.characterIds.length - 1} value={c} onChange={(e) => setCh(Number(e.target.value) || 0)} data-testid="gv-char" /> {names[deal.characterIds[c]]}</span>
      )}
      <select value={ty} onChange={(e) => setType(Number(e.target.value))} data-testid="gv-type">
        {recipe.types.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}
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

function CardList({ fire, recipe, names, onOpen }: { fire: FireRecord; recipe: Recipe; names: Record<string, string>; onOpen: (b: { url: string; title: string; detail: string }) => void }) {
  const deal = fire.deal!
  const [ch, setCh] = useState('')
  const [type, setType] = useState('')
  const [holo, setHolo] = useState('')
  const [limit, setLimit] = useState(100)
  const filtered = useMemo(
    () => deal.cards.filter((c) => (!ch || c.characterId === ch) && (type === '' || c.type === Number(type)) && (!holo || c.holo === holo)),
    [deal.cards, ch, type, holo],
  )
  const counts = useMemo(() => {
    const byType = recipe.types.map((_, i) => filtered.filter((c) => c.type === i).length)
    const byHolo = Object.fromEntries(HOLO_TYPES.map((h) => [h, filtered.filter((c) => c.holo === h).length]))
    return { byType, byHolo }
  }, [filtered, recipe.types])

  const open = async (c: DealtCard) => {
    const b = await getBlob(renderKey(fire.number, lookKey(lookOf(c, recipe))))
    if (!b) {
      alert('Not built yet: use "Build all" first.')
      return
    }
    const tn = recipe.types[c.type]?.name ?? '?'
    onOpen({
      url: URL.createObjectURL(b),
      title: cardTitle(tn, names[c.characterId], c.serial),
      detail: `${tn} · holo ${HOLO_LABEL[c.holo]} · ${c.edition} of ${c.editionOf} · pack ${c.pack} position ${c.slot} (slot group ${c.group + 1})`,
    })
  }

  return (
    <div>
      <div className="row wrap">
        <select value={ch} onChange={(e) => setCh(e.target.value)} data-testid="filter-char">
          <option value="">All characters</option>
          {deal.characterIds.slice(0, 1000).map((id) => <option key={id} value={id}>{names[id]}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} data-testid="filter-type">
          <option value="">All types</option>
          {recipe.types.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}
        </select>
        <select value={holo} onChange={(e) => setHolo(e.target.value)} data-testid="filter-holo">
          <option value="">All holo types</option>
          {HOLO_TYPES.map((h) => <option key={h} value={h}>{HOLO_LABEL[h]}</option>)}
        </select>
        <b data-testid="filter-count">{filtered.length.toLocaleString()} cards</b>
        <span className="muted small">
          {recipe.types.map((t, i) => `${t.name} ${counts.byType[i]}`).join(' · ')} | {HOLO_TYPES.map((h) => `${HOLO_LABEL[h]} ${counts.byHolo[h]}`).join(' · ')}
        </span>
      </div>
      <table className="cards-table">
        <thead><tr><th>Serial</th><th>Name</th><th>Type</th><th>Holo</th><th>Edition</th><th>Pack/position</th></tr></thead>
        <tbody>
          {filtered.slice(0, limit).map((c) => (
            <tr key={c.serial} onClick={() => void open(c)}>
              <td>#{c.serial}</td><td>{names[c.characterId]}</td><td><span className={`chip mat-${recipe.types[c.type]?.frameSet}`}>{recipe.types[c.type]?.name}</span></td>
              <td>{HOLO_LABEL[c.holo]}</td><td>{c.edition} of {c.editionOf} · Series {c.fire}</td><td>{c.pack}/{c.slot}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {limit < filtered.length && <button onClick={() => setLimit((l) => l + 200)}>Show more ({(filtered.length - limit).toLocaleString()} left)</button>}
    </div>
  )
}
