/** Zip helpers (fflate, streaming so large exports don't need one giant buffer) and browser downloads. */

import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from 'fflate'

/** Where a zip's bytes go as they are made: a file on disk (the browser's file pickers). */
export interface ZipSink { write(b: Uint8Array): Promise<void>; close(): Promise<void> }

/** Bytes kept as plain arrays before they are folded into a Blob (which the browser can keep on disk). */
const HOLD_BYTES = 32 * 1024 * 1024

/** A zip made as it goes. With a sink, every piece is written to it at once (nothing piles up: `drain` between
 *  entries waits for the writes); without one, the pieces are folded into Blobs every 32 MB and `finish` returns the
 *  zip as one Blob. */
export class ZipWriter {
  /** Entries and bytes (before zipping) added so far. */
  entries = 0
  bytes = 0
  private parts: Blob[] = []
  private chunks: Uint8Array[] = []
  private held = 0
  private zip: Zip
  private result: Promise<Blob | null>
  private writes: Promise<void> = Promise.resolve()
  private failed: unknown = null
  constructor(sink?: ZipSink) {
    let resolve!: (b: Blob | null) => void
    let reject!: (e: unknown) => void
    this.result = new Promise<Blob | null>((res, rej) => { resolve = res; reject = rej })
    this.zip = new Zip((err, data, final) => {
      if (err) return reject(err)
      if (sink) {
        this.writes = this.writes.then(() => sink.write(data)).catch((e) => { this.failed ??= e })
        if (final) this.writes.then(() => (this.failed ? Promise.reject(this.failed) : sink.close())).then(() => resolve(null), reject)
        return
      }
      this.chunks.push(data)
      this.held += data.length
      if (this.held >= HOLD_BYTES || final) this.fold()
      if (final) resolve(new Blob(this.parts, { type: 'application/zip' }))
    })
  }

  private fold() {
    if (!this.chunks.length) return
    this.parts.push(new Blob(this.chunks as BlobPart[]))
    this.chunks = []
    this.held = 0
  }

  /** Already-compressed data (webp/png/woff2): stored as-is. */
  addStored(path: string, data: Uint8Array): void {
    const f = new ZipPassThrough(path)
    this.zip.add(f)
    f.push(data, true)
    this.entries++
    this.bytes += data.length
  }

  addDeflated(path: string, data: Uint8Array): void {
    const f = new ZipDeflate(path, { level: 6 })
    this.zip.add(f)
    f.push(data, true)
    this.entries++
    this.bytes += data.length
  }

  addText(path: string, text: string): void {
    this.addDeflated(path, new TextEncoder().encode(text))
  }

  /** Waits until what was added is written to the sink (no-op without one). */
  async drain(): Promise<void> {
    await this.writes
    if (this.failed) throw this.failed
  }

  /** The zip as a Blob, or null when it went to a sink (then closed). */
  finish(): Promise<Blob | null> {
    this.zip.end()
    return this.result
  }
}

type Writable = { createWritable(): Promise<ZipSink> }
type FsWindow = {
  showSaveFilePicker?: (o: unknown) => Promise<Writable>
  showDirectoryPicker?: (o: unknown) => Promise<{ getFileHandle(name: string, o: { create: boolean }): Promise<Writable> }>
}
const fsWindow = () => (typeof window === 'undefined' ? {} : (window as unknown as FsWindow))

/** Whether the browser can stream a file to disk (Chrome and Edge's save picker). */
export const canSaveToFile = () => typeof fsWindow().showSaveFilePicker === 'function'

/** Asks where to save `name` and opens it for writing (Chrome, Edge). */
export async function pickSaveFile(name: string, description: string, accept: Record<string, string[]>): Promise<ZipSink> {
  const pick = fsWindow().showSaveFilePicker
  if (!pick) throw new Error('Use Chrome or Edge to save straight to a file.')
  return (await pick({ suggestedName: name, types: [{ description, accept }] })).createWritable()
}

/** Asks for a folder to write several files into (Chrome, Edge); null where the browser can't. */
export async function pickFolder(): Promise<((name: string) => Promise<ZipSink>) | null> {
  const pick = fsWindow().showDirectoryPicker
  if (!pick) return null
  const dir = await pick({ mode: 'readwrite' })
  return async (name) => (await dir.getFileHandle(name, { create: true })).createWritable()
}

/** Reads a zip as a stream (never the whole file in memory at once): each entry comes back as a Blob, by path. */
export async function unzipBlobs(file: Blob, onProgress?: (read: number, total: number) => void): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>()
  let failed: unknown = null
  const uz = new Unzip()
  uz.register(UnzipInflate)
  uz.onfile = (f) => {
    const chunks: Uint8Array[] = []
    f.ondata = (err, data, final) => {
      if (err) { failed ??= err; return }
      chunks.push(data)
      if (final) out.set(f.name, new Blob(chunks as BlobPart[]))
    }
    f.start()
  }
  const reader = file.stream().getReader()
  let read = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    uz.push(value, false)
    if (failed) throw failed
    read += value.length
    onProgress?.(read, file.size)
  }
  uz.push(new Uint8Array(0), true)
  if (failed) throw failed
  return out
}

export async function blobBytes(b: Blob): Promise<Uint8Array> {
  return new Uint8Array(await b.arrayBuffer())
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function extOfMime(type: string): string {
  const map: Record<string, string> = {
    'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/avif': 'avif',
    'font/ttf': 'ttf', 'font/otf': 'otf', 'font/woff2': 'woff2', 'font/woff': 'woff',
  }
  return map[type] ?? 'bin'
}

export function mimeOfExt(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', avif: 'image/avif',
    ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2', woff: 'font/woff', json: 'application/json',
  }
  return map[ext] ?? 'application/octet-stream'
}
