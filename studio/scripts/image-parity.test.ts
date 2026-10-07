/** Image-name parity: the studio's image grid (looks.ts seriesGrid: holoLooksFor x STATES, named by lookFileName) must
 *  be exactly the set of files the contract can ever point a card at (CardsRenderer.imageName for every card
 *  RecipeDealer can deal, in every state).
 *
 *  This test picks recipes from scripts/fixtures/recipe-parity.json (the Standard and Special exports, then valid
 *  recipes with must-holo groups, certain holo and zero weights), and keeps their grids in
 *  contracts/test/cards/image-parity/<i>.json (the recipe.json) and <i>.files.json (the studio's file names).
 *  contracts/test/cards/ImageParity.t.sol reads them: every name CardsRenderer.imageName gives for what the dealer can
 *  deal is in the studio's list and the counts match (so the two sets are equal), and every card it actually deals
 *  (in every state) has its image in the list.
 *
 *  Run with WRITE_IMAGE_PARITY=1 to rewrite those files after a change to the studio's grid; otherwise this test
 *  fails if they don't match what the studio builds today. */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { seriesGrid, STATES } from '../src/looks'
import { cardsPerPack, checkRecipe, recipeFromJson, type RecipeJson } from '../src/recipe'

const FIXTURE = new URL('./fixtures/recipe-parity.json', import.meta.url)
const DIR = new URL('../../contracts/test/cards/image-parity/', import.meta.url)

type Case = RecipeJson & { packs?: string[] }

function pick(): RecipeJson[] {
  const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { cases: Case[]; results: { ok: boolean }[] }
  const strip = ({ packs: _packs, ...c }: Case): RecipeJson => c
  const out = [strip(fx.cases[0]), strip(fx.cases[1])]
  const interesting = (c: RecipeJson) =>
    c.slots.some((s) => s.mustHolo) ||
    c.types.some((t) => t.holo.mode === 'independent' ? [t.holo.frame, t.holo.picture].some((x) => x === '0' || x === '1000000000000000000') : t.holo.weights.some((w) => w === '0'))
  for (let i = 2; i < fx.cases.length && out.length < 16; i++) {
    const c = strip(fx.cases[i])
    if (!fx.results[i].ok || !interesting(c)) continue
    const r = recipeFromJson(c)
    if (checkRecipe(r).some((p) => p.code !== 'Studio' && p.code !== 'BadOdds') || cardsPerPack(r) > 12) continue
    out.push(c)
  }
  return out
}

function grid(c: RecipeJson): string[] {
  return seriesGrid(c.fire, c.characters.map((_, i) => `char${i}`), recipeFromJson(c)).map((g) => g.file)
}

describe('image-name parity (studio grid vs CardsRenderer.imageName)', () => {
  const cases = pick()

  it('picks the Standard, the Special and at least 10 edge recipes', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12)
    expect(cases.some((c) => c.slots.some((s) => s.mustHolo))).toBe(true)
  })

  it('every grid name has the contract\'s shape and appears once', () => {
    for (const c of cases) {
      const files = grid(c)
      expect(new Set(files).size).toBe(files.length)
      for (const f of files) expect(f).toMatch(/^c\d+-[a-z0-9-]+-(none|frame|picture|full)-(u|c|[1-9]|10)\.webp$/)
      expect(files.length % STATES.length).toBe(0)
    }
  })

  if (process.env.WRITE_IMAGE_PARITY) {
    it('writes contracts/test/cards/image-parity/', () => {
      if (existsSync(DIR)) rmSync(DIR, { recursive: true })
      mkdirSync(DIR, { recursive: true })
      cases.forEach((c, i) => {
        writeFileSync(new URL(`${i}.json`, DIR), `${JSON.stringify(c)}\n`)
        writeFileSync(new URL(`${i}.files.json`, DIR), `${JSON.stringify({ files: grid(c) })}\n`)
      })
    })
  } else {
    it('the files the contract test reads are what the studio builds today (else: WRITE_IMAGE_PARITY=1)', () => {
      expect(existsSync(DIR)).toBe(true)
      expect(readdirSync(DIR).filter((f) => f.endsWith('.files.json')).length).toBe(cases.length)
      cases.forEach((c, i) => {
        expect(JSON.parse(readFileSync(new URL(`${i}.json`, DIR), 'utf8')), `case ${i} recipe`).toEqual(c)
        expect(JSON.parse(readFileSync(new URL(`${i}.files.json`, DIR), 'utf8')).files, `case ${i} files`).toEqual(grid(c))
      })
    })
  }
})
