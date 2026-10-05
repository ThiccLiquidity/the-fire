/** The studio's recipe checks and pool maths (src/recipe.ts) against the contract (RecipeDealer.check and
 *  previewPool), on recipes in the exact recipe.json shape the studio exports and ConfigureSeries.s.sol reads.
 *
 *  scripts/fixtures/recipe-parity.json holds the cases and the contract's answers. Refresh it with
 *  scripts/contract-parity.sh (needs forge): it writes the cases (WRITE_RECIPE_CASES=<dir>), runs
 *  scripts/forge/StudioParity.t.sol on a scratch copy of contracts/, and stores the results here. Case 0 is the
 *  Standard export (the forge side also checks it parses to StandardRecipe.build(1) and that ConfigureSeries.build
 *  accepts it); case 1 the Special 3-card all-holo export. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  checkRecipe, previewPool, recipeFromJson, recipeJson, specialAllHoloRecipe, standardRecipe, type RecipeJson,
} from '../src/recipe'

const FIXTURE = new URL('./fixtures/recipe-parity.json', import.meta.url)
const PACKS = ['0', '1', '2', '3', '5', '7', '13', '100', '999', '1000003', '1099511627776']

type Case = RecipeJson & { packs: string[] }
interface Result { ok: boolean; error?: string; perPack?: number; pools?: string[][]; calls?: number }

/** Deterministic random recipes: mostly the shapes people make (rank ranges, single types), some invalid. */
function cases(): Case[] {
  let x = 20261005
  const rnd = (n: number) => { x = (x * 1103515245 + 12345) % 2147483648; return Math.floor((x / 2147483648) * n) }
  const chance = (p: number) => rnd(1000) < p * 1000
  const chars = [{ name: 'Ember Fox', category: 'Animals' }, { name: 'Ash Wolf', category: 'Animals' }]
  const out: Case[] = [
    { ...recipeJson(7, standardRecipe(1), chars, 'ipfs://bafyexampleimages/'), packs: PACKS },
    { ...recipeJson(8, specialAllHoloRecipe(), chars), packs: PACKS },
  ]
  for (let k = 0; k < 400; k++) {
    const T = 1 + rnd(7)
    const filler = rnd(T)
    const types: RecipeJson['types'] = []
    for (let t = 0; t < T; t++) {
      let supply: RecipeJson['types'][number]['supply'] = t === filler ? 'filler' : (['share', 'perPack', 'count'] as const)[rnd(3)]
      if (chance(0.02)) supply = 'filler'
      if (t === filler && chance(0.02)) supply = 'count'
      const amount = supply === 'share' ? (chance(0.02) ? 1_000_000_001 : rnd(400_000_000)) : supply === 'perPack' ? rnd(4) : rnd(60)
      const mode = chance(0.7) ? 'independent' : 'distribution'
      const ch = () => String(chance(0.15) ? 0 : chance(0.1) ? 10n ** 18n : BigInt(rnd(1_000_000)) * 10n ** 12n)
      types.push({
        name: chance(0.01) ? 'Bad"Name' : `Type ${t}`,
        slug: chance(0.01) ? 'Bad Slug' : chance(0.01) && t > 0 ? `t${t - 1}` : `t${t}`,
        rank: rnd(6), supply,
        ...(supply !== 'filler' ? { amount } : {}),
        ...(chance(0.25) ? { maxPerPack: 1 + rnd(3) } : {}),
        holo: mode === 'independent'
          ? { mode, frame: ch(), picture: ch() }
          : { mode, weights: [0, 0, 0, 0].map(() => String(chance(0.4) ? 0 : rnd(5))) },
      })
    }
    const G = 1 + rnd(4)
    const slots: RecipeJson['slots'] = []
    for (let s = 0; s < G; s++) {
      const count = chance(0.03) ? 0 : 1 + rnd(4)
      const mustHolo = chance(0.2) ? { mustHolo: true } : {}
      if (chance(0.45)) {
        const n = chance(0.6) ? 1 : 1 + rnd(Math.min(3, T))
        const set = new Set<number>()
        while (set.size < n) set.add(rnd(T))
        slots.push({ count, types: [...set].sort((a, b) => a - b), ...mustHolo })
      } else {
        const minRank = rnd(6)
        slots.push({ count, minRank, ...(chance(0.3) ? { maxRank: minRank > 0 && chance(0.1) ? minRank - 1 : minRank + rnd(4) } : {}), ...mustHolo })
      }
    }
    if (chance(0.5)) slots.push({ count: 1, minRank: 0 }) // a catch-all group: every type is dealt somewhere
    out.push({ fire: 100 + k, types, slots, characters: chars, pdaOdds: ['1', '1', '1', '1', '1', '1', '1', '1', '1', '1'], packs: PACKS })
  }
  return out
}

describe.runIf(process.env.WRITE_RECIPE_CASES)('write recipe cases', () => {
  it('writes <dir>/<i>.json', () => {
    const dir = process.env.WRITE_RECIPE_CASES!
    mkdirSync(dir, { recursive: true })
    cases().forEach((c, i) => writeFileSync(`${dir}/${i}.json`, JSON.stringify(c)))
    writeFileSync(`${dir}/cases.json`, JSON.stringify(cases()))
  })
})

describe.runIf(!process.env.WRITE_RECIPE_CASES && existsSync(FIXTURE))('recipe parity with RecipeDealer', () => {
  const fx = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: Case[]; results: Result[] }) : { cases: [], results: [] }

  it('has the contract\'s answers for every case', () => {
    expect(fx.results.length).toBe(fx.cases.length)
    expect(fx.cases.length).toBeGreaterThan(300)
    expect(fx.results.filter((r) => r.ok).length).toBeGreaterThan(50)
    expect(fx.results.filter((r) => !r.ok).length).toBeGreaterThan(50)
  })

  it('the Standard and Special exports go through ConfigureSeries and check()', () => {
    expect(fx.results[0]).toMatchObject({ ok: true, perPack: 6, calls: 5 }) // setRecipe, setCharacters, setDealer, setImagesBase, setOdds
    expect(fx.results[1]).toMatchObject({ ok: true, perPack: 3 })
  })

  it('same verdict (and the same first reason) and the same pools for every pack count', () => {
    fx.cases.forEach((c, i) => {
      const want = fx.results[i]
      const problems = checkRecipe(recipeFromJson(c)).filter((p) => p.code !== 'Studio' && p.code !== 'BadOdds' && p.code !== 'Infeasible')
      if (!want.ok) {
        expect(problems[0]?.code, `case ${i}`).toBe(want.error)
        return
      }
      expect(problems, `case ${i}`).toEqual([])
      const r = recipeFromJson(c)
      c.packs.forEach((p, k) => {
        expect(previewPool(r, BigInt(p)).map(String), `case ${i}, ${p} packs`).toEqual(want.pools![k])
      })
    })
  })
})
