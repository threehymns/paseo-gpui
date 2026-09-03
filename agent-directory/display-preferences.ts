/**
 * Sidebar display preferences (#44): the pure decisions behind the view
 * menu's filters and the deterministic label-color scheme.
 *
 * Grouping (project | status) and the meta-line configuration live elsewhere
 * (workspaces.ts, workspace-meta.ts); this module owns what those do not:
 * the filter predicate with AND semantics across host / project / label, the
 * host a workspace is said to live on, and the stable color every label dot
 * renders. Nothing here touches the theme — colors come back raw so the
 * chrome can consume them directly and #43/#45 can share the same scheme.
 */

import type { WorkspaceDescriptor } from '../daemon/paseo'

// ---- filters ----------------------------------------------------------------

/** The sentinel label-filter value meaning "workspaces with no labels at all". */
export const UNLABELLED_LABEL = '*unlabelled*'

/**
 * The sidebar's active filters. Every list is an allowlist: an empty list
 * means that dimension is not filtering. Different dimensions compose with
 * AND — a workspace must match all non-empty dimensions to stay visible.
 */
export interface WorkspaceFilters {
  /** Hostnames to show; empty shows every host. */
  hosts: string[]
  /** Project ids to show; empty shows every project. */
  projects: string[]
  /** Labels to show, plus the UNLABELLED_LABEL sentinel; empty shows all. */
  labels: string[]
}

/** No active filters anywhere: the sidebar shows everything. */
export const EMPTY_FILTERS: WorkspaceFilters = { hosts: [], projects: [], labels: [] }

/** True when any of the three dimensions is actively filtering. */
export function hasActiveFilters(filters: WorkspaceFilters): boolean {
  return filters.hosts.length > 0 || filters.projects.length > 0 || filters.labels.length > 0
}

/** True when a filter combination exists but hides every workspace. */
export function filtersHideEverything(filters: WorkspaceFilters, workspaces: WorkspaceDescriptor[]): boolean {
  return hasActiveFilters(filters) && workspaces.every((descriptor) => !workspaceMatchesFilters(descriptor, filters))
}

/**
 * The host a workspace lives on: the scripts' hostname, but only when every
 * script agrees the workspace sits on one host. A script-less or split-host
 * workspace has no single host and matches no host filter (a host allowlist
 * hides it, which is the honest reading of "where does it run?").
 */
export function workspaceHost(descriptor: WorkspaceDescriptor): string | null {
  const hostnames = new Set(descriptor.scripts.map((script) => script.hostname))
  if (hostnames.size !== 1) return null
  const hostname = [...hostnames][0]
  return hostname ? hostname : null
}

/**
 * Whether a workspace survives the current filters. AND across the host,
 * project, and label dimensions; an empty dimension never filters. Unlabelled
 * matches workspaces with no labels at all; otherwise a workspace shows when
 * it carries at least one of the selected labels.
 */
export function workspaceMatchesFilters(descriptor: WorkspaceDescriptor, filters: WorkspaceFilters): boolean {
  if (filters.hosts.length > 0) {
    const host = workspaceHost(descriptor)
    if (host == null || !filters.hosts.includes(host)) return false
  }
  if (filters.projects.length > 0 && !filters.projects.includes(descriptor.projectId)) return false
  if (filters.labels.length > 0) {
    const labels = descriptor.labels ?? []
    const labelledMatch = labels.some((label) => filters.labels.includes(label))
    const unlabelledMatch = filters.labels.includes(UNLABELLED_LABEL) && labels.length === 0
    if (!labelledMatch && !unlabelledMatch) return false
  }
  return true
}

// ---- deterministic label colors --------------------------------------------

/**
 * A fixed, theme-independent palette the label dots cycle through. Raw hex so
 * #43's label menu and #45's readouts share exactly the same scheme.
 */
export const LABEL_PALETTE: readonly string[] = [
  '#E2795B',
  '#58B368',
  '#4C8DF6',
  '#D9A050',
  '#B76BE0',
  '#5BD0CE',
]

/**
 * One label name maps to one palette color, deterministically and forever: a
 * workspace's label dot never changes color between runs or across surfaces.
 * The scheme hashes the name to a stable index over LABEL_PALETTE; two labels
 * may share a color, but one label never changes its own.
 */
export function labelColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  const index = Math.abs(hash) % LABEL_PALETTE.length
  return LABEL_PALETTE[index]!
}
