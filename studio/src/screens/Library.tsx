import { useEffect, useId, useState } from 'react'
import { DropZone, Field, Notice, useAction } from '../components'
import { newId } from '../db'
import { categoryKey, categoryProblem, categorySuggestions, hasCategory, normalizeCategory } from '../categories'
import { MATERIALS, MATERIAL_LABEL, type Material } from '../rules'
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
                <span className={`badge ${isReady(c) ? 'badge-ok' : 'badge-warn'}`}>{n}/10{hasCategory(c) ? '' : ' · ?'}</span>
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
  const s = useStudio()
  const [name, setName] = useState(c.name)
  const [shortId, setShortId] = useState(c.shortId)
  const [category, setCategory] = useState(c.category ?? '')
  const [busy, error, run] = useAction()
  // the categories in use: the list builds up as categories are added
  const used = categorySuggestions(s.characters.map((x) => x.category))
  const typed = normalizeCategory(category)
  const problem = typed ? categoryProblem(typed) : null
  const matches = categoryMatches(used, category)
  // the same category in other capitalisation is saved with the spelling another character already uses
  const existing = categorySuggestions(s.characters.filter((x) => x.id !== c.id).map((x) => x.category))
    .find((u) => categoryKey(u) === categoryKey(typed))
  const finalCategory = typed ? existing ?? typed : undefined
  const dirty = name !== c.name || shortId !== c.shortId || finalCategory !== c.category
  const n = completeness(c)
  return (
    <div>
      <div className="row wrap">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Short id"><input value={shortId} onChange={(e) => setShortId(e.target.value)} /></Field>
        <CategoryInput value={category} onChange={setCategory} matches={matches} placeholder={used.length ? 'Type or pick' : 'Type a category'} invalid={!!problem} />
        <button disabled={!dirty || busy || !name.trim() || !!problem} onClick={() => run(async () => {
          await saveCharacter({ ...c, name: name.trim(), shortId: shortId.trim(), category: finalCategory })
          setCategory(finalCategory ?? '')
        })}>Save</button>
        <span className="spacer" />
        <span className={`badge big ${n === 10 ? 'badge-ok' : 'badge-warn'}`} data-testid="completeness">{n}/10 images</span>
        <button className="danger" onClick={() => { if (confirm(`Delete ${c.name} and its images?`)) void run(() => deleteCharacter(c.id)) }}>Delete</button>
      </div>
      {problem ? <p className="field-msg err" data-testid="category-problem">Category: {problem}</p>
        : existing && existing !== typed ? <p className="field-msg">Saved as "{existing}", the spelling already in use.</p>
        : typed && !existing && !matches.length && finalCategory !== c.category ? <p className="field-msg">New category: "{typed}".</p>
        : null}
      {error && <Notice kind="error">{error}</Notice>}
      {!isReady(c) && <Notice kind="info">A character can go into a Series once all 10 images are in (5 materials x normal + holo) and it has a category.</Notice>}
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

/** Free-text category with the categories already in use offered as you type (no preset list). */
function categoryMatches(used: string[], value: string): string[] {
  const key = categoryKey(value)
  return used.filter((u) => categoryKey(u).includes(key) && u !== normalizeCategory(value))
}

function CategoryInput({ value, onChange, matches, placeholder, invalid }: {
  value: string; onChange: (v: string) => void; matches: string[]; placeholder: string; invalid: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(-1)
  const pick = (v: string) => { onChange(v); setOpen(false); setHi(-1) }
  return (
    <div className="field cat-field">
      <label className="field-label" htmlFor={id}>Category</label>
      <input
        id={id} value={value} data-testid="category" autoComplete="off" spellCheck={false}
        placeholder={placeholder}
        aria-invalid={invalid} aria-autocomplete="list" aria-expanded={open && matches.length > 0}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHi(-1) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); if (value !== normalizeCategory(value)) onChange(normalizeCategory(value)) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && matches.length) { e.preventDefault(); setOpen(true); setHi((hi + 1) % matches.length) }
          else if (e.key === 'ArrowUp' && matches.length) { e.preventDefault(); setHi(hi <= 0 ? matches.length - 1 : hi - 1) }
          else if (e.key === 'Enter' && open && hi >= 0 && matches[hi]) { e.preventDefault(); pick(matches[hi]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && matches.length > 0 && (
        <ul className="suggest" role="listbox" data-testid="category-suggestions">
          {matches.map((m, i) => (
            <li key={m} role="option" aria-selected={i === hi} className={i === hi ? 'hi' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(m) }}>{m}</li>
          ))}
        </ul>
      )}
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
