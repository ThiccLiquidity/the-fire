import { useState } from 'react'
import { renderKey } from '../builder'
import { Field, Notice, ProgressBar, useAction } from '../components'
import { getBlob } from '../db'
import { ZipWriter, blobBytes, downloadBlob } from '../files'
import { cardMetadata, imageFileName, metadataFileName } from '../metadata'
import { clearPinataJwt, hasPinataJwt, mockTransport, realTransport, setPinataJwt, uploadFire, type UploadFile } from '../pinata'
import { sha256Hex } from '../prng'
import { lastAssetChange, updateFire, useStudio } from '../store'
import { fireStatus, type FireRecord } from '../types'
import { refreshDevFlags, useDevFlags } from '../devFlags'

export function Export({ fire }: { fire: FireRecord }) {
  const s = useStudio()
  const flags = useDevFlags()
  const names = Object.fromEntries(s.characters.map((c) => [c.id, c.name]))
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
    if (!fire.approvedAt) blockers.push('Approve the samples first (Build & Review).')
    else if (changed > fire.approvedAt) blockers.push('Assets changed after approval: re-approve on Build & Review.')
    if (!fire.build) blockers.push('Build all cards first (Build & Review).')
    else {
      if (fire.build.count !== deal.cards.length) blockers.push(`Only ${fire.build.count} of ${deal.cards.length} cards are built: rebuild.`)
      if (changed > fire.build.builtAt) blockers.push('Assets changed after the build: rebuild.')
    }
  }
  const ready = blockers.length === 0
  const format = fire.build?.format ?? 'webp'

  async function imageFiles(onEach?: (i: number) => void): Promise<UploadFile[]> {
    const out: UploadFile[] = []
    let i = 0
    for (const c of deal!.cards) {
      const b = await getBlob(renderKey(fire.number, c.serial))
      if (!b) throw new Error(`Card #${c.serial} is missing from the build; rebuild.`)
      out.push({ name: imageFileName(c, format), blob: b })
      onEach?.(++i)
    }
    return out
  }

  const downloadZip = () => run(async () => {
    const zip = new ZipWriter()
    const total = deal!.cards.length
    let i = 0
    const imagesCid = fire.upload?.imagesCid
    for (const c of deal!.cards) {
      const b = await getBlob(renderKey(fire.number, c.serial))
      if (!b) throw new Error(`Card #${c.serial} is missing from the build; rebuild.`)
      const img = imageFileName(c, format)
      zip.addStored(`images/${img}`, await blobBytes(b))
      const meta = cardMetadata(c, names[c.characterId] ?? c.characterId, imagesCid ? `ipfs://${imagesCid}/${img}` : `images/${img}`)
      zip.addText(`metadata/${metadataFileName(c)}`, JSON.stringify(meta, null, 2))
      if (++i % 25 === 0) {
        setProgress({ value: i / total, label: `Zipping ${i} / ${total}` })
        await new Promise((r) => setTimeout(r, 0))
      }
    }
    zip.addText('fire.json', JSON.stringify({
      fire: fire.number, packs: deal!.packs, seed: deal!.seed, method: deal!.method, characters: deal!.characterIds.map((id) => ({ id, name: names[id] })),
      pool: deal!.pool, firstSerial: deal!.firstSerial, lastSerial: deal!.nextSerial - 1, accumulatorsBefore: deal!.accumulatorsBefore,
      accumulatorsAfter: deal!.accumulatorsAfter, packContents: deal!.packContents, upload: fire.upload ?? null,
      note: imagesCid ? 'image fields point at the uploaded images directory' : 'image fields are relative paths inside this zip until the images are uploaded',
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
    const files = await imageFiles((i) => { if (i % 50 === 0) setProgress({ value: 0, label: `Reading built cards ${i}/${deal!.cards.length}` }) })
    // Directory names carry a fingerprint of their contents, so "find an earlier finished upload by name" can only
    // ever match an upload of exactly these files.
    const imgFp = sha256Hex(files.map((f) => `${f.name}:${f.blob.size}`).join('|')).slice(0, 10)
    let current = { ...(fire.upload ?? {}) }
    const transport = flags.mockPinata ? mockTransport : realTransport
    const result = await uploadFire({
      fire: fire.number,
      imageFiles: files,
      imagesDirName: `fire-${fire.number}-images-${imgFp}`,
      metadataDirName: undefined,
      makeMetadata: (cid) => deal!.cards.map((c) => ({
        name: metadataFileName(c),
        blob: new Blob([JSON.stringify(cardMetadata(c, names[c.characterId] ?? c.characterId, `ipfs://${cid}/${imageFileName(c, format)}`), null, 2)], { type: 'application/json' }),
      })),
      existing: { imagesCid: current.imagesCid, metadataCid: current.metadataCid },
      save: async (patch) => {
        const now = Date.now()
        current = {
          ...current, ...patch, format, mock: flags.mockPinata,
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
    if (!confirm('Forget the saved CIDs for this Fire? (Nothing is deleted on Pinata.)')) return
    await updateFire(fire.number, { upload: undefined })
  })

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Export &amp; Upload · Fire #{fire.number}</h2>
        <span className={`badge status-${fireStatus(fire)}`}>{fireStatus(fire)}</span>
      </div>
      {!ready && <Notice kind="warn">{blockers.map((b) => <div key={b}>{b}</div>)}</Notice>}

      <h3>Download</h3>
      <p className="muted small">A zip with images/&lt;serial&gt;.{format}, metadata/&lt;serial&gt;.json (ERC-721 style) and fire.json (the deal record).</p>
      <button className="primary" disabled={!ready || busy} onClick={downloadZip} data-testid="download-zip">Download zip</button>

      <h3>Upload to Pinata (IPFS)</h3>
      <p className="muted small">
        The JWT is kept in this tab's memory only: never saved, never logged. Reloading forgets it. Images go up as one
        folder, then the metadata folder pointing at ipfs://&lt;images CID&gt;/&lt;file&gt;. Finished steps are saved
        on the Fire and skipped if you run it again.
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
            <tr><td>Metadata CID</td><td><code>{fire.upload.metadataCid ?? '-'}</code></td></tr>
            <tr><td>Token URI</td><td><code>{fire.upload.metadataCid ? `ipfs://${fire.upload.metadataCid}/<serial>.json` : '-'}</code></td></tr>
            {fire.upload.mock && <tr><td colSpan={2}><span className="tag">mock upload</span></td></tr>}
          </tbody>
        </table>
      )}
      {log.length > 0 && <pre className="log" data-testid="upload-log">{log.join('\n')}</pre>}
      {flags.mockPinata && flags.mockFailNext > 0 && <p className="muted small">Mock will fail the next {flags.mockFailNext} upload(s).</p>}
    </section>
  )
}
