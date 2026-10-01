import { useRef, useState, type ReactNode } from 'react'
import type { Accumulators } from './deal'
import { MATERIALS, MATERIAL_LABEL, RATE_SCALE } from './rules'

export function ProgressBar({ value, label, tone }: { value: number; label?: ReactNode; tone?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: tone }} />
      {label !== undefined && <span className="progress-label">{label}</span>}
    </div>
  )
}

const TONE: Record<string, string> = { paper: '#d9c9a3', wood: '#a0683a', burning: '#f07a28', charcoal: '#7c7c88', diamond: '#7fe0ff' }

/** Rarity accumulator progress toward each tier's next card. Negative = a residual card was borrowed. */
export function AccumulatorBars({ acc, title }: { acc: Accumulators; title: string }) {
  return (
    <div className="acc">
      <h4>{title}</h4>
      {MATERIALS.map((m) => {
        const v = acc[m] / RATE_SCALE
        const frac = v - Math.floor(v)
        const text = v < 0
          ? `${(v * 100).toFixed(1)}% (got a rounding card early; repays from the next Fire)`
          : v >= 1 ? `${(v * 100).toFixed(1)}% (${Math.floor(v)} card owed + ${(frac * 100).toFixed(1)}%)` : `${(v * 100).toFixed(1)}%`
        return (
          <div className="acc-row" key={m} data-material={m}>
            <span className="acc-name">{MATERIAL_LABEL[m]}</span>
            <ProgressBar value={v < 0 ? 0 : frac} tone={TONE[m]} label={text} />
          </div>
        )
      })}
    </div>
  )
}

export function DropZone({ onFiles, accept, children, className, testId }: {
  onFiles: (files: File[]) => void
  accept: string
  children: ReactNode
  className?: string
  testId?: string
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
