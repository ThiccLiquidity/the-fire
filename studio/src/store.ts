/** App state, written through to IndexedDB on every change. A tiny external store consumed with useSyncExternalStore. */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { DEFAULT_KEY, keyMagentaBlob, type KeyOptions } from './chroma'
import * as db from './db'
import { FRAMES_UPDATED_AT } from './frames'
import { normalizeLayout } from './layoutDefaults'
import { MATERIALS, type Material } from './rules'
import type { Character, FireRecord, FontAsset, GlobalState, ImageSlot, Layout, Variant } from './types'

export interface StudioData {
  loaded: boolean
  characters: Character[]
  layouts: Record<Material, Layout>
  fonts: FontAsset[]
  fires: FireRecord[]
  global: GlobalState
}

function emptyData(): StudioData {
  const layouts = {} as Record<Material, Layout>
  for (const m of MATERIALS) {
    layouts[m] = normalizeLayout(m, undefined)
  }
  return {
    loaded: false, characters: [], layouts, fonts: [], fires: [],
    global: { nextSerial: 1, nextFireNumber: 1 },
  }
}

let data: StudioData = emptyData()
const listeners = new Set<() => void>()
function set(next: Partial<StudioData>) {
  data = { ...data, ...next }
  for (const l of listeners) l()
}

export function useStudio(): StudioData {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => data)
}
export function getStudio(): StudioData {
  return data
}

/** Called whenever a blob changes so cached object URLs / bitmaps are dropped. */
const blobListeners = new Set<(key: string) => void>()
export function onBlobChanged(fn: (key: string) => void): () => void {
  blobListeners.add(fn)
  return () => blobListeners.delete(fn)
}
function blobChanged(key: string) {
  for (const l of blobListeners) l(key)
}

export async function loadStudio(): Promise<void> {
  const recs = await db.getAllRecords()
  const d = emptyData()
  for (const [k, v] of recs) {
    if (k.startsWith('char:')) d.characters.push(v as Character)
    else if (k.startsWith('frame:')) continue // legacy uploaded frames: the frames are built in now (frames.ts)
    else if (k.startsWith('layout:')) {
      const m = k.slice(7) as Material
      if (MATERIALS.includes(m)) d.layouts[m] = normalizeLayout(m, v as Partial<Layout>)
    } else if (k.startsWith('font:')) d.fonts.push(v as FontAsset)
    else if (k.startsWith('fire:')) d.fires.push(v as FireRecord)
    else if (k === 'global') {
      // older saves and backups also hold the rarity accumulators (no longer used: each Series stands alone); ignore them
      const { nextSerial, nextFireNumber } = v as GlobalState
      d.global = { nextSerial: nextSerial ?? d.global.nextSerial, nextFireNumber: nextFireNumber ?? d.global.nextFireNumber }
    }
  }
  d.characters.sort((a, b) => a.createdAt - b.createdAt)
  d.fires.sort((a, b) => a.number - b.number)
  for (const f of d.fonts) await registerFont(f)
  // after an import the same keys may hold different files: drop cached object URLs
  for (const key of [...urlCache.keys()]) blobChanged(key)
  d.loaded = true
  data = d
  for (const l of listeners) l()
}

// ---------- characters ----------

export async function saveCharacter(c: Character): Promise<void> {
  const next = { ...c, updatedAt: Date.now() }
  const exists = data.characters.some((x) => x.id === c.id)
  set({ characters: exists ? data.characters.map((x) => (x.id === c.id ? next : x)) : [...data.characters, next] })
  await db.putRecord(`char:${c.id}`, next)
}

export async function deleteCharacter(id: string): Promise<void> {
  const c = data.characters.find((x) => x.id === id)
  if (!c) return
  for (const m of MATERIALS) for (const v of ['normal', 'holo'] as Variant[]) {
    const slot = c.images[m]?.[v]
    if (slot) await deleteSlotBlobs(slot)
  }
  await db.deleteRecord(`char:${id}`)
  set({ characters: data.characters.filter((x) => x.id !== id) })
}

async function deleteSlotBlobs(slot: ImageSlot) {
  await db.deleteBlob(slot.originalKey)
  blobChanged(slot.originalKey)
  if (slot.processedKey) {
    await db.deleteBlob(slot.processedKey)
    blobChanged(slot.processedKey)
  }
}

/** True when the image's four corners are all close to magenta: probably art on a magenta background. */
async function looksMagenta(blob: Blob): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(bmp, 0, 0)
    const pts = [[2, 2], [bmp.width - 3, 2], [2, bmp.height - 3], [bmp.width - 3, bmp.height - 3]]
    bmp.close()
    return pts.every(([x, y]) => {
      const [r, g, b] = ctx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data
      return r > 200 && b > 200 && g < 80
    })
  } catch {
    return false
  }
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob)
  const out = { width: bmp.width, height: bmp.height }
  bmp.close()
  return out
}

export async function setCharacterImage(charId: string, m: Material, v: Variant, file: Blob, fileName: string, forceKey?: boolean): Promise<void> {
  const c = data.characters.find((x) => x.id === charId)
  if (!c) throw new Error('character not found')
  const { width, height } = await imageSize(file) // throws on non-images
  const old = c.images[m]?.[v]
  if (old) await deleteSlotBlobs(old)
  const originalKey = `img:${charId}:${m}:${v}:${db.newId()}`
  await db.putBlob(originalKey, file)
  const keyMagenta = forceKey ?? (await looksMagenta(file))
  let slot: ImageSlot = { originalKey, keyMagenta, ...DEFAULT_KEY, width, height, fileName, updatedAt: Date.now() }
  if (keyMagenta) slot = await processSlot(slot, file)
  await saveCharacter({ ...c, images: { ...c.images, [m]: { ...c.images[m], [v]: slot } } })
}

async function processSlot(slot: ImageSlot, original?: Blob): Promise<ImageSlot> {
  if (slot.processedKey) {
    await db.deleteBlob(slot.processedKey)
    blobChanged(slot.processedKey)
  }
  if (!slot.keyMagenta) return { ...slot, processedKey: undefined, updatedAt: Date.now() }
  const src = original ?? (await db.getBlob(slot.originalKey))
  if (!src) throw new Error('original image missing')
  const keyed = await keyMagentaBlob(src, slot)
  const processedKey = `${slot.originalKey}:keyed:${db.newId()}`
  await db.putBlob(processedKey, keyed)
  return { ...slot, processedKey, updatedAt: Date.now() }
}

export async function updateImageKey(charId: string, m: Material, v: Variant, opts: Partial<KeyOptions> & { keyMagenta?: boolean }): Promise<void> {
  const c = data.characters.find((x) => x.id === charId)
  const slot = c?.images[m]?.[v]
  if (!c || !slot) return
  const next = await processSlot({ ...slot, ...opts })
  await saveCharacter({ ...c, images: { ...c.images, [m]: { ...c.images[m], [v]: next } } })
}

export async function removeCharacterImage(charId: string, m: Material, v: Variant): Promise<void> {
  const c = data.characters.find((x) => x.id === charId)
  const slot = c?.images[m]?.[v]
  if (!c || !slot) return
  await deleteSlotBlobs(slot)
  const mat = { ...c.images[m] }
  delete mat[v]
  await saveCharacter({ ...c, images: { ...c.images, [m]: mat } })
}

/** The blob key the renderer should use for this slot. */
export function effectiveKey(slot: ImageSlot): string {
  return slot.keyMagenta && slot.processedKey ? slot.processedKey : slot.originalKey
}

export function completeness(c: Character): number {
  let n = 0
  for (const m of MATERIALS) for (const v of ['normal', 'holo'] as Variant[]) if (c.images[m]?.[v]) n++
  return n
}

/** Can go into a Series: all 10 images and a category. */
export function isReady(c: Character): boolean {
  return completeness(c) === 10 && !!c.category
}

// ---------- layouts, fonts ----------

export async function saveLayout(layout: Layout): Promise<void> {
  const next = { ...layout, updatedAt: Date.now() }
  await db.putRecord(`layout:${layout.material}`, next)
  set({ layouts: { ...data.layouts, [layout.material]: next } })
}

async function registerFont(f: FontAsset): Promise<void> {
  try {
    const blob = await db.getBlob(f.key)
    if (!blob) return
    const face = new FontFace(f.family, await blob.arrayBuffer())
    await face.load()
    document.fonts.add(face)
  } catch (e) {
    console.warn(`Font ${f.fileName} could not be loaded`, e)
  }
}

export async function addFont(file: File): Promise<FontAsset> {
  const id = db.newId()
  const key = `font:${id}`
  const family = `CS-${file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]/g, '')}-${id.slice(0, 4)}`
  // validate before storing
  const face = new FontFace(family, await file.arrayBuffer())
  await face.load()
  document.fonts.add(face)
  await db.putBlob(key, file)
  const f: FontAsset = { id, family, fileName: file.name, key, updatedAt: Date.now() }
  await db.putRecord(`font:${id}`, f)
  set({ fonts: [...data.fonts, f] })
  return f
}

export async function deleteFont(id: string): Promise<void> {
  const f = data.fonts.find((x) => x.id === id)
  if (!f) return
  await db.deleteBlob(f.key)
  await db.deleteRecord(`font:${id}`)
  set({ fonts: data.fonts.filter((x) => x.id !== id) })
}

export function fontFamilyCss(f: FontAsset): string {
  return `"${f.family}", sans-serif`
}

// ---------- fires & global ----------

/** In-memory state updates first (synchronously), then the IndexedDB write, so rapid successive edits never
 *  build on a stale copy. */
export async function saveFire(f: FireRecord): Promise<void> {
  const next = { ...f, updatedAt: Date.now() }
  const exists = data.fires.some((x) => x.number === f.number)
  set({ fires: (exists ? data.fires.map((x) => (x.number === f.number ? next : x)) : [...data.fires, next]).sort((a, b) => a.number - b.number) })
  await db.putRecord(`fire:${f.number}`, next)
}

/** Patch the latest copy of a Series (use this rather than spreading a possibly stale prop). */
export async function updateFire(n: number, patch: Partial<FireRecord> | ((f: FireRecord) => Partial<FireRecord>)): Promise<void> {
  const cur = data.fires.find((x) => x.number === n)
  if (!cur) throw new Error(`Series ${n} not found`)
  await saveFire({ ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) })
}

export async function deleteFire(n: number): Promise<void> {
  await db.deleteRecord(`fire:${n}`)
  await db.deleteBlobsWithPrefix(`render:${n}:`)
  set({ fires: data.fires.filter((x) => x.number !== n) })
}

export async function saveGlobal(g: GlobalState): Promise<void> {
  set({ global: g })
  await db.putRecord('global', g)
}

/** Latest time any asset that goes into a card changed (art, keyed art, frames, layouts, fonts). Approval must be
 *  newer than this, or something approved has since changed. */
export function lastAssetChange(characterIds?: string[]): number {
  let t = FRAMES_UPDATED_AT
  for (const c of data.characters) {
    if (characterIds && !characterIds.includes(c.id)) continue
    t = Math.max(t, c.updatedAt)
  }
  for (const m of MATERIALS) {
    t = Math.max(t, data.layouts[m].updatedAt)
  }
  for (const f of data.fonts) t = Math.max(t, f.updatedAt)
  return t
}

// ---------- blob display helpers ----------

const urlCache = new Map<string, Promise<string | null>>()
onBlobChanged((key) => {
  const p = urlCache.get(key)
  if (p) void p.then((u) => u && URL.revokeObjectURL(u))
  urlCache.delete(key)
})

export function blobUrl(key: string): Promise<string | null> {
  let p = urlCache.get(key)
  if (!p) {
    p = db.getBlob(key).then((b) => (b ? URL.createObjectURL(b) : null))
    urlCache.set(key, p)
  }
  return p
}

export function useBlobUrl(key: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!key) {
      setUrl(null)
      return
    }
    void blobUrl(key).then((u) => live && setUrl(u))
    return () => { live = false }
  }, [key])
  return url
}

/** Bumps when the page's fonts finish loading, so canvases drawn before then can redraw with the right font. */
export function useFontsVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    const bump = () => setV((x) => x + 1)
    document.fonts.addEventListener('loadingdone', bump)
    void document.fonts.ready.then(bump)
    return () => document.fonts.removeEventListener('loadingdone', bump)
  }, [])
  return v
}
