import { useMemo, useState, type ReactNode } from 'react'
import { Notice, useAction } from '../components'
import {
  CARDS_PER_CREDIT, COIN, COINS, GROUP_TEMPLATES, MAX_GROUPS, MAX_WINDOW_HOURS, SALE_PRESETS, checkSale, creditGroupOk, creditPacksMax, dropPlan, fmtHours,
  groupName, groupPacks, groupSummary, groupTimes, saleJson, saleOf, salePacks, taxedPrice, taxedPrices,
  type Gate, type GroupField, type PacksAs, type SaleField, type SaleGroup, type SaleProblem, type SaleSettings,
} from '../sale'
import { cardsPerPack } from '../recipe'
import { salePolicy, type PolicyProblem } from '../salePolicy'
import { MAX_PACKS } from '../rules'
import { updateFire } from '../store'
import type { FireRecord } from '../types'

/** datetime-local value (local time) for unix seconds, and back. */
const toLocal = (t: number) => {
  if (!t) return ''
  const d = new Date(t * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const fromLocal = (v: string) => (v ? Math.floor(new Date(v).getTime() / 1000) : 0)

/** One colour per group (its place in the list), the same in the split bar, the timeline and its card. */
export const GROUP_COLORS = ['#4a7fe8', '#b9772e', '#f08a24', '#c99bff', '#4cc38a', '#e5b33b']

function Num({ value, onChange, testId, step = 1, width = 90, blank }: { value: number; onChange: (v: number) => void; testId: string; step?: number; width?: number; blank?: string }) {
  // blank: 0 shows as an empty box with this placeholder ("never")
  return (
    <input type="number" min={0} step={step} value={Number.isFinite(value) && !(blank && value === 0) ? value : ''} placeholder={blank} style={{ width }} data-testid={testId}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
  )
}

function Text({ value, onChange, testId, width = 90, placeholder }: { value: string; onChange: (v: string) => void; testId: string; width?: number; placeholder?: string }) {
  return <input value={value} style={{ width }} placeholder={placeholder} data-testid={testId} inputMode="decimal" onChange={(e) => onChange(e.target.value.trim())} />
}

/** Group indexes after moving or removing one: `map[old]` is the new index, -1 when it's gone. */
function remap(s: SaleSettings, groups: SaleGroup[], map: number[]): SaleSettings {
  const to = (i: number) => (i < 0 ? -1 : map[i] ?? -1)
  return { ...s, groups: groups.map((g) => ({ ...g, afterGroup: to(g.afterGroup), rollTo: to(g.rollTo) })), creditGroup: to(s.creditGroup) }
}

export function SaleEditor({ fire }: { fire: FireRecord }) {
  const [busy, error, run] = useAction()
  const s = useMemo(() => saleOf(fire), [fire])
  const policy = useMemo(() => salePolicy(s), [s])
  // the contract's checks, then the ops policy's warnings (launch.mjs marks those RED), each on its field
  const problems = useMemo(() => [...checkSale(s), ...policy], [s, policy])
  const errors = problems.filter((p) => !p.warning)
  const json = useMemo(() => saleJson(s), [s])
  const packs = useMemo(() => groupPacks(s), [s])
  const locked = !!fire.deal
  // the Series' pack count is the drop's base total; it follows the sale until the deal is locked
  const save = (sale: SaleSettings) => run(() => updateFire(fire.number, locked ? { sale } : { sale, packs: Math.min(MAX_PACKS, Math.max(0, Math.floor(salePacks(sale)) || 0)) }))
  const set = (patch: Partial<SaleSettings>) => void save({ ...s, ...patch })
  const setGroup = (i: number, patch: Partial<SaleGroup>) => set({ groups: s.groups.map((g, k) => (k === i ? { ...g, ...patch } : g)) })
  const preset = (name: string, next: SaleSettings) => {
    if (JSON.stringify({ ...next, start: s.start }) === JSON.stringify(s)) return
    if (!confirm(`Replace this Series' sale settings with ${name}? (The start is kept.)`)) return
    void save({ ...next, start: s.start })
  }
  const add = (make: (others: SaleGroup[]) => SaleGroup) => set({ groups: [...s.groups, make(s.groups)] })
  const remove = (i: number) => {
    if (!confirm(`Remove ${groupName(s, i)}?`)) return
    void save(remap(s, s.groups.filter((_, k) => k !== i), s.groups.map((_, k) => (k < i ? k : k === i ? -1 : k - 1))))
  }
  const move = (i: number, j: number) => {
    const groups = [...s.groups]
    ;[groups[i], groups[j]] = [groups[j], groups[i]]
    void save(remap(s, groups, s.groups.map((_, k) => (k === i ? j : k === j ? i : k))))
  }
  const perPack = cardsPerPack(fire.recipe)
  const packsOff = !!fire.deal && salePacks(s) !== fire.deal.packs
  const toFix = errors.length + (packsOff ? 1 : 0)
  const cap = creditPacksMax(s)

  return (
    <section className="panel grow sale" data-testid="sale-editor">
      <div className="row wrap">
        <h2 style={{ margin: 0 }}>Series {fire.number} · Sale</h2>
        <span className="muted small">Per drop. Locks when the drop opens.</span>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row wrap">
        <span className="muted small">Start from:</span>
        {SALE_PRESETS.map((p) => (
          <button key={p.name} disabled={busy} onClick={() => preset(p.name, p.make())} data-testid={`sale-preset-${p.name.toLowerCase()}`}>{p.name}</button>
        ))}
        <span className={`badge ${toFix ? 'badge-warn' : 'badge-ok'}`} data-testid="sale-status">
          {toFix ? `${toFix} to fix` : 'Valid'}
        </span>
        {policy.length > 0 && (
          <span className="badge badge-warn" data-testid="sale-policy-status" title="Outside the ops sale policy: launch.mjs and VerifySeries mark these RED unless run with --allow">
            {policy.length} outside policy
          </span>
        )}
      </div>
      <DropPicture s={s} lockedPacks={fire.deal ? fire.deal.packs : null} cardsPerPack={perPack} />

      <h3>Packs and who gets them</h3>
      <div className="sale-grid">
        <F all={problems} f="packs" label="Total packs" hint="The base Series. The groups split it; an unlimited group sells on top.">
          <Num value={s.packs} onChange={(v) => set({ packs: v })} testId="sale-packs" width={110} />
        </F>
      </div>
      <div className="groups" data-testid="sale-groups">
        {s.groups.map((_, i) => (
          <GroupCard key={i} s={s} i={i} packs={packs[i]} problems={problems} busy={busy}
            set={(patch) => setGroup(i, patch)} remove={() => remove(i)} move={(j) => move(i, j)} />
        ))}
      </div>
      <div className="row wrap add-groups">
        <span className="muted small">{s.groups.length < MAX_GROUPS ? 'Add a group:' : `${MAX_GROUPS} groups: the most a drop takes.`}</span>
        {GROUP_TEMPLATES.map((t) => (
          <button key={t.name} className="small-btn" disabled={busy || s.groups.length >= MAX_GROUPS} onClick={() => add(t.make)}
            data-testid={`sale-add-${t.name.split(' ')[0].toLowerCase()}`}>+ {t.name}</button>
        ))}
      </div>

      <h3>Drop-wide</h3>
      <div className="sale-grid">
        <F all={problems} f="start" label="Opens (your time)" hint="Blank: set later (DROP_START).">
          <span className="row inline">
            <input type="datetime-local" value={toLocal(s.start)} onChange={(e) => set({ start: fromLocal(e.target.value) })} data-testid="sale-start" />
            {s.start !== 0 && <button className="link" onClick={() => set({ start: 0 })}>clear</button>}
          </span>
        </F>
        <F all={problems} f="paperCapUsd" label="PAPER ceiling ($)" hint="Most a pack's PAPER can be worth. 0 = none."><Text value={s.paperCapUsd} onChange={(v) => set({ paperCapUsd: v })} testId="sale-paper-cap" /></F>
        <F all={problems} f="maxPerTx" label="Packs per purchase, at most" hint="Every group; a group can set fewer."><Num value={s.maxPerTx} onChange={(v) => set({ maxPerTx: v })} testId="sale-maxtx" /></F>
        <F all={problems} f="regularWalletsHours" label="Bots kept out for (hours)" hint="Contracts can't buy. 0 = off."><Num value={s.regularWalletsHours} step={0.5} onChange={(v) => set({ regularWalletsHours: v })} testId="sale-regular" /></F>
      </div>

      <h3>Free pack credits</h3>
      <div className="sale-grid">
        <div className="field sale-field" data-testid="sale-cards-per-credit">
          <span className="field-label">Cards burned per free pack</span>
          <b className="pad">{CARDS_PER_CREDIT} · fixed</b>
          {perPack >= CARDS_PER_CREDIT && <span className="warn-text small" data-testid="sale-credit-off">Packs of {perPack} cards: credits can't buy this Series' packs (needs under {CARDS_PER_CREDIT}).</span>}
        </div>
        <F all={problems} f="creditsPerPick" label="Credits per picked suggestion" hint="0 = none."><Num value={s.creditsPerPick} onChange={(v) => set({ creditsPerPick: v })} testId="sale-picks" /></F>
        <F all={problems} f="creditPacksPercent" label="Free packs, at most (% of total)" hint={cap ? `= ${n(cap)} of ${n(s.packs)} packs.` : '0 = no cap.'}><Text value={s.creditPacksPercent} onChange={(v) => set({ creditPacksPercent: v })} testId="sale-credit-max" /></F>
        <F all={problems} f="creditPacksPerWallet" label="Free packs per wallet, at most" hint="0 = no limit."><Num value={s.creditPacksPerWallet} onChange={(v) => set({ creditPacksPerWallet: v })} testId="sale-credit-wallet" /></F>
        <F all={problems} f="creditGroup" label="Free packs come from" hint="That group's packs, while it's open. A free pack pays only its PAPER.">
          <select value={s.creditGroup} onChange={(e) => set({ creditGroup: Number(e.target.value) })} data-testid="sale-credit-group">
            <option value={-1}>None (no free packs)</option>
            {/* only a fixed, untaxed group can give free packs (FireGroups refuses the others) */}
            {s.groups.map((g, i) => creditGroupOk(g) || i === s.creditGroup
              ? <option key={i} value={i} disabled={!creditGroupOk(g)}>{groupName(s, i)}{creditGroupOk(g) ? '' : g.unlimited ? ' (can\'t: unlimited)' : ' (can\'t: rising price)'}</option>
              : null)}
          </select>
        </F>
      </div>

      <p className="muted small">
        Delays, time limits and idle times: at most {MAX_WINDOW_HOURS} hours (30 days) each. Not sold out: the owner can end the drop once its schedule is over, anyone 7 days later.
      </p>
      <details>
        <summary className="small">The "sale" block in recipe.json</summary>
        <pre className="small" data-testid="sale-json">{JSON.stringify(json, null, 1)}</pre>
      </details>
      {errors.length > 0 && <SaleProblems s={s} problems={errors} />}
      {policy.length > 0 && <PolicyProblems s={s} problems={policy} />}
    </section>
  )
}

const usd = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const n = (x: number) => x.toLocaleString('en-US')
const MORE: GroupField[] = ['delayHours', 'perTx', 'idleMinutes']

/** One group as a compact card: name and packs; who; price and coins; per wallet; opens, ends, leftovers; rising
 *  price and unlimited; the rest (delay, per purchase, idle) behind "more". Its summary line closes it. */
function GroupCard({ s, i, packs, problems, busy, set, remove, move }: {
  s: SaleSettings; i: number; packs: number; problems: SaleProblem[]; busy: boolean
  set: (patch: Partial<SaleGroup>) => void; remove: () => void; move: (j: number) => void
}) {
  const g = s.groups[i]
  const mine = problems.filter((p) => p.group === i)
  const [more, setMore] = useState(false)
  const moreOpen = more || mine.some((p) => !p.warning && MORE.includes(p.field as GroupField))
  const priced = g.priceUsd.trim() !== '' && Number(g.priceUsd) > 0
  const mode = (to: PacksAs) => {
    if (to === g.packsAs) return
    if (to === 'percent') set({ packsAs: to, percent: s.packs > 0 ? String(Math.round((Math.max(0, packs) / s.packs) * 10_000) / 100) : '0' })
    else if (to === 'count') set({ packsAs: to, packs: Math.max(0, packs) })
    else set({ packsAs: to })
  }
  const prices = taxedPrices(s, i)
  const tid = (x: string) => `sale-g${i}-${x}`
  const moreNote = [g.delayHours > 0 && `${fmtHours(g.delayHours)} delay`, g.perTx > 0 && `${g.perTx} per purchase`, g.idleMinutes > 0 && `idle ${fmtHours(g.idleMinutes / 60)}`].filter(Boolean).join(', ')
  return (
    <div className={`group-card ${mine.some((p) => !p.warning) ? 'has-problem' : ''}`} style={{ borderLeftColor: GROUP_COLORS[i % GROUP_COLORS.length] }} data-testid={`sale-group-${i}`}>
      <div className="group-head">
        <span className="group-num" style={{ background: GROUP_COLORS[i % GROUP_COLORS.length] }}>{i + 1}</span>
        <input className="group-name" value={g.name} placeholder={`Group ${i + 1}`} onChange={(e) => set({ name: e.target.value })} data-testid={tid('name')} />
        <span className="group-packs">
          {g.unlimited ? <span className="muted small">no pack count (sells on top)</span> : <>
            {g.packsAs === 'count' && <Num value={g.packs} onChange={(v) => set({ packs: v })} testId={tid('packs')} width={84} />}
            {g.packsAs === 'percent' && <Text value={g.percent} onChange={(v) => set({ percent: v })} testId={tid('percent')} width={64} />}
            {g.packsAs === 'rest' && <b data-testid={tid('rest')}>{n(packs)}</b>}
            <span className="seg" role="group" aria-label="packs as">
              {(['count', 'percent', 'rest'] as PacksAs[]).map((m) => (
                <button key={m} className={g.packsAs === m ? 'on' : ''} onClick={() => mode(m)} data-testid={tid(`as-${m}`)}>{m === 'count' ? 'packs' : m === 'percent' ? '%' : 'the rest'}</button>
              ))}
            </span>
            {g.packsAs !== 'rest' && <span className="muted small">{g.packsAs === 'percent' ? `= ${n(packs)} packs` : s.packs > 0 ? `${Math.round((packs / s.packs) * 1000) / 10}%` : ''}</span>}
          </>}
        </span>
        <span className="group-tools">
          <button className="icon" title="Move up" disabled={busy || i === 0} onClick={() => move(i - 1)}>↑</button>
          <button className="icon" title="Move down" disabled={busy || i === s.groups.length - 1} onClick={() => move(i + 1)}>↓</button>
          <button className="icon danger" title="Remove" disabled={busy} onClick={remove} data-testid={tid('remove')}>×</button>
        </span>
      </div>
      {mine.filter((p) => p.field === 'packs' || p.field === 'percent').map((p, k) => <span key={k} className="err-text small">{p.message}</span>)}

      <div className="group-grid">
        <GF all={mine} gi={i} f="gate" also={['nft', 'perNft', 'root']} label="Who" wide={g.gate !== 'open'} hint={g.gate === 'snapshot' && g.root ? 'From the snapshot script.' : g.gate === 'nft' ? 'Each NFT counts once per drop, whoever holds it.' : undefined}>
          <span className="row inline wrap">
            <select value={g.gate} onChange={(e) => set({ gate: e.target.value as Gate, ...(e.target.value === 'nft' && !g.perNft ? { perNft: 1, nft: g.nft || 'press' } : {}) })} data-testid={tid('gate')}>
              <option value="open">Anyone</option>
              <option value="nft">NFT holders</option>
              <option value="snapshot">Snapshot list</option>
            </select>
            {g.gate === 'nft' && <>
              <select value={g.nft === 'press' ? 'press' : 'other'} onChange={(e) => set({ nft: e.target.value === 'press' ? 'press' : '' })} data-testid={tid('nft-kind')}>
                <option value="press">Paper Press</option>
                <option value="other">Other contract</option>
              </select>
              {g.nft !== 'press' && <Text value={g.nft} onChange={(v) => set({ nft: v })} testId={tid('nft')} width={200} placeholder="0x… (ERC-721)" />}
              <span className="small muted">packs per NFT</span><Num value={g.perNft} onChange={(v) => set({ perNft: v })} testId={tid('per-nft')} width={60} />
            </>}
            {g.gate === 'snapshot' && <Text value={g.root} onChange={(v) => set({ root: v })} testId={tid('root')} width={230} placeholder="root: 0x… (blank until launch)" />}
          </span>
        </GF>
        <GF all={mine} gi={i} f="priceUsd" label="Price ($)" hint="0 = none."><Text value={g.priceUsd} onChange={(v) => set({ priceUsd: v })} testId={tid('price')} width={80} /></GF>
        <GF all={mine} gi={i} f="paper" label="PAPER" hint="Burned. 0 = none."><Text value={g.paper} onChange={(v) => set({ paper: v })} testId={tid('paper')} width={70} /></GF>
        <GF all={mine} gi={i} f="coins" label="Pays in">
          <span className={`row inline coins ${priced ? '' : 'off'}`}>
            {COINS.map((c) => (
              <label key={c} className="small"><input type="checkbox" disabled={!priced} checked={!!(g.coins & COIN[c])} onChange={(e) => set({ coins: e.target.checked ? g.coins | COIN[c] : g.coins & ~COIN[c] })} data-testid={tid(`coin-${c}`)} />{c}</label>
            ))}
          </span>
        </GF>
        {priced && <>
          <GF all={mine} gi={i} f="plankBurnPercent" label="PLANK burn (%)" hint="Of its dollar price. 100 = all of it."><Text value={g.plankBurnPercent} onChange={(v) => set({ plankBurnPercent: v })} testId={tid('burn')} width={60} /></GF>
          <GF all={mine} gi={i} f="paperBurnPercent" label="PAPER buy & burn (%)" hint="Plus any rising-price tax."><Text value={g.paperBurnPercent} onChange={(v) => set({ paperBurnPercent: v })} testId={tid('paper-burn')} width={60} /></GF>
        </>}
        <GF all={mine} gi={i} f="perWallet" label="Per wallet" hint="0 = no limit."><Num value={g.perWallet} onChange={(v) => set({ perWallet: v })} testId={tid('per-wallet')} width={70} /></GF>
        {(g.perWallet > 0 || g.limitHours > 0) && (
          <GF all={mine} gi={i} f="limitHours" label="Limit lifts after (hours)" hint="From when it opens. Blank = never."><Num value={g.limitHours} step={0.5} blank="never" onChange={(v) => set({ limitHours: v })} testId={tid('limit-hours')} width={70} /></GF>
        )}
        <GF all={mine} gi={i} f="afterGroup" label="Opens">
          <select value={g.afterGroup} onChange={(e) => set({ afterGroup: Number(e.target.value) })} data-testid={tid('after')}>
            <option value={-1}>with the drop</option>
            {s.groups.map((_, k) => (k < i || k === g.afterGroup) && k !== i ? <option key={k} value={k}>after {groupName(s, k)}</option> : null)}
          </select>
        </GF>
        <GF all={mine} gi={i} f="hours" label="Max time (hours)" hint={g.unlimited ? '0 = no limit.' : '0 = until sold.'}><Num value={g.hours} step={0.5} onChange={(v) => set({ hours: v })} testId={tid('hours')} width={70} /></GF>
        {!g.unlimited && (
          <GF all={mine} gi={i} f="rollTo" label="Leftovers to">
            <select value={g.rollTo} onChange={(e) => set({ rollTo: Number(e.target.value) })} data-testid={tid('roll')}>
              <option value={-1}>nowhere (never made)</option>
              {s.groups.map((_, k) => (k > i || k === g.rollTo) && k !== i ? <option key={k} value={k}>{groupName(s, k)}</option> : null)}
            </select>
          </GF>
        )}
        <GF all={mine} gi={i} f="taxPercent" label="Rising price (% a pack)" hint="0 = off. The rise burns PAPER."><Text value={g.taxPercent} onChange={(v) => set({ taxPercent: v })} testId={tid('tax')} width={60} /></GF>
        <GF all={mine} gi={i} f="unlimited" label="Unlimited" hint="Needs a rising price + idle end.">
          <label className="small"><input type="checkbox" checked={g.unlimited} onChange={(e) => set({ unlimited: e.target.checked, ...(e.target.checked ? { rollTo: -1 } : {}) })} data-testid={tid('unlimited')} /> sells until nobody buys</label>
        </GF>
        {g.unlimited && !moreOpen && (
          <GF all={mine} gi={i} f="idleMinutes" label="Ends after no sale for (min)" hint="0 = off."><Num value={g.idleMinutes} onChange={(v) => set({ idleMinutes: v })} testId={tid('idle')} width={70} /></GF>
        )}
      </div>
      <button className="link small more" onClick={() => setMore(!moreOpen)} data-testid={tid('more')}>
        {moreOpen ? '− less' : `+ more${moreNote ? ` (${moreNote})` : ''}`}
      </button>
      {moreOpen && (
        <div className="group-grid" data-testid={tid('more-fields')}>
          <GF all={mine} gi={i} f="delayHours" label={g.afterGroup >= 0 ? `Delay after ${groupName(s, g.afterGroup)} (h)` : 'Delay after the drop opens (h)'} hint="0 = right away."><Num value={g.delayHours} step={0.5} onChange={(v) => set({ delayHours: v })} testId={tid('delay')} width={70} /></GF>
          <GF all={mine} gi={i} f="perTx" label="Per purchase" hint={`0 = the drop's ${s.maxPerTx}.`}><Num value={g.perTx} onChange={(v) => set({ perTx: v })} testId={tid('per-tx')} width={70} /></GF>
          <GF all={mine} gi={i} f="idleMinutes" label="Ends after no sale for (min)" hint="0 = off."><Num value={g.idleMinutes} onChange={(v) => set({ idleMinutes: v })} testId={tid('idle')} width={70} /></GF>
        </div>
      )}
      <p className="group-summary" data-testid={tid('summary')}>{groupSummary(s, i)}</p>
      {prices.length > 0 && (
        <p className="muted small group-prices" data-testid={tid('prices')}>
          {prices.map((p) => `pack ${p.k}: ${usd(p.usd)}`).join(' · ')}{!g.unlimited && packs > 50 ? ` · pack ${n(packs)} (last): ${usd(taxedPrice(Number(g.priceUsd), Math.round(Number(g.taxPercent) * 100), packs))}` : ''}
        </p>
      )}
    </div>
  )
}

/** The drop as one picture, live as the numbers change: the dollars, the base packs split by group, and the groups
 *  on a timeline ("up to" times: a group can end sooner, when it sells out or idles). */
function DropPicture({ s, lockedPacks, cardsPerPack }: { s: SaleSettings; lockedPacks: number | null; cardsPerPack: number }) {
  const d = dropPlan(s)
  const color = (i: number) => GROUP_COLORS[i % GROUP_COLORS.length]
  const w = (x: number) => (d.total ? `${(x / d.total) * 100}%` : '0')
  const cg = s.groups[s.creditGroup]
  return (
    <div className="drop-pic" data-testid="sale-summary">
      <div className="stats-row">
        <div className="stat"><b data-testid="drop-total">{n(s.packs)}</b><span>base packs · {n(s.packs * cardsPerPack)} cards</span></div>
        <div className="stat"><b data-testid="drop-revenue">{usd(d.revenueUsd)}</b><span>sold out{d.freeMax > 0 ? ` · ${usd(d.revenueMinUsd)} if every free pack is used` : ''}</span></div>
        <div className="stat"><b>{usd(d.paperUsd)}</b><span>of PAPER bought &amp; burned</span></div>
        <div className="stat"><b>{usd(d.burnUsd)}</b><span>of PLANK burned</span></div>
        <div className="stat"><b>{usd(d.keepUsd)}</b><span>to the revenue wallet</span></div>
      </div>
      {d.total > 0 && (
        <div className="drop-bar" role="img" aria-label={s.groups.map((_, i) => `${groupName(s, i)} ${d.packs[i]}`).join(', ')}>
          {s.groups.map((g, i) => !g.unlimited && d.packs[i] > 0 && (
            <span key={i} style={{ width: w(d.packs[i]), background: color(i) }} title={`${groupName(s, i)}: ${n(d.packs[i])}`}>
              {d.packs[i] / d.total > 0.12 ? `${n(d.packs[i])} ${groupName(s, i)}` : ''}
            </span>
          ))}
        </div>
      )}
      <Timeline s={s} />
      <div className="drop-legend">
        <span>Free packs, at most <b data-testid="drop-free-max">{n(d.freeMax)}</b>{cg ? ` from ${groupName(s, s.creditGroup)}` : ' (no group: none)'}{d.freeCapped ? ` (${s.creditPacksPercent}%)` : ''}</span>
        <span>Sell-out: every group sells its own packs; an unlimited group's sales come on top.</span>
      </div>
      {lockedPacks != null && s.packs !== lockedPacks && <p className="err-text" data-testid="sale-packs-locked">The deal is locked at {n(lockedPacks)} packs: the total must be that (or undo the lock).</p>}
    </div>
  )
}

/** The groups side by side or one after another. Bars run to their latest end; a group that runs until sold fades
 *  out (its end isn't known), an unlimited one runs off the edge. */
function Timeline({ s }: { s: SaleSettings }) {
  const times = groupTimes(s)
  if (!s.groups.length) return null
  const known = [0, ...times.flatMap((t) => [t.opens, t.ends]).filter((x): x is number => x != null)]
  const horizon = Math.max(1, ...known)
  const guess = Math.max(horizon * 0.35, 2)
  const bars: { start: number; end: number; open: boolean; unknownStart: boolean }[] = []
  s.groups.forEach((g, i) => {
    const t = times[i]
    const after = g.afterGroup >= 0 && g.afterGroup < i ? bars[g.afterGroup] : null
    const start = t.opens ?? (after ? after.end + Math.max(0, g.delayHours || 0) : 0)
    const end = t.ends ?? start + guess
    bars.push({ start, end, open: t.ends == null, unknownStart: t.opens == null })
  })
  const span = Math.max(...bars.map((b) => b.end)) * 1.08
  const pc = (h: number) => `${Math.min(100, (h / span) * 100)}%`
  const ticks = [...new Set(known)].sort((a, b) => a - b).filter((h, k, all) => k === 0 || (h - all[k - 1]) / span > 0.05)
  return (
    <div className="timeline" data-testid="sale-timeline">
      {s.groups.map((g, i) => {
        const b = bars[i]
        const t = times[i]
        const label = g.unlimited ? 'no count' : `${n(groupPacks(s)[i])}`
        const when = t.ends != null ? `up to ${fmtHours(t.ends - (t.opens ?? 0))}` : g.unlimited ? 'until nobody buys' : 'until sold'
        return (
          <div className="tl-row" key={i}>
            <span className="tl-name" title={groupName(s, i)}>{groupName(s, i)}</span>
            <span className="tl-track">
              <span className={`tl-bar ${b.open ? (g.unlimited ? 'endless' : 'fade') : ''}`} data-testid={`sale-tl-${i}`}
                style={{ left: pc(b.start), width: g.unlimited && b.open ? `calc(100% - ${pc(b.start)})` : `calc(${pc(b.end)} - ${pc(b.start)})`, background: GROUP_COLORS[i % GROUP_COLORS.length] }}
                title={`${groupName(s, i)}: ${t.opens != null ? `opens by ${fmtHours(t.opens)}` : `opens when ${groupName(s, g.afterGroup)} sells out`}, ${when}`}>
                {label} · {when}{b.unknownStart ? ' · after sell-out' : ''}
              </span>
            </span>
          </div>
        )
      })}
      <div className="tl-row tl-axis">
        <span className="tl-name muted small">from the start</span>
        <span className="tl-track">
          {ticks.map((h) => <span key={h} className="tl-tick" style={{ left: pc(h) }}>{h === 0 ? '0' : fmtHours(h)}</span>)}
        </span>
      </div>
    </div>
  )
}

/** One drop-wide setting: label, input, a plain hint and its problems. */
function F({ all, f, label, hint, children }: { all: SaleProblem[]; f: SaleField; label: string; hint?: ReactNode; children: ReactNode }) {
  const ps = all.filter((p) => p.field === f && p.group === undefined)
  return (
    <label className={`field sale-field ${ps.some((p) => !p.warning) ? 'has-problem' : ''}`} data-testid={`sale-field-${f}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
      {ps.map((p, k) => <span key={k} className={p.warning ? 'warn-text small' : 'err-text small'}>{p.message}</span>)}
    </label>
  )
}

/** One group setting (its problems are the group's own, already filtered). */
function GF({ all, gi, f, also = [], label, hint, children, wide }: { all: SaleProblem[]; gi: number; f: GroupField; also?: GroupField[]; label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  const ps = all.filter((p) => p.field === f || also.includes(p.field as GroupField))
  return (
    <div className={`field sale-field ${wide ? 'wide' : ''} ${ps.some((p) => !p.warning) ? 'has-problem' : ''}`} data-testid={`sale-g${gi}-field-${f}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
      {ps.map((p, k) => <span key={k} className={p.warning ? 'warn-text small' : 'err-text small'}>{p.message}</span>)}
    </div>
  )
}

/** The ops sale policy's warnings: the contract takes the drop, but launch.mjs and VerifySeries stop on it. */
function PolicyProblems({ s, problems }: { s: SaleSettings; problems: PolicyProblem[] }) {
  const red = [...new Set(problems.filter((p) => p.red).map((p) => p.policy))]
  return (
    <Notice kind="warn">
      <span data-testid="sale-policy">
        Outside the ops sale policy. The contract takes it, but launch.mjs and VerifySeries {red.length ? <>stop on the RED ones (run them with <code>--allow {red.join(',')}</code> only if meant)</> : 'warn'}:
      </span>
      <ul className="problems">{problems.map((p, i) => <li key={i}>{p.red ? <b>RED </b> : 'warn '}· {p.group !== undefined ? `${groupName(s, p.group)}: ` : ''}{p.message.replace(/^Policy: /, '')}</li>)}</ul>
    </Notice>
  )
}

function SaleProblems({ s, problems }: { s: SaleSettings; problems: SaleProblem[] }) {
  return (
    <Notice kind="error">
      configureDrop would refuse this:
      <ul className="problems">{problems.map((p, i) => <li key={i}>{p.group !== undefined ? `${groupName(s, p.group)}: ` : ''}{p.message}</li>)}</ul>
    </Notice>
  )
}
