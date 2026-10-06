import { useMemo, useState } from 'react'
import { renderKey } from '../builder'
import { Field, Notice, ProgressBar, useAction } from '../components'
import { getBlob } from '../db'
import { ZipWriter, blobBytes, downloadBlob } from '../files'
import type { DealtCard } from '../deal'
import { lookFileName, lookOf, seriesGrid } from '../looks'
import { cardMetadata, metadataFileName } from '../metadata'
import {
  clearPinataJwt, filesFingerprint, hasPinataJwt, metadataDirName, mockTransport, realTransport, setPinataJwt, uploadFire, type UploadFile,
} from '../pinata'
import { categoryProblem, nameProblem, normalizeCategory, normalizeName } from '../categories'
import { checkRecipe, recipeJson } from '../recipe'
import { saleErrors, saleJson, saleOf } from '../sale'
import { artNeeds, buildGridKey, missingArt, missingFrames } from '../series'
import { lastAssetChange, updateFire, useStudio } from '../store'
import { BUILD_GRID_VERSION, fireStatus, type FireRecord } from '../types'
import { refreshDevFlags, useDevFlags } from '../devFlags'

/** A zip download is split into parts of about this size, so a very large Series never needs one giant zip in memory. */
const ZIP_PART_BYTES = 1.5 * 1024 ** 3

interface Check { label: string; ok: boolean; detail?: string }

export function Export({ fire }: { fire: FireRecord }) {
  const s = useStudio()
  const flags = useDevFlags()
  const chars = useMemo(() => Object.fromEntries(s.characters.map((c) => [c.id, c])), [s.characters])
  // the same trimmed name and category recipe.json puts on-chain
  const charOf = (id: string) => ({ id, name: chars[id] ? normalizeName(chars[id].name) : id, category: normalizeCategory(chars[id]?.category ?? '') })
  const [busy, error, run] = useAction()
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [jwtInput, setJwtInput] = useState('')
  const [keySet, setKeySet] = useState(hasPinataJwt())

  const deal = fire.deal
  const r = fire.recipe
  const ids = deal?.characterIds ?? fire.characterIds
  const recipeProblems = useMemo(() => checkRecipe(r), [r])
  const frames = useMemo(() => missingFrames(r), [r])
  const gridLen = useMemo(() => seriesGrid(fire.number, ids, r).length, [fire.number, ids, r])
  const gridKey = useMemo(() => buildGridKey(r, ids), [r, ids])
  const changed = lastAssetChange(ids)
  const sale = useMemo(() => saleOf(fire), [fire])
  const saleProblems = useMemo(() => saleErrors(sale), [sale])

  const charProblems: string[] = []
  const needs = artNeeds(r)
  for (const id of ids) {
    const c = chars[id]
    if (!c) { charProblems.push(`A character (${id}) no longer exists.`); continue }
    const np = nameProblem(normalizeName(c.name))
    const cp = categoryProblem(normalizeCategory(c.category ?? ''))
    const miss = missingArt(c, needs)
    if (np) charProblems.push(`"${c.name}": name ${np}`)
    else if (cp) charProblems.push(`${c.name}: category ${cp}`)
    else if (miss.length) charProblems.push(`${c.name}: missing ${miss.join(', ')} art`)
  }
  const b = fire.build
  const buildDetail = !b ? 'Build all images (Build & Review).'
    : b.grid !== BUILD_GRID_VERSION || b.format !== 'webp' ? 'This build is from an older version of the studio: rebuild.'
    : b.gridKey !== gridKey ? 'The recipe or characters changed since the build: rebuild.'
    : b.count !== gridLen ? `Only ${b.count.toLocaleString()} of ${gridLen.toLocaleString()} images are built: rebuild.`
    : changed > b.builtAt ? 'Art, layouts or fonts changed after the build: rebuild.' : undefined
  const checks: Check[] = [
    { label: 'Recipe valid (the contract\'s checks)', ok: recipeProblems.length === 0, detail: recipeProblems[0]?.message },
    { label: 'Frames for every card type', ok: frames.length === 0, detail: frames.map((m) => `${m.type}: ${m.missing.join(', ')}`).join('; ') },
    { label: `Characters valid (${ids.length.toLocaleString()}: name, category, art for this recipe)`, ok: ids.length > 0 && charProblems.length === 0, detail: ids.length ? charProblems.slice(0, 3).join('; ') + (charProblems.length > 3 ? ` (+${charProblems.length - 3} more)` : '') : 'Pick characters (Series tab).' },
    { label: 'Deal locked', ok: !!deal && deal.packs > 0, detail: !deal ? 'Lock the deal (Deal tab).' : deal.packs < 1 ? 'No packs: undo the lock, set the packs, deal again.' : undefined },
    { label: 'Samples approved', ok: !!fire.approvedAt && changed <= fire.approvedAt, detail: !fire.approvedAt ? 'Approve on Build & Review.' : 'Assets changed after approval: re-approve.' },
    { label: `Images built for the full grid (${gridLen.toLocaleString()})`, ok: !buildDetail, detail: buildDetail },
  ]
  const saleCheck: Check = { label: 'Sale settings valid (configureDrop\'s checks)', ok: saleProblems.length === 0, detail: saleProblems[0] ? `${saleProblems[0].message} (Sale tab)` : undefined }
  checks.push(saleCheck)
  const ready = checks.every((c) => c.ok)
  const recipeReady = checks[0].ok && checks[2].ok && saleCheck.ok
  /** The shared image file this card points at (the name FireCards.imageName builds on-chain). */
  const indexOf = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids])
  const fileOf = (c: DealtCard) => lookFileName(lookOf(c, r), indexOf.get(c.characterId) ?? -1)

  const recipeOut = (imagesCid?: string) => recipeJson(
    fire.number, r,
    ids.map((id) => ({ name: normalizeName(chars[id]?.name ?? ''), category: normalizeCategory(chars[id]?.category ?? '') })),
    imagesCid ? `ipfs://${imagesCid}/` : undefined,
    saleJson(sale),
  )

  /** The upload is of the current build (only then does recipe.json name its folder as the images base). */
  const uploadCurrent = !!fire.upload?.imagesCid && !fire.upload.mock && !buildDetail && fire.upload.buildAt === b?.builtAt

  const downloadRecipe = () => run(async () => {
    if (!recipeReady) throw new Error(!checks[0].ok ? checks[0].detail : !checks[2].ok ? checks[2].detail : saleCheck.detail)
    if (fire.upload?.imagesCid && !uploadCurrent) {
      throw new Error('The uploaded images are from an earlier build: upload this build first, so recipe.json points at the right images.')
    }
    downloadBlob(new Blob([JSON.stringify(recipeOut(fire.upload?.imagesCid), null, 1)], { type: 'application/json' }), `recipe-fire-${fire.number}.json`)
  })

  /** The full grid, one file per image, read from IndexedDB one at a time (the blobs stay disk-backed). */
  async function imageFiles(onEach?: (i: number, total: number) => void): Promise<UploadFile[]> {
    const out: UploadFile[] = []
    const grid = seriesGrid(fire.number, deal!.characterIds, r)
    for (const g of grid) {
      const bl = await getBlob(renderKey(fire.number, g.key))
      if (!bl) throw new Error(`An image (${g.file}) is missing from the build; rebuild.`)
      out.push({ name: g.file, blob: bl })
      onEach?.(out.length, grid.length)
    }
    return out
  }

  const fireJson = (imagesCid?: string) => JSON.stringify({
    fire: fire.number, packs: deal!.packs, seed: deal!.seed, method: deal!.method,
    characters: deal!.characterIds.map((id, i) => ({ index: i, id, name: chars[id]?.name, category: chars[id]?.category ?? '' })),
    recipe: r, pool: Object.fromEntries(r.types.map((t, i) => [t.slug, deal!.pool[i]])), cardsPerPack: deal!.cardsPerPack,
    firstSerial: deal!.firstSerial, lastSerial: deal!.nextSerial - 1, packContents: deal!.packContents, upload: fire.upload ?? null,
    note: 'On-chain, recipe.json (contracts/script/ConfigureSeries.s.sol) sets the Series up: setRecipe, setCharacters, setDealer, setImagesBase (ipfs://<images CID>/), setOdds. tokenURI builds each card\'s JSON itself; metadata/ here is for preview and reference only. ' +
      (imagesCid ? 'Its image fields point at the uploaded images folder.' : 'Its image fields are relative paths inside this zip until the images are uploaded.'),
  }, null, 1)

  const downloadZip = () => run(async () => {
    const imagesCid = fire.upload?.imagesCid
    const files = await imageFiles((n, t) => { if (n % 200 === 0) setProgress({ value: n / t, label: `Reading images ${n.toLocaleString()} / ${t.toLocaleString()}` }) })
    let part = 1
    let zip = new ZipWriter()
    let size = 0
    const total = files.reduce((n, f) => n + f.blob.size, 0)
    const parts = Math.max(1, Math.ceil(total / ZIP_PART_BYTES))
    const name = (p: number) => (parts > 1 ? `card-studio-fire-${fire.number}-part${p}-of-${parts}.zip` : `card-studio-fire-${fire.number}.zip`)
    // part 1 carries the metadata, fire.json and recipe.json
    zip.addText('fire.json', fireJson(imagesCid))
    zip.addText('recipe.json', JSON.stringify(recipeOut(imagesCid), null, 1))
    let i = 0
    for (const c of deal!.cards) {
      const img = fileOf(c)
      const meta = cardMetadata(c, charOf(c.characterId), r.types[c.type]?.name ?? '?', imagesCid ? `ipfs://${imagesCid}/${img}` : `images/${img}`)
      zip.addText(`metadata/${metadataFileName(c)}`, JSON.stringify(meta, null, 2))
      if (++i % 500 === 0) {
        setProgress({ value: i / deal!.cards.length, label: `Metadata ${i.toLocaleString()} / ${deal!.cards.length.toLocaleString()}` })
        await new Promise((res) => setTimeout(res, 0))
      }
    }
    let n = 0
    for (const f of files) {
      if (size > 0 && size + f.blob.size > ZIP_PART_BYTES) {
        setProgress({ value: n / files.length, label: `Finishing ${name(part)}...` })
        downloadBlob(await zip.finish(), name(part))
        part++
        zip = new ZipWriter()
        size = 0
      }
      zip.addStored(`images/${f.name}`, await blobBytes(f.blob))
      size += f.blob.size
      if (++n % 100 === 0) setProgress({ value: n / files.length, label: `Zipping images ${n.toLocaleString()} / ${files.length.toLocaleString()}${parts > 1 ? ` (part ${part} of ${parts})` : ''}` })
    }
    setProgress({ value: 1, label: 'Finishing zip...' })
    downloadBlob(await zip.finish(), name(part))
    setProgress(null)
  })

  const upload = () => run(async () => {
    try {
      await doUpload()
    } finally {
      refreshDevFlags()
      setProgress(null)
    }
  })

  const doUpload = async () => {
    setLog([])
    const say = (t: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} ${t}`])
    setProgress({ value: 0, label: 'Reading built images...' })
    const files = await imageFiles((i, t) => { if (i % 200 === 0) setProgress({ value: 0, label: `Reading built images ${i.toLocaleString()} / ${t.toLocaleString()}` }) })
    // The images folder name carries a fingerprint of its contents; the metadata folder is named after the images CID.
    const imagesDirName = `fire-${fire.number}-images-${filesFingerprint(files)}`
    let current = { ...(fire.upload ?? {}) }
    if (current.imagesDir && current.imagesDir !== imagesDirName) {
      say(`The images changed since the saved upload (${current.imagesDir}); uploading the new build.`)
      current = {}
    }
    if (!!current.mock !== flags.mockPinata) current = {} // a mock upload is never reused for a real one (or the other way)
    const transport = flags.mockPinata ? mockTransport : realTransport
    const result = await uploadFire({
      fire: fire.number,
      imageFiles: files,
      imagesDirName,
      makeMetadata: (cid) => deal!.cards.map((c) => ({
        name: metadataFileName(c),
        blob: new Blob([JSON.stringify(cardMetadata(c, charOf(c.characterId), r.types[c.type]?.name ?? '?', `ipfs://${cid}/${fileOf(c)}`), null, 2)], { type: 'application/json' }),
      })),
      existing: { imagesCid: current.imagesCid, metadataCid: current.metadataCid, pending: current.pending },
      save: async (patch) => {
        const now = Date.now()
        const { pending, ...rest } = patch
        current = {
          ...current, ...rest, format: 'webp', imagesDir: imagesDirName, mock: flags.mockPinata, buildAt: b?.builtAt,
          ...(patch.imagesCid ? { imagesAt: now } : {}), ...(patch.metadataCid ? { metadataAt: now } : {}),
        }
        if (pending === null) delete current.pending
        else if (pending) current.pending = pending
        await updateFire(fire.number, { upload: current })
      },
      onStatus: say,
      onProgress: (v) => setProgress({ value: v, label: `Uploading ${(v * 100).toFixed(1)}%` }),
    }, transport)
    say(`Images CID ${result.imagesCid}, metadata CID ${result.metadataCid}`)
  }

  const resetUpload = () => run(async () => {
    if (!confirm('Forget the saved CIDs for this Series? (Nothing is deleted on Pinata.)')) return
    await updateFire(fire.number, { upload: undefined })
  })

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Export &amp; Upload · Series {fire.number}</h2>
        <span className={`badge status-${fireStatus(fire)}`}>{fireStatus(fire)}</span>
      </div>
      <h3>Ready?</h3>
      <ul className="checklist" data-testid="checklist">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? 'ok' : 'no'}>
            <span className="mark">{c.ok ? 'OK' : 'NO'}</span> {c.label}
            {!c.ok && c.detail && <div className="muted small">{c.detail}</div>}
          </li>
        ))}
      </ul>

      <h3>recipe.json (sets the Series up on-chain)</h3>
      <p className="muted small">
        The file <code>contracts/script/ConfigureSeries.s.sol</code> reads (<code>RECIPE_JSON=recipe.json</code>): the card types,
        slots, characters in image order and PDA odds, plus <code>imagesBase</code> once the images are uploaded, and the drop's
        settings (the <code>sale</code> block, from the Sale tab). The script checks the recipe against the dealer and prints the
        owner's calls (setRecipe, setCharacters in batches, setDealer, setImagesBase, setOdds, and configureDrop with
        <code>FIRE_SALE</code> set).
      </p>
      <div className="row wrap">
        <button className="primary" disabled={!recipeReady || busy} onClick={downloadRecipe} data-testid="download-recipe">Download recipe.json</button>
        {!fire.upload?.imagesCid && <span className="muted small">No images uploaded yet: imagesBase is left out (the script then leaves the image folder as is).</span>}
      </div>

      <h3>Download everything</h3>
      <p className="muted small">
        A zip with images/ (the full grid, {gridLen.toLocaleString()} WEBP images named as the card contract expects),
        metadata/&lt;serial&gt;.json (one per card of the sample deal, preview only), fire.json (the deal record and the recipe)
        and recipe.json. Big Series come in parts of about 1.5 GB (part 1 also holds the metadata and JSON).
      </p>
      <button className="primary" disabled={!ready || busy} onClick={downloadZip} data-testid="download-zip">Download zip</button>

      <h3>Upload to Pinata (IPFS)</h3>
      <p className="muted small">
        The JWT is kept in this tab's memory only: never saved, never logged. Reloading forgets it. It needs Pinata's Files
        write permission. Each folder is packed here into one CAR file (its CID is worked out before upload) and sent in 50 MB
        pieces that resume after a dropped connection or a reload; Pinata keeps exactly that folder, so its CID is the
        images base. Images first (the folder used on-chain), then the preview metadata named after the images CID.
      </p>
      {flags.mockPinata && <Notice kind="warn">Mock Pinata is ON (Data tab): nothing leaves this machine; the CIDs are the real folder CIDs, but nothing is stored.</Notice>}
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setPinataJwt(jwtInput); setJwtInput(''); setKeySet(hasPinataJwt()) }}>
        <Field label="Pinata JWT">
          <input type="password" autoComplete="new-password" data-1p-ignore="" data-lpignore="true" value={jwtInput} onChange={(e) => setJwtInput(e.target.value)} placeholder={keySet ? 'key set for this session' : 'paste JWT'} data-testid="jwt" />
        </Field>
        <button type="submit" disabled={!jwtInput.trim()}>Use key</button>
        {keySet && <button type="button" onClick={() => { clearPinataJwt(); setKeySet(false) }}>Forget key</button>}
      </form>
      <div className="row wrap">
        <button className="primary" disabled={!ready || busy || !keySet} onClick={upload} data-testid="upload">
          {fire.upload?.pending || (fire.upload?.imagesCid && !fire.upload.metadataCid) ? 'Resume upload' : fire.upload?.metadataCid ? 'Upload (already done)' : 'Upload to Pinata'}
        </button>
        {fire.upload && <button disabled={busy} onClick={resetUpload}>Forget CIDs</button>}
      </div>
      {progress && <ProgressBar value={progress.value} label={progress.label} />}
      {error && <Notice kind="error">{error}</Notice>}
      {fire.upload && (
        <table className="mini" data-testid="cids">
          <tbody>
            <tr><td>Images CID</td><td><code>{fire.upload.imagesCid ?? '-'}</code></td></tr>
            <tr><td>imagesBase (on-chain, in recipe.json)</td><td><code data-testid="images-base">{fire.upload.imagesCid ? `ipfs://${fire.upload.imagesCid}/` : '-'}</code></td></tr>
            <tr><td>Metadata CID (preview only)</td><td><code>{fire.upload.metadataCid ?? '-'}</code>{fire.upload.imagesCid ? <span className="muted small"> {metadataDirName(fire.number, fire.upload.imagesCid)}/</span> : null}</td></tr>
            {fire.upload.pending && <tr><td>Unfinished upload</td><td className="small">{fire.upload.pending.dir} ({(fire.upload.pending.size / 1024 / 1024).toFixed(1)} MB): resumes on the next upload</td></tr>}
            {fire.upload.mock && <tr><td colSpan={2}><span className="tag">mock upload</span></td></tr>}
          </tbody>
        </table>
      )}
      {log.length > 0 && <pre className="log" data-testid="upload-log">{log.join('\n')}</pre>}
      {flags.mockPinata && flags.mockFailNext > 0 && <p className="muted small">Mock will fail the next {flags.mockFailNext} upload(s) halfway.</p>}
    </section>
  )
}
