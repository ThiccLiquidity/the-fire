/** The collection's frames: the master frame templates, built into the studio and never uploaded or edited here.
 *  Sources: frames-src/originals (as delivered), cleaned by frames-src/clean_frames.py into src/assets/frames.
 *  Every frame shares FRAME_GEOMETRY, so one layout fits them all.
 *
 *  Frame sets. A set is every file src/assets/frames/<set>[-holo][-l<2-6>].webp: the normal and holo frames plus the
 *  PDA wear levels 2-6 (level 1, PDA 10, is the clean frame). The five Standard sets are paper, wood, burning (Fire),
 *  charcoal (Coal) and diamond. Any other set clean_frames.py has built (e.g. gold.webp, gold-holo.webp,
 *  gold-l2.webp ...) is found here automatically. Set ids are [a-z0-9]+. Each card type of a recipe uses one frame set
 *  (recipe.ts CardTypeDef.frameSet); a frame its cards can need that isn't there blocks the build. */

import { MATERIALS, MATERIAL_LABEL, WEAR_LEVELS, type HoloType, type WearLevel, type WearLook } from './rules'
import { VARIANTS, type Rect, type Variant } from './types'

export type FrameSetId = string

const files = import.meta.glob('./assets/frames/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

/** url by set, variant and wear ('clean' or L2..L6; L1 = clean). */
const FRAME_FILES: Record<FrameSetId, Partial<Record<Variant, Partial<Record<WearLook, string>>>>> = {}
for (const [path, url] of Object.entries(files)) {
  const m = /\/([a-z0-9]+)(-holo)?(?:-l([2-6]))?\.webp$/.exec(path)
  if (!m) continue
  const v: Variant = m[2] ? 'holo' : 'normal'
  const set = ((FRAME_FILES[m[1]] ??= {})[v] ??= {})
  set[m[3] ? (`L${m[3]}` as WearLevel) : 'clean'] = url
}
for (const set of Object.values(FRAME_FILES)) {
  for (const v of VARIANTS) {
    const f = set[v]
    if (f?.clean) f.L1 = f.clean // PDA 10 = pristine
  }
}

/** Every frame set found: the Standard five first, then the others alphabetically. */
export const FRAME_SETS: FrameSetId[] = [
  ...MATERIALS,
  ...Object.keys(FRAME_FILES).filter((s) => !(MATERIALS as readonly string[]).includes(s)).sort(),
]

/** The name shown for a frame set: Paper, Wood, Fire, Coal, Diamond, or the id capitalised. */
export function frameSetLabel(s: FrameSetId): string {
  return (MATERIAL_LABEL as Record<string, string>)[s] ?? s.charAt(0).toUpperCase() + s.slice(1)
}

/** Kept for older code paths: the clean frames of the Standard sets. */
export const BUILTIN_FRAMES: Record<string, Partial<Record<Variant, string>>> = Object.fromEntries(
  FRAME_SETS.map((s) => [s, { normal: FRAME_FILES[s]?.normal?.clean, holo: FRAME_FILES[s]?.holo?.clean }]),
)

/** Bump (to a time in the past, e.g. when the change is made) when a frame file is added or changed: approvals made
 *  before this go stale and must be redone. */
export const FRAMES_UPDATED_AT = Date.UTC(2026, 9, 3, 6, 0)

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
export function frameUrl(s: FrameSetId, v: Variant, wear: WearLook = 'clean'): string | undefined {
  return FRAME_FILES[s]?.[v]?.[wear]
}

export function hasFrame(s: FrameSetId, v: Variant, wear: WearLook = 'clean'): boolean {
  return !!frameUrl(s, v, wear)
}

export function frameId(s: FrameSetId, v: Variant, wear: WearLook): string {
  return `${s}:${v}:${wear}`
}

/** The frame variant a holo look uses: a holo frame for frame and full holo. */
export function frameVariantOf(h: HoloType): Variant {
  return h === 'frame' || h === 'full' ? 'holo' : 'normal'
}

/** Frames missing from a set for the given holo looks (normal / holo, clean and every wear level), as readable
 *  labels, e.g. "Gold holo PDA 9-8". */
export function missingFramesFor(s: FrameSetId, holos: readonly HoloType[]): string[] {
  const out: string[] = []
  for (const v of VARIANTS) {
    if (!holos.some((h) => frameVariantOf(h) === v)) continue
    for (const w of ['clean', ...WEAR_LEVELS] as WearLook[]) {
      if (!hasFrame(s, v, w)) out.push(`${frameSetLabel(s)} ${v}${w === 'clean' || w === 'L1' ? '' : ` wear ${w}`}`)
    }
  }
  return [...new Set(out)]
}

/** How complete a frame set is: files present out of 12 (normal and holo, clean + 5 wear levels each). */
export function frameSetFiles(s: FrameSetId): { have: number; total: number } {
  let have = 0
  for (const v of VARIANTS) for (const w of ['clean', 'L2', 'L3', 'L4', 'L5', 'L6'] as WearLook[]) if (hasFrame(s, v, w)) have++
  return { have, total: 12 }
}

const cache = new Map<string, Promise<Blob>>()

/** The frame file as a Blob (fetched once per session), or undefined if that frame doesn't exist. */
export function frameBlob(s: FrameSetId, v: Variant, wear: WearLook = 'clean'): Promise<Blob> | undefined {
  const url = frameUrl(s, v, wear)
  if (!url) return undefined
  let p = cache.get(url)
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Frame ${s} ${v} failed to load (${r.status})`)
      return r.blob()
    })
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p
}
