/** Shared images (decided Oct 3): every card with the same character, material, holo frame, holo picture and wear
 *  look shares one image. Only those are printed on the card; serial, edition and Fire # are per card and go in the
 *  metadata. So a Fire builds a few dozen images, not one per card, and the same image is reused every Fire. */

import type { DealtCard } from './deal'
import { MATERIAL_LABEL, holoTypeOf, wearLookOf, type HoloType, type Material, type WearLook } from './rules'
import type { Character, OutputFormat } from './types'

export interface Look {
  characterId: string
  material: Material
  holoFrame: boolean
  holoPicture: boolean
  wear: WearLook
}

export function lookOf(card: DealtCard): Look {
  return { characterId: card.characterId, material: card.material, holoFrame: card.holoFrame, holoPicture: card.holoPicture, wear: wearLookOf(card.grade) }
}

export function lookKey(l: Look): string {
  return `${l.characterId}:${l.material}:${l.holoFrame ? 1 : 0}${l.holoPicture ? 1 : 0}:${l.wear}`
}

export function holoOfLook(l: Look): HoloType {
  return holoTypeOf(l.holoFrame, l.holoPicture)
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character'
}

/** Readable and unique: "rabbit-1a2b3c-wood-frame-clean.webp". The id part keeps two characters with the same name
 *  apart. */
export function lookFileName(l: Look, c: Pick<Character, 'id' | 'name'>, format: OutputFormat): string {
  return `${slug(c.name)}-${c.id.slice(0, 6).toLowerCase()}-${slug(MATERIAL_LABEL[l.material])}-${holoOfLook(l)}-${l.wear.toLowerCase()}.${format}`
}

/** The distinct looks among `cards`, each with one representative card to render it from (first by serial). */
export function distinctLooks(cards: DealtCard[]): { key: string; look: Look; card: DealtCard }[] {
  const seen = new Map<string, { key: string; look: Look; card: DealtCard }>()
  for (const card of cards) {
    const look = lookOf(card)
    const key = lookKey(look)
    if (!seen.has(key)) seen.set(key, { key, look, card })
  }
  return [...seen.values()]
}
