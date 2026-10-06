/** Cases and slabs (docs/grading.md): the finished card drawn inside a clear case (cased, ungraded) or a slab with its
 *  grade label (graded). Drawn in code, the same for every card, on top of the finished card image: the locked frames
 *  are never touched. Geometry and look are the owner-approved mock (slim top-loader case; slab with a short label).
 *  Canvas 2D only (main thread or worker). */

import { CARD_H, CARD_W, GRADE_COLOR, wearLookOf } from './rules'
import type { Ctx2D } from './wear'
import type { ImgSrc } from './render'

/** What the slab label shows. */
export interface SlabLabel {
  characterName: string
  /** "Series 6 · Wood" or "Series 6 · Fire · Full Holo". */
  sub: string
  grade: number
}

/** The grade's word on the slab label. */
export const GRADE_WORD: Record<number, string> = {
  10: 'GEM MINT', 9: 'MINT', 8: 'NM-MT', 7: 'NEAR MINT', 6: 'EX-MT', 5: 'EXCELLENT', 4: 'VG-EX', 3: 'VERY GOOD', 2: 'GOOD', 1: 'POOR',
}

const LABEL_FONT = '"Russo One", "Arial Black", sans-serif'
const W = CARD_W
const H = CARD_H

interface Box { x0: number; y0: number; x1: number; y1: number }

function rr(ctx: Ctx2D, b: Box, r: number): void {
  ctx.beginPath()
  ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, r)
}

function fill(ctx: Ctx2D, b: Box, r: number, color: string, blur = 0): void {
  ctx.save()
  if (blur) ctx.filter = `blur(${blur}px)`
  rr(ctx, b, r)
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

/** An outline drawn inside the box, `width` wide (like the mock's PIL outlines). */
function rim(ctx: Ctx2D, b: Box, r: number, width: number, color: string, blur = 0): void {
  ctx.save()
  if (blur) ctx.filter = `blur(${blur}px)`
  const h = width / 2
  rr(ctx, { x0: b.x0 + h, y0: b.y0 + h, x1: b.x1 - h, y1: b.y1 - h }, Math.max(0, r - h))
  ctx.lineWidth = width
  ctx.strokeStyle = color
  ctx.stroke()
  ctx.restore()
}

/** Two soft diagonal light bands and a brighter top, clipped to the plastic. */
function glare(ctx: Ctx2D, body: Box, r: number, strength: number): void {
  ctx.save()
  rr(ctx, body, r)
  ctx.clip()
  // t = (0.55 x + y) / (0.55 W + H), as a gradient along (0.55, 1)
  const K = 0.55 * W + H
  const d = K / (0.55 * 0.55 + 1)
  const g = ctx.createLinearGradient(0, 0, 0.55 * d, d)
  const band = (t: number) =>
    38 * Math.exp(-(((t - 0.22) / 0.035) ** 2)) + 30 * Math.exp(-(((t - 0.3) / 0.012) ** 2)) + 18 * Math.exp(-(((t - 0.71) / 0.05) ** 2))
  for (let i = 0; i <= 200; i++) {
    const t = i / 200
    g.addColorStop(t, `rgba(255,255,255,${Math.min(1, (band(t) * strength) / 255).toFixed(4)})`)
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const top = ctx.createLinearGradient(0, 0, 0, H * 0.35)
  top.addColorStop(0, `rgba(255,255,255,${((10 * strength) / 255).toFixed(4)})`)
  top.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, W, H * 0.35)
  ctx.restore()
}

/** Where the card goes at scale `s`, centred, top at `top`. */
function place(s: number, top: number): Box {
  const w = Math.round(W * s)
  const h = Math.round(H * s)
  const x0 = Math.round(W / 2 - w / 2)
  return { x0, y0: top, x1: x0 + w, y1: top + h }
}

/** Case geometry (the card fills about 96%). */
export const CASE = { body: { x0: 6, y0: 6, x1: W - 7, y1: H - 7 }, radius: 58, scale: 0.958 }
/** Slab geometry (label on top; the card fills about 87% of the width). */
export const SLAB = { body: { x0: 6, y0: 6, x1: W - 7, y1: H - 7 }, radius: 50, label: { x0: 34, y0: 30, x1: W - 34, y1: 206 }, scale: 0.868, top: 244 }

/** The card, cased: clear plastic body, the card slightly inside it, rims and glare. Clears `ctx` first. */
export function drawCase(ctx: Ctx2D, card: ImgSrc): void {
  const { body, radius: R, scale: s } = CASE
  const cb = place(s, Math.round((H - H * s) / 2))
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  fill(ctx, body, R, 'rgba(214,228,240,0.30)')
  fill(ctx, { x0: cb.x0 + 4, y0: cb.y0 + 10, x1: cb.x1 + 4, y1: cb.y1 + 14 }, 44, 'rgba(0,0,0,0.47)', 14)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(card, cb.x0, cb.y0, cb.x1 - cb.x0, cb.y1 - cb.y0)
  rim(ctx, { x0: cb.x0 - 6, y0: cb.y0 - 6, x1: cb.x1 + 6, y1: cb.y1 + 6 }, 48, 3, 'rgba(255,255,255,0.47)')
  rim(ctx, { x0: cb.x0 - 9, y0: cb.y0 - 9, x1: cb.x1 + 9, y1: cb.y1 + 9 }, 50, 2, 'rgba(40,60,80,0.35)')
  glare(ctx, body, R, 1)
  rim(ctx, body, R, 7, 'rgba(255,255,255,0.78)', 1.2)
  rim(ctx, { x0: body.x0 + 10, y0: body.y0 + 10, x1: body.x1 - 10, y1: body.y1 - 10 }, R - 10, 3, 'rgba(255,255,255,0.27)')
  rim(ctx, body, R, 2, 'rgba(60,80,100,0.63)')
  ctx.restore()
}

function text(ctx: Ctx2D, s: string, x: number, y: number, size: number, color: string, align: 'left' | 'right' = 'left'): number {
  ctx.font = `400 ${size}px ${LABEL_FONT}`
  ctx.textBaseline = 'top'
  ctx.textAlign = align
  ctx.fillStyle = color
  ctx.fillText(s, x, y)
  return ctx.measureText(s).width
}

function drawLabel(ctx: Ctx2D, b: Box, label: SlabLabel): void {
  fill(ctx, { x0: b.x0 + 4, y0: b.y0 + 8, x1: b.x1 + 4, y1: b.y1 + 10 }, 22, 'rgba(0,0,0,0.35)', 10)
  fill(ctx, b, 18, 'rgb(246,238,220)')
  rim(ctx, b, 18, 6, 'rgb(176,132,52)')
  rim(ctx, { x0: b.x0 + 12, y0: b.y0 + 12, x1: b.x1 - 12, y1: b.y1 - 12 }, 10, 2, 'rgba(176,132,52,0.63)')
  const color = GRADE_COLOR[wearLookOf(label.grade) as Exclude<ReturnType<typeof wearLookOf>, 'clean'>]
  ctx.save()
  text(ctx, 'OMNI CARDS', b.x0 + 40, b.y0 + 26, 30, 'rgb(150,108,38)')
  // the name and the line under it shrink to stay clear of the grade
  const room = b.x1 - b.x0 - 40 - 300
  fitText(ctx, label.characterName, b.x0 + 40, b.y0 + 60, 52, room, 'rgb(40,30,22)')
  fitText(ctx, label.sub, b.x0 + 42, b.y0 + 124, 26, room, 'rgb(120,100,76)')
  const gw = text(ctx, String(label.grade), b.x1 - 44, b.y0 + 22, 108, color, 'right')
  text(ctx, 'PDA', b.x1 - 44 - gw - 16, b.y0 + 50, 36, 'rgb(40,30,22)', 'right')
  text(ctx, GRADE_WORD[label.grade] ?? '', b.x1 - 44, b.y0 + 130, 26, color, 'right')
  ctx.restore()
}

function fitText(ctx: Ctx2D, s: string, x: number, y: number, size: number, maxW: number, color: string): void {
  let px = size
  ctx.font = `400 ${px}px ${LABEL_FONT}`
  while (px > 12 && ctx.measureText(s).width > maxW) {
    px -= 1
    ctx.font = `400 ${px}px ${LABEL_FONT}`
  }
  text(ctx, s, x, y + (size - px) / 2, px, color)
}

/** The card, slabbed: a thick clear block, a frosted well the card sits in, the grade label on top, rims and glare.
 *  Clears `ctx` first. */
export function drawSlab(ctx: Ctx2D, card: ImgSrc, label: SlabLabel): void {
  const { body, radius: R, label: lab, scale: s, top } = SLAB
  const cb = place(s, top)
  const win = { x0: cb.x0 - 14, y0: cb.y0 - 14, x1: cb.x1 + 14, y1: cb.y1 + 14 }
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  fill(ctx, body, R, 'rgba(200,214,228,0.62)')
  fill(ctx, win, 40, 'rgba(235,242,248,0.55)')
  fill(ctx, { x0: cb.x0 + 6, y0: cb.y0 + 14, x1: cb.x1 + 6, y1: cb.y1 + 18 }, 40, 'rgba(0,0,0,0.55)', 16)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(card, cb.x0, cb.y0, cb.x1 - cb.x0, cb.y1 - cb.y0)
  drawLabel(ctx, lab, label)
  rim(ctx, win, 40, 4, 'rgba(70,90,110,0.67)')
  rim(ctx, { x0: win.x0 + 5, y0: win.y0 + 5, x1: win.x1 - 5, y1: win.y1 - 5 }, 36, 3, 'rgba(255,255,255,0.67)')
  for (let i = 0; i < 5; i++) {
    const y = 214 + i * 2
    ctx.beginPath()
    ctx.moveTo(110, y + 1)
    ctx.lineTo(W - 110, y + 1)
    ctx.lineWidth = 2
    ctx.strokeStyle = `rgba(255,255,255,${i % 2 ? 0.24 : 0.1})`
    ctx.stroke()
  }
  glare(ctx, body, R, 1.25)
  rim(ctx, body, R, 9, 'rgba(255,255,255,0.59)', 1.5)
  rim(ctx, { x0: body.x0 + 14, y0: body.y0 + 14, x1: body.x1 - 14, y1: body.y1 - 14 }, R - 12, 3, 'rgba(255,255,255,0.35)')
  rim(ctx, body, R, 2, 'rgba(50,70,90,0.78)')
  ctx.restore()
}
