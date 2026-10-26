/** Shared images: every card with the same character, card type, holo frame, holo picture and PDA grade shares one
 *  image. Only those are printed on the card; serial, print number and Series # are per card and go in the metadata.
 *
 *  A Series' image folder holds the FULL grid of what its recipe can deal, not just the looks its sample deal happens
 *  to produce: grades are revealed on-chain later, and FireCards.imageFile points every card at
 *  c<character>-<type slug>-<holo>-<grade>.webp in that folder, so every combination must exist up front:
 *  characters x types x the holo looks the type can have (recipe.ts holoLooksFor) x 12 states: ungraded, cased (a clear
 *  case over the card) and PDA 1..10 (slabbed: the card in a slab with its grade label). The Standard recipe gives 18
 *  looks (4 types x 4 holo + Gold full + Full Art full) x 12 = 216 images per character.
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
  /** PDA grade 1..10 (slabbed), or null while ungraded. One image per grade: the seal prints the number. */
  grade: number | null
  /** Ungraded and in a case (docs/grading.md). Ignored once graded: a slab replaces the case. */
  cased?: boolean
  /** The Series: printed on the card ("Forged · Series 7"), so each Series has its own images. */
  fire: number
}

/** The 12 states, in build order: ungraded, cased, then PDA 1..10 (slabbed). */
export const STATES: readonly { grade: number | null; cased: boolean }[] = [
  { grade: null, cased: false }, { grade: null, cased: true },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((grade) => ({ grade, cased: false })),
]
/** Kept for callers that only need the grades: ungraded first, then PDA 1..10. */
export const GRADE_STATES: readonly (number | null)[] = [null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/** Looks per character: the sum over the recipe's types of the holo looks each can have. */
export function looksPerCharacter(r: Recipe): number {
  return r.types.reduce((n, _, i) => n + holoLooksFor(r, i).length, 0)
}

export function imagesPerCharacter(r: Recipe): number {
  return looksPerCharacter(r) * STATES.length
}

/** Images a Series with `characters` characters must build and upload. */
export function gridSize(characters: number, r: Recipe): number {
  return characters * imagesPerCharacter(r)
}

export function lookOf(card: DealtCard, r: Recipe): Look {
  return {
    characterId: card.characterId, type: card.type, slug: r.types[card.type]?.slug ?? `type${card.type}`,
    holoFrame: card.holoFrame, holoPicture: card.holoPicture, grade: card.grade ?? null, cased: !!card.cased && card.grade == null,
    fire: card.fire,
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

/** The state in a file name: 'u' (ungraded), 'c' (cased) or the grade 1..10 (slabbed). */
export function stateId(grade: number | null | undefined, cased?: boolean): string {
  if (grade == null) return cased ? 'c' : 'u'
  return gradeId(grade)
}

/** Where a built image is stored and how looks are told apart: keyed by type slug and state. */
export function lookKey(l: Look): string {
  return `${l.fire}:${l.characterId}:${l.slug}:${holoOfLook(l)}:${stateId(l.grade, l.cased)}`
}

/** The image's name inside its Series' image folder: "c<characterIndex>-<slug>-<holo>-<state>.webp", e.g.
 *  "c0-wood-frame-u.webp", "c0-wood-frame-c.webp" or "c2-coal-full-10.webp". <characterIndex> is the character's
 *  position in the Series' list (the order of setCharacters), <slug> the type's slug, <holo> none | frame | picture |
 *  full, <state> 'u', 'c' or 1..10. Always WEBP. CardsRenderer.imageName builds exactly this name. */
export function lookFileName(l: Pick<Look, 'slug' | 'holoFrame' | 'holoPicture' | 'grade' | 'cased'>, characterIndex: number): string {
  if (!Number.isInteger(characterIndex) || characterIndex < 0) throw new Error(`Bad character index ${characterIndex}`)
  return `c${characterIndex}-${l.slug}-${holoOfLook(l)}-${stateId(l.grade, l.cased)}.webp`
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
        for (const { grade, cased } of STATES) {
          const look: Look = { characterId, type, slug: ty.slug, holoFrame, holoPicture, grade, cased, fire }
          const card: DealtCard = {
            serial: 0, fire, pack: 0, slot: 0, type, characterId, holoFrame, holoPicture, holo, printNumber: 1, grade, cased,
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

/** One tilt layer (render.ts drawTiltPart): what the site (web/art/factory/forge/holo.js) redraws a moving holo from,
 *  plain -> live holo -> print. Per character and type: one plain layer and one print layer per state. */
export interface TiltEntry {
  characterId: string
  characterIndex: number
  type: number
  slug: string
  part: 'plain' | 'print'
  /** The state the print is of (STATES); the plain layer is the same for every state (ungraded here). */
  grade: number | null
  cased: boolean
  /** A stand-in card to render from (serial 0). Its holo is the type's first holo look: neither layer draws holo. */
  card: DealtCard
  file: string
}

/** "c<i>-<slug>-plain.webp", or "c<i>-<slug>-print-<state>.webp" with the state as in lookFileName ('u', 'c', 1..10). */
export function tiltFileName(slug: string, characterIndex: number, part: 'plain' | 'print', grade: number | null = null, cased = false): string {
  if (!Number.isInteger(characterIndex) || characterIndex < 0) throw new Error(`Bad character index ${characterIndex}`)
  return part === 'plain' ? `c${characterIndex}-${slug}-plain.webp` : `c${characterIndex}-${slug}-print-${stateId(grade, cased)}.webp`
}

/** Tilt layers per character: every type of the recipe x (1 plain + 12 prints). */
export function tiltPartsPerCharacter(r: Recipe): number {
  return r.types.length * (1 + STATES.length)
}

/** Every tilt layer a Series needs, in order: character, type, then plain and the 12 prints. */
export function tiltParts(fire: number, characterIds: readonly string[], r: Recipe): TiltEntry[] {
  const out: TiltEntry[] = []
  characterIds.forEach((characterId, characterIndex) => {
    r.types.forEach((ty, type) => {
      const holo = holoLooksFor(r, type)[0] ?? 'none'
      const holoFrame = holo === 'frame' || holo === 'full'
      const holoPicture = holo === 'picture' || holo === 'full'
      const make = (part: 'plain' | 'print', grade: number | null, cased: boolean): TiltEntry => ({
        characterId, characterIndex, type, slug: ty.slug, part, grade, cased,
        card: { serial: 0, fire, pack: 0, slot: 0, type, characterId, holoFrame, holoPicture, holo, printNumber: 1, grade, cased },
        file: tiltFileName(ty.slug, characterIndex, part, grade, cased),
      })
      out.push(make('plain', null, false))
      for (const { grade, cased } of STATES) out.push(make('print', grade, cased))
    })
  })
  return out
}
