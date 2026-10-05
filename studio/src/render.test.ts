import { describe, expect, it } from 'vitest'
import { CARD_OUTLINE, PDA10_SPARKLES, cardView } from './render'
import { CARD_H, CARD_W } from './rules'
import { FRAME_GEOMETRY } from './frames'
import { defaultLayout } from './layoutDefaults'
import type { Rect } from './types'

const card = (grade: number | null) => ({ material: 'paper' as const, grade, fire: 1 })

describe('PDA 10 effect', () => {
  it('is on for grade 10 only', () => {
    expect(cardView(card(10), 'Rabbit').pda10).toBe(true)
    for (const g of [null, 1, 2, 5, 8, 9]) expect(cardView(card(g), 'Rabbit').pda10).toBe(false)
  })

  it('sparkles are fixed, 4-6 of them, inside the card and clear of the name bar, art and seal', () => {
    expect(PDA10_SPARKLES.length).toBeGreaterThanOrEqual(4)
    expect(PDA10_SPARKLES.length).toBeLessThanOrEqual(6)
    const seal = defaultLayout('paper').psa.box
    const keepOut: Rect[] = [FRAME_GEOMETRY.nameBar, FRAME_GEOMETRY.art, FRAME_GEOMETRY.infoPanel, seal]
    const o = CARD_OUTLINE.inset
    for (const s of PDA10_SPARKLES) {
      expect(s.x - s.r).toBeGreaterThanOrEqual(o)
      expect(s.y - s.r).toBeGreaterThanOrEqual(o)
      expect(s.x + s.r).toBeLessThanOrEqual(CARD_W - o)
      expect(s.y + s.r).toBeLessThanOrEqual(CARD_H - o)
      for (const b of keepOut) {
        const clear = s.x + s.r <= b.x || s.x - s.r >= b.x + b.w || s.y + s.r <= b.y || s.y - s.r >= b.y + b.h
        expect(clear, `${s.x},${s.y}`).toBe(true)
      }
    }
  })
})
