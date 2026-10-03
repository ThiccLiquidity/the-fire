import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { DropZone, Field, Notice, NumberInput, useAction } from '../components'
import { BUILTIN_FRAMES, frameBlob } from '../frames'
import { getBlob } from '../db'
import type { DealtCard } from '../deal'
import { BUILTIN_FONTS, defaultLayout } from '../layoutDefaults'
import { cardView, drawCard } from '../render'
import { CARD_H, CARD_W, MATERIALS, MATERIAL_LABEL, holoTypeOf, type Material } from '../rules'
import {
  addFont, deleteFont, effectiveKey, fontFamilyCss, onBlobChanged, saveLayout, useStudio,
} from '../store'
import { TEXT_FIELDS, TEXT_FIELD_LABEL, VARIANTS, type Layout, type PsaBox, type Rect, type TextBox, type TextField, type Variant } from '../types'

type BoxId = 'art' | TextField | 'psa'
const BOX_LABEL: Record<BoxId, string> = { art: 'Art window', ...TEXT_FIELD_LABEL, psa: 'PSA badge' }
const BOX_IDS: BoxId[] = ['art', ...TEXT_FIELDS, 'psa']
/** The art window is fixed by the frames: shown, never moved. */
const LOCKED: BoxId[] = ['art']

export function Frames() {
  const [m, setM] = useState<Material>('paper')
  return (
    <div>
      <div className="subtabs">
        {MATERIALS.map((x) => (
          <button key={x} className={x === m ? 'active' : ''} onClick={() => setM(x)} data-testid={`mat-${x}`}>{MATERIAL_LABEL[x]}</button>
        ))}
      </div>
      <FrameGallery key={`f-${m}`} m={m} />
      <LayoutEditor key={`l-${m}`} m={m} />
      <FontManager />
    </div>
  )
}

function FrameGallery({ m }: { m: Material }) {
  return (
    <div className="panel">
      <h3>{MATERIAL_LABEL[m]} frames <span className="tag">built in · locked</span></h3>
      <p className="muted small">
        The collection's master frames. They ship with the studio and can't be uploaded or edited here; every frame shares the
        same art window and panels, so the layout below fits them all.
      </p>
      <div className="row wrap">
        {VARIANTS.map((v) => {
          const url = BUILTIN_FRAMES[m][v]
          return (
            <div key={v} className="frame-slot" data-testid={`frame-${m}-${v}`}>
              <div className="slot-head">{v === 'normal' ? 'Normal frame' : 'Holo frame'}</div>
              <div className="frame-drop">
                {url ? <img src={url} className="checker" alt={`${m} ${v} frame`} /> : <span className="muted">Not delivered yet</span>}
              </div>
              {!url && <Notice kind="warn">Missing. Fires that deal this card can't be approved until it's added.</Notice>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Decoded bitmap of a built-in frame. */
function useFrameBitmap(m: Material, v: Variant): ImageBitmap | null {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null)
  useEffect(() => {
    let live = true
    let made: ImageBitmap | null = null
    setBmp(null)
    // a missing holo frame previews with the normal one, like the renderer
    const p = frameBlob(m, v) ?? frameBlob(m, 'normal')
    void p?.then(async (b) => {
      if (!live) return
      made = await createImageBitmap(b)
      if (live) setBmp(made)
      else made.close()
    })
    return () => { live = false; made?.close() }
  }, [m, v])
  return bmp
}

/** Decoded bitmap for a stored blob, refreshed when the blob changes. */
function useBitmap(key: string | undefined): ImageBitmap | null {
  const [bmp, setBmp] = useState<ImageBitmap | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => onBlobChanged((k) => { if (k === key) setTick((t) => t + 1) }), [key])
  useEffect(() => {
    let live = true
    let made: ImageBitmap | null = null
    if (!key) { setBmp(null); return }
    void getBlob(key).then(async (b) => {
      if (!b || !live) return
      made = await createImageBitmap(b)
      if (live) setBmp(made)
      else made.close()
    })
    return () => { live = false; made?.close() }
  }, [key, tick])
  return bmp
}

function LayoutEditor({ m }: { m: Material }) {
  const s = useStudio()
  const saved = s.layouts[m]
  const [layout, setLayout] = useState<Layout>(saved)
  const [sel, setSel] = useState<BoxId>('name')
  const [charId, setCharId] = useState<string>('')
  const [frameHolo, setFrameHolo] = useState(false)
  const [picHolo, setPicHolo] = useState(false)
  const [showBoxes, setShowBoxes] = useState(true)
  const [busy, error, run] = useAction()
  const [savedMsg, setSavedMsg] = useState('')
  const dirty = JSON.stringify({ ...layout, updatedAt: 0 }) !== JSON.stringify({ ...saved, updatedAt: 0 })

  const char = s.characters.find((c) => c.id === charId) ?? s.characters[0]
  const artSlot = char?.images[m]?.[picHolo ? 'holo' : 'normal'] ?? char?.images[m]?.normal
  const frameBmp = useFrameBitmap(m, frameHolo ? 'holo' : 'normal')
  const artBmp = useBitmap(artSlot ? effectiveKey(artSlot) : undefined)

  const canvas = useRef<HTMLCanvasElement>(null)
  const sampleCard: DealtCard = useMemo(() => ({
    serial: 1234, fire: Math.max(1, s.global.nextFireNumber - 1), pack: 1, slot: 1, material: m, characterId: char?.id ?? '',
    holoFrame: frameHolo, holoPicture: picHolo, holo: holoTypeOf(frameHolo, picHolo), edition: 12, editionOf: 43,
  }), [m, char?.id, frameHolo, picHolo, s.global.nextFireNumber])

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const raf = requestAnimationFrame(() => drawCard(ctx, { frame: frameBmp, art: artBmp }, layout, cardView(sampleCard, char?.name ?? 'Character Name')))
    return () => cancelAnimationFrame(raf)
  }, [layout, frameBmp, artBmp, sampleCard, char?.name, s.fonts])

  const rectOf = (id: BoxId): Rect => (id === 'art' ? layout.art.box : id === 'psa' ? layout.psa.box : layout.text[id].box)
  const setRect = (id: BoxId, r: Rect) => setLayout((l) => {
    if (id === 'art') return { ...l, art: { ...l.art, box: r } }
    if (id === 'psa') return { ...l, psa: { ...l.psa, box: r } }
    return { ...l, text: { ...l.text, [id]: { ...l.text[id], box: r } } }
  })

  // drag / resize in card coordinates
  const overlay = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: BoxId; mode: 'move' | 'resize'; sx: number; sy: number; start: Rect } | null>(null)
  const scale = () => (overlay.current ? overlay.current.clientWidth / CARD_W : 1)
  const onDown = (id: BoxId, mode: 'move' | 'resize') => (e: RPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setSel(id)
    if (LOCKED.includes(id)) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { id, mode, sx: e.clientX, sy: e.clientY, start: rectOf(id) }
  }
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const k = scale()
    const dx = Math.round((e.clientX - d.sx) / k)
    const dy = Math.round((e.clientY - d.sy) / k)
    const r = d.start
    if (d.mode === 'move') {
      setRect(d.id, { ...r, x: clamp(r.x + dx, -r.w + 20, CARD_W - 20), y: clamp(r.y + dy, -r.h + 20, CARD_H - 20) })
    } else {
      setRect(d.id, { ...r, w: Math.max(20, r.w + dx), h: Math.max(20, r.h + dy) })
    }
  }
  const onUp = () => { drag.current = null }

  const fontOptions = [...BUILTIN_FONTS, ...s.fonts.map((f) => ({ label: `${f.fileName} (uploaded)`, css: fontFamilyCss(f) }))]

  const copyToAll = () => run(async () => {
    if (!confirm(`Copy this ${MATERIAL_LABEL[m]} layout to all other materials (overwriting theirs)?`)) return
    for (const other of MATERIALS) if (other !== m) await saveLayout({ ...layout, material: other })
    await saveLayout(layout)
    setSavedMsg('Copied to all materials and saved.')
  })

  return (
    <div className="panel">
      <div className="row wrap">
        <h3>{MATERIAL_LABEL[m]} layout</h3>
        <span className="spacer" />
        <Field label="Preview character">
          <select value={char?.id ?? ''} onChange={(e) => setCharId(e.target.value)}>
            {s.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            {!s.characters.length && <option value="">(none)</option>}
          </select>
        </Field>
        <label className="check"><input type="checkbox" checked={frameHolo} onChange={(e) => setFrameHolo(e.target.checked)} /> holo frame</label>
        <label className="check"><input type="checkbox" checked={picHolo} onChange={(e) => setPicHolo(e.target.checked)} /> holo picture</label>
        <label className="check"><input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} /> show boxes</label>
      </div>
      <div className="editor">
        <div className="editor-stage">
          <div className="stage" ref={overlay} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} data-testid="layout-stage">
            <canvas ref={canvas} width={CARD_W} height={CARD_H} className="checker" />
            {showBoxes && BOX_IDS.map((id) => {
              const r = rectOf(id)
              return (
                <div
                  key={id}
                  className={`lbox ${id === sel ? 'sel' : ''} ${id === 'art' ? 'art' : ''}`}
                  style={{ left: `${(r.x / CARD_W) * 100}%`, top: `${(r.y / CARD_H) * 100}%`, width: `${(r.w / CARD_W) * 100}%`, height: `${(r.h / CARD_H) * 100}%` }}
                  onPointerDown={onDown(id, 'move')}
                  data-testid={`lbox-${id}`}
                >
                  <span className="lbox-label">{BOX_LABEL[id]}</span>
                  {!LOCKED.includes(id) && <span className="lbox-handle" onPointerDown={onDown(id, 'resize')} />}
                </div>
              )
            })}
          </div>
        </div>
        <div className="editor-props">
          <div className="box-pick">
            {BOX_IDS.map((id) => <button key={id} className={id === sel ? 'active' : ''} onClick={() => setSel(id)}>{BOX_LABEL[id]}</button>)}
          </div>
          {LOCKED.includes(sel)
            ? <p className="muted small">Art window: fixed by the frames ({layout.art.box.w} x {layout.art.box.h} at {layout.art.box.x}, {layout.art.box.y}).</p>
            : <RectFields r={rectOf(sel)} onChange={(r) => setRect(sel, r)} />}
          {sel === 'art' && (
            <>
              <div className="row wrap">
                <Field label="Fit">
                  <select value={layout.art.fit} onChange={(e) => setLayout({ ...layout, art: { ...layout.art, fit: e.target.value as 'cover' | 'contain' } })}>
                    <option value="cover">Cover (fill window, crop)</option>
                    <option value="contain">Contain (whole image)</option>
                  </select>
                </Field>
                <Field label="Scale"><NumberInput step={0.01} min={0.1} max={5} value={layout.art.scale} onChange={(n) => setLayout({ ...layout, art: { ...layout.art, scale: n } })} /></Field>
                <Field label="Offset X"><NumberInput value={layout.art.offsetX} onChange={(n) => setLayout({ ...layout, art: { ...layout.art, offsetX: n } })} /></Field>
                <Field label="Offset Y"><NumberInput value={layout.art.offsetY} onChange={(n) => setLayout({ ...layout, art: { ...layout.art, offsetY: n } })} /></Field>
              </div>
              <div className="row wrap">
                <label className="check">
                  <input type="checkbox" checked={!!layout.art.background} onChange={(e) => setLayout({ ...layout, art: { ...layout.art, background: e.target.checked ? '#f3efe6' : '' } })} />
                  Fill the window behind the art
                </label>
                {layout.art.background && <input type="color" value={layout.art.background} onChange={(e) => setLayout({ ...layout, art: { ...layout.art, background: e.target.value } })} />}
              </div>
              <div className="row wrap nudge">
                {([['←', -10, 0], ['→', 10, 0], ['↑', 0, -10], ['↓', 0, 10]] as const).map(([t, dx, dy]) => (
                  <button key={t} onClick={() => setLayout({ ...layout, art: { ...layout.art, offsetX: layout.art.offsetX + dx, offsetY: layout.art.offsetY + dy } })}>{t}</button>
                ))}
                <button onClick={() => setLayout({ ...layout, art: { ...layout.art, scale: +(layout.art.scale * 1.05).toFixed(3) } })}>zoom +</button>
                <button onClick={() => setLayout({ ...layout, art: { ...layout.art, scale: +(layout.art.scale / 1.05).toFixed(3) } })}>zoom -</button>
              </div>
            </>
          )}
          {sel !== 'art' && (
            <TextFields
              tb={sel === 'psa' ? layout.psa : layout.text[sel]}
              fontOptions={fontOptions}
              onChange={(tb) => setLayout((l) => (sel === 'psa' ? { ...l, psa: tb as PsaBox } : { ...l, text: { ...l.text, [sel]: tb } }))}
              psa={sel === 'psa'}
            />
          )}
          <div className="row wrap sticky-actions">
            <button className="primary" disabled={!dirty || busy} onClick={() => run(async () => { await saveLayout(layout); setSavedMsg('Saved.') })} data-testid="save-layout">
              Save {MATERIAL_LABEL[m]} layout
            </button>
            <button disabled={!dirty} onClick={() => setLayout(saved)}>Revert</button>
            <button onClick={() => setLayout({ ...defaultLayout(m), updatedAt: saved.updatedAt })}>Defaults</button>
            <button onClick={copyToAll} disabled={busy}>Copy to all materials</button>
          </div>
          {dirty && <Notice kind="warn">Unsaved changes.</Notice>}
          {!dirty && savedMsg && <Notice kind="ok">{savedMsg}</Notice>}
          {error && <Notice kind="error">{error}</Notice>}
        </div>
      </div>
    </div>
  )
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function RectFields({ r, onChange }: { r: Rect; onChange: (r: Rect) => void }) {
  return (
    <div className="row wrap">
      <Field label="X"><NumberInput value={r.x} onChange={(x) => onChange({ ...r, x })} /></Field>
      <Field label="Y"><NumberInput value={r.y} onChange={(y) => onChange({ ...r, y })} /></Field>
      <Field label="W"><NumberInput min={1} value={r.w} onChange={(w) => onChange({ ...r, w: Math.max(1, w) })} /></Field>
      <Field label="H"><NumberInput min={1} value={r.h} onChange={(h) => onChange({ ...r, h: Math.max(1, h) })} /></Field>
    </div>
  )
}

function TextFields({ tb, onChange, fontOptions, psa }: {
  tb: TextBox | PsaBox
  onChange: (tb: TextBox | PsaBox) => void
  fontOptions: { label: string; css: string }[]
  psa: boolean
}) {
  const st = tb.style
  const set = (patch: Partial<TextBox['style']>) => onChange({ ...tb, style: { ...st, ...patch } })
  const known = fontOptions.some((f) => f.css === st.font)
  return (
    <div className="text-fields">
      <label className="check"><input type="checkbox" checked={tb.visible} onChange={(e) => onChange({ ...tb, visible: e.target.checked })} /> visible</label>
      <Field label="Font">
        <select value={st.font} onChange={(e) => set({ font: e.target.value })} data-testid="font-select">
          {!known && <option value={st.font}>{st.font} (missing)</option>}
          {fontOptions.map((f) => <option key={f.css} value={f.css}>{f.label}</option>)}
        </select>
      </Field>
      <div className="row wrap">
        <Field label="Max size (px)" hint="shrinks to fit the box"><NumberInput min={4} value={st.size} onChange={(n) => set({ size: Math.max(4, n) })} /></Field>
        <Field label="Min size (px)"><NumberInput min={4} value={st.minSize} onChange={(n) => set({ minSize: Math.max(4, n) })} /></Field>
        <label className="check"><input type="checkbox" checked={st.bold} onChange={(e) => set({ bold: e.target.checked })} /> bold</label>
        <label className="check"><input type="checkbox" checked={st.italic} onChange={(e) => set({ italic: e.target.checked })} /> italic</label>
        <label className="check"><input type="checkbox" checked={st.uppercase} onChange={(e) => set({ uppercase: e.target.checked })} /> UPPERCASE</label>
      </div>
      <div className="row wrap">
        <Field label="Colour"><input type="color" value={st.color} onChange={(e) => set({ color: e.target.value })} /></Field>
        <Field label="Outline"><input type="color" value={st.outlineColor} onChange={(e) => set({ outlineColor: e.target.value })} /></Field>
        <Field label="Outline width"><NumberInput min={0} value={st.outlineWidth} onChange={(n) => set({ outlineWidth: Math.max(0, n) })} /></Field>
        <Field label="Align">
          <select value={st.align} onChange={(e) => set({ align: e.target.value as TextBox['style']['align'] })}>
            <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
        </Field>
      </div>
      {psa && 'fill' in tb && (
        <div className="row wrap">
          <Field label="Badge fill"><input type="color" value={tb.fill} onChange={(e) => onChange({ ...tb, fill: e.target.value })} /></Field>
          <Field label="Badge border"><input type="color" value={tb.border} onChange={(e) => onChange({ ...tb, border: e.target.value })} /></Field>
          <Field label="Border width"><NumberInput min={0} value={tb.borderWidth} onChange={(n) => onChange({ ...tb, borderWidth: Math.max(0, n) })} /></Field>
          <Field label="Corner radius"><NumberInput min={0} value={tb.radius} onChange={(n) => onChange({ ...tb, radius: Math.max(0, n) })} /></Field>
        </div>
      )}
    </div>
  )
}

function FontManager() {
  const s = useStudio()
  const [busy, error, run] = useAction()
  return (
    <div className="panel">
      <h3>Fonts</h3>
      <p className="muted small">Built-in choices are web-safe system fonts (nothing is downloaded). Upload .ttf / .otf / .woff2 / .woff to use your own; they're stored with the library.</p>
      <DropZone accept=".ttf,.otf,.woff2,.woff,font/*" className="font-drop" testId="font-input"
        onFiles={(files) => run(async () => { for (const f of files) await addFont(f) })}>
        <span className="muted">{busy ? 'Loading font...' : 'Drop a font file or click'}</span>
      </DropZone>
      <ul className="font-list">
        {s.fonts.map((f) => (
          <li key={f.id}>
            <span style={{ fontFamily: fontFamilyCss(f), fontSize: 22 }}>{f.fileName} AaBb 0123</span>
            <button className="link danger" onClick={() => void run(() => deleteFont(f.id))}>Remove</button>
          </li>
        ))}
      </ul>
      {error && <Notice kind="error">Font error: {error}</Notice>}
    </div>
  )
}
