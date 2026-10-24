import { useMemo, useState } from 'react'
import { Notice, PercentOfCards, PercentTotalBar, useAction } from '../components'
import { hasCategory, hasValidName } from '../categories'
import { frameSetLabel } from '../frames'
import { randomSeed } from '../prng'
import { standardRecipe } from '../recipe'
import { saleOf, salePacks, standardSale } from '../sale'
import { artNeeds, characterOddsProblems, characterPercentsOf, characterWeightsOf, charactersAllEqual, isReadyFor, missingArt } from '../series'
import { characterOdds, weightsToPercents } from '../recipe'
import { aboutOneIn, oddsText } from '../rarity'
import { deleteFire, getStudio, saveFire, saveGlobal, updateFire, useStudio } from '../store'
import { fireStatus, type Character, type FireRecord } from '../types'
import { SeriesResult } from './SeriesResult'
import { Count, CountsGrid } from './Counts'

export function FireList({ selected, onSelect }: { selected: number | null; onSelect: (n: number) => void }) {
  const s = useStudio()
  const [busy, error, run] = useAction()
  const create = () => run(async () => {
    const n = getStudio().global.nextFireNumber
    const now = Date.now()
    const sale = standardSale()
    const f: FireRecord = { number: n, characterIds: [], packs: salePacks(sale), recipe: standardRecipe(), sale, seed: randomSeed(), createdAt: now, updatedAt: now }
    await saveFire(f)
    await saveGlobal({ ...getStudio().global, nextFireNumber: n + 1 })
    onSelect(n)
  })
  return (
    <aside className="panel list-panel">
      <h3>Series</h3>
      <ul className="char-list" data-testid="fire-list">
        {s.fires.map((f) => (
          <li key={f.number} className={selected === f.number ? 'active' : ''} onClick={() => onSelect(f.number)} data-testid={`fire-${f.number}`}>
            <span className="char-name">Series {f.number}</span>
            <span className="muted small">{f.packs.toLocaleString()} packs · {f.characterIds.length} chars · {f.recipe.cardsPerPack}/pack</span>
            <span className={`badge status-${fireStatus(f)}`}>{fireStatus(f)}</span>
          </li>
        ))}
        {!s.fires.length && <li className="muted">No Series yet.</li>}
      </ul>
      <button className="primary" onClick={create} disabled={busy} data-testid="new-fire">New Series {s.global.nextFireNumber}</button>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="muted small global-info">Next global serial: <b data-testid="next-serial">#{s.global.nextSerial}</b></div>
    </aside>
  )
}

const PAGE = 100

export function FireSetup({ fire, onDeleted }: { fire: FireRecord; onDeleted: () => void }) {
  const s = useStudio()
  const [busy, error, run] = useAction()
  const [query, setQuery] = useState('')
  const [onlyReady, setOnlyReady] = useState(false)
  const [page, setPage] = useState(0)
  // the character whose % the owner typed last: "Fill the rest" takes from (or gives to) another one
  const [lastTyped, setLastTyped] = useState<string | null>(null)
  const locked = !!fire.deal
  const sale = useMemo(() => saleOf(fire), [fire])
  const update = (patch: Partial<FireRecord>) => run(() => updateFire(fire.number, patch))
  const needs = useMemo(() => artNeeds(fire.recipe), [fire.recipe])
  const picked = useMemo(() => new Set(fire.characterIds), [fire.characterIds])
  const byId = useMemo(() => new Map(s.characters.map((c) => [c.id, c])), [s.characters])
  const ready = (c: Character) => isReadyFor(c, needs)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return s.characters.filter((c) => (!q || c.name.toLowerCase().includes(q) || (c.category ?? '').toLowerCase().includes(q) || c.shortId.toLowerCase().includes(q)) && (!onlyReady || isReadyFor(c, needs)))
  }, [s.characters, query, onlyReady, needs])
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const shown = list.slice(page * PAGE, page * PAGE + PAGE)

  const toggle = (id: string, on: boolean) => run(() => updateFire(fire.number, (f) => ({ characterIds: on ? [...f.characterIds, id] : f.characterIds.filter((x) => x !== id) })))
  const notReady = fire.characterIds.filter((id) => { const c = byId.get(id); return !c || !ready(c) })
  // character odds: "All equal" (the default) or each character's % of cards, adding up to 100%
  const allEqual = charactersAllEqual(fire)
  const percents = characterPercentsOf(fire)
  const weights = characterWeightsOf(fire)
  const odds = characterOdds(weights, fire.characterIds.length)
  const nameAt = (k: number) => byId.get(fire.characterIds[k])?.name ?? `c${k}`
  // expected cards per character over every type, for the Series' base packs
  const cardsTotal = Math.max(0, fire.packs) * Math.max(0, fire.recipe.cardsPerPack)
  const castNames = useMemo(() => fire.characterIds.map((id, k) => ({ id, name: byId.get(id)?.name ?? `c${k}` })), [fire.characterIds, byId])
  const oddsProblems = characterOddsProblems(fire, nameAt)
  // the total's problem shows on the total line itself
  const perCharProblems = oddsProblems.filter((p) => !p.startsWith('The characters add up'))
  const setPercent = (id: string, p: string) => run(() => updateFire(fire.number, (f) => ({ characterPercents: { ...(f.characterPercents ?? {}), [id]: p } })))
  // "All equal" off: every picked character starts at an equal share (rounded so they add up to exactly 100%)
  const setAllEqual = (on: boolean) => run(() => updateFire(fire.number, (f) => {
    if (on) return { characterPercents: undefined }
    const p = weightsToPercents(f.characterIds.map(() => 1))
    return { characterPercents: Object.fromEntries(f.characterIds.map((id, k) => [id, p[k]])) }
  }))

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Series {fire.number}</h2>
        <span className={`badge status-${fireStatus(fire)}`}>{fireStatus(fire)}</span>
        <span className="spacer" />
        {!locked && (
          <button className="danger" onClick={() => {
            if (confirm(`Delete draft Series ${fire.number}?`)) void run(async () => { await deleteFire(fire.number); onDeleted() })
          }}>Delete draft</button>
        )}
      </div>
      {locked && <Notice kind="info">The deal for this Series is locked; its setup can't change. (Undo the lock on the Deal tab if it's the latest Series and not uploaded.)</Notice>}
      <div className="cols">
        <div>
          <h4>Characters ({fire.characterIds.length.toLocaleString()} picked, image order c0, c1, ...)</h4>
          <p className="muted small">
            Any number (the contract stores them in batches). A character needs a valid name and category, and the art this
            recipe uses: {[...needs].map(([set, vs]) => `${frameSetLabel(set)} ${[...vs].join(' + ')}`).join(', ')}.
            Odds: every character is equally likely, unless you turn off "All equal" and give each one its % of cards (they must add up to exactly 100%).
          </p>
          <div className="row wrap" data-testid="char-odds-mode">
            <label className="check"><input type="checkbox" checked={allEqual} disabled={locked || !!fire.characterWeights} onChange={(e) => void setAllEqual(e.target.checked)} data-testid="odds-all-equal" /> All equal</label>
            {allEqual
              ? fire.characterIds.length > 0 && <span className="muted small" data-testid="odds-equal-line">Each character: {oddsText(1 / fire.characterIds.length)}</span>
              : fire.characterIds.length > 0 && percents && (
                <PercentTotalBar percents={percents} names={fire.characterIds.map((_, k) => nameAt(k))} what="The characters" disabled={locked || !!fire.characterWeights} testId="char-total"
                  lastEdited={lastTyped && fire.characterIds.includes(lastTyped) ? fire.characterIds.indexOf(lastTyped) : undefined}
                  onFill={(k, p) => void setPercent(fire.characterIds[k], p)} />
              )}
          </div>
          <div className="row wrap">
            <input placeholder="Search name, category, short id" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0) }} data-testid="char-search" style={{ width: 220 }} />
            <label className="check small"><input type="checkbox" checked={onlyReady} onChange={(e) => { setOnlyReady(e.target.checked); setPage(0) }} /> ready only</label>
            <span className="muted small">{list.length.toLocaleString()} shown</span>
          </div>
          <ul className="pick-list" data-testid="fire-chars">
            {shown.map((c) => {
              const ok = ready(c)
              const on = picked.has(c.id)
              const miss = missingArt(c, needs)
              return (
                <li key={c.id} className={ok ? '' : 'disabled'}>
                  <label className="check">
                    <input type="checkbox" checked={on} disabled={locked || (!on && !ok)} onChange={(e) => toggle(c.id, e.target.checked)} data-testid={`pick-${c.name}`} />
                    {on && <span className="muted small">c{fire.characterIds.indexOf(c.id)}</span>}
                    {c.name} {c.placeholder && <span className="tag">placeholder</span>}
                    {on && (() => {
                      const k = fire.characterIds.indexOf(c.id)
                      return (
                        <span className="char-odds small" title="This character's % of cards">
                          {!allEqual && percents && <PercentOfCards value={percents[k]} disabled={locked || !!fire.characterWeights} onChange={(p) => { setLastTyped(c.id); void setPercent(c.id, p) }} testId={`odds-${c.name}`} />}
                          {(allEqual || oddsProblems.length === 0) && <span className="muted" data-testid={`char-odds-${c.name}`}> {allEqual ? oddsText(odds[k], '') : aboutOneIn(odds[k], '')}</span>}
                          {cardsTotal > 0 && (allEqual || oddsProblems.length === 0) && <span data-testid={`char-count-${c.name}`}> · <Count x={odds[k] * cardsTotal} unit="cards" /></span>}
                        </span>
                      )
                    })()}
                    <span className={`badge ${ok ? 'badge-ok' : 'badge-warn'}`} title={miss.join(', ')}>
                      {ok ? 'ready' : miss.length ? `${miss.length} image${miss.length === 1 ? '' : 's'} missing` : ''}{hasCategory(c) ? '' : ' · no category'}{hasValidName(c) ? '' : ' · bad name'}
                    </span>
                  </label>
                </li>
              )
            })}
            {!s.characters.length && <li className="muted">The library is empty.</li>}
          </ul>
          {pages > 1 && (
            <div className="row">
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <span className="muted small">Page {page + 1} of {pages}</span>
              <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
          {!locked && (
            <div className="row wrap">
              <button onClick={() => update({ characterIds: [...fire.characterIds, ...s.characters.filter((c) => !picked.has(c.id) && ready(c)).map((c) => c.id)] })} data-testid="pick-all">Pick all ready</button>
              {query && <button onClick={() => update({ characterIds: [...fire.characterIds, ...list.filter((c) => !picked.has(c.id) && ready(c)).map((c) => c.id)] })}>Pick the ready ones shown</button>}
              <button onClick={() => update({ characterIds: [] })}>Clear</button>
              {notReady.length > 0 && <button onClick={() => update({ characterIds: fire.characterIds.filter((id) => !notReady.includes(id)) })}>Unpick the {notReady.length} not ready</button>}
            </div>
          )}
          {perCharProblems.length > 0 && <Notice kind="error"><div data-testid="char-odds-problems">{perCharProblems.slice(0, 4).map((p) => <div key={p}>{p}</div>)}{perCharProblems.length > 4 && <div>... and {perCharProblems.length - 4} more.</div>}</div></Notice>}
          {notReady.length > 0 && <Notice kind="error">{notReady.length} picked character{notReady.length === 1 ? " isn't" : "s aren't"} ready for this recipe (art, name or category); finish them or unpick them.</Notice>}
          <p data-testid="packs-line">
            <b data-testid="packs">{fire.packs.toLocaleString()}</b> packs{' '}
            <span className="muted small">(split into {sale.groups.length} group{sale.groups.length === 1 ? '' : 's'}) · set on the <a href="#sale">Sale</a> tab</span>
          </p>
          {fire.packs < 1 && !locked && <p className="field-msg err" data-testid="packs-problem">No packs: set the total packs on the Sale tab.</p>}
        </div>
        <div>
          <h4>This Series will make</h4>
          <SeriesResult recipe={fire.recipe} packs={BigInt(Math.max(0, fire.packs))} chars={fire.characterIds.length} characterWeights={weights} compact />
          <p className="muted small">Change it on the Recipe tab.</p>
        </div>
      </div>
      <h3>How many of each card</h3>
      <CountsGrid recipe={fire.recipe} basePacks={fire.packs} characters={castNames} weights={weights} />
      {error && <Notice kind="error">{error}</Notice>}
      {busy && <span className="muted small">saving...</span>}
    </section>
  )
}
