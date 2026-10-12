/** Lines a character's holo art up with its normal art (align.ts), from the stored images: used by Match normal and
 *  automatically when a holo image is uploaded. */

import { matchImages, placementToMatch, toGray } from './align'
import { getBlob } from './db'
import { artBoxOf, variantsOf } from './frames'
import { effectiveKey, getStudio } from './store'
import type { Placement } from './types'

/** An image's grey pixels at most 512 px on the long side, and how much it was shrunk. */
async function grayOf(key: string): Promise<{ g: ReturnType<typeof toGray>; k: number; w: number; h: number }> {
  const blob = await getBlob(key)
  if (!blob) throw new Error('Image missing')
  const bmp = await createImageBitmap(blob)
  const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height))
  const w = Math.max(2, Math.round(bmp.width * k)), h = Math.max(2, Math.round(bmp.height * k))
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0, w, h)
  const out = { g: toGray(ctx.getImageData(0, 0, w, h).data, w, h), k, w: bmp.width, h: bmp.height }
  bmp.close()
  return out
}

export type HoloMatch =
  | { kind: 'none' } // no normal image to match, or this set has no normal art
  | { kind: 'different' } // the holo doesn't look like the same drawing
  | { kind: 'matched'; placement: Placement; exact: boolean }

/** The holo placement that puts the character where it sits in the normal art. */
export async function matchHoloToNormal(charId: string, m: string): Promise<HoloMatch> {
  const c = getStudio().characters.find((x) => x.id === charId)
  const normal = c?.images[m]?.normal, holo = c?.images[m]?.holo
  if (!normal || !holo || !variantsOf(m).includes('normal')) return { kind: 'none' }
  const [n, h] = await Promise.all([grayOf(effectiveKey(normal)), grayOf(effectiveKey(holo))])
  const r = matchImages(n.g, h.g)
  // back to full-size pixels: normal = s * holo + t on the small copies
  const full = { s: (r.s * h.k) / n.k, tx: r.tx / n.k, ty: r.ty / n.k, confidence: r.confidence }
  if (full.confidence < 0.25) return { kind: 'different' }
  const res = placementToMatch(full, { w: n.w, h: n.h, placement: normal.placement }, { w: h.w, h: h.h }, artBoxOf(m))
  return { kind: 'matched', placement: res.placement, exact: res.ok }
}
