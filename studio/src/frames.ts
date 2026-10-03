/** The collection's frames: the owner's master templates, built into the studio and never uploaded or edited here.
 *  Sources: frames-src/originals (as delivered), cleaned by frames-src/clean_frames.py into src/assets/frames.
 *  Every frame shares FRAME_GEOMETRY, so one layout fits them all. A missing frame blocks approval of any Fire that
 *  deals that material + variant. */

import burning from './assets/frames/burning.webp'
import burningHolo from './assets/frames/burning-holo.webp'
import charcoal from './assets/frames/charcoal.webp'
import charcoalHolo from './assets/frames/charcoal-holo.webp'
import diamond from './assets/frames/diamond.webp'
import diamondHolo from './assets/frames/diamond-holo.webp'
import paper from './assets/frames/paper.webp'
import paperHolo from './assets/frames/paper-holo.webp'
import wood from './assets/frames/wood.webp'
import woodHolo from './assets/frames/wood-holo.webp'
import { MATERIALS, type Material } from './rules'
import { VARIANTS, type Rect, type Variant } from './types'

export const BUILTIN_FRAMES: Record<Material, Partial<Record<Variant, string>>> = {
  paper: { normal: paper, holo: paperHolo },
  wood: { normal: wood, holo: woodHolo },
  burning: { normal: burning, holo: burningHolo },
  charcoal: { normal: charcoal, holo: charcoalHolo },
  diamond: { normal: diamond, holo: diamondHolo },
}

/** Bump when a frame file is added or changed: approvals made before this go stale and must be redone. */
export const FRAMES_UPDATED_AT = Date.UTC(2026, 9, 3, 12)

/** Measured from the templates (1500 x 2100). Identical on every frame. */
export const FRAME_GEOMETRY = {
  /** The transparent square the art shows through. */
  art: { x: 128, y: 296, w: 1244, h: 1244 } as Rect,
  /** Inside of the top name bar. */
  nameBar: { x: 97, y: 83, w: 1306, h: 154 } as Rect,
  /** Inside of the bottom info panel. */
  infoPanel: { x: 99, y: 1611, w: 1305, h: 406 } as Rect,
  cornerRadius: 93,
}

export function hasFrame(m: Material, v: Variant): boolean {
  return !!BUILTIN_FRAMES[m][v]
}

export function missingFrames(): { material: Material; variant: Variant }[] {
  return MATERIALS.flatMap((material) => VARIANTS.filter((v) => !hasFrame(material, v)).map((variant) => ({ material, variant })))
}

const cache = new Map<string, Promise<Blob>>()

/** The frame file as a Blob (fetched once per session), or undefined if that frame doesn't exist yet. */
export function frameBlob(m: Material, v: Variant): Promise<Blob> | undefined {
  const url = BUILTIN_FRAMES[m][v]
  if (!url) return undefined
  let p = cache.get(url)
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Frame ${m} ${v} failed to load (${r.status})`)
      return r.blob()
    })
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p
}
