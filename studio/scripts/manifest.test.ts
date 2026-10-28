import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildManifest, recipeHash } from '../src/manifest'
import type { RecipeJson } from '../src/recipe'

const standard = JSON.parse(readFileSync(new URL('../../contracts/test/cards/recipe-standard.json', import.meta.url), 'utf8')) as RecipeJson

describe('manifest.json', () => {
  it('recipe hash: the value ops/series/verify-series.mjs computes for the same recipe.json', () => {
    // the same constant is asserted in ops/series/verify-series.test.mjs
    expect(recipeHash(standard)).toBe('0ba2257fcb65378888bf7037d08bc73f81a7703beb12ac616bfd84b02b65c166')
    expect(recipeHash({ ...standard, imagesBase: 'ipfs://x/' })).toBe(recipeHash(standard))
  })

  it('lists every file with its size and sha256, plus the grid key and recipe hash', async () => {
    const files = [{ name: 'c0-wood-none-u.webp', blob: new Blob(['abc']) }, { name: 'c0-wood-none-c.webp', blob: new Blob(['']) }]
    const m = await buildManifest(7, 'gridkey123', standard, files)
    expect(m.name).toBe('manifest.json')
    const j = JSON.parse(await m.blob.text())
    expect(j).toMatchObject({ version: 1, fire: 7, gridKey: 'gridkey123', recipeHash: recipeHash(standard), count: 2 })
    expect(j.files[0]).toEqual({ name: 'c0-wood-none-u.webp', size: 3, sha256: createHash('sha256').update('abc').digest('hex') })
    expect(j.files[1].sha256).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    await expect(buildManifest(7, 'k', standard, [{ name: 'manifest.json', blob: new Blob([]) }])).rejects.toThrow(/manifest.json/)
  })
})
