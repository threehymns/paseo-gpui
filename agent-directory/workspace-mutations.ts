/**
 * Workspace row mutations: title, pin, mark-as-read, labels, archive.
 *
 * Each mutation is a thin wrapper around the low-level DaemonClient whose
 * promise the UI awaits for in-flight disabling; the directory store is never
 * written here. Truth continues to arrive exclusively through the subscription
 * path (`applyWorkspaceUpdate` already folds pinned/labelled/titled snapshots),
 * so a settled wrapper only means the daemon accepted the call.
 *
 * The wrapper earns its keep where the SDK stops short: the label RPC's payload
 * needs a colour alongside the name, but the workspace descriptor only carries
 * label names. `toggleLabel` pairs a name with a deterministic colour so the
 * daemon's `workspace.label.assignment.set` shape is satisfied without the UI
 * knowing anything about colour.
 */

/** The ten colour names the workspace-label protocol accepts. */
export type WorkspaceLabelColor =
  | 'violet'
  | 'sky'
  | 'emerald'
  | 'orange'
  | 'pink'
  | 'indigo'
  | 'teal'
  | 'red'
  | 'amber'
  | 'blue'

const LABEL_COLORS: readonly WorkspaceLabelColor[] = [
  'violet',
  'sky',
  'emerald',
  'orange',
  'pink',
  'indigo',
  'teal',
  'red',
  'amber',
  'blue',
]

/**
 * A label's colour, chosen deterministically from its name so the same label
 * always carries the same colour and label toggling stays idempotent. The
 * descriptor carries only label names; the daemon's assignment RPC wants a
 * colour too, and hashing the name satisfies that shape without any catalog.
 */
export function workspaceLabelColor(name: string): WorkspaceLabelColor {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length]!
}

/** The slice of the daemon client the workspace mutations need. */
export interface WorkspaceMutationsClient {
  setWorkspaceTitle(workspaceId: string, title: string | null): Promise<unknown>
  setWorkspacePinned(workspaceId: string, pinned: boolean): Promise<unknown>
  clearWorkspaceAttention(workspaceId: string | string[]): Promise<void>
  setWorkspaceLabel(options: {
    workspaceId: string
    label: { name: string; color: WorkspaceLabelColor }
    assigned: boolean
  }): Promise<unknown>
  archiveWorkspace(workspaceId: string): Promise<unknown>
}

export interface WorkspaceMutations {
  /** Overrides the derived title; passing null restores it. */
  setTitle(workspaceId: string, title: string | null): Promise<unknown>
  /** Pins or unpins the workspace; the directory reorders on the subscription echo. */
  setPinned(workspaceId: string, pinned: boolean): Promise<unknown>
  /** Clears the attention state; the row settles on the subscription echo. */
  clearAttention(workspaceId: string): Promise<void>
  /** Applies or removes one label; reflected when the subscription echoes. */
  toggleLabel(workspaceId: string, name: string, assigned: boolean): Promise<unknown>
  /** Removes every applied label the descriptor currently carries. */
  clearLabels(workspaceId: string, applied: readonly string[]): Promise<unknown>
  /** Starts daemon-side archiving; the row shows its pending state until the echo. */
  archive(workspaceId: string): Promise<unknown>
}

/** Binds the workspace mutations to one daemon client. */
export function workspaceMutations(client: WorkspaceMutationsClient): WorkspaceMutations {
  return {
    setTitle: (workspaceId, title) => client.setWorkspaceTitle(workspaceId, title),
    setPinned: (workspaceId, pinned) => client.setWorkspacePinned(workspaceId, pinned),
    clearAttention: (workspaceId) => client.clearWorkspaceAttention(workspaceId),
    toggleLabel: (workspaceId, name, assigned) => {
      const trimmed = name.trim()
      return client.setWorkspaceLabel({
        workspaceId,
        label: { name: trimmed, color: workspaceLabelColor(trimmed) },
        assigned,
      })
    },
    clearLabels: (workspaceId, applied) =>
      Promise.all(applied.map((name) => client.setWorkspaceLabel({ workspaceId, label: { name, color: workspaceLabelColor(name) }, assigned: false }))),
    archive: (workspaceId) => client.archiveWorkspace(workspaceId),
  }
}
