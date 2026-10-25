import { useEffect, useMemo, useState } from 'react'
import { checkRecipe, holoLooksFor, parseUint, slotLabel, type Recipe } from '../recipe'
import { expectedCounts, mayNotPrint, oddsText, percentText, printCount, slotSummaries, type ExpectedCounts } from '../rarity'
import { HOLO_LABEL, type HoloType } from '../rules'
import { perPackText, typeColor } from './SeriesResult'

const lookName = (h: HoloType) => (h === 'none' ? 'Plain' : HOLO_LABEL[h])

/** One expected count: "≈ N", or "< 1" marked as maybe not printing; "-" when it can't print at all. */
export function Count({ x, unit, testId }: { x: number; unit?: string; testId?: string }) {
  if (!(x > 0)) return <span className="muted" data-testid={testId}>-</span>
  const low = mayNotPrint(x)
  return (
    <span className={low ? 'count-low' : 'count'} data-testid={testId} title={`${x.toPrecision(4)} expected${low ? ': may not print' : ''}`}>
      {low ? '< 1' : `≈ ${printCount(x)}`}{unit ? ` ${unit}` : ''}{low && <span className="may-not"> may not print</span>}
    </span>
  )
}

export const COUNTS_NOTE = 'If the odds land exactly: expected counts. Real pulls will vary.'

/** The pack slot by slot, each with its odds: "3 Paper · 1 Wood · 1 Wood or better: Wood 44.9%, Fire 30%, ...". */
export function SlotSummary({ recipe }: { recipe: Recipe }) {
  const slots = useMemo(() => slotSummaries(recipe), [recipe])
  return (
    <div className="slot-summary" data-testid="slot-summary">
      {slots.map((sl, k) => {
        const ts = recipe.types.flatMap((t, i) => (sl.odds[i] > 0 ? [{ t, p: sl.odds[i] }] : []))
        return (
          <span key={recipe.slots[k].id} className="type-count" data-testid={`slot-summary-${k}`}>
            <b>{sl.count} {slotLabel(recipe, k)}</b>
            {ts.length > 1 && <span className="muted">: {ts.map(({ t, p }) => `${t.name} ${percentText(p)}`).join(', ')}</span>}
          </span>
        )
      })}
    </div>
  )
}

/** Each type's expected cards per pack, its share of cards and expected cards, plus the total: "Gold · ≈0.2394 a pack
 *  · 3.99% · about 1 in 25 cards · ≈ 40 cards". */
export function TypeCounts({ recipe, counts }: { recipe: Recipe; counts: ExpectedCounts }) {
  return (
    <div className="type-counts" data-testid="type-counts">
      {recipe.types.map((t, i) => (
        <span key={t.id} className="type-count" data-testid={`type-count-${t.slug}`}>
          <span className="swatch" style={{ background: typeColor(t.frameSet) }} />
          <b>{t.name}</b> · {perPackText(counts.types[i].perPack)} a pack · {oddsText(counts.types[i].share)} · <Count x={counts.types[i].count} unit="cards" />
        </span>
      ))}
      <span className="type-count total" data-testid="type-count-total">
        <b>All</b> · {counts.totalCards.toLocaleString('en-US')} cards
        <span className="muted"> ({counts.packs.toLocaleString('en-US')} packs × {counts.cardsPerPack})</span>
      </span>
    </div>
  )
}

type HoloView = 'off' | 'type' | 'cell'

/** The grid the owner scans: expected cards per type x character, optionally split by holo look. Its "what if" pack
 *  field starts at the Series' base packs; pass `packsText` / `setPacksText` to share it with another field. */
export function CountsGrid({ recipe, basePacks, characters, weights, typeLine = true, ...shared }: {
  recipe: Recipe
  /** Show each type's odds line above the grid (off where the odds already show, e.g. the Recipe tab). */
  typeLine?: boolean
  /** The Series' base packs (Sale tab). */
  basePacks: number
  characters: { id: string; name: string }[]
  weights?: number[]
  packsText?: string
  setPacksText?: (s: string) => void
}) {
  const [ownText, setOwnText] = useState(String(basePacks))
  useEffect(() => setOwnText(String(basePacks)), [basePacks])
  const text = shared.packsText ?? ownText
  const setText = shared.setPacksText ?? setOwnText
  const P = parseUint(text)
  const [holo, setHolo] = useState<HoloView>('off')
  const valid = useMemo(() => checkRecipe(recipe).length === 0, [recipe])
  const counts = useMemo(() => (valid && P != null ? expectedCounts(recipe, weights ?? characters.length, P) : null), [recipe, weights, characters.length, P, valid])
  const looks = useMemo(() => recipe.types.map((_, i) => (valid ? holoLooksFor(recipe, i) : [])), [recipe, valid])
  const lowCells = counts ? counts.grid.flat().filter(mayNotPrint).length : 0

  return (
    <div className="counts" data-testid="counts-grid">
      <p className="counts-note" data-testid="counts-note">{COUNTS_NOTE}</p>
      <div className="result-head">
        <label className="field"><span className="field-label">Packs (what if, not saved)</span>
          <input value={text} onChange={(e) => setText(e.target.value.trim())} aria-invalid={P == null} data-testid="counts-packs" /></label>
        {String(P) !== String(basePacks) && <button className="link" onClick={() => setText(String(basePacks))}>back to the Sale's {basePacks.toLocaleString('en-US')} packs</button>}
        <span className="field"><span className="field-label">Holo</span>
          <span className="seg" role="group" aria-label="holo breakdown">
            {(['off', 'type', 'cell'] as const).map((v) => (
              <button key={v} className={holo === v ? 'on' : ''} onClick={() => setHolo(v)} data-testid={`counts-holo-${v}`}>
                {v === 'off' ? 'No split' : v === 'type' ? 'Per type' : 'Per cell'}
              </button>
            ))}
          </span></span>
      </div>
      <p className="muted small">
        {basePacks < 1 ? 'No pack count on the Sale tab yet: type one to see the counts. ' : `The Sale's base packs: ${basePacks.toLocaleString('en-US')}. `}
        Packs sold after sell-out add more cards at the same odds.
      </p>
      {!valid ? <p className="muted small">Fix the recipe to see the counts.</p> : !counts ? <p className="muted small">Type a pack count.</p> : (
        <>
          <SlotSummary recipe={recipe} />
          {typeLine && <TypeCounts recipe={recipe} counts={counts} />}
          {lowCells > 0 && <p className="small" data-testid="counts-low"><span className="count-low">{lowCells.toLocaleString('en-US')} type × character card{lowCells === 1 ? '' : 's'}</span> expected below 1: they may not print.</p>}
          <div className="table-scroll counts-scroll">
            <table className="mini counts-table" data-testid="counts-table">
              <thead>
                <tr>
                  <th>Character</th><th>Odds</th>
                  {recipe.types.map((t, i) => (
                    <th key={t.id} className="num"><span className="swatch" style={{ background: typeColor(t.frameSet) }} />{t.name}
                      <div className="muted small">{perPackText(counts.types[i].perPack)} a pack · {oddsText(counts.types[i].share, '')}</div></th>
                  ))}
                  <th className="num">All types</th>
                </tr>
                {holo === 'type' && (
                  <tr className="holo-row" data-testid="counts-holo-types">
                    <th className="muted small" colSpan={2}>Holo split (whole type)</th>
                    {recipe.types.map((t, i) => (
                      <th key={t.id} className="num small">
                        {looks[i].map((h) => <div key={h}>{lookName(h)} <Count x={counts.types[i].looks[h]} /></div>)}
                      </th>
                    ))}
                    <th />
                  </tr>
                )}
              </thead>
              <tbody>
                {characters.map((c, k) => (
                  <tr key={c.id} data-testid={`counts-row-${k}`}>
                    <td className="nowrap">{c.name}</td>
                    <td className="muted small nowrap">{oddsText(counts.characters[k].share, '')}</td>
                    {recipe.types.map((t, i) => {
                      const x = counts.grid[i][k]
                      const o = counts.types[i].count > 0 ? x / counts.types[i].count : 0
                      return (
                        <td key={t.id} className={`num ${mayNotPrint(x) ? 'low' : ''}`}>
                          <Count x={x} />
                          {holo === 'cell' && looks[i].length > 1 && (
                            <div className="cell-looks">
                              {looks[i].map((h) => <div key={h}>{lookName(h)} <Count x={counts.types[i].looks[h] * o} /></div>)}
                            </div>
                          )}
                          {holo === 'cell' && looks[i].length === 1 && <div className="cell-looks muted">all {lookName(looks[i][0]).toLowerCase()}</div>}
                        </td>
                      )
                    })}
                    <td className="num"><b><Count x={counts.characters[k].count} /></b></td>
                  </tr>
                ))}
                {!characters.length && (
                  <tr><td colSpan={recipe.types.length + 3} className="muted small">No characters picked yet: pick them on the Series tab to split the counts by character.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="total">
                  <td><b>All characters</b></td><td />
                  {recipe.types.map((t, i) => <td key={t.id} className="num"><b><Count x={counts.types[i].count} /></b></td>)}
                  <td className="num"><b>{counts.totalCards.toLocaleString('en-US')}</b></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
