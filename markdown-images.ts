/**
 * Markdown image sources, as pure classification over plain values.
 *
 * Assistant markdown may embed images; only self-contained (`data:`) and
 * web-hosted (`http(s):`) sources can render in the transcript. The classifier
 * decides which of the four frame states a source gets before any component
 * renders, and the probe gives remote sources a real loading→loaded/error
 * journey even though @gpuix exposes no native load events yet.
 */

/** Which frame an image source renders in: ready, loading-remotely, invalid, or no frame at all. */
export type ClassifiedImageSource =
  | { kind: 'ready' }
  | { kind: 'remote' }
  | { kind: 'invalid' }
  | { kind: 'unsupported' }

const DATA_IMAGE_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i

function decodesAsBase64(body: string): boolean {
  try {
    return atob(body.replace(/\s+/g, '')).length > 0
  } catch {
    return false
  }
}

/**
 * Folds one markdown image URL to its frame state. Well-formed image data URLs
 * are ready at once; http(s) URLs load remotely; data URLs that fail validation
 * are invalid (a distinct failure state); everything else is unsupported and
 * renders no frame.
 */
export function classifyImageSource(src: string | undefined | null): ClassifiedImageSource {
  const value = src?.trim()
  if (!value) return { kind: 'unsupported' }
  if (/^https?:\/\//i.test(value)) return { kind: 'remote' }
  if (/^data:/i.test(value)) {
    const match = DATA_IMAGE_PATTERN.exec(value)
    return match && decodesAsBase64(match[1]!) ? { kind: 'ready' } : { kind: 'invalid' }
  }
  return { kind: 'unsupported' }
}

/**
 * Checks that a remote image source is actually fetchable, so the frame shows
 * its error state on dead links rather than waiting on the renderer forever.
 * Never throws; any failure means "did not load".
 */
export async function probeRemoteImage(
  url: string,
  fetchImpl: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean }> = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) })
    return response.ok
  } catch {
    return false
  }
}
