/**
 * The shared invalidate-everything bus.
 *
 * One git action can make many surfaces stale at once — status, diffs, PR
 * status, commits, the timeline. Rather than each feature guessing which
 * daemon calls dirty which views, anything that changes repository truth
 * broadcasts here and every subscriber refetches what it owns.
 *
 * This is a plain module singleton: the app is a single window over one
 * daemon, so there is exactly one bus per process.
 */

import { useEffect, useRef } from 'react'

export type InvalidationTopic = 'status' | 'diffs' | 'pullRequests' | 'commits' | 'timeline'

/** Every surface a repository mutation can stale; fire this when in doubt. */
export const ALL_INVALIDATION_TOPICS: readonly InvalidationTopic[] = [
  'status',
  'diffs',
  'pullRequests',
  'commits',
  'timeline',
]

type InvalidationListener = (topics: InvalidationTopic[]) => void

const listeners = new Set<InvalidationListener>()

/** Broadcasts that everything under the given topics went stale. */
export function invalidate(...topics: InvalidationTopic[]): void {
  if (topics.length === 0) return
  const fired = [...topics]
  for (const listener of [...listeners]) listener(fired)
}

/** Subscribes to invalidations; returns an unsubscribe function. */
export function onInvalidate(listener: InvalidationListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Runs the callback whenever any watched topic fires. The callback identity
 * may change every render; only the watched topic list resubscribes.
 */
export function useOnInvalidate(topics: InvalidationTopic[], callback: () => void): void {
  const watched = topics.join(',')
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  useEffect(() => {
    return onInvalidate((fired) => {
      if (fired.some((topic) => watched.split(',').includes(topic))) callbackRef.current()
    })
  }, [watched])
}
