/** Magenta chroma key: turns a flat #FF00FF-ish background into transparency with soft edges.
 *
 *  1. Alpha from two measures, keeping the more opaque one:
 *     - RGB distance to pure magenta: below `tolerance` fully transparent, then a linear ramp over `feather` units.
 *     - "magenta excess" k = min(R, B) - G (255 for pure magenta, 0 for any grey): fully transparent when
 *       k >= 255 - tolerance, ramping to opaque at k <= 255 - tolerance - feather. This is the classic colour-difference
 *       key; it keeps pink/peach art (high green) opaque that a pure distance key would eat.
 *     Anti-aliased edge pixels (art blended with magenta) land on the ramp.
 *  2. Un-mix: for a partially transparent pixel, observed = a * art + (1 - a) * magenta, so the art colour is
 *     recovered as (observed - (1 - a) * magenta) / a. This removes most of the pink halo.
 *  3. Despill: in pixels on or next to the soft edge, any magenta cast left (red and blue both above green) is pulled
 *     back toward green by `despill` (0-1). Opaque interior pixels are untouched, so pink/purple art survives.
 *  Pure function on RGBA bytes so it can be unit tested. */

export interface KeyOptions {
  tolerance: number
  feather: number
  despill: number
}

export const DEFAULT_KEY: KeyOptions = { tolerance: 70, feather: 90, despill: 0.85 }

export function keyMagentaPixels(data: Uint8ClampedArray, width: number, height: number, opts: KeyOptions): void {
  const n = width * height
  const tol = Math.max(0, opts.tolerance)
  const feather = Math.max(1, opts.feather)
  const alpha = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const r = data[o], g = data[o + 1], b = data[o + 2]
    const dr = 255 - r, db = 255 - b
    const dist = Math.sqrt(dr * dr + g * g + db * db)
    const aDist = (dist - tol) / feather
    const aK = (255 - tol - (Math.min(r, b) - g)) / feather
    const a = Math.min(1, Math.max(0, aDist, aK))
    alpha[i] = a
    if (a > 0 && a < 1) {
      // un-mix the magenta background out of the edge colour
      const inv = 1 - a
      data[o] = (r - inv * 255) / a
      data[o + 1] = g / a
      data[o + 2] = (b - inv * 255) / a
    }
  }
  const strength = Math.min(1, Math.max(0, opts.despill))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const a = alpha[i]
      const o = i * 4
      if (a <= 0) {
        data[o] = data[o + 1] = data[o + 2] = 0
        data[o + 3] = 0
        continue
      }
      let edge = a < 1
      if (!edge && strength > 0) {
        for (let dy = -2; dy <= 2 && !edge; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= height) continue
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= width) continue
            if (alpha[yy * width + xx] < 1) { edge = true; break }
          }
        }
      }
      if (edge && strength > 0) {
        const r = data[o], g = data[o + 1], b = data[o + 2]
        const m = Math.min(r, b)
        if (m > g) {
          const e = (m - g) * strength
          data[o] = r - e
          data[o + 2] = b - e
        }
      }
      data[o + 3] = Math.round(data[o + 3] * a)
    }
  }
}

/** Key an image blob, returning a PNG with transparency. Browser only (OffscreenCanvas). */
export async function keyMagentaBlob(src: Blob, opts: KeyOptions): Promise<Blob> {
  const bmp = await createImageBitmap(src)
  const canvas = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas unavailable')
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  keyMagentaPixels(img.data, img.width, img.height, opts)
  ctx.putImageData(img, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}
