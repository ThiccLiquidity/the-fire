/** Main-thread orchestration for rendering many cards: batches go to a worker (OffscreenCanvas); if workers or
 *  OffscreenCanvas-in-worker aren't available it falls back to the main thread, yielding between batches. */

import * as db from './db'
import type { DealtCard } from './deal'
import { bundledFontData } from './fonts'
import { frameBlob, frameId } from './frames'
import { CardRenderer, type AssetBundle, type RenderJob, type VariantBlobs } from './renderCore'
import { MATERIALS, WEAR_LEVELS, type WearLook } from './rules'
import { effectiveKey, getStudio } from './store'
import { VARIANTS, type OutputFormat } from './types'
import type { WorkerIn, WorkerOut } from './build.worker'

/** `withWear`: also load the PDA wear frames (only needed once cards have grades). */
export async function collectBundle(characterIds: string[], withWear = false): Promise<AssetBundle> {
  const s = getStudio()
  const frames: AssetBundle['frames'] = {}
  for (const m of MATERIALS) {
    for (const v of VARIANTS) {
      for (const w of (withWear ? ['clean', ...WEAR_LEVELS] : ['clean']) as WearLook[]) {
        const b = frameBlob(m, v, w)
        if (b) frames[frameId(m, v, w)] = await b
      }
    }
  }
  const art: AssetBundle['art'] = {}
  const names: Record<string, string> = {}
  const categories: AssetBundle['categories'] = {}
  for (const id of characterIds) {
    const c = s.characters.find((x) => x.id === id)
    if (!c) continue
    names[id] = c.name
    categories[id] = c.category
    art[id] = {}
    for (const m of MATERIALS) {
      const vb: VariantBlobs = {}
      for (const v of VARIANTS) {
        const slot = c.images[m]?.[v]
        const b = slot ? await db.getBlob(effectiveKey(slot)) : undefined
        if (b) vb[v] = b
      }
      art[id][m] = vb
    }
  }
  const fonts: AssetBundle['fonts'] = []
  for (const f of s.fonts) {
    const b = await db.getBlob(f.key)
    if (b) fonts.push({ family: f.family, data: await b.arrayBuffer() })
  }
  // bundled fonts the layouts use (the page has all of them; workers only get what they need)
  const used = MATERIALS.flatMap((m) => [...Object.values(s.layouts[m].text).map((t) => t.style.font), s.layouts[m].psa.style.font])
  fonts.push(...(await bundledFontData(used)))
  return { layouts: s.layouts, frames, art, names, categories, fonts }
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0))

export interface Progress { done: number; total: number }

/** Renders cards in batches on a small pool of workers (OffscreenCanvas), so WEBP/PNG encoding runs in parallel and
 *  the UI never blocks. Falls back to the main thread (yielding between cards) if workers aren't available. */
export class BatchRenderer {
  private workers: Worker[] = []
  private fallback: CardRenderer | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (b: Blob[]) => void; reject: (e: Error) => void }>()
  private readonly bundle: AssetBundle
  /** e.g. "3 workers" or "main thread", for the UI. */
  mode = 'worker'

  private constructor(bundle: AssetBundle) {
    this.bundle = bundle
  }

  static async create(characterIds: string[], withWear = false): Promise<BatchRenderer> {
    const r = new BatchRenderer(await collectBundle(characterIds, withWear))
    await r.start()
    return r
  }

  private startWorker(): Promise<Worker> {
    const w = new Worker(new URL('./build.worker.ts', import.meta.url), { type: 'module' })
    return new Promise<Worker>((resolve, reject) => {
      const t = setTimeout(() => { w.terminate(); reject(new Error('worker did not start')) }, 15_000)
      w.onerror = (e) => { clearTimeout(t); w.terminate(); reject(new Error(e.message || 'worker error')) }
      w.onmessage = (e: MessageEvent<WorkerOut>) => {
        if (e.data.type !== 'ready') return
        clearTimeout(t)
        w.onmessage = (ev: MessageEvent<WorkerOut>) => {
          const m = ev.data
          if (m.type === 'ready') return
          const p = this.pending.get(m.id)
          if (!p) return
          this.pending.delete(m.id)
          if (m.type === 'rendered') p.resolve(m.blobs)
          else p.reject(new Error(m.message))
        }
        w.onerror = (ev) => {
          for (const p of this.pending.values()) p.reject(new Error(ev.message || 'worker crashed'))
          this.pending.clear()
        }
        resolve(w)
      }
      w.postMessage({ type: 'init', bundle: this.bundle } satisfies WorkerIn)
    })
  }

  private async start(): Promise<void> {
    try {
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('no worker')
      const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))
      this.workers = await Promise.all(Array.from({ length: n }, () => this.startWorker()))
      this.mode = `${n} worker${n === 1 ? '' : 's'}`
    } catch (e) {
      for (const w of this.workers) w.terminate()
      this.workers = []
      console.warn('Card Studio: rendering on the main thread', e)
      this.mode = 'main thread'
      this.fallback = new CardRenderer(this.bundle)
    }
  }

  private async renderBatch(lane: number, cards: DealtCard[], format: OutputFormat): Promise<Blob[]> {
    const w = this.workers[lane]
    if (w) {
      const id = this.nextId++
      const jobs: RenderJob[] = cards.map((card) => ({ card }))
      return new Promise<Blob[]>((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        w.postMessage({ type: 'render', id, jobs, format } satisfies WorkerIn)
      })
    }
    const out: Blob[] = []
    for (const card of cards) {
      out.push(await this.fallback!.render(card, format))
      await yieldToUi()
    }
    return out
  }

  /** `onBatch` gets each finished batch with the index of its first card (batches may finish out of order). */
  async renderAll(
    cards: DealtCard[], format: OutputFormat, opts: {
      batchSize?: number
      onProgress?: (p: Progress) => void
      onBatch?: (cards: DealtCard[], blobs: Blob[], start: number) => Promise<void> | void
      signal?: AbortSignal
    } = {},
  ): Promise<void> {
    const size = opts.batchSize ?? 4
    let next = 0
    let done = 0
    opts.onProgress?.({ done, total: cards.length })
    const lane = async (i: number) => {
      while (next < cards.length) {
        if (opts.signal?.aborted) throw new DOMException('Build cancelled', 'AbortError')
        const start = next
        next += size
        const batch = cards.slice(start, start + size)
        const blobs = await this.renderBatch(i, batch, format)
        await opts.onBatch?.(batch, blobs, start)
        done += batch.length
        opts.onProgress?.({ done, total: cards.length })
        await yieldToUi()
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, this.workers.length) }, (_, i) => lane(i)))
  }

  dispose(): void {
    for (const w of this.workers) w.terminate()
    this.workers = []
    this.fallback?.dispose()
  }
}

/** Where a built image is stored: one per look (looks.ts), not per card. */
export function renderKey(fire: number, lookKey: string): string {
  return `render:${fire}:${lookKey}`
}
