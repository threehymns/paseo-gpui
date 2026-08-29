/**
 * Transcript scroll-follow: whether incoming turns pull the view to the tail.
 *
 * Scrolling up detaches auto-follow; streaming turns stop moving the viewport
 * and a jump button appears instead. Re-attach happens by jumping (button) or
 * by wheeling down until the list pins at its end.
 *
 * The reducer is the whole decision — the hook only translates renderer
 * scroll events and turn-count changes into FollowEvents.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { NativeRenderer } from '@gpuix/react'
import type { EventPayload } from '@gpuix/native'

export interface FollowState {
  /** True while new turns pull the transcript to its tail. */
  following: boolean
  /**
   * Scroll offset measured at the previous wheel tick. A downward tick that
   * lands on the same offset was clamped by the list's end: the user is back
   * at the bottom.
   */
  lastOffset: number | null
}

export type FollowEvent =
  | { type: 'reset' }
  | { type: 'userScrolled'; deltaY: number; offset: number | null }
  | { type: 'turnsAppended' }
  | { type: 'jumpRequested' }

export const initialFollow: FollowState = { following: true, lastOffset: null }

export function reduceFollow(state: FollowState, event: FollowEvent): FollowState {
  switch (event.type) {
    case 'reset':
      return initialFollow
    case 'userScrolled': {
      if (event.deltaY < 0) {
        return { following: false, lastOffset: event.offset }
      }
      const pinned = state.lastOffset != null && event.offset === state.lastOffset
      return { following: state.following || pinned, lastOffset: event.offset }
    }
    case 'turnsAppended':
      // Deliberately inert in both modes: detached stays detached so the
      // viewport never moves on its own; attached stays attached.
      return state
    case 'jumpRequested':
      return { ...state, following: true }
  }
}

/** A virtual-list instance ref, as passed to Transcript. */
type ListRef = { current: { id: number } | null }

/**
 * The React adapter over reduceFollow: wires the transcript list's scroll
 * events, gates programmatic tail-scrolling on `following`, and exposes the
 * two jumps (bottom button, outline rail). Owns every renderer call so view
 * code never touches the renderer directly. The renderer is accepted, not
 * created — importing @gpuix/react at runtime would drag the native binding
 * into this module's tests.
 */
export function useTranscriptFollow({
  listRef,
  turnCount,
  agentId,
  renderer,
}: {
  listRef: ListRef
  turnCount: number
  agentId: string | null
  /** NativeRenderer from useGpuix(); null before the window mounts. */
  renderer: NativeRenderer | null | undefined
}) {
  const [state, dispatch] = useReducer(reduceFollow, initialFollow)

  // A different agent is a fresh transcript; it follows again.
  useEffect(() => {
    dispatch({ type: 'reset' })
  }, [agentId])

  const onScroll = useCallback(
    (event: EventPayload) => {
      const id = listRef.current?.id
      const offset = id != null ? (renderer?.getScrollOffset?.(id)?.[1] ?? null) : null
      dispatch({ type: 'userScrolled', deltaY: event.deltaY ?? 0, offset })
    },
    [renderer, listRef],
  )

  // Follow the tail on growth while attached — and jump when re-attaching
  // (the flip in `following` re-runs this effect). The first run only primes
  // the previous count: a freshly mounted list must not yank itself.
  const prevCount = useRef(0)
  const primed = useRef(false)
  useEffect(() => {
    if (turnCount > prevCount.current) dispatch({ type: 'turnsAppended' })
    prevCount.current = turnCount
    if (!primed.current) {
      primed.current = true
      return
    }
    if (!state.following) return
    const id = listRef.current?.id
    if (id == null || !renderer?.scrollToItem) return
    renderer.scrollToItem(id, Math.max(0, turnCount - 1))
  }, [renderer, listRef, turnCount, state.following])

  /** Jump-to-bottom click: re-attach; the effect above performs the scroll. */
  const requestJump = useCallback(() => dispatch({ type: 'jumpRequested' }), [])

  /** Outline-rail click: straight to that row, detached or not. */
  const jumpToTurn = useCallback(
    (index: number) => {
      const id = listRef.current?.id
      if (id == null || !renderer?.scrollToItem) return
      renderer.scrollToItem(id, index)
    },
    [renderer, listRef],
  )

  return { following: state.following, onScroll, requestJump, jumpToTurn }
}
