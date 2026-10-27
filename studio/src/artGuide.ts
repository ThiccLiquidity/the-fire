/** Art helpers: the templates to hand an image generator (Full Art: card size, card shape, where the text prints; a
 *  frame's art window: the square), the size check run on every uploaded image, and the outlines drawn over the
 *  placement preview. */

import { CARD_H, CARD_W } from './rules'
import type { Layout, Rect } from './types'

const INSET = 8
const RADIUS = 93
/** How far in the PDA wear reaches at its worst: keep faces and key detail inside it. */
export const WEAR_MARGIN = 60

export interface FitReport {
  /** The photo is the card's shape (5:7) within 1%. */
  shapeOk: boolean
  /** Which sides lose picture when it's fitted to the card, and how much of the card's width or height that is. */
  cut: { sides: 'left and right' | 'top and bottom'; px: number; pct: number } | null
  /** Stretched up by this much to fill the card (0 = sharp, full size or bigger). */
  upscalePct: number
}

/** What happens to a w x h image in a box (default the whole 1500 x 2100 card; a frame's art window is 1244 x 1244):
 *  it's scaled to cover the box, centred. */
export function fitReport(w: number, h: number, box: { w: number; h: number } = { w: CARD_W, h: CARD_H }): FitReport {
  const target = box.w / box.h
  const r = w / h
  const scale = Math.max(box.w / w, box.h / h)
  const upscalePct = Math.max(0, Math.round((scale - 1) * 100))
  if (Math.abs(r / target - 1) <= 0.01) return { shapeOk: true, cut: null, upscalePct }
  if (r > target) {
    const px = Math.round(w * scale - box.w)
    return { shapeOk: false, cut: { sides: 'left and right', px, pct: Math.round((px / (w * scale)) * 100) }, upscalePct }
  }
  const px = Math.round(h * scale - box.h)
  return { shapeOk: false, cut: { sides: 'top and bottom', px, pct: Math.round((px / (h * scale)) * 100) }, upscalePct }
}

export interface Zone { rect: Rect; label: string }

/** Where the card's print goes on a Full Art card: the name at the top; the theme, art style, the small type ·
 *  category · Series row and the PDA seal at the bottom. */
export function textZones(layout: Layout): Zone[] {
  const pad = 14
  const grow = (r: Rect): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad })
  const bottom = [layout.text.theme.box, layout.text.style.box, layout.text.material.box, layout.text.category.box, layout.text.forged.box, layout.psa.box]
  const x0 = Math.min(...bottom.map((r) => r.x)), y0 = Math.min(...bottom.map((r) => r.y))
  const x1 = Math.max(...bottom.map((r) => r.x + r.w)), y1 = Math.max(...bottom.map((r) => r.y + r.h))
  return [
    { rect: grow(layout.text.name.box), label: 'NAME PRINTS HERE' },
    { rect: grow({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }), label: 'THEME · ART STYLE · TYPE · SERIES · PDA SEAL' },
  ]
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Outlines of the print zones and the wear margin, in card coordinates (scale the context first for a small view). */
export function drawZones(ctx: Ctx, layout: Layout, labels = true): void {
  ctx.save()
  ctx.lineWidth = 6
  ctx.setLineDash([24, 16])
  ctx.strokeStyle = 'rgba(255, 210, 60, 0.95)'
  ctx.beginPath()
  ctx.roundRect(WEAR_MARGIN, WEAR_MARGIN, CARD_W - 2 * WEAR_MARGIN, CARD_H - 2 * WEAR_MARGIN, Math.max(0, RADIUS - WEAR_MARGIN))
  ctx.stroke()
  for (const z of textZones(layout)) {
    ctx.fillStyle = 'rgba(255, 60, 60, 0.28)'
    ctx.fillRect(z.rect.x, z.rect.y, z.rect.w, z.rect.h)
    ctx.strokeStyle = 'rgba(255, 70, 70, 0.95)'
    ctx.strokeRect(z.rect.x, z.rect.y, z.rect.w, z.rect.h)
    if (labels) {
      ctx.setLineDash([])
      ctx.font = '700 40px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineWidth = 8
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
      ctx.strokeText(z.label, z.rect.x + z.rect.w / 2, z.rect.y + z.rect.h / 2)
      ctx.fillStyle = '#fff'
      ctx.fillText(z.label, z.rect.x + z.rect.w / 2, z.rect.y + z.rect.h / 2)
      ctx.lineWidth = 6
      ctx.setLineDash([24, 16])
    }
  }
  ctx.restore()
}

/** The template image (1500 x 2100 PNG): the card's exact size and rounded shape, the print zones to keep clear of
 *  faces and detail, and the wear margin. Hand it to the image generator with the prompt. */
export async function fullArtTemplateBlob(layout: Layout): Promise<Blob> {
  const c = new OffscreenCanvas(CARD_W, CARD_H)
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  g.fillStyle = '#9a9aa2'
  g.fillRect(0, 0, CARD_W, CARD_H)
  g.fillStyle = '#d9d9de'
  g.beginPath()
  g.roundRect(INSET, INSET, CARD_W - 2 * INSET, CARD_H - 2 * INSET, RADIUS)
  g.fill()
  drawZones(g, layout)
  g.fillStyle = '#2a2a30'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const lines: [string, number][] = [
    ['FULL ART CARD', 76],
    ['1500 x 2100 px  ·  portrait 5:7', 44],
    ['The art fills the whole card, edge to edge', 38],
    ['Rounded corners are trimmed', 38],
    ['Red: text prints here, keep faces and detail out', 38],
    ['Yellow line: edge wear reaches this far', 38],
  ]
  let y = CARD_H / 2 - 240
  for (const [t, size] of lines) {
    g.font = `${size >= 70 ? 800 : 600} ${size}px system-ui, sans-serif`
    g.fillText(t, CARD_W / 2, y)
    y += size * 1.9
  }
  return c.convertToBlob({ type: 'image/png' })
}

/** The template for art that goes in a frame's window (a square, 1244 x 1244 PNG). */
export async function windowTemplateBlob(box: { w: number; h: number }): Promise<Blob> {
  const c = new OffscreenCanvas(box.w, box.h)
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')
  g.fillStyle = '#d9d9de'
  g.fillRect(0, 0, box.w, box.h)
  g.lineWidth = 6
  g.setLineDash([24, 16])
  g.strokeStyle = 'rgba(255, 210, 60, 0.95)'
  g.strokeRect(40, 40, box.w - 80, box.h - 80)
  g.fillStyle = '#2a2a30'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const lines: [string, number][] = [
    ['CARD ART', 72],
    [`${box.w} x ${box.h} px  ·  square 1:1`, 44],
    ['Fills the frame\'s art window, edge to edge', 38],
    ['Keep the character inside the yellow line', 38],
  ]
  let y = box.h / 2 - 160
  for (const [t, size] of lines) {
    g.font = `${size >= 70 ? 800 : 600} ${size}px system-ui, sans-serif`
    g.fillText(t, box.w / 2, y)
    y += size * 1.9
  }
  return c.convertToBlob({ type: 'image/png' })
}
