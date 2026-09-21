import { describe, expect, test } from 'bun:test'
import {
  workspaceLabelColor,
  workspaceMutations,
  type WorkspaceMutationsClient,
} from './workspace-mutations'

/** Records every mutation call in order, echoing the daemon's stubs. */
function recordingClient(calls: string[]): WorkspaceMutationsClient {
  return {
    setWorkspaceTitle: async (workspaceId, title) => {
      calls.push(`title:${workspaceId}:${JSON.stringify(title)}`)
      return { title }
    },
    setWorkspacePinned: async (workspaceId, pinned) => {
      calls.push(`pin:${workspaceId}:${pinned}`)
      return { pinnedAt: pinned ? '2026-08-24T09:00:00Z' : null }
    },
    clearWorkspaceAttention: async (workspaceId) => {
      calls.push(`attention:${workspaceId}`)
    },
    setWorkspaceLabel: async (options) => {
      calls.push(`label:${options.workspaceId}:${options.label.name}:${options.label.color}:${options.assigned}`)
      return {}
    },
    archiveWorkspace: async (workspaceId) => {
      calls.push(`archive:${workspaceId}`)
      return { archivedAt: '2026-08-24T09:00:00Z' }
    },
  }
}

describe('workspaceMutations', () => {
  test('setTitle calls setWorkspaceTitle as-is', async () => {
    const calls: string[] = []
    await workspaceMutations(recordingClient(calls)).setTitle('w1', 'Fix login')
    expect(calls).toEqual(['title:w1:"Fix login"'])
  })

  test('setTitle with null restores the derived title', async () => {
    const calls: string[] = []
    await workspaceMutations(recordingClient(calls)).setTitle('w1', null)
    expect(calls).toEqual(['title:w1:null'])
  })

  test('setPinned forwards the pinned boolean', async () => {
    const calls: string[] = []
    const mutations = workspaceMutations(recordingClient(calls))
    await mutations.setPinned('w1', true)
    await mutations.setPinned('w1', false)
    expect(calls).toEqual(['pin:w1:true', 'pin:w1:false'])
  })

  test('clearAttention forwards the workspace id', async () => {
    const calls: string[] = []
    await workspaceMutations(recordingClient(calls)).clearAttention('w1')
    expect(calls).toEqual(['attention:w1'])
  })

  test('toggleLabel shapes the assignment payload with a deterministic colour', async () => {
    const calls: string[] = []
    const mutations = workspaceMutations(recordingClient(calls))
    await mutations.toggleLabel('w1', 'frontend', true)
    await mutations.toggleLabel('w1', 'frontend', false)
    const color = workspaceLabelColor('frontend')
    expect(calls).toEqual([
      `label:w1:frontend:${color}:true`,
      `label:w1:frontend:${color}:false`,
    ])
    expect(color).toMatch(/^(violet|sky|emerald|orange|pink|indigo|teal|red|amber|blue)$/)
  })

  test('toggleLabel trims the name before pairing it with a colour', async () => {
    const calls: string[] = []
    await workspaceMutations(recordingClient(calls)).toggleLabel('w1', '  api  ', true)
    expect(calls).toEqual([`label:w1:api:${workspaceLabelColor('api')}:true`])
  })

  test('clearLabels removes every applied label', async () => {
    const calls: string[] = []
    const mutations = workspaceMutations(recordingClient(calls))
    await mutations.clearLabels('w1', ['alpha', 'beta'])
    expect(calls).toEqual([
      `label:w1:alpha:${workspaceLabelColor('alpha')}:false`,
      `label:w1:beta:${workspaceLabelColor('beta')}:false`,
    ])
  })

  test('clearLabels with nothing applied sends no calls', async () => {
    const calls: string[] = []
    await workspaceMutations(recordingClient(calls)).clearLabels('w1', [])
    expect(calls).toEqual([])
  })

  test('archive calls archiveWorkspace', async () => {
    const calls: string[] = []
    await workspaceMutations(recordingClient(calls)).archive('w1')
    expect(calls).toEqual(['archive:w1'])
  })

  test('a rejected daemon call propagates to the awaiting UI', async () => {
    const rejecting: WorkspaceMutationsClient = {
      setWorkspaceTitle: () => Promise.reject(new Error('nope')),
      setWorkspacePinned: () => Promise.reject(new Error('nope')),
      clearWorkspaceAttention: () => Promise.reject(new Error('nope')),
      setWorkspaceLabel: () => Promise.reject(new Error('nope')),
      archiveWorkspace: () => Promise.reject(new Error('nope')),
    }
    const mutations = workspaceMutations(rejecting)
    await expect(mutations.setTitle('w1', 'x')).rejects.toThrow('nope')
    await expect(mutations.setPinned('w1', true)).rejects.toThrow('nope')
    await expect(mutations.clearAttention('w1')).rejects.toThrow('nope')
    await expect(mutations.toggleLabel('w1', 'x', true)).rejects.toThrow('nope')
    await expect(mutations.archive('w1')).rejects.toThrow('nope')
  })
})

describe('workspaceLabelColor', () => {
  test('is deterministic per name', () => {
    expect(workspaceLabelColor('frontend')).toBe(workspaceLabelColor('frontend'))
    expect(workspaceLabelColor('api')).toBe(workspaceLabelColor('api'))
  })

  test('maps to the protocol colour vocabulary only', () => {
    const allowed = ['violet', 'sky', 'emerald', 'orange', 'pink', 'indigo', 'teal', 'red', 'amber', 'blue']
    for (const name of ['a', 'b', 'c', 'zz', 'frontend', 'api', 'urgent']) {
      expect(allowed).toContain(workspaceLabelColor(name))
    }
  })

  test('spreads across colours for varied names', () => {
    const seen = new Set(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].map(workspaceLabelColor))
    expect(seen.size).toBeGreaterThan(1)
  })
})