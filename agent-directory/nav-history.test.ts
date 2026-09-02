import { describe, expect, test } from 'bun:test'
import {
  canGoBack,
  canGoForward,
  emptyVisitHistory,
  goBack,
  goForward,
  truncateForward,
  visitAgent,
} from './nav-history'

const h = (...ids: string[]) => ids.reduce(visitAgent, emptyVisitHistory)

describe('visit history', () => {
  test('an empty history disables both arrows', () => {
    expect(canGoBack(emptyVisitHistory)).toBe(false)
    expect(canGoForward(emptyVisitHistory)).toBe(false)
  })

  test('visiting pushes onto the stack; the newest visit has no forward edge', () => {
    const history = h('a', 'b')
    expect(history.stack).toEqual(['a', 'b'])
    expect(history.index).toBe(1)
    expect(canGoBack(history)).toBe(true)
    expect(canGoForward(history)).toBe(false)
  })

  test('revisiting the current entry is a no-op', () => {
    const history = h('a', 'b')
    expect(visitAgent(history, 'b')).toBe(history)
  })

  test('back and forward traverse the visited agents', () => {
    const history = h('a', 'b', 'c')
    const oneBack = goBack(history)
    expect(oneBack.index).toBe(1)
    expect(canGoForward(oneBack)).toBe(true)
    expect(goBack(oneBack).index).toBe(0)
    expect(canGoBack(goBack(oneBack))).toBe(false)
    expect(goForward(goBack(oneBack)).index).toBe(1)
  })

  test('the start and end edges leave the history unchanged', () => {
    const history = h('a', 'b')
    const atStart = goBack(history)
    expect(goBack(atStart)).toBe(atStart)
    expect(goForward(history)).toBe(history)
    expect(canGoBack(h('a'))).toBe(false)
  })

  test('a fresh visit while mid-stack truncates the forward entries', () => {
    const history = h('a', 'b', 'c')
    const branched = visitAgent(goBack(history), 'd')
    expect(branched.stack).toEqual(['a', 'b', 'd'])
    expect(canGoForward(branched)).toBe(false)
  })

  test('truncateForward drops the future without moving the cursor', () => {
    const history = goBack(h('a', 'b', 'c'))
    const cut = truncateForward(history)
    expect(cut.stack).toEqual(['a', 'b'])
    expect(cut.index).toBe(1)
    const atEnd = h('a')
    expect(truncateForward(atEnd)).toBe(atEnd)
  })
})
