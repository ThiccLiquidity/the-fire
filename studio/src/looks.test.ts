import { describe, expect, it } from 'vitest'
import type { DealtCard } from './deal'
import { GRADE_STATES, distinctLooks, gridSize, imagesPerCharacter, lookFileName, lookKey, lookOf, looksPerCharacter, seriesGrid } from './looks'
import { cardMetadata, metadataFileName } from './metadata'
import { holoLooksFor, specialAllHoloRecipe, standardRecipe, type Recipe } from './recipe'
import { HOLO_TYPES, wearLookOf } from './rules'

const STD = standardRecipe()
const card = (over: Partial<DealtCard>): DealtCard => ({
  serial: 1, fire: 1, pack: 1, slot: 1, group: 0, type: 1, characterId: 'abcdef123', holoFrame: false, holoPicture: false,
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
      card({ serial: 4, type: 0 }),
      card({ serial: 5, grade: 7 }),
      card({ serial: 6, grade: 6 }),
      card({ serial: 7, grade: 7, edition: 2 }),
    ]
    expect(distinctLooks(cards, STD).map((l) => l.card.serial)).toEqual([1, 3, 4, 5, 6])
  })

  it('Standard file names are unchanged: c<index>-<paper|wood|fire|coal|diamond>-<holo>-<grade>.webp', () => {
    const f = (c: Partial<DealtCard>, i: number) => lookFileName(lookOf(card(c), STD), i)
    expect(f({ holoFrame: true, holoPicture: true, holo: 'full', grade: 10 }, 0)).toBe('c0-wood-full-10.webp')
    expect(f({ type: 2, grade: 5 }, 2)).toBe('c2-fire-none-5.webp')
    expect(f({ type: 3, holoPicture: true, holo: 'picture' }, 254)).toBe('c254-coal-picture-u.webp')
    expect(f({ type: 4, holoFrame: true, holo: 'frame', grade: 1 }, 1)).toBe('c1-diamond-frame-1.webp')
    expect(f({}, 1000)).toBe('c1000-wood-none-u.webp')
    expect(() => f({ grade: 11 }, 0)).toThrow()
  })

  it('Standard grid: 19 looks x 11 grade states = 209 images per character, the same names as before', () => {
    expect(looksPerCharacter(STD)).toBe(19)
    expect(imagesPerCharacter(STD)).toBe(209)
    expect(gridSize(2, STD)).toBe(418)
    const grid = seriesGrid(4, ['aaa', 'bbb'], STD)
    expect(grid).toHaveLength(418)
    expect(new Set(grid.map((g) => g.file)).size).toBe(418)
    expect(new Set(grid.map((g) => g.key)).size).toBe(418)
    expect(grid[0].file).toBe('c0-paper-none-u.webp')
    expect(grid[10].file).toBe('c0-paper-none-10.webp')
    expect(grid[209].file).toBe('c1-paper-none-u.webp')
    expect(grid.at(-1)!.file).toBe('c1-diamond-full-10.webp')
    expect(grid.some((g) => g.file.includes('diamond-none'))).toBe(false)
    const ids = ['paper', 'wood', 'fire', 'coal', 'diamond']
    let n = 0
    for (const [t, slug] of ids.entries()) {
      for (const h of HOLO_TYPES) {
        if (slug === 'diamond' && h === 'none') continue
        for (const g of GRADE_STATES) {
          expect(grid.some((e) => e.file === `c1-${slug}-${h}-${g == null ? 'u' : g}.webp` && e.look.type === t)).toBe(true)
          n++
        }
      }
    }
    expect(n).toBe(209)
    for (const g of grid.slice(0, 30)) expect(lookKey(lookOf(g.card, STD))).toBe(g.key)
  })

  it('Special all-holo grid: no "none" images, 3 types x 3 holo x 11 = 99 per character', () => {
    const r = specialAllHoloRecipe()
    expect(imagesPerCharacter(r)).toBe(99)
    const grid = seriesGrid(9, ['a', 'b', 'c'], r)
    expect(grid).toHaveLength(297)
    expect(grid.some((g) => g.file.includes('-none-'))).toBe(false)
    expect(grid[0].file).toBe('c0-fire-frame-u.webp')
  })

  it('a new type gets its own slug in file names; a type that is never plain gets no none images', () => {
    const r: Recipe = standardRecipe()
    r.types.push({ id: 'gold', name: 'Gold', slug: 'gold', rank: 5, supply: 'count', amount: '1', maxPerPack: '1', holo: { mode: 'distribution', weights: ['0', '0', '0', '1'] }, frameSet: 'diamond' })
    expect(holoLooksFor(r, 5)).toEqual(['full'])
    expect(imagesPerCharacter(r)).toBe(220)
    const files = seriesGrid(1, ['x'], r).map((g) => g.file)
    expect(files).toContain('c0-gold-full-u.webp')
    expect(files.filter((f) => f.includes('-gold-'))).toHaveLength(11)
  })

  it('a type in plain slots with 0% holo has only "none" images', () => {
    const r = standardRecipe()
    r.types[0].holo = { mode: 'independent', frame: '0', picture: '0' }
    expect(holoLooksFor(r, 0)).toEqual(['none'])
    expect(imagesPerCharacter(r)).toBe(176)
  })

  it('metadata keeps the per-card details, the type name as Material, and points at the shared image', () => {
    const c = card({ serial: 42, edition: 3, editionOf: 9, fire: 5 })
    const m = cardMetadata(c, { name: 'Rabbit', category: 'Animal' }, 'Wood', 'ipfs://cid/rabbit.webp')
    expect(metadataFileName(c)).toBe('42.json')
    expect(m.name).toBe('Wood Rabbit #42')
    expect(m.image).toBe('ipfs://cid/rabbit.webp')
    const t = Object.fromEntries(m.attributes.map((a) => [a.trait_type, a.value]))
    expect(t).toMatchObject({ Serial: 42, Edition: '3 of 9', Series: 5, Category: 'Animal', PDA: 'Unrevealed', Material: 'Wood' })
  })
})
