import { describe, expect, it, vi } from 'vitest'
import { CARD_OUTLINE, PDA10_SPARKLES, cardView, drawBase, drawCard, drawPrint, drawTiltPart, type CardAssets, type ImgSrc } from './render'
import type { Ctx2D } from './wear'
import { CARD_H, CARD_W } from './rules'
import { FRAME_GEOMETRY } from './frames'
import { defaultLayout } from './layoutDefaults'
import type { Rect } from './types'

const card = (grade: number | null) => ({ frameSet: 'paper', typeName: 'Paper', grade, fire: 1 })

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

/** A fake 2D context that logs every call and assignment, so drawing sequences can be compared without a real canvas.
 *  OffscreenCanvas is stubbed with the same recorder, so the drawn holo (holoFx.ts) and the PDA 10 glow run too. */
function recording(run: (ctx: Ctx2D) => void): string[] {
  const log: string[] = []
  let n = 0
  const fmt = (v: unknown): string => typeof v === 'function' ? 'fn'
    : v && typeof v === 'object' ? String((v as { __name?: string }).__name ?? '<obj>') : String(v)
  const rec = (tag: string): unknown => {
    const t: Record<string, unknown> = {}
    return new Proxy(t, {
      get(_t, prop) {
        if (prop === '__name') return tag
        if (typeof prop === 'symbol' || prop === 'then') return undefined
        if (prop in t) return t[prop]
        if (prop === 'canvas') return { width: CARD_W, height: CARD_H }
        if (prop === 'measureText') {
          return (s: string) => {
            log.push(`${tag}.measureText(${s})`)
            return { width: s.length * 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: s.length * 10, actualBoundingBoxAscent: 70, actualBoundingBoxDescent: 10 }
          }
        }
        return (...args: unknown[]) => {
          log.push(`${tag}.${prop}(${args.map(fmt).join(',')})`)
          if (prop === 'save' || prop === 'restore') return undefined
          return rec(`${tag}.${prop}#${n++}`)
        }
      },
      set(_t, prop, v) {
        log.push(`${tag}.${String(prop)}=${fmt(v)}`)
        t[prop as string] = v
        return true
      },
    })
  }
  class FakeOffscreen {
    width: number
    height: number
    __name: string
    constructor(w: number, h: number) { this.width = w; this.height = h; this.__name = `oc${n++}` }
    getContext() { return rec(this.__name) }
  }
  class FakeMatrix {
    translate() { return this }
    scale() { return this }
    rotate() { return this }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreen)
  vi.stubGlobal('DOMMatrix', FakeMatrix)
  try {
    run(rec('ctx') as Ctx2D)
  } finally {
    vi.unstubAllGlobals()
  }
  return log
}

const img = (name: string) => ({ width: CARD_W, height: CARD_H, __name: name }) as unknown as ImgSrc
const assets: CardAssets = { frame: img('FRAME'), art: img('ART'), wear: img('WEAR') }
const view = (frameSet: string, grade: number | null, holo = true) =>
  cardView({ frameSet, typeName: frameSet, grade, fire: 3, holoFrame: holo, holoPicture: holo }, 'Rabbit', 'Animals', { theme: 'Haunted Carnival', style: 'Ink Wash' })
/** The root context's calls, without save/restore (the split adds one pair; it changes no pixel). */
const root = (log: string[]) => log.filter((l) => l.startsWith('ctx.') && !/^ctx\.(save|restore)\(\)$/.test(l))

describe('drawCard = drawBase (holo) + drawPrint', () => {
  for (const frameSet of ['paper', 'gold', 'fullart']) {
    for (const grade of [null, 4, 10]) {
      it(`${frameSet}, grade ${grade ?? 'none'}: the same drawing, in the same order`, () => {
        const layout = defaultLayout(frameSet)
        const v = view(frameSet, grade)
        recording((ctx) => drawCard(ctx, assets, layout, v)) // fills holoFx's tile cache, so both runs below start alike
        const whole = recording((ctx) => drawCard(ctx, assets, layout, v))
        const split = recording((ctx) => { drawBase(ctx, assets, layout, v, { holo: true }); drawPrint(ctx, assets, layout, v) })
        expect(whole.some((l) => l.startsWith('oc'))).toBe(true) // the holo was drawn (on offscreen canvases)
        expect(root(split)).toEqual(root(whole))
        expect(split.filter((l) => !l.startsWith('ctx.'))).toEqual(whole.filter((l) => !l.startsWith('ctx.')))
      })
    }
  }

  it('plain: art and frame only, no holo, no text, no seal, no wear', () => {
    for (const frameSet of ['paper', 'gold', 'fullart']) {
      const layout = defaultLayout(frameSet)
      const log = recording((ctx) => drawTiltPart(ctx, assets, layout, view(frameSet, 10), 'plain'))
      const draws = log.filter((l) => l.startsWith('ctx.drawImage('))
      expect(draws.some((l) => l.includes('ART'))).toBe(true)
      if (frameSet !== 'fullart') expect(draws.some((l) => l.includes('FRAME'))).toBe(true)
      expect(log.some((l) => l.startsWith('oc'))).toBe(false) // no holo, no PDA 10 glow (both draw on an offscreen canvas)
      expect(log.some((l) => /fillText|strokeText|WEAR/.test(l))).toBe(false)
    }
  })

  it('print: no art or frame on the card, but the texts, the seal, the wear and the PDA 10 glow', () => {
    // Coal: its text draws straight on the card (Paper's pencil and Wood's burn use their own small canvases)
    const layout = defaultLayout('charcoal')
    const log = recording((ctx) => drawTiltPart(ctx, assets, layout, view('charcoal', 10), 'print'))
    const r = root(log)
    expect(r[0]).toBe(`ctx.clearRect(0,0,${CARD_W},${CARD_H})`)
    expect(r.some((l) => l.startsWith('ctx.drawImage(ART') || l.startsWith('ctx.drawImage(FRAME'))).toBe(false)
    expect(r.some((l) => l.startsWith('ctx.drawImage(WEAR'))).toBe(true)
    expect(r.some((l) => l.startsWith('ctx.drawImage(oc'))).toBe(true) // the PDA 10 glow
    const texts = r.filter((l) => l.startsWith('ctx.fillText(')).map((l) => l.slice('ctx.fillText('.length).split(',')[0].toUpperCase())
    for (const t of ['RABBIT', 'HAUNTED CARNIVAL', 'INK WASH', 'CHARCOAL', '  ·  ANIMALS', '  ·  SERIES 3', 'PDA', '10']) expect(texts).toContain(t)
    expect(view('charcoal', 9).pda10).toBe(false)
    const nine = recording((ctx) => drawTiltPart(ctx, assets, layout, view('charcoal', 9), 'print'))
    expect(root(nine).some((l) => l.startsWith('ctx.drawImage(oc'))).toBe(false)
  })
})
