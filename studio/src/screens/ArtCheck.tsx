/** The art safety net in the Library, for every frame set: the template to give the image generator, a size check on
 *  each uploaded image, and a live preview of the card (in its frame, or the whole card for Full Art, with the print
 *  zones outlined) where the art can be zoomed and moved for this character. */

import { useEffect, useRef, useState } from 'react'
import { Notice, useAction } from '../components'
import { FULL_CARD_ART_SETS, artBoxOf, frameBlob, frameSetLabel, variantsOf } from '../frames'
import { matchHoloToNormal } from '../artMatch'
import { drawZones, fitReport, fullArtTemplateBlob, windowTemplateBlob } from '../artGuide'
import { cardView, drawCard, solidFullCardArt, withPlacement } from '../render'
import { CARD_H, CARD_W } from '../rules'
import { effectiveKey, getStudio, layoutFor, updateImagePlacement, useStudio } from '../store'
import { getBlob } from '../db'
import type { Character, ImageSlot, Placement, Variant } from '../types'

const VIEW_W = 420
const NONE: Placement = { zoom: 1, x: 0, y: 0 }
const isNone = (p: Placement) => p.zoom === 1 && p.x === 0 && p.y === 0

export function TemplateButton({ m }: { m: string }) {
  const [busy, error, run] = useAction()
  const box = artBoxOf(m)
  const download = () => run(async () => {
    const blob = FULL_CARD_ART_SETS.includes(m) ? await fullArtTemplateBlob(layoutFor(m)) : await windowTemplateBlob(box)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${m}-template-${box.w}x${box.h}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  })
  return (
    <>
      <button className="link" onClick={download} disabled={busy} data-testid={`template-${m}`}>Template</button>
      {error && <Notice kind="error">{error}</Notice>}
    </>
  )
}

/** The size check's verdict for an image in a frame set, in a few words (for the slot badge). */
export function artVerdict(m: string, slot: ImageSlot): { ok: boolean; text: string } {
  const box = artBoxOf(m)
  const r = fitReport(slot.width, slot.height, box)
  if (!r.shapeOk) return { ok: false, text: `${r.cut!.pct}% cut off` }
  if (r.upscalePct > 5) return { ok: false, text: 'small, may look soft' }
  return { ok: true, text: 'size OK' }
}

export function ArtCheck({ c, m, v, slot }: { c: Character; m: string; v: Variant; slot: ImageSlot }) {
  useStudio()
  const fullCard = FULL_CARD_ART_SETS.includes(m)
  const box = artBoxOf(m)
  const report = fitReport(slot.width, slot.height, box)
  const saved = slot.placement ?? NONE
  const [p, setP] = useState<Placement>(saved)
  const [zones, setZones] = useState(true)
  const [art, setArt] = useState<ImageBitmap | null>(null)
  const [frame, setFrame] = useState<ImageBitmap | null>(null)
  const [busy, error, run] = useAction()
  const [matchMsg, setMatchMsg] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const normalSlot = v === 'holo' && variantsOf(m).includes('normal') ? c.images[m]?.normal : undefined
  const matchNormal = () => run(async () => {
    if (!normalSlot) return
    setMatchMsg(null)
    await new Promise((r) => setTimeout(r, 30)) // let "Matching..." paint before the search runs
    const r = await matchHoloToNormal(c.id, m)
    if (r.kind === 'different') {
      setMatchMsg({ kind: 'warn', text: "Couldn't line it up: the holo doesn't look like the same drawing. Drag it into place." })
      return
    }
    if (r.kind !== 'matched') return
    setP(r.placement)
    setMatchMsg(r.exact
      ? { kind: 'ok', text: 'Lined up with the normal art. Check the preview, then Save placement.' }
      : { kind: 'warn', text: 'Lined up as close as it goes: the holo is drawn smaller, so it can only zoom so far without leaving a gap. Check the preview, then Save placement.' })
  })
  const key = effectiveKey(slot)
  const dirty = p.zoom !== saved.zoom || p.x !== saved.x || p.y !== saved.y
  const shape = fullCard ? '5:7, 1500 x 2100' : `square, ${box.w} x ${box.h}`
  // the art always covers its window: a move can't go past its edge
  // free to move and zoom (bright green shows any gap); just kept on the card
  const clamp = (n: Placement): Placement => ({
    zoom: n.zoom, x: Math.round(Math.max(-box.w, Math.min(box.w, n.x))), y: Math.round(Math.max(-box.h, Math.min(box.h, n.y))),
  })
  // does the art cover its whole window at this placement?
  const covers = (() => {
    if (!art) return true
    const s = Math.max(box.w / art.width, box.h / art.height) * p.zoom
    const mx = (art.width * s - box.w) / 2, my = (art.height * s - box.h) / 2
    return mx >= -0.5 && my >= -0.5 && Math.abs(p.x) <= mx + 0.5 && Math.abs(p.y) <= my + 0.5
  })()

  useEffect(() => { setP(slot.placement ?? NONE) }, [slot.placement])

  // drag the art on the preview to move it; the scroll wheel zooms (card px = screen px x CARD_W / VIEW_W)
  const drag = useRef<{ sx: number; sy: number; start: Placement } | null>(null)
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY, start: p }
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) return
    const k = CARD_W / VIEW_W
    setP(clamp({ ...d.start, x: d.start.x + (e.clientX - d.sx) * k, y: d.start.y + (e.clientY - d.sy) * k }))
  }
  const onUp = () => { drag.current = null }
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      setP((q) => clamp({ ...q, zoom: Math.min(2, Math.max(0.5, +(q.zoom * (e.deltaY < 0 ? 1.03 : 1 / 1.03)).toFixed(3))) }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  })

  useEffect(() => {
    let live = true
    let made: ImageBitmap | null = null
    void getBlob(key).then(async (b) => {
      if (!b || !live) return
      const full = await createImageBitmap(b)
      made = fullCard ? await solidFullCardArt(full) : full
      if (made !== full) full.close()
      if (live) setArt(made)
      else made.close()
    })
    return () => { live = false; made?.close() }
  }, [key, fullCard])

  useEffect(() => {
    let live = true
    let made: ImageBitmap | null = null
    setFrame(null)
    void frameBlob(m, v)?.then(async (b) => {
      made = await createImageBitmap(b)
      if (live) setFrame(made)
      else made.close()
    })
    return () => { live = false; made?.close() }
  }, [m, v])

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const raf = requestAnimationFrame(() => {
      const fire = Math.max(1, getStudio().global.nextFireNumber - 1)
      const view = cardView({ frameSet: m, typeName: frameSetLabel(m), grade: null, fire, holoFrame: v === 'holo', holoPicture: v === 'holo' }, c.name, c.category)
      ctx.save()
      ctx.clearRect(0, 0, CARD_W, CARD_H)
      const l = withPlacement(layoutFor(m), p)
      drawCard(ctx, { frame, art }, { ...l, art: { ...l.art, background: '' } }, view)
      // bright green behind everything, so any gap round the art (or a see-through spot in the frame) stands out
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#00ff3c'
      ctx.fillRect(0, 0, CARD_W, CARD_H)
      ctx.globalCompositeOperation = 'source-over'
      if (zones && fullCard) drawZones(ctx, layoutFor(m), false)
      ctx.restore()
    })
    return () => cancelAnimationFrame(raf)
  }, [art, frame, p, zones, c.name, c.category, m, v, fullCard])

  const slider = (label: string, k: keyof Placement, min: number, max: number, step: number, show: (n: number) => string) => (
    <label className="placement-slider">
      {label} <input type="range" min={min} max={max} step={step} value={p[k]} data-testid={`placement-${k}`}
        onChange={(e) => setP(clamp({ ...p, [k]: Number(e.target.value) }))} /> {show(p[k])}
    </label>
  )

  return (
    <div className="art-check" data-testid={`art-check-${m}-${v}`}>
      {report.shapeOk
        ? <Notice kind="ok">Right shape ({shape}). Nothing is cut off.</Notice>
        : <Notice kind="warn">
            Not the right shape: {slot.width} x {slot.height} (this art is {shape}). About {report.cut!.pct}% gets cut off the{' '}
            {report.cut!.sides}. Check the preview and frame it below, or regenerate it with the template.
          </Notice>}
      {report.upscalePct > 5 && (
        <Notice kind="warn">Small: stretched {report.upscalePct}% to fill, so it may look soft. {box.w} x {box.h} or bigger is best.</Notice>
      )}
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
        <canvas ref={canvas} width={CARD_W} height={CARD_H} className="checker" data-testid="placement-preview"
          style={{ width: VIEW_W, height: (VIEW_W * CARD_H) / CARD_W, cursor: 'grab', touchAction: 'none' }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        <div style={{ display: 'grid', gap: 6, minWidth: 220 }}>
          {fullCard && <span className="muted small">Red: where the text prints. Yellow: how far the worst edge wear reaches. Keep faces and key detail clear of both.</span>}
          <span className="muted small">Drag the picture to move it, scroll to zoom. {fullCard ? '' : `Exactly how it sits in the ${frameSetLabel(m)} frame.`}</span>
          {slider('Zoom', 'zoom', 0.5, 2, 0.01, (n) => `${Math.round(n * 100)}%`)}
          {slider('Left / right', 'x', -400, 400, 2, (n) => `${n > 0 ? '+' : ''}${n}`)}
          {slider('Up / down', 'y', -400, 400, 2, (n) => `${n > 0 ? '+' : ''}${n}`)}
          {fullCard && <label className="check"><input type="checkbox" checked={zones} onChange={(e) => setZones(e.target.checked)} /> Show text areas</label>}
          {normalSlot && (
            <button onClick={() => void matchNormal()} disabled={busy} data-testid="match-normal">{busy ? 'Matching...' : 'Match normal'}</button>
          )}
          {!covers && <Notice kind="warn">Gap: the picture doesn't fill the window (the green). Zoom in or move it.</Notice>}
          {matchMsg && <Notice kind={matchMsg.kind}>{matchMsg.text}</Notice>}
          <div className="row" style={{ gap: 8 }}>
            <button disabled={!dirty || busy} data-testid="placement-save"
              onClick={() => void run(() => updateImagePlacement(c.id, m, v, isNone(p) ? undefined : p))}>Save placement</button>
            <button className="link" disabled={busy || isNone(p)} onClick={() => setP(NONE)}>Reset</button>
          </div>
          {error && <Notice kind="error">{error}</Notice>}
        </div>
      </div>
    </div>
  )
}
