import { describe, expect, it } from 'vitest'
import type { DealtCard } from './deal'
import {
  GRADE_STATES, IMAGES_PER_CHARACTER, LOOKS_PER_CHARACTER, distinctLooks, gridSize, holosFor, lookFileName, lookKey, lookOf, seriesGrid,
} from './looks'
import { metadataFileName, cardMetadata } from './metadata'
import { HOLO_TYPES, MATERIALS, wearLookOf } from './rules'

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
  it('cards that look the same share one image; serial and edition do not matter, every grade has its own', () => {
    const cards = [
      card({ serial: 1, edition: 1, editionOf: 3 }),
      card({ serial: 2, edition: 2, editionOf: 3, pack: 2 }),
      card({ serial: 3, holoFrame: true, holo: 'frame' }),
      card({ serial: 4, material: 'paper' }),
      card({ serial: 5, grade: 7 }),
      card({ serial: 6, grade: 6 }), // same wear frame as 7, but the seal prints 6: its own image
      card({ serial: 7, grade: 7, edition: 2 }),
    ]
    const looks = distinctLooks(cards)
    expect(looks.map((l) => l.card.serial)).toEqual([1, 3, 4, 5, 6])
    expect(lookKey(lookOf(cards[4]))).not.toBe(lookKey(lookOf(cards[5])))
  })

  it('file names: c<index>-<mat>-<holo>-<grade>.webp with fixed material ids', () => {
    const l = lookOf(card({ holoFrame: true, holoPicture: true, holo: 'full', grade: 10 }))
    expect(lookFileName(l, 0)).toBe('c0-wood-full-10.webp')
    expect(lookFileName(lookOf(card({ material: 'burning', grade: 5 })), 2)).toBe('c2-fire-none-5.webp')
    expect(lookFileName(lookOf(card({ material: 'charcoal', holoPicture: true, holo: 'picture' })), 254)).toBe('c254-coal-picture-u.webp')
    expect(lookFileName(lookOf(card({ material: 'diamond', holoFrame: true, holo: 'frame', grade: 1 })), 1)).toBe('c1-diamond-frame-1.webp')
    expect(() => lookFileName(lookOf(card({ material: 'diamond' })), 0)).toThrow(/always holo/)
    expect(() => lookFileName(lookOf(card({ grade: 11 })), 0)).toThrow()
  })

  it('every material x holo x grade (u, 1..10) has exactly the contract name', () => {
    const ids = { paper: 'paper', wood: 'wood', burning: 'fire', charcoal: 'coal', diamond: 'diamond' } as const
    let n = 0
    for (const m of MATERIALS) {
      for (const h of HOLO_TYPES) {
        const holoFrame = h === 'frame' || h === 'full'
        const holoPicture = h === 'picture' || h === 'full'
        for (const g of GRADE_STATES) {
          const look = lookOf(card({ material: m, holo: h, holoFrame, holoPicture, grade: g }))
          if (m === 'diamond' && h === 'none') {
            expect(() => lookFileName(look, 3)).toThrow()
            continue
          }
          const name = lookFileName(look, 3)
          expect(name).toBe(`c3-${ids[m]}-${h}-${g == null ? 'u' : g}.webp`)
          expect(name).toMatch(/^c\d+-(paper|wood|fire|coal|diamond)-(none|frame|picture|full)-(u|[1-9]|10)\.webp$/)
          n++
        }
      }
    }
    expect(n).toBe(IMAGES_PER_CHARACTER)
  })

  it('the full grid: 19 looks x 11 grade states = 209 images per character, all names unique', () => {
    expect(LOOKS_PER_CHARACTER).toBe(19)
    expect(IMAGES_PER_CHARACTER).toBe(209)
    expect(holosFor('diamond')).toEqual(['frame', 'picture', 'full'])
    expect(gridSize(2)).toBe(418)
    const grid = seriesGrid(4, ['aaa', 'bbb'])
    expect(grid).toHaveLength(418)
    expect(new Set(grid.map((g) => g.file)).size).toBe(418)
    expect(new Set(grid.map((g) => g.key)).size).toBe(418)
    expect(grid[0].file).toBe('c0-paper-none-u.webp')
    expect(grid[10].file).toBe('c0-paper-none-10.webp')
    expect(grid[209].file).toBe('c1-paper-none-u.webp')
    expect(grid.at(-1)!.file).toBe('c1-diamond-full-10.webp')
    expect(grid.some((g) => g.file.includes('diamond-none'))).toBe(false)
    // a dealt card's file is always in the grid
    const files = new Set(grid.map((g) => g.file))
    const dealt = card({ fire: 4, characterId: 'bbb', material: 'charcoal', holoFrame: true, holo: 'frame', grade: 9 })
    expect(files.has(lookFileName(lookOf(dealt), 1))).toBe(true)
    // the stand-in card renders exactly its look
    for (const g of grid.slice(0, 30)) expect(lookKey(lookOf(g.card))).toBe(g.key)
  })

  it('metadata keeps the per-card details and points at the shared image', () => {
    const c = card({ serial: 42, edition: 3, editionOf: 9, fire: 5 })
    const m = cardMetadata(c, { name: 'Rabbit', category: 'Animal' }, 'ipfs://cid/rabbit.webp')
    expect(metadataFileName(c)).toBe('42.json')
    expect(m.image).toBe('ipfs://cid/rabbit.webp')
    const t = Object.fromEntries(m.attributes.map((a) => [a.trait_type, a.value]))
    expect(t).toMatchObject({ Serial: 42, Edition: '3 of 9', Series: 5, Category: 'Animal', PDA: 'Unrevealed' })
  })
})
