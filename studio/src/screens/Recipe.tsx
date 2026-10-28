import { useEffect, useMemo, useState } from 'react'
import { Notice, PercentTotalBar, useAction } from '../components'
import { newId } from '../db'
import { SHOWN_FRAME_SETS, frameSetFiles, frameSetLabel, missingFramesFor } from '../frames'
import {
  FRESH_PDA_ODDS, HOLO_ONE, MAX_CARDS_PER_PACK, UINT32_MAX, cardsPerPack, checkRecipe, cloneRecipe, dropExactWeights,
  formatPercent, holoLooksFor, holoOdds, onePerIndex, packShapeLine, parsePercent, parseUint, percentToScaled, percentTotal, roundedPercent,
  scaledToPercent, setOnePerCharacter, slotLabel, slotName, slotOdds, slotPercents, slugify, specialAllHoloRecipe, standardRecipe,
  type CardTypeDef, type HoloRule, type Problem, type Recipe, type SlotDef,
} from '../recipe'
import { aboutOneIn, onePerCharacterLine, onePerCharacterText, percentText, seriesResult, type TypeResult } from '../rarity'
import { characterWeightsOf } from '../series'
import { HOLO_LABEL, HOLO_TYPES } from '../rules'
import { CARDS_PER_CREDIT } from '../sale'
import { updateFire, useStudio } from '../store'
import type { FireRecord } from '../types'
import { SeriesResult } from './SeriesResult'
import { Count, CountsGrid } from './Counts'
import { perPackText } from './SeriesResult'

const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits).replace(/\.?0+$/, '')}%`

/** A percentage typed as text, stored exactly as an integer at `scale` (1e18 for holo chances). With
 *  `round`, a stored value is shown to at most 2 decimals (the exact value on hover); it stays exact until edited. */
function PercentInput({ value, scale, onChange, disabled, testId, round }: { value: bigint; scale: bigint; onChange: (v: bigint) => void; disabled?: boolean; testId?: string; round?: boolean }) {
  const show = (v: bigint) => (round ? roundedPercent(v, scale) : scaledToPercent(v, scale))
  const [text, setText] = useState(() => show(value))
  useEffect(() => {
    if (percentToScaled(text, scale) !== value) setText(show(value))
    // only when the stored value changes from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, scale])
  const bad = percentToScaled(text, scale) == null
  return (
    <span className="pct-input">
      <input value={text} disabled={disabled} aria-invalid={bad} data-testid={testId} inputMode="decimal" title={`${scaledToPercent(value, scale)}%`}
        onChange={(e) => { setText(e.target.value); const v = percentToScaled(e.target.value, scale); if (v != null) onChange(v) }} />%
    </span>
  )
}

/** A whole number typed as text (kept as a string: values above 2^53 stay exact). */
function UintInput({ value, onChange, disabled, testId, width = 90 }: { value: string; onChange: (v: string) => void; disabled?: boolean; testId?: string; width?: number }) {
  const bad = parseUint(value) == null
  return <input value={value} style={{ width }} disabled={disabled} aria-invalid={bad} data-testid={testId} inputMode="numeric" onChange={(e) => onChange(e.target.value.trim())} />
}

function SmallInt({ value, onChange, disabled, testId, min = 0, placeholder }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean; testId?: string; min?: number; placeholder?: string }) {
  return (
    <input type="number" min={min} max={UINT32_MAX} value={value ?? ''} placeholder={placeholder} disabled={disabled} data-testid={testId} style={{ width: 80 }}
      onChange={(e) => { const t = e.target.value; if (t === '') onChange(null); else { const n = Number(t); if (Number.isFinite(n)) onChange(Math.floor(n)) } }} />
  )
}

function uniqueSlug(base: string, r: Recipe, except?: string): string {
  const taken = new Set(r.types.filter((t) => t.id !== except).map((t) => t.slug))
  let s = base || 'type'
  for (let i = 2; taken.has(s); i++) s = `${(base || 'type').slice(0, 29)}-${i}`
  return s
}

export function RecipeEditor({ fire }: { fire: FireRecord }) {
  const s = useStudio()
  const [busy, error, run] = useAction()
  const locked = !!fire.deal
  const r = fire.recipe
  const problems = useMemo(() => checkRecipe(r), [r])
  // an edit sets the recipe by its percentages (exact weights from a recipe.json are dropped)
  const set = (next: Recipe) => { if (!locked) void run(() => updateFire(fire.number, { recipe: dropExactWeights(next), build: undefined, approvedAt: undefined })) }
  const setType = (i: number, patch: Partial<CardTypeDef>) => set({ ...r, types: r.types.map((t, j) => (j === i ? { ...t, ...patch } : t)) })
  const setSlot = (k: number, patch: Partial<SlotDef>) => set({ ...r, slots: r.slots.map((sl, j) => (j === k ? { ...sl, ...patch } : sl)) })
  const setSlotPercent = (k: number, typeId: string, percent: string) => {
    setLastTyped(`${r.slots[k].id}:${typeId}`)
    const { [typeId]: _old, ...rest } = r.slots[k].percents
    setSlot(k, { percents: percent.trim() === '' ? rest : { ...rest, [typeId]: percent } })
  }
  const move = <T,>(arr: T[], i: number, d: number) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a }
  const others = s.fires.filter((f) => f.number !== fire.number)
  // the slot % the owner typed last ("slot id:type id": "Fill the rest" leaves it alone), by id so a move keeps it
  const [lastTyped, setLastTyped] = useState<string | null>(null)
  const [copyFrom, setCopyFrom] = useState<number | ''>(others.at(-1)?.number ?? '')

  const preset = (name: string, next: Recipe) => {
    if (JSON.stringify(next) === JSON.stringify(r)) return
    if (!confirm(`Replace this Series' recipe with ${name}?`)) return
    set(next)
  }
  const addType = () => {
    const maxRank = Math.max(0, ...r.types.map((t) => t.rank))
    const name = 'New type'
    const id = newId()
    // it goes into the last slot with whatever is left to assign there (nothing when that slot adds up to 100%: give
    // it a % in a slot)
    const last = r.slots.length - 1
    const left = last >= 0 ? percentTotal(slotPercents(r, r.slots[last]).map((x) => x || '0')).left : 0
    set({
      ...r,
      types: [...r.types, {
        id, name, slug: uniqueSlug(slugify(name), r), rank: maxRank + 1,
        holo: { mode: 'independent', frame: '100000000000000000', picture: '100000000000000000' }, frameSet: 'gold',
      }],
      slots: r.slots.map((sl, k) => (k === last && left > 0 ? { ...sl, percents: { ...sl.percents, [id]: formatPercent(left) } } : sl)),
    })
  }
  // a removed type leaves every slot too
  const removeType = (i: number) => {
    const id = r.types[i].id
    const next = { ...r, types: r.types.filter((_, j) => j !== i), slots: r.slots.map((sl) => { const { [id]: _gone, ...rest } = sl.percents; return { ...sl, percents: rest } }) }
    set(r.onePerCharacter === id ? setOnePerCharacter(next, null) : next)
  }
  const addSlot = () => set({ ...r, slots: [...r.slots, { id: newId(), count: 1, percents: {} }] })
  const removeSlot = (k: number) => set({ ...r, slots: r.slots.filter((_, j) => j !== k) })

  const typeProblems = (i: number) => problems.filter((p) => p.where === 'type' && p.index === i)
  const slotProblems = (k: number) => problems.filter((p) => p.where === 'slot' && p.index === k)
  const recipeProblems = problems.filter((p) => p.where === 'recipe')
  const perPack = cardsPerPack(r)
  const valid = problems.length === 0

  // the numbers the result is shown for: the Series' own, or any others to try
  const [packsText, setPacksText] = useState(String(fire.packs))
  const [charsText, setCharsText] = useState(String(Math.max(1, fire.characterIds.length)))
  useEffect(() => setPacksText(String(fire.packs)), [fire.packs])
  useEffect(() => setCharsText(String(Math.max(1, fire.characterIds.length))), [fire.characterIds.length])
  const P = parseUint(packsText)
  const chars = Number(parseUint(charsText) ?? 1n) || 1
  // the type cards and counts follow the what-if packs (the Series' own until another count is typed)
  const ownPacks = BigInt(Math.max(0, fire.packs))
  const ownChars = Math.max(1, fire.characterIds.length)
  const shownPacks = P ?? ownPacks
  const weights = useMemo(() => characterWeightsOf(fire), [fire])
  const res = useMemo(() => {
    if (!valid) return null
    try { return seriesResult(r, shownPacks, ownChars, weights) } catch { return null }
  }, [r, shownPacks, ownChars, weights, valid])
  const castNames = useMemo(() => {
    const byId = new Map(s.characters.map((c) => [c.id, c.name]))
    return fire.characterIds.map((id, k) => ({ id, name: byId.get(id) ?? `c${k}` }))
  }, [s.characters, fire.characterIds])

  return (
    <section className="panel grow recipe" data-testid="recipe-editor">
      <div className="row wrap">
        <h2>Recipe · Series {fire.number}</h2>
        <span className="badge big" data-testid="recipe-per-pack">{perPack} card{perPack === 1 ? '' : 's'} per pack</span>
        <span className="badge big">{r.types.length} type{r.types.length === 1 ? '' : 's'}</span>
        <span className="badge big" data-testid="recipe-slots">{r.slots.length} slot{r.slots.length === 1 ? '' : 's'}</span>
        <span className={`badge big ${valid ? 'badge-ok' : 'badge-warn'}`} data-testid="recipe-status">{valid ? 'valid' : `${problems.length} problem${problems.length === 1 ? '' : 's'}`}</span>
      </div>
      {perPack >= CARDS_PER_CREDIT && <Notice kind="warn"><span data-testid="recipe-credit-off">Packs of {CARDS_PER_CREDIT}+ cards: free-pack credits can't be spent on this Series.</span></Notice>}
      {locked && <Notice kind="info">The deal for this Series is locked, so its recipe is too. (Undo the lock on the Deal tab to change it.)</Notice>}
      <p className="muted small">The card types, their holo, and the pack: its slots, each with its own odds. Every pack has the same shape, and every card is rolled on its own from its slot's odds, the same for the first and the last pack. Locks with the Series' first pack. Checks are the contract's.</p>
      {!locked && (
        <div className="row wrap" data-testid="recipe-presets">
          <span className="muted small">Start from:</span>
          <button onClick={() => preset('the Standard recipe', standardRecipe())} data-testid="preset-standard">Standard</button>
          <button onClick={() => preset('Special: 3 cards, all holo', specialAllHoloRecipe())} data-testid="preset-special">Special: 3 cards, all holo</button>
          {others.length > 0 && (
            <>
              <select value={copyFrom} onChange={(e) => setCopyFrom(Number(e.target.value))} data-testid="copy-from">
                {others.map((f) => <option key={f.number} value={f.number}>Series {f.number}'s recipe</option>)}
              </select>
              <button disabled={copyFrom === ''} onClick={() => { const f = others.find((x) => x.number === copyFrom); if (f) preset(`Series ${f.number}'s recipe`, cloneRecipe(f.recipe, newId)) }} data-testid="copy-recipe">Copy</button>
            </>
          )}
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {busy && <span className="muted small">saving...</span>}
      {problems.length > 0 && (
        <Notice kind="error">
          <div data-testid="recipe-problems">
            {problems.some((p) => p.where !== 'total') && <>
              <b>The contract would refuse this recipe:</b>
              <ul className="problems">{problems.filter((p) => p.where !== 'total').map((p, i) => <li key={i}>{p.message}</li>)}</ul>
            </>}
            {problems.some((p) => p.where === 'total') && <>
              <b>Fix before export (the studio's rule: each slot adds up to 100%):</b>
              <ul className="problems">{problems.filter((p) => p.where === 'total').map((p, i) => <li key={i}>{p.message}</li>)}</ul>
            </>}
          </div>
        </Notice>
      )}

      <h3>What it makes</h3>
      <p className="muted small" data-testid="packs-where">Try other pack or character counts here to see the result. The Series' real pack count is set on the
        <b> Sale</b> tab (the drop's total packs): it's {fire.packs.toLocaleString()} now.</p>
      <div className="result-head" data-testid="pool-preview">
        <label className="field"><span className="field-label">Packs (try it, not saved)</span>
          <input value={packsText} onChange={(e) => setPacksText(e.target.value.trim())} aria-invalid={P == null} data-testid="pool-packs" /></label>
        <label className="field"><span className="field-label">Characters</span>
          <input value={charsText} onChange={(e) => setCharsText(e.target.value.trim())} aria-invalid={parseUint(charsText) == null} data-testid="pool-chars" /></label>
        {(String(P) !== String(fire.packs) || chars !== Math.max(1, fire.characterIds.length)) && (
          <button className="link" onClick={() => { setPacksText(String(fire.packs)); setCharsText(String(Math.max(1, fire.characterIds.length))) }}>
            back to this Series ({fire.packs.toLocaleString()} packs, {fire.characterIds.length} characters)
          </button>
        )}
      </div>
      <SeriesResult recipe={r} packs={P} chars={chars} characterWeights={chars === ownChars ? weights : undefined} />

      <h3>The pack</h3>
      <p className="muted small" data-testid="pack-shape">
        <b>{perPack} card{perPack === 1 ? '' : 's'} a pack</b>{r.slots.length > 0 && valid ? `: ${packShapeLine(r)}` : ''}. Each slot is its own roll: a
        type's % of that slot's cards (blank = never in that slot; each slot adds up to exactly 100%). Cards per pack is
        the slots' cards added up (1 to {MAX_CARDS_PER_PACK.toLocaleString('en-US')}).
      </p>
      {onePerIndex(r) >= 0 && (
        <p className="small" data-testid="pack-one-per-character">
          <b>{onePerCharacterLine(r, { packs: fire.packs, chars: fire.characterIds.length })}</b>
          <span className="muted"> · in no slot: it takes the place of a pack's first card ({r.slots[0] ? slotLabel(r, 0) : 'the first slot'}), at random packs, until every character has one.</span>
        </p>
      )}
      {recipeProblems.map((p, k) => <p key={k} className="field-msg err">{p.message}</p>)}
      <div className="slot-list" data-testid="slot-list">
        {r.slots.map((sl, k) => (
          <SlotCard key={sl.id} r={r} sl={sl} k={k} locked={locked} problems={slotProblems(k)} lastTyped={lastTyped}
            onCount={(count) => setSlot(k, { count })} onPercent={(typeId, v) => setSlotPercent(k, typeId, v)}
            onMove={(d) => set({ ...r, slots: move(r.slots, k, d) })} onRemove={() => removeSlot(k)} />
        ))}
      </div>
      {!locked && <button onClick={addSlot} data-testid="add-slot">Add a slot</button>}

      <h3>Card types</h3>
      <p className="muted small">
        Name, file slug, rank (the rarity order the site shows), frames and holo. How often each type comes out is set
        by the slots above; here is what they add up to.
      </p>
      <div className="type-list">
        {r.types.map((t, i) => (
          <TypeCard key={t.id} r={r} t={t} i={i} locked={locked} problems={typeProblems(i)} result={res?.types[i] ?? null}
            size={{ packs: Number(shownPacks), chars: ownChars }}
            onChange={(patch) => setType(i, patch)} onOnePerCharacter={(on) => set(setOnePerCharacter(r, on ? t.id : null))}
            onMove={(d) => set({ ...r, types: move(r.types, i, d) })}
            onRemove={() => removeType(i)} />
        ))}
      </div>
      {!locked && <button onClick={addType} data-testid="add-type">Add a card type</button>}

      <h3>How many of each card</h3>
      <CountsGrid recipe={r} basePacks={fire.packs} characters={castNames} weights={weights} packsText={packsText} setPacksText={setPacksText} typeLine={false} />

      <PdaOdds />
    </section>
  )
}

/** A % of one slot's cards, typed as text: blank = this type is never in the slot. */
function SlotPercent({ value, onChange, disabled, testId }: { value: string; onChange: (v: string) => void; disabled?: boolean; testId?: string }) {
  const bad = value.trim() !== '' && parsePercent(value) == null
  return (
    <span className="pct-input share-input">
      <input value={value} disabled={disabled} aria-invalid={bad} inputMode="decimal" data-testid={testId} placeholder="-"
        onChange={(e) => onChange(e.target.value.trim())}
        onBlur={() => { const v = parsePercent(value); if (value !== '' && v != null) onChange(v === 0 ? '' : formatPercent(v)) }} />%
    </span>
  )
}

/** One slot: its cards, each type's % of them, its total (with the one-click fix) and what it deals: "This slot: Fire
 *  67.32% · 1 in 1.7 · ...". */
function SlotCard({ r, sl, k, locked, problems, lastTyped, onCount, onPercent, onMove, onRemove }: {
  r: Recipe; sl: SlotDef; k: number; locked: boolean; problems: Problem[]; lastTyped: string | null
  onCount: (n: number) => void; onPercent: (typeId: string, v: string) => void; onMove: (d: number) => void; onRemove: () => void
}) {
  const percents = slotPercents(r, sl)
  // the total bar counts the types in this slot (a blank is not in it)
  const inSlot = r.types.flatMap((_, i) => (percents[i] !== '' ? [i] : []))
  const last = inSlot.findIndex((i) => lastTyped === `${sl.id}:${r.types[i].id}`)
  const odds = useMemo(() => slotOdds(r)[k] ?? [], [r, k])
  const shown = r.types.flatMap((_, i) => ((odds[i] ?? 0) > 0 ? [i] : []))
  const exact = sl.weights !== undefined
  const one = onePerIndex(r)
  return (
    <div className={`type-card slot-card ${problems.length ? 'has-problem' : ''}`} data-testid={`slot-${k}`}>
      <div className="type-main">
        <b className="type-no">{k + 1}</b>
        <label className="field"><span className="field-label">Cards</span>
          <SmallInt value={sl.count} min={1} disabled={locked} onChange={(v) => onCount(v ?? 0)} testId={`slot-${k}-count`} /></label>
        <span className="field"><span className="field-label">{slotName(k)}</span>
          <b className="pad" data-testid={`slot-${k}-label`}>{sl.count} {shown.length ? slotLabel(r, k) : '…'}</b></span>
        <span className="spacer" />
        {!locked && <span className="nowrap type-actions">
          <button className="link" onClick={() => onMove(-1)} disabled={k === 0}>up</button>
          <button className="link" onClick={() => onMove(1)} disabled={k === r.slots.length - 1}>down</button>
          <button className="link danger" onClick={onRemove} data-testid={`slot-${k}-remove`}>remove</button>
        </span>}
      </div>
      <div className="row wrap slot-odds">
        {r.types.map((t, i) => (
          <label key={t.id} className={`field slot-type ${percents[i] === '' ? 'off' : ''}`} title={i === one && percents[i] === '' ? `${t.name} is 1 per character: in no slot` : undefined}>
            <span className="field-label">{t.name || `Type ${i + 1}`}{i === one ? ' · 1 per character' : ''}</span>
            <SlotPercent value={percents[i]} disabled={locked || exact || (i === one && percents[i] === '')} onChange={(v) => onPercent(t.id, v)} testId={`slot-${k}-type-${i}`} /></label>
        ))}
      </div>
      {inSlot.length > 0 && !exact && (
        <PercentTotalBar percents={inSlot.map((i) => percents[i])} names={inSlot.map((i) => r.types[i].name)} what={`${slotName(k)}'s types`} disabled={locked}
          testId={`slot-${k}-total`} lastEdited={last >= 0 ? last : undefined} onFill={(j, percent) => onPercent(r.types[inSlot[j]].id, percent)} />
      )}
      {shown.length > 0 && (
        <p className="small slot-line" data-testid={`slot-${k}-line`}>
          <span className="muted">This slot:</span> {shown.map((i) => `${r.types[i].name} ${percentText(odds[i])} · ${aboutOneIn(odds[i], '')}`).join('  ·  ')}
        </p>
      )}
      {problems.map((p, j) => <p key={j} className="field-msg err">{p.message}</p>)}
    </div>
  )
}

function TypeCard({ r, t, i, locked, problems, result, size, onChange, onOnePerCharacter, onMove, onRemove }: {
  r: Recipe; t: CardTypeDef; i: number; locked: boolean; problems: Problem[]
  /** What this type makes in the Series (its odds and expected cards). */
  result: TypeResult | null
  /** The packs and characters the result is for. */
  size: { packs: number; chars: number }
  onChange: (p: Partial<CardTypeDef>) => void; onOnePerCharacter: (on: boolean) => void; onMove: (d: number) => void; onRemove: () => void
}) {
  const isOne = onePerIndex(r) === i
  const looks = holoLooksFor(r, i)
  const missing = missingFramesFor(t.frameSet, looks)
  const files = frameSetFiles(t.frameSet)
  const odds = holoOdds(t)
  const setName = (name: string) => onChange(t.slugEdited ? { name } : { name, slug: uniqueSlug(slugify(name), r, t.id) })
  const setHolo = (holo: HoloRule) => onChange({ holo })
  return (
    <div className={`type-card ${problems.length ? 'has-problem' : ''}`} data-testid={`type-${i}`}>
      <div className="type-main">
        <b className="type-no">{i + 1}</b>
        <label className="field"><span className="field-label">Name</span>
          <input value={t.name} disabled={locked} onChange={(e) => setName(e.target.value)} data-testid={`type-${i}-name`} style={{ width: 140 }} /></label>
        <label className="field"><span className="field-label">Slug (file names){t.slugEdited ? '' : ' · auto'}</span>
          <span className="row inline">
            <input value={t.slug} disabled={locked} onChange={(e) => onChange({ slug: e.target.value, slugEdited: true })} data-testid={`type-${i}-slug`} style={{ width: 120 }} />
            {t.slugEdited && !locked && <button className="link" title="Follow the name again" onClick={() => onChange({ slugEdited: false, slug: uniqueSlug(slugify(t.name), r, t.id) })}>auto</button>}
          </span></label>
        <label className="field"><span className="field-label">Rank</span>
          <SmallInt value={t.rank} disabled={locked} onChange={(v) => onChange({ rank: v ?? 0 })} testId={`type-${i}-rank`} /></label>
        <span className="field"><span className="field-label">{isOne ? 'One per character' : 'From the slots'}</span>
          {isOne
            ? <span className="small pad" data-testid={`type-${i}-share`}><b>{onePerCharacterText(size)}</b> <span className="muted">· in place of a pack's first card</span></span>
            : result
            ? <span className="small pad" data-testid={`type-${i}-share`}><b>{perPackText(result.perPack)} a pack</b> <span className="muted">· {percentText(result.share)} of cards · {aboutOneIn(result.share)} ·</span> <Count x={result.expected} unit="cards" /></span>
            : <span className="small pad muted" data-testid={`type-${i}-share`}>-</span>}
        </span>
        <label className="field"><span className="field-label">Frames</span>
          <select value={t.frameSet} disabled={locked} onChange={(e) => onChange({ frameSet: e.target.value })} data-testid={`type-${i}-frames`}>
            {(SHOWN_FRAME_SETS.includes(t.frameSet) ? SHOWN_FRAME_SETS : [...SHOWN_FRAME_SETS, t.frameSet]).map((f) => <option key={f} value={f}>{frameSetLabel(f)}{frameSetFiles(f).total ? ` (${frameSetFiles(f).have}/${frameSetFiles(f).total})` : ' (no frame)'}</option>)}
          </select></label>
        <label className="check small" title="Dealt exactly once per character per Series, at random packs, in place of a pack's first card. In no slot (its slot % moves to the slot's lowest type).">
          <input type="checkbox" checked={isOne} disabled={locked} onChange={(e) => onOnePerCharacter(e.target.checked)} data-testid={`type-${i}-one-per-character`} /> 1 per character
        </label>
      </div>
      <div className="row wrap">
        <label className="field"><span className="field-label">Holo</span>
          <select value={t.holo.mode} disabled={locked} data-testid={`type-${i}-holo-mode`} onChange={(e) => {
            if (e.target.value === t.holo.mode) return
            if (e.target.value === 'independent') setHolo({ mode: 'independent', frame: '100000000000000000', picture: '100000000000000000' })
            else {
              // the same odds as parts (out of 1e6)
              const w = odds.map((x) => String(Math.round(x * 1e6))) as [string, string, string, string]
              setHolo({ mode: 'distribution', weights: w.some((x) => x !== '0') ? w : ['1', '0', '0', '0'] })
            }
          }}>
            <option value="independent">Two independent rolls</option>
            <option value="distribution">Split in parts: plain / frame / picture / full</option>
          </select></label>
        {t.holo.mode === 'independent' ? (
          <>
            <label className="field"><span className="field-label">Frame roll</span>
              <PercentInput value={parseUint(t.holo.frame) ?? 0n} scale={HOLO_ONE} disabled={locked} onChange={(v) => setHolo({ ...(t.holo as { mode: 'independent'; frame: string; picture: string }), frame: v.toString() })} testId={`type-${i}-holo-frame`} round /></label>
            <label className="field"><span className="field-label">Picture roll</span>
              <PercentInput value={parseUint(t.holo.picture) ?? 0n} scale={HOLO_ONE} disabled={locked} onChange={(v) => setHolo({ ...(t.holo as { mode: 'independent'; frame: string; picture: string }), picture: v.toString() })} testId={`type-${i}-holo-picture`} round /></label>
          </>
        ) : (
          (['none', 'frame', 'picture', 'full'] as const).map((h, k) => (
            <label key={h} className="field"><span className="field-label">{h === 'none' ? 'Plain' : HOLO_LABEL[h]} · parts</span>
              <UintInput value={(t.holo as { weights: string[] }).weights[k]} width={70} disabled={locked}
                onChange={(v) => { const w = [...(t.holo as { weights: [string, string, string, string] }).weights] as [string, string, string, string]; w[k] = v; setHolo({ mode: 'distribution', weights: w }) }}
                testId={`type-${i}-w-${h}`} /></label>
          ))
        )}
        <span className="small muted holo-odds" data-testid={`type-${i}-odds`}>
          {HOLO_TYPES.map((h, k) => `${h === 'none' ? 'Plain' : HOLO_LABEL[h]} ${pct(odds[k])}`).join(' · ')} (any holo {pct(1 - odds[0])})
          <br />Images per character: {looks.length} look{looks.length === 1 ? '' : 's'} x 12 = {looks.length * 12}
        </span>
        {!locked && <span className="nowrap type-actions">
          <button className="link" onClick={() => onMove(-1)} disabled={i === 0}>up</button>
          <button className="link" onClick={() => onMove(1)} disabled={i === r.types.length - 1}>down</button>
          <button className="link danger" onClick={onRemove} data-testid={`type-${i}-remove`}>remove</button>
        </span>}
      </div>
      {missing.length > 0 && (
        <p className="field-msg err" data-testid={`type-${i}-missing-frames`}>
          Missing frames for {t.name || 'this type'} ({files.have}/{files.total} in the {frameSetLabel(t.frameSet)} set): {missing.join(', ')}. The build is blocked until they are built by
          frames-src/clean_frames.py, or pick another frame set.
        </p>
      )}
      {problems.map((p, k) => <p key={k} className="field-msg err">{p.message}</p>)}
    </div>
  )
}

/** PDA odds are fixed in FirePsa forever, the same for every Series: shown, never set here. */
function PdaOdds() {
  const w: number[] = [...FRESH_PDA_ODDS]
  const total = w.reduce((a, b) => a + b, 0)
  const max = Math.max(...w)
  return (
    <>
      <h3>PDA odds · fixed</h3>
      <p className="muted small">A fresh card's grade. The same for every Series. PDA 1-6 come only from wear.</p>
      <div className="pda-fixed" data-testid="pda-odds">
        {[...w.keys()].reverse().map((g) => (
          <div key={g} data-testid={`pda-${g + 1}`}>
            <b>{w[g] ? pct(w[g] / total) : ''}</b>
            <span className={`bar ${w[g] ? '' : 'wear'}`} style={{ height: `${w[g] ? Math.max(4, (w[g] / max) * 70) : 2}px` }} />
            <span>{g + 1}</span>
          </div>
        ))}
      </div>
    </>
  )
}
