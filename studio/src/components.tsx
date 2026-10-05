import { useRef, useState, type ReactNode } from 'react'

export function ProgressBar({ value, label, tone }: { value: number; label?: ReactNode; tone?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${pct}%`, background: tone }} />
      {label !== undefined && <span className="progress-label">{label}</span>}
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
