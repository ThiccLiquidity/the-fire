/** The Deal tab's live preview: dealFire runs in a worker (deal.worker.ts), debounced while the seed or setup is being
 *  edited, and a newer request always wins. Falls back to the main thread where workers aren't available. */

import { useEffect, useState } from 'react'
import { dealFire, type DealInput, type DealResult } from './deal'
import type { DealWorkerIn, DealWorkerOut } from './deal.worker'

/** Identifies the inputs a preview was dealt from, so a lock never stores a stale preview. */
export function dealInputKey(input: DealInput): string {
  return JSON.stringify([input.fire, input.packs, input.characterIds, input.seed, input.diamonds, input.firstSerial])
}

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, (r: DealWorkerOut) => void>()

function getWorker(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined') return null
  try {
    worker = new Worker(new URL('./deal.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<DealWorkerOut>) => {
      const done = waiting.get(e.data.id)
      waiting.delete(e.data.id)
      done?.(e.data)
    }
    worker.onerror = (e) => {
      for (const [id, done] of waiting) done({ id, error: e.message || 'deal worker crashed' })
      waiting.clear()
      worker?.terminate()
      worker = null
    }
    return worker
  } catch {
    return null
  }
}

/** Deal off the main thread (or on it, as a fallback). */
export function dealInBackground(input: DealInput): Promise<DealResult> {
  const w = getWorker()
  if (!w) return Promise.resolve().then(() => dealFire(input))
  const id = nextId++
  return new Promise<DealResult>((resolve, reject) => {
    waiting.set(id, (r) => ('result' in r ? resolve(r.result) : reject(new Error(r.error))))
    w.postMessage({ id, input } satisfies DealWorkerIn)
  })
}

export interface DealPreview {
  result: DealResult | null
  /** dealInputKey of the inputs `result` was dealt from. */
  key: string | null
  pending: boolean
  error: string | null
}

/** Debounced (`delayMs`) background deal of `input`; null input clears the preview. */
export function useDealPreview(input: DealInput | null, delayMs = 250): DealPreview {
  const want = input ? dealInputKey(input) : null
  const [state, setState] = useState<DealPreview>({ result: null, key: null, pending: false, error: null })
  useEffect(() => {
    if (!input || !want) {
      setState({ result: null, key: null, pending: false, error: null })
      return
    }
    let live = true
    setState((s) => ({ ...s, pending: true }))
    const t = setTimeout(() => {
      dealInBackground(input).then(
        (result) => { if (live) setState({ result, key: want, pending: false, error: null }) },
        (e: Error) => { if (live) setState({ result: null, key: want, pending: false, error: e.message }) },
      )
    }, delayMs)
    return () => { live = false; clearTimeout(t) }
    // `want` captures every input that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, delayMs])
  return state
}
