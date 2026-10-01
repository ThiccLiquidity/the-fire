/** PLACEHOLDER test assets, generated in code, for exercising the whole flow before real art exists.
 *  Frames: a distinct colour per material with a transparent art window (DEFAULT_ART_BOX).
 *  Characters: three simple shapes with a label, drawn on flat magenta so the chroma key gets tested.
 *  Everything is clearly labelled PLACEHOLDER on the image itself. */

import * as db from './db'
import { DEFAULT_ART_BOX } from './layoutDefaults'
import { CARD_H, CARD_W, MATERIALS, MATERIAL_LABEL, type Material } from './rules'
import { saveCharacter, setCharacterImage, setFrame } from './store'
import type { Character, Variant } from './types'

const FRAME_COLOR: Record<Material, [string, string]> = {
  paper: ['#efe4cb', '#c9b48a'],
  wood: ['#9a6434', '#5b3718'],
  burning: ['#f07a28', '#8e1f0b'],
  charcoal: ['#4a4a52', '#16161a'],
  diamond: ['#c9f3ff', '#5fb7d6'],
}
const INK: Record<Material, string> = { paper: '#3b2f1e', wood: '#f6e3c8', burning: '#fff1d6', charcoal: '#e8e8ee', diamond: '#0d3a4a' }

type Ctx = OffscreenCanvasRenderingContext2D

function rainbow(ctx: Ctx, w: number, h: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, w, h)
  const cols = ['#ff4d6d', '#ffb347', '#fff275', '#7dff9a', '#58c7ff', '#a77dff', '#ff4d6d']
  cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1), c))
  return g
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export async function makePlaceholderFrame(m: Material, holo: boolean): Promise<Blob> {
  const c = new OffscreenCanvas(CARD_W, CARD_H)
  const ctx = c.getContext('2d')!
  const [light, dark] = FRAME_COLOR[m]
  const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H)
  g.addColorStop(0, light)
  g.addColorStop(1, dark)
  ctx.fillStyle = g
  roundRectPath(ctx, 0, 0, CARD_W, CARD_H, 60)
  ctx.fill()
  if (holo) {
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.globalCompositeOperation = 'overlay'
    ctx.fillStyle = rainbow(ctx, CARD_W, CARD_H)
    ctx.fillRect(0, 0, CARD_W, CARD_H)
    ctx.globalAlpha = 0.18
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = '#ffffff'
    for (let x = -CARD_H; x < CARD_W; x += 120) {
      ctx.beginPath()
      ctx.moveTo(x, CARD_H); ctx.lineTo(x + 40, CARD_H); ctx.lineTo(x + 40 + CARD_H, 0); ctx.lineTo(x + CARD_H, 0)
      ctx.fill()
    }
    ctx.restore()
  }
  // inner border and plates
  ctx.strokeStyle = INK[m]
  ctx.lineWidth = 10
  roundRectPath(ctx, 50, 50, CARD_W - 100, CARD_H - 100, 40)
  ctx.stroke()
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  roundRectPath(ctx, 110, 110, CARD_W - 220, 160, 30); ctx.fill()
  roundRectPath(ctx, 110, 1490, CARD_W - 220, 120, 30); ctx.fill()
  roundRectPath(ctx, 110, 1830, 900, 150, 30); ctx.fill()
  // art window: punch a transparent hole, then outline it
  const a = DEFAULT_ART_BOX
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#000' // fully opaque, so the window is fully cleared
  roundRectPath(ctx, a.x, a.y, a.w, a.h, 24)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = INK[m]
  ctx.lineWidth = 8
  roundRectPath(ctx, a.x - 4, a.y - 4, a.w + 8, a.h + 8, 28)
  ctx.stroke()
  // label
  ctx.fillStyle = INK[m]
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 46px Arial, sans-serif'
  ctx.fillText(`PLACEHOLDER FRAME · ${MATERIAL_LABEL[m].toUpperCase()}${holo ? ' · HOLO' : ''}`, CARD_W / 2, 1700)
  ctx.font = '400 34px Arial, sans-serif'
  ctx.fillText('replace with the real frame in Frames & Layout', CARD_W / 2, 1760)
  return c.convertToBlob({ type: 'image/png' })
}

const BODY: Record<Material, string> = { paper: '#fbf8f1', wood: '#a46a3a', burning: '#c8662a', charcoal: '#2a2a2e', diamond: '#bdf2ff' }
const LINE: Record<Material, string> = { paper: '#9c8f78', wood: '#5a3516', burning: '#5a1a05', charcoal: '#6a6a72', diamond: '#3d9ec2' }

type Shape = 'rabbit' | 'bird' | 'fox'

function ell(ctx: Ctx, cx: number, cy: number, rx: number, ry: number, rot: number) {
  ctx.moveTo(cx + rx * Math.cos(rot), cy + rx * Math.sin(rot))
  ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2)
}

function shapePath(ctx: Ctx, s: Shape) {
  ctx.beginPath()
  if (s === 'rabbit') {
    ell(ctx, 500, 640, 230, 250, 0)
    ell(ctx, 500, 420, 160, 160, 0)
    ell(ctx, 430, 180, 55, 170, -0.15)
    ell(ctx, 575, 180, 55, 170, 0.15)
  } else if (s === 'bird') {
    ell(ctx, 480, 560, 260, 260, 0)
    ctx.moveTo(720, 470)
    ctx.lineTo(900, 520); ctx.lineTo(720, 580); ctx.closePath()
    ctx.moveTo(300, 800)
    ctx.lineTo(380, 900); ctx.lineTo(420, 800); ctx.closePath()
  } else {
    ctx.moveTo(250, 250); ctx.lineTo(380, 380); ctx.lineTo(620, 380); ctx.lineTo(750, 250)
    ctx.lineTo(760, 560); ctx.lineTo(500, 820); ctx.lineTo(240, 560); ctx.closePath()
    ell(ctx, 760, 760, 150, 70, -0.6)
  }
}

export async function makePlaceholderArt(name: string, shape: Shape, m: Material, holo: boolean): Promise<Blob> {
  const S = 1000
  const c = new OffscreenCanvas(S, S)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ff00ff'
  ctx.fillRect(0, 0, S, S)
  if (m === 'burning') {
    // flames behind the shape
    ctx.fillStyle = '#ffb000'
    for (let i = 0; i < 7; i++) {
      const x = 220 + i * 95
      ctx.beginPath()
      ctx.moveTo(x - 60, 820); ctx.quadraticCurveTo(x - 30, 520, x, 230 + (i % 3) * 60); ctx.quadraticCurveTo(x + 30, 520, x + 60, 820)
      ctx.fill()
    }
  }
  shapePath(ctx, shape)
  ctx.fillStyle = BODY[m]
  ctx.fill('nonzero')
  if (holo) {
    ctx.save()
    shapePath(ctx, shape)
    ctx.clip('nonzero')
    ctx.globalAlpha = 0.55
    ctx.fillStyle = rainbow(ctx, S, S)
    ctx.fillRect(0, 0, S, S)
    ctx.restore()
  }
  shapePath(ctx, shape)
  ctx.lineWidth = 12
  ctx.strokeStyle = LINE[m]
  ctx.stroke()
  // eye
  ctx.fillStyle = m === 'charcoal' ? '#ff7a2a' : '#111'
  ctx.beginPath()
  ctx.arc(shape === 'bird' ? 600 : shape === 'fox' ? 420 : 450, shape === 'bird' ? 480 : shape === 'fox' ? 500 : 410, 22, 0, Math.PI * 2)
  ctx.fill()
  // label (on a dark pill so it survives keying)
  ctx.fillStyle = 'rgba(20,20,20,0.85)'
  ctx.beginPath()
  ctx.roundRect(150, 880, 700, 100, 30)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = '700 34px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`PLACEHOLDER ${name} · ${MATERIAL_LABEL[m]}${holo ? ' · HOLO' : ''}`, 500, 930)
  return c.convertToBlob({ type: 'image/png' })
}

export const SAMPLE_CHARACTERS: { name: string; shortId: string; shape: Shape }[] = [
  { name: 'Rabbit', shortId: 'RAB', shape: 'rabbit' },
  { name: 'Bird', shortId: 'BRD', shape: 'bird' },
  { name: 'Fox', shortId: 'FOX', shape: 'fox' },
]

export async function loadSampleAssets(onStatus: (s: string) => void): Promise<void> {
  for (const m of MATERIALS) {
    for (const v of ['normal', 'holo'] as Variant[]) {
      onStatus(`Frame: ${m} ${v}`)
      await setFrame(m, v, await makePlaceholderFrame(m, v === 'holo'), `placeholder-frame-${m}-${v}.png`, true)
    }
  }
  for (const s of SAMPLE_CHARACTERS) {
    const now = Date.now()
    const c: Character = { id: db.newId(), name: s.name, shortId: s.shortId, images: {}, createdAt: now, updatedAt: now, placeholder: true }
    await saveCharacter(c)
    for (const m of MATERIALS) {
      for (const v of ['normal', 'holo'] as Variant[]) {
        onStatus(`Character: ${s.name} ${m} ${v}`)
        await setCharacterImage(c.id, m, v, await makePlaceholderArt(s.name, s.shape, m, v === 'holo'), `placeholder-${s.shortId}-${m}-${v}.png`, true)
      }
    }
  }
  onStatus('Sample assets loaded.')
}
