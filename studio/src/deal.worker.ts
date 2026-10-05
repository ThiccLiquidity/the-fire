/** Deal worker: runs the sample deal (dealFire) off the main thread, so previewing a big Series (up to
 *  MAX_DEAL_CARDS cards, a few seconds of hashing) never freezes the Deal tab. */

import { dealFire, type DealInput, type DealResult } from './deal'

export type DealWorkerIn = { id: number; input: DealInput }
export type DealWorkerOut = { id: number; result: DealResult } | { id: number; error: string }

interface WorkerScope {
  onmessage: ((e: MessageEvent<DealWorkerIn>) => void) | null
  postMessage(msg: DealWorkerOut): void
}
const scope = self as unknown as WorkerScope

scope.onmessage = (e: MessageEvent<DealWorkerIn>) => {
  const { id, input } = e.data
  try {
    scope.postMessage({ id, result: dealFire(input) } satisfies DealWorkerOut)
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies DealWorkerOut)
  }
}
