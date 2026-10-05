/** Locked numbers from docs/card-studio.md. Everything that encodes a game rule lives here so it can't drift. */

export const MATERIALS = ['paper', 'wood', 'burning', 'charcoal', 'diamond'] as const
export type Material = (typeof MATERIALS)[number]

export const MATERIAL_LABEL: Record<Material, string> = {
  paper: 'Paper',
  wood: 'Wood',
  burning: 'Fire', // shown as Fire everywhere (formerly Burning); the id stays 'burning' so saved data keeps working
  charcoal: 'Coal',
  diamond: 'Diamond',
}

/** Each Series stands alone: its pool is worked out from its own pack count, nothing carries over.
 *  Fire and Coal take their share of the Series' cards, in integer units of 1/SHARE_SCALE of a card:
 *  Fire 15%, Coal 4.9%. Paper is always half (3 per pack), Diamond is set per Series
 *  (at least 1), and Wood takes the rest. See computePool in deal.ts. */
export const SHARE_SCALE = 100_000
export const SHARE_UNITS = {
  burning: 15_000, // 15%
  charcoal: 4_900, // 4.90%
} as const

/** Most Diamonds that can be set for one Series (the contract's limit too). */
export const MAX_DIAMONDS = 1000

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

/** A card's holo from two uniform draws in [0, 1). Diamond (always holo) is split evenly between frame only, picture
 *  only and full (1/3 each), so a full-holo Diamond is the rarest Diamond. Every other material rolls
 *  frame and picture independently at holoRollChance. */
export function rollHolo(m: Material, u1: number, u2: number): { frame: boolean; picture: boolean } {
  if (HOLO_RATE[m] >= 1) {
    if (u1 < 1 / 3) return { frame: true, picture: false }
    if (u1 < 2 / 3) return { frame: false, picture: true }
    return { frame: true, picture: true }
  }
  const p = holoRollChance(m)
  return { frame: u1 < p, picture: u2 < p }
}

/** Expected holos among `count` cards of a material (holo is random per card, so these are averages, not promises):
 *  frame only, picture only, full (both). Diamond is always holo, a third each. */
export function expectedHolos(m: Material, count: number): { frame: number; picture: number; full: number; total: number } {
  if (HOLO_RATE[m] >= 1) return { frame: count / 3, picture: count / 3, full: count / 3, total: count }
  const p = holoRollChance(m)
  const one = count * p * (1 - p)
  return { frame: one, picture: one, full: count * p * p, total: count * HOLO_RATE[m] }
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

/** What a character is. Sorting rule: take the first one that fits, in this order. */
export const CATEGORIES = ['person', 'animal', 'plant', 'place', 'sports', 'object', 'element', 'idea'] as const
export type Category = (typeof CATEGORIES)[number]
export const CATEGORY_LABEL: Record<Category, string> = {
  person: 'Person', animal: 'Animal', plant: 'Plant', place: 'Place', sports: 'Sports', object: 'Object', element: 'Element', idea: 'Idea',
}
export const CATEGORY_HINT: Record<Category, string> = {
  person: 'made-up humans and human-like characters (never a real person)',
  animal: 'any creature, real or mythical',
  plant: 'living things that grow',
  place: 'somewhere you can be',
  sports: 'sports gear and games',
  object: 'things that are made or held',
  element: 'forces of nature and raw materials',
  idea: 'abstract things',
}

/** PDA wear is designed into the frames: one worn frame per level. PDA 10 and PDA 1 are unique;
 *  the rest come in pairs. Before the grade is revealed the clean frame is used. */
export const WEAR_LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const
export type WearLevel = (typeof WEAR_LEVELS)[number]
/** 'clean' = grade not revealed yet. */
export type WearLook = WearLevel | 'clean'
export const WEAR_LABEL: Record<WearLook, string> = {
  clean: 'Unrevealed', L1: 'PDA 10', L2: 'PDA 9-8', L3: 'PDA 7-6', L4: 'PDA 5-4', L5: 'PDA 3-2', L6: 'PDA 1',
}

/** The ring colour on a revealed PDA seal, by wear level: 10 green, 9-8 teal, 7-6 sky blue,
 *  5-4 blue, 3-2 orange, 1 red. */
export const GRADE_COLOR: Record<WearLevel, string> = {
  L1: '#2ecc71', L2: '#1abc9c', L3: '#3aa0ff', L4: '#3b5bdb', L5: '#f08c00', L6: '#e03131',
}

export function wearLookOf(grade: number | null | undefined): WearLook {
  if (grade == null) return 'clean'
  if (!Number.isInteger(grade) || grade < 1 || grade > 10) throw new Error(`Bad PDA grade ${grade}`)
  if (grade === 10) return 'L1'
  if (grade === 1) return 'L6'
  return (['L5', 'L5', 'L4', 'L4', 'L3', 'L3', 'L2', 'L2'] as const)[grade - 2]
}
