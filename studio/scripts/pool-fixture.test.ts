/** Writes contracts/test/cards/pool-fixture.json (run with WRITE_POOL_FIXTURE=1) so the contract's port of computePool
 *  is checked against this exact implementation: small Series (where the pack floor and the Diamond cap bite), every
 *  Diamond setting up to the pack count for tiny Series, and a spread of larger Series. */
import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { computePool } from '../src/deal'
import { MATERIALS } from '../src/rules'

describe.runIf(process.env.WRITE_POOL_FIXTURE)('pool fixture', () => {
  it('writes the fixture', () => {
    const cases: [number, number][] = []
    for (let packs = 0; packs <= 12; packs++) for (let d = 1; d <= packs + 2; d++) cases.push([packs, d])
    for (const packs of [13, 17, 33, 50, 99, 100, 150, 151, 167, 200, 333, 500, 999, 1000, 4999, 65_535, 1_000_000, 4_294_967_295]) {
      for (const d of [1, 2, 3, 10, 1000]) cases.push([packs, d])
    }
    let x = 12345
    const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x }
    for (let i = 0; i < 150; i++) {
      const packs = 1 + (rnd() % 2000)
      cases.push([packs, 1 + (rnd() % (rnd() % 2 ? 5 : 1000))])
    }
    const rows = cases.map(([packs, diamonds]) => {
      const c = computePool(packs, diamonds)
      return { packs, diamonds, counts: MATERIALS.map((m) => c[m]) }
    })
    writeFileSync(new URL('../../contracts/test/cards/pool-fixture.json', import.meta.url), JSON.stringify({ rows }))
  })
})
