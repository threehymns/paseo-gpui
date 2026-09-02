/**
 * Workspace row meta line (#42).
 *
 * One pure seam decides everything the row's second line shows: which slots
 * render (branch, project, host, pull request, services, labels), whether CI
 * checks render icon+text, icon-only, or not at all, what the trailing slot
 * holds (diff stats or last activity), and how long any one item may run
 * before it truncates. All data comes from the descriptor's own fields
 * (gitRuntime, githubRuntime, diffStat, scripts, labels); nothing is fetched
 * or invented here.
 *
 * Degradation rule: a slot with no backing data resolves to nothing and takes
 * no space — never a placeholder, never dead width. A row whose line resolves
 * to nothing at all renders without a second line.
 *
 * The toggling menu lives with display preferences (#44); until then the row
 * renders the DEFAULT_META_CONFIG below, chosen to mirror upstream: branch,
 * pull request, services, and icon+text checks on; project and host off (the
 * surrounding group header already names the project); labels off; trailing
 * slot on diff stats.
 */

import type { WorkspaceDescriptor } from '../daemon/paseo'
import { projectName, workspaceActivityAt, workspaceDisplayName } from './workspaces'

// ---- configuration -------------------------------------------------------------

/** The six toggleable meta-line slots, in their left-to-right render order. */
export type MetaSlotKind = 'branch' | 'project' | 'host' | 'pullRequest' | 'services' | 'labels'

/** Checks rendering: icon plus a "3/5" label, the icon alone, or nothing. */
export type ChecksMode = 'iconText' | 'iconOnly' | 'hidden'

/** The trailing slot: diff stats (additions/deletions) or relative last activity. */
export type TrailingSlot = 'diffStat' | 'activity'

/** The row title: the workspace's display name or its current branch. */
export type TitleSource = 'title' | 'branch'

export interface WorkspaceMetaConfig {
  slots: Record<MetaSlotKind, boolean>
  checksMode: ChecksMode
  trailing: TrailingSlot
  titleSource: TitleSource
}

/**
 * The defaults that ship now. `trailing: 'diffStat'` mirrors upstream's own
 * default; switching to last activity is a display-preferences choice (#44).
 */
export const DEFAULT_META_CONFIG: WorkspaceMetaConfig = {
  slots: {
    branch: true,
    project: false,
    host: false,
    pullRequest: true,
    services: true,
    labels: false,
  },
  checksMode: 'iconText',
  trailing: 'diffStat',
  titleSource: 'title',
}

// ---- resolved shapes -----------------------------------------------------------

/** Coarse color hint for chrome; keeps this module free of theme imports. */
export type MetaTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'

export type WorkspaceMetaItem =
  | { kind: 'branch'; text: string; tone: 'neutral'; dirty: boolean; aheadBehind: string | null }
  | { kind: 'project'; text: string; tone: 'neutral' }
  | { kind: 'host'; text: string; tone: 'neutral' }
  | { kind: 'pullRequest'; text: string; detail: string | null; tone: MetaTone }
  | { kind: 'services'; text: string; tone: MetaTone }
  | { kind: 'labels'; text: string; tone: 'neutral' }

export interface WorkspaceMetaChecks {
  status: 'success' | 'pending' | 'failure'
  /** The iconText label ("3/5"); null renders the icon alone. */
  label: string | null
}

export type WorkspaceMetaTrailing =
  | { kind: 'diffStat'; additions: number; deletions: number }
  | { kind: 'activity'; at: number }

export interface WorkspaceMetaLine {
  items: WorkspaceMetaItem[]
  checks: WorkspaceMetaChecks | null
  trailing: WorkspaceMetaTrailing | null
}

// ---- text shaping --------------------------------------------------------------

/**
 * Hard cap on any one item's text; the row's CSS ellipsis handles the rest of
 * the squeeze, but a single absurd branch or label run should never starve
 * every slot after it.
 */
export const META_TEXT_MAX = 24

/** End-ellipsis truncation; exactly `max` characters survive plus the ellipsis. */
export function truncateMetaText(text: string, max: number = META_TEXT_MAX): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * Compact "↑n ↓m" summary; zero sides hide, an empty summary is null. Same
 * shape as checkout's formatAheadBehind, kept seam-local so the directory
 * never depends on the checkout seam.
 */
function formatAheadBehind(ahead: number, behind: number): string | null {
  const up = ahead > 0 ? `↑${ahead}` : null
  const down = behind > 0 ? `↓${behind}` : null
  if (up && down) return `${up} ${down}`
  return up ?? down
}

// ---- slot resolution -----------------------------------------------------------

function branchItem(descriptor: WorkspaceDescriptor): WorkspaceMetaItem | null {
  const branch = descriptor.gitRuntime?.currentBranch?.trim()
  if (!branch) return null
  const git = descriptor.gitRuntime
  const aheadBehind = git?.aheadBehind ? formatAheadBehind(git.aheadBehind.ahead, git.aheadBehind.behind) : null
  return {
    kind: 'branch',
    text: truncateMetaText(branch),
    tone: 'neutral',
    dirty: git?.isDirty === true,
    aheadBehind,
  }
}

function projectItem(descriptor: WorkspaceDescriptor): WorkspaceMetaItem {
  return { kind: 'project', text: truncateMetaText(projectName(descriptor)), tone: 'neutral' }
}

/**
 * The descriptor carries no host of its own; the scripts' hostname is the only
 * source today, and only when every script agrees the workspace lives on one
 * host — a split-host workspace says nothing rather than a wrong half.
 */
function hostItem(descriptor: WorkspaceDescriptor): WorkspaceMetaItem | null {
  const hostnames = new Set(descriptor.scripts.map((script) => script.hostname))
  if (hostnames.size !== 1) return null
  const hostname = [...hostnames][0]
  return hostname ? { kind: 'host', text: truncateMetaText(hostname), tone: 'neutral' } : null
}

function pullRequestItem(descriptor: WorkspaceDescriptor): WorkspaceMetaItem | null {
  const pr = descriptor.githubRuntime?.pullRequest
  if (!pr) return null
  const detail = pr.isMerged ? 'merged' : pr.isDraft ? 'draft' : (pr.state.trim().toLowerCase() || null)
  if (!detail) return null
  // With a number the item reads "#42 open"; without one the state word alone
  // still carries the standing — that is data, not a placeholder.
  const text = pr.number != null ? `#${pr.number}` : detail
  return {
    kind: 'pullRequest',
    text,
    detail: pr.number != null ? detail : null,
    tone: pr.isMerged ? 'ok' : 'neutral',
  }
}

/**
 * Services are the scripts the daemon typed as such; "running/total" with the
 * tone going danger the moment one is unhealthy and ok only while every one
 * of them runs.
 */
function servicesItem(descriptor: WorkspaceDescriptor): WorkspaceMetaItem | null {
  const services = descriptor.scripts.filter((script) => script.type === 'service')
  if (services.length === 0) return null
  const running = services.filter((script) => script.lifecycle === 'running').length
  const tone: MetaTone = services.some((script) => script.health === 'unhealthy')
    ? 'danger'
    : running === services.length
      ? 'ok'
      : 'neutral'
  return { kind: 'services', text: `${running}/${services.length}`, tone }
}

function labelsItem(descriptor: WorkspaceDescriptor): WorkspaceMetaItem | null {
  const labels = descriptor.labels ?? []
  if (labels.length === 0) return null
  return { kind: 'labels', text: truncateMetaText(labels.join(', ')), tone: 'neutral' }
}

// ---- checks ---------------------------------------------------------------------

/**
 * The run status: the daemon's own checksStatus when supplied, otherwise the
 * worst of the individual runs — any failure fails, else any pending pends.
 * Skipped runs count as passed for the label; they resolved, they just did no
 * work.
 */
function resolveChecks(
  pr: NonNullable<NonNullable<WorkspaceDescriptor['githubRuntime']>['pullRequest']>,
  mode: ChecksMode,
): WorkspaceMetaChecks | null {
  if (mode === 'hidden') return null
  const checks = pr.checks ?? []
  const status = pr.checksStatus ?? deriveChecksStatus(checks)
  if (status === 'none' || status == null) return null
  if (mode === 'iconOnly' || checks.length === 0) return { status, label: null }
  const passed = checks.filter((check) => check.status === 'success' || check.status === 'skipped').length
  return { status, label: `${passed}/${checks.length}` }
}

type PullRequestChecks = NonNullable<
  NonNullable<NonNullable<WorkspaceDescriptor['githubRuntime']>['pullRequest']>['checks']
>

function deriveChecksStatus(checks: PullRequestChecks): 'success' | 'pending' | 'failure' | null {
  if (checks.length === 0) return null
  if (checks.some((check) => check.status === 'failure')) return 'failure'
  if (checks.some((check) => check.status === 'pending')) return 'pending'
  return 'success'
}

// ---- trailing slot ---------------------------------------------------------------

function resolveTrailing(descriptor: WorkspaceDescriptor, trailing: TrailingSlot): WorkspaceMetaTrailing | null {
  if (trailing === 'activity') {
    const at = workspaceActivityAt(descriptor)
    // A descriptor with no activityAt maps to the epoch; a date from 1970 is a
    // placeholder in disguise, so the slot stays empty instead.
    return at > 0 ? { kind: 'activity', at } : null
  }
  const diffStat = descriptor.diffStat
  if (!diffStat) return null
  // Zero additions and zero deletions has nothing to say; the pill would hide
  // its zero sides anyway and read as an empty pair of signs.
  if (diffStat.additions <= 0 && diffStat.deletions <= 0) return null
  return { kind: 'diffStat', additions: diffStat.additions, deletions: diffStat.deletions }
}

// ---- resolution ------------------------------------------------------------------

/**
 * The whole meta line for one workspace: slot items in fixed order, the checks
 * readout, and the trailing slot. Pure over (descriptor, config).
 */
export function workspaceMetaLine(
  descriptor: WorkspaceDescriptor,
  config: WorkspaceMetaConfig = DEFAULT_META_CONFIG,
): WorkspaceMetaLine {
  const items: WorkspaceMetaItem[] = []
  if (config.slots.branch) {
    const item = branchItem(descriptor)
    if (item) items.push(item)
  }
  if (config.slots.project) items.push(projectItem(descriptor))
  if (config.slots.host) {
    const item = hostItem(descriptor)
    if (item) items.push(item)
  }
  if (config.slots.pullRequest) {
    const item = pullRequestItem(descriptor)
    if (item) items.push(item)
  }
  if (config.slots.services) {
    const item = servicesItem(descriptor)
    if (item) items.push(item)
  }
  if (config.slots.labels) {
    const item = labelsItem(descriptor)
    if (item) items.push(item)
  }
  // Checks ride on the pull request's data but answer to their own toggle, so
  // they can render even when the PR slot itself is off.
  const pr = descriptor.githubRuntime?.pullRequest
  const checks = pr ? resolveChecks(pr, config.checksMode) : null
  return { items, checks, trailing: resolveTrailing(descriptor, config.trailing) }
}

/**
 * The row title: an explicit override always wins over derived names; the
 * branch-name source swaps in the current branch when the daemon knows one.
 */
export function workspaceRowTitle(
  descriptor: WorkspaceDescriptor,
  config: WorkspaceMetaConfig = DEFAULT_META_CONFIG,
): string {
  if (config.titleSource === 'branch') {
    const branch = descriptor.gitRuntime?.currentBranch?.trim()
    if (branch) return branch
  }
  return workspaceDisplayName(descriptor)
}
