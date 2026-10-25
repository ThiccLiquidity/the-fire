import { describe, expect, it } from 'vitest'
import { dealFire, holoCounts, type DealInput } from './deal'
import { dealInBackground, dealInputKey } from './dealPreview'
import { sha256Hex, Stream } from './prng'
import { holoOdds, slotOdds, specialAllHoloRecipe, standardRecipe, typeOdds } from './recipe'
import { HOLO_RATE, expectedHolos, holoRollChance } from './rules'

const CHARS = ['rabbit', 'bird', 'fox']

function input(over: Partial<DealInput> = {}): DealInput {
  return { fire: 1, packs: 150, characterIds: CHARS, seed: 'seed-1', recipe: standardRecipe(), firstSerial: 1, ...over }
}

/** Run `n` Series back to back, carrying serials like the app does (nothing else carries). */
function runFires(n: number, packsOf: (i: number) => number, seedPrefix = 's') {
  let serial = 1
  const results = []
  for (let i = 0; i < n; i++) {
    const r = dealFire(input({ fire: i + 1, packs: packsOf(i), seed: `${seedPrefix}${i}`, firstSerial: serial }))
    serial = r.nextSerial
    results.push(r)
  }
  return results
}

/** |got - n p| within 5 standard deviations (+1). */
const near = (got: number, n: number, p: number) => expect(Math.abs(got - n * p)).toBeLessThanOrEqual(5 * Math.sqrt(n * p * (1 - p)) + 1)

describe('prng', () => {
  it('sha256 matches the standard test vectors', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
  })
  it('int() is in range and roughly uniform', () => {
    const s = new Stream('x', 'y')
    const counts = new Array(7).fill(0)
    for (let i = 0; i < 70_000; i++) counts[s.int(7)]++
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500)
  })
})

describe('expectedHolos', () => {
  it('splits each material by its holo rate; Diamond is a third each', () => {
    const p = holoRollChance('burning')
    const e = expectedHolos('burning', 150)
    expect(e.frame).toBeCloseTo(150 * p * (1 - p))
    expect(e.picture).toBeCloseTo(e.frame)
    expect(e.full).toBeCloseTo(150 * p * p)
    expect(e.total).toBeCloseTo(75)
    expect(expectedHolos('diamond', 3)).toEqual({ frame: 1, picture: 1, full: 1, total: 3 })
  })
})

describe('dealFire (slots, each card its own roll)', () => {
  it('deals exactly packs x cards per pack with consecutive serials; pool = what was dealt', () => {
    const r = dealFire(input())
    expect(r.cards).toHaveLength(900)
    expect(r.cardsPerPack).toBe(6)
    expect(r.cards.map((c) => c.serial)).toEqual(Array.from({ length: 900 }, (_, i) => i + 1))
    expect(r.nextSerial).toBe(901)
    const byType = [0, 1, 2, 3, 4, 5].map((t) => r.cards.filter((c) => c.type === t).length)
    expect(byType).toEqual(r.pool)
    for (const pack of r.packContents) expect(pack).toHaveLength(6)
  })

  it('type odds converge to the weights over many cards (Standard)', () => {
    const cards = runFires(20, () => 500, 'odds').flatMap((r) => r.cards) // 60,000 cards
    typeOdds(standardRecipe()).forEach((p, t) => near(cards.filter((c) => c.type === t).length, cards.length, p))
  })

  it('every pack has the shape (3 Paper, a Wood, a Wood or better, a Fire or better); each slot converges to its own odds; no caps', () => {
    const r = dealFire(input({ packs: 5000, seed: 'caps' }))
    const bySerial = new Map(r.cards.map((c) => [c.serial, c]))
    const odds = slotOdds(standardRecipe())
    const at = Array.from({ length: 6 }, () => new Array<number>(6).fill(0)) // at[position][type]
    let twoFa = 0
    for (const pack of r.packContents) {
      const types = pack.map((s) => bySerial.get(s)!.type)
      expect(types.slice(0, 3)).toEqual([0, 0, 0])
      expect(types[3]).toBe(1)
      expect(types[4]).toBeGreaterThanOrEqual(1)
      expect(types[5]).toBeGreaterThanOrEqual(2)
      types.forEach((t, k) => at[k][t]++)
      if (types.filter((t) => t === 5).length >= 2) twoFa++
    }
    for (let t = 0; t < 6; t++) {
      near(at[4][t], 5000, odds[2][t])
      near(at[5][t], 5000, odds[3][t])
    }
    expect(twoFa).toBeGreaterThan(5) // 4.5% x 7.5% of packs
    // and a character can get any number of Full Arts
    for (const id of CHARS) expect(r.cards.filter((c) => c.type === 5 && c.characterId === id).length).toBeGreaterThan(1)
  })

  it('the last pack has the same odds as the first (nothing depends on the packs before)', () => {
    const r = dealFire(input({ packs: 4000, seed: 'last' }))
    const bySerial = new Map(r.cards.map((c) => [c.serial, c]))
    const firstHalf = r.packContents.slice(0, 2000).flat().map((s) => bySerial.get(s)!.type)
    const lastHalf = r.packContents.slice(2000).flat().map((s) => bySerial.get(s)!.type)
    typeOdds(standardRecipe()).forEach((p, t) => {
      near(firstHalf.filter((x) => x === t).length, firstHalf.length, p)
      near(lastHalf.filter((x) => x === t).length, lastHalf.length, p)
    })
  })

  it('Gold and Full Art always full holo', () => {
    const r = dealFire(input({ packs: 1000, seed: 'fa' }))
    expect(r.cards.filter((c) => c.type >= 4).every((c) => c.holo === 'full')).toBe(true)
  })

  it('Special 3-card all-holo: every card holo', () => {
    const r = dealFire(input({ packs: 1000, recipe: specialAllHoloRecipe(), seed: 'sp' }))
    expect(r.cards).toHaveLength(3000)
    expect(r.cards.every((c) => c.holo !== 'none')).toBe(true)
  })

  it('is deterministic for a given seed, and different for another seed', () => {
    const a = dealFire(input({ seed: 'drand-12345' }))
    expect(dealFire(input({ seed: 'drand-12345' }))).toEqual(a)
    const c = dealFire(input({ seed: 'drand-12346' }))
    expect(c.cards).not.toEqual(a.cards)
  })

  it('gives print numbers #1, #2, ... per exact card (character + type + holo look) in the order dealt', () => {
    const r = dealFire(input())
    const byDeal = [...r.cards].sort((a, b) => a.pack - b.pack || a.slot - b.slot)
    const groups = new Map<string, number[]>()
    for (const c of byDeal) {
      const k = `${c.characterId}/${c.type}/${c.holo}`
      groups.set(k, [...(groups.get(k) ?? []), c.printNumber])
    }
    for (const ks of groups.values()) expect(ks).toEqual(ks.map((_, i) => i + 1))
    const looks = new Set(r.cards.map((c) => `${c.characterId}/${c.type}`))
    expect(groups.size).toBeGreaterThan(looks.size) // holo looks are numbered apart
  })

  it('assigns characters uniformly by default, and takes hundreds of characters', () => {
    const r = dealFire(input({ packs: 1000 }))
    for (const ch of CHARS) near(r.cards.filter((c) => c.characterId === ch).length, 6000, 1 / 3)
    const many = Array.from({ length: 700 }, (_, i) => `c${i}`)
    expect(dealFire(input({ characterIds: many, packs: 20 })).characterIds).toHaveLength(700)
  })

  it('weighted characters converge to their weights, the same for every type', () => {
    const r = dealFire(input({ packs: 2000, characterWeights: [1, 2, 3], seed: 'w' }))
    CHARS.forEach((ch, i) => near(r.cards.filter((c) => c.characterId === ch).length, r.cards.length, (i + 1) / 6))
    const rare = r.cards.filter((c) => c.type >= 2)
    CHARS.forEach((ch, i) => near(rare.filter((c) => c.characterId === ch).length, rare.length, (i + 1) / 6))
    // equal weights deal exactly what no weights deal
    expect(dealFire(input({ characterWeights: [4, 4, 4] }))).toEqual(dealFire(input()))
  })

  it('carries serials across Series', () => {
    const packs = [150, 37, 212, 1, 99]
    const results = runFires(packs.length, (i) => packs[i])
    for (let i = 1; i < results.length; i++) expect(results[i].firstSerial).toBe(results[i - 1].nextSerial)
  })

  it('holo rates converge to each type\'s odds (Standard 5/10/50/90%)', () => {
    const cards = runFires(40, () => 150, 'holo').flatMap((r) => r.cards) // 36,000 cards
    const hc = holoCounts(cards, 6)
    const rates = [HOLO_RATE.paper, HOLO_RATE.wood, HOLO_RATE.burning, HOLO_RATE.charcoal]
    rates.forEach((rate, t) => {
      const n = cards.filter((c) => c.type === t).length
      near(n - hc[t].none, n, rate)
      expect(holoOdds(standardRecipe().types[t])[0]).toBeCloseTo(1 - rate, 9)
    })
  })

  it('rejects bad input, and a sample deal over the card limit', () => {
    expect(() => dealFire(input({ characterIds: [] }))).toThrow()
    expect(() => dealFire(input({ packs: -1 }))).toThrow()
    expect(() => dealFire(input({ packs: 1.5 }))).toThrow()
    expect(() => dealFire(input({ seed: '' }))).toThrow()
    expect(() => dealFire(input({ characterIds: ['a', 'a'] }))).toThrow()
    expect(() => dealFire(input({ packs: 100_001 }))).toThrow(/at most/)
  })

  it('handles a zero-pack Series without moving anything', () => {
    const r = dealFire(input({ packs: 0, firstSerial: 42 }))
    expect(r.cards).toHaveLength(0)
    expect(r.nextSerial).toBe(42)
    expect(r.pool).toEqual([0, 0, 0, 0, 0, 0])
  })
})

describe('deal preview (background)', () => {
  it('deals the same result off the main thread (or on it where workers are missing) and keys inputs exactly', async () => {
    const inp = { fire: 2, packs: 12, characterIds: ['a', 'b'], seed: 'seed-x', recipe: standardRecipe(), firstSerial: 10 }
    const r = await dealInBackground(inp)
    expect(r).toEqual(dealFire(inp))
    expect(dealInputKey(inp)).toBe(dealInputKey({ ...inp }))
    expect(dealInputKey(inp)).not.toBe(dealInputKey({ ...inp, packs: 13 }))
    expect(dealInputKey(inp)).not.toBe(dealInputKey({ ...inp, firstSerial: 11 }))
    expect(dealInputKey(inp)).not.toBe(dealInputKey({ ...inp, recipe: specialAllHoloRecipe() }))
    expect(dealInputKey(inp)).not.toBe(dealInputKey({ ...inp, characterWeights: [2, 1] }))
    await expect(dealInBackground({ ...inp, characterIds: [] })).rejects.toThrow()
  })
})
