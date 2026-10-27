import { describe, expect, it } from 'vitest'
import { defaultLayout, lockPositions, normalizeLayout } from './layoutDefaults'

describe('text positions are fixed on every frame set', () => {
  it('a saved layout with moved boxes and other alignments comes back in the standard spots', () => {
    const d = defaultLayout('burning')
    const moved = {
      ...d,
      text: {
        ...d.text,
        name: { ...d.text.name, box: { x: 10, y: 900, w: 300, h: 50 }, style: { ...d.text.name.style, align: 'left' as const, size: 140, font: 'Anton' } },
        category: { ...d.text.category, box: { x: 600, y: 100, w: 200, h: 40 }, style: { ...d.text.category.style, align: 'right' as const } },
      },
      psa: { ...d.psa, box: { x: 0, y: 0, w: 50, h: 50 } },
      art: { ...d.art, scale: 1.4, offsetX: 90 },
    }
    for (const l of [lockPositions(moved), normalizeLayout('burning', moved)]) {
      expect(l.text.name.box).toEqual(d.text.name.box)
      expect(l.text.name.style.align).toBe('center')
      expect(l.text.name.style.size).toBe(140) // the look stays the owner's
      expect(l.text.name.style.font).toBe('Anton')
      expect(l.text.category.box).toEqual(d.text.category.box)
      expect(l.text.category.style.align).toBe('left')
      expect(l.psa.box).toEqual(d.psa.box)
      expect(l.art).toMatchObject({ scale: 1, offsetX: 0, offsetY: 0, fit: 'cover' })
    }
  })
})

describe('v4 -> v5: theme and art style big, type · category · Series # small', () => {
  it('a v4 layout gets the theme and art style lines in its own font and colours, and the small row', () => {
    const d = defaultLayout('wood')
    const { theme: _t, style: _s, ...oldText } = d.text
    const v4 = {
      ...d, version: 4,
      text: {
        ...oldText,
        material: { ...d.text.material, style: { ...d.text.material.style, font: 'Anton', color: '#112233', size: 96 } },
        category: { ...d.text.category, style: { ...d.text.category.style, font: 'Bangers', color: '#445566', size: 58 } },
      },
    }
    const l = normalizeLayout('wood', v4 as never)
    expect(l.version).toBe(5)
    expect(l.text.theme.style).toMatchObject({ font: 'Anton', color: '#112233', size: d.text.theme.style.size })
    expect(l.text.style.style).toMatchObject({ font: 'Bangers', color: '#445566', size: d.text.style.style.size })
    expect(l.text.material.style).toMatchObject({ font: 'Anton', size: 40 })
    expect(l.text.category.box).toEqual(d.text.material.box)
    expect(l.text.theme.style.size).toBeGreaterThan(l.text.material.style.size * 2 - 1)
  })
})
