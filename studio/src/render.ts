/** Card renderer: assets + layout + card -> canvas / Blob, at 1500 x 2100. Canvas 2D only; works on the main thread
 *  (HTMLCanvasElement or OffscreenCanvas) and in a worker (OffscreenCanvas). No React, no IndexedDB. */

import type { DealtCard } from './deal'
import { CARD_H, CARD_W, CATEGORY_LABEL, HOLO_LABEL, MATERIAL_LABEL, wearLookOf, type Category, type Material, type WearLook } from './rules'
import type { Layout, OutputFormat, PsaBox, Rect, TextBox, TextStyle } from './types'
import type { Ctx2D } from './wear'

export type ImgSrc = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas

/** The two images one card needs: the frame variant and the art variant already chosen by holo state. */
export interface CardAssets {
  frame: ImgSrc | null
  art: ImgSrc | null
}

/** Everything printed on a card. Only what's shared by every card of the same look (looks.ts): no serial, no
 *  edition, no Fire #. Those are in the metadata. */
export interface CardView {
  material: Material
  name: string
  materialLabel: string
  categoryLabel: string
  psaText: string
  wear: WearLook
}

export function cardView(card: Pick<DealtCard, 'material' | 'grade'>, characterName: string, category?: Category): CardView {
  return {
    material: card.material,
    name: characterName,
    materialLabel: MATERIAL_LABEL[card.material],
    categoryLabel: category ? CATEGORY_LABEL[category] : '',
    psaText: card.grade == null ? 'PSA ?' : `PSA ${card.grade}`,
    wear: wearLookOf(card.grade),
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

function roundRect(ctx: Ctx2D, r: Rect, radius: number): void {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2))
  ctx.beginPath()
  ctx.moveTo(r.x + rad, r.y)
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad)
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad)
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad)
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad)
  ctx.closePath()
}

function drawPsa(ctx: Ctx2D, text: string, psa: PsaBox): void {
  if (!psa.visible) return
  ctx.save()
  roundRect(ctx, psa.box, psa.radius)
  ctx.fillStyle = psa.fill
  ctx.fill()
  if (psa.borderWidth > 0) {
    ctx.lineWidth = psa.borderWidth
    ctx.strokeStyle = psa.border
    ctx.stroke()
  }
  ctx.restore()
  const inset = Math.max(psa.borderWidth, psa.radius * 0.4)
  drawText(ctx, text, { ...psa, box: { x: psa.box.x + inset, y: psa.box.y, w: psa.box.w - inset * 2, h: psa.box.h } })
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
  // heavy wear (PSA 3-1) puts scorch and stains under the text: give un-outlined text its outline so it stays readable
  const worn = view.wear === 'L5' || view.wear === 'L6'
  const tb = (b: TextBox): TextBox => (worn && b.style.outlineWidth === 0 ? { ...b, style: { ...b.style, outlineWidth: 6 } } : b)
  drawText(ctx, view.name, tb(layout.text.name))
  drawText(ctx, view.materialLabel, tb(layout.text.material))
  drawText(ctx, view.categoryLabel, tb(layout.text.category))
  drawPsa(ctx, view.psaText, layout.psa)
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
