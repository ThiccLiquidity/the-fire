import { useRef, useState, type ReactNode } from 'react'
import { fillTheRest, formatPercent, parsePercent, percentTotal, percentTotalLine, percentTotalProblem } from './recipe'

export function ProgressBar({ value, label, tone }: { value: number; label?: ReactNode; tone?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: tone }} />
      {label !== undefined && <span className="progress-label">{label}</span>}
    </div>
  )
}

export function DropZone({ onFiles, accept, children, className, testId, multiple }: {
  onFiles: (files: File[]) => void
  accept: string
  children: ReactNode
  className?: string
  testId?: string
  multiple?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      className={`drop ${over ? 'over' : ''} ${className ?? ''}`}
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const files = [...e.dataTransfer.files]
        if (files.length) onFiles(files)
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click() }}
    >
      {children}
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        multiple={multiple}
        data-testid={testId}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </div>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

export function NumberInput({ value, onChange, min, max, step, ...rest }: {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  'data-testid'?: string
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => {
        const n = Number(e.target.value)
        if (Number.isFinite(n)) onChange(n)
      }}
      {...rest}
    />
  )
}

export function Notice({ kind, children }: { kind: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  return <div className={`notice notice-${kind}`}>{children}</div>
}

/** Runs an async action with busy state and error capture. */
export function useAction(): [boolean, string | null, (fn: () => Promise<void>) => Promise<void>, (e: string | null) => void] {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return [busy, error, run, setError]
}

/** A "% of cards" field: up to 2 decimals, 0 to 100. Kept as typed (flagged when it isn't a number), tidied on blur
 *  ("24.10" to "24.1"). */
export function PercentOfCards({ value, onChange, disabled, testId }: { value: string; onChange: (v: string) => void; disabled?: boolean; testId?: string }) {
  const bad = parsePercent(value) == null
  return (
    <span className="pct-input share-input">
      <input value={value} disabled={disabled} aria-invalid={bad} inputMode="decimal" data-testid={testId}
        onChange={(e) => onChange(e.target.value.trim())}
        onBlur={() => { const v = parsePercent(value); if (v != null && formatPercent(v) !== value) onChange(formatPercent(v)) }} />%
    </span>
  )
}

/** The running total of a list of percentages that must add up to exactly 100%: "Total 96.01% · 3.99% left to
 *  assign", the problem when it's off, and the one-click fix ("Fill the rest into Paper"). `what` names the list in the
 *  problem ("The card types"); `names` names each entry. */
export function PercentTotalBar({ percents, names, what, onFill, disabled, testId }: {
  percents: string[]; names: string[]; what: string; onFill: (index: number, percent: string) => void; disabled?: boolean; testId?: string
}) {
  const t = percentTotal(percents)
  const fix = fillTheRest(percents)
  const problem = t.bad.length ? `${t.bad.length === 1 ? 'One % isn\'t' : `${t.bad.length} %s aren't`} a number from 0 to 100 (at most 2 decimals).` : percentTotalProblem(t, what)
  return (
    <div className={`pct-total ${t.ok ? 'ok' : 'off'}`} data-testid={testId}>
      <b data-testid={testId ? `${testId}-line` : undefined}>{percentTotalLine(t)}</b>
      {problem && <span className="err" data-testid={testId ? `${testId}-problem` : undefined}>{problem}</span>}
      {!disabled && fix && (
        <button onClick={() => onFill(fix.index, fix.percent)} data-testid={testId ? `${testId}-fill` : undefined}>
          {t.left > 0 ? `Fill the rest into ${names[fix.index] || `#${fix.index + 1}`}` : `Take the extra ${formatPercent(-t.left)}% from ${names[fix.index] || `#${fix.index + 1}`}`}
        </button>
      )}
    </div>
  )
}
