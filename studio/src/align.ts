/** "Match normal": finds how a character's holo art lines up with its normal art (the same drawing, but the image
 *  generator returns it at another size or shifted), so the holo can be framed to sit exactly like the normal one.
 *  Works on edge maps (the holo's rainbow changes colours, not outlines), coarse to fine: a wide search on small
 *  copies, then a close one on bigger copies. Pure functions on grey pixel arrays, so it's testable without a canvas. */

import type { Placement } from './types'

export interface Gray { w: number; h: number; px: Float32Array }

/** RGBA bytes to grey (alpha-weighted, so keyed-out background reads as black). */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const px = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255
    px[i] = (0.3 * rgba[i * 4] + 0.59 * rgba[i * 4 + 1] + 0.11 * rgba[i * 4 + 2]) * a
  }
  return { w, h, px }
}

function sample(g: Gray, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y)
  if (x0 < 0 || y0 < 0 || x0 >= g.w - 1 || y0 >= g.h - 1) return NaN
  const fx = x - x0, fy = y - y0, i = y0 * g.w + x0
  return (g.px[i] * (1 - fx) + g.px[i + 1] * fx) * (1 - fy) + (g.px[i + g.w] * (1 - fx) + g.px[i + g.w + 1] * fx) * fy
}

/** Shrink so the longer side is `n` px (box average, so small copies don't alias). */
export function shrink(g: Gray, n: number): Gray {
  const k = n / Math.max(g.w, g.h)
  if (k >= 1) return g
  const w = Math.max(2, Math.round(g.w * k)), h = Math.max(2, Math.round(g.h * k))
  const px = new Float32Array(w * h)
  const sx = g.w / w, sy = g.h / h
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
      let s = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += g.px[yy * g.w + xx]
      px[y * w + x] = s / ((x1 - x0) * (y1 - y0))
    }
  }
  return { w, h, px }
}

/** Edge strength (Sobel), lightly blurred so a near miss still scores. */
export function edges(g: Gray): Gray {
  const { w, h } = g
  const e = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = (dx: number, dy: number) => g.px[(y + dy) * w + x + dx]
      const gx = p(1, -1) + 2 * p(1, 0) + p(1, 1) - p(-1, -1) - 2 * p(-1, 0) - p(-1, 1)
      const gy = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - p(-1, -1) - 2 * p(0, -1) - p(1, -1)
      e[y * w + x] = Math.hypot(gx, gy)
    }
  }
  const b = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += e[(y + dy) * w + x + dx]
      b[y * w + x] = s / 9
    }
  }
  return { w, h, px: b }
}

/** How well `b` mapped onto `a` (a point p of a reads b at (p - t) / s) agrees: normalised correlation over the
 *  overlap, -1 to 1. `step` skips pixels for speed. */
function score(a: Gray, b: Gray, s: number, tx: number, ty: number, step: number): number {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0
  for (let y = 2; y < a.h - 2; y += step) {
    for (let x = 2; x < a.w - 2; x += step) {
      const vb = sample(b, (x - tx) / s, (y - ty) / s)
      if (Number.isNaN(vb)) continue
      const va = a.px[y * a.w + x]
      n++; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb
    }
  }
  // the overlap has to cover most of the picture, or a tiny corner could match by chance
  if (n < ((a.w * a.h) / (step * step)) * 0.5) return -1
  const cov = sab - (sa * sb) / n
  const va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1
}

export interface Match {
  /** A holo pixel p sits at normal pixel s * p + (tx, ty) (full-size pixels of each image). */
  s: number
  tx: number
  ty: number
  /** Correlation of the edges at the match, 0 to 1: under about 0.3 the pictures probably aren't the same drawing. */
  confidence: number
}

/** Where the holo art's drawing sits on the normal art's. */
export function matchImages(normal: Gray, holo: Gray): Match {
  // stage 1: small copies, a wide search
  const N1 = 96
  const a1 = edges(shrink(normal, N1)), b1 = edges(shrink(holo, N1))
  const ka = a1.w / normal.w, kb = b1.w / holo.w
  let best = { s: 1, tx: 0, ty: 0, c: -2 }
  for (let s = 0.7; s <= 1.43; s *= 1.02) {
    const cx = (a1.w - b1.w * s) / 2, cy = (a1.h - b1.h * s) / 2
    const r = Math.round(Math.max(a1.w, a1.h) * 0.22)
    for (let ty = -r; ty <= r; ty += 1) {
      for (let tx = -r; tx <= r; tx += 1) {
        const c = score(a1, b1, s, cx + tx, cy + ty, 2)
        if (c > best.c) best = { s, tx: cx + tx, ty: cy + ty, c }
      }
    }
  }
  // stage 2: bigger copies, a close search around the stage-1 answer
  const N2 = 256
  const a2 = edges(shrink(normal, N2)), b2 = edges(shrink(holo, N2))
  const ka2 = a2.w / normal.w, kb2 = b2.w / holo.w
  // convert the stage-1 answer to stage-2 pixels: full = small / k
  const toFull = (m: { s: number; tx: number; ty: number }, kA: number, kB: number) => ({ s: (m.s * kB) / kA, tx: m.tx / kA, ty: m.ty / kA })
  const f1 = toFull(best, ka, kb)
  let b = { s: (f1.s * ka2) / kb2, tx: f1.tx * ka2, ty: f1.ty * ka2, c: -2 }
  const seed = { ...b }
  for (let s = seed.s * 0.97; s <= seed.s * 1.031; s *= 1.005) {
    for (let dy = -4; dy <= 4; dy += 0.5) {
      for (let dx = -4; dx <= 4; dx += 0.5) {
        const c = score(a2, b2, s, seed.tx + dx, seed.ty + dy, 2)
        if (c > b.c) b = { s, tx: seed.tx + dx, ty: seed.ty + dy, c }
      }
    }
  }
  const full = toFull(b, ka2, kb2)
  return { s: full.s, tx: full.tx, ty: full.ty, confidence: Math.max(0, b.c) }
}

/** The holo placement that makes the holo art sit exactly where the normal art does, in a box of `box` px (both are
 *  scaled to cover the box). `ok` is false when the holo is too small to match without leaving a gap (it's then
 *  framed as close as it can be). */
export function placementToMatch(
  m: Match, normal: { w: number; h: number; placement?: Placement }, holo: { w: number; h: number }, box: { w: number; h: number },
): { placement: Placement; ok: boolean } {
  const pn = normal.placement ?? { zoom: 1, x: 0, y: 0 }
  const sn = Math.max(box.w / normal.w, box.h / normal.h) * pn.zoom
  const sh = sn * m.s
  const cover = Math.max(box.w / holo.w, box.h / holo.h)
  const zoom = sh / cover
  // card = centre + sn * (pn_px - normal centre) + off_n; pn_px = s * ph + t  =>  off_h = off_n + sn * (s * holo centre + t - normal centre)
  const x = pn.x + sn * (m.s * holo.w / 2 + m.tx - normal.w / 2)
  const y = pn.y + sn * (m.s * holo.h / 2 + m.ty - normal.h / 2)
  const z = Math.max(1, zoom)
  const s = cover * z
  const mx = Math.max(0, (holo.w * s - box.w) / 2), my = Math.max(0, (holo.h * s - box.h) / 2)
  const clampX = Math.max(-mx, Math.min(mx, x)), clampY = Math.max(-my, Math.min(my, y))
  return {
    placement: { zoom: Math.round(z * 1000) / 1000, x: Math.round(clampX), y: Math.round(clampY) },
    ok: zoom >= 0.995 && Math.abs(clampX - x) < 2 && Math.abs(clampY - y) < 2,
  }
}
