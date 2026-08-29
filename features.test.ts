import { describe, expect, test } from 'bun:test'
import { toggleFeatures } from './features'

const catalog = [
  { type: 'toggle', id: 'memory', label: 'Memory', value: true },
  { type: 'select', id: 'style', label: 'Style', value: 'fast', options: [] },
  { type: 'toggle', id: 'webSearch', label: 'Web search', value: false },
] as unknown as Parameters<typeof toggleFeatures>[0]

describe('provider feature toggles', () => {
  test('keeps only On/Off toggles, in catalog order', () => {
    expect(toggleFeatures(catalog)).toEqual([
      { type: 'toggle', id: 'memory', label: 'Memory', value: true },
      { type: 'toggle', id: 'webSearch', label: 'Web search', value: false },
    ])
  })

  test('missing catalogs yield no toggles', () => {
    expect(toggleFeatures(undefined)).toEqual([])
    expect(toggleFeatures(null)).toEqual([])
    expect(toggleFeatures([])).toEqual([])
  })
})
