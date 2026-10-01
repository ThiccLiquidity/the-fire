import { describe, expect, it } from 'vitest'
import { computePool, dealFire, holoCounts, packRespectsFloor, zeroAccumulators, type Accumulators, type DealInput } from './deal'
import { sha256Hex, Stream } from './prng'
import { HOLO_RATE, MATERIALS, RARITY_UNITS, RATE_SCALE, holoRollChance } from './rules'

const CHARS = ['rabbit', 'bird', 'fox']

function input(over: Partial<DealInput> = {}): DealInput {
  return { fire: 1, packs: 150, characterIds: CHARS, seed: 'seed-1', accumulators: zeroAccumulators(), firstSerial: 1, ...over }
}

/** Run `n` Fires back to back, carrying accumulators and serials like the app does. */
function runFires(n: number, packsOf: (i: number) => number, seedPrefix = 's') {
  let acc = zeroAccumulators()
  let serial = 1
  const results = []
  for (let i = 0; i < n; i++) {
    const r = dealFire(input({ fire: i + 1, packs: packsOf(i), seed: `${seedPrefix}${i}`, accumulators: acc, firstSerial: serial }))
    acc = r.accumulatorsAfter
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

describe('computePool', () => {
  it('150 packs from a fresh start: 450 / 270 / 135 / 44 / 1 with carries', () => {
    const p = computePool(zeroAccumulators(), 150)
    // Raw: wood 270, burning 135, charcoal 44.1, diamond 0.9 -> floors sum to 449 of 450; the residual goes to the
    // largest fraction (diamond .9), which then carries -0.1 (borrowed).
    expect(p.counts).toEqual({ paper: 450, wood: 270, burning: 135, charcoal: 44, diamond: 1 })
    expect(p.after).toEqual({ paper: 0, wood: 0, burning: 0, charcoal: 10_000, diamond: -10_000 })
  })
  it('totals are exact and the floor is satisfiable for every pack count 0..400 and odd carries', () => {
    const carries: Accumulators[] = [zeroAccumulators(), { paper: 0, wood: 99_999, burning: -99_999, charcoal: 50_000, diamond: -50_000 }]
    for (const before of carries) {
      for (let packs = 0; packs <= 400; packs++) {
        const p = computePool(before, packs)
        const total = MATERIALS.reduce((s, m) => s + p.counts[m], 0)
        expect(total).toBe(packs * 6)
        expect(p.counts.paper).toBe(3 * packs)
        expect(p.counts.wood).toBeGreaterThanOrEqual(packs)
        const bp = p.counts.burning + p.counts.charcoal + p.counts.diamond
        expect(bp).toBeGreaterThanOrEqual(packs)
        expect(bp).toBeLessThanOrEqual(2 * packs)
        for (const m of MATERIALS) expect(p.counts[m]).toBeGreaterThanOrEqual(0)
        // conservation: nothing created or lost
        const sumBefore = MATERIALS.reduce((s, m) => s + before[m], 0)
        const sumAfter = MATERIALS.reduce((s, m) => s + p.after[m], 0)
        expect(sumAfter).toBe(sumBefore)
      }
    }
  })
})

describe('dealFire', () => {
  it('deals exactly packs * 6 cards with consecutive serials', () => {
    const r = dealFire(input())
    expect(r.cards).toHaveLength(900)
    expect(r.cards.map((c) => c.serial)).toEqual(Array.from({ length: 900 }, (_, i) => i + 1))
    expect(r.nextSerial).toBe(901)
    const byMat = Object.fromEntries(MATERIALS.map((m) => [m, r.cards.filter((c) => c.material === m).length]))
    expect(byMat).toEqual(r.pool)
  })

  it('respects the pack floor in every pack', () => {
    for (const packs of [1, 2, 3, 7, 150, 333]) {
      const r = dealFire(input({ packs, seed: `floor-${packs}` }))
      const bySerial = new Map(r.cards.map((c) => [c.serial, c]))
      expect(r.packContents).toHaveLength(packs)
      for (const pack of r.packContents) {
        const mats = pack.map((s) => bySerial.get(s)!.material)
        expect(packRespectsFloor(mats)).toBe(true)
      }
    }
  })

  it('is deterministic for a given seed, and different for another seed', () => {
    const a = dealFire(input({ seed: 'drand-12345' }))
    const b = dealFire(input({ seed: 'drand-12345' }))
    expect(b).toEqual(a)
    const c = dealFire(input({ seed: 'drand-12346' }))
    expect(c.cards).not.toEqual(a.cards)
    expect(c.pool).toEqual(a.pool) // pool sizes depend only on accumulators + packs
  })

  it('numbers editions 1..N per character + material in serial order', () => {
    const r = dealFire(input())
    const groups = new Map<string, number[]>()
    for (const c of r.cards) {
      const k = `${c.characterId}/${c.material}`
      groups.set(k, [...(groups.get(k) ?? []), c.edition])
      expect(c.editionOf).toBe(r.cards.filter((x) => x.characterId === c.characterId && x.material === c.material).length)
    }
    for (const eds of groups.values()) expect(eds).toEqual(eds.map((_, i) => i + 1))
  })

  it('assigns characters roughly uniformly', () => {
    const r = dealFire(input({ packs: 1000 }))
    for (const ch of CHARS) {
      const n = r.cards.filter((c) => c.characterId === ch).length
      expect(Math.abs(n - 2000)).toBeLessThan(200)
    }
  })

  it('carries accumulators and serials across Fires; long-run counts match the rates exactly', () => {
    const packs = [150, 37, 212, 1, 99, 150, 64, 5, 180, 112]
    const results = runFires(packs.length, (i) => packs[i])
    for (let i = 1; i < results.length; i++) {
      expect(results[i].accumulatorsBefore).toEqual(results[i - 1].accumulatorsAfter)
      expect(results[i].firstSerial).toBe(results[i - 1].nextSerial)
    }
    const totalCards = packs.reduce((s, p) => s + p * 6, 0)
    const last = results[results.length - 1]
    for (const m of MATERIALS) {
      const dealt = results.reduce((s, r) => s + r.pool[m], 0)
      // dealt + carried == exact accrual, and the carry is always within (-2, 2) cards
      expect(dealt * RATE_SCALE + last.accumulatorsAfter[m]).toBe(RARITY_UNITS[m] * totalCards)
      expect(Math.abs(last.accumulatorsAfter[m])).toBeLessThan(2 * RATE_SCALE)
    }
  })

  it('one Diamond per 1,000 cards over the long run', () => {
    // 100 Fires x 150 packs = 90,000 cards -> 90 Diamonds (+/- the carry)
    const results = runFires(100, () => 150, 'dia')
    const diamonds = results.reduce((s, r) => s + r.pool.diamond, 0)
    expect(Math.abs(diamonds - 90)).toBeLessThanOrEqual(1)
  })

  it('holo rates converge to 5/10/50/90/100% with each roll at 1 - sqrt(1 - rate)', () => {
    const results = runFires(60, () => 150, 'holo') // 54,000 cards
    const cards = results.flatMap((r) => r.cards)
    const hc = holoCounts(cards)
    for (const m of MATERIALS) {
      const n = cards.filter((c) => c.material === m).length
      const anyHolo = n - hc[m].none
      const rate = HOLO_RATE[m]
      if (m === 'diamond') {
        expect(hc[m].full).toBe(n)
        continue
      }
      const sd = Math.sqrt((rate * (1 - rate)) / n)
      expect(Math.abs(anyHolo / n - rate)).toBeLessThan(4 * sd + 1e-9)
      const p = holoRollChance(m)
      const fullRate = p * p
      const fullSd = Math.sqrt((fullRate * (1 - fullRate)) / n)
      expect(Math.abs(hc[m].full / n - fullRate)).toBeLessThan(4 * fullSd + 2 / n)
      // frame-only and picture-only are symmetric
      const fo = hc[m].frame / n, po = hc[m].picture / n
      const oneSd = Math.sqrt((p * (1 - p) * (1 - p)) / n)
      expect(Math.abs(fo - p * (1 - p))).toBeLessThan(4 * oneSd + 1e-9)
      expect(Math.abs(po - p * (1 - p))).toBeLessThan(4 * oneSd + 1e-9)
    }
  })

  it('rejects bad input', () => {
    expect(() => dealFire(input({ characterIds: [] }))).toThrow()
    expect(() => dealFire(input({ packs: -1 }))).toThrow()
    expect(() => dealFire(input({ packs: 1.5 }))).toThrow()
    expect(() => dealFire(input({ seed: '' }))).toThrow()
    expect(() => dealFire(input({ characterIds: ['a', 'a'] }))).toThrow()
  })

  it('handles a zero-pack Fire without moving anything', () => {
    const r = dealFire(input({ packs: 0, firstSerial: 42 }))
    expect(r.cards).toHaveLength(0)
    expect(r.nextSerial).toBe(42)
    expect(r.accumulatorsAfter).toEqual(r.accumulatorsBefore)
  })
})

