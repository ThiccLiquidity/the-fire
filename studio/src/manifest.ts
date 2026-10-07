/** manifest.json inside a Series' images folder: what the folder holds and what it was built for, so anyone with the
 *  folder (a gateway, a pin, the offline CAR) can check it. ops/series/verify-series.mjs reads it before the Series is
 *  locked.
 *
 *  { version: 1, fire, gridKey, recipeHash, count, files: [{ name, size, sha256 }] }
 *  - gridKey: the studio's fingerprint of the recipe's looks and the characters (series.ts buildGridKey)
 *  - recipeHash: sha256 of JSON.stringify({ fire, types, slots, characters }) of the recipe.json the studio
 *    exports (imagesBase and the sale block left out: they come later), the same hash VerifySeries computes
 *  - files: every image (not manifest.json itself), with its size and sha256 */

import { sha256Hex } from './prng'
import type { RecipeJson } from './recipe'

export const MANIFEST_NAME = 'manifest.json'

export interface ManifestFile { name: string; size: number; sha256: string }
export interface Manifest { version: 1; fire: number; gridKey: string; recipeHash: string; count: number; files: ManifestFile[] }

export function recipeHash(j: RecipeJson): string {
  return sha256Hex(JSON.stringify({ fire: j.fire, types: j.types, slots: j.slots, characters: j.characters }))
}

async function fileSha256(blob: Blob): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('')
}

/** Hashes every file (one at a time, so memory stays flat) and returns manifest.json as a file for the folder. */
export async function buildManifest(
  fire: number, gridKey: string, recipe: RecipeJson, files: { name: string; blob: Blob }[], onEach?: (done: number, total: number) => void,
): Promise<{ name: string; blob: Blob; manifest: Manifest }> {
  const out: ManifestFile[] = []
  for (const f of files) {
    if (f.name === MANIFEST_NAME) throw new Error('An image is named manifest.json.')
    out.push({ name: f.name, size: f.blob.size, sha256: await fileSha256(f.blob) })
    onEach?.(out.length, files.length)
  }
  const manifest: Manifest = { version: 1, fire, gridKey, recipeHash: recipeHash(recipe), count: out.length, files: out }
  return { name: MANIFEST_NAME, blob: new Blob([JSON.stringify(manifest, null, 1)], { type: 'application/json' }), manifest }
}
