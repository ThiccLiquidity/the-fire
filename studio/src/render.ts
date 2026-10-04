/** Card renderer: assets + layout + card -> canvas / Blob, at 1500 x 2100. Canvas 2D only; works on the main thread
 *  (HTMLCanvasElement or OffscreenCanvas) and in a worker (OffscreenCanvas). No React, no IndexedDB. */

import type { DealtCard } from './deal'
import { CARD_H, CARD_W, CATEGORY_LABEL, GRADE_COLOR, HOLO_LABEL, MATERIAL_LABEL, wearLookOf, type Category, type Material, type WearLook } from './rules'
import type { Layout, OutputFormat, PsaBox, Rect, TextBox, TextStyle } from './types'
import type { Ctx2D } from './wear'

export type ImgSrc = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas

/** The two images one card needs: the frame variant and the art variant already chosen by holo state. */
export interface CardAssets {
  frame: ImgSrc | null
  art: ImgSrc | null
}

/** Everything printed on a card. Only what's shared by every card of the same look (looks.ts): no serial, no
 *  edition, no Series #. Those are in the metadata. */
export interface CardView {
  material: Material
  name: string
  materialLabel: string
  categoryLabel: string
  /** "Forged · Series 7": the Series the card came from. */
  forgedLabel: string
  /** '?' until the grade is paid for and revealed, then the number. */
  psaValue: string
  wear: WearLook
  /** PDA 10 only: the gold edge glow and corner sparkles (drawn here, the frames stay locked). */
  pda10: boolean
}

export function cardView(card: Pick<DealtCard, 'material' | 'grade' | 'fire'>, characterName: string, category?: Category): CardView {
  return {
    material: card.material,
    name: characterName,
    materialLabel: MATERIAL_LABEL[card.material],
    categoryLabel: category ? CATEGORY_LABEL[category] : '',
    forgedLabel: `Forged · Series ${card.fire > 0 ? card.fire : 1}`,
    psaValue: card.grade == null ? '?' : String(card.grade),
    wear: wearLookOf(card.grade),
    pda10: card.grade === 10,
  }
}

/** "Paper Rabbit #123" */
export function cardTitle(card: DealtCard, characterName: string): string {
  return `${MATERIAL_LABEL[card.material]} ${characterName} #${card.serial}`
}

export function holoLabel(card: Pick<DealtCard, 'holo'>): string {
  return HOLO_LABEL[card.holo]
}

function dims(img: ImgSrc): { w: number; h: number } {
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight }
  return { w: img.width, h: img.height }
}

function fontString(s: TextStyle, size: number): string {
  return `${s.italic ? 'italic ' : ''}${s.bold ? '700' : '400'} ${Math.max(1, Math.round(size))}px ${s.font}`
}

/** Largest size <= style.size (and >= style.minSize) at which the text fits the box width and height. */
export function fitTextSize(ctx: Ctx2D, text: string, s: TextStyle, box: Rect): number {
  const pad = s.outlineWidth * 2
  let size = Math.min(s.size, box.h)
  ctx.font = fontString(s, size)
  let width = ctx.measureText(text).width + pad
  if (width > box.w && width > 0) {
    size = Math.max(s.minSize, Math.floor(size * (box.w - pad) / (width - pad)))
    ctx.font = fontString(s, size)
    width = ctx.measureText(text).width + pad
    while (width > box.w && size > s.minSize) {
      size -= 1
      ctx.font = fontString(s, size)
      width = ctx.measureText(text).width + pad
    }
  }
  return size
}

function drawText(ctx: Ctx2D, raw: string, tb: TextBox): void {
  if (!tb.visible || !raw) return
  const s = tb.style
  const text = s.uppercase ? raw.toUpperCase() : raw
  const size = fitTextSize(ctx, text, s, tb.box)
  ctx.save()
  ctx.font = fontString(s, size)
  ctx.textBaseline = 'middle'
  ctx.textAlign = s.align
  const pad = s.outlineWidth
  const x = s.align === 'left' ? tb.box.x + pad : s.align === 'right' ? tb.box.x + tb.box.w - pad : tb.box.x + tb.box.w / 2
  const y = tb.box.y + tb.box.h / 2
  if (s.outlineWidth > 0) {
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2
    ctx.lineWidth = s.outlineWidth * 2
    ctx.strokeStyle = s.outlineColor
    ctx.strokeText(text, x, y)
  }
  ctx.fillStyle = s.color
  ctx.fillText(text, x, y)
  ctx.restore()
}

/** The PDA seal (decided Oct 3): a round wax seal stamped on the bottom panel, tinted per material (`fill` = light,
 *  `border` = dark), "PDA" small at the top and the grade (or "?") big in the middle, in the card's font. */
function drawPsa(ctx: Ctx2D, value: string, psa: PsaBox, ringColor: string | null): void {
  if (!psa.visible) return
  const R = Math.min(psa.box.w, psa.box.h) / 2
  const cx = psa.box.x + psa.box.w / 2
  const cy = psa.box.y + psa.box.h / 2
  const k = R / 118
  ctx.save()
  // scalloped wax edge (fixed wobble so every card is identical)
  ctx.beginPath()
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2
    const r = R + ((i % 2 ? 6 : -4) + Math.sin(i * 1.7) * 3) * k
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  const g = ctx.createRadialGradient(cx - 35 * k, cy - 40 * k, 10 * k, cx, cy, R + 10 * k)
  g.addColorStop(0, psa.fill)
  g.addColorStop(1, psa.border)
  ctx.fillStyle = g
  ctx.shadowColor = 'rgba(0,0,0,.45)'
  ctx.shadowBlur = 18 * k
  ctx.shadowOffsetY = 6 * k
  ctx.fill()
  ctx.shadowColor = 'transparent'
  // thin metallic gold rim along the scalloped edge
  const gold = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R)
  gold.addColorStop(0, '#fff3c4'); gold.addColorStop(0.35, '#e0b04a'); gold.addColorStop(0.6, '#9c7424'); gold.addColorStop(1, '#f5d77e')
  ctx.lineJoin = 'round'
  ctx.lineWidth = 4.5 * k; ctx.strokeStyle = gold; ctx.stroke()
  // pressed inner ring, edged in faint gold
  ctx.beginPath(); ctx.arc(cx, cy, R - 24 * k, 0, Math.PI * 2)
  ctx.lineWidth = 5 * k; ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.stroke()
  ctx.lineWidth = 2 * k; ctx.strokeStyle = 'rgba(224,176,74,.75)'; ctx.stroke()
  ctx.beginPath(); ctx.arc(cx, cy + 2 * k, R - 24 * k, 0, Math.PI * 2)
  ctx.lineWidth = 3 * k; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke()
  if (ringColor) {
    // revealed: a ring in the grade's colour with a soft glow, over a dark edge so it never washes into the seal
    ctx.beginPath(); ctx.arc(cx, cy, R - 24 * k, 0, Math.PI * 2)
    ctx.lineWidth = 15 * k; ctx.strokeStyle = 'rgba(10,8,6,.7)'; ctx.stroke()
    ctx.shadowColor = ringColor; ctx.shadowBlur = 16 * k
    ctx.lineWidth = 9 * k; ctx.strokeStyle = ringColor; ctx.stroke()
    ctx.shadowColor = 'transparent'
    ctx.lineWidth = 2 * k; ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.stroke()
  }
  ctx.restore()
  const st = { ...psa.style, outlineWidth: 0, uppercase: false, align: 'center' as const }
  drawText(ctx, 'PDA', { box: { x: cx - 80 * k, y: cy - 74 * k, w: 160 * k, h: 44 * k }, style: { ...st, bold: true, size: 34 * k, minSize: 12, color: st.color }, visible: true })
  drawText(ctx, value, { box: { x: cx - 85 * k, y: cy - 42 * k, w: 170 * k, h: 120 * k }, style: { ...st, bold: true, size: 112 * k, minSize: 24 }, visible: true })
}

function drawArt(ctx: Ctx2D, art: ImgSrc, layout: Layout): void {
  const a = layout.art
  const { w: iw, h: ih } = dims(art)
  if (!iw || !ih) return
  const fit = a.fit === 'cover' ? Math.max(a.box.w / iw, a.box.h / ih) : Math.min(a.box.w / iw, a.box.h / ih)
  const s = fit * (a.scale > 0 ? a.scale : 1)
  const dw = iw * s
  const dh = ih * s
  const dx = a.box.x + (a.box.w - dw) / 2 + a.offsetX
  const dy = a.box.y + (a.box.h - dh) / 2 + a.offsetY
  ctx.save()
  ctx.beginPath()
  ctx.rect(a.box.x, a.box.y, a.box.w, a.box.h)
  ctx.clip()
  if (a.background) {
    ctx.fillStyle = a.background
    ctx.fillRect(a.box.x, a.box.y, a.box.w, a.box.h)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(art, dx, dy, dw, dh)
  ctx.restore()
}

/** Frames are expected at 1500 x 2100; anything else is scaled to fit (contain, centered). */
function drawFrame(ctx: Ctx2D, frame: ImgSrc): void {
  const { w, h } = dims(frame)
  if (!w || !h) return
  ctx.imageSmoothingQuality = 'high'
  if (w === CARD_W && h === CARD_H) {
    ctx.drawImage(frame, 0, 0)
    return
  }
  const s = Math.min(CARD_W / w, CARD_H / h)
  ctx.drawImage(frame, (CARD_W - w * s) / 2, (CARD_H - h * s) / 2, w * s, h * s)
}

/** The card's outer outline, shared by every frame (measured from their alpha: 8 px clear margin, 92 px corners). */
export const CARD_OUTLINE = { inset: 8, radius: 92 }

/** PDA 10 sparkles: centre and size (outer radius, px), fixed so every PDA 10 of a look renders identically. All sit
 *  in the frame's outer border, clear of the name bar, the art window and the seal. */
export const PDA10_SPARKLES: readonly { x: number; y: number; r: number; tilt: number }[] = [
  { x: 56, y: 60, r: 32, tilt: 0 },
  { x: 100, y: 32, r: 13, tilt: 0.35 },
  { x: 1442, y: 60, r: 22, tilt: 0 },
  { x: 40, y: 2020, r: 17, tilt: 0.3 },
  { x: 1444, y: 2040, r: 32, tilt: 0 },
  { x: 1400, y: 2068, r: 12, tilt: 0.4 },
]

function outlinePath(ctx: Ctx2D, inset: number): void {
  const o = CARD_OUTLINE.inset + inset
  const r = Math.max(0, CARD_OUTLINE.radius - inset)
  ctx.beginPath()
  ctx.roundRect(o, o, CARD_W - 2 * o, CARD_H - 2 * o, r)
}

/** A four-point star: long thin rays with concave sides, a soft gold halo and a bright warm core. */
function sparkle(ctx: Ctx2D, x: number, y: number, r: number, tilt: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(tilt)
  const w = r * 0.2
  ctx.beginPath()
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    const tip = [Math.cos(a) * r, Math.sin(a) * r]
    const next = [Math.cos(a + Math.PI / 2) * r, Math.sin(a + Math.PI / 2) * r]
    if (i === 0) ctx.moveTo(tip[0], tip[1])
    ctx.quadraticCurveTo(Math.cos(a + Math.PI / 4) * w, Math.sin(a + Math.PI / 4) * w, next[0], next[1])
  }
  ctx.closePath()
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
  g.addColorStop(0, '#fffbe8')
  g.addColorStop(0.25, '#ffe39a')
  g.addColorStop(0.7, '#e9b44c')
  g.addColorStop(1, 'rgba(201,140,40,0.85)')
  ctx.shadowColor = 'rgba(255,190,70,0.95)'
  ctx.shadowBlur = r * 0.9
  ctx.fillStyle = g
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.lineWidth = Math.max(1.2, r * 0.06)
  ctx.strokeStyle = 'rgba(122,78,10,0.75)'
  ctx.stroke()
  ctx.restore()
}

/** PDA 10 (decided Oct 4): a thin warm-gold glow hugging the card's outer edge, plus a few small sparkles near the
 *  corners. Gold on every material (it never goes white on Diamond). Masked by the frame's alpha so it stays inside
 *  the card's rounded outline; it lives in the outer border only, never over the name, art or seal. */
function drawPda10(ctx: Ctx2D, frame: ImgSrc | null): void {
  const c = new OffscreenCanvas(CARD_W, CARD_H)
  const g = c.getContext('2d')
  if (!g) return
  const metal = g.createLinearGradient(0, 0, CARD_W, CARD_H)
  metal.addColorStop(0, '#ffe7a6'); metal.addColorStop(0.22, '#d9a23a'); metal.addColorStop(0.45, '#fff0bf')
  metal.addColorStop(0.7, '#c88d2a'); metal.addColorStop(1, '#ffe39a')
  // soft warm bloom, strongest at the edge and gone ~40 px in
  outlinePath(g, 0)
  g.shadowColor = 'rgba(255,184,64,0.9)'
  g.shadowBlur = 34
  g.lineWidth = 24
  g.strokeStyle = 'rgba(240,170,60,0.62)'
  g.stroke()
  g.shadowBlur = 0
  // a dark amber hairline so the gold reads on light frames (Paper, Diamond), then the metallic gold line
  outlinePath(g, 9)
  g.lineWidth = 7
  g.strokeStyle = 'rgba(110,68,8,0.55)'
  g.stroke()
  g.lineWidth = 4
  g.strokeStyle = metal
  g.stroke()
  for (const s of PDA10_SPARKLES) sparkle(g, s.x, s.y, s.r, s.tilt)
  if (frame) {
    g.globalCompositeOperation = 'destination-in'
    drawFrame(g, frame)
  } else {
    g.globalCompositeOperation = 'destination-in'
    outlinePath(g, 0)
    g.fillStyle = '#000'
    g.fill()
  }
  ctx.drawImage(c, 0, 0)
}

/** Draw a full card onto a 1500 x 2100 context. */
export function drawCard(ctx: Ctx2D, assets: CardAssets, layout: Layout, view: CardView): void {
  ctx.save()
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  if (!assets.frame) {
    // Frame missing (e.g. a wear level not delivered yet): a neutral background so the layout is still visible.
    ctx.fillStyle = '#2b2b30'
    ctx.fillRect(0, 0, CARD_W, CARD_H)
  }
  if (layout.layering === 'art-behind') {
    if (assets.art) drawArt(ctx, assets.art, layout)
    if (assets.frame) drawFrame(ctx, assets.frame)
  } else {
    if (assets.frame) drawFrame(ctx, assets.frame)
    if (assets.art) drawArt(ctx, assets.art, layout)
  }
  if (view.pda10 && typeof OffscreenCanvas !== 'undefined') drawPda10(ctx, assets.frame)
  // heavy wear (PDA 3-1) puts scorch and stains under the text: give un-outlined text its outline so it stays readable
  const worn = view.wear === 'L5' || view.wear === 'L6'
  const tb = (b: TextBox): TextBox => (worn && b.style.outlineWidth === 0 ? { ...b, style: { ...b.style, outlineWidth: 6 } } : b)
  drawText(ctx, view.name, tb(layout.text.name))
  drawText(ctx, view.materialLabel, tb(layout.text.material))
  drawText(ctx, view.categoryLabel, tb(layout.text.category))
  drawText(ctx, view.forgedLabel, tb(layout.text.forged))
  drawPsa(ctx, view.psaValue, layout.psa, view.wear === 'clean' ? null : GRADE_COLOR[view.wear])
  ctx.restore()
}

export const WEBP_QUALITY = 0.92

export function mimeOf(format: OutputFormat): string {
  return format === 'webp' ? 'image/webp' : 'image/png'
}

/** Render one card to an encoded image. Uses OffscreenCanvas (main thread or worker). */
export async function renderCardBlob(
  assets: CardAssets, layout: Layout, view: CardView, format: OutputFormat, canvas?: OffscreenCanvas,
): Promise<Blob> {
  const c = canvas ?? new OffscreenCanvas(CARD_W, CARD_H)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  drawCard(ctx, assets, layout, view)
  return c.convertToBlob({ type: mimeOf(format), quality: format === 'webp' ? WEBP_QUALITY : undefined })
}
