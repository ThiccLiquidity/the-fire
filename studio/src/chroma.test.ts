import { describe, expect, it } from 'vitest'
import { DEFAULT_KEY, keyMagentaPixels } from './chroma'

function px(...rgba: number[][]): Uint8ClampedArray {
  return new Uint8ClampedArray(rgba.flat())
}

describe('keyMagentaPixels', () => {
  it('makes magenta transparent, keeps art opaque, softens the blend', () => {
    // a 1x4 strip: pure magenta, slightly-off magenta, 50/50 white+magenta, white
    const d = px([255, 0, 255, 255], [250, 12, 244, 255], [255, 128, 255, 255], [255, 255, 255, 255])
    keyMagentaPixels(d, 4, 1, DEFAULT_KEY)
    expect(d[3]).toBe(0)
    expect(d[7]).toBe(0)
    expect(d[11]).toBeGreaterThan(20)
    expect(d[11]).toBeLessThan(255)
    // the edge pixel's colour is un-mixed toward white, not pink
    expect(d[9]).toBeGreaterThan(180)
    expect(d[8] - d[9]).toBeLessThan(30)
    expect(d[15]).toBe(255)
    expect([d[12], d[13], d[14]]).toEqual([255, 255, 255])
  })

  it('leaves opaque interior colours alone, even pink', () => {
    const w = 7
    const d = new Uint8ClampedArray(w * w * 4)
    for (let i = 0; i < w * w; i++) d.set([230, 120, 200, 255], i * 4)
    keyMagentaPixels(d, w, w, DEFAULT_KEY)
    expect(Array.from(d.slice(0, 4))).toEqual([230, 120, 200, 255])
  })
})
