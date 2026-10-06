import { describe, expect, it } from 'vitest'
import { planCar } from './car'
import {
  MockTransport, PinataError, clearPinataJwt, metadataDirName, setPinataJwt, uploadFire, type PendingUpload, type UploadPlan,
} from './pinata'

type Saved = { imagesCid?: string; metadataCid?: string; pending?: PendingUpload | null }

const images = [{ name: '1.webp', blob: new Blob(['a']) }, { name: '2.webp', blob: new Blob(['bb'.repeat(5000)]) }]

function plan(existing: UploadPlan['existing'], saved: Saved): UploadPlan {
  return {
    fire: 1,
    imageFiles: images,
    makeMetadata: (cid) => [{ name: '1.json', blob: new Blob([JSON.stringify({ image: `ipfs://${cid}/1.webp` })]) }],
    existing,
    save: async (p) => { Object.assign(saved, p) },
    onStatus: () => {},
    onProgress: () => {},
  }
}

describe('uploadFire (mock transport, CAR folders)', () => {
  it('needs a JWT', async () => {
    clearPinataJwt()
    await expect(uploadFire(plan({}, {}), new MockTransport(0))).rejects.toThrow(/JWT/)
  })

  it('uploads images then metadata; the images CID is the folder CID computed locally', async () => {
    setPinataJwt('test-jwt')
    const t = new MockTransport(0)
    const saved: Saved = {}
    const r = await uploadFire(plan({}, saved), t)
    expect(r.imagesCid).toBe((await planCar(images)).root)
    expect(r.imagesCid).toMatch(/^bafy/)
    expect(saved).toMatchObject({ imagesCid: r.imagesCid, metadataCid: r.metadataCid, pending: null })
    expect(t.calls.filter((c) => c.startsWith('pin:'))).toEqual(['pin:fire-1-images:2', `pin:${metadataDirName(1, r.imagesCid)}:1`])
    clearPinataJwt()
  })

  it('resumes after a failure without re-uploading images', async () => {
    setPinataJwt('test-jwt')
    const t = new MockTransport(0)
    const saved: Saved = {}
    // Non-retryable failure on the metadata step: make the 2nd upload throw a 400.
    const orig = t.uploadCar.bind(t)
    let n = 0
    t.uploadCar = async (...args) => {
      if (++n === 2) throw new PinataError('bad request', 400, false)
      return orig(...args)
    }
    await expect(uploadFire(plan({}, saved), t)).rejects.toThrow(/bad request/)
    expect(saved.imagesCid).toMatch(/^bafy/)
    expect(saved.metadataCid).toBeUndefined()

    const before = t.calls.filter((c) => c.startsWith('pin:')).length
    const r = await uploadFire(plan({ imagesCid: saved.imagesCid }, saved), t)
    expect(r.imagesCid).toBe(saved.imagesCid)
    expect(saved.metadataCid).toBe(r.metadataCid)
    const pins = t.calls.filter((c) => c.startsWith('pin:'))
    expect(pins.length - before).toBe(1)
    expect(pins[pins.length - 1]).toMatch(/^pin:fire-1-metadata/)
    clearPinataJwt()
  })

  it('a saved upload of other images is not reused: the build is checked by its folder CID', async () => {
    setPinataJwt('test-jwt')
    const t = new MockTransport(0)
    const saved: Saved = {}
    const stale = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    const r = await uploadFire(plan({ imagesCid: stale, metadataCid: 'bafkold' }, saved), t)
    expect(r.imagesCid).toBe((await planCar(images)).root)
    expect(r.imagesCid).not.toBe(stale)
    expect(r.metadataCid).not.toBe('bafkold')
    expect(t.calls.filter((c) => c.startsWith('pin:'))).toHaveLength(2)
    clearPinataJwt()
  })

  it('a dropped connection mid-upload continues from the byte it reached (same upload URL)', async () => {
    setPinataJwt('test-jwt')
    const t = new MockTransport(0)
    t.failNext = 1
    const saved: Saved = {}
    const r = await uploadFire(plan({}, saved), t)
    expect(r.imagesCid).toBe((await planCar(images)).root)
    expect(t.calls.some((c) => /^resume:fire-1-images:\d+$/.test(c))).toBe(true)
    clearPinataJwt()
  }, 20_000)

  it('after a reload, a saved upload URL resumes the same CAR', async () => {
    setPinataJwt('test-jwt')
    const t = new MockTransport(0)
    t.failNext = 1
    const saved: Saved = {}
    // a non-retryable stop right after the failure: the pending upload stays saved
    const orig = t.uploadCar.bind(t)
    t.uploadCar = async (...args) => {
      try { return await orig(...args) } catch { throw new PinataError('tab closed', 0, false) }
    }
    await expect(uploadFire(plan({}, saved), t)).rejects.toThrow(/tab closed/)
    expect(saved.pending?.url).toMatch(/^mock:/)
    t.uploadCar = orig
    const r = await uploadFire(plan({ pending: saved.pending ?? undefined }, saved), t)
    expect(t.calls.some((c) => c.startsWith('resume:fire-1-images:'))).toBe(true)
    expect(r.imagesCid).toBe((await planCar(images)).root)
    expect(saved.pending).toBeNull()
    clearPinataJwt()
  })

  it('reuses a folder Pinata already has (found by its CID)', async () => {
    setPinataJwt('test-jwt')
    const t = new MockTransport(0)
    const root = (await planCar(images)).root
    t.pinned.add(root)
    const saved: Saved = {}
    const r = await uploadFire(plan({}, saved), t)
    expect(r.imagesCid).toBe(root)
    expect(t.calls).toContain(`find:${root}`)
    expect(t.calls.some((c) => c.startsWith('pin:fire-1-images'))).toBe(false)
    clearPinataJwt()
  })

  it('names the metadata folder after the images CID, so new images never reuse old metadata', async () => {
    expect(metadataDirName(7, 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')).toBe('fire-7-metadata-tqy55fbzdi')
    setPinataJwt('test-jwt')
    const t = new MockTransport(0)
    const saved: Saved = {}
    const r = await uploadFire(plan({}, saved), t)
    expect(t.calls.some((c) => c.startsWith(`pin:fire-1-metadata-${r.imagesCid.slice(-10)}:`))).toBe(true)
    expect(metadataDirName(1, 'bafyimagesBBBBBBBBBB0987654321')).not.toBe(metadataDirName(1, 'bafyimagesAAAAAAAAAA1234567890'))
    clearPinataJwt()
  })
})

describe('the real transport (tus flow, against a fake Pinata)', () => {
  it('creates the upload, sends the CAR in chunks, resumes from the server offset, returns upload-cid', async () => {
    const { pinataTransport } = await import('./pinata')
    const { carBytes } = await import('./car')
    const files = [{ name: 'a.webp', blob: new Blob(['x'.repeat(30_000)]) }, { name: 'b.webp', blob: new Blob(['y'.repeat(9_000)]) }]
    const car = await planCar(files)
    let received = new Uint8Array(0)
    let patches = 0
    let failOnce = true
    const meta: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const h = new Headers(init.headers)
      expect(h.get('Authorization')).toBe('Bearer jwt')
      if (init.method === 'POST') {
        expect(url).toBe('https://uploads.pinata.cloud/v3/files')
        expect(h.get('Upload-Length')).toBe(String(car.size))
        meta.push(h.get('Upload-Metadata')!)
        return new Response(null, { status: 201, headers: { Location: 'https://uploads.pinata.cloud/v3/files/abc' } })
      }
      if (init.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Upload-Offset': String(received.length) } })
      if (init.method === 'PATCH') {
        expect(Number(h.get('Upload-Offset'))).toBe(received.length)
        const body = new Uint8Array(await (init.body as Blob).arrayBuffer())
        if (++patches === 3 && failOnce) { failOnce = false; return new Response('boom', { status: 502 }) }
        const next = new Uint8Array(received.length + body.length)
        next.set(received)
        next.set(body, received.length)
        received = next
        const done = received.length === car.size
        return new Response(null, { status: done ? 204 : 204, headers: { 'Upload-Offset': String(received.length), ...(done ? { 'upload-cid': car.root } : {}) } })
      }
      throw new Error(`unexpected ${init.method} ${url}`)
    }) as typeof fetch
    try {
      const t = pinataTransport(10_000)
      let url: string | null = null
      const up = { name: 'fire-1-images-x', root: car.root, size: car.size, files: 2, bytes: (from: number) => carBytes(files, car.root, from), onResumeUrl: async (u: string | null) => { url = u } }
      await expect(t.uploadCar('jwt', up, () => {})).rejects.toThrow(/502/)
      expect(url).toBe('https://uploads.pinata.cloud/v3/files/abc')
      const cid = await t.uploadCar('jwt', { ...up, resumeUrl: url! }, () => {})
      expect(cid).toBe(car.root)
      expect(received.length).toBe(car.size)
      let all = new Uint8Array(0)
      for await (const c of carBytes(files, car.root)) { const n = new Uint8Array(all.length + c.length); n.set(all); n.set(c, all.length); all = n }
      expect(all.every((b, i) => b === received[i])).toBe(true)
      expect(atob(meta[0].split(',').find((x) => x.startsWith('car '))!.slice(4))).toBe('true')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
