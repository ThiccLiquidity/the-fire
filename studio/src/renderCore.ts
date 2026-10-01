/** Shared by the build worker and the main-thread fallback: decodes asset blobs lazily (small LRU of bitmaps, art
 *  downscaled to what the art window needs) and renders cards to encoded Blobs via render.ts. */

import type { DealtCard } from './deal'
import { cardView, renderCardBlob, type CardAssets } from './render'
import { CARD_H, CARD_W, type Material } from './rules'
import type { Layout, OutputFormat, Variant } from './types'

export type VariantBlobs = Partial<Record<Variant, Blob>>

export interface AssetBundle {
  layouts: Record<Material, Layout>
  frames: Record<Material, VariantBlobs>
  /** art[characterId][material][variant] */
  art: Record<string, Partial<Record<Material, VariantBlobs>>>
  names: Record<string, string>
  /** Uploaded fonts (registered in the worker's FontFaceSet; the main thread already has them). */
  fonts: { family: string; data: ArrayBuffer }[]
}

export interface RenderJob {
  card: DealtCard
}

const LRU_SIZE = 16

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

  private frame(m: Material, v: Variant): Promise<ImageBitmap | null> {
    // a missing holo frame falls back to the normal one (the review screen flags it)
    const blob = this.bundle.frames[m]?.[v] ?? this.bundle.frames[m]?.normal
    return this.bitmap(`frame:${m}:${v}`, async () => (blob ? createImageBitmap(blob) : null))
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
      this.frame(card.material, card.holoFrame ? 'holo' : 'normal'),
      this.art(card.characterId, card.material, card.holoPicture ? 'holo' : 'normal'),
    ])
    return { frame, art }
  }

  async render(card: DealtCard, format: OutputFormat): Promise<Blob> {
    const assets = await this.assetsFor(card)
    const view = cardView(card, this.bundle.names[card.characterId] ?? card.characterId)
    return renderCardBlob(assets, this.bundle.layouts[card.material], view, format, this.canvas)
  }

  dispose(): void {
    for (const p of this.cache.values()) void p.then((b) => b?.close())
    this.cache.clear()
  }
}
