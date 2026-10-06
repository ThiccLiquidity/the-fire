/** Build worker: renders cards off the main thread with OffscreenCanvas. */

import { CardRenderer, type AssetBundle, type RenderJob } from './renderCore'
import type { OutputFormat } from './types'

export type WorkerIn =
  | { type: 'init'; bundle: AssetBundle }
  | { type: 'render'; id: number; jobs: RenderJob[]; format: OutputFormat }

export type WorkerOut =
  | { type: 'ready' }
  | { type: 'rendered'; id: number; blobs: Blob[] }
  | { type: 'error'; id: number; message: string }

// Typed minimally so this file compiles under the app's DOM lib (DOM and WebWorker libs can't be mixed).
interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null
  postMessage(msg: WorkerOut): void
  fonts: FontFaceSet
}
const scope = self as unknown as WorkerScope
let renderer: CardRenderer | null = null

scope.onmessage = async (e: MessageEvent<WorkerIn>) => {
  const msg = e.data
  if (msg.type === 'init') {
    for (const f of msg.bundle.fonts) {
      try {
        const face = new FontFace(f.family, f.data, f.weight ? { weight: f.weight } : undefined)
        await face.load()
        scope.fonts.add(face)
      } catch {
        // falls back to the next family in the CSS list
      }
    }
    renderer?.dispose()
    renderer = new CardRenderer(msg.bundle)
    scope.postMessage({ type: 'ready' } satisfies WorkerOut)
    return
  }
  try {
    if (!renderer) throw new Error('worker not initialised')
    const blobs: Blob[] = []
    for (const job of msg.jobs) blobs.push(await renderer.render(job.face, msg.format))
    scope.postMessage({ type: 'rendered', id: msg.id, blobs } satisfies WorkerOut)
  } catch (err) {
    scope.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) } satisfies WorkerOut)
  }
}
