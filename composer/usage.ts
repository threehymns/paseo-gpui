/**
 * Context-window meter math for the composer's usage ring.
 *
 * One pure projection turns daemon usage numbers into everything the ring
 * shows: its arc fraction, threshold tone, and hover lines. No data means no
 * meter — callers render nothing.
 */

export interface SessionUsage {
  /** Tokens the conversation has pushed into the model's window. */
  usedTokens?: number | null
  /** The model's context-window size; unknown windows hide the meter. */
  maxTokens?: number | null
  /** Running session cost in USD, when the daemon prices it. */
  costUsd?: number | null
  /** Per-provider token shares; the breakdown shows only when more than one. */
  providers?: ProviderUsageShare[] | null
}

export interface ProviderUsageShare {
  label: string
  tokens: number
}

export type MeterTone = 'neutral' | 'amber' | 'red'

/** Amber from 70% used, red above 90%. */
const AMBER_AT = 70
const RED_ABOVE = 90

export interface ContextMeter {
  /** Arc fraction, clamped to 0..1 for drawing even when use exceeds max. */
  fraction: number
  tone: MeterTone
  /** Tooltip lines in display order. */
  lines: string[]
}

/** Groups an integer with thousands separators, e.g. 1234567 -> "1,234,567". */
function group(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function usable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function contextMeter(usage: SessionUsage): ContextMeter | null {
  const { usedTokens, maxTokens } = usage
  if (!usable(usedTokens) || !usable(maxTokens) || usedTokens < 0 || maxTokens <= 0) return null
  const percent = Math.round((usedTokens / maxTokens) * 100)
  // Tone tracks the displayed percent so color and text never disagree.
  const tone: MeterTone = percent > RED_ABOVE ? 'red' : percent >= AMBER_AT ? 'amber' : 'neutral'
  const lines = [`${percent}% used`, `${group(usedTokens)} / ${group(maxTokens)} tokens`]
  if (usable(usage.costUsd)) lines.push(`Session cost $${usage.costUsd.toFixed(2)}`)
  if (usage.providers && usage.providers.length > 1) {
    for (const share of usage.providers) {
      if (!usable(share.tokens)) continue
      lines.push(`${share.label}: ${group(share.tokens)} tokens`)
    }
  }
  return { fraction: Math.min(1, usedTokens / maxTokens), tone, lines }
}
