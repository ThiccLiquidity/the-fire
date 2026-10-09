/** The second pin: the same images CAR, pinned on Filebase too (review item 23), so the images don't depend on one
 *  pinning company.
 *
 *  How. Filebase's S3-compatible API (https://s3.filebase.com, region us-east-1) imports a CAR as IPFS content when the
 *  object is uploaded with the metadata `import: car`, and reports the root CID it pinned in `x-amz-meta-cid`. The
 *  studio sends the exact CAR it sent Pinata (car.ts rebuilds it byte for byte) as a multipart upload in 64 MiB parts,
 *  so a dropped connection or a reload continues from the last part (the upload id is saved on the Series), then reads
 *  the object's CID back and requires it to equal the local root, which is also what Pinata stored.
 *
 *  Keys: a Filebase access key and secret with access to the bucket. Like the Pinata JWT they live only in this
 *  module's memory for the session: never saved, never logged, never put in an error message. The bucket needs CORS
 *  for the studio's origin once (scripts/filebase-cors.mjs sets it; docs/card-studio.md). */

import { sha256HexBytes, signV4, type Credentials } from './sigv4'

export const FILEBASE_S3 = 'https://s3.filebase.com'
export const FILEBASE_REGION = 'us-east-1'
/** Part size (S3 needs at least 5 MiB except the last part). */
export const FILEBASE_PART = 64 * 1024 * 1024
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export interface FilebaseKey extends Credentials { bucket: string }

let session: FilebaseKey | null = null
export function setFilebaseKey(k: FilebaseKey): void {
  const t = { accessKeyId: k.accessKeyId.trim(), secretAccessKey: k.secretAccessKey.trim(), bucket: k.bucket.trim() }
  session = t.accessKeyId && t.secretAccessKey && t.bucket ? t : null
}
export function hasFilebaseKey(): boolean { return session !== null }
export function clearFilebaseKey(): void { session = null }
export function filebaseBucket(): string | undefined { return session?.bucket }

export class FilebaseError extends Error {
  readonly status: number
  readonly retryable: boolean
  constructor(message: string, status: number, retryable: boolean) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

function errorFor(status: number, body: string, what: string): FilebaseError {
  const code = /<Code>([^<]*)<\/Code>/.exec(body)?.[1] ?? ''
  const msg = /<Message>([^<]*)<\/Message>/.exec(body)?.[1] ?? ''
  const detail = [code, msg].filter(Boolean).join(': ')
  if (status === 0) return new FilebaseError(`Filebase: no response (network, or the bucket has no CORS rule for this page: scripts/filebase-cors.mjs). ${what}`, 0, true)
  if (status === 401 || status === 403) return new FilebaseError(`Filebase rejected the key (${status}${detail ? `, ${detail}` : ''}). It needs read/write access to the bucket.`, status, false)
  if (status === 404) return new FilebaseError(`Filebase: not found (${detail || 'no such bucket or upload'}). ${what}`, status, false)
  if (status === 429 || status >= 500) return new FilebaseError(`Filebase/network error (${status}${detail ? `, ${detail}` : ''}). ${what}`, status, true)
  return new FilebaseError(`Filebase error ${status}${detail ? ` (${detail})` : ''}. ${what}`, status, false)
}

/** One CAR to pin (same shape as Pinata's). */
export interface FilebaseCar {
  /** Object name in the bucket (without .car). */
  name: string
  root: string
  size: number
  bytes(from: number): AsyncIterable<Uint8Array>
  /** A multipart upload from an earlier attempt of this same CAR. */
  resumeId?: string
  /** Called with the upload id once Filebase gives it (null when it's done or no longer usable). */
  onResumeId(id: string | null): Promise<void>
}

export interface FilebaseTransport {
  testAuth(key: FilebaseKey): Promise<void>
  /** The CID Filebase pinned for this object, or undefined if there's no such object. */
  cidOf(key: FilebaseKey, object: string): Promise<string | undefined>
  /** Uploads the CAR (resuming if it can); returns the CID Filebase pinned. */
  uploadCar(key: FilebaseKey, car: FilebaseCar, onProgress: (loaded: number, total: number) => void, onStatus?: (t: string) => void): Promise<string>
}

const objectKey = (name: string) => `${name}.car`

/** Waits (ms) between CID lookups once the upload is complete: about 6 minutes in all. */
export const CID_WAITS = [2, 4, 8, 15, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30].map((s) => s * 1000)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** The real Filebase transport (`partSize`: bytes per part; tests use small ones; `base`: the S3 endpoint; `cidWaits`
 *  and `wait`: the CID lookups after the upload). */
export function filebaseTransport(partSize = FILEBASE_PART, base = FILEBASE_S3, cidWaits = CID_WAITS, wait = sleep): FilebaseTransport {
  async function call(key: FilebaseKey, method: string, path: string, opts: { query?: Record<string, string>; headers?: Record<string, string>; body?: Uint8Array; what: string }) {
    const url = new URL(`${base}/${encodeURIComponent(key.bucket)}${path}`)
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v)
    const payloadHash = opts.body ? await sha256HexBytes(opts.body) : EMPTY_SHA
    const headers = await signV4({
      method, url: url.toString(), payloadHash, region: FILEBASE_REGION, service: 's3', credentials: key,
      headers: { 'x-amz-content-sha256': payloadHash, ...(opts.headers ?? {}) },
    })
    let r: Response
    try {
      r = await fetch(url.toString(), { method, headers, body: opts.body ? new Blob([opts.body as BlobPart]) : undefined })
    } catch {
      throw errorFor(0, '', opts.what)
    }
    return r
  }

  return {
    async testAuth(key) {
      const r = await call(key, 'HEAD', '', { what: `Checking the bucket "${key.bucket}".` })
      if (!r.ok) throw errorFor(r.status, '', `Checking the bucket "${key.bucket}".`)
    },

    async cidOf(key, object) {
      const r = await call(key, 'HEAD', `/${encodeURIComponent(objectKey(object))}`, { what: 'Looking up the pinned CAR.' })
      if (r.status === 404) return undefined
      if (!r.ok) throw errorFor(r.status, '', 'Looking up the pinned CAR.')
      return r.headers.get('x-amz-meta-cid') ?? undefined
    },

    async uploadCar(key, car, onProgress, onStatus) {
      const path = `/${encodeURIComponent(objectKey(car.name))}`
      const parts: { n: number; etag: string; size: number }[] = []
      let id = car.resumeId
      if (id) {
        // how far did the earlier attempt get? (whole parts from 1, each partSize long, are kept)
        const r = await call(key, 'GET', path, { query: { uploadId: id }, what: 'Resuming the upload.' })
        if (r.ok) {
          const xml = await r.text()
          const got = [...xml.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map((m) => ({
            n: Number(/<PartNumber>(\d+)<\/PartNumber>/.exec(m[1])?.[1]),
            etag: /<ETag>([^<]*)<\/ETag>/.exec(m[1])?.[1]?.replace(/&quot;/g, '"') ?? '',
            size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1]),
          })).sort((a, b) => a.n - b.n)
          for (const p of got) {
            if (p.n !== parts.length + 1 || p.size !== Math.min(partSize, car.size - parts.length * partSize) || !p.etag) break
            parts.push(p)
          }
        } else {
          id = undefined
          await car.onResumeId(null)
        }
      }
      if (!id) {
        const r = await call(key, 'POST', path, { query: { uploads: '' }, headers: { 'x-amz-meta-import': 'car' }, what: 'Starting the upload.' })
        const xml = await r.text()
        if (!r.ok) throw errorFor(r.status, xml, 'Starting the upload.')
        id = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1]
        if (!id) throw new FilebaseError('Filebase started an upload without an id.', 0, true)
        await car.onResumeId(id)
      }
      let offset = parts.reduce((n, p) => n + p.size, 0)
      onProgress(offset, car.size)
      let buf = new Uint8Array(Math.min(partSize, car.size - offset))
      let fill = 0
      const send = async (part: Uint8Array) => {
        const n = parts.length + 1
        const r = await call(key, 'PUT', path, { query: { partNumber: String(n), uploadId: id! }, body: part, what: `Part ${n}.` })
        if (!r.ok) throw errorFor(r.status, await r.text(), `Part ${n}.`)
        const etag = r.headers.get('etag')
        if (!etag) throw new FilebaseError('Filebase answered without an ETag (the bucket\'s CORS rule must expose ETag: scripts/filebase-cors.mjs).', 0, false)
        parts.push({ n, etag, size: part.length })
        offset += part.length
        onProgress(offset, car.size)
      }
      for await (const piece of car.bytes(offset)) {
        let c = piece
        while (c.length) {
          if (buf.length === 0) throw new FilebaseError('The folder came out longer than planned; nothing more was sent.', 0, false)
          const k = Math.min(c.length, buf.length - fill)
          buf.set(c.subarray(0, k), fill)
          fill += k
          c = c.subarray(k)
          if (fill === buf.length) {
            await send(buf)
            buf = new Uint8Array(Math.min(partSize, car.size - offset))
            fill = 0
          }
        }
      }
      if (fill > 0) await send(buf.subarray(0, fill))
      if (offset !== car.size) throw new FilebaseError(`Upload stopped at ${offset} of ${car.size} bytes.`, 0, true)
      const body = new TextEncoder().encode(
        `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${p.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`,
      )
      const done = await call(key, 'POST', path, { query: { uploadId: id }, body, headers: { 'content-type': 'application/xml' }, what: 'Finishing the upload.' })
      const doneXml = await done.text()
      if (!done.ok || /<Error>/.test(doneXml)) throw errorFor(done.ok ? 500 : done.status, doneXml, 'Finishing the upload.')
      await car.onResumeId(null)
      // the import can take a while to report its CID: look it up with backoff (never upload again for this)
      let waited = 0
      for (let i = 0; ; i++) {
        try {
          const cid = await this.cidOf(key, car.name)
          if (cid) return cid
        } catch (e) {
          if (!(e instanceof FilebaseError && e.retryable)) throw e
        }
        if (i >= cidWaits.length) break
        if (i === 0) onStatus?.('Stored on Filebase; waiting for it to report the CID...')
        await wait(cidWaits[i])
        waited += cidWaits[i]
      }
      throw new FilebaseError(`Filebase stored ${objectKey(car.name)} but reported no CID after ${Math.round(waited / 60_000)} minutes (was it imported as a CAR?). Try "Pin to Filebase" later: it looks the CID up first.`, 0, false)
    },
  }
}

export const realFilebase = filebaseTransport()

/** Dev/test stand-in: same interface, no network; returns the CAR's root as the CID. */
export class MockFilebase implements FilebaseTransport {
  readonly pinned = new Map<string, string>()
  calls: string[] = []
  async testAuth(key: FilebaseKey) {
    this.calls.push('testAuth')
    if (!key.accessKeyId) throw new FilebaseError('Filebase rejected the key (403).', 403, false)
  }
  async cidOf(_key: FilebaseKey, object: string) {
    this.calls.push(`head:${object}`)
    return this.pinned.get(object)
  }
  async uploadCar(_key: FilebaseKey, car: FilebaseCar, onProgress: (l: number, t: number) => void) {
    this.calls.push(`pin:${car.name}`)
    let at = 0
    for await (const c of car.bytes(0)) { at += c.length; onProgress(at, car.size) }
    if (at !== car.size) throw new FilebaseError(`Mock: got ${at} of ${car.size} bytes.`, 0, false)
    this.pinned.set(car.name, car.root)
    return car.root
  }
}

export const mockFilebase = new MockFilebase()

/** Pin a CAR on Filebase with the session key (reusing it if Filebase already has it), retrying network errors. */
export async function pinOnFilebase(
  transport: FilebaseTransport, car: FilebaseCar, onStatus: (t: string) => void, onProgress: (l: number, t: number) => void,
): Promise<string> {
  const key = session
  if (!key) throw new Error('Enter the Filebase key first.')
  const retry = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    for (let i = 1; ; i++) {
      try {
        return await fn()
      } catch (e) {
        if (!(e instanceof FilebaseError && e.retryable) || i >= 4) throw e
        const wait = 2000 * 2 ** (i - 1)
        onStatus(`${what}: ${e.message} Retrying in ${wait / 1000}s (attempt ${i + 1} of 4), from where it stopped...`)
        await new Promise((r) => setTimeout(r, wait))
      }
    }
  }
  await retry('Filebase key check', () => transport.testAuth(key))
  const have = await retry('Filebase lookup', () => transport.cidOf(key, car.name))
  if (have === car.root) {
    onStatus(`Filebase already has ${car.root}; reusing it.`)
    return have
  }
  if (have) onStatus(`Filebase has ${car.name}.car with another CID (${have}); uploading this build over it.`)
  let resumeId = car.resumeId
  const cid = await retry(`Filebase upload of ${car.name}`, () => transport.uploadCar(key, {
    ...car, resumeId,
    onResumeId: async (id) => { resumeId = id ?? undefined; await car.onResumeId(id) },
  }, onProgress, onStatus))
  if (cid !== car.root) throw new FilebaseError(`Filebase pinned ${cid}, but the folder's CID is ${car.root}. Not saved; check the bucket.`, 0, false)
  return cid
}

/** Read back what Filebase has pinned for this object (the check after both pins). */
export async function filebaseCid(transport: FilebaseTransport, object: string): Promise<string | undefined> {
  if (!session) throw new Error('Enter the Filebase key first.')
  return transport.cidOf(session, object)
}
