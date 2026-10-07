import { useMemo, type ReactNode } from 'react'
import { Notice, useAction } from '../components'
import {
  CARDS_PER_CREDIT, MAX_WINDOW_HOURS, PRESS_PRICE_LABEL, SALE_PRESETS, checkSale, creditPacksMax, saleJson, saleOf, saleSummary, 
  type PressPrice, type SaleField, type SaleProblem, type SaleSettings,
} from '../sale'
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
  const sum = saleSummary(s)
  const set = (patch: Partial<SaleSettings>) => void run(() => updateFire(fire.number, { sale: { ...s, ...patch } }))
  const preset = (name: string, next: SaleSettings) => {
    if (JSON.stringify({ ...next, start: s.start, holderRoot: s.holderRoot }) === JSON.stringify(s)) return
    if (!confirm(`Replace this Series' sale settings with ${name}? (Start and snapshot root are kept.)`)) return
    void run(() => updateFire(fire.number, { sale: { ...next, start: s.start, holderRoot: s.holderRoot } }))
  }

  const pressOn = s.pressPacks > 0
  const usd = s.pressPrice === 'usd' || s.pressPrice === 'usdPaper'
  const paper = s.pressPrice === 'paper' || s.pressPrice === 'usdPaper'

  return (
    <section className="panel grow sale" data-testid="sale-editor">
      <div className="row wrap">
        <h2 style={{ margin: 0 }}>Series {fire.number} · Sale</h2>
        <span className="muted small">FireSale.configureDrop: every number is per drop and locks when the drop opens.</span>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="row wrap">
        <span className="muted small">Start from:</span>
        {SALE_PRESETS.map((p) => (
          <button key={p.name} disabled={busy} onClick={() => preset(p.name, p.make())} data-testid={`sale-preset-${p.name.toLowerCase()}`}>{p.name}</button>
        ))}
        <span className={`badge ${errors.length ? 'badge-warn' : 'badge-ok'}`} data-testid="sale-status">
          {errors.length ? `${errors.length} to fix` : 'Valid'}
        </span>
      </div>
      <p className="small" data-testid="sale-summary">
        <b>{sum.total.toLocaleString()}</b> packs ({s.paidPacks.toLocaleString()} paid + {s.pressPacks.toLocaleString()} press)
        {' '}· sold out brings in about <b>${sum.maxUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
        {sum.total !== fire.packs && <span className="warn-text"> · the Series' deal is planned for {fire.packs.toLocaleString()} packs</span>}
      </p>

      <h3>When</h3>
      <div className="sale-grid">
        <F all={problems} f="start" label="Opens (your local time)" hint="Blank: set it later with DROP_START.">
          <span className="row inline">
            <input type="datetime-local" value={toLocal(s.start)} onChange={(e) => set({ start: fromLocal(e.target.value) })} data-testid="sale-start" />
            {s.start !== 0 && <button className="link" onClick={() => set({ start: 0 })}>clear</button>}
          </span>
        </F>
      </div>

      <h3>Packs and price</h3>
      <div className="sale-grid">
        <F all={problems} f="paidPacks" label="Paid packs" hint="Bought with PLANK, ETH or USDG."><Num value={s.paidPacks} onChange={(v) => set({ paidPacks: v })} testId="sale-paid" /></F>
        <F all={problems} f="priceUsd" label="Price per pack ($)"><Text value={s.priceUsd} onChange={(v) => set({ priceUsd: v })} testId="sale-price" /></F>
        <F all={problems} f="paperPerPack" label="PAPER per pack" hint="Burned. Paid and free-credit packs. 0 = none."><Text value={s.paperPerPack} onChange={(v) => set({ paperPerPack: v })} testId="sale-paper" /></F>
        <F all={problems} f="paperCapUsd" label="PAPER ceiling ($)" hint="A pack's PAPER is never worth more than this at the PAPER price (paid, press and free packs). 0 = no ceiling."><Text value={s.paperCapUsd} onChange={(v) => set({ paperCapUsd: v })} testId="sale-paper-cap" /></F>
        <F all={problems} f="plankBurnPercent" label="PLANK burn share (%)" hint="Of each sale; the rest goes to revenue."><Text value={s.plankBurnPercent} onChange={(v) => set({ plankBurnPercent: v })} testId="sale-burn" /></F>
        <F all={problems} f="maxPerTx" label="Most packs per purchase"><Num value={s.maxPerTx} onChange={(v) => set({ maxPerTx: v })} testId="sale-maxtx" /></F>
      </div>

      <h3>PLANK lights the forge</h3>
      <div className="sale-grid">
        <F all={problems} f="plankOnly" label="PLANK-only packs" hint="The first paid packs only PLANK can buy."><Num value={s.plankOnly} onChange={(v) => set({ plankOnly: v })} testId="sale-plankonly" /></F>
        <F all={problems} f="plankOnlyHours" label="Open to ETH and USDG after (hours)" hint="Even if they haven't sold (a feed outage can't stall the drop)."><Num value={s.plankOnlyHours} step={0.5} onChange={(v) => set({ plankOnlyHours: v })} testId="sale-plankonly-hours" /></F>
      </div>

      <h3>Fairness</h3>
      <div className="sale-grid">
        <F all={problems} f="walletLimit" label="Paid packs per wallet" hint="0 = no limit (lift time 0 too)."><Num value={s.walletLimit} onChange={(v) => set({ walletLimit: v })} testId="sale-limit" /></F>
        <F all={problems} f="liftHours" label="Wallet limit lifts after (hours)"><Num value={s.liftHours} step={0.5} onChange={(v) => set({ liftHours: v })} testId="sale-lift" /></F>
        <F all={problems} f="holderHours" label="Holders only for (hours)" hint="Press holders and the PLANK snapshot. 0 = open to all."><Num value={s.holderHours} step={0.5} onChange={(v) => set({ holderHours: v })} testId="sale-holder" /></F>
        <F all={problems} f="holderRoot" label="Snapshot root (ops/snapshot)" hint="Blank: presses only, or HOLDER_ROOT later."><Text value={s.holderRoot} width={240} placeholder="0x..." onChange={(v) => set({ holderRoot: v })} testId="sale-root" /></F>
        <F all={problems} f="regularWalletsHours" label="Regular wallets only for (hours)" hint="Bot contracts can't buy paid packs. 0 = off."><Num value={s.regularWalletsHours} step={0.5} onChange={(v) => set({ regularWalletsHours: v })} testId="sale-regular" /></F>
      </div>

      <h3>Press packs</h3>
      <div className="sale-grid">
        <F all={problems} f="pressPacks" label="Press packs" hint="On top of the paid packs. 0 = off. Unclaimed ones join the paid packs after the window."><Num value={s.pressPacks} onChange={(v) => set({ pressPacks: v })} testId="sale-press" /></F>
        {pressOn && <>
          <F all={problems} f="pressPerPress" label="Per press" hint="Each press counts once per drop, up to this many."><Num value={s.pressPerPress} onChange={(v) => set({ pressPerPress: v })} testId="sale-per-press" /></F>
          <F all={problems} f="pressPerWallet" label="Per wallet"><Num value={s.pressPerWallet} onChange={(v) => set({ pressPerWallet: v })} testId="sale-press-wallet" /></F>
          <F all={problems} f="pressHours" label="Claim window (hours)"><Num value={s.pressHours} step={0.5} onChange={(v) => set({ pressHours: v })} testId="sale-press-hours" /></F>
          <F all={problems} f="pressPrice" label="They cost">
            <select value={s.pressPrice} onChange={(e) => set({ pressPrice: e.target.value as PressPrice })} data-testid="sale-press-price">
              {(Object.keys(PRESS_PRICE_LABEL) as PressPrice[]).map((k) => <option key={k} value={k}>{PRESS_PRICE_LABEL[k]}</option>)}
            </select>
          </F>
          {usd && <F all={problems} f="pressUsd" label="Press pack price ($)" hint="Paid like a paid pack, burn share included."><Text value={s.pressUsd} onChange={(v) => set({ pressUsd: v })} testId="sale-press-usd" /></F>}
          {paper && <F all={problems} f="pressPaper" label="PAPER per press pack" hint="Burned."><Text value={s.pressPaper} onChange={(v) => set({ pressPaper: v })} testId="sale-press-paper" /></F>}
        </>}
      </div>

      <h3>Free pack credits</h3>
      <div className="sale-grid">
        <div className="field sale-field" data-testid="sale-cards-per-credit">
          <span className="field-label">Cards burned per free pack</span>
          <b className="pad">{CARDS_PER_CREDIT} (fixed forever)</b>
          <span className="muted small">Burn progress carries over between Series, so this never changes.</span>
        </div>
        <F all={problems} f="creditsPerPick" label="Credits per picked suggestion" hint="0 = none."><Num value={s.creditsPerPick} onChange={(v) => set({ creditsPerPick: v })} testId="sale-picks" /></F>
        <F all={problems} f="creditPacksPercent" label="Free packs in this drop, at most (%)" hint={`Of all the drop's packs: ${creditPacksMax(s) || 'no limit'}${creditPacksMax(s) ? ' packs' : ''}. 0 = no limit.`}><Text value={s.creditPacksPercent} onChange={(v) => set({ creditPacksPercent: v })} testId="sale-credit-max" /></F>
        <F all={problems} f="creditPacksPerWallet" label="Free packs per wallet, at most" hint="0 = no limit."><Num value={s.creditPacksPerWallet} onChange={(v) => set({ creditPacksPerWallet: v })} testId="sale-credit-wallet" /></F>
      </div>

      <p className="muted small">
        Every phase is at most {MAX_WINDOW_HOURS} hours. A drop that doesn't sell out can be ended by the owner once its
        last phase is over, and by anyone 7 days after that.
      </p>
      <details>
        <summary className="small">The "sale" block in recipe.json</summary>
        <pre className="small" data-testid="sale-json">{JSON.stringify(json, null, 1)}</pre>
      </details>
      {errors.length > 0 && <SaleProblems problems={errors} />}
    </section>
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
