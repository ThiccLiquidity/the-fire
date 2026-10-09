import { describe, expect, it } from 'vitest'
import { carBytes, planCar } from './car'
import { signV4 } from './sigv4'
import {
  FilebaseError, MockFilebase, clearFilebaseKey, filebaseTransport, hasFilebaseKey, pinOnFilebase, setFilebaseKey, type FilebaseCar,
} from './filebase'

describe('SigV4 (AWS published examples)', () => {
  it('signs the test suite\'s get-vanilla request', async () => {
    const h = await signV4({
      method: 'GET', url: 'https://example.amazonaws.com/', region: 'us-east-1', service: 'service',
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' },
      now: new Date('2015-08-30T12:36:00Z'),
    })
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31')
    expect(h['x-amz-date']).toBe('20150830T123600Z')
  })

  it('signs the S3 documentation\'s GET object example', async () => {
    const sha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    const h = await signV4({
      method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', region: 'us-east-1', service: 's3', payloadHash: sha,
      headers: { range: 'bytes=0-9', 'x-amz-content-sha256': sha },
      credentials: { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
      now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })
})

/** A fake Filebase S3 endpoint: multipart uploads with `x-amz-meta-import: car`, ListParts, and the CID header. */
function fakeFilebase(root: string, opts: { failPart?: number; cidLate?: number } = {}) {
  const uploads = new Map<string, { key: string; parts: Map<number, Uint8Array>; car: boolean }>()
  const objects = new Map<string, { bytes: Uint8Array; cid?: string }>()
  let failPart = opts.failPart ?? 0
  let puts = 0
  let cidLate = opts.cidLate ?? 0
  let starts = 0
  const fetchFn = (async (input: string, init: RequestInit) => {
    const url = new URL(input)
    const h = new Headers(init.headers)
    expect(h.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/)
    expect(h.get('x-amz-content-sha256')).toMatch(/^[0-9a-f]{64}$/)
    const [, bucket, ...rest] = url.pathname.split('/')
    expect(bucket).toBe('omni-images')
    const key = decodeURIComponent(rest.join('/'))
    const q = url.searchParams
    const body = init.body ? new Uint8Array(await (init.body as Blob).arrayBuffer()) : new Uint8Array(0)
    if (init.method === 'HEAD' && !key) return new Response(null, { status: 200 })
    if (init.method === 'HEAD') {
      const o = objects.get(key)
      if (o?.cid && cidLate > 0) { cidLate--; return new Response(null, { status: 200 }) }
      return o ? new Response(null, { status: 200, headers: o.cid ? { 'x-amz-meta-cid': o.cid } : {} }) : new Response(null, { status: 404 })
    }
    if (init.method === 'POST' && q.has('uploads')) {
      const id = `up${++starts}`
      uploads.set(id, { key, parts: new Map(), car: h.get('x-amz-meta-import') === 'car' })
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`, { status: 200 })
    }
    if (init.method === 'PUT' && q.has('partNumber')) {
      if (failPart && ++puts === failPart) { failPart = 0; return new Response('<Error><Code>InternalError</Code></Error>', { status: 503 }) }
      uploads.get(q.get('uploadId')!)!.parts.set(Number(q.get('partNumber')), body)
      return new Response(null, { status: 200, headers: { ETag: `"etag${q.get('partNumber')}"` } })
    }
    if (init.method === 'GET' && q.has('uploadId')) {
      const u = uploads.get(q.get('uploadId')!)
      if (!u) return new Response('<Error><Code>NoSuchUpload</Code></Error>', { status: 404 })
      const parts = [...u.parts].map(([n, b]) => `<Part><PartNumber>${n}</PartNumber><ETag>&quot;etag${n}&quot;</ETag><Size>${b.length}</Size></Part>`).join('')
      return new Response(`<ListPartsResult>${parts}</ListPartsResult>`, { status: 200 })
    }
    if (init.method === 'POST' && q.has('uploadId')) {
      const u = uploads.get(q.get('uploadId')!)!
      const xml = new TextDecoder().decode(body)
      const listed = [...xml.matchAll(/<PartNumber>(\d+)<\/PartNumber><ETag>"etag(\d+)"<\/ETag>/g)].map((m) => Number(m[1]))
      expect(listed).toEqual([...u.parts.keys()].sort((a, b) => a - b))
      const all = listed.flatMap((n) => [...u.parts.get(n)!])
      objects.set(u.key, { bytes: new Uint8Array(all), cid: u.car ? root : undefined })
      uploads.delete(q.get('uploadId')!)
      return new Response('<CompleteMultipartUploadResult/>', { status: 200 })
    }
    throw new Error(`unexpected ${init.method} ${input}`)
  }) as unknown as typeof fetch
  return { fetchFn, objects, uploads, starts: () => starts }
}

describe('Filebase (S3 CAR import) against a fake endpoint', () => {
  const files = [{ name: 'c0-wood-none-u.webp', blob: new Blob(['w'.repeat(40_000)]) }, { name: 'manifest.json', blob: new Blob(['{}']) }]

  it('uploads the CAR in parts, resumes after a failed part, and returns the CID Filebase pinned', async () => {
    const car = await planCar(files)
    const fake = fakeFilebase(car.root, { failPart: 3 })
    const real = globalThis.fetch
    globalThis.fetch = fake.fetchFn
    try {
      setFilebaseKey({ accessKeyId: 'AK', secretAccessKey: 'SECRET', bucket: 'omni-images' })
      const t = filebaseTransport(10_000, 'https://s3.example')
      let saved: string | null = null
      const up: FilebaseCar = { name: 'fire-7-images-abc', root: car.root, size: car.size, bytes: (from) => carBytes(files, car.root, from), onResumeId: async (id) => { saved = id } }
      const statuses: string[] = []
      const cid = await pinOnFilebase(t, up, (s) => statuses.push(s), () => {})
      expect(cid).toBe(car.root)
      expect(statuses.some((s) => /Retrying/.test(s))).toBe(true)
      expect(saved).toBeNull()
      // the object is the CAR byte for byte
      let all = new Uint8Array(0)
      for await (const c of carBytes(files, car.root)) { const n = new Uint8Array(all.length + c.length); n.set(all); n.set(c, all.length); all = n }
      expect(fake.objects.get('fire-7-images-abc.car')!.bytes).toEqual(all)
      // asked again: Filebase has it, nothing is uploaded
      const before = fake.uploads.size
      expect(await pinOnFilebase(t, up, () => {}, () => {})).toBe(car.root)
      expect(fake.uploads.size).toBe(before)
    } finally {
      globalThis.fetch = real
      clearFilebaseKey()
    }
  })

  it('waits for a CID that is slow to show, without uploading again', async () => {
    const car = await planCar(files)
    const fake = fakeFilebase(car.root, { cidLate: 4 })
    const real = globalThis.fetch
    globalThis.fetch = fake.fetchFn
    try {
      setFilebaseKey({ accessKeyId: 'AK', secretAccessKey: 'SECRET', bucket: 'omni-images' })
      const waits: number[] = []
      const t = filebaseTransport(10_000, 'https://s3.example', [1, 2, 3, 4, 5], async (ms) => { waits.push(ms) })
      const statuses: string[] = []
      const up: FilebaseCar = { name: 'slow', root: car.root, size: car.size, bytes: (from) => carBytes(files, car.root, from), onResumeId: async () => {} }
      expect(await pinOnFilebase(t, up, (s) => statuses.push(s), () => {})).toBe(car.root)
      expect(waits).toEqual([1, 2, 3, 4])
      expect(fake.starts()).toBe(1)
      expect(statuses.some((s) => /waiting for it to report the CID/.test(s))).toBe(true)
      // never shows: a clear error, still one upload
      const never = fakeFilebase(car.root, { cidLate: 1_000 })
      globalThis.fetch = never.fetchFn
      const t2 = filebaseTransport(10_000, 'https://s3.example', [1, 2], async () => {})
      await expect(pinOnFilebase(t2, up, () => {}, () => {})).rejects.toThrow(/reported no CID/)
      expect(never.starts()).toBe(1)
    } finally {
      globalThis.fetch = real
      clearFilebaseKey()
    }
  })

  it('refuses a CID that isn\'t the folder\'s root', async () => {
    const car = await planCar(files)
    const fake = fakeFilebase('bafkreisomethingelse')
    const real = globalThis.fetch
    globalThis.fetch = fake.fetchFn
    try {
      setFilebaseKey({ accessKeyId: 'AK', secretAccessKey: 'SECRET', bucket: 'omni-images' })
      const up: FilebaseCar = { name: 'x', root: car.root, size: car.size, bytes: (from) => carBytes(files, car.root, from), onResumeId: async () => {} }
      await expect(pinOnFilebase(filebaseTransport(10_000, 'https://s3.example'), up, () => {}, () => {})).rejects.toThrow(/pinned bafkreisomethingelse, but the folder's CID is/)
    } finally {
      globalThis.fetch = real
      clearFilebaseKey()
    }
  })

  it('keeps the key in memory only, and never in an error message', async () => {
    clearFilebaseKey()
    expect(hasFilebaseKey()).toBe(false)
    setFilebaseKey({ accessKeyId: ' AK ', secretAccessKey: ' TOPSECRET ', bucket: ' b ' })
    expect(hasFilebaseKey()).toBe(true)
    const t = filebaseTransport(10_000, 'https://s3.example')
    const real = globalThis.fetch
    globalThis.fetch = (async () => new Response('<Error><Code>SignatureDoesNotMatch</Code><Message>no</Message></Error>', { status: 403 })) as unknown as typeof fetch
    try {
      const err = await pinOnFilebase(t, { name: 'x', root: 'r', size: 1, bytes: async function* () { yield new Uint8Array(1) }, onResumeId: async () => {} }, () => {}, () => {}).catch((e) => e)
      expect(err).toBeInstanceOf(FilebaseError)
      expect(String(err.message)).not.toMatch(/TOPSECRET|AK\b/)
    } finally {
      globalThis.fetch = real
      clearFilebaseKey()
    }
  })

  it('the mock pins without a network', async () => {
    const car = await planCar(files)
    const m = new MockFilebase()
    setFilebaseKey({ accessKeyId: 'AK', secretAccessKey: 'S', bucket: 'b' })
    expect(await pinOnFilebase(m, { name: 'n', root: car.root, size: car.size, bytes: (f) => carBytes(files, car.root, f), onResumeId: async () => {} }, () => {}, () => {})).toBe(car.root)
    expect(m.pinned.get('n')).toBe(car.root)
    clearFilebaseKey()
  })
})
