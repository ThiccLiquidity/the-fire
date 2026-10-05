/** ERC-721 style metadata, one JSON per card. The image is shared by every card of the same look (looks.ts); what
 *  makes each card unique (serial, edition, Series #) is here. The Material trait is the card type's name, like
 *  FireCards.tokenURI. */

import type { DealtCard } from './deal'
import { cardTitle } from './render'
import { HOLO_LABEL } from './rules'

export interface Erc721Metadata {
  name: string
  description: string
  image: string
  attributes: { trait_type: string; value: string | number; display_type?: 'number' }[]
}

/** One file per card, named by global serial (the expected token id): "<serial>.json". */
export function metadataFileName(card: Pick<DealtCard, 'serial'>): string {
  return `${card.serial}.json`
}

/** `image` is ipfs://<imagesCid>/<look file> once the images are uploaded; before that a relative path inside the zip
 *  (images/<look file>). */
export function cardMetadata(card: DealtCard, character: { name: string; category?: string }, typeName: string, image: string): Erc721Metadata {
  const name = character.name
  const material = typeName
  const holo = HOLO_LABEL[card.holo]
  const edition = `${card.edition} of ${card.editionOf}`
  const holoText = card.holo === 'none' ? '' : card.holo === 'full' ? ' Full holo.' : ` ${holo} holo.`
  const psa = card.grade == null ? 'Unrevealed' : `PDA ${card.grade}`
  return {
    name: cardTitle(typeName, name, card.serial),
    description: `${name}, ${material}. Edition ${edition} from Series ${card.fire}. Global serial #${card.serial}.${holoText} ${card.grade == null ? 'PDA grade unrevealed.' : `${psa}.`}`,
    image,
    attributes: [
      { trait_type: 'Character', value: name },
      ...(character.category ? [{ trait_type: 'Category', value: character.category }] : []),
      { trait_type: 'Material', value: material },
      { trait_type: 'Holo', value: holo },
      { trait_type: 'Series', value: card.fire, display_type: 'number' as const },
      { trait_type: 'Edition', value: edition },
      { trait_type: 'Serial', value: card.serial, display_type: 'number' as const },
      { trait_type: 'PDA', value: psa },
    ],
  }
}
