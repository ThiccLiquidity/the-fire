/** Holo, drawn by the studio over a card's normal frame and art (no holo images: Holo Playground, approved Oct 2026).
 *  Rainbow holo: diagonal colour bands that run in the foil, fine foil lines, glitter, sparkles that each catch the
 *  light at their own angle, and a glare. Gold (the Gold card): gold leaf flakes and the same holo in gold over the
 *  picture, and only a band of light across the frame. Every effect is drawn at a tilt (tx, ty: -1..1, the light's
 *  position across the card; o: 0..1, how strongly it catches); a saved image uses STILL_TILT. Everything is seeded,
 *  so the same card always renders the same pixels. Canvas 2D only (main thread or worker). */

import { CARD_H, CARD_W } from './rules'
import type { Rect } from './types'
import type { Ctx2D } from './wear'

export interface Tilt { tx: number; ty: number; o: number }

/** A saved image: the light from the upper left, fully catching. */
export const STILL_TILT: Tilt = { tx: -0.4, ty: -0.4, o: 1 }

/** The effects were tuned on a 750 px wide card; sizes in px scale from that. */
const S = CARD_W / 750

type Canvas2D = OffscreenCanvas
const mk = (w: number, h: number): Canvas2D => new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
const ctxOf = (c: Canvas2D) => c.getContext('2d') as OffscreenCanvasRenderingContext2D

function rng(seed: number): () => number {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

interface Speck { x: number; y: number; ax: number; ay: number; j: number; star: boolean; size: number }
function makeSpecks(seed: number, n: number): Speck[] {
  const r = rng(seed)
  const out: Speck[] = []
  for (let i = 0; i < n; i++) {
    const k = r()
    out.push({ x: r(), y: r(), ax: r() * 2 - 1, ay: r() * 2 - 1, j: r(), star: k < 0.09, size: k < 0.09 ? 5 + r() * 9 : 0.8 + r() * 1.6 })
  }
  return out
}
const SPECKS = makeSpecks(11, 650)
const FRAME_SPECKS = makeSpecks(23, 900)

const RAINBOW = ['#c0306a', '#c08a2a', '#b8b430', '#2fb86a', '#2aa6c0', '#5a4ac0']
const GOLD = { c: ['#5c3a08', '#c48a1c', '#ffd862', '#fff4c8'], h: 44, s: 100, l: 62 }

let cache: { glitter: Canvas2D; glitterGold: Canvas2D; scan: Canvas2D; leaf: Map<string, Canvas2D>; frameMasks: WeakMap<object, Canvas2D> } | null = null
function assets() {
  if (cache) return cache
  const glitter = (gold: boolean) => {
    const c = mk(180, 180), g = ctxOf(c), r = rng(7)
    for (let i = 0; i < 420; i++) {
      const a = 0.3 + r() * 0.7, z = r() < 0.85 ? 1 : 2
      g.fillStyle = gold ? `hsla(${GOLD.h + (r() - 0.5) * 14},100%,${62 + r() * 30}%,${a})` : `hsla(${Math.floor(r() * 360)},100%,${70 + r() * 30}%,${a})`
      g.fillRect(Math.floor(r() * 180), Math.floor(r() * 180), z, z)
    }
    return c
  }
  const scan = mk(4, 3)
  const sg = ctxOf(scan)
  sg.fillStyle = '#fff'
  sg.fillRect(0, 0, 4, 1)
  cache = { glitter: glitter(false), glitterGold: glitter(true), scan, leaf: new Map(), frameMasks: new WeakMap() }
  return cache
}

/** A repeating band gradient across box b at CSS angle a (degrees), one cycle every `period` px, slid by `phase` cycles. */
function bands(g: Ctx2D, b: Rect, a: number, period: number, phase: number, stops: [number, string][]): CanvasGradient {
  const t = (a * Math.PI) / 180, dx = Math.sin(t), dy = -Math.cos(t), cx = b.x + b.w / 2, cy = b.y + b.h / 2, n = 8
  const sx = cx - dx * period * (n / 2 - (phase % 1)), sy = cy - dy * period * (n / 2 - (phase % 1))
  const gr = g.createLinearGradient(sx, sy, sx + dx * period * n, sy + dy * period * n)
  for (let r = 0; r < n; r++) for (const [o, c] of stops) gr.addColorStop(Math.min(1, (r + o) / n), c)
  return gr
}

const phaseOf = (tl: Tilt) => (tl.tx + 1) * 0.9 + (tl.ty + 1) * 0.45

function pattern(g: Ctx2D, tile: Canvas2D, tl: Tilt, k: number): CanvasPattern | null {
  const p = g.createPattern(tile, 'repeat')
  p?.setTransform(new DOMMatrix().translate(-tl.tx * 60 * S, -tl.ty * 60 * S).scale(k))
  return p
}

function specks(g: Ctx2D, list: Speck[], b: Rect, tl: Tilt, k: number, strength: number, gold: boolean): void {
  for (const s of list) {
    const L = Math.exp(-((s.ax - tl.tx) ** 2 + (s.ay - tl.ty) ** 2) * (s.star ? 3 : 4)) * strength
    if (L < 0.03) continue
    const x = b.x + s.x * b.w, y = b.y + s.y * b.h, z = s.size * k, a = Math.min(1, L)
    // rainbow sparkles take the foil's colour where they sit (diagonal bands that shift with the tilt); gold stays gold
    const hue = gold ? GOLD.h + (s.j - 0.5) * 12 + (tl.tx + tl.ty) * 5 : (s.x * 520 + s.y * 190 + (tl.tx + tl.ty) * 160 + s.j * 90) % 360
    const sat = gold ? GOLD.s : 100, lt = gold ? Math.min(96, GOLD.l + L * 18) : 62 + L * 10, c = `hsla(${hue},${sat}%,${lt}%,${a})`
    g.fillStyle = c
    g.strokeStyle = c
    if (s.star) {
      g.lineWidth = Math.max(0.7 * S, z * 0.13)
      g.beginPath()
      g.moveTo(x - z, y); g.lineTo(x + z, y); g.moveTo(x, y - z); g.lineTo(x, y + z)
      g.moveTo(x - z * 0.4, y - z * 0.4); g.lineTo(x + z * 0.4, y + z * 0.4); g.moveTo(x + z * 0.4, y - z * 0.4); g.lineTo(x - z * 0.4, y + z * 0.4)
      g.stroke()
      const rg = g.createRadialGradient(x, y, 0, x, y, z * 0.55)
      rg.addColorStop(0, `hsla(${hue + (gold ? 0 : 40)},${sat}%,90%,${a})`)
      rg.addColorStop(1, `hsla(${hue},${sat}%,60%,0)`)
      g.fillStyle = rg
      g.fillRect(x - z, y - z, z * 2, z * 2)
    } else g.fillRect(x - z / 2, y - z / 2, Math.max(S, z), Math.max(S, z))
  }
}

/** The foil's own texture over box b: colour bands (dodged into what's below), fine lines, glitter, sparkles. */
function foil(g: Ctx2D, b: Rect, tl: Tilt, list: Speck[], gold: boolean, opts: { k?: number; per?: number; sp?: number } = {}): void {
  const { k = 1, per = 0.9, sp = 1 } = opts
  const a = assets()
  const [d, m, br, h] = GOLD.c
  g.save()
  g.globalCompositeOperation = 'color-dodge'
  g.globalAlpha = (0.32 + tl.o * 0.4) * k
  g.fillStyle = bands(g, b, 110, Math.hypot(b.w, b.h) * per, phaseOf(tl), gold
    ? [[0, '#000'], [0.21, '#000'], [0.28, d], [0.36, m], [0.43, br], [0.48, h], [0.52, br], [0.6, m], [0.67, d], [0.75, '#000'], [1, '#000']]
    : [[0, '#000'], [0.18, '#000'], [0.27, RAINBOW[0]], [0.345, RAINBOW[1]], [0.42, RAINBOW[2]], [0.495, RAINBOW[3]], [0.57, RAINBOW[4]], [0.645, RAINBOW[5]], [0.75, '#000'], [1, '#000']])
  g.fillRect(b.x, b.y, b.w, b.h)
  g.globalAlpha = 0.035
  g.fillStyle = pattern(g, a.scan, { tx: 0, ty: 0, o: 0 }, S) ?? '#0000'
  g.fillRect(b.x, b.y, b.w, b.h)
  g.globalAlpha = 0.1 + tl.o * 0.3
  g.fillStyle = pattern(g, gold ? a.glitterGold : a.glitter, tl, S) ?? '#0000'
  g.fillRect(b.x, b.y, b.w, b.h)
  g.globalAlpha = 1
  g.globalCompositeOperation = 'screen'
  specks(g, list, b, tl, (b.w / 300) * 0.55 * sp, (0.6 + tl.o * 0.6) * sp, gold)
  g.restore()
}

/** The light on the plastic: a soft spot where the light is, darker away from it. */
function glare(g: Ctx2D, b: Rect, tl: Tilt, warm: boolean): void {
  g.save()
  g.globalCompositeOperation = 'overlay'
  g.globalAlpha = 0.3 + tl.o * 0.45
  const mx = (CARD_W * (tl.tx + 1)) / 2, my = (CARD_H * (tl.ty + 1)) / 2, rr = Math.hypot(CARD_W, CARD_H)
  const rg = g.createRadialGradient(mx, my, 0, mx, my, rr * 0.75)
  rg.addColorStop(0, warm ? 'rgba(255,250,230,.6)' : 'rgba(255,255,255,.6)')
  rg.addColorStop(0.22, warm ? 'rgba(255,240,200,.18)' : 'rgba(255,255,255,.18)')
  rg.addColorStop(0.9, 'rgba(0,0,0,.25)')
  g.fillStyle = rg
  g.fillRect(b.x, b.y, b.w, b.h)
  g.restore()
}

/** Gold leaf: torn flakes scattered over the picture (fixed, so every Gold card has the same leaf). */
function leafFor(w: number, h: number): Canvas2D {
  const a = assets()
  const key = `${w}x${h}`
  const hit = a.leaf.get(key)
  if (hit) return hit
  const c = mk(w, h), q = ctxOf(c), r = rng(99)
  q.fillStyle = '#000'
  for (let f = 0; f < 320; f++) {
    const cx = r() * w, cy = r() * h, R = (r() < 0.08 ? 9 + r() * 9 : 1.5 + r() * 5.5) * (w / 597), k = 7 + Math.floor(r() * 6), rot = r() * 6.3
    q.beginPath()
    for (let v = 0; v < k; v++) {
      const ang = rot + (v / k) * 6.283, rr = R * (0.45 + r() * 0.75)
      if (v) q.lineTo(cx + Math.cos(ang) * rr * 1.3, cy + Math.sin(ang) * rr)
      else q.moveTo(cx + Math.cos(ang) * rr * 1.3, cy + Math.sin(ang) * rr)
    }
    q.closePath()
    q.fill()
  }
  a.leaf.set(key, c)
  return c
}

/** Run fx on a copy of the card so far and lay it back down only where `keep` paints (destination-in). */
function within(ctx: Ctx2D, fx: (q: OffscreenCanvasRenderingContext2D) => void, keep: (q: OffscreenCanvasRenderingContext2D) => void): void {
  const c = mk(CARD_W, CARD_H), q = ctxOf(c)
  q.drawImage(ctx.canvas, 0, 0)
  fx(q)
  q.globalCompositeOperation = 'destination-in'
  q.globalAlpha = 1
  keep(q)
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.drawImage(c, 0, 0)
  ctx.restore()
}

const keepRect = (b: Rect) => (q: OffscreenCanvasRenderingContext2D) => { q.fillStyle = '#000'; q.fillRect(b.x, b.y, b.w, b.h) }

/** Where the frame is: its own pixels, without the art window (cached per frame image). */
function frameMask(frame: CanvasImageSource & object, art: Rect): Canvas2D {
  const a = assets()
  const hit = a.frameMasks.get(frame)
  if (hit) return hit
  const c = mk(CARD_W, CARD_H), q = ctxOf(c)
  q.drawImage(frame, 0, 0, CARD_W, CARD_H)
  q.globalCompositeOperation = 'destination-out'
  q.fillRect(art.x, art.y, art.w, art.h)
  a.frameMasks.set(frame, c)
  return c
}

const WHOLE: Rect = { x: 0, y: 0, w: CARD_W, h: CARD_H }

/** Rainbow holo on the picture (art window `art`). Goes on after the art, before the frame. */
export function pictureHolo(ctx: Ctx2D, art: Rect, tl: Tilt = STILL_TILT): void {
  within(ctx, (q) => { foil(q, art, tl, SPECKS, false); glare(q, art, tl, false) }, keepRect(art))
}

/** Rainbow holo on the frame: everywhere the frame is, outside the picture. Goes on after the frame, before the text. */
export function frameHolo(ctx: Ctx2D, frame: CanvasImageSource & object, art: Rect, tl: Tilt = STILL_TILT): void {
  const mask = frameMask(frame, art)
  // the frame is thin: bands twice as close so colour always runs through it, and bigger, brighter sparkles
  within(ctx, (q) => { foil(q, WHOLE, tl, FRAME_SPECKS, false, { per: 0.45, sp: 1.35 }); glare(q, WHOLE, tl, false) }, (q) => q.drawImage(mask, 0, 0))
}

/** Rainbow holo over the whole card (Full Art), kept inside the card's outline (`outline` paints it). */
export function cardHolo(ctx: Ctx2D, outline: (q: OffscreenCanvasRenderingContext2D) => void, tl: Tilt = STILL_TILT): void {
  within(ctx, (q) => { foil(q, WHOLE, tl, FRAME_SPECKS, false); glare(q, WHOLE, tl, false) }, (q) => { q.fillStyle = '#000'; outline(q); q.fill() })
}

/** The Gold card's picture: gold leaf whose shine slides with the tilt, then the holo in gold. */
export function goldPicture(ctx: Ctx2D, art: Rect, tl: Tilt = STILL_TILT): void {
  const [d, m, br, h] = GOLD.c
  within(ctx, (q) => {
    const leaf = leafFor(art.w, art.h)
    const f = mk(art.w, art.h), fq = ctxOf(f)
    fq.fillStyle = bands(fq, { x: 0, y: 0, w: art.w, h: art.h }, 115, art.w * 0.9, phaseOf(tl), [[0, d], [0.25, m], [0.42, br], [0.5, h], [0.58, br], [0.75, m], [1, d]])
    fq.fillRect(0, 0, art.w, art.h)
    fq.globalCompositeOperation = 'destination-in'
    fq.drawImage(leaf, 0, 0)
    q.save()
    q.shadowColor = 'rgba(60,35,5,.8)'
    q.shadowBlur = S
    q.drawImage(f, art.x, art.y)
    q.restore()
    foil(q, art, tl, SPECKS, true)
    glare(q, art, tl, true)
  }, keepRect(art))
}

/** The Gold card's frame: no foil, only its metal catching the light as a soft band that slides across it. */
export function goldFrameShine(ctx: Ctx2D, frame: CanvasImageSource & object, art: Rect, tl: Tilt = STILL_TILT): void {
  const mask = frameMask(frame, art)
  within(ctx, (q) => {
    q.save()
    q.globalCompositeOperation = 'soft-light'
    q.globalAlpha = 0.5 + tl.o * 0.5
    q.fillStyle = bands(q, WHOLE, 115, Math.hypot(CARD_W, CARD_H) * 1.6, (tl.tx + 1) * 0.55 + (tl.ty + 1) * 0.25,
      [[0, 'rgba(255,236,170,0)'], [0.38, 'rgba(255,236,170,0)'], [0.48, 'rgba(255,240,190,.95)'], [0.5, 'rgba(255,250,225,1)'], [0.52, 'rgba(255,240,190,.95)'], [0.62, 'rgba(255,236,170,0)'], [1, 'rgba(255,236,170,0)']])
    q.fillRect(0, 0, CARD_W, CARD_H)
    q.restore()
  }, (q) => q.drawImage(mask, 0, 0))
}
