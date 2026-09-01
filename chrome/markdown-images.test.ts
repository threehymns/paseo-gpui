import { describe, expect, test } from 'bun:test'
import { classifyImageSource, probeRemoteImage } from './markdown-images'

// 'hi' encoded.
const PNG_DATA_URL = 'data:image/png;base64,aGk='

describe('markdown image source classification', () => {
  test('https and http sources load remotely', () => {
    expect(classifyImageSource('https://example.com/shot.png')).toEqual({ kind: 'remote' })
    expect(classifyImageSource('http://example.com/shot.png')).toEqual({ kind: 'remote' })
    expect(classifyImageSource('HTTPS://EXAMPLE.COM/X.PNG')).toEqual({ kind: 'remote' })
  })

  test('well-formed data:image sources are ready immediately', () => {
    expect(classifyImageSource(PNG_DATA_URL)).toEqual({ kind: 'ready' })
    expect(classifyImageSource('data:image/jpeg;base64,/9j/4AAQ')).toEqual({ kind: 'ready' })
  })

  test('a malformed data URL is a distinct invalid state, not unsupported', () => {
    // Non-image mime types never render as images.
    expect(classifyImageSource('data:text/html;base64,aGk=')).toEqual({ kind: 'invalid' })
    // Broken base64 bodies fail validation.
    expect(classifyImageSource('data:image/png;base64,!!!not-base64!!!')).toEqual({ kind: 'invalid' })
    expect(classifyImageSource('data:image/png')).toEqual({ kind: 'invalid' })
  })

  test('anything else is unsupported and must not render an image frame', () => {
    expect(classifyImageSource('src/app.ts')).toEqual({ kind: 'unsupported' })
    expect(classifyImageSource('./local.png')).toEqual({ kind: 'unsupported' })
    expect(classifyImageSource('ftp://example.com/x.png')).toEqual({ kind: 'unsupported' })
    expect(classifyImageSource('file:///tmp/x.png')).toEqual({ kind: 'unsupported' })
    expect(classifyImageSource('')).toEqual({ kind: 'unsupported' })
    expect(classifyImageSource(undefined)).toEqual({ kind: 'unsupported' })
  })

  test('surrounding whitespace does not change the verdict', () => {
    expect(classifyImageSource(`  ${PNG_DATA_URL}  `)).toEqual({ kind: 'ready' })
    expect(classifyImageSource('  https://example.com/x.png ')).toEqual({ kind: 'remote' })
  })
})

describe('remote image probe', () => {
  const ok = () => async () => new Response(null, { status: 200 })

  test('a successful response proves the image loads', async () => {
    await expect(probeRemoteImage('https://example.com/x.png', ok())).resolves.toBe(true)
  })

  test('an error status or network failure fails the probe instead of throwing', async () => {
    const notFound = async () => new Response(null, { status: 404 })
    await expect(probeRemoteImage('https://example.com/x.png', notFound)).resolves.toBe(false)
    const refusing = async () => {
      throw new Error('connection refused')
    }
    await expect(probeRemoteImage('https://example.com/x.png', refusing)).resolves.toBe(false)
  })
})
