/** Shared images: every card with the same character, material, holo frame, holo picture and PDA grade shares one
 *  image. Only those are printed on the card; serial, edition and Series # are per card and go in the metadata.
 *
 *  A Series' image folder holds the FULL grid, not just the looks its sample deal happens to produce: grades are
 *  revealed on-chain later, and the contract (FireCards.imageFile) points every card at
 *  c<character>-<material>-<holo>-<grade>.webp in that folder, so every combination must exist up front:
 *  per character, 4 materials x 4 holo types + Diamond x 3 holo types (Diamond is always holo) = 19 looks, each in
 *  11 grade states (ungraded, PDA 1..10) = 209 images. (Every Series has new characters and its own
 *  "Forged · Series " line, so images are never shared across Series.) */

import type { DealtCard } from './deal'
import { HOLO_TYPES, MATERIALS, holoTypeOf, type HoloType, type Material } from './rules'

export interface Look {
  characterId: string
  material: Material
  holoFrame: boolean
  holoPicture: boolean
  /** PDA grade 1..10, or null while ungraded. One image per grade: the seal prints the number. */
  grade: number | null
  /** The Series: printed on the card ("Forged · Series 7"), so each Series has its own images. */
  fire: number
}

/** The material's id in image file names. Fixed: it never follows the display label (MATERIAL_LABEL), and it matches
 *  the contract's FireCards.imageFile. */
export const MATERIAL_FILE_ID: Record<Material, string> = {
  paper: 'paper',
  wood: 'wood',
  burning: 'fire',
  charcoal: 'coal',
  diamond: 'diamond',
}

/** The 11 grade states, in build order: ungraded first, then PDA 1..10. */
export const GRADE_STATES: readonly (number | null)[] = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** The holo types a material can have: Diamond is always holo, so it has no 'none'. */
export function holosFor(m: Material): readonly HoloType[] {
  return m === 'diamond' ? HOLO_TYPES.filter((h) => h !== 'none') : HOLO_TYPES
}

/** Looks per character (material x holo): 4 x 4 + 3 = 19. */
export const LOOKS_PER_CHARACTER = MATERIALS.reduce((n, m) => n + holosFor(m).length, 0)
/** Images per character in a Series' folder: 19 looks x 11 grade states = 209. */
export const IMAGES_PER_CHARACTER = LOOKS_PER_CHARACTER * GRADE_STATES.length

/** Images a Series with `characters` characters must build and upload. */
export function gridSize(characters: number): number {
  return characters * IMAGES_PER_CHARACTER
}

export function lookOf(card: DealtCard): Look {
  return {
    characterId: card.characterId, material: card.material, holoFrame: card.holoFrame, holoPicture: card.holoPicture,
    grade: card.grade ?? null, fire: card.fire,
  }
}

export function holoOfLook(l: Pick<Look, 'holoFrame' | 'holoPicture'>): HoloType {
  return holoTypeOf(l.holoFrame, l.holoPicture)
}

/** 'u' when ungraded, else the grade 1..10. */
export function gradeId(grade: number | null | undefined): string {
  if (grade == null) return 'u'
  if (!Number.isInteger(grade) || grade < 1 || grade > 10) throw new Error(`Bad PDA grade ${grade}`)
  return String(grade)
}

/** Where a built image is stored and how looks are told apart: keyed by grade (not by wear level, since two grades
 *  that share a wear frame still print different seal numbers). */
export function lookKey(l: Look): string {
  return `${l.fire}:${l.characterId}:${l.material}:${holoOfLook(l)}:${gradeId(l.grade)}`
}

/** The image's name inside its Series' image folder: "c<characterIndex>-<mat>-<holo>-<grade>.webp", e.g.
 *  "c0-wood-frame-u.webp" or "c2-coal-full-10.webp". <characterIndex> is the character's position in the Series' list
 *  (the order passed to configureFire), <mat> is MATERIAL_FILE_ID, <holo> none | frame | picture | full, <grade> 'u'
 *  or 1..10. Always WEBP. FireCards.imageFile builds exactly this name, so on-chain metadata finds the image. */
export function lookFileName(l: Look, characterIndex: number): string {
  if (!Number.isInteger(characterIndex) || characterIndex < 0) throw new Error(`Bad character index ${characterIndex}`)
  const holo = holoOfLook(l)
  if (l.material === 'diamond' && holo === 'none') throw new Error('Diamond is always holo: there is no diamond-none image')
  return `c${characterIndex}-${MATERIAL_FILE_ID[l.material]}-${holo}-${gradeId(l.grade)}.webp`
}

export interface GridEntry {
  key: string
  look: Look
  /** A stand-in card to render the look from (serial 0: nothing per-card is printed on the image). */
  card: DealtCard
  characterIndex: number
  file: string
}

/** Every image a Series needs, in build order: character, material, holo, grade (so consecutive renders reuse the
 *  same art and frames). gridSize(characterIds.length) entries. */
export function seriesGrid(fire: number, characterIds: readonly string[]): GridEntry[] {
  const out: GridEntry[] = []
  characterIds.forEach((characterId, characterIndex) => {
    for (const material of MATERIALS) {
      for (const holo of holosFor(material)) {
        const holoFrame = holo === 'frame' || holo === 'full'
        const holoPicture = holo === 'picture' || holo === 'full'
        for (const grade of GRADE_STATES) {
          const look: Look = { characterId, material, holoFrame, holoPicture, grade, fire }
          const card: DealtCard = {
            serial: 0, fire, pack: 0, slot: 0, material, characterId, holoFrame, holoPicture, holo,
            edition: 1, editionOf: 1, grade,
          }
          out.push({ key: lookKey(look), look, card, characterIndex, file: lookFileName(look, characterIndex) })
        }
      }
    }
  })
  return out
}

/** The distinct looks among `cards`, each with one representative card (first by serial). */
export function distinctLooks(cards: DealtCard[]): { key: string; look: Look; card: DealtCard }[] {
  const seen = new Map<string, { key: string; look: Look; card: DealtCard }>()
  for (const card of cards) {
    const look = lookOf(card)
    const key = lookKey(look)
    if (!seen.has(key)) seen.set(key, { key, look, card })
  }
  return [...seen.values()]
}
