/** Upload to IPFS through Pinata, built for very large Series (tens of thousands of images, many GB).
 *
 *  How. Each folder (the images, then the preview metadata) is packed in the browser into one CAR file (car.ts): a
 *  UnixFS directory whose root CID is computed locally before anything is sent. The CAR goes to Pinata's v3 upload
 *  API with `car: true`, so Pinata stores exactly that DAG and the folder's CID is the local root: one CID, every file
 *  at ipfs://<CID>/<file>, which is the single imagesBase the contract expects. The upload is resumable (the tus
 *  protocol Pinata's v3 uploads use, as in Pinata's own SDK): POST https://uploads.pinata.cloud/v3/files with
 *  Upload-Length and Upload-Metadata (filename, filetype, network=public, car=true) returns an upload URL; the CAR is
 *  sent in 50 MiB PATCH requests (Upload-Offset); the last answers 204 with the CID in `upload-cid`. The upload URL is
 *  saved on the Series, so after a failure or a reload the upload asks Pinata how far it got (HEAD, Upload-Offset)
 *  and continues from there; the CAR is rebuilt byte for byte to that point. Every tus request carries
 *  `Tus-Resumable: 1.0.0`. If the last PATCH is answered without `upload-cid` (or a reload finds the upload complete),
 *  nothing is sent again: the upload's status (HEAD) and the folder's CID on Pinata are asked again, with backoff.
 *  The browser must be able to read Location, Upload-Offset and upload-cid from Pinata's answers (CORS exposed).
 *  Why not the legacy pinFileToIPFS folder upload: it takes a whole folder in one multipart request (no resume, no
 *  incremental folder), which doesn't hold up at many GB; and a folder can't be built from several separate pins.
 *
 *  Before uploading a folder we ask Pinata whether its CID is already stored (GET /v3/files/public?cid=...), e.g. an
 *  upload that finished after the tab closed, and reuse it. The CID Pinata returns must equal the local root.
 *
 *  Only the images folder is used on-chain (FireCards.setImagesBase(fire, "ipfs://<imagesCid>/"); tokenURI builds each
 *  card's JSON itself). The metadata folder (one ERC-721 JSON per card of the sample deal) is for preview and
 *  reference; it's named after the images CID (metadataDirName).
 *
 *  The JWT (it needs Pinata v3 Files write access) lives only in this module's memory for the session: never written
 *  to IndexedDB/localStorage, never logged, never put in an error message. Reloading the page forgets it. */

import { carBytes, planCar } from './car'
import { sha256Hex } from './prng'

const API = 'https://api.pinata.cloud'
const UPLOADS = 'https://uploads.pinata.cloud/v3/files'
/** The chunk size Pinata's SDK uses for its tus uploads. */
export const TUS_CHUNK = 50 * 1024 * 1024 + 1
/** The tus protocol version, sent on every tus request. */
const TUS = { 'Tus-Resumable': '1.0.0' }
/** Waits (ms) between status checks when the whole CAR is sent but Pinata hasn't named the CID: about 3 minutes. */
export const CID_WAITS = [2, 4, 8, 15, 30, 30, 30, 30, 30].map((s) => s * 1000)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

let sessionJwt = ''
export function setPinataJwt(jwt: string): void { sessionJwt = jwt.trim() }
export function hasPinataJwt(): boolean { return sessionJwt.length > 0 }
export function clearPinataJwt(): void { sessionJwt = '' }

export interface UploadFile { name: string; blob: Blob }

/** One CAR to upload (resumable). */
export interface CarUpload {
  /** The folder's name on Pinata. */
  name: string
  root: string
  size: number
  files: number
  /** The CAR's bytes from an offset on (rebuilt identically each time). */
  bytes(from: number): AsyncIterable<Uint8Array>
  /** An upload URL from an earlier attempt of this same CAR. */
  resumeUrl?: string
  /** Called with the upload URL once Pinata gives it (null when it's no longer usable). */
  onResumeUrl(url: string | null): Promise<void>
}

export interface PinataTransport {
  /** Throws with a readable message if the JWT is rejected. */
  testAuth(jwt: string): Promise<void>
  /** Whether Pinata already stores this CID. */
  isPinned(jwt: string, cid: string): Promise<boolean>
  /** Uploads a CAR (resuming if it can); returns the CID Pinata stored. */
  uploadCar(jwt: string, up: CarUpload, onProgress: (loaded: number, total: number) => void): Promise<string>
}

export class PinataError extends Error {
  readonly status: number
  readonly retryable: boolean
  constructor(message: string, status: number, retryable: boolean) {
    super(message)
    this.status = status
    this.retryable = retryable
  }
}

function errorFor(status: number, body: string): PinataError {
  let detail = ''
  try {
    const j = JSON.parse(body) as { error?: { reason?: string; details?: string } | string; message?: string }
    detail = typeof j.error === 'string' ? j.error : j.error?.details ?? j.error?.reason ?? j.message ?? ''
  } catch {
    detail = body.slice(0, 200)
  }
  if (status === 401 || status === 403) return new PinataError(`Pinata rejected the JWT (${status}). The key needs Files write access (v3). ${detail}`, status, false)
  if (status === 429) return new PinataError(`Pinata rate limit (429). ${detail}`, status, true)
  if (status >= 500 || status === 0 || status === 409) return new PinataError(`Pinata/network error (${status || 'no response'}). ${detail}`, status, true)
  return new PinataError(`Pinata error ${status}. ${detail}`, status, false)
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)))

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw errorFor(0, '')
  }
}

/** The real Pinata transport (`chunk`: bytes per PATCH; tests use small ones; `cidWaits` and `wait`: the status checks
 *  after the last byte). */
export function pinataTransport(chunkSize = TUS_CHUNK, cidWaits = CID_WAITS, wait = sleep): PinataTransport {
  return {
  async testAuth(jwt) {
    const r = await call(`${API}/data/testAuthentication`, { headers: { Authorization: `Bearer ${jwt}` } })
    if (!r.ok) throw errorFor(r.status, await r.text())
  },

  async isPinned(jwt, cid) {
    const r = await call(`${API}/v3/files/public?cid=${encodeURIComponent(cid)}&limit=1`, { headers: { Authorization: `Bearer ${jwt}` } })
    if (!r.ok) throw errorFor(r.status, await r.text())
    const j = (await r.json()) as { data?: { files?: { cid?: string }[] } }
    return !!j.data?.files?.some((f) => f.cid === cid)
  },

  async uploadCar(jwt, up, onProgress) {
    const auth = { Authorization: `Bearer ${jwt}`, ...TUS }
    // the key is only ever sent to Pinata's upload host: a stored or returned URL anywhere else is dropped
    const onPinata = (u: string) => { try { return new URL(u).origin === new URL(UPLOADS).origin } catch { return false } }
    let url = up.resumeUrl && onPinata(up.resumeUrl) ? up.resumeUrl : undefined
    let offset = 0
    if (up.resumeUrl && !url) await up.onResumeUrl(null)
    /** Every byte is in: ask for the CID (the upload's status, then the folder on Pinata) instead of sending again. */
    const finished = async (): Promise<string> => {
      for (let i = 0; ; i++) {
        const r = await call(url!, { method: 'HEAD', headers: auth }).catch(() => null)
        const c = r?.headers.get('upload-cid')
        if (c) return c
        if (await this.isPinned(jwt, up.root).catch(() => false)) return up.root
        if (i >= cidWaits.length) break
        await wait(cidWaits[i])
      }
      throw new PinataError('Pinata has the whole CAR but names no CID yet. Try again later: it looks the folder up first.', 0, false)
    }
    if (url) {
      // how far did the earlier attempt get?
      const r = await call(url, { method: 'HEAD', headers: auth }).catch(() => null)
      const at = Number(r?.headers.get('Upload-Offset'))
      if (r?.ok && Number.isFinite(at) && at >= 0 && at <= up.size) offset = at
      else { url = undefined; await up.onResumeUrl(null) }
      if (url && offset === up.size) {
        onProgress(offset, up.size)
        return r?.headers.get('upload-cid') || finished()
      }
    }
    if (!url) {
      const metadata = [
        `filename ${b64(`${up.name}.car`)}`, `filetype ${b64('application/vnd.ipld.car')}`, `network ${b64('public')}`, `car ${b64('true')}`,
        `name ${b64(up.name)}`,
      ].join(',')
      const r = await call(UPLOADS, { method: 'POST', headers: { ...auth, 'Upload-Length': String(up.size), 'Upload-Metadata': metadata } })
      const loc = r.headers.get('Location')
      if (!r.ok || !loc) throw errorFor(r.status, await r.text())
      url = new URL(loc, UPLOADS).toString()
      if (!onPinata(url)) throw new Error(`Pinata sent an upload address on another host (${new URL(url).host}); stopped.`)
      await up.onResumeUrl(url)
    }
    onProgress(offset, up.size)
    let cid: string | null = null
    let buf = new Uint8Array(Math.min(chunkSize, up.size - offset))
    let fill = 0
    const send = async (part: Uint8Array) => {
      const r = await call(url!, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) },
        body: new Blob([part as BlobPart]),
      })
      if (!r.ok) throw errorFor(r.status, await r.text())
      offset += part.length
      onProgress(offset, up.size)
      cid = r.headers.get('upload-cid') ?? cid
    }
    for await (const piece of up.bytes(offset)) {
      let c = piece
      while (c.length) {
        if (buf.length === 0) throw new PinataError('The folder came out longer than planned; nothing more was sent.', 0, false)
        const n = Math.min(c.length, buf.length - fill)
        buf.set(c.subarray(0, n), fill)
        fill += n
        c = c.subarray(n)
        if (fill === buf.length) {
          await send(buf)
          buf = new Uint8Array(Math.min(chunkSize, up.size - offset))
          fill = 0
        }
      }
    }
    if (fill > 0) await send(buf.subarray(0, fill))
    if (offset !== up.size) throw new PinataError(`Upload stopped at ${offset} of ${up.size} bytes.`, 0, true)
    return cid ?? finished()
  },
  }
}

export const realTransport = pinataTransport()

/** Dev/test stand-in: same interface, no network. It reads the whole CAR (checking its size), keeps how far each
 *  upload got (so resume works), and returns the CAR's root as the CID. Can be told to fail the next N uploads halfway
 *  through. */
export class MockTransport implements PinataTransport {
  failNext = 0
  /** Stored CIDs. */
  readonly pinned = new Set<string>()
  /** upload URL -> bytes received */
  readonly partial = new Map<string, number>()
  calls: string[] = []
  delayMs: number
  private nextUrl = 1
  constructor(delayMs = 400) {
    this.delayMs = delayMs
  }
  async testAuth(jwt: string) {
    this.calls.push('testAuth')
    if (!jwt) throw new PinataError('Pinata rejected the JWT (401).', 401, false)
  }
  async isPinned(_jwt: string, cid: string) {
    this.calls.push(`find:${cid}`)
    return this.pinned.has(cid)
  }
  async uploadCar(_jwt: string, up: CarUpload, onProgress: (l: number, t: number) => void) {
    this.calls.push(`pin:${up.name}:${up.files}`)
    let url = up.resumeUrl && this.partial.has(up.resumeUrl) ? up.resumeUrl : undefined
    if (!url) {
      url = `mock://upload/${this.nextUrl++}`
      this.partial.set(url, 0)
      await up.onResumeUrl(url)
    }
    let at = this.partial.get(url)!
    if (at > 0) this.calls.push(`resume:${up.name}:${at}`)
    const failAt = this.failNext > 0 ? Math.floor(up.size / 2) : -1
    for await (const chunk of up.bytes(at)) {
      at += chunk.length
      this.partial.set(url, Math.min(at, failAt >= 0 ? failAt : at))
      onProgress(at, up.size)
      if (failAt >= 0 && at >= failAt) {
        this.failNext--
        throw new PinataError('Mock: simulated network failure mid-upload.', 0, true)
      }
    }
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs))
    if (at !== up.size) throw new PinataError(`Mock: got ${at} of ${up.size} bytes.`, 0, false)
    this.partial.delete(url)
    this.pinned.add(up.root)
    return up.root
  }
}

export const mockTransport = new MockTransport()

export interface PendingUpload { dir: string; root: string; size: number; url: string }

export interface UploadPlan {
  fire: number
  imageFiles: UploadFile[]
  /** Builds the metadata files once the images CID is known. */
  makeMetadata: (imagesCid: string) => UploadFile[]
  existing: { imagesCid?: string; metadataCid?: string; pending?: PendingUpload }
  /** Persist progress immediately (so a crash or reload can resume). `pending: null` clears it. */
  save: (patch: { imagesCid?: string; metadataCid?: string; pending?: PendingUpload | null }) => Promise<void>
  onStatus: (text: string) => void
  onProgress: (fraction: number) => void
  /** Images folder name (it carries a fingerprint of the files). The metadata folder is metadataDirName(fire, cid). */
  imagesDirName?: string
}

/** "fire-<n>-metadata-<last 10 chars of the images CID>": tied to the exact images it points at. */
export function metadataDirName(fire: number, imagesCid: string): string {
  return `fire-${fire}-metadata-${imagesCid.slice(-10)}`
}

/** A short fingerprint of a folder's file names and sizes (the folder name carries it). */
export function filesFingerprint(files: UploadFile[]): string {
  return sha256Hex(files.map((f) => `${f.name}:${f.blob.size}`).join('|')).slice(0, 10)
}

async function withRetry<T>(what: string, fn: () => Promise<T>, onStatus: (t: string) => void, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const retryable = e instanceof PinataError && e.retryable
      if (!retryable || i >= attempts) throw e
      const wait = 2000 * 2 ** (i - 1)
      onStatus(`${what}: ${(e as Error).message} Retrying in ${wait / 1000}s (attempt ${i + 1} of ${attempts}), from where it stopped...`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

const fmtMB = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

/** One folder: pack it as a CAR, reuse it if Pinata has its CID, else upload (resuming an earlier attempt). */
async function uploadFolder(
  plan: UploadPlan, transport: PinataTransport, jwt: string, dir: string, files: UploadFile[], progress: (f: number) => void,
  packed?: { root: string; size: number },
): Promise<string> {
  const car = packed ?? await pack(plan, dir, files, progress)
  if (await withRetry('Lookup', () => transport.isPinned(jwt, car.root), plan.onStatus)) {
    plan.onStatus(`Pinata already has ${car.root}; reusing it.`)
    return car.root
  }
  const pending = plan.existing.pending
  let resumeUrl = pending && pending.dir === dir && pending.root === car.root && pending.size === car.size ? pending.url : undefined
  if (resumeUrl) plan.onStatus('Resuming the earlier upload of this folder...')
  const cid = await withRetry(`Upload of ${dir}`, () => transport.uploadCar(jwt, {
    name: dir, root: car.root, size: car.size, files: files.length, resumeUrl,
    bytes: (from) => carBytes(files, car.root, from),
    onResumeUrl: async (url) => {
      resumeUrl = url ?? undefined
      await plan.save({ pending: url ? { dir, root: car.root, size: car.size, url } : null })
    },
  }, (l, t) => progress(0.25 + 0.75 * (l / Math.max(1, t)))), plan.onStatus)
  await plan.save({ pending: null })
  if (cid !== car.root) throw new PinataError(`Pinata stored ${cid}, but the folder's CID is ${car.root}. Not saved; check the upload on Pinata.`, 0, false)
  return cid
}

/** Hash the files into their CAR: the folder CID (the root) and the CAR's size. */
async function pack(plan: UploadPlan, dir: string, files: UploadFile[], progress: (f: number) => void): Promise<{ root: string; size: number }> {
  plan.onStatus(`Packing ${files.length.toLocaleString()} files as ${dir}/ (hashing to get the folder CID)...`)
  const car = await planCar(files, (d, t) => progress(0.25 * (d / Math.max(1, t))))
  plan.onStatus(`Folder CID ${car.root} (${fmtMB(car.size)} CAR).`)
  return car
}

/** Whether Pinata (with the session JWT) has this CID pinned: the check after both pins. */
export async function pinataHas(transport: PinataTransport, cid: string): Promise<boolean> {
  if (!sessionJwt) throw new Error('Enter the Pinata JWT first.')
  return transport.isPinned(sessionJwt, cid)
}

export async function uploadFire(plan: UploadPlan, transport: PinataTransport): Promise<{ imagesCid: string; metadataCid: string; imagesCar: { root: string; size: number } }> {
  const jwt = sessionJwt
  if (!jwt) throw new Error('Enter the Pinata JWT first.')
  const imagesDir = plan.imagesDirName ?? `fire-${plan.fire}-images`

  plan.onStatus('Checking the Pinata key...')
  await withRetry('Key check', () => transport.testAuth(jwt), plan.onStatus)

  // The images are known by their folder CID (the CAR's root, from their bytes): a saved upload is only reused when the
  // build hashes to exactly that CID, so a changed build is never mistaken for the uploaded one.
  const car = await pack(plan, imagesDir, plan.imageFiles, (f) => plan.onProgress(0.9 * f))
  let imagesCid = plan.existing.imagesCid
  let metadataCid = plan.existing.metadataCid
  if (imagesCid && imagesCid !== car.root) {
    plan.onStatus(`The saved upload (${imagesCid}) isn't this build (${car.root}); uploading the build.`)
    imagesCid = undefined
    metadataCid = undefined
  }
  // a saved CID is only trusted if Pinata still has it (a mock upload, or a pin deleted since, is uploaded again)
  if (imagesCid && !(await withRetry('Lookup', () => transport.isPinned(jwt, imagesCid!), plan.onStatus))) {
    plan.onStatus(`Pinata doesn't have ${imagesCid}; uploading it again.`)
    imagesCid = undefined
    metadataCid = undefined
  }
  if (imagesCid) plan.onStatus(`Images already uploaded (${imagesCid}), skipping.`)
  else {
    imagesCid = await uploadFolder(plan, transport, jwt, imagesDir, plan.imageFiles, (f) => plan.onProgress(0.9 * f), car)
    await plan.save({ imagesCid })
  }
  plan.onProgress(0.9)

  const metaDir = metadataDirName(plan.fire, imagesCid)
  if (metadataCid && !(await withRetry('Lookup', () => transport.isPinned(jwt, metadataCid!), plan.onStatus))) {
    plan.onStatus(`Pinata doesn't have ${metadataCid}; uploading it again.`)
    metadataCid = undefined
  }
  if (metadataCid) plan.onStatus(`Metadata already uploaded (${metadataCid}), skipping.`)
  else {
    metadataCid = await uploadFolder(plan, transport, jwt, metaDir, plan.makeMetadata(imagesCid), (f) => plan.onProgress(0.9 + 0.1 * f))
    await plan.save({ metadataCid })
  }
  plan.onProgress(1)
  plan.onStatus('Pinata done.')
  return { imagesCid, metadataCid, imagesCar: car }
}
