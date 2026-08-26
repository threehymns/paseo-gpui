/**
 * Send-intent mechanics: what the composer's send gesture means.
 *
 * The decision is a pure function of (agent running?, gesture, configured
 * behavior), so the whole matrix is testable without a daemon; delivery itself
 * stays in the conversation hook. Vocabulary follows CONTEXT.md: Enter steers a
 * running agent, an interrupt gesture stops the turn first, Cmd/Ctrl+Enter
 * parks the text as a pending send above the composer.
 */

/** Which gesture carried the draft text out of the composer. */
export type SendGesture = 'send' | 'queue' | 'interrupt'

/** Modifier flags from a key event; all optional and absent when unmodified. */
export interface KeyModifiers {
  alt?: boolean
  ctrl?: boolean
  cmd?: boolean
  shift?: boolean
}

/**
 * Classifies an Enter keypress into its composer gesture from raw modifiers.
 * Null means the editor keeps the key (e.g. Shift+Enter's newline).
 */
export function classifyEnter(mods?: KeyModifiers): SendGesture | null {
  if (mods?.cmd || mods?.ctrl) return 'queue'
  if (mods?.alt) return 'interrupt'
  if (mods?.shift) return null
  return 'send'
}

/** What a composer send gesture should do, per CONTEXT.md's mechanics. */
export type SendIntentKind = 'send' | 'steer' | 'interrupt' | 'queue'

/** What Enter means while the agent is mid-turn; steer by default. */
export interface SendIntentConfig {
  enterWhileRunning?: Exclude<SendIntentKind, 'send'>
}

export type SendIntent = { kind: SendIntentKind }

const DEFAULT_ENTER_WHILE_RUNNING: SendIntentKind = 'steer'

/**
 * The intent decision: a pure function of (agent running?, gesture,
 * configured behavior). Idle or disconnected agents behave exactly as today —
 * every gesture delivers fresh; only a running agent gives gestures weight.
 */
export function resolveSendIntent(running: boolean, gesture: SendGesture, config: SendIntentConfig = {}): SendIntent {
  if (!running) return { kind: 'send' }
  if (gesture === 'send') return { kind: config.enterWhileRunning ?? DEFAULT_ENTER_WHILE_RUNNING }
  return { kind: gesture }
}
