/**
 * Window-level event routing for @gpuix.
 *
 * @gpuix delivers global events only through the `onEvent` callback handed to
 * `render()`, so this module owns a single router at that seam: the app passes
 * `dispatchWindowEvent` once, and components subscribe window handlers through
 * `useWindowEvent`. Subscriptions detach on unmount — an overlay that closes
 * leaves no handler behind. The pure router core is exported for tests; the
 * hook is the thin React adapter.
 */

import { useEffect, useRef } from 'react'
import type { EventPayload } from '@gpuix/native'

export type KeyEventHandler = (event: EventPayload) => void

export interface KeyRouter {
  on: (handler: KeyEventHandler) => () => void
  dispatch: (event: EventPayload) => void
}

export function createKeyRouter(): KeyRouter {
  const handlers = new Set<KeyEventHandler>()
  return {
    on(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    dispatch(event) {
      // Snapshot so a handler disposing itself or others mid-pass is safe;
      // handlers already gone before their turn are skipped.
      for (const handler of [...handlers]) {
        if (handlers.has(handler)) handler(event)
      }
    },
  }
}

const router = createKeyRouter()

/** The render()-time sink for @gpuix's global event stream. */
export function dispatchWindowEvent(event: EventPayload): void {
  router.dispatch(event)
}

/** Subscribes a window-level handler for as long as the component lives. */
export function useWindowEvent(handler: KeyEventHandler): void {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => router.on((event) => latest.current(event)), [])
}
