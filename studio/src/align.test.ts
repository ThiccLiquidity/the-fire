import { describe, expect, it } from 'vitest'
import { matchImages, placementToMatch, type Gray } from './align'

/** A "drawing": smooth blobs and some outlined circles, deterministic. */
function drawing(w: number, h: number): Gray {
  const px = new Float32Array(w * h)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const circles = Array.from({ length: 14 }, () => ({ x: rnd() * w, y: rnd() * h, r: 10 + rnd() * w * 0.12, v: 60 + rnd() * 180 }))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 40 + 30 * Math.sin(x / 23) * Math.cos(y / 31)
      for (const c of circles) {
        const d = Math.hypot(x - c.x, y - c.y)
        if (d < c.r) v = c.v
        if (Math.abs(d - c.r) < 2) v = 10
      }
      px[y * w + x] = v
    }
  }
  return { w, h, px }
}

/** The same drawing as an image generator might return it: scaled by k, shifted, a different size, colours changed. */
function redraw(src: Gray, k: number, ox: number, oy: number, w: number, h: number): Gray {
  const px = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // holo pixel (x, y) shows source pixel ((x - ox) / k, (y - oy) / k)
      const sx = Math.round((x - ox) / k), sy = Math.round((y - oy) / k)
      const v = sx >= 0 && sy >= 0 && sx < src.w && sy < src.h ? src.px[sy * src.w + sx] : 0
      px[y * w + x] = 255 - v * 0.8 + 20 * Math.sin(x / 9) // "rainbow": inverted, tinted, stripes
    }
  }
  return { w, h, px }
}

describe('Match normal', () => {
  it('finds a holo that came back bigger and shifted', () => {
    const normal = drawing(400, 400)
    // holo pixel = 1.2 x normal pixel + (-30, -10): so normal pixel = holo / 1.2 + (25, 8.33)
    const holo = redraw(normal, 1.2, -30, -10, 460, 460)
    const m = matchImages(normal, holo)
    expect(m.s).toBeCloseTo(1 / 1.2, 1)
    expect(Math.abs(m.tx - 25)).toBeLessThan(4)
    expect(Math.abs(m.ty - 10 / 1.2)).toBeLessThan(4)
    expect(m.confidence).toBeGreaterThan(0.3)
  }, 30_000)

  it('turns the match into the holo placement that lines it up', () => {
    const box = { w: 1244, h: 1244 }
    // same picture, holo just twice the pixels: no zoom, no move
    const r = placementToMatch({ s: 0.5, tx: 0, ty: 0, confidence: 1 }, { w: 1000, h: 1000 }, { w: 2000, h: 2000 }, box)
    expect(r).toEqual({ placement: { zoom: 1, x: 0, y: 0 }, ok: true })
    // holo drawn smaller inside its picture (normal = 1.25 x holo - 125): the holo zooms in 25% to match
    const z = placementToMatch({ s: 1.25, tx: -125, ty: -125, confidence: 1 }, { w: 1000, h: 1000 }, { w: 1000, h: 1000 }, box)
    expect(z.placement.zoom).toBeCloseTo(1.25, 3)
    expect(z.placement.x).toBe(0)
    expect(z.ok).toBe(true)
  })
})
