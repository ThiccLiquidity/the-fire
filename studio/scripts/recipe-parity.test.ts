/** The studio's recipe checks and odds (src/recipe.ts) against the contract (RecipeDealer.check, oddsOf and holoOdds),
 *  on recipes in the exact recipe.json shape the studio exports and ConfigureSeries.s.sol reads.
 *
 *  scripts/fixtures/recipe-parity.json holds the cases and the contract's answers. Refresh it with
 *  scripts/contract-parity.sh (needs forge): it writes the cases (WRITE_RECIPE_CASES=<dir>), runs
 *  scripts/forge/StudioParity.t.sol on a scratch copy of contracts/, and stores the results here. Case 0 is the
 *  Standard export (the forge side also checks it parses to StandardRecipe.build() and that ConfigureSeries.build
 *  accepts it); case 1 the Special 3-card all-holo export. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  checkRecipe, holoOdds, recipeFromJson, recipeJson, specialAllHoloRecipe, standardRecipe, typeWeights, type RecipeJson,
} from '../src/recipe'

const FIXTURE = new URL('./fixtures/recipe-parity.json', import.meta.url)

type Case = RecipeJson
interface Result { ok: boolean; error?: string; perPack?: number; weights?: string[]; total?: string; holo?: string[][]; calls?: number }

/** Deterministic random recipes: mostly valid shapes, some invalid. */
function cases(): Case[] {
  let x = 20261024
  const rnd = (n: number) => { x = (x * 1103515245 + 12345) % 2147483648; return Math.floor((x / 2147483648) * n) }
  const chance = (p: number) => rnd(1000) < p * 1000
  const chars = [{ name: 'Ember Fox', category: 'Animals' }, { name: 'Ash Wolf', category: 'Animals' }]
  const out: Case[] = [
    recipeJson(7, standardRecipe(), chars, 'ipfs://bafyexampleimages/'),
    recipeJson(8, specialAllHoloRecipe(), chars),
  ]
  for (let k = 0; k < 400; k++) {
    const T = chance(0.02) ? 0 : 1 + rnd(7)
    const types: RecipeJson['types'] = []
    for (let t = 0; t < T; t++) {
      const weight = chance(0.03) ? 0 : chance(0.1) ? String(BigInt(1 + rnd(1_000_000)) * 10n ** 12n) : 1 + rnd(10_000)
      const mode = chance(0.7) ? 'independent' : 'distribution'
      const ch = () => String(chance(0.15) ? 0 : chance(0.1) ? 10n ** 18n : chance(0.01) ? 10n ** 18n + 1n : BigInt(rnd(1_000_000)) * 10n ** 12n)
      types.push({
        name: chance(0.01) ? 'Bad"Name' : chance(0.005) ? '' : `Type ${t}`,
        slug: chance(0.01) ? 'Bad Slug' : chance(0.01) && t > 0 ? `t${t - 1}` : `t${t}`,
        rank: rnd(6), weight,
        holo: mode === 'independent'
          ? { mode, frame: ch(), picture: ch() }
          : { mode, weights: [0, 0, 0, 0].map(() => String(chance(0.4) ? 0 : rnd(5))) },
      })
    }
    const cardsPerPack = chance(0.03) ? 0 : chance(0.02) ? 1001 : chance(0.05) ? 1000 : 1 + rnd(12)
    out.push({ fire: 100 + k, cardsPerPack, types, characters: chars })
  }
  return out
}

describe.runIf(process.env.WRITE_RECIPE_CASES)('write recipe cases', () => {
  it('writes <dir>/<i>.json', () => {
    const dir = process.env.WRITE_RECIPE_CASES!
    mkdirSync(dir, { recursive: true })
    // the recipe.json exactly as exported (ConfigureSeries refuses unknown keys)
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
    expect(fx.results[0]).toMatchObject({ ok: true, perPack: 6, calls: 4 }) // setRecipe, setCharacters, setDealer, setImagesBase
    expect(fx.results[1]).toMatchObject({ ok: true, perPack: 3 })
  })

  it('same verdict (and the same first reason), the same weights and the same holo odds', () => {
    fx.cases.forEach((c, i) => {
      const want = fx.results[i]
      const problems = checkRecipe(recipeFromJson(c)).filter((p) => p.code !== 'Studio')
      if (!want.ok) {
        expect(problems[0]?.code, `case ${i}`).toBe(want.error)
        return
      }
      expect(problems, `case ${i}`).toEqual([])
      const r = recipeFromJson(c)
      expect(want.perPack, `case ${i}`).toBe(r.cardsPerPack)
      const { weights, total } = typeWeights(r)
      expect(weights.map(String), `case ${i}`).toEqual(want.weights)
      expect(String(total), `case ${i}`).toBe(want.total)
      r.types.forEach((t, k) => {
        const o = holoOdds(t)
        want.holo![k].forEach((v, h) => expect(Math.abs(Number(v) / 1e18 - o[h]), `case ${i}, type ${k}`).toBeLessThan(1e-12))
      })
    })
  })
})
