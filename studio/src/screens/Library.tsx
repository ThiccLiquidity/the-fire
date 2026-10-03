import { useEffect, useState } from 'react'
import { DropZone, Field, Notice, useAction } from '../components'
import { newId } from '../db'
import { CATEGORIES, CATEGORY_HINT, CATEGORY_LABEL, MATERIALS, MATERIAL_LABEL, type Category, type Material } from '../rules'
import {
  completeness, deleteCharacter, isReady, effectiveKey, removeCharacterImage, saveCharacter, setCharacterImage, updateImageKey,
  useBlobUrl, useStudio,
} from '../store'
import { VARIANTS, type Character, type ImageSlot, type Variant } from '../types'

export function Library() {
  const s = useStudio()
  const [selected, setSelected] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newShort, setNewShort] = useState('')
  const [busy, error, run] = useAction()
  const current = s.characters.find((c) => c.id === selected) ?? s.characters[0]

  const add = () => run(async () => {
    const name = newName.trim()
    if (!name) throw new Error('Give the character a name.')
    const now = Date.now()
    const c: Character = { id: newId(), name, shortId: newShort.trim(), images: {}, createdAt: now, updatedAt: now }
    await saveCharacter(c)
    setSelected(c.id)
    setNewName('')
    setNewShort('')
  })

  return (
    <div className="split">
      <aside className="panel list-panel">
        <h3>Characters</h3>
        <ul className="char-list" data-testid="char-list">
          {s.characters.map((c) => {
            const n = completeness(c)
            return (
              <li key={c.id} className={current?.id === c.id ? 'active' : ''} onClick={() => setSelected(c.id)}>
                <span className="char-name">{c.name}{c.shortId && <small> {c.shortId}</small>}</span>
                {c.placeholder && <span className="tag">placeholder</span>}
                <span className={`badge ${isReady(c) ? 'badge-ok' : 'badge-warn'}`}>{n}/10{c.category ? '' : ' · ?'}</span>
              </li>
            )
          })}
          {!s.characters.length && <li className="muted">No characters yet.</li>}
        </ul>
        <div className="add-form">
          <Field label="Name"><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Rabbit" data-testid="new-char-name" /></Field>
          <Field label="Short id (optional)"><input value={newShort} onChange={(e) => setNewShort(e.target.value)} placeholder="RAB" /></Field>
          <button onClick={add} disabled={busy} data-testid="add-char">Add character</button>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </aside>
      <section className="panel grow">
        {current ? <CharacterEditor key={current.id} c={current} /> : <p className="muted">Add a character, or load the sample assets from the Data tab.</p>}
      </section>
    </div>
  )
}

function CharacterEditor({ c }: { c: Character }) {
  const [name, setName] = useState(c.name)
  const [shortId, setShortId] = useState(c.shortId)
  const [category, setCategory] = useState<Category | ''>(c.category ?? '')
  const [busy, error, run] = useAction()
  const dirty = name !== c.name || shortId !== c.shortId || category !== (c.category ?? '')
  const n = completeness(c)
  return (
    <div>
      <div className="row wrap">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Short id"><input value={shortId} onChange={(e) => setShortId(e.target.value)} /></Field>
        <Field label="Category" hint={category ? CATEGORY_HINT[category] : 'first one that fits, top to bottom'}>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | '')} data-testid="category">
            <option value="">(pick one)</option>
            {CATEGORIES.map((k) => <option key={k} value={k}>{CATEGORY_LABEL[k]}</option>)}
          </select>
        </Field>
        <button disabled={!dirty || busy || !name.trim()} onClick={() => run(() => saveCharacter({ ...c, name: name.trim(), shortId: shortId.trim(), category: category || undefined }))}>Save</button>
        <span className="spacer" />
        <span className={`badge big ${n === 10 ? 'badge-ok' : 'badge-warn'}`} data-testid="completeness">{n}/10 images</span>
        <button className="danger" onClick={() => { if (confirm(`Delete ${c.name} and its images?`)) void run(() => deleteCharacter(c.id)) }}>Delete</button>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!isReady(c) && <Notice kind="info">A character can go into a Fire once all 10 images are in (5 materials x normal + holo) and it has a category.</Notice>}
      <div className="slot-grid">
        <div />
        {VARIANTS.map((v) => <div key={v} className="slot-head">{v === 'normal' ? 'Normal' : 'Holo'}</div>)}
        {MATERIALS.map((m) => (
          <SlotRow key={m} c={c} m={m} />
        ))}
      </div>
    </div>
  )
}

function SlotRow({ c, m }: { c: Character; m: Material }) {
  return (
    <>
      <div className="slot-label">{MATERIAL_LABEL[m]}</div>
      {VARIANTS.map((v) => <SlotCell key={v} c={c} m={m} v={v} slot={c.images[m]?.[v]} />)}
    </>
  )
}

function SlotCell({ c, m, v, slot }: { c: Character; m: Material; v: Variant; slot?: ImageSlot }) {
  const url = useBlobUrl(slot ? effectiveKey(slot) : undefined)
  const [busy, error, run] = useAction()
  const [tol, setTol] = useState(slot?.tolerance ?? 70)
  const [feather, setFeather] = useState(slot?.feather ?? 90)
  const [despill, setDespill] = useState(slot?.despill ?? 0.85)

  useEffect(() => {
    if (!slot) return
    setTol(slot.tolerance)
    setFeather(slot.feather)
    setDespill(slot.despill)
  }, [slot])

  // Re-key shortly after the sliders settle.
  useEffect(() => {
    if (!slot?.keyMagenta) return
    if (tol === slot.tolerance && feather === slot.feather && despill === slot.despill) return
    const t = setTimeout(() => void run(() => updateImageKey(c.id, m, v, { tolerance: tol, feather, despill })), 450)
    return () => clearTimeout(t)
  }, [tol, feather, despill])

  const upload = (files: File[]) => run(async () => {
    const f = files[0]
    if (!f.type.startsWith('image/')) throw new Error(`${f.name} isn't an image.`)
    await setCharacterImage(c.id, m, v, f, f.name)
  })

  return (
    <div className={`slot ${slot ? 'filled' : ''}`} data-testid={`slot-${m}-${v}`}>
      <DropZone onFiles={upload} accept="image/*" className="slot-drop">
        {url ? <img src={url} alt={`${c.name} ${m} ${v}`} className="checker" /> : <span className="muted">Drop image or click</span>}
        {busy && <span className="slot-busy">working...</span>}
      </DropZone>
      {slot && (
        <div className="slot-controls">
          <div className="muted small" title={slot.fileName}>{slot.fileName} · {slot.width}x{slot.height}</div>
          <label className="check">
            <input type="checkbox" checked={slot.keyMagenta} disabled={busy}
              onChange={(e) => void run(() => updateImageKey(c.id, m, v, { keyMagenta: e.target.checked }))} />
            Key out magenta
          </label>
          {slot.keyMagenta && (
            <div className="sliders">
              <label>Tolerance <input type="range" min={0} max={200} value={tol} onChange={(e) => setTol(Number(e.target.value))} /> {tol}</label>
              <label>Feather <input type="range" min={1} max={200} value={feather} onChange={(e) => setFeather(Number(e.target.value))} /> {feather}</label>
              <label>Despill <input type="range" min={0} max={1} step={0.05} value={despill} onChange={(e) => setDespill(Number(e.target.value))} /> {despill.toFixed(2)}</label>
            </div>
          )}
          <button className="link danger" onClick={() => void run(() => removeCharacterImage(c.id, m, v))}>Remove</button>
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  )
}
