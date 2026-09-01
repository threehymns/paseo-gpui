/**
 * The shared open-file seam for the transcript: resolving workspace paths and
 * handing them to a native opener.
 *
 * Both inline-code links in assistant markdown and open buttons on file-bearing
 * tool rows route through this module, so "can this text be opened as a file?"
 * and "what happens when nothing can open it" are decided in exactly one place.
 * @gpuix ships no file-opener API yet; `nativeOpenFileBridge` is the adapter
 * slot that stubs to null today, and callers degrade to a visible notice
 * instead of dying silently.
 */

import { statSync } from 'node:fs'
import path from 'node:path'

/**
 * One inline-code span or tool path folded against a workspace root: either an
 * openable file inside the workspace (carrying the text as written), or plain
 * content that must not render as a link.
 */
export type ResolvedWorkspaceFile =
  | { kind: 'file'; label: string; absolutePath: string }
  | { kind: 'plain' }

/** True when the path names an existing regular file; unreadable paths are not files. */
function isExistingFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

/**
 * Folds raw text against the workspace root. Accepts workspace-relative and
 * absolute-inside-root paths that name an existing regular file; everything
 * else — URLs, tilde paths, traversal escaping the root, directories,
 * missing files — folds to `plain`.
 */
export function resolveWorkspaceFile(
  root: string,
  raw: string,
  isFile: (candidate: string) => boolean = isExistingFile,
): ResolvedWorkspaceFile {
  const label = raw.trim()
  if (!label) return { kind: 'plain' }
  // Anything scheme-shaped (https:, file:, data:) is not a filesystem path.
  if (/^[a-z][a-z0-9+.-]*:/i.test(label)) return { kind: 'plain' }
  if (label.startsWith('~')) return { kind: 'plain' }
  const base = path.resolve(root)
  const absolutePath = path.resolve(base, label)
  if (absolutePath !== base && !absolutePath.startsWith(base + path.sep)) return { kind: 'plain' }
  if (!isFile(absolutePath)) return { kind: 'plain' }
  return { kind: 'file', label, absolutePath }
}

// ---- the native opener adapter slot -----------------------------------------

/**
 * The native half of the seam. @gpuix exposes no file-opener yet; when one
 * lands, this returns a bridge over it and every caller inherits the
 * capability with no further changes.
 */
export interface OpenFileBridge {
  /** Opens one absolute path in the OS viewer/editor; resolves once handed off. */
  open(absolutePath: string): Promise<void>
}

export function nativeOpenFileBridge(): OpenFileBridge | null {
  return null
}

// ---- outcome folding --------------------------------------------------------

/** What became of an open-file request, ready to surface as-is. */
export type OpenFileOutcome =
  | { status: 'opened' }
  | { status: 'failed'; message: string }
  | { status: 'unavailable'; notice: string }

export const OPEN_FILE_UNAVAILABLE_NOTICE =
  'Opening files needs a native bridge from @gpuix; opening files is not supported yet.'

/**
 * Routes one open request through the bridge, folding every ending into an
 * outcome: no bridge degrades to the visible unavailable notice, a rejecting
 * bridge reports its message, and nothing here throws.
 */
export async function requestOpenFile(
  bridge: OpenFileBridge | null,
  absolutePath: string,
): Promise<OpenFileOutcome> {
  if (!bridge) return { status: 'unavailable', notice: OPEN_FILE_UNAVAILABLE_NOTICE }
  try {
    await bridge.open(absolutePath)
    return { status: 'opened' }
  } catch (err) {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
    return { status: 'failed', message }
  }
}
