import { useEffect, useMemo, useState } from 'react'
import { Notice, useAction } from '../components'
import { newId } from '../db'
import { FRAME_SETS, frameSetFiles, frameSetLabel, missingFramesFor } from '../frames'
import { imagesPerCharacter } from '../looks'
import {
  DEFAULT_PDA_ODDS, HOLO_ONE, SHARE_SCALE, SUPPLY_LABEL, UINT32_MAX, cardsPerPack, checkRecipe, cloneRecipe, compileRecipe, holoLooksFor,
  holoOdds, holoOddsGivenHolo, parseUint, percentToScaled, poolOf, rulePool, scaledToPercent, slotTypeIndexes, slugify,
  specialAllHoloRecipe, standardRecipe, type CardTypeDef, type HoloRule, type Problem, type Recipe, type SlotDef, type Supply,
} from '../recipe'
import { HOLO_LABEL, HOLO_TYPES } from '../rules'
import { updateFire, useStudio } from '../store'
import type { FireRecord } from '../types'

const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits).replace(/\.?0+$/, '')}%`
const fmtBig = (v: bigint) => v.toLocaleString('en-US')

/** A percentage typed as text, stored exactly as an integer at `scale` (1e9 for shares, 1e18 for holo chances). */
function PercentInput({ value, scale, onChange, disabled, testId }: { value: bigint; scale: bigint; onChange: (v: bigint) => void; disabled?: boolean; testId?: string }) {
  const [text, setText] = useState(() => scaledToPercent(value, scale))
  useEffect(() => {
    if (percentToScaled(text, scale) !== value) setText(scaledToPercent(value, scale))
    // only when the stored value changes from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, scale])
  const bad = percentToScaled(text, scale) == null
  return (
    <span className="pct-input">
      <input value={text} disabled={disabled} aria-invalid={bad} data-testid={testId} inputMode="decimal"
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
  const set = (next: Recipe) => { if (!locked) void run(() => updateFire(fire.number, { recipe: next, build: undefined, approvedAt: undefined })) }
  const setType = (i: number, patch: Partial<CardTypeDef>) => set({ ...r, types: r.types.map((t, j) => (j === i ? { ...t, ...patch } : t)) })
  const setSlot = (i: number, patch: Partial<SlotDef>) => set({ ...r, slots: r.slots.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const move = <T,>(arr: T[], i: number, d: number) => { const a = [...arr]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a }
  const others = s.fires.filter((f) => f.number !== fire.number)
  const [copyFrom, setCopyFrom] = useState<number | ''>(others.at(-1)?.number ?? '')

  const preset = (name: string, next: Recipe) => {
    if (JSON.stringify(next) === JSON.stringify(r)) return
    if (!confirm(`Replace this Series' recipe with ${name}?`)) return
    set(next)
  }
  const addType = () => {
    const maxRank = Math.max(0, ...r.types.map((t) => t.rank))
    const name = 'New type'
    set({
      ...r,
      types: [...r.types, {
        id: newId(), name, slug: uniqueSlug(slugify(name), r), rank: maxRank + 1, supply: 'count', amount: '1', maxPerPack: '0',
        holo: { mode: 'independent', frame: '100000000000000000', picture: '100000000000000000' }, frameSet: 'gold',
      }],
    })
  }
  const removeType = (i: number) => {
    const id = r.types[i].id
    set({ ...r, types: r.types.filter((_, j) => j !== i), slots: r.slots.map((x) => ({ ...x, typeIds: x.typeIds.filter((t) => t !== id) })) })
  }
  const addSlot = () => set({ ...r, slots: [...r.slots, { count: 1, kind: 'rank', typeIds: [], minRank: 0, maxRank: null, mustHolo: false }] })

  const typeProblems = (i: number) => problems.filter((p) => p.where === 'type' && p.index === i)
  const slotProblems = (i: number) => problems.filter((p) => p.where === 'slot' && p.index === i)
  const perPack = cardsPerPack(r)
  const valid = problems.length === 0

  return (
    <section className="panel grow recipe" data-testid="recipe-editor">
      <div className="row wrap">
        <h2>Recipe · Series {fire.number}</h2>
        <span className="badge big" data-testid="recipe-per-pack">{perPack} card{perPack === 1 ? '' : 's'} per pack</span>
        <span className="badge big">{r.types.length} type{r.types.length === 1 ? '' : 's'}</span>
        <span className={`badge big ${valid ? 'badge-ok' : 'badge-warn'}`} data-testid="recipe-status">{valid ? 'valid' : `${problems.length} problem${problems.length === 1 ? '' : 's'}`}</span>
      </div>
      {locked && <Notice kind="info">The deal for this Series is locked, so its recipe is too. (Undo the lock on the Deal tab to change it.)</Notice>}
      <p className="muted small">
        Everything about this Series' cards: the card types, how many of each, their holo odds, what each pack holds and the
        PDA odds. It goes on-chain as one recipe (RecipeDealer.setRecipe) and locks when the Series' first pack is minted.
        The checks below are the contract's own.
      </p>
      {!locked && (
        <div className="row wrap" data-testid="recipe-presets">
          <span className="muted small">Start from:</span>
          <button onClick={() => preset('the Standard recipe', standardRecipe(1))} data-testid="preset-standard">Standard</button>
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
            <b>The contract would refuse this recipe:</b>
            <ul className="problems">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
          </div>
        </Notice>
      )}

      <h3>Card types</h3>
      <p className="muted small">
        Supply: a share of the Series' cards, a number per pack, an exact count, or the filler (exactly one type: whatever is
        left). Max per pack caps any rule at that many per pack's worth. Holo: two independent rolls (frame, picture), or
        explicit weights for none / frame / picture / full. Each type uses a frame set (its frames, text style and the
        characters' art for that set).
      </p>
      <div className="type-list">
        {r.types.map((t, i) => (
          <TypeCard key={t.id} r={r} t={t} i={i} locked={locked} problems={typeProblems(i)}
            onChange={(patch) => setType(i, patch)}
            onMove={(d) => set({ ...r, types: move(r.types, i, d) })}
            onRemove={() => removeType(i)} />
        ))}
      </div>
      {!locked && <button onClick={addType} data-testid="add-type">Add a card type</button>}

      <h3>The pack: slot groups</h3>
      <p className="muted small">
        Each group is a number of cards that may be any type in its set: a list of types (one type = guaranteed), or a rank
        range ("rank 2 and up" = Fire-or-better; a type added above takes part automatically). Two groups' sets must be
        nested or disjoint. Must-holo makes every card of the group holo.
      </p>
      <table className="mini slots" data-testid="slots-table">
        <thead><tr><th>#</th><th>Cards</th><th>Set</th><th>Takes</th><th>Must holo</th><th /></tr></thead>
        <tbody>
          {r.slots.map((x, i) => {
            const takes = slotTypeIndexes(r, x)
            const sp = slotProblems(i)
            return (
              <tr key={i} className={sp.length ? 'has-problem' : ''} data-testid={`slot-${i}`}>
                <td>{i + 1}</td>
                <td><SmallInt value={x.count} min={1} disabled={locked} onChange={(v) => setSlot(i, { count: v ?? 0 })} testId={`slot-${i}-count`} /></td>
                <td>
                  <select value={x.kind} disabled={locked} onChange={(e) => setSlot(i, { kind: e.target.value as SlotDef['kind'] })} data-testid={`slot-${i}-kind`}>
                    <option value="types">These types</option>
                    <option value="rank">Rank range</option>
                  </select>{' '}
                  {x.kind === 'types' ? (
                    <span className="type-picks">
                      {r.types.map((t) => (
                        <label key={t.id} className="check small">
                          <input type="checkbox" disabled={locked} checked={x.typeIds.includes(t.id)}
                            onChange={(e) => setSlot(i, { typeIds: e.target.checked ? [...x.typeIds, t.id] : x.typeIds.filter((id) => id !== t.id) })} />
                          {t.name || '?'}
                        </label>
                      ))}
                    </span>
                  ) : (
                    <span className="row inline">
                      rank <SmallInt value={x.minRank} disabled={locked} onChange={(v) => setSlot(i, { minRank: v ?? 0 })} testId={`slot-${i}-min`} />
                      to <SmallInt value={x.maxRank} placeholder="top" disabled={locked} onChange={(v) => setSlot(i, { maxRank: v })} testId={`slot-${i}-max`} />
                    </span>
                  )}
                </td>
                <td className="small">{takes.length ? takes.map((k) => r.types[k].name).join(', ') : <span className="err-text">nothing</span>}
                  {sp.map((p, k) => <div key={k} className="err-text">{p.message}</div>)}
                </td>
                <td><input type="checkbox" disabled={locked} checked={x.mustHolo} onChange={(e) => setSlot(i, { mustHolo: e.target.checked })} data-testid={`slot-${i}-holo`} /></td>
                <td className="nowrap">
                  {!locked && <>
                    <button className="link" onClick={() => set({ ...r, slots: move(r.slots, i, -1) })} disabled={i === 0}>up</button>
                    <button className="link" onClick={() => set({ ...r, slots: move(r.slots, i, 1) })} disabled={i === r.slots.length - 1}>down</button>
                    <button className="link danger" onClick={() => set({ ...r, slots: r.slots.filter((_, j) => j !== i) })}>remove</button>
                  </>}
                </td>
              </tr>
            )
          })}
          <tr><td /><td><b>{perPack}</b></td><td colSpan={4} className="muted small">cards per pack (the sum of the groups)</td></tr>
        </tbody>
      </table>
      {!locked && <button onClick={addSlot} data-testid="add-slot">Add a slot group</button>}

      <PdaOdds r={r} locked={locked} onChange={(pdaOdds) => set({ ...r, pdaOdds })} />

      <PoolPreview r={r} packs={fire.packs} chars={fire.characterIds.length} valid={valid} />
    </section>
  )
}

function TypeCard({ r, t, i, locked, problems, onChange, onMove, onRemove }: {
  r: Recipe; t: CardTypeDef; i: number; locked: boolean; problems: Problem[]
  onChange: (p: Partial<CardTypeDef>) => void; onMove: (d: number) => void; onRemove: () => void
}) {
  const looks = holoLooksFor(r, i)
  const missing = missingFramesFor(t.frameSet, looks)
  const files = frameSetFiles(t.frameSet)
  const odds = holoOdds(t)
  const setName = (name: string) => onChange(t.slugEdited ? { name } : { name, slug: uniqueSlug(slugify(name), r, t.id) })
  const setHolo = (holo: HoloRule) => onChange({ holo })
  const amount = parseUint(t.amount) ?? 0n
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
        <label className="field"><span className="field-label">Supply</span>
          <select value={t.supply} disabled={locked} data-testid={`type-${i}-supply`} onChange={(e) => {
            const supply = e.target.value as Supply
            onChange({ supply, amount: supply === 'share' ? '50000000' : supply === 'perPack' || supply === 'count' || supply === 'perCharacter' ? '1' : t.amount })
          }}>
            {(['share', 'perPack', 'count', 'filler'] as Supply[]).map((x) => <option key={x} value={x}>{SUPPLY_LABEL[x]}</option>)}
          </select></label>
        <label className="field"><span className="field-label">{t.supply === 'share' ? 'Share of the cards' : t.supply === 'perPack' ? 'Cards per pack' : t.supply === 'count' ? 'Cards in the Series' : t.supply === 'perCharacter' ? 'Cards of each character' : 'Amount'}</span>
          {t.supply === 'share' ? <PercentInput value={amount} scale={SHARE_SCALE} disabled={locked} onChange={(v) => onChange({ amount: v.toString() })} testId={`type-${i}-amount`} />
            : t.supply === 'filler' ? <span className="muted small pad">whatever is left</span>
            : <UintInput value={t.amount} disabled={locked} onChange={(v) => onChange({ amount: v })} testId={`type-${i}-amount`} />}</label>
        <label className="field"><span className="field-label">Max / pack (0 = none)</span>
          <UintInput value={t.maxPerPack} width={70} disabled={locked} onChange={(v) => onChange({ maxPerPack: v })} testId={`type-${i}-cap`} /></label>
        <label className="field"><span className="field-label">Frames</span>
          <select value={t.frameSet} disabled={locked} onChange={(e) => onChange({ frameSet: e.target.value })} data-testid={`type-${i}-frames`}>
            {FRAME_SETS.map((f) => <option key={f} value={f}>{frameSetLabel(f)} ({frameSetFiles(f).have}/12)</option>)}
          </select></label>

      </div>
      <div className="row wrap">
        <label className="field"><span className="field-label">Holo</span>
          <select value={t.holo.mode} disabled={locked} data-testid={`type-${i}-holo-mode`} onChange={(e) => {
            if (e.target.value === t.holo.mode) return
            if (e.target.value === 'independent') setHolo({ mode: 'independent', frame: '100000000000000000', picture: '100000000000000000' })
            else {
              // the same odds as weights (out of 1e6)
              const w = odds.map((x) => String(Math.round(x * 1e6))) as [string, string, string, string]
              setHolo({ mode: 'distribution', weights: w.some((x) => x !== '0') ? w : ['1', '0', '0', '0'] })
            }
          }}>
            <option value="independent">Two independent rolls</option>
            <option value="distribution">Weights: none / frame / picture / full</option>
          </select></label>
        {t.holo.mode === 'independent' ? (
          <>
            <label className="field"><span className="field-label">Frame roll</span>
              <PercentInput value={parseUint(t.holo.frame) ?? 0n} scale={HOLO_ONE} disabled={locked} onChange={(v) => setHolo({ ...(t.holo as { mode: 'independent'; frame: string; picture: string }), frame: v.toString() })} testId={`type-${i}-holo-frame`} /></label>
            <label className="field"><span className="field-label">Picture roll</span>
              <PercentInput value={parseUint(t.holo.picture) ?? 0n} scale={HOLO_ONE} disabled={locked} onChange={(v) => setHolo({ ...(t.holo as { mode: 'independent'; frame: string; picture: string }), picture: v.toString() })} testId={`type-${i}-holo-picture`} /></label>
          </>
        ) : (
          (['none', 'frame', 'picture', 'full'] as const).map((h, k) => (
            <label key={h} className="field"><span className="field-label">{HOLO_LABEL[h]} weight</span>
              <UintInput value={(t.holo as { weights: string[] }).weights[k]} width={70} disabled={locked}
                onChange={(v) => { const w = [...(t.holo as { weights: [string, string, string, string] }).weights] as [string, string, string, string]; w[k] = v; setHolo({ mode: 'distribution', weights: w }) }}
                testId={`type-${i}-w-${h}`} /></label>
          ))
        )}
        <span className="small muted holo-odds" data-testid={`type-${i}-odds`}>
          Plain slot: {HOLO_TYPES.map((h, k) => `${HOLO_LABEL[h]} ${pct(odds[k])}`).join(' · ')} (any holo {pct(1 - odds[0])})
          {r.slots.some((x) => x.mustHolo && slotTypeIndexes(r, x).includes(i)) && <><br />Must-holo slot: {(['frame', 'picture', 'full'] as const).map((h, k) => `${HOLO_LABEL[h]} ${pct(holoOddsGivenHolo(t)[k + 1])}`).join(' · ')}</>}
          <br />Images per character: {looks.length} holo look{looks.length === 1 ? '' : 's'} ({looks.map((h) => HOLO_LABEL[h]).join(', ') || 'none'}) x 11 grades = {looks.length * 11}
        </span>
        {!locked && <span className="nowrap type-actions">
          <button className="link" onClick={() => onMove(-1)} disabled={i === 0}>up</button>
          <button className="link" onClick={() => onMove(1)} disabled={i === r.types.length - 1}>down</button>
          <button className="link danger" onClick={onRemove} data-testid={`type-${i}-remove`}>remove</button>
        </span>}
      </div>
      {missing.length > 0 && (
        <p className="field-msg err" data-testid={`type-${i}-missing-frames`}>
          Missing frames for {t.name || 'this type'} ({files.have}/12 files in the {frameSetLabel(t.frameSet)} set): {missing.join(', ')}. The build is blocked until they are built by
          frames-src/clean_frames.py, or pick another frame set.
        </p>
      )}
      {problems.map((p, k) => <p key={k} className="field-msg err">{p.message}</p>)}
    </div>
  )
}

function PdaOdds({ r, locked, onChange }: { r: Recipe; locked: boolean; onChange: (o: string[]) => void }) {
  const w = r.pdaOdds.map((x) => Number(parseUint(x) ?? 0n))
  const total = w.reduce((a, b) => a + b, 0)
  return (
    <>
      <h3>PDA odds</h3>
      <p className="muted small">
        Fresh odds: a weight per grade (FirePsa.setOdds) for a card cased or graded within a day of opening. The chance of a
        grade is its weight over the total. PDA 1-4 stay 0: those come only from wear (time and moves, fixed forever in
        FirePsa; docs/grading.md).
      </p>
      <div className="row wrap pda-odds" data-testid="pda-odds">
        {r.pdaOdds.map((x, g) => (
          <label key={g} className="field"><span className="field-label">PDA {g + 1}</span>
            <UintInput value={x} width={64} disabled={locked || g < 4} onChange={(v) => onChange(r.pdaOdds.map((y, k) => (k === g ? v : y)))} testId={`pda-${g + 1}`} />
            <span className="hint">{total ? pct(w[g] / total) : '-'}</span>
          </label>
        ))}
        {!locked && <button onClick={() => onChange([...DEFAULT_PDA_ODDS])}>Default odds</button>}
      </div>
    </>
  )
}

/** The pool the recipe gives for a pack count: the contract's maths (recipe.ts previewPool), exact for any size. */
function PoolPreview({ r, packs, chars, valid }: { r: Recipe; packs: number; chars: number; valid: boolean }) {
  const [text, setText] = useState(String(packs))
  useEffect(() => setText(String(packs)), [packs])
  const P = parseUint(text)
  type Result = { counts: bigint[]; rules: bigint[]; total: bigint; S: number } | { error: string } | null
  const result = useMemo((): Result => {
    if (!valid || P == null) return null
    try {
      const plan = compileRecipe(r)
      const ch = BigInt(Math.max(1, chars))
      const { counts } = poolOf(plan, P, ch)
      return { counts, rules: rulePool(r, P, ch), total: P * BigInt(plan.S), S: plan.S }
    } catch (e) {
      return { error: (e as Error).message }
    }
  }, [r, P, chars, valid])
  return (
    <div data-testid="pool-preview">
      <h3>Pool preview</h3>
      <div className="row wrap">
        <label className="field"><span className="field-label">Packs</span>
          <input value={text} onChange={(e) => setText(e.target.value.trim())} aria-invalid={P == null} style={{ width: 160 }} data-testid="pool-packs" /></label>
        <span className="muted small">The Series' pack count is {packs.toLocaleString()} (Series tab); try any other here. The on-chain pool uses the count when the drop closes.</span>
      </div>
      {!valid && <p className="muted small">Fix the recipe to see its pool.</p>}
      {result && 'error' in result && <Notice kind="error">{result.error}</Notice>}
      {result && 'counts' in result && (
        <table className="mini" data-testid="pool-table">
          <thead><tr><th>Type</th><th>Rule</th><th>Cards</th><th>Of all cards</th><th>Per pack (avg)</th><th>The floor</th><th>Images / character</th></tr></thead>
          <tbody>
            {r.types.map((t, i) => {
              const c = result.counts[i]
              const diff = c - result.rules[i]
              return (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="small">{t.supply === 'share' ? `${scaledToPercent(parseUint(t.amount) ?? 0n, SHARE_SCALE)}%` : t.supply === 'perPack' ? `${t.amount} per pack` : t.supply === 'count' ? `${t.amount} card${t.amount === '1' ? '' : 's'}` : t.supply === 'perCharacter' ? `${t.amount} per character` : 'the rest'}{(parseUint(t.maxPerPack) ?? 0n) > 0n ? `, max ${t.maxPerPack}/pack` : ''}</td>
                  <td data-testid={`pool-${t.slug}`}><b>{fmtBig(c)}</b></td>
                  <td>{result.total ? pct(Number((c * 1_000_000n) / result.total) / 1e6, 3) : '-'}</td>
                  <td>{P ? (Number((c * 1000n) / P) / 1000).toFixed(3) : '-'}</td>
                  <td className="small">{diff === 0n || i === r.types.findIndex((x) => x.supply === 'filler') ? '' : diff > 0n ? `raised by ${fmtBig(diff)}` : `lowered by ${fmtBig(-diff)}`}</td>
                  <td>{holoLooksFor(r, i).length * 12}</td>
                </tr>
              )
            })}
            <tr><td><b>Total</b></td><td /><td><b>{fmtBig(result.total)}</b></td><td>100%</td><td>{result.S}</td><td /><td><b>{imagesPerCharacter(r)}</b></td></tr>
          </tbody>
        </table>
      )}
      <p className="muted small">
        The floor: every slot group's set holds at least packs x its cards per pack, so every pack can be filled. A guaranteed
        type set below the pack count is raised; the filler gives and takes cards to make it work.
      </p>
    </div>
  )
}
