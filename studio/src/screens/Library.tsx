import { useEffect, useId, useMemo, useState } from 'react'
import { DropZone, Field, Notice, useAction } from '../components'
import { newId } from '../db'
import { categoryKey, categoryProblem, categorySuggestions, hasCategory, hasValidName, nameProblem, normalizeCategory, normalizeName } from '../categories'
import { FRAME_SETS, frameSetLabel, variantsOf } from '../frames'
import {
  completeness, deleteCharacter, getStudio, imageSlots, isReady, effectiveKey, removeCharacterImage, saveCharacter, setCharacterImage, updateImageKey,
  useBlobUrl, useStudio,
} from '../store'
import { VARIANTS, type Character, type ImageSlot, type Variant } from '../types'

const PAGE = 200

export function Library() {
  const s = useStudio()
  const [selected, setSelected] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newShort, setNewShort] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [busy, error, run] = useAction()
  const current = s.characters.find((c) => c.id === selected) ?? s.characters[0]
  const total = imageSlots()
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? s.characters.filter((c) => c.name.toLowerCase().includes(q) || c.shortId.toLowerCase().includes(q) || (c.category ?? '').toLowerCase().includes(q)) : s.characters
  }, [s.characters, query])
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const shown = list.slice(page * PAGE, page * PAGE + PAGE)

  // inline check only once something is typed (an empty box isn't an error yet)
  const newNameProblem = newName ? nameProblem(normalizeName(newName)) : null
  const add = () => run(async () => {
    const name = normalizeName(newName)
    const problem = nameProblem(name)
    if (problem) throw new Error(`Name: ${problem}`)
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
        <h3>Characters ({s.characters.length.toLocaleString()})</h3>
        <input placeholder="Search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} data-testid="lib-search" style={{ width: '100%' }} />
        <ul className="char-list scroll" data-testid="char-list">
          {shown.map((c) => {
            const n = completeness(c)
            return (
              <li key={c.id} className={current?.id === c.id ? 'active' : ''} onClick={() => setSelected(c.id)}>
                <span className="char-name">{c.name}{c.shortId && <small> {c.shortId}</small>}</span>
                {c.placeholder && <span className="tag">placeholder</span>}
                <span className={`badge ${isReady(c) ? 'badge-ok' : 'badge-warn'}`}>{n}/{total}{hasCategory(c) && hasValidName(c) ? '' : ' · ?'}</span>
              </li>
            )
          })}
          {!s.characters.length && <li className="muted">No characters yet.</li>}
        </ul>
        {pages > 1 && (
          <div className="row">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
            <span className="muted small">{page + 1} / {pages}</span>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
        <div className="add-form">
          <Field label="Name"><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Rabbit" aria-invalid={!!newNameProblem} data-testid="new-char-name" /></Field>
          {newNameProblem && <p className="field-msg err" data-testid="new-name-problem">Name: {newNameProblem}</p>}
          <Field label="Short id (optional)"><input value={newShort} onChange={(e) => setNewShort(e.target.value)} placeholder="RAB" /></Field>
          <button onClick={add} disabled={busy || !!newNameProblem} data-testid="add-char">Add character</button>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <BulkTools />
      </aside>
      <section className="panel grow">
        {current ? <CharacterEditor key={current.id} c={current} /> : <p className="muted">Add a character, or load the sample assets from the Data tab.</p>}
      </section>
    </div>
  )
}

/** For hundreds of characters: add many at once from a list, and drop many images at once named by character and
 *  frame set. */
function BulkTools() {
  const [text, setText] = useState('')
  const [report, setReport] = useState<string[]>([])
  const [busy, error, run] = useAction()
  const addMany = () => run(async () => {
    const out: string[] = []
    const existing = new Set(getStudio().characters.map((c) => c.name.toLowerCase()))
    let added = 0
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      const [rawName, ...rest] = line.split(/[,\t]/)
      const name = normalizeName(rawName)
      const category = normalizeCategory(rest.join(','))
      const np = nameProblem(name)
      if (np) { out.push(`"${line.trim()}": ${np}`); continue }
      if (category && categoryProblem(category)) { out.push(`"${name}": category ${categoryProblem(category)}`); continue }
      if (existing.has(name.toLowerCase())) { out.push(`"${name}" is already in the library (skipped).`); continue }
      const now = Date.now()
      await saveCharacter({ id: newId(), name, shortId: '', ...(category ? { category } : {}), images: {}, createdAt: now + added, updatedAt: now })
      existing.add(name.toLowerCase())
      added++
    }
    setReport([`Added ${added} character${added === 1 ? '' : 's'}.`, ...out])
    if (added) setText('')
  })
  const dropImages = (files: File[]) => run(async () => {
    const out: string[] = []
    const chars = getStudio().characters
    const byName = new Map<string, string>()
    for (const c of chars) {
      byName.set(c.name.toLowerCase(), c.id)
      if (c.shortId) byName.set(c.shortId.toLowerCase(), c.id)
    }
    let done = 0
    for (const f of files) {
      // <character>__<frame set>[__holo].<ext>
      const m = /^(.+?)__([a-z0-9]+)(__holo)?\.[a-z0-9]+$/i.exec(f.name)
      if (!m) { out.push(`${f.name}: name it <character>__<frame set>[__holo].png`); continue }
      const id = byName.get(m[1].trim().toLowerCase())
      const set = m[2].toLowerCase()
      if (!id) { out.push(`${f.name}: no character "${m[1]}"`); continue }
      if (!FRAME_SETS.includes(set)) { out.push(`${f.name}: no frame set "${set}" (${FRAME_SETS.join(', ')})`); continue }
      if (!f.type.startsWith('image/')) { out.push(`${f.name}: not an image`); continue }
      await setCharacterImage(id, set, m[3] ? 'holo' : 'normal', f, f.name)
      done++
    }
    setReport([`Added ${done} of ${files.length} images.`, ...out])
  })
  return (
    <details className="bulk" data-testid="bulk-tools">
      <summary>Add many</summary>
      <p className="muted small">One character per line: <code>Name, Category</code>.</p>
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Ember Fox, Animals\nAsh Wolf, Animals'} data-testid="bulk-names" />
      <button onClick={addMany} disabled={busy || !text.trim()} data-testid="bulk-add">Add these</button>
      <p className="muted small">Images: drop many files named <code>&lt;character&gt;__&lt;frame set&gt;.png</code> or <code>..__holo.png</code>, e.g. <code>Ember Fox__paper__holo.png</code>. Frame sets: {FRAME_SETS.join(', ')}.</p>
      <DropZone accept="image/*" multiple onFiles={dropImages} className="inline-drop" testId="bulk-images"><span>Drop images or click</span></DropZone>
      {busy && <span className="muted small">working...</span>}
      {error && <Notice kind="error">{error}</Notice>}
      {report.length > 0 && <ul className="small problems">{report.slice(0, 30).map((x, i) => <li key={i}>{x}</li>)}{report.length > 30 && <li>... {report.length - 30} more</li>}</ul>}
    </details>
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
  const namedProblem = nameProblem(normalizeName(name))
  const dirty = name !== c.name || shortId !== c.shortId || finalCategory !== c.category
  const n = completeness(c)
  return (
    <div>
      <div className="row wrap">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!namedProblem} data-testid="char-name" /></Field>
        <Field label="Short id"><input value={shortId} onChange={(e) => setShortId(e.target.value)} /></Field>
        <CategoryInput value={category} onChange={setCategory} matches={matches} placeholder={used.length ? 'Type or pick' : 'Type a category'} invalid={!!problem} />
        <button disabled={!dirty || busy || !!namedProblem || !!problem} onClick={() => run(async () => {
          await saveCharacter({ ...c, name: normalizeName(name), shortId: shortId.trim(), category: finalCategory })
          setCategory(finalCategory ?? '')
        })}>Save</button>
        <span className="spacer" />
        <span className={`badge big ${n === imageSlots() ? 'badge-ok' : 'badge-warn'}`} data-testid="completeness">{n}/{imageSlots()} images</span>
        <button className="danger" onClick={() => { if (confirm(`Delete ${c.name} and its images?`)) void run(() => deleteCharacter(c.id)) }}>Delete</button>
      </div>
      {namedProblem && <p className="field-msg err" data-testid="name-problem">Name: {namedProblem}</p>}
      {problem ? <p className="field-msg err" data-testid="category-problem">Category: {problem}</p>
        : existing && existing !== typed ? <p className="field-msg">Saved as "{existing}", the spelling already in use.</p>
        : typed && !existing && !matches.length && finalCategory !== c.category ? <p className="field-msg">New category: "{typed}".</p>
        : null}
      {error && <Notice kind="error">{error}</Notice>}
      {!isReady(c) && <Notice kind="info">A character can go into a Series once it has a valid name and category and the images that Series' recipe uses (each card type uses one frame set's art: normal, and holo when it can have a holo picture).</Notice>}
      <div className="slot-grid">
        <div />
        {VARIANTS.map((v) => <div key={v} className="slot-head">{v === 'normal' ? 'Normal' : 'Holo'}</div>)}
        {FRAME_SETS.map((m) => (
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

function SlotRow({ c, m }: { c: Character; m: string }) {
  return (
    <>
      <div className="slot-label">{frameSetLabel(m)}</div>
      {VARIANTS.map((v) => variantsOf(m).includes(v)
        ? <SlotCell key={v} c={c} m={m} v={v} slot={c.images[m]?.[v]} />
        : <div key={v} className="slot-cell muted small">always holo</div>)}
    </>
  )
}

function SlotCell({ c, m, v, slot }: { c: Character; m: string; v: Variant; slot?: ImageSlot }) {
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
