import { useState } from 'react'
import { exportLibrary, importLibrary } from '../backup'
import { AccumulatorBars, DropZone, Notice, NumberInput, ProgressBar, useAction } from '../components'
import { requestPersistence } from '../db'
import { setMockFailNext, setMockPinata, useDevFlags } from '../devFlags'
import { downloadBlob } from '../files'
import { loadSampleAssets } from '../sample'
import { completeness, useStudio } from '../store'

export function Data() {
  const s = useStudio()
  const flags = useDevFlags()
  const [busy, error, run] = useAction()
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [failN, setFailN] = useState(3)

  const doExport = () => run(async () => {
    setStatus('Packing library...')
    const blob = await exportLibrary((d, t) => setProgress(d / Math.max(1, t)))
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    downloadBlob(blob, `card-studio-backup-${stamp}.zip`)
    setProgress(null)
    setStatus(`Backup downloaded (${(blob.size / 1e6).toFixed(1)} MB).`)
  })

  const doImport = (files: File[]) => run(async () => {
    if (!confirm('Import replaces EVERYTHING in this Card Studio (library, frames, layouts, fonts, Fires, accumulators, serial counter) with the backup. Continue?')) return
    setStatus('Importing...')
    const r = await importLibrary(files[0])
    setStatus(`Imported ${r.records} records and ${r.files} files. Rebuild cards for any Fire you still need to export.`)
  })

  return (
    <div className="stack">
      <section className="panel">
        <h2>Backup &amp; move machines</h2>
        <p className="muted">
          Everything lives in this browser's IndexedDB on this machine. Export makes one .zip with the whole library,
          frames, layouts, fonts, Fires, rarity accumulators and the serial counter. Built card images aren't included
          (rebuild them in Build &amp; Review). Import replaces everything with the backup.
        </p>
        <div className="row wrap">
          <button className="primary" onClick={doExport} disabled={busy} data-testid="export-library">Export library (.zip)</button>
          <DropZone accept=".zip,application/zip" onFiles={doImport} className="inline-drop" testId="import-input">
            <span>Import backup (.zip): drop or click</span>
          </DropZone>
          <button onClick={() => void run(async () => setStatus((await requestPersistence()) ? 'Browser agreed to keep this storage.' : 'Browser did not grant persistent storage (data still saved; it may be evicted only under heavy disk pressure).'))}>
            Ask browser to keep storage
          </button>
        </div>
        {progress !== null && <ProgressBar value={progress} />}
        {status && <Notice kind="info">{status}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
      </section>

      <section className="panel">
        <h2>State</h2>
        <div className="row wrap">
          <span>Characters: <b>{s.characters.length}</b> ({s.characters.filter((c) => completeness(c) === 10).length} complete)</span>
          <span>Fires: <b>{s.fires.length}</b></span>
          <span>Next Fire: <b>#{s.global.nextFireNumber}</b></span>
          <span>Next global serial: <b>#{s.global.nextSerial}</b></span>
        </div>
        <AccumulatorBars acc={s.global.accumulators} title="Rarity accumulators (carried into the next Fire)" />
      </section>

      <section className="panel dev">
        <h2>Dev / testing</h2>
        <Notice kind="warn">Placeholders only: three generated test characters, clearly labelled PLACEHOLDER. Replace them with real art. (Frames are built in.)</Notice>
        <div className="row wrap">
          <button onClick={() => void run(async () => { await loadSampleAssets(setStatus) })} disabled={busy} data-testid="load-samples">
            Load sample characters (3)
          </button>
        </div>
        <div className="row wrap">
          <label className="check"><input type="checkbox" checked={flags.mockPinata} onChange={(e) => setMockPinata(e.target.checked)} data-testid="mock-pinata" /> Mock Pinata (no network, fake CIDs; this session only)</label>
          <NumberInput min={0} value={failN} onChange={setFailN} />
          <button disabled={!flags.mockPinata} onClick={() => setMockFailNext(failN)}>Make the mock fail the next {failN} upload attempt(s)</button>
        </div>
      </section>
    </div>
  )
}
