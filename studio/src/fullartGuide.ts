/** Full Art helpers: the template to hand an image generator (card size, card shape, where the text prints), the size
 *  check run on every uploaded photo, and the outlines drawn over the placement preview. */

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

/** What happens to a w x h photo on a 1500 x 2100 card (it's scaled to cover the card, centred). */
export function fitReport(w: number, h: number): FitReport {
  const target = CARD_W / CARD_H
  const r = w / h
  const scale = Math.max(CARD_W / w, CARD_H / h)
  const upscalePct = Math.max(0, Math.round((scale - 1) * 100))
  if (Math.abs(r / target - 1) <= 0.01) return { shapeOk: true, cut: null, upscalePct }
  if (r > target) {
    const px = Math.round(w * scale - CARD_W)
    return { shapeOk: false, cut: { sides: 'left and right', px, pct: Math.round((px / (w * scale)) * 100) }, upscalePct }
  }
  const px = Math.round(h * scale - CARD_H)
  return { shapeOk: false, cut: { sides: 'top and bottom', px, pct: Math.round((px / (h * scale)) * 100) }, upscalePct }
}

export interface Zone { rect: Rect; label: string }

/** Where the card's print goes on a Full Art card: the name at the top, the type, category, Series and PDA seal at
 *  the bottom. */
export function textZones(layout: Layout): Zone[] {
  const pad = 14
  const grow = (r: Rect): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad })
  const bottom = [layout.text.material.box, layout.text.category.box, layout.text.forged.box, layout.psa.box]
  const x0 = Math.min(...bottom.map((r) => r.x)), y0 = Math.min(...bottom.map((r) => r.y))
  const x1 = Math.max(...bottom.map((r) => r.x + r.w)), y1 = Math.max(...bottom.map((r) => r.y + r.h))
  return [
    { rect: grow(layout.text.name.box), label: 'NAME PRINTS HERE' },
    { rect: grow({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }), label: 'TYPE · CATEGORY · SERIES · PDA SEAL' },
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
