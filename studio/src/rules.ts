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
