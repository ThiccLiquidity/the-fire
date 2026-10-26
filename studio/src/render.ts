/** Card renderer: assets + layout + card -> canvas / Blob, at 1500 x 2100. Canvas 2D only; works on the main thread
 *  (HTMLCanvasElement or OffscreenCanvas) and in a worker (OffscreenCanvas). No React, no IndexedDB. */

import type { DealtCard } from './deal'
import type { Recipe } from './recipe'
import { CARD_H, CARD_W, GRADE_COLOR, HOLO_LABEL, wearLookOf, type WearLook } from './rules'
import type { Layout, OutputFormat, Placement, PsaBox, Rect, TextBox, TextStyle } from './types'
import type { Ctx2D } from './wear'
import { drawCase, drawSlab, type SlabLabel } from './protect'
import { FRAMELESS_SETS } from './frames'
import { cardHolo, frameHolo, goldFrameShine, goldPicture, pictureHolo } from './holoFx'

export type ImgSrc = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas

/** The images one card needs: its frame and its art (holo is drawn over them, holoFx.ts). */
export interface CardAssets {
  frame: ImgSrc | null
  art: ImgSrc | null
  /** The PDA wear layer for the card's grade (frames.ts wearUrl), drawn over everything; none when ungraded or PDA 10. */
  wear?: ImgSrc | null
}

/** What one image shows: a card type (its name and frame set), a holo look, a grade, a character and the Series. */
export interface CardFace {
  /** The frame set (frames.ts) the type uses: its frames, its layout and the character's art for it. */
  frameSet: string
  /** The type's name: printed on the card ("Material") and the first word of the card's name. */
  typeName: string
  holoFrame: boolean
  holoPicture: boolean
  grade?: number | null
  /** In a case (ungraded): the image is the card inside a clear case. A graded card is always in a slab. */
  cased?: boolean
  fire: number
  characterId: string
}

/** The face of a dealt (or stand-in) card under its Series' recipe. */
export function faceOf(card: DealtCard, r: Recipe): CardFace {
  const t = r.types[card.type]
  return {
    frameSet: t?.frameSet ?? 'paper', typeName: t?.name ?? '?', holoFrame: card.holoFrame, holoPicture: card.holoPicture,
    grade: card.grade ?? null, cased: !!card.cased && card.grade == null, fire: card.fire, characterId: card.characterId,
  }
}

/** Everything printed on a card. Only what's shared by every card of the same look (looks.ts): no serial, no
 *  print number, no Series #. Those are in the metadata. */
export interface CardView {
  frameSet: string
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
  /** How the finished card is presented: bare, in a case, or slabbed with its grade label (protect.ts). */
  holder: 'none' | 'case' | 'slab'
  /** The slab label's line under the name: "Series 6 · Fire · Full Holo". */
  slabSub: string
  /** Holo drawn on the frame / the picture (holoFx.ts). Gold always has its gold picture and frame shine; Full Art is
   *  holo all over. */
  holoFrame: boolean
  holoPicture: boolean
}

export function cardView(
  face: Pick<CardFace, 'frameSet' | 'typeName' | 'grade' | 'fire'> & Partial<Pick<CardFace, 'cased' | 'holoFrame' | 'holoPicture'>>,
  characterName: string, category?: string,
): CardView {
  const holo = face.holoFrame && face.holoPicture ? 'Full Holo' : face.holoFrame ? 'Holo Frame' : face.holoPicture ? 'Holo Picture' : ''
  return {
    frameSet: face.frameSet,
    name: characterName,
    materialLabel: face.typeName,
    categoryLabel: category ?? '',
    forgedLabel: `Forged · Series ${face.fire > 0 ? face.fire : 1}`,
    psaValue: face.grade == null ? '?' : String(face.grade),
    wear: wearLookOf(face.grade),
    pda10: face.grade === 10,
    holder: face.grade != null ? 'slab' : face.cased ? 'case' : 'none',
    slabSub: [`Series ${face.fire > 0 ? face.fire : 1}`, face.typeName, holo].filter(Boolean).join(' · '),
    holoFrame: !!face.holoFrame,
    holoPicture: !!face.holoPicture,
  }
}

/** The layout with one character's framing of its full-card art applied (zoom on top of the layout's scale, the
 *  move added to its offset). */
export function withPlacement(layout: Layout, p: Placement | undefined): Layout {
  if (!p) return layout
  const a = layout.art
  return { ...layout, art: { ...a, scale: (a.scale > 0 ? a.scale : 1) * Math.max(0.5, p.zoom), offsetX: a.offsetX + p.x, offsetY: a.offsetY + p.y } }
}

/** "Paper Rabbit #123" */
export function cardTitle(typeName: string, characterName: string, serial: number): string {
  return `${typeName} ${characterName} #${serial}`
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

/** Draws one line of text in its box, positioned by the letters actually drawn (not the font's em box), so it sits
 *  the same whatever the font or size: vertically the capital height is centred in the box (every line of a field
 *  shares one baseline, descenders hang below); a centred line is centred on its ink left to right. `ink` centres a
 *  single mark (the seal's grade or "?") on its own shape both ways. */
function drawText(ctx: Ctx2D, raw: string, tb: TextBox, ink = false): void {
  if (!tb.visible || !raw) return
  const s = tb.style
  const text = s.uppercase ? raw.toUpperCase() : raw
  const size = fitTextSize(ctx, text, s, tb.box)
  ctx.save()
  ctx.font = fontString(s, size)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  const m = ctx.measureText(text)
  const left = m.actualBoundingBoxLeft || 0
  const right = m.actualBoundingBoxRight || m.width
  const pad = s.outlineWidth
  const cx = tb.box.x + tb.box.w / 2
  const cy = tb.box.y + tb.box.h / 2
  const x = s.align === 'left' ? tb.box.x + pad + left
    : s.align === 'right' ? tb.box.x + tb.box.w - pad - right
    : cx - (right - left) / 2
  let y: number
  if (ink) {
    y = cy + ((m.actualBoundingBoxAscent || size * 0.7) - (m.actualBoundingBoxDescent || 0)) / 2
  } else {
    const cap = ctx.measureText('H').actualBoundingBoxAscent || size * 0.7
    y = cy + cap / 2
  }
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

/** The PDA seal: a round wax seal stamped on the bottom panel, tinted per material (`fill` = light,
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
  drawText(ctx, value, { box: { x: cx - 85 * k, y: cy - 42 * k, w: 170 * k, h: 120 * k }, style: { ...st, bold: true, size: 112 * k, minSize: 24 }, visible: true }, true)
}

/** The card's own shape (the same rounded outline clean_frames.py gives every frame): full-card art is clipped to it. */
const CARD_INSET = 8
const CARD_RADIUS = 93

/** Full-card art (Full Art) is the whole card, so it must be solid to the edge: trims any see-through margin round the
 *  art (its rounded corners, a soft edge) and makes every pixel fully opaque. Otherwise the backing shows through as a
 *  dark border and the whole card looks a shade darker. */
export async function solidFullCardArt(src: ImageBitmap): Promise<ImageBitmap> {
  const w = src.width
  const h = src.height
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')
  if (!g) return src
  g.drawImage(src, 0, 0)
  const d = g.getImageData(0, 0, w, h)
  const px = d.data
  // the solid part: rows and columns that are mostly opaque (a few stray see-through pixels don't count)
  const solidRow = (y: number) => { let n = 0; for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] >= 128) n++; return n > w * 0.5 }
  const solidCol = (x: number) => { let n = 0; for (let y = 0; y < h; y++) if (px[(y * w + x) * 4 + 3] >= 128) n++; return n > h * 0.5 }
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1
  while (y0 < y1 && !solidRow(y0)) y0++
  while (y1 > y0 && !solidRow(y1)) y1--
  while (x0 < x1 && !solidCol(x0)) x0++
  while (x1 > x0 && !solidCol(x1)) x1--
  // a couple of pixels more, past the soft edge
  x0 = Math.min(x0 + 2, x1); y0 = Math.min(y0 + 2, y1); x1 = Math.max(x1 - 2, x0); y1 = Math.max(y1 - 2, y0)
  for (let i = 3; i < px.length; i += 4) px[i] = 255
  g.putImageData(d, 0, 0)
  return createImageBitmap(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
}

function drawArt(ctx: Ctx2D, art: ImgSrc, layout: Layout): void {
  const a = layout.art
  const { w: iw, h: ih } = dims(art)
  if (!iw || !ih) return
  const fullCard = a.box.x === 0 && a.box.y === 0 && a.box.w === CARD_W && a.box.h === CARD_H
  const fit = a.fit === 'cover' ? Math.max(a.box.w / iw, a.box.h / ih) : Math.min(a.box.w / iw, a.box.h / ih)
  const s = fit * (a.scale > 0 ? a.scale : 1)
  const dw = iw * s
  const dh = ih * s
  const dx = a.box.x + (a.box.w - dw) / 2 + a.offsetX
  const dy = a.box.y + (a.box.h - dh) / 2 + a.offsetY
  ctx.save()
  ctx.beginPath()
  // full-card art: the card's rounded shape and no backing colour (there is nothing behind the card to fill)
  if (fullCard) ctx.roundRect(CARD_INSET, CARD_INSET, CARD_W - 2 * CARD_INSET, CARD_H - 2 * CARD_INSET, CARD_RADIUS)
  else ctx.rect(a.box.x, a.box.y, a.box.w, a.box.h)
  ctx.clip()
  if (a.background && !fullCard) {
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

/** PDA 10: a thin warm-gold glow hugging the card's outer edge, plus a few small sparkles near the
 *  corners. Gold on every material (it never goes white on Diamond). Masked by the frame's alpha so it stays inside
 *  the card's rounded outline; it lives in the outer border only, never over the name, art or seal. */
export function drawPda10(ctx: Ctx2D, frame: ImgSrc | null): void {
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

/** The card up to and including the frame (and, with `holo`, the drawn holo): everything under the print. With holo
 *  off this is the tilt layer "plain" (the site draws the live holo over it). Clears the context first. */
function baseLayers(ctx: Ctx2D, assets: CardAssets, layout: Layout, view: CardView, holo: boolean): void {
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  const frameless = FRAMELESS_SETS.includes(view.frameSet)
  if (!assets.frame && !frameless) {
    // Frame missing (not delivered yet): a neutral background so the layout is still visible.
    ctx.fillStyle = '#2b2b30'
    ctx.fillRect(0, 0, CARD_W, CARD_H)
  }
  // holo is drawn, not delivered as images (holoFx.ts): on the picture right after the art (under the frame's edge),
  // on the frame right after the frame, and always before the text, the seal and the wear
  const fx = holo && typeof OffscreenCanvas !== 'undefined'
  const gold = view.frameSet === 'gold'
  const pictureFx = () => {
    if (!fx || frameless || !assets.art) return
    if (gold) goldPicture(ctx, layout.art.box)
    else if (view.holoPicture) pictureHolo(ctx, layout.art.box)
  }
  if (layout.layering === 'art-behind') {
    if (assets.art) drawArt(ctx, assets.art, layout)
    pictureFx()
    if (assets.frame) drawFrame(ctx, assets.frame)
  } else {
    if (assets.frame) drawFrame(ctx, assets.frame)
    if (assets.art) drawArt(ctx, assets.art, layout)
    pictureFx()
  }
  if (frameless) {
    // no frame: the art is the whole card, cut to the same rounded card shape as every frame
    ctx.globalCompositeOperation = 'destination-in'
    outlinePath(ctx, 0)
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    if (fx && (view.holoFrame || view.holoPicture)) cardHolo(ctx, (q) => outlinePath(q, 0))
  } else if (fx && assets.frame) {
    if (gold) goldFrameShine(ctx, assets.frame, layout.art.box)
    else if (view.holoFrame) frameHolo(ctx, assets.frame, layout.art.box)
  }
}

/** Everything drawn over the holo: the PDA 10 glow, the texts, the seal and the wear. Alone on a clear context this is
 *  the tilt layer "print" (transparent elsewhere). */
function printLayers(ctx: Ctx2D, assets: CardAssets, layout: Layout, view: CardView): void {
  if (view.pda10 && typeof OffscreenCanvas !== 'undefined') drawPda10(ctx, assets.frame)
  // heavy wear (PDA 3-1) puts scorch and stains under the text: give un-outlined text its outline so it stays readable
  const worn = view.wear === 'L5' || view.wear === 'L6'
  const tb = (b: TextBox): TextBox => (worn && b.style.outlineWidth === 0 ? { ...b, style: { ...b.style, outlineWidth: 6 } } : b)
  drawText(ctx, view.name, tb(layout.text.name))
  drawText(ctx, view.materialLabel, tb(layout.text.material))
  drawText(ctx, view.categoryLabel, tb(layout.text.category))
  drawText(ctx, view.forgedLabel, tb(layout.text.forged))
  drawPsa(ctx, view.psaValue, layout.psa, view.wear === 'clean' ? null : GRADE_COLOR[view.wear])
  // PDA wear, the same layer on every card type: over the art, the frame and the print alike
  if (assets.wear) ctx.drawImage(assets.wear, 0, 0, CARD_W, CARD_H)
}

/** The card under its print onto a cleared 1500 x 2100 context: art and frame, plus the drawn holo when `holo` is on. */
export function drawBase(ctx: Ctx2D, assets: CardAssets, layout: Layout, view: CardView, opts: { holo: boolean }): void {
  ctx.save()
  baseLayers(ctx, assets, layout, view, opts.holo)
  ctx.restore()
}

/** The print (PDA 10 glow, texts, seal, wear) over whatever the context holds; on a clear one, alone. */
export function drawPrint(ctx: Ctx2D, assets: CardAssets, layout: Layout, view: CardView): void {
  ctx.save()
  printLayers(ctx, assets, layout, view)
  ctx.restore()
}

/** Draw a full card onto a 1500 x 2100 context: drawBase (holo on) then drawPrint. */
export function drawCard(ctx: Ctx2D, assets: CardAssets, layout: Layout, view: CardView): void {
  ctx.save()
  baseLayers(ctx, assets, layout, view, true)
  printLayers(ctx, assets, layout, view)
  ctx.restore()
}

/** The tilt layers the site (web/art/factory/forge/holo.js) redraws a moving holo from: plain -> live holo -> print. */
export const TILT_W = 720
export const TILT_H = 1008
export type TiltPart = 'plain' | 'print'

/** Draw one tilt layer at 1500 x 2100 onto a cleared context: 'plain' is the card with no holo, no print and no wear;
 *  'print' is only what drawCard puts over the holo. Never a case or slab (the site draws the holders). */
export function drawTiltPart(ctx: Ctx2D, assets: CardAssets, layout: Layout, view: CardView, part: TiltPart): void {
  if (part === 'plain') {
    drawBase(ctx, assets, layout, view, { holo: false })
    return
  }
  ctx.clearRect(0, 0, CARD_W, CARD_H)
  drawPrint(ctx, assets, layout, view)
}

export const WEBP_QUALITY = 0.92

export function mimeOf(format: OutputFormat): string {
  return format === 'webp' ? 'image/webp' : 'image/png'
}

/** Draw a card as it's presented: bare, in its case, or in its slab (protect.ts). */
export function drawPresented(ctx: Ctx2D, assets: CardAssets, layout: Layout, view: CardView): void {
  if (view.holder === 'none') {
    drawCard(ctx, assets, layout, view)
    return
  }
  const card = new OffscreenCanvas(CARD_W, CARD_H)
  const cctx = card.getContext('2d')
  if (!cctx) throw new Error('2D canvas unavailable')
  drawCard(cctx, assets, layout, view)
  if (view.holder === 'case') drawCase(ctx, card)
  else drawSlab(ctx, card, { characterName: view.name, sub: view.slabSub, grade: Number(view.psaValue) } satisfies SlabLabel)
}

/** Render one card to an encoded image. Uses OffscreenCanvas (main thread or worker). */
export async function renderCardBlob(
  assets: CardAssets, layout: Layout, view: CardView, format: OutputFormat, canvas?: OffscreenCanvas,
): Promise<Blob> {
  const c = canvas ?? new OffscreenCanvas(CARD_W, CARD_H)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  drawPresented(ctx, assets, layout, view)
  return c.convertToBlob({ type: mimeOf(format), quality: format === 'webp' ? WEBP_QUALITY : undefined })
}

/** Render one tilt layer (drawTiltPart) at 1500 x 2100, scaled down to TILT_W x TILT_H, as an RGBA WEBP. */
export async function renderTiltPartBlob(
  assets: CardAssets, layout: Layout, view: CardView, part: TiltPart, canvas?: OffscreenCanvas,
): Promise<Blob> {
  const c = canvas ?? new OffscreenCanvas(CARD_W, CARD_H)
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  drawTiltPart(ctx, assets, layout, view, part)
  const out = new OffscreenCanvas(TILT_W, TILT_H)
  const o = out.getContext('2d')
  if (!o) throw new Error('2D canvas unavailable')
  o.imageSmoothingEnabled = true
  o.imageSmoothingQuality = 'high'
  o.drawImage(c, 0, 0, TILT_W, TILT_H)
  return out.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY })
}
