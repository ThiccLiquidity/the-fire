/** PLACEHOLDER test assets, generated in code, for exercising the whole flow before real art exists.
 *  Characters: three simple shapes with a label, drawn on flat magenta so the chroma key gets tested.
 *  Everything is clearly labelled PLACEHOLDER on the image itself. */

import * as db from './db'
import { MATERIALS, MATERIAL_LABEL, type Category, type Material } from './rules'
import { saveCharacter, setCharacterImage } from './store'
import type { Character, Variant } from './types'

type Ctx = OffscreenCanvasRenderingContext2D

function rainbow(ctx: Ctx, w: number, h: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, w, h)
  const cols = ['#ff4d6d', '#ffb347', '#fff275', '#7dff9a', '#58c7ff', '#a77dff', '#ff4d6d']
  cols.forEach((c, i) => g.addColorStop(i / (cols.length - 1), c))
  return g
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

export const SAMPLE_CHARACTERS: { name: string; shortId: string; shape: Shape; category: Category }[] = [
  { name: 'Rabbit', shortId: 'RAB', shape: 'rabbit', category: 'animal' },
  { name: 'Bird', shortId: 'BRD', shape: 'bird', category: 'animal' },
  { name: 'Fox', shortId: 'FOX', shape: 'fox', category: 'animal' },
]

export async function loadSampleAssets(onStatus: (s: string) => void): Promise<void> {
  for (const s of SAMPLE_CHARACTERS) {
    const now = Date.now()
    const c: Character = { id: db.newId(), name: s.name, shortId: s.shortId, category: s.category, images: {}, createdAt: now, updatedAt: now, placeholder: true }
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
