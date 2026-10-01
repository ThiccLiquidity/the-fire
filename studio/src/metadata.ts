/** ERC-721 style metadata, one JSON per card. */

import type { DealtCard } from './deal'
import { cardTitle } from './render'
import { HOLO_LABEL, MATERIAL_LABEL } from './rules'
import type { OutputFormat } from './types'

export interface Erc721Metadata {
  name: string
  description: string
  image: string
  attributes: { trait_type: string; value: string | number; display_type?: 'number' }[]
}

export function imageFileName(card: Pick<DealtCard, 'serial'>, format: OutputFormat): string {
  return `${card.serial}.${format}`
}

/** One file per card, named by global serial (the expected token id): "<serial>.json". */
export function metadataFileName(card: Pick<DealtCard, 'serial'>): string {
  return `${card.serial}.json`
}

/** `image` is ipfs://<imagesCid>/<serial>.<ext> once the images are uploaded; before that a relative path inside
 *  the zip (images/<serial>.<ext>). */
export function cardMetadata(card: DealtCard, characterName: string, image: string): Erc721Metadata {
  const material = MATERIAL_LABEL[card.material]
  const holo = HOLO_LABEL[card.holo]
  const edition = `${card.edition} of ${card.editionOf}`
  const holoText = card.holo === 'none' ? '' : card.holo === 'full' ? ' Full holo.' : ` ${holo} holo.`
  return {
    name: cardTitle(card, characterName),
    description: `${characterName}, ${material}. Edition ${edition} from Fire #${card.fire}. Global serial #${card.serial}.${holoText} PSA grade unrevealed.`,
    image,
    attributes: [
      { trait_type: 'Character', value: characterName },
      { trait_type: 'Material', value: material },
      { trait_type: 'Holo', value: holo },
      { trait_type: 'Fire', value: card.fire, display_type: 'number' },
      { trait_type: 'Edition', value: edition },
      { trait_type: 'Serial', value: card.serial, display_type: 'number' },
      { trait_type: 'PSA', value: 'Unrevealed' },
    ],
  }
}
