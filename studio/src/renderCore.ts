/** Shared by the build worker and the main-thread fallback: decodes asset blobs lazily (small LRU of bitmaps, art
 *  downscaled to what the art window needs) and renders cards to encoded Blobs via render.ts. */

import { cardView, renderCardBlob, solidFullCardArt, type CardAssets, type CardFace } from './render'
import { FULL_CARD_ART_SETS, frameId } from './frames'
import { CARD_H, CARD_W, wearLookOf, type WearLook } from './rules'
import type { Layout, OutputFormat, Variant } from './types'

export type VariantBlobs = Partial<Record<Variant, Blob>>

export interface AssetBundle {
  /** By frame set. */
  layouts: Record<string, Layout>
  /** By frameId(set, variant, wear): every frame the job can need that exists. */
  frames: Record<string, Blob>
  /** art[characterId][frameSet][variant] */
  art: Record<string, Partial<Record<string, VariantBlobs>>>
  names: Record<string, string>
  categories: Record<string, string | undefined>
  /** Uploaded fonts (registered in the worker's FontFaceSet; the main thread already has them). */
  fonts: { family: string; data: ArrayBuffer; weight?: string }[]
}

export interface RenderJob {
  face: CardFace
}

/** Decoded bitmaps kept per renderer (each frame is 1500 x 2100, about 12.6 MB decoded). A full-grid build renders
 *  one look's 12 states in a row (ungraded, cased, PDA 1-10), which needs the art plus 6 frames (ungraded, cased and
 *  PDA 10 use the clean frame), so 10
 *  covers a look and its neighbour without holding every frame of the Series. */
const LRU_SIZE = 10

export class CardRenderer {
  private cache = new Map<string, Promise<ImageBitmap | null>>()
  private canvas = new OffscreenCanvas(CARD_W, CARD_H)
  private readonly bundle: AssetBundle
  constructor(bundle: AssetBundle) {
    this.bundle = bundle
  }

  private bitmap(key: string, make: () => Promise<ImageBitmap | null>): Promise<ImageBitmap | null> {
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const p = make()
    this.cache.set(key, p)
    while (this.cache.size > LRU_SIZE) {
      const oldest = this.cache.keys().next().value as string
      const old = this.cache.get(oldest)
      this.cache.delete(oldest)
      void old?.then((b) => b?.close())
    }
    return p
  }

  private frame(m: string, v: Variant, wear: WearLook): Promise<ImageBitmap | null> {
    // a missing frame is flagged on the review screen and blocks approval; render without it meanwhile
    // PDA 10 (L1) is the pristine frame: decode it once, under the clean frame's id
    const id = frameId(m, v, wear === 'L1' && this.bundle.frames[frameId(m, v, 'clean')] ? 'clean' : wear)
    const blob = this.bundle.frames[id]
    return this.bitmap(`frame:${id}`, async () => (blob ? createImageBitmap(blob) : null))
  }

  private art(charId: string, m: string, v: Variant): Promise<ImageBitmap | null> {
    const blob = this.bundle.art[charId]?.[m]?.[v] ?? this.bundle.art[charId]?.[m]?.normal
    return this.bitmap(`art:${charId}:${m}:${v}`, async () => {
      if (!blob) return null
      let full = await createImageBitmap(blob)
      if (FULL_CARD_ART_SETS.includes(m)) {
        const solid = await solidFullCardArt(full)
        if (solid !== full) full.close()
        full = solid
      }
      // Downscale big art to what the art window needs (keeps memory sane with many characters).
      const a = (this.bundle.layouts[m] ?? Object.values(this.bundle.layouts)[0]).art
      const fit = a.fit === 'cover' ? Math.max(a.box.w / full.width, a.box.h / full.height) : Math.min(a.box.w / full.width, a.box.h / full.height)
      const need = fit * Math.max(1, a.scale)
      if (need >= 0.9) return full
      const w = Math.max(1, Math.round(full.width * need))
      const h = Math.max(1, Math.round(full.height * need))
      const small = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
      full.close()
      return small
    })
  }

  async assetsFor(face: CardFace): Promise<CardAssets> {
    const [frame, art] = await Promise.all([
      this.frame(face.frameSet, face.holoFrame ? 'holo' : 'normal', wearLookOf(face.grade)),
      this.art(face.characterId, face.frameSet, face.holoPicture ? 'holo' : 'normal'),
    ])
    return { frame, art }
  }

  async render(face: CardFace, format: OutputFormat): Promise<Blob> {
    const assets = await this.assetsFor(face)
    const view = cardView(face, this.bundle.names[face.characterId] ?? face.characterId, this.bundle.categories[face.characterId])
    const layout = this.bundle.layouts[face.frameSet]
    if (!layout) throw new Error(`No layout for frame set ${face.frameSet}`)
    return renderCardBlob(assets, layout, view, format, this.canvas)
  }

  dispose(): void {
    for (const p of this.cache.values()) void p.then((b) => b?.close())
    this.cache.clear()
  }
}
