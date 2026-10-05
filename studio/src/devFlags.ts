/** Session-only developer switches (not persisted). `?mockPinata` in the URL turns the mock on at load. */

import { useSyncExternalStore } from 'react'
import { mockTransport } from './pinata'

export const devFlags = {
  mockPinata: typeof location !== 'undefined' && new URLSearchParams(location.search).has('mockPinata'),
  get mockFailNext(): number { return mockTransport.failNext },
}

const listeners = new Set<() => void>()
let snapshot = { mockPinata: devFlags.mockPinata, mockFailNext: 0 }
/** Re-read flags that change behind our back (the mock's failure counter). */
export function refreshDevFlags(): void {
  emit()
}

function emit() {
  snapshot = { mockPinata: devFlags.mockPinata, mockFailNext: mockTransport.failNext }
  for (const l of listeners) l()
}

export function setMockPinata(on: boolean): void {
  devFlags.mockPinata = on
  emit()
}

export function setMockFailNext(n: number): void {
  mockTransport.failNext = n
  emit()
}

export function useDevFlags() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => snapshot)
}
