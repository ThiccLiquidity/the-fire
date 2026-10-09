import { describe, expect, it } from 'vitest'
import { ZipWriter, unzipBlobs } from './files'

const fill = (n: number, v: number) => new Uint8Array(n).fill(v)

describe('zip writing and streamed reading', () => {
  it('round-trips stored and deflated entries, read in pieces', async () => {
    const z = new ZipWriter()
    z.addStored('images/a.webp', fill(200_000, 7))
    z.addText('fire.json', '{"fire":7}')
    z.addStored('images/b.webp', fill(300, 9))
    expect([z.entries, z.bytes]).toEqual([3, 200_310])
    const zip = (await z.finish())!
    const got = await unzipBlobs(zip)
    expect([...got.keys()]).toEqual(['images/a.webp', 'fire.json', 'images/b.webp'])
    expect(new Uint8Array(await got.get('images/a.webp')!.arrayBuffer())).toEqual(fill(200_000, 7))
    expect(await got.get('fire.json')!.text()).toBe('{"fire":7}')
  })

  it('with a sink, writes as it goes and returns no Blob', async () => {
    const written: Uint8Array[] = []
    let closed = false
    const z = new ZipWriter({ write: async (b) => { written.push(b.slice()) }, close: async () => { closed = true } })
    z.addStored('x.bin', fill(50_000, 1))
    await z.drain()
    expect(written.reduce((n, b) => n + b.length, 0)).toBeGreaterThan(50_000)
    z.addText('y.txt', 'hello')
    expect(await z.finish()).toBeNull()
    expect(closed).toBe(true)
    const got = await unzipBlobs(new Blob(written as BlobPart[]))
    expect(await got.get('y.txt')!.text()).toBe('hello')
    expect(got.get('x.bin')!.size).toBe(50_000)
  })

  it('a failed write stops the zip', async () => {
    const z = new ZipWriter({ write: async () => { throw new Error('disk full') }, close: async () => {} })
    z.addStored('x.bin', fill(10, 1))
    await expect(z.drain()).rejects.toThrow(/disk full/)
  })
})
