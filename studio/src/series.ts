/** What a Series needs from the library and the frames, given its recipe: which frame sets and art variants its card
 *  types use, which frames are missing, and which characters are ready for it. */

import { hasCategory, hasValidName } from './categories'
import { frameSetLabel, missingFramesFor } from './frames'
import { sha256Hex } from './prng'
import { holoLooksFor, recipeGridKey, type Recipe } from './recipe'
import type { Character, Variant } from './types'

/** Art variants each frame set needs: normal art for plain and frame-holo looks, holo art for picture and full
 *  holo looks. */
export function artNeeds(r: Recipe): Map<string, Set<Variant>> {
  const out = new Map<string, Set<Variant>>()
  r.types.forEach((t, i) => {
    const looks = holoLooksFor(r, i)
    const set = out.get(t.frameSet) ?? new Set<Variant>()
    if (looks.some((h) => h === 'none' || h === 'frame')) set.add('normal')
    if (looks.some((h) => h === 'picture' || h === 'full')) set.add('holo')
    out.set(t.frameSet, set)
  })
  return out
}

/** The frame sets a recipe uses, in type order, once each. */
export function frameSetsOf(r: Recipe): string[] {
  return [...new Set(r.types.map((t) => t.frameSet))]
}

/** Art this character is missing for the recipe, e.g. ["Fire holo", "Gold normal"]. */
export function missingArt(c: Character, needs: Map<string, Set<Variant>>): string[] {
  const out: string[] = []
  for (const [set, vs] of needs) for (const v of vs) if (!c.images[set]?.[v]) out.push(`${frameSetLabel(set)} ${v}`)
  return out
}

/** Can go into a Series with this recipe: the art its types use, a usable name and a usable category. */
export function isReadyFor(c: Character, needs: Map<string, Set<Variant>>): boolean {
  return hasValidName(c) && hasCategory(c) && missingArt(c, needs).length === 0
}

/** Frames the recipe's image grid needs that aren't built in, per type: [{ type, missing }]. */
export function missingFrames(r: Recipe): { type: string; missing: string[] }[] {
  return r.types
    .map((t, i) => ({ type: t.name || `Type ${i + 1}`, missing: missingFramesFor(t.frameSet, holoLooksFor(r, i)) }))
    .filter((x) => x.missing.length > 0)
}

/** Identifies what a Series' image grid contains (types, slugs, names, frame sets, holo looks, characters in order):
 *  a build made for another grid is stale. */
export function buildGridKey(r: Recipe, characterIds: readonly string[]): string {
  return sha256Hex(`${recipeGridKey(r)}|${characterIds.join(',')}`).slice(0, 16)
}

/** Average size and render time per image from earlier builds (any Series), for the estimate before a build. */
export function buildRates(fires: { build?: { count: number; bytes?: number; ms?: number } }[]): { bytes: number; ms: number; measured: boolean } {
  let n = 0
  let bytes = 0
  let ms = 0
  for (const f of fires) {
    const b = f.build
    if (b && b.count > 0 && b.bytes != null && b.ms != null) { n += b.count; bytes += b.bytes; ms += b.ms }
  }
  return n ? { bytes: bytes / n, ms: ms / n, measured: true } : { bytes: 450 * 1024, ms: 150, measured: false }
}
