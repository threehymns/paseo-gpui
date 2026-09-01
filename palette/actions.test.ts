import { describe, expect, test } from 'bun:test'
import { ACTION_SECTIONS, ActionRegistry, SECTION_LABELS, type RegisteredAction } from './actions'

function action(overrides: Partial<RegisteredAction> & { id: string }): RegisteredAction {
  return { title: overrides.id, section: 'actions', run: () => {}, ...overrides }
}

describe('action registry', () => {
  test('lists registered actions in registration order', () => {
    const registry = new ActionRegistry()
    const dispose = registry.register(action({ id: 'app.new-task', title: 'New Task' }), action({ id: 'app.toggle-sidebar', title: 'Toggle Sidebar' }))
    expect(dispose).toBeFunction()
    expect(registry.list().map((a) => a.id)).toEqual(['app.new-task', 'app.toggle-sidebar'])
  })

  test('the disposer removes exactly its own batch', () => {
    const registry = new ActionRegistry()
    const first = registry.register(action({ id: 'one' }))
    registry.register(action({ id: 'two' }))
    first()
    expect(registry.list().map((a) => a.id)).toEqual(['two'])
    expect(() => first()).not.toThrow()
  })

  test('re-registering an id replaces the entry in place', () => {
    const registry = new ActionRegistry()
    registry.register(action({ id: 'one' }), action({ id: 'two' }))
    const replaced = action({ id: 'two', title: 'Renamed' })
    const dispose = registry.register(replaced)
    expect(registry.list().map((a) => a.id)).toEqual(['one', 'two'])
    expect(registry.list()[1]).toBe(replaced)
    dispose()
    expect(registry.list().map((a) => a.id)).toEqual(['one'])
  })

  test('a disposer never removes an entry it did not register last', () => {
    const registry = new ActionRegistry()
    const stale = registry.register(action({ id: 'one' }))
    registry.register(action({ id: 'one', title: 'Newer' }))
    stale()
    expect(registry.list().map((a) => a.id)).toEqual(['one'])
  })

  test('declares the fixed section order and labels', () => {
    expect(ACTION_SECTIONS).toEqual(['actions', 'workspaces', 'agents', 'model', 'thinking', 'mode'])
    expect(SECTION_LABELS['agents']).toBe('Agents')
  })
})
