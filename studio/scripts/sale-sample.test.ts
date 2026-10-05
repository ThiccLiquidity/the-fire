/** The sample recipe.json (Standard recipe + Standard sale, as the studio exports it) that
 *  contracts/test/cards/Sale.t.sol (test_studioSaleExportConfiguresTheDrop) runs through ConfigureSeries.s.sol and
 *  FireSale.configureDrop. Refresh it with WRITE_SALE_SAMPLE=1 npx vitest run scripts/sale-sample.test.ts. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recipeJson, standardRecipe } from '../src/recipe'
import { saleJson, standardSale } from '../src/sale'

const SAMPLE = new URL('../../contracts/test/cards/recipe-studio-sale.json', import.meta.url)

function sampleExport() {
  const chars = [
    { name: 'Ember Fox', category: 'Animals' }, { name: 'Ash Wolf', category: 'Animals' }, { name: 'Cinder Queen', category: 'Royals' },
  ]
  const sale = saleJson({ ...standardSale(), start: 1_900_000_000, holderRoot: '0x' + 'ab'.repeat(32) })
  return recipeJson(7, standardRecipe(1), chars, 'ipfs://bafyexampleimages/', sale)
}

describe.runIf(process.env.WRITE_SALE_SAMPLE)('write the sample export', () => {
  it('writes contracts/test/cards/recipe-studio-sale.json', () => {
    writeFileSync(SAMPLE, JSON.stringify(sampleExport(), null, 1) + '\n')
  })
})

describe.runIf(!process.env.WRITE_SALE_SAMPLE && existsSync(SAMPLE))('the sample export the forge test parses', () => {
  it('is what the studio exports today', () => {
    expect(JSON.parse(readFileSync(SAMPLE, 'utf8'))).toEqual(sampleExport())
  })
})
