import { describe, expect, test } from 'bun:test'
import {
  MAX_ATTACHMENT_BYTES,
  RASTER_IMAGE_EXTENSIONS,
  addAttachment,
  classifyPaste,
  getFileExtension,
  getRasterImageMimeTypeFromPath,
  imagePickerDialogOptions,
  removeAttachment,
  resolveRasterImageMimeType,
  stageAttachments,
  toSendImages,
  tooLargeMessage,
  unsupportedImagesMessage,
  planAttachments,
  type ImageAttachment,
  type IncomingImage,
} from './attachments'

const png = (over: Partial<IncomingImage> = {}): IncomingImage => ({
  name: 'shot.png',
  mimeType: 'image/png',
  size: 10,
  data: 'aGk=',
  ...over,
})

describe('raster image vocabulary', () => {
  test('extension map covers the picker filter list', () => {
    expect(getRasterImageMimeTypeFromPath('a.PNG')).toBe('image/png')
    expect(getRasterImageMimeTypeFromPath('b.jpeg')).toBe('image/jpeg')
    expect(getRasterImageMimeTypeFromPath('c.gif')).toBe('image/gif')
    expect(getRasterImageMimeTypeFromPath('d.webp')).toBe('image/webp')
    expect(getRasterImageMimeTypeFromPath('e.bmp')).toBe('image/bmp')
    expect(getRasterImageMimeTypeFromPath('f.heic')).toBe('image/heic')
    expect(getRasterImageMimeTypeFromPath('g.heif')).toBe('image/heif')
    expect(getRasterImageMimeTypeFromPath('h.avif')).toBe('image/avif')
    expect(getRasterImageMimeTypeFromPath('i.tif')).toBe('image/tiff')
    expect(getRasterImageMimeTypeFromPath('j.tiff')).toBe('image/tiff')
    expect(getRasterImageMimeTypeFromPath('k.pdf')).toBeNull()
    expect(getRasterImageMimeTypeFromPath('noext')).toBeNull()
    expect(getFileExtension('dir.d/name.png')).toBe('.png')
  })

  test('resolve prefers a supplied raster mime and falls back to the path', () => {
    expect(resolveRasterImageMimeType({ mimeType: 'image/jpeg', path: 'a.png' })).toBe('image/jpeg')
    expect(resolveRasterImageMimeType({ mimeType: 'image/jpg' })).toBe('image/jpeg')
    expect(resolveRasterImageMimeType({ mimeType: 'image/png; charset=binary' })).toBe('image/png')
    expect(resolveRasterImageMimeType({ path: 'a.webp' })).toBe('image/webp')
    // A supplied non-raster mime never falls through to the extension.
    expect(resolveRasterImageMimeType({ mimeType: 'application/pdf', path: 'a.png' })).toBeNull()
    expect(resolveRasterImageMimeType({})).toBeNull()
    expect(RASTER_IMAGE_EXTENSIONS).toContain('png')
    expect(RASTER_IMAGE_EXTENSIONS).toContain('tiff')
  })
})

describe('paste classification', () => {
  test('text falls through as normal text', () => {
    const out = classifyPaste({ kind: 'text', text: 'fix the bug' })
    expect(out).toEqual({ kind: 'text', text: 'fix the bug' })
  })

  test('file lists are routed to the attach planner', () => {
    const files = [png(), png({ name: 'clip.gif', mimeType: 'image/gif' })]
    const out = classifyPaste({ kind: 'files', files })
    expect(out.kind).toBe('files')
  })
})

describe('size validation blocks before anything is staged', () => {
  test('the paseo upload cap message names the file', () => {
    expect(tooLargeMessage('big.png')).toBe('big.png is too large (max 50MB)')
    expect(MAX_ATTACHMENT_BYTES).toBe(50 * 1024 * 1024)
  })

  test('an oversized image rejects the whole paste with the inline notice', () => {
    const plan = planAttachments([png(), png({ name: 'big.png', size: MAX_ATTACHMENT_BYTES + 1 })])
    expect(plan.images).toEqual([])
    expect(plan.notice).toBe('big.png is too large (max 50MB)')
    expect(plan.blocked).toBe(true)
  })

  test('exactly at the cap still attaches', () => {
    const plan = planAttachments([png({ size: MAX_ATTACHMENT_BYTES })])
    expect(plan.images).toHaveLength(1)
    expect(plan.notice).toBeNull()
    expect(plan.blocked).toBe(false)
  })

  test('oversize wins over classification for picked files too', () => {
    const plan = planAttachments([png({ name: 'huge.heic', mimeType: 'image/heic', size: 51 * 1024 * 1024 })])
    expect(plan.blocked).toBe(true)
    expect(plan.images).toEqual([])
  })
})

describe('attach planning', () => {
  test('raster images become staged chips carrying name, mime, and bytes', () => {
    const plan = planAttachments([png(), png({ name: 'photo.avif', mimeType: null })])
    expect(plan.blocked).toBe(false)
    expect(plan.notice).toBeNull()
    expect(plan.images.map((image) => [image.name, image.mimeType])).toEqual([
      ['shot.png', 'image/png'],
      ['photo.avif', 'image/avif'],
    ])
    expect(plan.images[0]!.data).toBe('aGk=')
    expect(plan.images[0]!.id).toBeTruthy()
    expect(plan.images[0]!.id).not.toBe(plan.images[1]!.id)
  })

  test('a paste with no raster image names the rejected item instead of a dead chip', () => {
    const plan = planAttachments([png({ name: 'notes.pdf', mimeType: 'application/pdf' })])
    expect(plan.images).toEqual([])
    expect(plan.notice).toBe(unsupportedImagesMessage(['notes.pdf']))
    expect(plan.blocked).toBe(true)
  })

  test('a mixed paste attaches the rasters and names the rest', () => {
    const plan = planAttachments([png({ name: 'doc.pdf', mimeType: 'application/pdf' }), png()])
    expect(plan.images).toHaveLength(1)
    expect(plan.rejectedNames).toEqual(['doc.pdf'])
    expect(plan.blocked).toBe(false)
  })

  test('mime type derives from the file name when absent', () => {
    const plan = planAttachments([{ name: 'grab.tiff', mimeType: null, size: 5, data: 'x' }])
    expect(plan.images[0]!.mimeType).toBe('image/tiff')
  })
})

describe('attach/detach list operations', () => {
  const a: ImageAttachment = { id: 'a', name: 'a.png', mimeType: 'image/png', data: 'aa=' }
  const b: ImageAttachment = { id: 'b', name: 'b.png', mimeType: 'image/png', data: 'bb=' }

  test('add appends without mutating', () => {
    const list = addAttachment([a], b)
    expect(list).toEqual([a, b])
    expect(list).not.toBe([a])
  })

  test('remove drops by id and preserves order', () => {
    const c: ImageAttachment = { id: 'c', name: 'c.png', mimeType: 'image/png', data: 'cc=' }
    expect(removeAttachment([a, b, c], 'b')).toEqual([a, c])
    expect(removeAttachment([a], 'zz')).toEqual([a])
  })

  test('stage assigns fresh ids per call', () => {
    const first = stageAttachments([png()])
    const second = stageAttachments([png()])
    expect(first[0]!.id).not.toBe(second[0]!.id)
  })
})

describe('send encoding', () => {
  test('chips encode as raw base64 data-plus-mimeType pairs, in order', () => {
    const chips = [
      { id: 'a', name: 'a.png', mimeType: 'image/png', data: 'aa=' },
      { id: 'b', name: 'b.jpg', mimeType: 'image/jpeg', data: 'bb=' },
    ]
    expect(toSendImages(chips)).toEqual([
      { data: 'aa=', mimeType: 'image/png' },
      { data: 'bb=', mimeType: 'image/jpeg' },
    ])
    expect(toSendImages([])).toEqual([])
  })
})

describe('picker dialog contract', () => {
  test('filters to raster types with multiple selection', () => {
    const options = imagePickerDialogOptions()
    expect(options.multiple).toBe(true)
    expect(options.filters).toEqual([{ name: 'Images', extensions: RASTER_IMAGE_EXTENSIONS }])
    for (const extension of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif', 'tif', 'tiff']) {
      expect(RASTER_IMAGE_EXTENSIONS).toContain(extension)
    }
  })
})
