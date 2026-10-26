import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// an in-memory stand-in for IndexedDB (db.ts)
const mem = vi.hoisted(() => ({ records: new Map<string, unknown>(), blobs: new Map<string, Blob>() }))
vi.mock('./db', () => ({
  getAllRecords: async () => new Map(mem.records),
  putRecord: async (k: string, v: unknown) => { mem.records.set(k, v) },
  deleteRecord: async (k: string) => { mem.records.delete(k) },
  putBlob: async (k: string, b: Blob) => { mem.blobs.set(k, b) },
  getBlob: async (k: string) => mem.blobs.get(k),
  deleteBlob: async (k: string) => { mem.blobs.delete(k) },
  newId: () => Math.random().toString(16).slice(2, 10),
}))

import { getStudio, loadStudio, removeCharacterImage, updateImageKey, watchBlobUrl } from './store'
import type { Character, ImageSlot } from './types'

const tick = () => new Promise((r) => setTimeout(r, 0))
const slot = (originalKey: string, processedKey?: string): ImageSlot => ({
  originalKey, ...(processedKey ? { processedKey } : {}), keyMagenta: !!processedKey, tolerance: 70, feather: 90, despill: 0.85,
  width: 10, height: 10, fileName: 'a.png', updatedAt: 1,
})
const rabbit = (images: Character['images']): Character => ({ id: 'r', name: 'Rabbit', shortId: '', category: 'Animals', images, createdAt: 1, updatedAt: 1 })

describe('Library thumbnails (object URLs)', () => {
  let revoked: string[]
  beforeEach(() => {
    mem.records.clear()
    mem.blobs.clear()
    mem.records.set('global', { nextSerial: 1, nextFireNumber: 1, categoriesFree: true })
    revoked = []
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => { revoked.push(u) })
  })
  afterEach(() => vi.restoreAllMocks())

  it('a shown thumbnail gets a fresh URL when a reload (import) revokes the cached one', async () => {
    mem.blobs.set('img:r:paper:normal:1', new Blob(['p'], { type: 'image/png' }))
    mem.records.set('char:r', rabbit({ paper: { normal: slot('img:r:paper:normal:1') } }))
    await loadStudio()
    const seen: (string | null)[] = []
    const off = watchBlobUrl('img:r:paper:normal:1', (u) => seen.push(u))
    await tick()
    expect(seen).toHaveLength(1)
    const first = seen[0]!
    expect(first).toMatch(/^blob:/)

    // Data > Import restores a backup (same keys) and reloads the studio: the cached URL is revoked
    await loadStudio()
    await tick()
    expect(revoked).toContain(first)
    // before the fix the thumbnail kept showing `first`, a revoked URL: a broken image
    expect(seen.at(-1)).toMatch(/^blob:/)
    expect(seen.at(-1)).not.toBe(first)
    off()
  })

  it('a removed picture clears the thumbnail instead of leaving a revoked URL', async () => {
    mem.blobs.set('img:r:wood:normal:1', new Blob(['w'], { type: 'image/png' }))
    mem.records.set('char:r', rabbit({ wood: { normal: slot('img:r:wood:normal:1') } }))
    await loadStudio()
    const seen: (string | null)[] = []
    const off = watchBlobUrl('img:r:wood:normal:1', (u) => seen.push(u))
    await tick()
    await removeCharacterImage('r', 'wood', 'normal')
    await tick()
    expect(revoked).toContain(seen[0])
    expect(seen.at(-1)).toBeNull()
    off()
  })

  it('turning keying off saves the slot before deleting the old keyed file, so the slot never names a missing blob', async () => {
    mem.blobs.set('img:r:fire:normal:1', new Blob(['o'], { type: 'image/png' }))
    mem.blobs.set('img:r:fire:normal:1:keyed:1', new Blob(['k'], { type: 'image/png' }))
    mem.records.set('char:r', rabbit({ fire: { normal: slot('img:r:fire:normal:1', 'img:r:fire:normal:1:keyed:1') } }))
    await loadStudio()
    await updateImageKey('r', 'fire', 'normal', { keyMagenta: false })
    const s = getStudio().characters[0].images.fire!.normal!
    expect(s.processedKey).toBeUndefined()
    expect(mem.blobs.has(s.originalKey)).toBe(true)
    expect(mem.blobs.has('img:r:fire:normal:1:keyed:1')).toBe(false)
  })

  it('every picture a loaded character names is in the blob store (Full Art holo moved to normal keeps its file)', async () => {
    mem.blobs.set('img:r:fullart:holo:1', new Blob(['f'], { type: 'image/png' }))
    mem.records.set('char:r', rabbit({ fullart: { holo: slot('img:r:fullart:holo:1') } }))
    await loadStudio()
    const fa = getStudio().characters[0].images.fullart!
    expect(fa.normal?.originalKey).toBe('img:r:fullart:holo:1')
    const seen: (string | null)[] = []
    const off = watchBlobUrl(fa.normal!.originalKey, (u) => seen.push(u))
    await tick()
    expect(seen[0]).toMatch(/^blob:/)
    off()
  })
})
