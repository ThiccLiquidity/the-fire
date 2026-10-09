import { useState } from 'react'
import { exportLibrary, importLibrary } from '../backup'
import { DropZone, Notice, NumberInput, ProgressBar, useAction } from '../components'
import { requestPersistence } from '../db'
import { setMockFailNext, setMockPinata, useDevFlags } from '../devFlags'
import { canSaveToFile, downloadBlob, pickSaveFile } from '../files'
import { loadSampleAssets } from '../sample'
import { isReady, useStudio } from '../store'

export function Data() {
  const s = useStudio()
  const flags = useDevFlags()
  const [busy, error, run] = useAction()
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [failN, setFailN] = useState(3)

  const doExport = () => run(async () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
    const name = `card-studio-backup-${stamp}.zip`
    // straight to a file where the browser can (Chrome, Edge): a big library never sits in memory
    const sink = canSaveToFile() ? await pickSaveFile(name, 'Card Studio backup', { 'application/zip': ['.zip'] }) : undefined
    setStatus('Packing library...')
    try {
      const blob = await exportLibrary((d, t) => setProgress(d / Math.max(1, t)), sink)
      if (blob) downloadBlob(blob, name)
      setStatus(blob ? `Backup downloaded (${(blob.size / 1e6).toFixed(1)} MB).` : `Backup saved (${name}).`)
    } finally {
      setProgress(null)
    }
  })

  const doImport = (files: File[]) => run(async () => {
    if (!confirm('Import replaces EVERYTHING in this Card Studio (library, frames, layouts, fonts, Series, serial counter) with the backup. Continue?')) return
    setStatus('Importing...')
    const r = await importLibrary(files[0], (d, t) => setProgress(d / Math.max(1, t))).finally(() => setProgress(null))
    setStatus(`Imported ${r.records} records and ${r.files} files. Rebuild cards for any Series you still need to export.`)
  })

  return (
    <div className="stack">
      <section className="panel">
        <h2>Backup &amp; move machines</h2>
        <p className="muted">
          Everything lives in this browser's IndexedDB on this machine. Export makes one .zip with the whole library,
          frames, layouts, fonts, Series and the serial counter. Built card images aren't included
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
          <span>Characters: <b>{s.characters.length}</b> ({s.characters.filter(isReady).length} ready)</span>
          <span>Series: <b>{s.fires.length}</b></span>
          <span>Next Series: <b>#{s.global.nextFireNumber}</b></span>
          <span>Next global serial: <b>#{s.global.nextSerial}</b></span>
        </div>
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
          <label className="check"><input type="checkbox" checked={flags.mockPinata} onChange={(e) => setMockPinata(e.target.checked)} data-testid="mock-pinata" /> Mock IPFS: Pinata and Filebase (no network, nothing stored; this session only)</label>
          <NumberInput min={0} value={failN} onChange={setFailN} />
          <button disabled={!flags.mockPinata} onClick={() => setMockFailNext(failN)}>Make the mock fail the next {failN} upload attempt(s)</button>
        </div>
      </section>
    </div>
  )
}
