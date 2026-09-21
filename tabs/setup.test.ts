import { describe, expect, test } from 'bun:test'
import {
  initialSetupState,
  reduceSetup,
  selectSetup,
  setupSucceeded,
  type SetupCommandStep,
  type SetupEvent,
  type SetupState,
  type WorktreeSetupDetail,
} from './setup'

function command(over: Partial<SetupCommandStep> = {}): SetupCommandStep {
  return {
    index: 0,
    command: 'git checkout',
    cwd: '/ws',
    log: '',
    status: 'running',
    exitCode: null,
    ...over,
  }
}

function detail(over: Partial<WorktreeSetupDetail> = {}): WorktreeSetupDetail {
  return {
    type: 'worktree_setup',
    worktreePath: '/ws/worktree',
    branchName: 'feature',
    log: '',
    commands: [],
    ...over,
  }
}

function run(events: SetupEvent[]): SetupState {
  return events.reduce(reduceSetup, initialSetupState)
}

const arrived = (workspaceId: string, over: Partial<SetupEvent & { status: 'running' }> = {}) =>
  ({
    type: 'progressArrived',
    workspaceId,
    status: 'running',
    detail: detail(),
    error: null,
    ...over,
  }) as SetupEvent

describe('workspace setup store', () => {
  test('initial state holds no snapshots', () => {
    expect(initialSetupState.entries).toEqual({})
    expect(selectSetup(initialSetupState, 'ws1')).toBe(null)
    expect(setupSucceeded(selectSetup(initialSetupState, 'ws1'))).toBe(false)
  })

  test('reset drops every snapshot back to empty', () => {
    const state = run([arrived('ws1'), { type: 'reset' }])
    expect(state.entries).toEqual({})
  })

  test('a progress push folds into a per-workspace snapshot', () => {
    const state = run([
      {
        type: 'progressArrived',
        workspaceId: 'ws1',
        status: 'running',
        detail: detail({ commands: [command({ command: 'npm install', status: 'completed', exitCode: 0 })] }),
        error: null,
      },
    ])
    expect(selectSetup(state, 'ws1')).toEqual({
      status: 'running',
      detail: {
        type: 'worktree_setup',
        worktreePath: '/ws/worktree',
        branchName: 'feature',
        log: '',
        commands: [{ index: 0, command: 'npm install', cwd: '/ws', log: '', status: 'completed', exitCode: 0 }],
        truncated: undefined,
      },
      error: null,
    })
    // Other workspaces stay untouched.
    expect(selectSetup(state, 'ws2')).toBe(null)
  })

  test('a newer report replaces the prior one for its workspace, never stacking', () => {
    const state = run([
      arrived('ws1', { status: 'running' }),
      {
        type: 'progressArrived',
        workspaceId: 'ws1',
        status: 'completed',
        detail: detail({ commands: [command()] }),
        error: null,
      },
    ])
    expect(Object.keys(state.entries)).toEqual(['ws1'])
    expect(selectSetup(state, 'ws1')?.status).toBe('completed')
    expect(setupSucceeded(selectSetup(state, 'ws1'))).toBe(true)
  })

  test('workspaces fold independently of one another', () => {
    const state = run([
      { ...arrived('ws1'), status: 'running' },
      { ...arrived('ws2'), status: 'running' },
    ])
    expect(selectSetup(state, 'ws1')).not.toBe(null)
    expect(selectSetup(state, 'ws2')).not.toBe(null)
    expect(Object.keys(state.entries)).toEqual(['ws1', 'ws2'])
  })

  test('a failure keeps the error and failing status visible', () => {
    const state = run([
      {
        type: 'progressArrived',
        workspaceId: 'ws1',
        status: 'failed',
        detail: detail({
          commands: [command({ command: 'git checkout', status: 'failed', exitCode: 128, log: 'fatal' })],
        }),
        error: 'checkout failed',
      },
    ])
    const snapshot = selectSetup(state, 'ws1')
    expect(snapshot?.status).toBe('failed')
    expect(snapshot?.error).toBe('checkout failed')
    expect(snapshot?.detail.commands[0]?.exitCode).toBe(128)
    expect(setupSucceeded(snapshot)).toBe(false)
  })

  test('progress for a workspace is inert until reported', () => {
    expect(setupSucceeded(selectSetup(initialSetupState, 'missing'))).toBe(false)
    expect(setupSucceeded(null)).toBe(false)
  })
})
