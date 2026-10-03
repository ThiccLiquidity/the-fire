/** Writes contracts/test/cards/pool-fixture.json (run with WRITE_POOL_FIXTURE=1) so the contract's port of computePool
 *  is checked against this exact implementation over a long chain of Fires. */
import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import { computePool, zeroAccumulators, type Accumulators } from '../src/deal'
import { MATERIALS } from '../src/rules'

describe.runIf(process.env.WRITE_POOL_FIXTURE)('pool fixture', () => {
  it('writes the fixture', () => {
    let acc: Accumulators = zeroAccumulators()
    let x = 12345
    const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x }
    const rows = []
    for (let i = 0; i < 300; i++) {
      const packs = i < 12 ? [1, 2, 3, 0, 1, 5, 7, 150, 151, 999, 4, 2][i] : 1 + (rnd() % 600)
      const p = computePool(acc, packs)
      rows.push({ packs, before: MATERIALS.map((m) => acc[m]), counts: MATERIALS.map((m) => p.counts[m]), after: MATERIALS.map((m) => p.after[m]) })
      acc = p.after
    }
    writeFileSync(new URL('../../contracts/test/cards/pool-fixture.json', import.meta.url), JSON.stringify({ rows }))
  })
})
