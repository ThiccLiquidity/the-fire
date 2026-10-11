import { describe, expect, it } from 'vitest'
import { fitReport } from './fullartGuide'

describe('fitReport (a photo on the 1500 x 2100 Full Art card)', () => {
  it('passes the card shape at full size', () => {
    expect(fitReport(1500, 2100)).toEqual({ shapeOk: true, cut: null, upscalePct: 0 })
    expect(fitReport(3000, 4200).shapeOk).toBe(true)
  })
  it('flags a 2:3 image (ChatGPT portrait): its top and bottom are cut, and it is stretched', () => {
    const r = fitReport(1024, 1536)
    expect(r.shapeOk).toBe(false)
    expect(r.cut?.sides).toBe('top and bottom')
    expect(r.cut?.px).toBe(150) // 1536 x (1500 / 1024) = 2250, 150 px past 2100
    expect(r.upscalePct).toBe(46)
  })
  it('flags a square image: its left and right are cut', () => {
    const r = fitReport(2100, 2100)
    expect(r.cut).toEqual({ sides: 'left and right', px: 600, pct: 29 })
    expect(r.upscalePct).toBe(0)
  })
})
