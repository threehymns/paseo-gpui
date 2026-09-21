/**
 * Shared test support for the agent-directory seam.
 *
 * Workspace tests build descriptors the same way everywhere — a canonical
 * minimal shape with runtime fields injected by `over` — so the one builder
 * lives here instead of being copy-pasted per file. Keeping it in one place
 * means the fixture's defaults stay in lockstep with the real descriptor.
 */

import type { WorkspaceDescriptor } from '../daemon/paseo'

/** Canonical minimal descriptor builder; runtime fields arrive via `over`. */
export function workspace(over: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return {
    id: over.id ?? 'w1',
    projectId: over.projectId ?? 'p1',
    projectDisplayName: over.projectDisplayName ?? 'storefront',
    projectRootPath: over.projectRootPath ?? '/home/me/dev/storefront',
    projectKind: 'git',
    workspaceKind: 'directory',
    name: over.name ?? 'storefront',
    archivingAt: null,
    status: 'running',
    statusEnteredAt: null,
    activityAt: over.activityAt ?? '2026-08-24T10:00:00Z',
    scripts: [],
    ...over,
  } as WorkspaceDescriptor
}
