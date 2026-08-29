/**
 * The shared action registry.
 *
 * Every palette entry is a registered action (id, title, section, run,
 * enabled) in one catalog. The command palette consumes it today; the
 * keybinding layer, shortcuts dialog, and settings rebinding can consume the
 * same catalog tomorrow. Contributors register a batch and dispose of it when
 * their live data changes, so the catalog always mirrors daemon state.
 */

/** Fixed palette order: commands first, then live directories, then choices. */
export const ACTION_SECTIONS = ['actions', 'workspaces', 'agents', 'model', 'thinking', 'mode'] as const

export type ActionSection = (typeof ACTION_SECTIONS)[number]

export const SECTION_LABELS: Record<ActionSection, string> = {
  actions: 'Actions',
  workspaces: 'Workspaces',
  agents: 'Agents',
  model: 'Model',
  thinking: 'Reasoning',
  mode: 'Access',
}

export interface RegisteredAction {
  /** Namespaced and stable; re-registering an id replaces the entry in place. */
  id: string
  title: string
  section: ActionSection
  /** Extra searchable text beyond the title. */
  keywords?: string
  /** Right-aligned detail shown on the row. */
  hint?: string
  /** True when this choice is the current one; the row shows a check. */
  checked?: boolean
  /** Hidden from the catalog while false. */
  enabled?: boolean
  run: () => void
}

export class ActionRegistry {
  #actions = new Map<string, RegisteredAction>()

  /**
   * Adds actions to the catalog and returns a disposer that removes exactly
   * that batch — and only while it still owns each id. Calling a disposer
   * twice is harmless.
   */
  register(...actions: RegisteredAction[]): () => void {
    for (const action of actions) this.#actions.set(action.id, action)
    return () => {
      for (const action of actions) {
        if (this.#actions.get(action.id) === action) this.#actions.delete(action.id)
      }
    }
  }

  /** A registration-ordered snapshot of the catalog, disabled entries included. */
  list(): RegisteredAction[] {
    return [...this.#actions.values()]
  }
}
