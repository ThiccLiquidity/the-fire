import { describe, expect, it } from 'vitest'
import { computePool, dealFire, holoCounts, type DealInput, type DealResult } from './deal'
import { dealInBackground, dealInputKey } from './dealPreview'
import { sha256Hex, Stream } from './prng'
import { compileRecipe, holoOdds, slotTypeIndexes, specialAllHoloRecipe, standardRecipe, type Recipe } from './recipe'
import { HOLO_RATE, MATERIALS, expectedHolos, holoRollChance } from './rules'

const CHARS = ['rabbit', 'bird', 'fox']

function input(over: Partial<DealInput> = {}): DealInput {
  return { fire: 1, packs: 150, characterIds: CHARS, seed: 'seed-1', recipe: standardRecipe(1), firstSerial: 1, ...over }
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

/** The rule written out once more, step by step, as an independent reference for computePool. */
function reference(P: number, D: number) {
  const N = 6 * P
  let fire = Math.floor((15000 * N + 50000) / 100000)
  let charcoal = Math.floor((4900 * N + 50000) / 100000)
  const diamond = P === 0 ? 0 : Math.min(Math.max(1, D), P)
  let wood = 3 * P - fire - charcoal - diamond
  while (fire + charcoal + diamond > 2 * P) { if (fire > 0) fire--; else charcoal--; wood++ }
  while (fire + charcoal + diamond < P) { wood--; fire++ }
  return { paper: 3 * P, wood, burning: fire, charcoal, diamond }
}

function checkInvariants(P: number, D: number) {
  const c = computePool(P, D)
  expect(MATERIALS.reduce((s, m) => s + c[m], 0)).toBe(6 * P)
  expect(c.paper).toBe(3 * P)
  expect(c.wood).toBeGreaterThanOrEqual(P)
  const fob = c.burning + c.charcoal + c.diamond
  expect(fob).toBeGreaterThanOrEqual(P)
  expect(fob).toBeLessThanOrEqual(2 * P)
  for (const m of MATERIALS) expect(c[m]).toBeGreaterThanOrEqual(0)
  if (P > 0) expect(c.diamond).toBe(Math.min(Math.max(1, D), P))
  else expect(c.diamond).toBe(0)
  expect(c).toEqual(reference(P, D))
}

describe('computePool', () => {
  it('167 packs: 501 / 301 / 150 / 49 / 1, and 3 Diamonds come out of Wood', () => {
    expect(computePool(167, 1)).toEqual({ paper: 501, wood: 301, burning: 150, charcoal: 49, diamond: 1 })
    expect(computePool(167, 3)).toEqual({ paper: 501, wood: 299, burning: 150, charcoal: 49, diamond: 3 })
    expect(computePool(167)).toEqual(computePool(167, 1)) // default is 1
  })
  it('every Series has at least one Diamond, even a tiny one; none when there are no packs', () => {
    expect(computePool(0, 1)).toEqual({ paper: 0, wood: 0, burning: 0, charcoal: 0, diamond: 0 })
    expect(computePool(1, 1)).toEqual({ paper: 3, wood: 1, burning: 1, charcoal: 0, diamond: 1 })
    expect(computePool(2, 1)).toEqual({ paper: 6, wood: 2, burning: 2, charcoal: 1, diamond: 1 })
    expect(computePool(3, 1)).toEqual({ paper: 9, wood: 4, burning: 3, charcoal: 1, diamond: 1 })
    expect(computePool(10, 1)).toEqual({ paper: 30, wood: 17, burning: 9, charcoal: 3, diamond: 1 })
    expect(computePool(5, 0).diamond).toBe(1) // a setting below 1 still makes one
  })
  it('more Diamonds than packs is capped at one per pack; the floor still holds', () => {
    expect(computePool(3, 10)).toEqual({ paper: 9, wood: 3, burning: 2, charcoal: 1, diamond: 3 })
    expect(computePool(1, 1000)).toEqual({ paper: 3, wood: 1, burning: 1, charcoal: 0, diamond: 1 })
    expect(computePool(1000, 1000)).toEqual({ paper: 3000, wood: 1000, burning: 706, charcoal: 294, diamond: 1000 })
    expect(computePool(10, 10)).toEqual({ paper: 30, wood: 10, burning: 7, charcoal: 3, diamond: 10 })
  })
  it('the same Series always gets the same pool: nothing carries from one Series to the next', () => {
    const a = runFires(3, () => 150).map((r) => r.pool)
    expect(a[1]).toEqual(a[0])
    expect(a[2]).toEqual(a[0])
  })
  it('counts sum to 6P, Paper 3P, Wood >= P, P <= Fire-or-better <= 2P, Diamond >= 1 for P 0..400 and D 1..P', () => {
    for (let P = 0; P <= 400; P++) {
      for (const D of [1, 2, 3, 5, Math.floor(P / 3), Math.floor(P / 2), P - 1, P, P + 1]) checkInvariants(P, Math.max(1, D))
    }
    for (let P = 0; P <= 40; P++) for (let D = 1; D <= P + 2; D++) checkInvariants(P, D)
  })
  it('large Series: invariants hold and the shares match', () => {
    for (const P of [1000, 4_999, 65_535, 1_000_000, 4_294_967_295]) {
      for (const D of [1, 7, 1000]) checkInvariants(P, D)
    }
    const c = computePool(10_000, 1)
    expect(c).toEqual({ paper: 30_000, wood: 18_059, burning: 9_000, charcoal: 2_940, diamond: 1 })
  })
  it('rejects bad input', () => {
    expect(() => computePool(-1)).toThrow()
    expect(() => computePool(1.5)).toThrow()
    expect(() => computePool(10, 1.5)).toThrow()
    expect(() => computePool(4_294_967_296)).toThrow() // the contract's limit
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

/** Every pack holds, per slot group, cards of a type the group allows; must-holo groups are holo. */
function checkPacks(r: DealResult, recipe: Recipe) {
  const bySerial = new Map(r.cards.map((c) => [c.serial, c]))
  const sets = recipe.slots.map((s) => new Set(slotTypeIndexes(recipe, s)))
  const S = compileRecipe(recipe).S
  expect(r.packContents).toHaveLength(r.packs)
  for (const pack of r.packContents) {
    expect(pack).toHaveLength(S)
    const perGroup = new Array(recipe.slots.length).fill(0)
    for (const serial of pack) {
      const c = bySerial.get(serial)!
      expect(sets[c.group].has(c.type)).toBe(true)
      if (recipe.slots[c.group].mustHolo) expect(c.holo).not.toBe('none')
      perGroup[c.group]++
    }
    expect(perGroup).toEqual(recipe.slots.map((s) => s.count))
  }
}

describe('dealFire (recipe)', () => {
  it('deals exactly packs x cards per pack with consecutive serials; totals = the pool', () => {
    const r = dealFire(input())
    expect(r.cards).toHaveLength(900)
    expect(r.cardsPerPack).toBe(6)
    expect(r.cards.map((c) => c.serial)).toEqual(Array.from({ length: 900 }, (_, i) => i + 1))
    expect(r.nextSerial).toBe(901)
    const byType = [0, 1, 2, 3, 4].map((t) => r.cards.filter((c) => c.type === t).length)
    expect(byType).toEqual(r.pool)
    expect(r.pool).toEqual(MATERIALS.map((m) => computePool(150, 1)[m]))
  })

  it('Standard: every pack is 3 Paper, a Wood, a Wood-or-better and a Fire-or-better', () => {
    for (const packs of [1, 2, 3, 7, 150, 333]) {
      const recipe = standardRecipe(packs === 3 ? 5 : 1)
      const r = dealFire(input({ packs, seed: `floor-${packs}`, recipe }))
      checkPacks(r, recipe)
      const bySerial = new Map(r.cards.map((c) => [c.serial, c]))
      for (const pack of r.packContents) {
        const types = pack.map((s) => bySerial.get(s)!.type).sort()
        expect(types.filter((t) => t === 0)).toHaveLength(3)
        expect(types.filter((t) => t >= 2).length).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('Special 3-card all-holo: every card holo, slots kept, totals exact', () => {
    const recipe = specialAllHoloRecipe()
    for (const packs of [1, 2, 5, 100, 1000]) {
      const r = dealFire(input({ packs, recipe, seed: `sp-${packs}` }))
      expect(r.cards).toHaveLength(3 * packs)
      expect(r.cards.every((c) => c.holo !== 'none')).toBe(true)
      checkPacks(r, recipe)
      expect([0, 1, 2].map((t) => r.cards.filter((c) => c.type === t).length)).toEqual(r.pool)
    }
  })

  it('random recipes: packs always fill, totals exact', () => {
    const recipe: Recipe = {
      ...standardRecipe(3),
      slots: [
        { count: 2, kind: 'types', typeIds: ['paper'], minRank: 0, maxRank: null, mustHolo: false },
        { count: 2, kind: 'rank', typeIds: [], minRank: 0, maxRank: null, mustHolo: false },
        { count: 1, kind: 'rank', typeIds: [], minRank: 3, maxRank: null, mustHolo: true },
      ],
    }
    for (const packs of [1, 4, 9, 77]) checkPacks(dealFire(input({ packs, recipe, seed: `r${packs}` })), recipe)
  })

  it('is deterministic for a given seed, and different for another seed', () => {
    const a = dealFire(input({ seed: 'drand-12345' }))
    expect(dealFire(input({ seed: 'drand-12345' }))).toEqual(a)
    const c = dealFire(input({ seed: 'drand-12346' }))
    expect(c.cards).not.toEqual(a.cards)
    expect(c.pool).toEqual(a.pool)
  })

  it('numbers editions 1..N per character + type in serial order', () => {
    const r = dealFire(input())
    const groups = new Map<string, number[]>()
    for (const c of r.cards) {
      const k = `${c.characterId}/${c.type}`
      groups.set(k, [...(groups.get(k) ?? []), c.edition])
    }
    for (const eds of groups.values()) expect(eds).toEqual(eds.map((_, i) => i + 1))
    for (const c of r.cards.slice(0, 50)) expect(c.editionOf).toBe(groups.get(`${c.characterId}/${c.type}`)!.length)
  })

  it('assigns characters roughly uniformly, and takes hundreds of characters', () => {
    const r = dealFire(input({ packs: 1000 }))
    for (const ch of CHARS) expect(Math.abs(r.cards.filter((c) => c.characterId === ch).length - 2000)).toBeLessThan(200)
    const many = Array.from({ length: 700 }, (_, i) => `c${i}`)
    expect(dealFire(input({ characterIds: many, packs: 20 })).characterIds).toHaveLength(700)
  })

  it('carries serials across Series', () => {
    const packs = [150, 37, 212, 1, 99]
    const results = runFires(packs.length, (i) => packs[i])
    for (let i = 1; i < results.length; i++) expect(results[i].firstSerial).toBe(results[i - 1].nextSerial)
  })

  it('holo rates converge to each type\'s odds (Standard 5/10/50/90/100%)', () => {
    const results = runFires(40, () => 150, 'holo') // 36,000 cards
    const cards = results.flatMap((r) => r.cards)
    const hc = holoCounts(cards, 5)
    MATERIALS.forEach((m, t) => {
      const n = cards.filter((c) => c.type === t).length
      if (m === 'diamond') { expect(hc[t].none).toBe(0); return }
      const rate = HOLO_RATE[m]
      const sd = Math.sqrt((rate * (1 - rate)) / n)
      expect(Math.abs((n - hc[t].none) / n - rate)).toBeLessThan(4 * sd + 1e-9)
      const o = holoOdds(standardRecipe().types[t])
      expect(o[0]).toBeCloseTo(1 - rate, 9)
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
    expect(r.pool).toEqual([0, 0, 0, 0, 0])
  })
})

describe('deal preview (background)', () => {
  it('deals the same result off the main thread (or on it where workers are missing) and keys inputs exactly', async () => {
    const inp = { fire: 2, packs: 12, characterIds: ['a', 'b'], seed: 'seed-x', recipe: standardRecipe(1), firstSerial: 10 }
    const r = await dealInBackground(inp)
    expect(r).toEqual(dealFire(inp))
    expect(dealInputKey(inp)).toBe(dealInputKey({ ...inp }))
    expect(dealInputKey(inp)).not.toBe(dealInputKey({ ...inp, packs: 13 }))
    expect(dealInputKey(inp)).not.toBe(dealInputKey({ ...inp, firstSerial: 11 }))
    expect(dealInputKey(inp)).not.toBe(dealInputKey({ ...inp, recipe: specialAllHoloRecipe() }))
    await expect(dealInBackground({ ...inp, characterIds: [] })).rejects.toThrow()
  })
})
