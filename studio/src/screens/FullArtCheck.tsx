/** Full Art safety net in the Library: the template to give the image generator, a size check on the uploaded photo,
 *  and a live preview with the print zones outlined where the photo can be zoomed and moved. */

import { useEffect, useRef, useState } from 'react'
import { Notice, useAction } from '../components'
import { frameSetLabel } from '../frames'
import { drawZones, fitReport, fullArtTemplateBlob } from '../fullartGuide'
import { cardView, drawCard, solidFullCardArt, withPlacement } from '../render'
import { CARD_H, CARD_W } from '../rules'
import { effectiveKey, getStudio, layoutFor, updateImagePlacement, useStudio } from '../store'
import { getBlob } from '../db'
import type { Character, ImageSlot, Placement, Variant } from '../types'

const VIEW_W = 300
const NONE: Placement = { zoom: 1, x: 0, y: 0 }

export function TemplateButton({ m }: { m: string }) {
  const [busy, error, run] = useAction()
  const download = () => run(async () => {
    const blob = await fullArtTemplateBlob(layoutFor(m))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${m}-template-1500x2100.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  })
  return (
    <>
      <button className="link" onClick={download} disabled={busy} data-testid={`template-${m}`}>Download template</button>
      {error && <Notice kind="error">{error}</Notice>}
    </>
  )
}

export function FullArtCheck({ c, m, v, slot }: { c: Character; m: string; v: Variant; slot: ImageSlot }) {
  useStudio()
  const report = fitReport(slot.width, slot.height)
  const saved = slot.placement ?? NONE
  const [p, setP] = useState<Placement>(saved)
  const [zones, setZones] = useState(true)
  const [art, setArt] = useState<ImageBitmap | null>(null)
  const [busy, error, run] = useAction()
  const canvas = useRef<HTMLCanvasElement>(null)
  const key = effectiveKey(slot)
  const dirty = p.zoom !== saved.zoom || p.x !== saved.x || p.y !== saved.y
  // the photo always covers the card: a move can't go past its edge
  const clamp = (n: Placement): Placement => {
    if (!art) return n
    const s = Math.max(CARD_W / art.width, CARD_H / art.height) * n.zoom
    const mx = Math.max(0, (art.width * s - CARD_W) / 2), my = Math.max(0, (art.height * s - CARD_H) / 2)
    return { zoom: n.zoom, x: Math.round(Math.max(-mx, Math.min(mx, n.x))), y: Math.round(Math.max(-my, Math.min(my, n.y))) }
  }

  useEffect(() => { setP(slot.placement ?? NONE) }, [slot.placement])

  useEffect(() => {
    let live = true
    let made: ImageBitmap | null = null
    void getBlob(key).then(async (b) => {
      if (!b || !live) return
      const full = await createImageBitmap(b)
      made = await solidFullCardArt(full)
      if (made !== full) full.close()
      if (live) setArt(made)
      else made.close()
    })
    return () => { live = false; made?.close() }
  }, [key])

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const raf = requestAnimationFrame(() => {
      const fire = Math.max(1, getStudio().global.nextFireNumber - 1)
      const view = cardView({ frameSet: m, typeName: frameSetLabel(m), grade: null, fire, holoFrame: true, holoPicture: true }, c.name, c.category)
      ctx.save()
      ctx.clearRect(0, 0, CARD_W, CARD_H)
      drawCard(ctx, { frame: null, art }, withPlacement(layoutFor(m), p), view)
      if (zones) drawZones(ctx, layoutFor(m), false)
      ctx.restore()
    })
    return () => cancelAnimationFrame(raf)
  }, [art, p, zones, c.name, c.category, m])

  const slider = (label: string, k: keyof Placement, min: number, max: number, step: number, show: (n: number) => string) => (
    <label className="placement-slider">
      {label} <input type="range" min={min} max={max} step={step} value={p[k]} data-testid={`placement-${k}`}
        onChange={(e) => setP(clamp({ ...p, [k]: Number(e.target.value) }))} /> {show(p[k])}
    </label>
  )

  return (
    <div className="fullart-check" data-testid={`fullart-check-${m}-${v}`}>
      {report.shapeOk
        ? <Notice kind="ok">Card shape (5:7). Nothing is cut off.</Notice>
        : <Notice kind="warn">
            Not the card's shape: {slot.width} x {slot.height} (the card is 5:7, 1500 x 2100). About {report.cut!.pct}% gets cut
            off the {report.cut!.sides}. Check the preview, or regenerate it at 5:7 with the template.
          </Notice>}
      {report.upscalePct > 5 && (
        <Notice kind="warn">Small: stretched {report.upscalePct}% to fill the card, so it may look soft. 1500 x 2100 or bigger is best.</Notice>
      )}
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
        <canvas ref={canvas} width={CARD_W} height={CARD_H} style={{ width: VIEW_W, height: (VIEW_W * CARD_H) / CARD_W }} className="checker" data-testid="placement-preview" />
        <div className="col" style={{ display: 'grid', gap: 6, minWidth: 220 }}>
          <span className="muted small">Red: where the text prints. Yellow: how far the worst edge wear reaches. Keep faces and key detail clear of both.</span>
          {slider('Zoom', 'zoom', 1, 2, 0.01, (n) => `${Math.round(n * 100)}%`)}
          {slider('Left / right', 'x', -400, 400, 2, (n) => `${n > 0 ? '+' : ''}${n}`)}
          {slider('Up / down', 'y', -400, 400, 2, (n) => `${n > 0 ? '+' : ''}${n}`)}
          <label className="check"><input type="checkbox" checked={zones} onChange={(e) => setZones(e.target.checked)} /> Show text areas</label>
          <div className="row" style={{ gap: 8 }}>
            <button disabled={!dirty || busy} data-testid="placement-save"
              onClick={() => void run(() => updateImagePlacement(c.id, m, v, p.zoom === 1 && p.x === 0 && p.y === 0 ? undefined : p))}>Save placement</button>
            <button className="link" disabled={busy || (p.zoom === 1 && p.x === 0 && p.y === 0)} onClick={() => setP(NONE)}>Reset</button>
          </div>
          {error && <Notice kind="error">{error}</Notice>}
        </div>
      </div>
    </div>
  )
}
