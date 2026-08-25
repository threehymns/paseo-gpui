/**
 * Composer image attachments: paste classification, size validation, and the
 * staged chip list, as pure operations over plain values.
 *
 * Vocabulary and limits follow the Paseo app (packages/app/src/attachments and
 * packages/app/src/composer): only raster images attach; the daemon caps file
 * uploads at 50 MB, which this port also applies to images so an oversized
 * attachment fails inline instead of at send time.
 */

const RASTER_IMAGE_MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
}

const RASTER_IMAGE_MIME_TYPES = new Set(Object.values(RASTER_IMAGE_MIME_TYPE_BY_EXTENSION))

export const RASTER_IMAGE_EXTENSIONS = Object.keys(RASTER_IMAGE_MIME_TYPE_BY_EXTENSION).map((extension) =>
  extension.slice(1),
)

/** Paseo's daemon file-upload cap; images are uncapped upstream but capped here. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const MAX_ATTACHMENT_LABEL = '50MB'

// ---- outgoing payload ------------------------------------------------------

/** Raw base64 pair riding on an outgoing message — not a data URL. */
export interface SendImage {
  data: string
  mimeType: string
}

export interface ImageAttachment {
  id: string
  name: string
  mimeType: string
  /** Raw base64 bytes, no data-URL prefix. */
  data: string
}

/** An image offered to the composer from the clipboard or the file picker. */
export interface IncomingImage {
  name: string
  mimeType?: string | null
  /** Encoded byte count, checked against the cap before anything persists. */
  size: number
  data: string
}

// ---- raster classification (ported from paseo's file-types.ts) -------------

export function getFileExtension(path: string): string {
  const normalizedPath = path.split('#', 1)[0]?.split('?', 1)[0] ?? path
  const extensionIndex = normalizedPath.lastIndexOf('.')
  if (extensionIndex < 0) return ''
  return normalizedPath.slice(extensionIndex).toLowerCase()
}

export function getRasterImageMimeTypeFromPath(path: string): string | null {
  return RASTER_IMAGE_MIME_TYPE_BY_EXTENSION[getFileExtension(path)] ?? null
}

export function resolveRasterImageMimeType(input: {
  mimeType?: string | null
  path?: string | null
}): string | null {
  const suppliedMimeType = input.mimeType?.trim()
  if (suppliedMimeType) {
    const normalizedMimeType = suppliedMimeType.split(';', 1)[0]?.trim().toLowerCase()
    if (normalizedMimeType === 'image/jpg') return 'image/jpeg'
    return normalizedMimeType && RASTER_IMAGE_MIME_TYPES.has(normalizedMimeType) ? normalizedMimeType : null
  }
  return input.path ? getRasterImageMimeTypeFromPath(input.path) : null
}

// ---- paste classification --------------------------------------------------

/** What a clipboard hand-off contains: plain text, or a list of files. */
export type PastePayload = { kind: 'text'; text: string } | { kind: 'files'; files: readonly IncomingImage[] }

export function classifyPaste(payload: PastePayload): PastePayload {
  return payload
}

// ---- size validation -------------------------------------------------------

export function tooLargeMessage(name: string): string {
  return `${name} is too large (max ${MAX_ATTACHMENT_LABEL})`
}

export function unsupportedImagesMessage(names: readonly string[]): string {
  const listed = names.join(', ')
  const plural = names.length > 1 ? 's' : ''
  return `${listed} can't be attached — only image${plural} can`
}

function findOversizedName(files: readonly IncomingImage[]): string | null {
  return files.find((file) => file.size > MAX_ATTACHMENT_BYTES)?.name ?? null
}

// ---- planning: validate, then stage ----------------------------------------

export interface AttachmentPlan {
  /** Chips to add; empty whenever blocked. */
  images: ImageAttachment[]
  /** Non-raster items that were skipped, named for the inline notice. */
  rejectedNames: string[]
  /** Inline notice text, set when items were rejected or the paste was blocked. */
  notice: string | null
  /** True when nothing could be attached at all. */
  blocked: boolean
}

/**
 * Validates offered files against the size cap and the raster-only rule, then
 * stages the survivors as chips. Nothing persists when any item is oversized.
 */
export function planAttachments(files: readonly IncomingImage[]): AttachmentPlan {
  const oversized = findOversizedName(files)
  if (oversized) {
    return { images: [], rejectedNames: [], notice: tooLargeMessage(oversized), blocked: true }
  }

  const accepted: ResolvedImage[] = []
  const rejectedNames: string[] = []
  for (const file of files) {
    const mimeType = resolveRasterImageMimeType({ mimeType: file.mimeType, path: file.name })
    if (mimeType) accepted.push({ name: file.name, mimeType, data: file.data })
    else rejectedNames.push(file.name)
  }

  if (accepted.length === 0 && rejectedNames.length > 0) {
    return {
      images: [],
      rejectedNames,
      notice: unsupportedImagesMessage(rejectedNames),
      blocked: true,
    }
  }

  return { images: stageAttachments(accepted), rejectedNames, notice: null, blocked: false }
}

// ---- chip list operations ---------------------------------------------------

export function newAttachmentId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

/** An offered image whose raster mime type has been resolved. */
export interface ResolvedImage {
  name: string
  mimeType: string
  data: string
}

/** Stages validated images as fresh chips; ids never repeat across calls. */
export function stageAttachments(images: readonly ResolvedImage[]): ImageAttachment[] {
  return images.map((image) => ({
    id: newAttachmentId(),
    name: image.name,
    mimeType: image.mimeType,
    data: image.data,
  }))
}

export function addAttachment(list: readonly ImageAttachment[], attachment: ImageAttachment): ImageAttachment[] {
  return [...list, attachment]
}

export function removeAttachment(list: readonly ImageAttachment[], id: string): ImageAttachment[] {
  return list.filter((attachment) => attachment.id !== id)
}

/** Strips chips down to the raw base64 pairs the outgoing message carries. */
export function toSendImages(list: readonly ImageAttachment[]): SendImage[] {
  return list.map(({ data, mimeType }) => ({ data, mimeType }))
}

// ---- picker dialog contract -------------------------------------------------

/**
 * Dialog options for picking images from disk: raster types only, multiple
 * selection allowed. A native dialog bridge opens it; `@gpuix` does not ship
 * one yet, so `pickImageDialogOptions` is the seam a bridge consumes.
 */
export function imagePickerDialogOptions(): {
  title: string
  multiple: true
  filters: { name: string; extensions: string[] }[]
} {
  return {
    title: 'Choose images',
    multiple: true,
    filters: [{ name: 'Images', extensions: RASTER_IMAGE_EXTENSIONS }],
  }
}
