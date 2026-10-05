import { useState } from 'react'
import { renderKey } from '../builder'
import { Field, Notice, ProgressBar, useAction } from '../components'
import { getBlob } from '../db'
import { ZipWriter, blobBytes, downloadBlob } from '../files'
import { effectiveDiamonds, type DealtCard } from '../deal'
import { gridSize, lookFileName, lookOf, seriesGrid } from '../looks'
import { cardMetadata, metadataFileName } from '../metadata'
import { clearPinataJwt, hasPinataJwt, metadataDirName, mockTransport, realTransport, setPinataJwt, uploadFire, type UploadFile } from '../pinata'
import { sha256Hex } from '../prng'
import { categoryProblem, nameProblem, normalizeCategory, normalizeName } from '../categories'
import { MAX_CHARACTERS } from '../rules'
import { lastAssetChange, updateFire, useStudio } from '../store'
import { BUILD_GRID_VERSION, fireStatus, type FireRecord } from '../types'
import { refreshDevFlags, useDevFlags } from '../devFlags'

export function Export({ fire }: { fire: FireRecord }) {
  const s = useStudio()
  const flags = useDevFlags()
  const names = Object.fromEntries(s.characters.map((c) => [c.id, c.name]))
  const chars = Object.fromEntries(s.characters.map((c) => [c.id, c]))
  const charOf = (id: string) => ({ id, name: chars[id]?.name ?? id, category: chars[id]?.category })
  const [busy, error, run] = useAction()
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [jwtInput, setJwtInput] = useState('')
  const [keySet, setKeySet] = useState(hasPinataJwt())

  const deal = fire.deal
  const changed = deal ? lastAssetChange(deal.characterIds) : 0
  const blockers: string[] = []
  if (!deal) blockers.push('Lock the deal first (Deal tab).')
  else {
    if (deal.packs < 1 || !deal.cards.length) blockers.push('This Series has no packs: undo the lock, set the packs and deal again.')
    if (deal.characterIds.length > MAX_CHARACTERS) blockers.push(`A Series has at most ${MAX_CHARACTERS} characters.`)
    for (const id of deal.characterIds) {
      const c = chars[id]
      const np = c ? nameProblem(normalizeName(c.name)) : 'missing'
      const cp = c ? categoryProblem(normalizeCategory(c.category ?? '')) : null
      if (np) blockers.push(`Character "${c?.name ?? id}": name ${np} (Library).`)
      else if (cp) blockers.push(`${c.name}: category ${cp} (Library).`)
    }
    if (!fire.approvedAt) blockers.push('Approve the samples first (Build & Review).')
    else if (changed > fire.approvedAt) blockers.push('Assets changed after approval: re-approve on Build & Review.')
    if (!fire.build) blockers.push('Build all images first (Build & Review).')
    else if (fire.build.grid !== BUILD_GRID_VERSION || fire.build.format !== 'webp') {
      blockers.push('This build is from an older version of the studio (sample looks only, or PNG): rebuild the full WEBP grid.')
    } else {
      const want = gridSize(deal.characterIds.length)
      if (fire.build.count !== want) blockers.push(`Only ${fire.build.count} of ${want} images are built: rebuild.`)
      if (changed > fire.build.builtAt) blockers.push('Assets changed after the build: rebuild.')
    }
  }
  const ready = blockers.length === 0
  /** The shared image file this card points at (the name FireCards.imageFile builds on-chain). */
  const fileOf = (c: DealtCard) => lookFileName(lookOf(c), deal!.characterIds.indexOf(c.characterId))

  /** The full grid, one file per image (209 per character), read from IndexedDB one at a time. The blobs stay
   *  IndexedDB-backed, so this list doesn't hold the image bytes in memory. */
  async function imageFiles(onEach?: (i: number, total: number) => void): Promise<UploadFile[]> {
    const out: UploadFile[] = []
    const grid = seriesGrid(fire.number, deal!.characterIds)
    for (const g of grid) {
      const b = await getBlob(renderKey(fire.number, g.key))
      if (!b) throw new Error(`An image (${g.file}) is missing from the build; rebuild.`)
      out.push({ name: g.file, blob: b })
      onEach?.(out.length, grid.length)
    }
    return out
  }

  const downloadZip = () => run(async () => {
    const zip = new ZipWriter()
    const total = deal!.cards.length
    let i = 0
    const imagesCid = fire.upload?.imagesCid
    for (const f of await imageFiles((n, t) => { if (n % 50 === 0) setProgress({ value: n / t, label: `Zipping images ${n} / ${t}` }) })) {
      zip.addStored(`images/${f.name}`, await blobBytes(f.blob))
    }
    for (const c of deal!.cards) {
      const img = fileOf(c)
      const meta = cardMetadata(c, charOf(c.characterId), imagesCid ? `ipfs://${imagesCid}/${img}` : `images/${img}`)
      zip.addText(`metadata/${metadataFileName(c)}`, JSON.stringify(meta, null, 2))
      if (++i % 25 === 0) {
        setProgress({ value: i / total, label: `Zipping ${i} / ${total}` })
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    zip.addText('fire.json', JSON.stringify({
      fire: fire.number, packs: deal!.packs, seed: deal!.seed, method: deal!.method, characters: deal!.characterIds.map((id) => ({ id, name: names[id], category: chars[id]?.category ?? '' })),
      // the arguments for FireCards.configureFire, in the order the image files use (c0, c1, ...)
      configureFire: {
        fire: fire.number, names: deal!.characterIds.map((id) => names[id]),
        categories: deal!.characterIds.map((id) => chars[id]?.category ?? ''), base: imagesCid ? `ipfs://${imagesCid}/` : null,
      },
      pool: deal!.pool, firstSerial: deal!.firstSerial, lastSerial: deal!.nextSerial - 1,
      diamonds: effectiveDiamonds(deal!.diamonds ?? fire.diamonds), packContents: deal!.packContents, upload: fire.upload ?? null,
      note: 'On-chain cards use only the images folder: configureFire.base (ipfs://<images CID>/) becomes imagesBase and tokenURI builds each card\'s JSON itself. metadata/ is for preview and reference only. ' +
        (imagesCid ? 'Its image fields point at the uploaded images directory.' : 'Its image fields are relative paths inside this zip until the images are uploaded.'),
    }, null, 1))
    setProgress({ value: 1, label: 'Finishing zip...' })
    const blob = await zip.finish()
    downloadBlob(blob, `card-studio-fire-${fire.number}.zip`)
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
    setProgress({ value: 0, label: 'Reading built cards...' })
    const files = await imageFiles((i, t) => { if (i % 50 === 0) setProgress({ value: 0, label: `Reading built images ${i} / ${t}` }) })
    // The images folder name carries a fingerprint of its contents, so "find an earlier finished upload by name" can
    // only ever match an upload of exactly these files. The metadata folder is named after the images CID.
    const imgFp = sha256Hex(files.map((f) => `${f.name}:${f.blob.size}`).join('|')).slice(0, 10)
    const imagesDirName = `fire-${fire.number}-images-${imgFp}`
    let current = { ...(fire.upload ?? {}) }
    if (current.imagesDir && current.imagesDir !== imagesDirName) {
      // rebuilt since the saved upload: its CIDs belong to other images, so neither is reused
      say(`The images changed since the saved upload (${current.imagesDir}); uploading the new build.`)
      current = {}
    }
    const transport = flags.mockPinata ? mockTransport : realTransport
    const result = await uploadFire({
      fire: fire.number,
      imageFiles: files,
      imagesDirName,
      makeMetadata: (cid) => deal!.cards.map((c) => ({
        name: metadataFileName(c),
        blob: new Blob([JSON.stringify(cardMetadata(c, charOf(c.characterId), `ipfs://${cid}/${fileOf(c)}`), null, 2)], { type: 'application/json' }),
      })),
      existing: { imagesCid: current.imagesCid, metadataCid: current.metadataCid },
      save: async (patch) => {
        const now = Date.now()
        current = {
          ...current, ...patch, format: 'webp', imagesDir: imagesDirName, mock: flags.mockPinata,
          ...(patch.imagesCid ? { imagesAt: now } : {}), ...(patch.metadataCid ? { metadataAt: now } : {}),
        }
        await updateFire(fire.number, { upload: current })
      },
      onStatus: say,
      onProgress: (v) => setProgress({ value: v, label: `Uploading ${(v * 100).toFixed(0)}%` }),
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
      {!ready && <Notice kind="warn">{blockers.map((b) => <div key={b}>{b}</div>)}</Notice>}

      <h3>Download</h3>
      <p className="muted small">A zip with images/ (the full grid, {deal ? gridSize(deal.characterIds.length) : 0} WEBP images, e.g. c0-wood-frame-u.webp or c0-coal-full-10.webp, the names the card contract expects), metadata/&lt;serial&gt;.json (ERC-721 style, one per card of the sample deal, pointing at its shared image; preview/reference only) and fire.json (the deal record and the configureFire arguments).</p>
      <Notice kind="info">
        On-chain, the cards use <b>only the images folder</b>: its <code>ipfs://&lt;images CID&gt;/</code> is the <code>base</code> passed
        to FireCards.configureFire (stored as imagesBase), and tokenURI builds each card's JSON itself from imagesBase + the image
        file name. The per-card metadata JSON is for preview and reference; it is not what wallets and marketplaces read.
      </Notice>
      <button className="primary" disabled={!ready || busy} onClick={downloadZip} data-testid="download-zip">Download zip</button>

      <h3>Upload to Pinata (IPFS)</h3>
      <p className="muted small">
        The JWT is kept in this tab's memory only: never saved, never logged. Reloading forgets it. Images go up as one
        folder (the one that matters on-chain), then the preview metadata folder pointing at ipfs://&lt;images CID&gt;/&lt;file&gt;,
        named fire-&lt;n&gt;-metadata-&lt;last 10 characters of the images CID&gt; so a rebuild never reuses old metadata.
        Finished steps are saved on the Series and skipped if you run it again.
      </p>
      {flags.mockPinata && <Notice kind="warn">Mock Pinata is ON (Data tab): nothing leaves this machine, CIDs are fake.</Notice>}
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setPinataJwt(jwtInput); setJwtInput(''); setKeySet(hasPinataJwt()) }}>
        <Field label="Pinata JWT">
          <input type="password" autoComplete="off" value={jwtInput} onChange={(e) => setJwtInput(e.target.value)} placeholder={keySet ? 'key set for this session' : 'paste JWT'} data-testid="jwt" />
        </Field>
        <button type="submit" disabled={!jwtInput.trim()}>Use key</button>
        {keySet && <button type="button" onClick={() => { clearPinataJwt(); setKeySet(false) }}>Forget key</button>}
      </form>
      <div className="row wrap">
        <button className="primary" disabled={!ready || busy || !keySet} onClick={upload} data-testid="upload">
          {fire.upload?.imagesCid && !fire.upload.metadataCid ? 'Resume upload' : fire.upload?.metadataCid ? 'Upload (already done)' : 'Upload to Pinata'}
        </button>
        {fire.upload && <button disabled={busy} onClick={resetUpload}>Forget CIDs</button>}
      </div>
      {progress && <ProgressBar value={progress.value} label={progress.label} />}
      {error && <Notice kind="error">{error}</Notice>}
      {fire.upload && (
        <table className="mini" data-testid="cids">
          <tbody>
            <tr><td>Images CID</td><td><code>{fire.upload.imagesCid ?? '-'}</code></td></tr>
            <tr><td>configureFire base (on-chain)</td><td><code data-testid="images-base">{fire.upload.imagesCid ? `ipfs://${fire.upload.imagesCid}/` : '-'}</code></td></tr>
            <tr><td>Metadata CID (preview only)</td><td><code>{fire.upload.metadataCid ?? '-'}</code>{fire.upload.imagesCid ? <span className="muted small"> {metadataDirName(fire.number, fire.upload.imagesCid)}/</span> : null}</td></tr>
            {fire.upload.mock && <tr><td colSpan={2}><span className="tag">mock upload</span></td></tr>}
          </tbody>
        </table>
      )}
      {log.length > 0 && <pre className="log" data-testid="upload-log">{log.join('\n')}</pre>}
      {flags.mockPinata && flags.mockFailNext > 0 && <p className="muted small">Mock will fail the next {flags.mockFailNext} upload(s).</p>}
    </section>
  )
}
