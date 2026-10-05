/** Upload to IPFS through Pinata.
 *
 *  Uses Pinata's pinning API, POST https://api.pinata.cloud/pinning/pinFileToIPFS, with "Authorization: Bearer <JWT>".
 *  A directory is uploaded as one multipart request: each file is a `file` part whose filename is
 *  "<dirName>/<fileName>", plus `pinataMetadata` ({"name": ...}) and `pinataOptions` ({"cidVersion": 1}). The
 *  response's `IpfsHash` is the directory's CID, so a file is at ipfs://<CID>/<fileName>.
 *
 *  Two directories per Series: images first, then metadata whose `image` fields point at ipfs://<imagesCid>/<file>.
 *  Resume: each finished directory's CID is saved on the Series right away and skipped next time; before uploading a
 *  directory we also ask Pinata (GET /data/pinList?status=pinned&metadata[name]=...) whether a pin with that exact name
 *  already exists (an upload that finished after the tab closed) and reuse it.
 *
 *  The JWT lives only in this module's memory for the session: never written to IndexedDB/localStorage, never logged,
 *  never put in an error message. Reloading the page forgets it. */

import { sha256Hex } from './prng'

const API = 'https://api.pinata.cloud'

let sessionJwt = ''
export function setPinataJwt(jwt: string): void { sessionJwt = jwt.trim() }
export function hasPinataJwt(): boolean { return sessionJwt.length > 0 }
export function clearPinataJwt(): void { sessionJwt = '' }

export interface UploadFile { name: string; blob: Blob }

export interface PinataTransport {
  /** Throws with a readable message if the JWT is rejected. */
  testAuth(jwt: string): Promise<void>
  /** CID of an existing pinned upload with exactly this name, or null. */
  findPinByName(jwt: string, name: string): Promise<string | null>
  /** Uploads files as one directory; returns the directory CID. */
  pinDirectory(jwt: string, dirName: string, files: UploadFile[], onProgress: (loaded: number, total: number) => void): Promise<string>
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
  if (status === 401 || status === 403) return new PinataError(`Pinata rejected the JWT (${status}). Check the key has pinning permissions. ${detail}`, status, false)
  if (status === 429) return new PinataError(`Pinata rate limit (429). ${detail}`, status, true)
  if (status >= 500 || status === 0) return new PinataError(`Pinata/network error (${status || 'no response'}). ${detail}`, status, true)
  return new PinataError(`Pinata error ${status}. ${detail}`, status, false)
}

export const realTransport: PinataTransport = {
  async testAuth(jwt) {
    const r = await fetch(`${API}/data/testAuthentication`, { headers: { Authorization: `Bearer ${jwt}` } })
    if (!r.ok) throw errorFor(r.status, await r.text())
  },

  async findPinByName(jwt, name) {
    const q = new URLSearchParams({ status: 'pinned', pageLimit: '10', 'metadata[name]': name })
    const r = await fetch(`${API}/data/pinList?${q}`, { headers: { Authorization: `Bearer ${jwt}` } })
    if (!r.ok) throw errorFor(r.status, await r.text())
    const j = (await r.json()) as { rows?: { ipfs_pin_hash: string; metadata?: { name?: string } }[] }
    const hit = j.rows?.find((row) => row.metadata?.name === name)
    return hit?.ipfs_pin_hash ?? null
  },

  pinDirectory(jwt, dirName, files, onProgress) {
    const form = new FormData()
    for (const f of files) form.append('file', f.blob, `${dirName}/${f.name}`)
    form.append('pinataMetadata', JSON.stringify({ name: dirName }))
    form.append('pinataOptions', JSON.stringify({ cidVersion: 1 }))
    // XMLHttpRequest rather than fetch for upload progress events.
    return new Promise<string>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${API}/pinning/pinFileToIPFS`)
      xhr.setRequestHeader('Authorization', `Bearer ${jwt}`)
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total) }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const j = JSON.parse(xhr.responseText) as { IpfsHash?: string }
            if (!j.IpfsHash) throw new Error('no IpfsHash')
            resolve(j.IpfsHash)
          } catch {
            reject(new PinataError('Pinata answered without a CID.', xhr.status, true))
          }
        } else reject(errorFor(xhr.status, xhr.responseText))
      }
      xhr.onerror = () => reject(errorFor(0, ''))
      xhr.ontimeout = () => reject(errorFor(0, 'timeout'))
      xhr.send(form)
    })
  },
}

/** Dev/test stand-in: same interface, no network. CIDs are fake but deterministic ("bafymock..."). Can be told to
 *  fail the next N directory uploads to exercise resume. */
export class MockTransport implements PinataTransport {
  failNext = 0
  readonly pinned = new Map<string, string>()
  calls: string[] = []
  delayMs: number
  constructor(delayMs = 400) {
    this.delayMs = delayMs
  }
  async testAuth(jwt: string) {
    this.calls.push('testAuth')
    if (!jwt) throw new PinataError('Pinata rejected the JWT (401).', 401, false)
  }
  async findPinByName(_jwt: string, name: string) {
    this.calls.push(`find:${name}`)
    return this.pinned.get(name) ?? null
  }
  async pinDirectory(_jwt: string, dirName: string, files: UploadFile[], onProgress: (l: number, t: number) => void) {
    this.calls.push(`pin:${dirName}:${files.length}`)
    const total = files.reduce((s, f) => s + f.blob.size, 0)
    const steps = 5
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, this.delayMs / steps))
      onProgress((total * i) / steps, total)
      if (this.failNext > 0 && i === 3) {
        this.failNext--
        throw new PinataError('Mock: simulated network failure mid-upload.', 0, true)
      }
    }
    const cid = 'bafymock' + sha256Hex(dirName + files.map((f) => `${f.name}:${f.blob.size}`).join('|')).slice(0, 46)
    this.pinned.set(dirName, cid)
    return cid
  }
}

export const mockTransport = new MockTransport()

export interface UploadPlan {
  fire: number
  imageFiles: UploadFile[]
  /** Builds the metadata files once the images CID is known. */
  makeMetadata: (imagesCid: string) => UploadFile[]
  existing: { imagesCid?: string; metadataCid?: string }
  /** Persist progress immediately (so a crash or reload can resume). */
  save: (patch: { imagesCid?: string; metadataCid?: string }) => Promise<void>
  onStatus: (text: string) => void
  onProgress: (fraction: number) => void
  /** Folder names; a suffix lets a re-upload with changed files avoid reusing an old pin of the same name. */
  imagesDirName?: string
  metadataDirName?: string
}

async function withRetry<T>(what: string, fn: () => Promise<T>, onStatus: (t: string) => void, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const retryable = e instanceof PinataError && e.retryable
      if (!retryable || i >= attempts) throw e
      const wait = 2000 * 2 ** (i - 1)
      onStatus(`${what}: ${(e as Error).message} Retrying in ${wait / 1000}s (attempt ${i + 1} of ${attempts})...`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

export async function uploadFire(plan: UploadPlan, transport: PinataTransport): Promise<{ imagesCid: string; metadataCid: string }> {
  const jwt = sessionJwt
  if (!jwt) throw new Error('Enter the Pinata JWT first.')
  const imagesDir = plan.imagesDirName ?? `fire-${plan.fire}-images`
  const metaDir = plan.metadataDirName ?? `fire-${plan.fire}-metadata`

  plan.onStatus('Checking the Pinata key...')
  await withRetry('Key check', () => transport.testAuth(jwt), plan.onStatus)

  let imagesCid = plan.existing.imagesCid
  if (imagesCid) {
    plan.onStatus(`Images already uploaded (${imagesCid}), skipping.`)
  } else {
    imagesCid = (await withRetry('Lookup', () => transport.findPinByName(jwt, imagesDir), plan.onStatus)) ?? undefined
    if (imagesCid) plan.onStatus(`Found an earlier finished upload of ${imagesDir} (${imagesCid}); reusing it.`)
    else {
      plan.onStatus(`Uploading ${plan.imageFiles.length} images as ${imagesDir}/ ...`)
      imagesCid = await withRetry('Image upload', () => transport.pinDirectory(jwt, imagesDir, plan.imageFiles, (l, t) => plan.onProgress(0.9 * (l / Math.max(1, t)))), plan.onStatus)
    }
    await plan.save({ imagesCid })
  }
  plan.onProgress(0.9)

  let metadataCid = plan.existing.metadataCid
  if (metadataCid) {
    plan.onStatus(`Metadata already uploaded (${metadataCid}), skipping.`)
  } else {
    metadataCid = (await withRetry('Lookup', () => transport.findPinByName(jwt, metaDir), plan.onStatus)) ?? undefined
    if (metadataCid) plan.onStatus(`Found an earlier finished upload of ${metaDir} (${metadataCid}); reusing it.`)
    else {
      const meta = plan.makeMetadata(imagesCid)
      plan.onStatus(`Uploading ${meta.length} metadata files as ${metaDir}/ ...`)
      metadataCid = await withRetry('Metadata upload', () => transport.pinDirectory(jwt, metaDir, meta, (l, t) => plan.onProgress(0.9 + 0.1 * (l / Math.max(1, t)))), plan.onStatus)
    }
    await plan.save({ metadataCid })
  }
  plan.onProgress(1)
  plan.onStatus('Done.')
  return { imagesCid, metadataCid }
}
