/**
 * Workspace directory state.
 *
 * Workspace descriptors are first-class app state: one subscribed
 * `workspaces.list({ subscribe })` call feeds a store that only the daemon's
 * `workspace_update` stream writes. Everything here is pure; the hook glue
 * lives in chat.tsx and the rendering in chrome.tsx.
 */

import {
  sortAgents,
  type AgentEntry,
  type EmptyProjectDescriptor,
  type WorkspaceDescriptor,
  type WorkspaceUpdate,
} from '../daemon/paseo'
import { EMPTY_FILTERS, type WorkspaceFilters, workspaceMatchesFilters } from './display-preferences'

// ---- store -----------------------------------------------------------------

/**
 * The whole workspace directory: live descriptors plus projects whose last
 * workspace is gone but that still exist (rendered as empty groups).
 */
export interface WorkspaceStore {
  workspaces: WorkspaceDescriptor[]
  emptyProjects: EmptyProjectDescriptor[]
}

export const initialWorkspaceStore: WorkspaceStore = { workspaces: [], emptyProjects: [] }

/** Epoch-ms activity of a descriptor; the epoch for descriptors without one. */
export function workspaceActivityAt(descriptor: WorkspaceDescriptor): number {
  const at = descriptor.activityAt ? Date.parse(descriptor.activityAt) : NaN
  return Number.isFinite(at) ? at : 0
}

/**
 * Directory order: pinned workspaces first (most recently pinned on top),
 * then most recently active first.
 */
export function sortWorkspaces(descriptors: WorkspaceDescriptor[]): WorkspaceDescriptor[] {
  return [...descriptors].sort((a, b) => {
    const pinnedA = a.pinnedAt ? Date.parse(a.pinnedAt) : null
    const pinnedB = b.pinnedAt ? Date.parse(b.pinnedAt) : null
    if ((pinnedA != null) !== (pinnedB != null)) return pinnedA != null ? -1 : 1
    if (pinnedA != null && pinnedB != null && pinnedA !== pinnedB) return pinnedB - pinnedA
    return workspaceActivityAt(b) - workspaceActivityAt(a)
  })
}

function withoutProject(projects: EmptyProjectDescriptor[], projectId: string): EmptyProjectDescriptor[] {
  return projects.filter((project) => project.projectId !== projectId)
}

/**
 * Folds one daemon update into the store. Upserts replace by id and pull the
 * project out of the emptied list. Removes drop the workspace and carry the
 * project aftermath: an `emptyProject` keeps the project rendered with no
 * rows, a `removedProjectId` erases it outright.
 */
export function applyWorkspaceUpdate(store: WorkspaceStore, update: WorkspaceUpdate): WorkspaceStore {
  if (update.kind === 'upsert') {
    const rest = store.workspaces.filter((descriptor) => descriptor.id !== update.workspace.id)
    return {
      workspaces: sortWorkspaces([update.workspace, ...rest]),
      emptyProjects: withoutProject(store.emptyProjects, update.workspace.projectId),
    }
  }
  let workspaces = store.workspaces.filter((descriptor) => descriptor.id !== update.id)
  let emptyProjects = store.emptyProjects
  // A removed project takes any remaining descriptors of that project with it;
  // their own remove events become no-ops.
  if (update.removedProjectId) {
    workspaces = workspaces.filter((descriptor) => descriptor.projectId !== update.removedProjectId)
    emptyProjects = withoutProject(emptyProjects, update.removedProjectId)
  }
  if (update.emptyProject) {
    emptyProjects = [
      ...withoutProject(emptyProjects, update.emptyProject.projectId),
      update.emptyProject,
    ]
  }
  return { workspaces, emptyProjects }
}

// ---- view-model mapping ------------------------------------------------------

/** The directory agents run in; falls back to the project root path. */
export function workspaceDirectory(descriptor: WorkspaceDescriptor): string {
  return descriptor.workspaceDirectory ?? descriptor.projectRootPath
}

/** True once the daemon has archived the workspace; archiving is one-way. */
export function isArchivedWorkspace(descriptor: WorkspaceDescriptor): boolean {
  return descriptor.archivingAt != null
}

/** Live workspaces only unless archived ones are revealed. */
export function visibleWorkspaces(
  descriptors: WorkspaceDescriptor[],
  showArchived: boolean,
): WorkspaceDescriptor[] {
  return showArchived ? descriptors : descriptors.filter((descriptor) => !isArchivedWorkspace(descriptor))
}

export function projectName(project: {
  projectDisplayName: string
  projectCustomName?: string | null | undefined
}): string {
  const custom = project.projectCustomName?.trim()
  return custom || project.projectDisplayName
}

/** Row label for a workspace: title override when set, else its name. */
export function workspaceDisplayName(descriptor: WorkspaceDescriptor): string {
  const title = descriptor.title?.trim()
  if (title) return title
  return descriptor.name
}

// ---- aggregate status pill -----------------------------------------------------
//
// A collapsed project reduces to one status pill summarizing its workspaces.
// The roll-up is most-urgent-wins over the descriptor's own status vocabulary —
// the protocol's `running | attention | needs_input | failed | done`, not the
// agent directory's StatusBucket (`working`/`review` in daemon/paseo.ts is a
// different vocabulary that must not leak in here).

/**
 * Most-urgent-wins order over the workspace descriptor's status vocabulary:
 * workspaces demanding the user's hand first (needs_input), then breakage
 * (failed), then live work (running), then flagged-but-alive (attention), then
 * finished (done). Earlier entries win a collapsed project's pill. The order is
 * a strict total order, so no two distinct statuses can tie; workspaces that
 * share the winning bucket collapse into the pill's count.
 */
export const WORKSPACE_STATUS_URGENCY: readonly WorkspaceDescriptor['status'][] = [
  'needs_input',
  'failed',
  'running',
  'attention',
  'done',
]

/** One collapsed project's pill: the most urgent bucket and how many workspaces sit in it. */
export interface WorkspaceAggregateStatus {
  status: WorkspaceDescriptor['status']
  /** Workspaces sharing the winning bucket — the "affected" count the pill shows. */
  count: number
}

/**
 * The most-urgent-wins roll-up for a collapsed project: the earliest entry of
 * WORKSPACE_STATUS_URGENCY present among the descriptors, with the number of
 * workspaces in that bucket. Aggregates exactly the descriptors it is given —
 * visibility filtering stays the caller's job (project groups already filter).
 * An empty project aggregates to null: nothing to summarize, no pill.
 */
export function aggregateWorkspaceStatus(
  descriptors: WorkspaceDescriptor[],
): WorkspaceAggregateStatus | null {
  for (const status of WORKSPACE_STATUS_URGENCY) {
    const count = descriptors.filter((descriptor) => descriptor.status === status).length
    if (count > 0) return { status, count }
  }
  return null
}

// ---- sidebar groups ----------------------------------------------------------

/** One collapsible project group: zero or more workspace rows. */
export interface WorkspaceProjectGroup {
  projectId: string
  name: string
  rootPath: string
  /** Most recently active first; empty for an emptied project. */
  workspaces: WorkspaceDescriptor[]
}

function groupActivity(group: WorkspaceProjectGroup): number | null {
  return group.workspaces.length > 0 ? workspaceActivityAt(group.workspaces[0]!) : null
}

/**
 * Folds the store into collapsible project groups: each project with visible
 * workspaces, ordered by its most recent activity, then emptied projects in
 * name order so they still render. Rows inside a group stay recency-sorted.
 *
 * An active filter narrows which workspaces group; a project whose workspaces
 * all fall to the filter simply does not appear (its rows are gone rather than
 * misleadingly empty). Truly-empty projects from the daemon still render.
 */
export function workspaceProjectGroups(
  store: WorkspaceStore,
  showArchived: boolean,
  filters: WorkspaceFilters = EMPTY_FILTERS,
): WorkspaceProjectGroup[] {
  const byProject = new Map<string, WorkspaceProjectGroup>()
  for (const descriptor of visibleWorkspaces(store.workspaces, showArchived)) {
    if (!workspaceMatchesFilters(descriptor, filters)) continue
    let group = byProject.get(descriptor.projectId)
    if (!group) {
      group = {
        projectId: descriptor.projectId,
        name: projectName(descriptor),
        rootPath: descriptor.projectRootPath,
        workspaces: [],
      }
      byProject.set(descriptor.projectId, group)
    }
    group.workspaces.push(descriptor)
  }
  const groups = [...byProject.values()].map((group) => ({ ...group, workspaces: sortWorkspaces(group.workspaces) }))
  for (const project of store.emptyProjects) {
    if (!byProject.has(project.projectId)) {
      groups.push({
        projectId: project.projectId,
        name: projectName(project),
        rootPath: project.projectRootPath,
        workspaces: [],
      })
    }
  }
  groups.sort((a, b) => {
    const activityA = groupActivity(a)
    const activityB = groupActivity(b)
    if (activityA != null && activityB != null) return activityB - activityA
    if (activityA != null) return -1
    if (activityB != null) return 1
    return a.name.localeCompare(b.name)
  })
  return groups
}

// ---- status grouping ----------------------------------------------------------
//
// Status group mode arranges the sidebar the way the agent directory's buckets
// do — trouble first, then live work, then done — but over the workspace
// descriptor's own status vocabulary (running | attention | needs_input |
// failed | done), never the agent dialect (working/review) that must not leak
// in here. The bucket order reuses WORKSPACE_STATUS_URGENCY.

/** One status bucket group in status group mode. */
export interface WorkspaceStatusGroup {
  status: WorkspaceDescriptor['status']
  label: string
  workspaces: WorkspaceDescriptor[]
}

const WORKSPACE_STATUS_LABELS: Record<WorkspaceDescriptor['status'], string> = {
  needs_input: 'Needs input',
  failed: 'Failed',
  running: 'Working',
  attention: 'Attention',
  done: 'Done',
}

/**
 * Folds the visible, filter-matching workspaces into status groups in
 * WORKSPACE_STATUS_URGENCY order, each recency-sorted; groups with nothing to
 * show are omitted. A collapsed status group aggregates like a project's pill.
 */
export function workspaceStatusGroups(
  store: WorkspaceStore,
  showArchived: boolean,
  filters: WorkspaceFilters = EMPTY_FILTERS,
): WorkspaceStatusGroup[] {
  const visible = visibleWorkspaces(store.workspaces, showArchived).filter((descriptor) =>
    workspaceMatchesFilters(descriptor, filters),
  )
  const sorted = sortWorkspaces(visible)
  const groups: WorkspaceStatusGroup[] = []
  for (const status of WORKSPACE_STATUS_URGENCY) {
    const workspaces = sorted.filter((descriptor) => descriptor.status === status)
    if (workspaces.length > 0) {
      groups.push({ status, label: WORKSPACE_STATUS_LABELS[status], workspaces })
    }
  }
  return groups
}

// ---- opening a workspace -----------------------------------------------------

/**
 * Composer folder choices: every workspace's directory, plus emptied
 * projects' roots, deduplicated.
 */
export function workspaceDirectoryChoices(store: WorkspaceStore): string[] {
  const dirs = [
    ...store.workspaces.map(workspaceDirectory),
    ...store.emptyProjects.map((project) => project.projectRootPath),
  ]
  return [...new Set(dirs.filter(Boolean))]
}

/**
 * The agents that belong to a workspace: matched by the agent's workspaceId,
 * falling back to its working directory for agents predating workspaces.
 */
export function agentsOfWorkspace(agents: AgentEntry[], descriptor: WorkspaceDescriptor): AgentEntry[] {
  const directory = workspaceDirectory(descriptor)
  return agents.filter((agent) => agent.workspaceId === descriptor.id || agent.cwd === directory)
}

/** The timeline a workspace opens onto: its most recently active agent, if any. */
export function mostRecentAgent(agents: AgentEntry[]): AgentEntry | null {
  return sortAgents(agents)[0] ?? null
}
