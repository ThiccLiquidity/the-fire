import { useMemo, type ReactNode } from 'react'
import { Notice, useAction } from '../components'
import {
  CARDS_PER_CREDIT, MAX_WINDOW_HOURS, PRESS_PRICE_LABEL, SALE_PRESETS, checkSale, creditPacksMax, dropPlan, parseDecimal, saleJson, saleOf, salePacks,
  type PressPrice, type SaleField, type SaleProblem, type SaleSettings,
} from '../sale'
import { cardsPerPack } from '../recipe'
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

function Num({ value, onChange, testId, step = 1, width = 90 }: { value: number; onChange: (v: number) => void; testId: string; step?: number; width?: number }) {
  return (
    <input type="number" min={0} step={step} value={Number.isFinite(value) ? value : ''} style={{ width }} data-testid={testId}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
  )
}

function Text({ value, onChange, testId, width = 90, placeholder }: { value: string; onChange: (v: string) => void; testId: string; width?: number; placeholder?: string }) {
  return <input value={value} style={{ width }} placeholder={placeholder} data-testid={testId} inputMode="decimal" onChange={(e) => onChange(e.target.value.trim())} />
}

export function SaleEditor({ fire }: { fire: FireRecord }) {
  const [busy, error, run] = useAction()
  const s = useMemo(() => saleOf(fire), [fire])
  const problems = useMemo(() => checkSale(s), [s])
  const errors = problems.filter((p) => !p.warning)
  const json = useMemo(() => saleJson(s), [s])
  const d = dropPlan(s)
  const locked = !!fire.deal
  // the Series' pack count is the drop's (paid + press); it follows the sale until the deal is locked
  const save = (sale: SaleSettings) => run(() => updateFire(fire.number, locked ? { sale } : { sale, packs: Math.min(MAX_PACKS, Math.max(0, Math.floor(salePacks(sale)) || 0)) }))
  const set = (patch: Partial<SaleSettings>) => void save({ ...s, ...patch })
  const preset = (name: string, next: SaleSettings) => {
    if (JSON.stringify({ ...next, start: s.start, holderRoot: s.holderRoot }) === JSON.stringify(s)) return
    if (!confirm(`Replace this Series' sale settings with ${name}? (Start and snapshot root are kept.)`)) return
    void save({ ...next, start: s.start, holderRoot: s.holderRoot })
  }
  const perPack = cardsPerPack(fire.recipe)
  const packsOff = !!fire.deal && salePacks(s) !== fire.deal.packs
  const toFix = errors.length + (packsOff ? 1 : 0)

  const pressOn = s.pressPacks > 0
  const pressUsd = s.pressPrice === 'usd' || s.pressPrice === 'usdPaper'
  const pressPaper = s.pressPrice === 'paper' || s.pressPrice === 'usdPaper'
  const price = Number(parseDecimal(s.priceUsd, 8) ?? 0n) / 1e8
  const burn = Number(parseDecimal(s.plankBurnPercent, 2) ?? 0n) / 10_000
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
      </div>
      <DropPicture s={s} lockedPacks={fire.deal ? fire.deal.packs : null} cardsPerPack={perPack} />

      <h3>Packs</h3>
      <div className="sale-grid">
        <F all={problems} f="paidPacks" label="Paid packs" hint="PLANK, ETH or USDG. Paid + press = the Series' packs."><Num value={s.paidPacks} onChange={(v) => set({ paidPacks: v })} testId="sale-paid" /></F>
        <F all={problems} f="pressPacks" label="Press packs" hint="On top. Unclaimed ones join the paid. 0 = off."><Num value={s.pressPacks} onChange={(v) => set({ pressPacks: v })} testId="sale-press" /></F>
        <F all={problems} f="plankOnly" label="PLANK-only packs" hint={`The first ${n(d.plankOnly)} of the ${n(d.paid)} paid.`}><Num value={s.plankOnly} onChange={(v) => set({ plankOnly: v })} testId="sale-plankonly" /></F>
        <F all={problems} f="creditPacksPercent" label="Free packs, at most (%)" hint={cap ? `= ${n(d.freeMax)} of ${n(d.total)} packs, from the paid ones.` : '0 = no cap.'}><Text value={s.creditPacksPercent} onChange={(v) => set({ creditPacksPercent: v })} testId="sale-credit-max" /></F>
      </div>

      <h3>Price</h3>
      <div className="sale-grid">
        <F all={problems} f="priceUsd" label="Price per pack ($)" hint="Unclaimed press packs sell at it too."><Text value={s.priceUsd} onChange={(v) => set({ priceUsd: v })} testId="sale-price" /></F>
        <F all={problems} f="paperPerPack" label="PAPER per pack" hint="Burned. Paid and free packs. 0 = none."><Text value={s.paperPerPack} onChange={(v) => set({ paperPerPack: v })} testId="sale-paper" /></F>
        <F all={problems} f="paperCapUsd" label="PAPER ceiling ($)" hint="Most a pack's PAPER can be worth. 0 = none."><Text value={s.paperCapUsd} onChange={(v) => set({ paperCapUsd: v })} testId="sale-paper-cap" /></F>
        <F all={problems} f="plankBurnPercent" label="PLANK burn (%)" hint={`= ${usd(price * burn)} a paid pack · ${usd(d.burnUsd)} sold out.`}><Text value={s.plankBurnPercent} onChange={(v) => set({ plankBurnPercent: v })} testId="sale-burn" /></F>
        <F all={problems} f="maxPerTx" label="Most packs per purchase"><Num value={s.maxPerTx} onChange={(v) => set({ maxPerTx: v })} testId="sale-maxtx" /></F>
      </div>

      {pressOn && <>
        <h3>Press packs</h3>
        <div className="sale-grid">
          <F all={problems} f="pressPerPress" label="Per press" hint="Each press counts once per drop."><Num value={s.pressPerPress} onChange={(v) => set({ pressPerPress: v })} testId="sale-per-press" /></F>
          <F all={problems} f="pressPerWallet" label="Per wallet"><Num value={s.pressPerWallet} onChange={(v) => set({ pressPerWallet: v })} testId="sale-press-wallet" /></F>
          <F all={problems} f="pressHours" label="Claim window (hours)"><Num value={s.pressHours} step={0.5} onChange={(v) => set({ pressHours: v })} testId="sale-press-hours" /></F>
          <F all={problems} f="pressPrice" label="They cost">
            <select value={s.pressPrice} onChange={(e) => set({ pressPrice: e.target.value as PressPrice })} data-testid="sale-press-price">
              {(Object.keys(PRESS_PRICE_LABEL) as PressPrice[]).map((k) => <option key={k} value={k}>{PRESS_PRICE_LABEL[k]}</option>)}
            </select>
          </F>
          {pressUsd && <F all={problems} f="pressUsd" label="Press pack price ($)" hint="Burn share included."><Text value={s.pressUsd} onChange={(v) => set({ pressUsd: v })} testId="sale-press-usd" /></F>}
          {pressPaper && <F all={problems} f="pressPaper" label="PAPER per press pack" hint="Burned."><Text value={s.pressPaper} onChange={(v) => set({ pressPaper: v })} testId="sale-press-paper" /></F>}
        </div>
      </>}

      <h3>When and who</h3>
      <div className="sale-grid">
        <F all={problems} f="start" label="Opens (your time)" hint="Blank: set later (DROP_START).">
          <span className="row inline">
            <input type="datetime-local" value={toLocal(s.start)} onChange={(e) => set({ start: fromLocal(e.target.value) })} data-testid="sale-start" />
            {s.start !== 0 && <button className="link" onClick={() => set({ start: 0 })}>clear</button>}
          </span>
        </F>
        <F all={problems} f="holderHours" label="Holders only (hours)" hint="Presses and the PLANK snapshot. 0 = off."><Num value={s.holderHours} step={0.5} onChange={(v) => set({ holderHours: v })} testId="sale-holder" /></F>
        <F all={problems} f="holderRoot" label="Snapshot root" hint="From ops/snapshot. Blank: presses only."><Text value={s.holderRoot} width={240} placeholder="0x..." onChange={(v) => set({ holderRoot: v })} testId="sale-root" /></F>
        <F all={problems} f="plankOnlyHours" label="PLANK-only ends after (hours)" hint="Then ETH and USDG can buy them too."><Num value={s.plankOnlyHours} step={0.5} onChange={(v) => set({ plankOnlyHours: v })} testId="sale-plankonly-hours" /></F>
        <F all={problems} f="walletLimit" label="Paid packs per wallet" hint="0 = no limit (lift 0 too)."><Num value={s.walletLimit} onChange={(v) => set({ walletLimit: v })} testId="sale-limit" /></F>
        <F all={problems} f="liftHours" label="Wallet limit lifts after (hours)"><Num value={s.liftHours} step={0.5} onChange={(v) => set({ liftHours: v })} testId="sale-lift" /></F>
        <F all={problems} f="regularWalletsHours" label="No bot contracts for (hours)" hint="0 = off."><Num value={s.regularWalletsHours} step={0.5} onChange={(v) => set({ regularWalletsHours: v })} testId="sale-regular" /></F>
      </div>

      <h3>Free pack credits</h3>
      <div className="sale-grid">
        <div className="field sale-field" data-testid="sale-cards-per-credit">
          <span className="field-label">Cards burned per free pack</span>
          <b className="pad">{CARDS_PER_CREDIT} · fixed</b>
          {perPack >= CARDS_PER_CREDIT && <span className="warn-text small" data-testid="sale-credit-off">Packs of {perPack} cards: credits can't buy this Series' packs (needs under {CARDS_PER_CREDIT}).</span>}
        </div>
        <F all={problems} f="creditsPerPick" label="Credits per picked suggestion" hint="0 = none."><Num value={s.creditsPerPick} onChange={(v) => set({ creditsPerPick: v })} testId="sale-picks" /></F>
        <F all={problems} f="creditPacksPerWallet" label="Free packs per wallet, at most" hint="0 = no limit."><Num value={s.creditPacksPerWallet} onChange={(v) => set({ creditPacksPerWallet: v })} testId="sale-credit-wallet" /></F>
      </div>

      <p className="muted small">
        Each phase: at most {MAX_WINDOW_HOURS} hours. Not sold out: the owner can end it after the last phase, anyone 7 days later.
      </p>
      <details>
        <summary className="small">The "sale" block in recipe.json</summary>
        <pre className="small" data-testid="sale-json">{JSON.stringify(json, null, 1)}</pre>
      </details>
      {errors.length > 0 && <SaleProblems problems={errors} />}
    </section>
  )
}

const usd = (x: number) => `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const n = (x: number) => x.toLocaleString('en-US')

/** The drop as one picture, live as the numbers change: every pack, paid (the PLANK-only ones first) and press, and
 *  how many of the paid ones can go free to credits. */
function DropPicture({ s, lockedPacks, cardsPerPack }: { s: SaleSettings; lockedPacks: number | null; cardsPerPack: number }) {
  const d = dropPlan(s)
  const w = (x: number) => (d.total ? `${(x / d.total) * 100}%` : '0')
  const label = (x: number, text: string) => (d.total && x / d.total > 0.12 ? text : '')
  const open = d.paid - d.plankOnly
  return (
    <div className="drop-pic" data-testid="sale-summary">
      <div className="stats-row">
        <div className="stat"><b data-testid="drop-total">{n(d.total)}</b><span>packs · {n(d.total * cardsPerPack)} cards</span></div>
        <div className="stat"><b>{usd(d.revenueUsd)}</b><span>sold out{d.freeMax > 0 ? ` · ${usd(d.revenueMinUsd)} if every free pack is used` : ''}</span></div>
        <div className="stat"><b>{usd(d.burnUsd)}</b><span>of PLANK burned at sell-out</span></div>
      </div>
      {d.total > 0 && <>
        <div className="drop-bar" role="img" aria-label={`${d.plankOnly} PLANK-only, ${open} paid, ${d.press} press`}>
          {d.plankOnly > 0 && <span className="plank" style={{ width: w(d.plankOnly) }} title={`${n(d.plankOnly)} PLANK-only`}>{label(d.plankOnly, `${n(d.plankOnly)} PLANK-only`)}</span>}
          {open > 0 && <span className="paid" style={{ width: w(open) }} title={`${n(open)} paid`}>{label(open, `${n(open)} paid`)}</span>}
          {d.press > 0 && <span className="press" style={{ width: w(d.press) }} title={`${n(d.press)} press`}>{label(d.press, `${n(d.press)} press`)}</span>}
        </div>
        {d.freeMax > 0 && (
          <div className="free-line">
            <span style={{ left: `calc(${w(d.paid - d.freeMax)})`, width: w(d.freeMax) }} data-testid="drop-free">
              {d.freeMax / d.total > 0.06 ? `free ≤ ${n(d.freeMax)}` : ''}
            </span>
          </div>
        )}
      </>}
      <div className="drop-legend">
        <span><i style={{ background: '#b9772e' }} />PLANK-only <b>{n(d.plankOnly)}</b> (the first paid)</span>
        <span><i style={{ background: 'var(--accent)' }} />Paid <b>{n(d.paid)}</b> in all</span>
        <span><i style={{ background: '#4a7fe8' }} />Press <b>{n(d.press)}</b></span>
        <span><i style={{ border: '1px solid var(--ok)' }} />Free, at most <b data-testid="drop-free-max">{n(d.freeMax)}</b> {d.freeCapped ? `(${s.creditPacksPercent}%, taken from paid)` : '(no cap: any paid pack)'}</span>
      </div>
      {lockedPacks != null && d.total !== lockedPacks && <p className="err-text" data-testid="sale-packs-locked">The deal is locked at {n(lockedPacks)} packs: paid + press must add up to that (or undo the lock).</p>}
    </div>
  )
}

/** One setting: label, input, a plain hint and its problems. */
function F({ all, f, label, hint, children }: { all: SaleProblem[]; f: SaleField; label: string; hint?: ReactNode; children: ReactNode }) {
  const ps = all.filter((p) => p.field === f)
  return (
    <label className={`field sale-field ${ps.some((p) => !p.warning) ? 'has-problem' : ''}`} data-testid={`sale-field-${f}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
      {ps.map((p, k) => <span key={k} className={p.warning ? 'warn-text small' : 'err-text small'}>{p.message}</span>)}
    </label>
  )
}

function SaleProblems({ problems }: { problems: SaleProblem[] }) {
  return (
    <Notice kind="error">
      configureDrop would refuse this:
      <ul className="problems">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
    </Notice>
  )
}
