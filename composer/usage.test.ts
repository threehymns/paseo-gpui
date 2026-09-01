import { describe, expect, test } from 'bun:test'
import { contextMeter } from './usage'

describe('context meter', () => {
  test('hidden when no usage data exists yet', () => {
    expect(contextMeter({})).toBeNull()
    expect(contextMeter({ usedTokens: null, maxTokens: null })).toBeNull()
  })

  test('renders the used/max fraction and tooltip lines from real usage', () => {
    const meter = contextMeter({ usedTokens: 84_000, maxTokens: 200_000, costUsd: 0.13 })
    expect(meter).toEqual({
      fraction: 0.42,
      tone: 'neutral',
      lines: ['42% used', '84,000 / 200,000 tokens', 'Session cost $0.13'],
    })
  })

  test('max exceeded: arc clamps full while the percent stays honest', () => {
    const meter = contextMeter({ usedTokens: 21_500, maxTokens: 20_000 })
    expect(meter!.fraction).toBe(1)
    expect(meter!.tone).toBe('red')
    expect(meter!.lines[0]).toBe('108% used')
  })

  test('per-provider breakdown only when more than one provider is reported', () => {
    const one = contextMeter({ usedTokens: 1000, maxTokens: 2000, providers: [{ label: 'Claude', tokens: 1000 }] })
    expect(one!.lines).toEqual(['50% used', '1,000 / 2,000 tokens'])
    const two = contextMeter({
      usedTokens: 1000,
      maxTokens: 2000,
      costUsd: 0.5,
      providers: [
        { label: 'Claude', tokens: 600 },
        { label: 'Codex', tokens: 400 },
      ],
    })
    expect(two!.lines).toEqual([
      '50% used',
      '1,000 / 2,000 tokens',
      'Session cost $0.50',
      'Claude: 600 tokens',
      'Codex: 400 tokens',
    ])
  })

  test('cost line: omitted when missing, $0.00 when free, rounded to cents', () => {
    const linesOf = (costUsd?: number | null) => contextMeter({ usedTokens: 1, maxTokens: 1000, costUsd })!.lines
    expect(linesOf(undefined)).toEqual(['0% used', '1 / 1,000 tokens'])
    expect(linesOf(null)).toEqual(['0% used', '1 / 1,000 tokens'])
    expect(linesOf(0)).toContain('Session cost $0.00')
    expect(linesOf(1.236)).toContain('Session cost $1.24')
  })

  test('threshold tones: neutral below 70, amber from 70 through 90, red above 90', () => {
    const toneAt = (used: number) => contextMeter({ usedTokens: used, maxTokens: 1000 })!.tone
    expect(toneAt(0)).toBe('neutral')
    expect(toneAt(694)).toBe('neutral')
    expect(toneAt(700)).toBe('amber')
    expect(toneAt(900)).toBe('amber')
    expect(toneAt(910)).toBe('red')
    expect(toneAt(1000)).toBe('red')
  })
})
