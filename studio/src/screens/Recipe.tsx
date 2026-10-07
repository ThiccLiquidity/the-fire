import { useEffect, useMemo, useState } from 'react'
import { Notice, useAction } from '../components'
import { newId } from '../db'
import { FRAME_SETS, frameSetFiles, frameSetLabel, missingFramesFor } from '../frames'
import {
  DEFAULT_PDA_ODDS, HOLO_ONE, SHARE_SCALE, SUPPLY_LABEL, UINT32_MAX, cardsPerPack, checkRecipe, cloneRecipe, holoLooksFor,
  holoOdds, holoOddsGivenHolo, parseUint, percentToScaled, scaledToPercent, slotTypeIndexes, slugify,
  specialAllHoloRecipe, standardRecipe, type CardTypeDef, type HoloRule, type Problem, type Recipe, type SlotDef, type Supply,
} from '../recipe'
import { countForShare, seriesResult, shareForCount, type TypeResult } from '../rarity'
import { HOLO_LABEL, HOLO_TYPES } from '../rules'
import { updateFire, useStudio } from '../store'
import type { FireRecord } from '../types'
import { SeriesResult } from './SeriesResult'

const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits).replace(/\.?0+$/, '')}%`

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

  // the numbers the result is shown for: the Series' own, or any others to try
  const [packsText, setPacksText] = useState(String(fire.packs))
  const [charsText, setCharsText] = useState(String(Math.max(1, fire.characterIds.length)))
  useEffect(() => setPacksText(String(fire.packs)), [fire.packs])
  useEffect(() => setCharsText(String(Math.max(1, fire.characterIds.length))), [fire.characterIds.length])
  const P = parseUint(packsText)
  const chars = Number(parseUint(charsText) ?? 1n) || 1
  const N = P == null ? null : P * BigInt(perPack)
  const res = useMemo(() => {
    if (!valid || P == null) return null
    try { return seriesResult(r, P, chars) } catch { return null }
  }, [r, P, chars, valid])

  return (
    <section className="panel grow recipe" data-testid="recipe-editor">
      <div className="row wrap">
        <h2>Recipe · Series {fire.number}</h2>
        <span className="badge big" data-testid="recipe-per-pack">{perPack} card{perPack === 1 ? '' : 's'} per pack</span>
        <span className="badge big">{r.types.length} type{r.types.length === 1 ? '' : 's'}</span>
        <span className={`badge big ${valid ? 'badge-ok' : 'badge-warn'}`} data-testid="recipe-status">{valid ? 'valid' : `${problems.length} problem${problems.length === 1 ? '' : 's'}`}</span>
      </div>
      {locked && <Notice kind="info">The deal for this Series is locked, so its recipe is too. (Undo the lock on the Deal tab to change it.)</Notice>}
      <p className="muted small">The card types, how many of each, holo and the pack. Locks with the Series' first pack. Checks are the contract's.</p>
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
            <b>The contract would refuse this recipe:</b>
            <ul className="problems">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
          </div>
        </Notice>
      )}

      <h3>What it makes</h3>
      <div className="result-head" data-testid="pool-preview">
        <label className="field"><span className="field-label">Packs</span>
          <input value={packsText} onChange={(e) => setPacksText(e.target.value.trim())} aria-invalid={P == null} data-testid="pool-packs" /></label>
        <label className="field"><span className="field-label">Characters</span>
          <input value={charsText} onChange={(e) => setCharsText(e.target.value.trim())} aria-invalid={parseUint(charsText) == null} data-testid="pool-chars" /></label>
        {(String(P) !== String(fire.packs) || chars !== Math.max(1, fire.characterIds.length)) && (
          <button className="link" onClick={() => { setPacksText(String(fire.packs)); setCharsText(String(Math.max(1, fire.characterIds.length))) }}>
            back to this Series ({fire.packs.toLocaleString()} packs, {fire.characterIds.length} characters)
          </button>
        )}
      </div>
      <SeriesResult recipe={r} packs={P} chars={chars} />

      <h3>Card types</h3>
      <p className="muted small">
        How many: a percent of the cards, a number per pack, an exact number, a number per character, or the rest (one type).
        Type a percent or a number of cards: the other follows. Max / pack caps it at that many per pack's worth.
      </p>
      <div className="type-list">
        {r.types.map((t, i) => (
          <TypeCard key={t.id} r={r} t={t} i={i} locked={locked} problems={typeProblems(i)} n={N} result={res?.types[i] ?? null}
            onChange={(patch) => setType(i, patch)}
            onMove={(d) => set({ ...r, types: move(r.types, i, d) })}
            onRemove={() => removeType(i)} />
        ))}
      </div>
      {!locked && <button onClick={addType} data-testid="add-type">Add a card type</button>}

      <h3>The pack: slot groups</h3>
      <p className="muted small">
        Each group is some cards of any type in its set: listed types (one type = guaranteed) or a rank range (rank 2 and up
        = Fire-or-better). Two sets must be nested or apart. Must holo: every card of the group is holo.
      </p>
      <div className="table-scroll"><table className="mini slots" data-testid="slots-table">
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
      </table></div>
      {!locked && <button onClick={addSlot} data-testid="add-slot">Add a slot group</button>}

      <PdaOdds r={r} locked={locked} onReset={() => set({ ...r, pdaOdds: [...DEFAULT_PDA_ODDS] })} />
    </section>
  )
}

function TypeCard({ r, t, i, locked, problems, n, result, onChange, onMove, onRemove }: {
  r: Recipe; t: CardTypeDef; i: number; locked: boolean; problems: Problem[]
  /** The Series' cards in all (for percent <-> cards), and what this type makes. */
  n: bigint | null; result: TypeResult | null
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
        <label className="field"><span className="field-label">How many</span>
          <select value={t.supply} disabled={locked} data-testid={`type-${i}-supply`} onChange={(e) => {
            const supply = e.target.value as Supply
            // keep the same number of cards where it can: a percent from the count, a count from the percent
            const now = result?.count
            let next = supply === 'share' ? '50000000' : supply === 'filler' ? t.amount : '1'
            if (supply === 'share' && now != null && n) next = (shareForCount(now, n)?.share ?? 50_000_000n).toString()
            if (supply === 'count' && now != null) next = now.toString()
            onChange({ supply, amount: next })
          }}>
            {(['share', 'count', 'perPack', 'perCharacter', 'filler'] as Supply[]).map((x) => <option key={x} value={x}>{SUPPLY_LABEL[x]}</option>)}
          </select></label>
        <label className="field"><span className="field-label">{t.supply === 'share' ? 'Percent · cards' : t.supply === 'perPack' ? 'Cards per pack' : t.supply === 'count' ? 'Cards · percent' : t.supply === 'perCharacter' ? 'Cards of each character' : 'Cards'}</span>
          {t.supply === 'share' ? (
            <span className="twin">
              <PercentInput value={amount} scale={SHARE_SCALE} disabled={locked} onChange={(v) => onChange({ amount: v.toString() })} testId={`type-${i}-amount`} />
              <CardsInput n={n} value={n ? countForShare(amount, n) : null} disabled={locked} testId={`type-${i}-cards`}
                onChange={(c) => { const s = n ? shareForCount(c, n) : null; if (s) onChange({ amount: s.share.toString() }) }} />
            </span>
          ) : t.supply === 'count' ? (
            <span className="twin">
              <UintInput value={t.amount} disabled={locked} onChange={(v) => onChange({ amount: v })} testId={`type-${i}-amount`} />
              <SharePercent n={n} count={amount} disabled={locked} testId={`type-${i}-pct`}
                onChange={(share) => n && onChange({ amount: countForShare(share, n).toString() })} />
            </span>
          ) : t.supply === 'filler' ? <span className="muted small pad">whatever is left</span>
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
          {HOLO_TYPES.map((h, k) => `${h === 'none' ? 'Plain' : HOLO_LABEL[h]} ${pct(odds[k])}`).join(' · ')} (any holo {pct(1 - odds[0])})
          {r.slots.some((x) => x.mustHolo && slotTypeIndexes(r, x).includes(i)) && <><br />In a must-holo slot: {(['frame', 'picture', 'full'] as const).map((h, k) => `${HOLO_LABEL[h]} ${pct(holoOddsGivenHolo(t)[k + 1])}`).join(' · ')}</>}
          <br />Images per character: {looks.length} look{looks.length === 1 ? '' : 's'} x 12 = {looks.length * 12}
        </span>
        {!locked && <span className="nowrap type-actions">
          <button className="link" onClick={() => onMove(-1)} disabled={i === 0}>up</button>
          <button className="link" onClick={() => onMove(1)} disabled={i === r.types.length - 1}>down</button>
          <button className="link danger" onClick={onRemove} data-testid={`type-${i}-remove`}>remove</button>
        </span>}
      </div>
      {result && (
        <p className="type-result" data-testid={`type-${i}-makes`}>
          Makes <b>{result.count.toLocaleString('en-US')}</b> cards · {pct(result.share, 3)} of all · {Number.isInteger(result.perCharacter) ? result.perCharacter.toLocaleString('en-US') : `≈${+result.perCharacter.toFixed(1)}`} per character
          {result.count !== result.rule && t.supply !== 'filler' && <> · {result.count > result.rule ? '+' : ''}{(result.count - result.rule).toLocaleString('en-US')} by the pack floor</>}
        </p>
      )}
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

/** A number of cards typed next to a percent: typing it sets the percent that gives exactly that many. */
function CardsInput({ n, value, onChange, disabled, testId }: { n: bigint | null; value: bigint | null; onChange: (c: bigint) => void; disabled?: boolean; testId?: string }) {
  const [text, setText] = useState(value == null ? '' : value.toString())
  useEffect(() => {
    if (parseUint(text) !== value) setText(value == null ? '' : value.toString())
    // only when the stored value changes from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const c = parseUint(text)
  const bad = c == null || (n != null && c > n)
  return (
    <span className="twin">
      =<input value={text} disabled={disabled || !n} aria-invalid={bad} data-testid={testId} inputMode="numeric"
        onChange={(e) => { setText(e.target.value); const v = parseUint(e.target.value); if (v != null && n != null && v <= n) onChange(v) }} />cards
    </span>
  )
}

/** A percent typed next to an exact number of cards: typing it sets the cards it gives (rounded like the contract). */
function SharePercent({ n, count, onChange, disabled, testId }: { n: bigint | null; count: bigint; onChange: (share: bigint) => void; disabled?: boolean; testId?: string }) {
  const shown = n ? (shareForCount(count > n ? n : count, n)?.share ?? null) : null
  const [text, setText] = useState(shown == null ? '' : scaledToPercent(shown, SHARE_SCALE))
  useEffect(() => {
    const v = percentToScaled(text, SHARE_SCALE)
    if (v == null || !n || countForShare(v, n) !== count) setText(shown == null ? '' : scaledToPercent(shown, SHARE_SCALE))
    // only when the count or the total changes from outside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, n])
  return (
    <span className="twin pct-input">
      =<input value={text} disabled={disabled || !n} aria-invalid={percentToScaled(text, SHARE_SCALE) == null} data-testid={testId} inputMode="decimal"
        onChange={(e) => { setText(e.target.value); const v = percentToScaled(e.target.value, SHARE_SCALE); if (v != null) onChange(v) }} />%
    </span>
  )
}

/** PDA odds are fixed (the same for every Series): shown, not set here. A Series saved with other odds keeps them in
 *  its recipe.json until they are reset. */
function PdaOdds({ r, locked, onReset }: { r: Recipe; locked: boolean; onReset: () => void }) {
  const w = DEFAULT_PDA_ODDS.map(Number)
  const total = w.reduce((a, b) => a + b, 0)
  const max = Math.max(...w)
  const own = r.pdaOdds.length !== DEFAULT_PDA_ODDS.length || r.pdaOdds.some((x, k) => String(parseUint(x)) !== DEFAULT_PDA_ODDS[k])
  return (
    <>
      <h3>PDA odds · fixed</h3>
      <p className="muted small">A fresh card's grade. The same for every Series. PDA 1-4 come only from wear.</p>
      <div className="pda-fixed" data-testid="pda-odds">
        {[...w.keys()].reverse().map((g) => (
          <div key={g} data-testid={`pda-${g + 1}`}>
            <b>{w[g] ? pct(w[g] / total) : ''}</b>
            <span className={`bar ${w[g] ? '' : 'wear'}`} style={{ height: `${w[g] ? Math.max(4, (w[g] / max) * 70) : 2}px` }} />
            <span>{g + 1}</span>
          </div>
        ))}
      </div>
      {own && (
        <Notice kind="warn">
          <span data-testid="pda-own">This Series was saved with its own odds ({r.pdaOdds.slice(4).map((x, k) => `${k + 5}: ${x}`).join(', ')}).</span>
          {!locked && <> <button onClick={onReset} data-testid="pda-reset">Use the fixed odds</button></>}
        </Notice>
      )}
    </>
  )
}
