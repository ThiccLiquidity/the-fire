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
import { MATERIALS, type Material, type WearLevel, type WearLook } from './rules'
import { VARIANTS, type Rect, type Variant } from './types'

export const BUILTIN_FRAMES: Record<Material, Partial<Record<Variant, string>>> = {
  paper: { normal: paper, holo: paperHolo },
  wood: { normal: wood, holo: woodHolo },
  burning: { normal: burning, holo: burningHolo },
  charcoal: { normal: charcoal, holo: charcoalHolo },
  diamond: { normal: diamond, holo: diamondHolo },
}

/** PSA wear frames, one per material x variant x wear level (6 x 5 x 2 = 60). Being made now; add each file to
 *  src/assets/frames as <material>[-holo]-l<1-6>.webp (through clean_frames.py) and list it here. */
export const BUILTIN_WEAR_FRAMES: Record<Material, Partial<Record<Variant, Partial<Record<WearLevel, string>>>>> = {
  paper: {}, wood: {}, burning: {}, charcoal: {}, diamond: {},
}

/** Bump (to a time in the past, e.g. when the change is made) when a frame file is added or changed: approvals made
 *  before this go stale and must be redone. */
export const FRAMES_UPDATED_AT = Date.UTC(2026, 9, 3, 5, 0)

/** From the templates' layout.json (750 x 1050), doubled to 1500 x 2100. Identical on every frame. */
export const FRAME_GEOMETRY = {
  /** The transparent square the art shows through. */
  art: { x: 128, y: 296, w: 1244, h: 1244 } as Rect,
  /** Safe area for the name, inside the top bar. */
  nameBar: { x: 160, y: 96, w: 1180, h: 128 } as Rect,
  /** Safe area for the info text, inside the bottom panel. */
  infoPanel: { x: 160, y: 1620, w: 1180, h: 360 } as Rect,
  /** Where the bottom text actually goes: inside the smallest bottom panel (Diamond's thick facets end at about
   *  x 170-1330, y 1685-1945), so every material lines up the same. */
  infoText: { x: 200, y: 1690, w: 1110, h: 250 } as Rect,
  cornerRadius: 93,
}

/** The file for this frame: the clean frame, or the worn one for a revealed grade. */
export function frameUrl(m: Material, v: Variant, wear: WearLook = 'clean'): string | undefined {
  return wear === 'clean' ? BUILTIN_FRAMES[m][v] : BUILTIN_WEAR_FRAMES[m][v]?.[wear]
}

export function hasFrame(m: Material, v: Variant, wear: WearLook = 'clean'): boolean {
  return !!frameUrl(m, v, wear)
}

export function frameId(m: Material, v: Variant, wear: WearLook): string {
  return `${m}:${v}:${wear}`
}

export function missingFrames(): { material: Material; variant: Variant }[] {
  return MATERIALS.flatMap((material) => VARIANTS.filter((v) => !hasFrame(material, v)).map((variant) => ({ material, variant })))
}

const cache = new Map<string, Promise<Blob>>()

/** The frame file as a Blob (fetched once per session), or undefined if that frame doesn't exist yet. */
export function frameBlob(m: Material, v: Variant, wear: WearLook = 'clean'): Promise<Blob> | undefined {
  const url = frameUrl(m, v, wear)
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
