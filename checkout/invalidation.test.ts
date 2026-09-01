import { describe, expect, test } from 'bun:test'
import { ALL_INVALIDATION_TOPICS, invalidate, onInvalidate } from './invalidation'

describe('invalidate-everything bus', () => {
  test('listeners receive the fired topics', () => {
    const seen: string[][] = []
    const off = onInvalidate((topics) => seen.push(topics))
    try {
      invalidate('status')
      invalidate('diffs', 'commits')
      expect(seen).toEqual([['status'], ['diffs', 'commits']])
    } finally {
      off()
    }
  })

  test('unsubscribing stops delivery', () => {
    const seen: string[][] = []
    const off = onInvalidate((topics) => seen.push(topics))
    off()
    invalidate('status')
    expect(seen).toEqual([])
  })

  test('firing with no topics is a no-op', () => {
    let fired = 0
    const off = onInvalidate(() => {
      fired++
    })
    try {
      invalidate()
      expect(fired).toBe(0)
    } finally {
      off()
    }
  })

  test('the everything topic set covers every git surface later tickets hang off', () => {
    expect(ALL_INVALIDATION_TOPICS).toEqual(['status', 'diffs', 'pullRequests', 'commits', 'timeline'])
    let last: string[] = []
    const off = onInvalidate((topics) => (last = topics))
    try {
      invalidate(...ALL_INVALIDATION_TOPICS)
      expect(last).toEqual(ALL_INVALIDATION_TOPICS)
    } finally {
      off()
    }
  })
})
