import { useDeferredValue, useMemo } from 'react'
import { Notice } from '../components'
import { castWarning, checkRecipe, type Recipe } from '../recipe'
import { TIERS, TIER_LABEL, oneIn, packChances, seriesResult, type LookResult } from '../rarity'
import { HOLO_LABEL, HOLO_TYPES } from '../rules'

/** A colour per frame set, for the mix bar. */
const SET_COLOR: Record<string, string> = {
  paper: '#d8ccb0', wood: '#9c6a3c', burning: '#ef6a2b', charcoal: '#6b7079', gold: '#e5b33b', fullart: '#b07cff', diamond: '#8fd8ff',
}
export const typeColor = (frameSet: string) => SET_COLOR[frameSet] ?? '#f08a24'

const pct = (x: number) => {
  const v = x * 100
  if (v === 0) return '0%'
  if (v >= 99.95 && v < 100) return '>99.9%'
  return `${v >= 10 ? +v.toFixed(1) : v >= 1 ? +v.toFixed(2) : +v.toPrecision(2)}%`
}
/** An average: whole numbers as they are, others with "≈". */
const avg = (x: number) => {
  if (Number.isInteger(x)) return x.toLocaleString('en-US')
  return `≈${x < 1 ? +x.toPrecision(1) : x < 10 ? +x.toFixed(1) : Math.round(x).toLocaleString('en-US')}`
}

function Look({ l }: { l: LookResult | undefined }) {
  if (!l) return <td className="muted">-</td>
  return (
    <td className="look" data-testid={`look-${l.look}`}>
      <span className={`odds ${l.tier ?? ''}`}>1 in {oneIn(l.p)}</span>
      {l.tier && <span className={`tier ${l.tier}`}>{TIER_LABEL[l.tier]}</span>}
      <span className="muted small">{avg(l.total)} · {avg(l.perCharacter)} each</span>
    </td>
  )
}

/** What the recipe makes for this many packs and characters: cards per type and look, how rare each exact card is
 *  (the site's "1 in N" and tiers) and the chance a pack holds one. */
export function SeriesResult({ recipe, packs, chars, compact }: { recipe: Recipe; packs: bigint | null; chars: number; compact?: boolean }) {
  const problems = useMemo(() => checkRecipe(recipe), [recipe])
  const res = useMemo(() => {
    if (problems.length || packs == null) return null
    try { return seriesResult(recipe, packs, chars) } catch (e) { return { error: (e as Error).message } }
  }, [recipe, packs, chars, problems])
  // the per-pack estimate deals the Series many times: let typing stay smooth
  const slow = useDeferredValue({ recipe, packs, chars, ok: !!res && !('error' in res) })
  const perPack = useMemo(() => {
    if (!slow.ok || slow.packs == null || slow.packs > 1_000_000n) return null
    try { return packChances(slow.recipe, Number(slow.packs), slow.chars) } catch { return null }
  }, [slow])

  if (problems.length) return <p className="muted small" data-testid="series-result">Fix the recipe to see what it makes.</p>
  if (!res) return null
  if ('error' in res) return <Notice kind="error">{res.error}</Notice>
  const N = res.total
  const warn = castWarning(recipe, res.types.map((t) => t.count))
  const lookTotals = HOLO_TYPES.map((h) => res.types.reduce((a, t) => a + (t.looks.find((l) => l.look === h)?.total ?? 0), 0))
  const fillerIdx = recipe.types.findIndex((t) => t.supply === 'filler')
  return (
    <div className="series-result" data-testid="series-result">
      <div className="stats-row">
        <div className="stat"><b data-testid="result-cards">{N.toLocaleString('en-US')}</b><span>cards</span></div>
        <div className="stat"><b>{res.packs.toLocaleString('en-US')}</b><span>packs of {res.cardsPerPack}</span></div>
        <div className="stat"><b>{res.chars.toLocaleString('en-US')}</b><span>character{res.chars === 1 ? '' : 's'}</span></div>
      </div>
      {N > 0n && (
        <div className="mix-bar" role="img" aria-label={recipe.types.map((t, i) => `${t.name} ${res.types[i].count}`).join(', ')}>
          {recipe.types.map((t, i) => {
            const share = res.types[i].share
            return share > 0 ? (
              <span key={t.id} style={{ flexGrow: share, background: typeColor(t.frameSet) }} title={`${t.name}: ${res.types[i].count.toLocaleString('en-US')} (${pct(share)})`}>
                {share > 0.08 ? t.name : ''}
              </span>
            ) : null
          })}
        </div>
      )}
      {warn && <Notice kind="warn">{warn}</Notice>}
      <div className="table-scroll">
        <table className="mini result-table" data-testid="pool-table">
          <thead>
            <tr>
              <th rowSpan={2}>Type</th><th rowSpan={2}>Cards</th><th rowSpan={2}>Each character</th>
              <th colSpan={4} className="center">How rare one exact card is · how many</th>
              <th rowSpan={2}>Packs with one</th>
            </tr>
            <tr>{HOLO_TYPES.map((h) => <th key={h}>{h === 'none' ? 'Plain' : HOLO_LABEL[h]}</th>)}</tr>
          </thead>
          <tbody>
            {recipe.types.map((t, i) => {
              const r = res.types[i]
              const diff = r.count - r.rule
              return (
                <tr key={t.id} data-testid={`result-${t.slug}`}>
                  <td><span className="swatch" style={{ background: typeColor(t.frameSet) }} />{t.name}</td>
                  <td>
                    <b data-testid={`pool-${t.slug}`}>{r.count.toLocaleString('en-US')}</b> <span className="muted small">{pct(r.share)}</span>
                    {diff !== 0n && i !== fillerIdx && <div className="muted small" title="The pack floor moved cards so every pack can be filled.">{diff > 0n ? '+' : ''}{diff.toLocaleString('en-US')} by the floor</div>}
                  </td>
                  <td>{avg(r.perCharacter)}</td>
                  {HOLO_TYPES.map((h) => <Look key={h} l={r.looks.find((l) => l.look === h)} />)}
                  <td data-testid={`per-pack-${t.slug}`}>
                    {perPack ? <>
                      <b>{pct(perPack.atLeastOne[i])}</b>
                      {perPack.twoOrMore[i] > 0.0005 && <div className="muted small">2+: {pct(perPack.twoOrMore[i])}</div>}
                    </> : <span className="muted" title={N > 600_000n ? 'Too big to test-deal here (over 600,000 cards).' : undefined}>-</span>}
                  </td>
                </tr>
              )
            })}
            <tr className="total">
              <td><b>All</b></td>
              <td><b>{N.toLocaleString('en-US')}</b></td>
              <td>{avg(Number(N) / res.chars)}</td>
              {lookTotals.map((x, k) => <td key={k} className="muted small">{x > 0 ? `${avg(x)} · ${pct(N > 0n ? x / Number(N) : 0)}` : '-'}</td>)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {!compact && (
        <p className="muted small legend">
          {TIERS.slice().reverse().map(([tier, at]) => <span key={tier}><span className={`tier ${tier}`}>{TIER_LABEL[tier]}</span> 1 in {at.toLocaleString('en-US')}+ </span>)}
          · One exact card = character + type + look, over all the Series' cards (the site's scale).
          {' '}Card counts are exact; looks and characters are random per card (≈).
          {perPack ? ` Packs: from ${perPack.deals} test deal${perPack.deals === 1 ? '' : 's'}.` : ''}
        </p>
      )}
    </div>
  )
}
