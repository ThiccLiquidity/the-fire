/** The collection's frames: the master frame templates, built into the studio and never uploaded or edited here.
 *  Sources: frames-src/originals (as delivered), cleaned by frames-src/clean_frames.py into src/assets/frames.
 *  Every frame shares FRAME_GEOMETRY, so one layout fits them all.
 *
 *  Frame sets. A set is one clean frame, src/assets/frames/<set>.webp. Holo is drawn over it (holoFx.ts), so the
 *  <set>-holo.webp files are retired and not used, except Gold's, which is the only Gold frame (gold-holo.webp). The
 *  Standard sets are paper, wood, burning (Fire), charcoal (Coal) and diamond (retired). Any other set
 *  clean_frames.py has built is found here automatically. Set ids are [a-z0-9]+. Full Art has no frame: the character's
 *  photo is the whole card. Each card type of a recipe uses one frame set (recipe.ts CardTypeDef.frameSet); a frame its
 *  cards can need that isn't there blocks the build.
 *
 *  Art. One picture per character per set, except Gold, which uses the character's Wood picture (artSetOf).
 *
 *  PDA wear is not in the frames: one set of wear layers (src/assets/wear/wear-l2..l6.webp, made by
 *  frames-src/wear_overlays.py) goes over every finished card, framed or Full Art, so every card type wears the same. */

import { MATERIALS, MATERIAL_LABEL, type HoloType, type WearLevel } from './rules'
import { VARIANTS, type Rect, type Variant } from './types'

export type FrameSetId = string

const files = import.meta.glob('./assets/frames/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const wearFiles = import.meta.glob('./assets/wear/wear-l*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

/** url by set: the clean frame, or the holo one where a set has nothing else (Gold). Holo frames are retired. */
const FRAME_FILES: Record<FrameSetId, Partial<Record<Variant, string>>> = {}
for (const [path, url] of Object.entries(files)) {
  const m = /\/([a-z0-9]+)(-holo)?\.webp$/.exec(path)
  if (!m) continue
  const f = (FRAME_FILES[m[1]] ??= {})
  if (!m[2] || !f.normal) f.normal = url
}

/** The wear layer's url by wear level (L2..L6; PDA 10, L1, is pristine and has none). */
const WEAR_FILES: Partial<Record<WearLevel, string>> = {}
for (const [path, url] of Object.entries(wearFiles)) {
  const m = /wear-l([2-6])\.webp$/.exec(path)
  if (m) WEAR_FILES[`L${m[1]}` as WearLevel] = url
}

/** Sets the Standard recipe uses beyond the five originals: Gold (its frame is built in) and Full Art (no frame). */
const EXPECTED_SETS = ['gold', 'fullart']

/** Frame sets with no frame at all: the art is the whole card (Full Art). */
export const FRAMELESS_SETS: readonly FrameSetId[] = ['fullart']

/** Every frame set: the five originals, Gold and Full Art, then any others found, alphabetically. */
export const FRAME_SETS: FrameSetId[] = [
  ...MATERIALS,
  ...EXPECTED_SETS,
  ...Object.keys(FRAME_FILES).filter((s) => !(MATERIALS as readonly string[]).includes(s) && !EXPECTED_SETS.includes(s)).sort(),
]

/** Frame sets no new Series uses (Gold replaced Diamond). Kept so older Series still build; hidden everywhere else. */
export const RETIRED_SETS: readonly FrameSetId[] = ['diamond']

/** The frame sets shown in the studio (Library, Frames & Layout, Preview, the recipe's frame picker). */
export const SHOWN_FRAME_SETS: FrameSetId[] = FRAME_SETS.filter((s) => !RETIRED_SETS.includes(s))

/** Gold and Full Art are always full holo (Gold: gold leaf and gold holo on the picture, a shine on the frame). */
export const HOLO_ONLY_SETS: readonly FrameSetId[] = ['gold', 'fullart']

/** Sets that use another set's picture instead of their own: Gold uses the Wood picture. */
const ART_FROM: Record<string, FrameSetId> = { gold: 'wood' }

/** The set whose picture a set's cards show (itself, or Wood for Gold). */
export function artSetOf(s: FrameSetId): FrameSetId {
  return ART_FROM[s] ?? s
}

/** Sets the owner uploads a picture for (all shown sets except those that borrow one, e.g. Gold). */
export function ownsArt(s: FrameSetId): boolean {
  return !ART_FROM[s]
}

/** The holo looks a set's cards can have: Gold and Full Art only full holo. */
export function holoLooksOf(s: FrameSetId): HoloType[] {
  return HOLO_ONLY_SETS.includes(s) ? ['full'] : ['none', 'frame', 'picture', 'full']
}

/** The pictures a set takes: one normal picture (holo is drawn, holoFx.ts); none for a set that borrows its picture. */
export function variantsOf(s: FrameSetId): Variant[] {
  return ownsArt(s) ? ['normal'] : []
}

const EXTRA_LABEL: Record<string, string> = { gold: 'Gold', fullart: 'Full Art' }

/** The name shown for a frame set: Paper, Wood, Fire, Coal, Diamond, Gold, Full Art, or the id capitalised. */
export function frameSetLabel(s: FrameSetId): string {
  return (MATERIAL_LABEL as Record<string, string>)[s] ?? EXTRA_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1)
}

/** Frame sets whose art fills the whole card behind a slim rim (the frame's name bar and bottom panel stay where every
 *  other frame has them). Full Art is the first. */
export const FULL_CARD_ART_SETS: readonly FrameSetId[] = ['fullart']

/** Where a frame set's art goes: the square art window, or the whole card for a full-card-art set. */
export function artBoxOf(s: FrameSetId): Rect {
  return FULL_CARD_ART_SETS.includes(s) ? { x: 0, y: 0, w: 1500, h: 2100 } : { ...FRAME_GEOMETRY.art }
}

/** Kept for older code paths: the clean frames of the Standard sets. */
export const BUILTIN_FRAMES: Record<string, Partial<Record<Variant, string>>> = Object.fromEntries(
  FRAME_SETS.map((s) => [s, { normal: FRAME_FILES[s]?.normal }]),
)

/** Bump (to a time in the past, e.g. when the change is made) when a frame file is added or changed: approvals made
 *  before this go stale and must be redone. */
export const FRAMES_UPDATED_AT = Date.UTC(2026, 9, 21, 0, 0) // holo drawn over the clean frames

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

/** The file for this frame. */
export function frameUrl(s: FrameSetId, v: Variant): string | undefined {
  return FRAME_FILES[s]?.[v]
}

export function hasFrame(s: FrameSetId, v: Variant): boolean {
  return !!frameUrl(s, v)
}

export function frameId(s: FrameSetId, v: Variant): string {
  return `${s}:${v}`
}

/** The frame a holo look uses: always the clean one (holo is drawn over it). */
export function frameVariantOf(_h: HoloType): Variant {
  return 'normal'
}

/** Frames missing from a set for the given holo looks, as readable labels, e.g. "Gold holo". A frameless set
 *  (Full Art) never misses one. */
export function missingFramesFor(s: FrameSetId, holos: readonly HoloType[]): string[] {
  if (FRAMELESS_SETS.includes(s)) return []
  const out: string[] = []
  for (const v of VARIANTS) {
    if (holos.some((h) => frameVariantOf(h) === v) && !hasFrame(s, v)) out.push(`${frameSetLabel(s)} ${v}`)
  }
  return out
}

/** How complete a frame set is: its one frame present or not (Full Art: none needed). */
export function frameSetFiles(s: FrameSetId): { have: number; total: number } {
  if (FRAMELESS_SETS.includes(s)) return { have: 0, total: 0 }
  return { have: hasFrame(s, 'normal') ? 1 : 0, total: 1 }
}

/** The wear layer for a wear level, or undefined for PDA 10 / ungraded (no wear). */
export function wearUrl(w: WearLevel | 'clean'): string | undefined {
  return w === 'clean' ? undefined : WEAR_FILES[w]
}

const cache = new Map<string, Promise<Blob>>()

/** The frame file as a Blob (fetched once per session), or undefined if that frame doesn't exist. */
export function frameBlob(s: FrameSetId, v: Variant): Promise<Blob> | undefined {
  return fetchOnce(frameUrl(s, v), `Frame ${s} ${v}`)
}

/** The wear layer as a Blob (fetched once per session), or undefined for no wear. */
export function wearBlob(w: WearLevel | 'clean'): Promise<Blob> | undefined {
  return fetchOnce(wearUrl(w), `Wear ${w}`)
}

function fetchOnce(url: string | undefined, what: string): Promise<Blob> | undefined {
  if (!url) return undefined
  let p = cache.get(url)
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${what} failed to load (${r.status})`)
      return r.blob()
    })
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p
}
