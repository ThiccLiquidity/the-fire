/** Whole-studio backup as one .zip: every record (characters, frames, layouts, fonts, Fires, accumulators, serial
 *  counter) plus every stored file (original + keyed art, frames, fonts). Rendered cards are NOT included (they are
 *  rebuilt from the assets in Build & Review), which keeps backups small. */

import { unzipSync } from 'fflate'
import * as db from './db'
import { ZipWriter, blobBytes, extOfMime, mimeOfExt } from './files'
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

export async function exportLibrary(onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const records = [...(await db.getAllRecords()).entries()]
  const keys = (await db.blobKeys()).filter((k) => !k.startsWith('render:'))
  const zip = new ZipWriter()
  const manifest: Manifest = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), records, blobs: [] }
  let i = 0
  for (const key of keys) {
    const b = await db.getBlob(key)
    if (!b) continue
    const path = `files/${String(i++).padStart(5, '0')}.${extOfMime(b.type)}`
    manifest.blobs.push({ key, path, type: b.type })
    zip.addStored(path, await blobBytes(b))
    onProgress?.(i, keys.length)
  }
  zip.addText('studio.json', JSON.stringify(manifest, null, 1))
  return zip.finish()
}

export async function importLibrary(file: Blob): Promise<{ records: number; files: number }> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const raw = entries['studio.json']
  if (!raw) throw new Error('Not a Card Studio backup (studio.json missing).')
  const manifest = JSON.parse(new TextDecoder().decode(raw)) as Manifest
  if (manifest.format !== FORMAT) throw new Error('Not a Card Studio backup.')
  if (manifest.version > VERSION) throw new Error(`Backup version ${manifest.version} is newer than this Card Studio.`)
  const blobs: [string, Blob][] = []
  for (const b of manifest.blobs) {
    const data = entries[b.path]
    if (!data) throw new Error(`Backup is missing ${b.path}.`)
    blobs.push([b.key, new Blob([data as BlobPart], { type: b.type || mimeOfExt(b.path) })])
  }
  // Rendered cards aren't in backups, so a Fire's build has to be redone on this machine.
  const records = manifest.records.map(([k, v]): [string, unknown] => {
    if (k.startsWith('fire:')) {
      const f = { ...(v as FireRecord) }
      delete f.build
      return [k, f]
    }
    return [k, v]
  })
  await db.replaceAll(records, blobs)
  await loadStudio()
  return { records: records.length, files: blobs.length }
}
