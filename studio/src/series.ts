/** What a Series needs from the library and the frames, given its recipe: which frame sets and art variants its card
 *  types use, which frames are missing, and which characters are ready for it. */

import { hasCategory, hasValidName } from './categories'
import { artSetOf, frameSetLabel, missingFramesFor } from './frames'
import { sha256Hex } from './prng'
import { holoLooksFor, parsePercent, percentTotal, percentTotalProblem, percentsToWeights, recipeGridKey, simplifyWeights, weightsToPercents, type Recipe } from './recipe'
import type { Character, Variant } from './types'

/** The pictures a recipe needs, by the set they're uploaded under: one normal picture per set its types use (Gold's
 *  is the Wood one). Every holo look is drawn over that picture (holoFx.ts), so no holo pictures. */
export function artNeeds(r: Recipe): Map<string, Set<Variant>> {
  const out = new Map<string, Set<Variant>>()
  for (const t of r.types) out.set(artSetOf(t.frameSet), new Set<Variant>(['normal']))
  return out
}

/** The frame sets a recipe uses, in type order, once each. */
export function frameSetsOf(r: Recipe): string[] {
  return [...new Set(r.types.map((t) => t.frameSet))]
}

/** Pictures this character is missing for the recipe, e.g. ["Fire", "Wood"]. */
export function missingArt(c: Character, needs: Map<string, Set<Variant>>): string[] {
  const out: string[] = []
  for (const [set, vs] of needs) for (const v of vs) if (!c.images[set]?.[v]) out.push(frameSetLabel(set))
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

type CharacterOddsFields = { characterIds: readonly string[]; characterPercents?: Record<string, string>; characterWeights?: Record<string, number> }

/** Whether every character is equally likely (the "All equal" switch: no percentages set). */
export const charactersAllEqual = (f: CharacterOddsFields) => !f.characterPercents && !f.characterWeights

/** Each character's % of cards in character order, as the owner sets them; undefined when they're all equal. A locked
 *  old save's exact weights are shown as percentages (2 decimals, adding up to 100%). */
export function characterPercentsOf(f: CharacterOddsFields): string[] | undefined {
  if (f.characterWeights) return weightsToPercents(f.characterIds.map((id) => Math.max(1, Math.floor(f.characterWeights?.[id] ?? 1))))
  if (!f.characterPercents) return undefined
  return f.characterIds.map((id) => f.characterPercents?.[id] ?? '0')
}

/** The Series' character weights in character order (what the contract and the deal get), or undefined when every
 *  character has the same odds (the default: no weights are sent on chain). From the percentages: percent x 10,000,
 *  simplified (10 / 10 / 10 / 70% = 1 / 1 / 1 / 7). A locked old save keeps its exact weights (whole numbers, at
 *  least 1). */
export function characterWeightsOf(f: CharacterOddsFields): number[] | undefined {
  const w = f.characterWeights
    ? f.characterIds.map((id) => Math.max(1, Math.floor(f.characterWeights?.[id] ?? 1)))
    : f.characterPercents ? simplifyWeights(percentsToWeights(characterPercentsOf(f)!)).map(Number) : undefined
  return w && w.some((x) => x !== w[0]) ? w : undefined
}

/** What's wrong with the characters' percentages (none while "All equal" is on): each must be above 0 with at most 2
 *  decimals, and together exactly 100%. `nameOf` names a character by its index. */
export function characterOddsProblems(f: CharacterOddsFields, nameOf: (k: number) => string = (k) => `c${k}`): string[] {
  if (f.characterWeights || !f.characterPercents || !f.characterIds.length) return []
  const p = characterPercentsOf(f)!
  const out: string[] = []
  p.forEach((x, k) => {
    const v = parsePercent(x)
    if (v == null) out.push(`${nameOf(k)}: % of cards must be a number from 0 to 100, with at most 2 decimals.`)
    else if (v === 0) out.push(`${nameOf(k)} has 0% of cards: give every character more than 0%, or turn "All equal" back on.`)
  })
  const total = percentTotalProblem(percentTotal(p), 'The characters')
  if (total) out.push(total)
  return out
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
