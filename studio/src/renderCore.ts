/** Shared by the build worker and the main-thread fallback: decodes asset blobs lazily (small LRU of bitmaps, art
 *  downscaled to what the art window needs) and renders cards to encoded Blobs via render.ts. */

import { cardView, renderCardBlob, renderTiltPartBlob, solidFullCardArt, withPlacement, type CardAssets, type CardFace, type TiltPart } from './render'
import { FULL_CARD_ART_SETS, artSetOf, frameId } from './frames'
import { CARD_H, CARD_W, wearLookOf, type WearLevel, type WearLook } from './rules'
import type { Layout, OutputFormat, Placement, Variant } from './types'

export type VariantBlobs = Partial<Record<Variant, Blob>>

export interface AssetBundle {
  /** By frame set. */
  layouts: Record<string, Layout>
  /** By frameId(set, variant): every frame the job can need that exists. */
  frames: Record<string, Blob>
  /** The PDA wear layers by wear level (L2..L6), when the job renders graded cards. */
  wear: Partial<Record<WearLevel, Blob>>
  /** art[characterId][frameSet][variant] */
  art: Record<string, Partial<Record<string, VariantBlobs>>>
  /** placement[characterId][frameSet][variant]: a character's framing of its full-card art, where set. */
  placement?: Record<string, Partial<Record<string, Partial<Record<Variant, Placement>>>>>
  names: Record<string, string>
  categories: Record<string, string | undefined>
  /** Uploaded fonts (registered in the worker's FontFaceSet; the main thread already has them). */
  fonts: { family: string; data: ArrayBuffer; weight?: string }[]
}

export interface RenderJob {
  face: CardFace
  /** A tilt layer (render.ts drawTiltPart, 720 x 1008 WEBP) instead of the finished image. */
  part?: TiltPart
}

/** Decoded bitmaps kept per renderer (each frame or wear layer is 1500 x 2100, about 12.6 MB decoded). A full-grid
 *  build renders one look's 12 states in a row (ungraded, cased, PDA 1-10), which needs the art, the frame and the 5
 *  wear layers, so 10 covers a look and its neighbour. */
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

  private frame(m: string, v: Variant): Promise<ImageBitmap | null> {
    // a missing frame is flagged on the review screen and blocks approval; render without it meanwhile
    const id = frameId(m, v)
    const blob = this.bundle.frames[id]
    return this.bitmap(`frame:${id}`, async () => (blob ? createImageBitmap(blob) : null))
  }

  private wear(w: WearLook): Promise<ImageBitmap | null> {
    const blob = w === 'clean' || w === 'L1' ? undefined : this.bundle.wear[w]
    if (!blob) return Promise.resolve(null)
    return this.bitmap(`wear:${w}`, () => createImageBitmap(blob))
  }

  private placementOf(charId: string, m: string, v: Variant): Placement | undefined {
    const p = this.bundle.placement?.[charId]?.[m]
    return this.bundle.art[charId]?.[m]?.[v] ? p?.[v] : p?.normal
  }

  private art(charId: string, m: string, v: Variant): Promise<ImageBitmap | null> {
    const blob = this.bundle.art[charId]?.[m]?.[v] ?? this.bundle.art[charId]?.[m]?.normal
    const zoom = Math.max(0.5, this.placementOf(charId, m, v)?.zoom ?? 1)
    return this.bitmap(`art:${charId}:${m}:${v}:${zoom}`, async () => {
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
      const need = fit * Math.max(1, a.scale) * zoom
      if (need >= 0.9) return full
      const w = Math.max(1, Math.round(full.width * need))
      const h = Math.max(1, Math.round(full.height * need))
      const small = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' })
      full.close()
      return small
    })
  }

  /** The clean frame and the one picture (Gold borrows Wood's); the holo is drawn over them (render.ts drawCard). */
  async assetsFor(face: CardFace): Promise<CardAssets> {
    const [frame, art, wear] = await Promise.all([
      this.frame(face.frameSet, 'normal'),
      this.art(face.characterId, artSetOf(face.frameSet), 'normal'),
      this.wear(wearLookOf(face.grade)),
    ])
    return { frame, art, wear }
  }

  async render(face: CardFace, format: OutputFormat, part?: TiltPart): Promise<Blob> {
    // the plain layer has no wear: don't decode a wear layer for it
    const assets = await this.assetsFor(part === 'plain' ? { ...face, grade: null } : face)
    const view = cardView(face, this.bundle.names[face.characterId] ?? face.characterId, this.bundle.categories[face.characterId])
    const base = this.bundle.layouts[face.frameSet]
    if (!base) throw new Error(`No layout for frame set ${face.frameSet}`)
    const layout = withPlacement(base, this.placementOf(face.characterId, artSetOf(face.frameSet), 'normal'))
    if (part) return renderTiltPartBlob(assets, layout, view, part, this.canvas)
    return renderCardBlob(assets, layout, view, format, this.canvas)
  }

  dispose(): void {
    for (const p of this.cache.values()) void p.then((b) => b?.close())
    this.cache.clear()
  }
}
