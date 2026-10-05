/** Shared images: every card with the same character, card type, holo frame, holo picture and PDA grade shares one
 *  image. Only those are printed on the card; serial, edition and Series # are per card and go in the metadata.
 *
 *  A Series' image folder holds the FULL grid of what its recipe can deal, not just the looks its sample deal happens
 *  to produce: grades are revealed on-chain later, and FireCards.imageFile points every card at
 *  c<character>-<type slug>-<holo>-<grade>.webp in that folder, so every combination must exist up front:
 *  characters x types x the holo looks the type can have (recipe.ts holoLooksFor) x 11 grade states (ungraded,
 *  PDA 1..10). The Standard recipe gives 19 looks (4 types x 4 holo + Diamond x 3) x 11 = 209 images per character.
 *  (Every Series has its own "Forged · Series " line, so images are never shared across Series.) */

import type { DealtCard } from './deal'
import { holoLooksFor, type Recipe } from './recipe'
import { holoTypeOf, type HoloType } from './rules'

export interface Look {
  characterId: string
  /** Index into the Series' recipe types. */
  type: number
  /** The type's slug (image file names). */
  slug: string
  holoFrame: boolean
  holoPicture: boolean
  /** PDA grade 1..10, or null while ungraded. One image per grade: the seal prints the number. */
  grade: number | null
  /** The Series: printed on the card ("Forged · Series 7"), so each Series has its own images. */
  fire: number
}

/** The 11 grade states, in build order: ungraded first, then PDA 1..10. */
export const GRADE_STATES: readonly (number | null)[] = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** Looks per character: the sum over the recipe's types of the holo looks each can have. */
export function looksPerCharacter(r: Recipe): number {
  return r.types.reduce((n, _, i) => n + holoLooksFor(r, i).length, 0)
}

export function imagesPerCharacter(r: Recipe): number {
  return looksPerCharacter(r) * GRADE_STATES.length
}

/** Images a Series with `characters` characters must build and upload. */
export function gridSize(characters: number, r: Recipe): number {
  return characters * imagesPerCharacter(r)
}

export function lookOf(card: DealtCard, r: Recipe): Look {
  return {
    characterId: card.characterId, type: card.type, slug: r.types[card.type]?.slug ?? `type${card.type}`,
    holoFrame: card.holoFrame, holoPicture: card.holoPicture, grade: card.grade ?? null, fire: card.fire,
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

/** Where a built image is stored and how looks are told apart: keyed by type slug and grade. */
export function lookKey(l: Look): string {
  return `${l.fire}:${l.characterId}:${l.slug}:${holoOfLook(l)}:${gradeId(l.grade)}`
}

/** The image's name inside its Series' image folder: "c<characterIndex>-<slug>-<holo>-<grade>.webp", e.g.
 *  "c0-wood-frame-u.webp" or "c2-coal-full-10.webp". <characterIndex> is the character's position in the Series' list
 *  (the order of setCharacters), <slug> the type's slug, <holo> none | frame | picture | full, <grade> 'u' or 1..10.
 *  Always WEBP. FireCards.imageName builds exactly this name. */
export function lookFileName(l: Pick<Look, 'slug' | 'holoFrame' | 'holoPicture' | 'grade'>, characterIndex: number): string {
  if (!Number.isInteger(characterIndex) || characterIndex < 0) throw new Error(`Bad character index ${characterIndex}`)
  return `c${characterIndex}-${l.slug}-${holoOfLook(l)}-${gradeId(l.grade)}.webp`
}

export interface GridEntry {
  key: string
  look: Look
  /** A stand-in card to render the look from (serial 0: nothing per-card is printed on the image). */
  card: DealtCard
  characterIndex: number
  file: string
}

/** Every image a Series needs, in build order: character, type, holo, grade (so consecutive renders reuse the same art
 *  and frames). gridSize(characterIds.length, r) entries. */
export function seriesGrid(fire: number, characterIds: readonly string[], r: Recipe): GridEntry[] {
  const out: GridEntry[] = []
  const holos = r.types.map((_, t) => holoLooksFor(r, t))
  characterIds.forEach((characterId, characterIndex) => {
    r.types.forEach((ty, type) => {
      for (const holo of holos[type]) {
        const holoFrame = holo === 'frame' || holo === 'full'
        const holoPicture = holo === 'picture' || holo === 'full'
        for (const grade of GRADE_STATES) {
          const look: Look = { characterId, type, slug: ty.slug, holoFrame, holoPicture, grade, fire }
          const card: DealtCard = {
            serial: 0, fire, pack: 0, slot: 0, group: 0, type, characterId, holoFrame, holoPicture, holo, edition: 1, editionOf: 1, grade,
          }
          out.push({ key: lookKey(look), look, card, characterIndex, file: lookFileName(look, characterIndex) })
        }
      }
    })
  })
  return out
}

/** The distinct looks among `cards`, each with one representative card (first by serial). */
export function distinctLooks(cards: DealtCard[], r: Recipe): { key: string; look: Look; card: DealtCard }[] {
  const seen = new Map<string, { key: string; look: Look; card: DealtCard }>()
  for (const card of cards) {
    const look = lookOf(card, r)
    const key = lookKey(look)
    if (!seen.has(key)) seen.set(key, { key, look, card })
  }
  return [...seen.values()]
}
