/** Shared images (decided Oct 3): every card with the same character, material, holo frame, holo picture and wear
 *  look shares one image. Only those are printed on the card; serial, edition and Series # are per card and go in the
 *  metadata. So a Series builds a few dozen images, not one per card. (Every Series has new characters and its own
 *  "Forged · Series " line, so images are never shared across Series.) */

import type { DealtCard } from './deal'
import { MATERIAL_LABEL, holoTypeOf, wearLookOf, type HoloType, type Material, type WearLook } from './rules'
import type { OutputFormat } from './types'

export interface Look {
  characterId: string
  material: Material
  holoFrame: boolean
  holoPicture: boolean
  wear: WearLook
  /** The Series: printed on the card ("Forged · Series 7"), so each Series has its own images. */
  fire: number
}

export function lookOf(card: DealtCard): Look {
  return { characterId: card.characterId, material: card.material, holoFrame: card.holoFrame, holoPicture: card.holoPicture, wear: wearLookOf(card.grade), fire: card.fire }
}

export function lookKey(l: Look): string {
  return `${l.fire}:${l.characterId}:${l.material}:${l.holoFrame ? 1 : 0}${l.holoPicture ? 1 : 0}:${l.wear}`
}

export function holoOfLook(l: Look): HoloType {
  return holoTypeOf(l.holoFrame, l.holoPicture)
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character'
}

/** The image's name inside its Series' image folder: "c<character>-<material>-<holo>-<wear>.<ext>", e.g.
 *  "c0-wood-frame-clean.webp", where <character> is the character's position in the Series' list. The card contract
 *  (contracts/src/cards/FireCards.sol, imageFile) builds exactly this name, so on-chain metadata finds the image. */
export function lookFileName(l: Look, characterIndex: number, format: OutputFormat): string {
  return `c${characterIndex}-${slug(MATERIAL_LABEL[l.material])}-${holoOfLook(l)}-${l.wear.toLowerCase()}.${format}`
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
