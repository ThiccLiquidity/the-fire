/** A folder as one CAR (content-addressed archive), built in the browser, for uploading very large Series folders.
 *
 *  The folder is a UnixFS directory (CIDv1, raw leaves, 1 MiB chunks, HAMT-sharded when big: the 'unixfs-v1-2025'
 *  profile), so ipfs://<root>/<file> works like any IPFS folder and the root CID is known BEFORE uploading. Nothing is
 *  held in memory: planCar hashes the files once to get the root CID and the CAR's exact size, carBytes builds the
 *  same CAR again as a stream (identical bytes every time, so an interrupted upload can resume from any offset). */

import { CarWriter } from '@ipld/car'
import { importer, type ImporterOptions } from 'ipfs-unixfs-importer'
import { varint } from 'multiformats'
import { CID } from 'multiformats/cid'

export interface CarFile { name: string; blob: Blob }

const CHUNK = 1024 * 1024
const OPTIONS: ImporterOptions = {
  profile: 'unixfs-v1-2025', cidVersion: 1, rawLeaves: true, wrapWithDirectory: true,
  // one file and one block at a time: the blocks come out in the same order every run
  fileImportConcurrency: 1, blockWriteConcurrency: 1,
}

async function* read(blob: Blob): AsyncGenerator<Uint8Array> {
  for (let off = 0; off < blob.size; off += CHUNK) yield new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer())
  if (blob.size === 0) yield new Uint8Array(0)
}

function source(files: CarFile[], onFile?: (i: number) => void) {
  return (async function* () {
    for (let i = 0; i < files.length; i++) {
      onFile?.(i)
      yield { path: files[i].name, content: read(files[i].blob) }
    }
  })()
}

/** The folder's root CID and its CAR's size in bytes (hashes every file once). */
export async function planCar(files: CarFile[], onProgress?: (done: number, total: number) => void): Promise<{ root: string; size: number }> {
  if (!files.length) throw new Error('No files to pack.')
  if (new Set(files.map((f) => f.name)).size !== files.length) throw new Error('Two files have the same name.')
  let body = 0
  const store = {
    put: async (cid: CID, bytes: Uint8Array) => {
      const len = cid.bytes.length + bytes.length
      body += varint.encodingLength(len) + len
      return cid
    },
  }
  let root: CID | undefined
  for await (const entry of importer(source(files, (i) => onProgress?.(i, files.length)), store, OPTIONS)) root = entry.cid
  onProgress?.(files.length, files.length)
  if (!root) throw new Error('No root CID.')
  return { root: root.toString(), size: (await headerLength(root)) + body }
}

async function headerLength(root: CID): Promise<number> {
  const { writer, out } = CarWriter.create([root])
  const done = (async () => { let n = 0; for await (const c of out) n += c.length; return n })()
  await writer.close()
  return done
}

/** The CAR's bytes from `from` on (0 = all). The root must be planCar's. */
export async function* carBytes(files: CarFile[], root: string, from = 0): AsyncGenerator<Uint8Array> {
  const rootCid = CID.parse(root)
  const { writer, out } = CarWriter.create([rootCid])
  let last: CID | undefined
  const pump = (async () => {
    try {
      const store = { put: async (cid: CID, bytes: Uint8Array) => { await writer.put({ cid, bytes }); return cid } }
      for await (const entry of importer(source(files), store, OPTIONS)) last = entry.cid
    } finally {
      await writer.close()
    }
  })()
  let pos = 0
  for await (const chunk of out) {
    const end = pos + chunk.length
    if (end > from) yield pos >= from ? chunk : chunk.subarray(from - pos)
    pos = end
  }
  await pump
  if (!last || last.toString() !== root) throw new Error('The files changed while uploading (the folder CID no longer matches).')
}
