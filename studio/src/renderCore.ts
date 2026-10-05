/** Shared by the build worker and the main-thread fallback: decodes asset blobs lazily (small LRU of bitmaps, art
 *  downscaled to what the art window needs) and renders cards to encoded Blobs via render.ts. */

import type { DealtCard } from './deal'
import { cardView, renderCardBlob, type CardAssets } from './render'
import { frameId } from './frames'
import { CARD_H, CARD_W, wearLookOf, type Material, type WearLook } from './rules'
import type { Layout, OutputFormat, Variant } from './types'

export type VariantBlobs = Partial<Record<Variant, Blob>>

export interface AssetBundle {
  layouts: Record<Material, Layout>
  /** By frameId(material, variant, wear): every frame that exists. */
  frames: Record<string, Blob>
  /** art[characterId][material][variant] */
  art: Record<string, Partial<Record<Material, VariantBlobs>>>
  names: Record<string, string>
  categories: Record<string, string | undefined>
  /** Uploaded fonts (registered in the worker's FontFaceSet; the main thread already has them). */
  fonts: { family: string; data: ArrayBuffer; weight?: string }[]
}

export interface RenderJob {
  card: DealtCard
}

/** Decoded bitmaps kept per renderer (each frame is 1500 x 2100, about 12.6 MB decoded). A full-grid build renders
 *  one look's 11 grade states in a row, which needs the art plus 6 frames (PDA 10 reuses the clean frame), so 10
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

  private frame(m: Material, v: Variant, wear: WearLook): Promise<ImageBitmap | null> {
    // a missing frame is flagged on the review screen and blocks approval; render without it meanwhile
    // PDA 10 (L1) is the pristine frame: decode it once, under the clean frame's id
    const id = frameId(m, v, wear === 'L1' && this.bundle.frames[frameId(m, v, 'clean')] ? 'clean' : wear)
    const blob = this.bundle.frames[id]
    return this.bitmap(`frame:${id}`, async () => (blob ? createImageBitmap(blob) : null))
  }

  private art(charId: string, m: Material, v: Variant): Promise<ImageBitmap | null> {
    const blob = this.bundle.art[charId]?.[m]?.[v] ?? this.bundle.art[charId]?.[m]?.normal
    return this.bitmap(`art:${charId}:${m}:${v}`, async () => {
      if (!blob) return null
      const full = await createImageBitmap(blob)
      // Downscale big art to what the art window needs (keeps memory sane with many characters).
      const a = this.bundle.layouts[m].art
      const fit = a.fit === 'cover' ? Math.max(a.box.w / full.width, a.box.h / full.height) : Math.min(a.box.w / full.width, a.box.h / full.height)
      const need = fit * Math.max(1, a.scale)
      if (need >= 0.9) return full
      const w = Math.max(1, Math.round(full.width * need))
      const h = Math.max(1, Math.round(full.height * need))
      full.close()
      return createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
    })
  }

  async assetsFor(card: DealtCard): Promise<CardAssets> {
    const [frame, art] = await Promise.all([
      this.frame(card.material, card.holoFrame ? 'holo' : 'normal', wearLookOf(card.grade)),
      this.art(card.characterId, card.material, card.holoPicture ? 'holo' : 'normal'),
    ])
    return { frame, art }
  }

  async render(card: DealtCard, format: OutputFormat): Promise<Blob> {
    const assets = await this.assetsFor(card)
    const view = cardView(card, this.bundle.names[card.characterId] ?? card.characterId, this.bundle.categories[card.characterId])
    return renderCardBlob(assets, this.bundle.layouts[card.material], view, format, this.canvas)
  }

  dispose(): void {
    for (const p of this.cache.values()) void p.then((b) => b?.close())
    this.cache.clear()
  }
}
