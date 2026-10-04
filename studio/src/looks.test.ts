import { describe, expect, it } from 'vitest'
import type { DealtCard } from './deal'
import { distinctLooks, lookFileName, lookOf } from './looks'
import { metadataFileName, cardMetadata } from './metadata'
import { wearLookOf } from './rules'

const card = (over: Partial<DealtCard>): DealtCard => ({
  serial: 1, fire: 1, pack: 1, slot: 1, material: 'wood', characterId: 'abcdef123', holoFrame: false, holoPicture: false,
  holo: 'none', edition: 1, editionOf: 1, ...over,
})

describe('wear looks', () => {
  it('maps grades to the six levels, 10 and 1 unique', () => {
    expect(wearLookOf(undefined)).toBe('clean')
    expect(wearLookOf(null)).toBe('clean')
    expect([10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(wearLookOf)).toEqual(['L1', 'L2', 'L2', 'L3', 'L3', 'L4', 'L4', 'L5', 'L5', 'L6'])
    expect(() => wearLookOf(0)).toThrow()
    expect(() => wearLookOf(11)).toThrow()
  })
})

describe('shared images', () => {
  it('cards that look the same share one image; serial and edition do not matter', () => {
    const cards = [
      card({ serial: 1, edition: 1, editionOf: 3 }),
      card({ serial: 2, edition: 2, editionOf: 3, pack: 2 }),
      card({ serial: 3, holoFrame: true, holo: 'frame' }),
      card({ serial: 4, material: 'paper' }),
      card({ serial: 5, grade: 7 }),
      card({ serial: 6, grade: 6 }),
    ]
    const looks = distinctLooks(cards)
    expect(looks.map((l) => l.card.serial)).toEqual([1, 3, 4, 5])
  })

  it('file names match the card contract', () => {
    const l = lookOf(card({ holoFrame: true, holoPicture: true, holo: 'full', grade: 10 }))
    expect(lookFileName(l, 0, 'webp')).toBe('c0-wood-full-l1.webp')
    expect(lookFileName(lookOf(card({ material: 'burning', grade: 5 })), 2, 'png')).toBe('c2-fire-none-l4.png') // same names as FireCards.imageFile
  })

  it('metadata keeps the per-card details and points at the shared image', () => {
    const c = card({ serial: 42, edition: 3, editionOf: 9, fire: 5 })
    const m = cardMetadata(c, { name: 'Rabbit', category: 'animal' }, 'ipfs://cid/rabbit.webp')
    expect(metadataFileName(c)).toBe('42.json')
    expect(m.image).toBe('ipfs://cid/rabbit.webp')
    const t = Object.fromEntries(m.attributes.map((a) => [a.trait_type, a.value]))
    expect(t).toMatchObject({ Serial: 42, Edition: '3 of 9', Series: 5, Category: 'Animal', PDA: 'Unrevealed' })
  })
})
