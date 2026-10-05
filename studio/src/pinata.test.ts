import { describe, expect, it } from 'vitest'
import { MockTransport, PinataError, clearPinataJwt, setPinataJwt, uploadFire, type UploadPlan } from './pinata'

function plan(existing: UploadPlan['existing'], saved: Record<string, string>): UploadPlan {
  return {
    fire: 1,
    imageFiles: [{ name: '1.webp', blob: new Blob(['a']) }, { name: '2.webp', blob: new Blob(['bb']) }],
    makeMetadata: (cid) => [{ name: '1.json', blob: new Blob([JSON.stringify({ image: `ipfs://${cid}/1.webp` })]) }],
    existing,
    save: async (p) => { Object.assign(saved, p) },
    onStatus: () => {},
    onProgress: () => {},
  }
}

describe('uploadFire (mock transport)', () => {
  it('needs a JWT', async () => {
    clearPinataJwt()
    await expect(uploadFire(plan({}, {}), new MockTransport(0))).rejects.toThrow(/JWT/)
  })

  it('uploads images then metadata, and resumes after a failure without re-uploading images', async () => {
    setPinataJwt('test-jwt')
    const t = new MockTransport(0)
    const saved: Record<string, string> = {}
    // Non-retryable failure on the metadata step: make the 2nd pin call throw a 400.
    const orig = t.pinDirectory.bind(t)
    let n = 0
    t.pinDirectory = async (...args) => {
      if (++n === 2) throw new PinataError('bad request', 400, false)
      return orig(...args)
    }
    await expect(uploadFire(plan({}, saved), t)).rejects.toThrow(/bad request/)
    expect(saved.imagesCid).toMatch(/^bafymock/)
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

  it('reuses a finished pin found by name', async () => {
    setPinataJwt('test-jwt')
    const t = new MockTransport(0)
    t.pinned.set('fire-1-images', 'bafyexisting')
    const saved: Record<string, string> = {}
    const r = await uploadFire(plan({}, saved), t)
    expect(r.imagesCid).toBe('bafyexisting')
    expect(t.calls.some((c) => c.startsWith('pin:fire-1-images'))).toBe(false)
    clearPinataJwt()
  })
})
