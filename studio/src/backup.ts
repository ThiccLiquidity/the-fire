/** Whole-studio backup as one .zip: every record (characters, frames, layouts, fonts, Series, serial counter)
 *  plus every stored file (original + keyed art, frames, fonts). Rendered cards are NOT included (they are
 *  rebuilt from the assets in Build & Review), which keeps backups small. Both ways stream: the export writes each
 *  file as it is read (straight to disk where the browser can save to a file), and the import reads the zip in pieces,
 *  so a large library never has to fit in memory twice. */

import * as db from './db'
import { ZipWriter, blobBytes, extOfMime, mimeOfExt, unzipBlobs, type ZipSink } from './files'
import { loadStudio } from './store'
import type { FireRecord } from './types'

const FORMAT = 'card-studio-backup'
const VERSION = 1

interface Manifest {
  format: string
  version: number
  exportedAt: string
  records: [string, unknown][]
  blobs: { key: string; path: string; type: string }[]
}

/** The backup as a zip: written to `sink` as it goes (then null), or returned as a Blob. */
export async function exportLibrary(onProgress?: (done: number, total: number) => void, sink?: ZipSink): Promise<Blob | null> {
  const records = [...(await db.getAllRecords()).entries()]
  const keys = (await db.blobKeys()).filter((k) => !k.startsWith('render:'))
  const zip = new ZipWriter(sink)
  const manifest: Manifest = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), records, blobs: [] }
  let i = 0
  for (const key of keys) {
    const b = await db.getBlob(key)
    if (!b) continue
    const path = `files/${String(i++).padStart(5, '0')}.${extOfMime(b.type)}`
    manifest.blobs.push({ key, path, type: b.type })
    zip.addStored(path, await blobBytes(b))
    await zip.drain()
    onProgress?.(i, keys.length)
  }
  zip.addText('studio.json', JSON.stringify(manifest, null, 1))
  return zip.finish()
}

export async function importLibrary(file: Blob, onProgress?: (read: number, total: number) => void): Promise<{ records: number; files: number }> {
  const entries = await unzipBlobs(file, onProgress)
  const raw = entries.get('studio.json')
  if (!raw) throw new Error('Not a Card Studio backup (studio.json missing).')
  const manifest = JSON.parse(await raw.text()) as Manifest
  if (manifest.format !== FORMAT) throw new Error('Not a Card Studio backup.')
  if (manifest.version > VERSION) throw new Error(`Backup version ${manifest.version} is newer than this Card Studio.`)
  const blobs: [string, Blob][] = []
  for (const b of manifest.blobs) {
    const data = entries.get(b.path)
    if (!data) throw new Error(`Backup is missing ${b.path}.`)
    blobs.push([b.key, new Blob([data], { type: b.type || mimeOfExt(b.path) })])
  }
  // Rendered cards aren't in backups, so a Series' build has to be redone on this machine.
  const records = manifest.records.map(([k, v]): [string, unknown] => {
    if (k.startsWith('fire:')) {
      const f = { ...(v as FireRecord) }
      delete f.build
      delete f.buildPending
      return [k, f]
    }
    return [k, v]
  })
  await db.replaceAll(records, blobs)
  await loadStudio()
  return { records: records.length, files: blobs.length }
}
