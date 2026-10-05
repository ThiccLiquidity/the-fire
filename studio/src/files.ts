/** Zip helpers (fflate, streaming so large exports don't need one giant buffer) and browser downloads. */

import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'

export class ZipWriter {
  private chunks: Uint8Array[] = []
  private zip: Zip
  private result: Promise<Blob>
  constructor() {
    let resolve!: (b: Blob) => void
    let reject!: (e: Error) => void
    this.result = new Promise<Blob>((res, rej) => { resolve = res; reject = rej })
    this.zip = new Zip((err, data, final) => {
      if (err) return reject(err)
      this.chunks.push(data)
      if (final) resolve(new Blob(this.chunks as BlobPart[], { type: 'application/zip' }))
    })
  }

  /** Already-compressed data (webp/png/woff2): stored as-is. */
  addStored(path: string, data: Uint8Array): void {
    const f = new ZipPassThrough(path)
    this.zip.add(f)
    f.push(data, true)
  }

  addDeflated(path: string, data: Uint8Array): void {
    const f = new ZipDeflate(path, { level: 6 })
    this.zip.add(f)
    f.push(data, true)
  }

  addText(path: string, text: string): void {
    this.addDeflated(path, new TextEncoder().encode(text))
  }

  finish(): Promise<Blob> {
    this.zip.end()
    return this.result
  }
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
