/** Locked numbers from docs/card-studio.md. Everything that encodes a game rule lives here so it can't drift. */

export const MATERIALS = ['paper', 'wood', 'burning', 'charcoal', 'diamond'] as const
export type Material = (typeof MATERIALS)[number]

export const MATERIAL_LABEL: Record<Material, string> = {
  paper: 'Paper',
  wood: 'Wood',
  burning: 'Burning',
  charcoal: 'Charcoal',
  diamond: 'Diamond',
}

/** Rarity accumulators work in integer units of 1/RATE_SCALE of a card so carry-over is exact (no float drift).
 *  The five rates sum to exactly RATE_SCALE (50 + 30 + 15 + 4.9 + 0.1 = 100%). */
export const RATE_SCALE = 100_000
export const RARITY_UNITS: Record<Material, number> = {
  paper: 50_000, // 50%
  wood: 30_000, // 30%
  burning: 15_000, // 15%
  charcoal: 4_900, // 4.90% (approved Oct 1)
  diamond: 100, // 0.10%
}

/** Chance that a card of this material is holo at all (frame and/or picture). */
export const HOLO_RATE: Record<Material, number> = {
  paper: 0.05,
  wood: 0.1,
  burning: 0.5,
  charcoal: 0.9,
  diamond: 1.0,
}

/** Each of the two independent rolls (frame, picture) hits with p = 1 - sqrt(1 - rate), so P(either) = rate. */
export function holoRollChance(m: Material): number {
  return 1 - Math.sqrt(1 - HOLO_RATE[m])
}

export const HOLO_TYPES = ['none', 'frame', 'picture', 'full'] as const
export type HoloType = (typeof HOLO_TYPES)[number]
export const HOLO_LABEL: Record<HoloType, string> = { none: 'None', frame: 'Frame', picture: 'Picture', full: 'Full' }

export const CARDS_PER_PACK = 6
export const CARD_W = 1500
export const CARD_H = 2100

export function holoTypeOf(frame: boolean, picture: boolean): HoloType {
  return frame && picture ? 'full' : frame ? 'frame' : picture ? 'picture' : 'none'
}

/** What a character is. Sorting rule: take the first one that fits, in this order (decided Oct 3). */
export const CATEGORIES = ['person', 'animal', 'plant', 'place', 'object', 'element', 'idea'] as const
export type Category = (typeof CATEGORIES)[number]
export const CATEGORY_LABEL: Record<Category, string> = {
  person: 'Person', animal: 'Animal', plant: 'Plant', place: 'Place', object: 'Object', element: 'Element', idea: 'Idea',
}
export const CATEGORY_HINT: Record<Category, string> = {
  person: 'made-up humans and human-like characters (never a real person)',
  animal: 'any creature, real or mythical',
  plant: 'living things that grow',
  place: 'somewhere you can be',
  object: 'things that are made or held',
  element: 'forces of nature and raw materials',
  idea: 'abstract things',
}

/** PSA wear is designed into the frames: one worn frame per level (decided Oct 3). PSA 10 and PSA 1 are unique;
 *  the rest come in pairs. Before the grade is revealed the clean frame is used. */
export const WEAR_LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const
export type WearLevel = (typeof WEAR_LEVELS)[number]
/** 'clean' = grade not revealed yet. */
export type WearLook = WearLevel | 'clean'
export const WEAR_LABEL: Record<WearLook, string> = {
  clean: 'Unrevealed', L1: 'PSA 10', L2: 'PSA 9-8', L3: 'PSA 7-6', L4: 'PSA 5-4', L5: 'PSA 3-2', L6: 'PSA 1',
}

export function wearLookOf(grade: number | null | undefined): WearLook {
  if (grade == null) return 'clean'
  if (!Number.isInteger(grade) || grade < 1 || grade > 10) throw new Error(`Bad PSA grade ${grade}`)
  if (grade === 10) return 'L1'
  if (grade === 1) return 'L6'
  return (['L5', 'L5', 'L4', 'L4', 'L3', 'L3', 'L2', 'L2'] as const)[grade - 2]
}
