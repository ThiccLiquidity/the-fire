/** Tiny IndexedDB wrapper. Two stores:
 *  - `records`: JSON-like records keyed by "char:<id>", "frame:<material>", "layout:<material>", "font:<id>",
 *    "fire:<n>", "global".
 *  - `blobs`: binary files (character images, keyed images, frames, fonts, rendered cards) keyed by string.
 *  Rendered cards use the "render:<fire>:<serial>" prefix and are left out of the library backup (they can be rebuilt). */

const DB_NAME = 'card-studio'
const DB_VERSION = 1
const RECORDS = 'records'
const BLOBS = 'blobs'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS)
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab of Card Studio; close it and reload.'))
    })
  }
  return dbPromise
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted (disk full?)'))
  })
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'))
  })
}

export async function getAllRecords(): Promise<Map<string, unknown>> {
  const db = await open()
  const tx = db.transaction(RECORDS, 'readonly')
  const store = tx.objectStore(RECORDS)
  const [keys, values] = await Promise.all([reqP(store.getAllKeys()), reqP(store.getAll())])
  const out = new Map<string, unknown>()
  keys.forEach((k, i) => out.set(String(k), values[i]))
  return out
}

export async function putRecord(key: string, value: unknown): Promise<void> {
  const db = await open()
  const tx = db.transaction(RECORDS, 'readwrite')
  tx.objectStore(RECORDS).put(value, key)
  await done(tx)
}

export async function deleteRecord(key: string): Promise<void> {
  const db = await open()
  const tx = db.transaction(RECORDS, 'readwrite')
  tx.objectStore(RECORDS).delete(key)
  await done(tx)
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await open()
  const tx = db.transaction(BLOBS, 'readwrite')
  tx.objectStore(BLOBS).put(blob, key)
  await done(tx)
}

export async function putBlobs(entries: [string, Blob][]): Promise<void> {
  if (!entries.length) return
  const db = await open()
  const tx = db.transaction(BLOBS, 'readwrite')
  const store = tx.objectStore(BLOBS)
  for (const [k, b] of entries) store.put(b, k)
  await done(tx)
}

export async function getBlob(key: string): Promise<Blob | undefined> {
  const db = await open()
  const tx = db.transaction(BLOBS, 'readonly')
  return (await reqP(tx.objectStore(BLOBS).get(key))) as Blob | undefined
}

export async function deleteBlob(key: string): Promise<void> {
  const db = await open()
  const tx = db.transaction(BLOBS, 'readwrite')
  tx.objectStore(BLOBS).delete(key)
  await done(tx)
}

export async function blobKeys(prefix = ''): Promise<string[]> {
  const db = await open()
  const tx = db.transaction(BLOBS, 'readonly')
  const range = prefix ? IDBKeyRange.bound(prefix, prefix + '￿') : undefined
  return (await reqP(tx.objectStore(BLOBS).getAllKeys(range))).map(String)
}

export async function deleteBlobsWithPrefix(prefix: string): Promise<void> {
  const db = await open()
  const tx = db.transaction(BLOBS, 'readwrite')
  tx.objectStore(BLOBS).delete(IDBKeyRange.bound(prefix, prefix + '￿'))
  await done(tx)
}

/** Replace everything (used by Import). */
export async function replaceAll(records: [string, unknown][], blobs: [string, Blob][]): Promise<void> {
  const db = await open()
  const tx = db.transaction([RECORDS, BLOBS], 'readwrite')
  const r = tx.objectStore(RECORDS)
  const b = tx.objectStore(BLOBS)
  r.clear()
  b.clear()
  for (const [k, v] of records) r.put(v, k)
  for (const [k, v] of blobs) b.put(v, k)
  await done(tx)
}

export function newId(): string {
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

/** Ask the browser not to evict our storage under pressure (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
