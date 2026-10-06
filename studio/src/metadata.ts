/** ERC-721 style metadata, one JSON per card, as CardsRenderer.tokenURI writes it on-chain for a freshly dealt card.
 *  The image is shared by every card of the same look (looks.ts); what makes each card unique (serial, edition,
 *  Series #) is here. The Material trait is the card type's name. An ungraded card also shows Cased, Uncased Age (days)
 *  and Moves; a slabbed one only its grade (docs/grading.md). */

import type { DealtCard } from './deal'
import { cardTitle } from './render'
import { HOLO_LABEL } from './rules'

export interface Erc721Metadata {
  name: string
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
  const psa = card.grade == null ? 'Ungraded' : `PDA ${card.grade}`
  const wear = card.grade == null
    ? [
      { trait_type: 'Cased', value: card.cased ? 'Yes' : 'No' },
      { trait_type: 'Uncased Age (days)', value: 0, display_type: 'number' as const },
      { trait_type: 'Moves', value: 0, display_type: 'number' as const },
    ]
    : []
  return {
    name: cardTitle(typeName, name, card.serial),
    image,
    attributes: [
      { trait_type: 'Character', value: name },
      { trait_type: 'Category', value: character.category ?? '' }, // CardsRenderer always writes it
      { trait_type: 'Material', value: material },
      { trait_type: 'Holo', value: holo },
      { trait_type: 'Series', value: card.fire, display_type: 'number' as const },
      { trait_type: 'Edition', value: edition },
      { trait_type: 'Serial', value: card.serial, display_type: 'number' as const },
      { trait_type: 'PDA', value: psa },
      ...wear,
    ],
  }
}
