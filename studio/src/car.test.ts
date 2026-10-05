import { CarReader } from '@ipld/car'
import { MemoryBlockstore } from 'blockstore-core/memory'
import { exporter } from 'ipfs-unixfs-exporter'
import { sha256 } from 'multiformats/hashes/sha2'
import { describe, expect, it } from 'vitest'
import { carBytes, planCar, type CarFile } from './car'

async function collect(it: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for await (const p of it) parts.push(p)
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** Byte arrays equal (expect().toEqual is far too slow on megabytes). */
function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function bytes(n: number, seed: number): Uint8Array {
  const b = new Uint8Array(n)
  let x = seed
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24 }
  return b
}

async function check(files: CarFile[]) {
  const plan = await planCar(files)
  const car = await collect(carBytes(files, plan.root))
  expect(car.length).toBe(plan.size)
  const reader = await CarReader.fromBytes(car)
  expect((await reader.getRoots()).map(String)).toEqual([plan.root])
  const store = new MemoryBlockstore()
  for await (const { cid, bytes: b } of reader.blocks()) {
    // every block hashes to its CID
    expect(same((await sha256.digest(b)).bytes, cid.multihash.bytes)).toBe(true)
    await store.put(cid, b)
  }
  for (const f of files.slice(0, 40)) {
    const entry = await exporter(`${plan.root}/${f.name}`, store)
    const got = await collect((entry as unknown as { content(): AsyncIterable<Uint8Array> }).content())
    expect(same(got, new Uint8Array(await f.blob.arrayBuffer()))).toBe(true)
  }
  return { plan, car, store }
}

describe('CAR folder', () => {
  it('packs a folder whose root CID is known before upload; every file reads back', async () => {
    const files: CarFile[] = [
      { name: 'c0-wood-none-u.webp', blob: new Blob([bytes(5000, 1) as BlobPart]) },
      { name: 'c0-wood-none-1.webp', blob: new Blob([bytes(2_500_000, 2) as BlobPart]) }, // several 1 MiB chunks
      { name: 'c1-gold-full-10.webp', blob: new Blob([bytes(17, 3) as BlobPart]) },
    ]
    const { plan, car } = await check(files)
    expect(plan.root).toMatch(/^bafy/)
    // the same files give the same CAR, and a resumed stream is the same bytes from the offset on
    expect(same(await collect(carBytes(files, plan.root)), car)).toBe(true)
    expect(same(await collect(carBytes(files, plan.root, 123_457)), car.subarray(123_457))).toBe(true)
    // different files, different root
    expect((await planCar([...files.slice(0, 2), { name: 'c1-gold-full-10.webp', blob: new Blob([bytes(18, 3) as BlobPart]) }])).root).not.toBe(plan.root)
  })

  it('shards a big folder (6,000 files: its directory block would pass 256 KiB) and still reads back', async () => {
    const files: CarFile[] = Array.from({ length: 6000 }, (_, i) => ({ name: `c${i}-paper-none-u.webp`, blob: new Blob([bytes(40, i) as BlobPart]) }))
    const { plan, store } = await check(files)
    const root = await exporter(plan.root, store)
    expect(root.type === 'directory' && root.unixfs.type).toBe('hamt-sharded-directory')
  }, 60_000)

  it('refuses duplicate names and empty folders', async () => {
    await expect(planCar([])).rejects.toThrow()
    const b = new Blob(['x'])
    await expect(planCar([{ name: 'a', blob: b }, { name: 'a', blob: b }])).rejects.toThrow(/same name/)
  })
})
