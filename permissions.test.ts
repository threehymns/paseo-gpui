import { describe, expect, test } from 'bun:test'
import {
  allowResponse,
  denyResponse,
  initialPermissions,
  isResponding,
  permissionKey,
  reducePermissions,
  visiblePermissions,
  type PermissionsEvent,
  type PermissionsState,
} from './permissions'
import type { PermissionRequest } from './paseo'

const agentA = 'agent-aaa'
const agentB = 'agent-bbb'

let nextRequestId = 0
function toolRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  nextRequestId += 1
  return {
    id: `req-${nextRequestId}`,
    provider: 'anthropic',
    name: 'bash',
    kind: 'tool',
    title: 'Run command',
    description: 'ls -la',
    ...overrides,
  }
}

function run(events: PermissionsEvent[], initial: PermissionsState = initialPermissions): PermissionsState {
  return events.reduce(reducePermissions, initial)
}

describe('pending permissions', () => {
  test('a requested permission becomes a pending card for its agent', () => {
    const request = toolRequest()
    const state = run([{ type: 'requested', agentId: agentA, request }])
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({ agentId: agentA, requestId: request.id })
    expect(visiblePermissions(state, agentA)).toHaveLength(1)
  })

  test('requests for other agents never render for the active agent', () => {
    const state = run([
      { type: 'requested', agentId: agentA, request: toolRequest() },
      { type: 'requested', agentId: agentB, request: toolRequest() },
    ])
    expect(state.entries).toHaveLength(2)
    expect(visiblePermissions(state, agentA).map((entry) => entry.agentId)).toEqual([agentA])
    expect(visiblePermissions(state, agentB)).toHaveLength(1)
    expect(visiblePermissions(state, null)).toEqual([])
  })

  test('the same request twice upserts by exact key instead of duplicating', () => {
    const request = toolRequest()
    const renamed = { ...request, title: 'Run install' }
    const state = run([
      { type: 'requested', agentId: agentA, request },
      { type: 'requested', agentId: agentA, request: renamed },
      { type: 'requested', agentId: agentB, request: toolRequest() },
    ])
    const mine = visiblePermissions(state, agentA)
    expect(mine).toHaveLength(1)
    expect(mine[0]!.request.title).toBe('Run install')
  })

  test('resolution removes the matching entry only — same agent, same request', () => {
    const first = toolRequest()
    const second = toolRequest()
    const otherAgent = toolRequest()
    const state = run([
      { type: 'requested', agentId: agentA, request: first },
      { type: 'requested', agentId: agentA, request: second },
      { type: 'requested', agentId: agentB, request: otherAgent },
      { type: 'resolved', agentId: agentA, requestId: first.id },
    ])
    expect(visiblePermissions(state, agentA).map((entry) => entry.requestId)).toEqual([second.id])
    // The other agent's card is untouched.
    expect(visiblePermissions(state, agentB)).toHaveLength(1)
  })

  test('an out-of-band resolution settles a card nobody clicked', () => {
    const request = toolRequest()
    const settled = run([
      { type: 'requested', agentId: agentA, request },
      { type: 'respondStarted', agentId: agentA, requestId: request.id },
      // Another client answered it first; our wait call then times out or the
      // broadcast lands — either way the card must leave pending.
      { type: 'resolved', agentId: agentA, requestId: request.id },
      { type: 'respondFailed', agentId: agentA, requestId: request.id },
    ])
    expect(settled.entries).toEqual([])
    expect(isResponding(settled, agentA, request.id)).toBe(false)
  })

  test('a resolution for an unknown request leaves the store alone', () => {
    const before = run([{ type: 'requested', agentId: agentA, request: toolRequest() }])
    const after = reducePermissions(before, { type: 'resolved', agentId: agentA, requestId: 'nope' })
    expect(after).toBe(before)
  })

  test('in-flight marks exactly one card and clears when resolution lands', () => {
    const first = toolRequest()
    const second = toolRequest()
    let state = run([
      { type: 'requested', agentId: agentA, request: first },
      { type: 'requested', agentId: agentA, request: second },
      { type: 'respondStarted', agentId: agentA, requestId: first.id },
    ])
    expect(isResponding(state, agentA, first.id)).toBe(true)
    expect(isResponding(state, agentA, second.id)).toBe(false)
    state = reducePermissions(state, { type: 'resolved', agentId: agentA, requestId: first.id })
    expect(state.entries).toHaveLength(1)
    expect(isResponding(state, agentA, first.id)).toBe(false)
  })

  test('a failed respond keeps the card pending so it can be retried', () => {
    const request = toolRequest()
    const state = run([
      { type: 'requested', agentId: agentA, request },
      { type: 'respondStarted', agentId: agentA, requestId: request.id },
      { type: 'respondFailed', agentId: agentA, requestId: request.id },
    ])
    expect(visiblePermissions(state, agentA)).toHaveLength(1)
    expect(isResponding(state, agentA, request.id)).toBe(false)
  })

  test('switching agents clears stale cards via reset', () => {
    const request = toolRequest()
    const busy = run([
      { type: 'requested', agentId: agentA, request },
      { type: 'respondStarted', agentId: agentA, requestId: request.id },
    ])
    const cleared = reducePermissions(busy, { type: 'reset' })
    expect(cleared).toBe(initialPermissions)
    expect(cleared.entries).toEqual([])
    expect(cleared.responding).toEqual([])
  })

  test('returning to an agent merges the snapshot with requests that landed live first', () => {
    const live = toolRequest()
    const snapshotted = toolRequest()
    const both = toolRequest({ title: 'From snapshot' })
    const state = run([
      // A request arrived over the stream right after subscribing…
      { type: 'requested', agentId: agentA, request: live },
      { type: 'requested', agentId: agentA, request: both },
      { type: 'requested', agentId: agentB, request: toolRequest() },
      // …then the fresh snapshot on return lands without clobbering it.
      { type: 'seeded', agentId: agentA, requests: [snapshotted, both] },
    ])
    const mine = visiblePermissions(state, agentA)
    expect(mine).toHaveLength(3)
    expect(mine.map((entry) => entry.request.title)).toContain('From snapshot')
    expect(visiblePermissions(state, agentB)).toHaveLength(1)
  })

  test('seeding prunes stale in-flight keys for the reseeded agent', () => {
    const request = toolRequest()
    const state = run([
      { type: 'requested', agentId: agentA, request },
      { type: 'respondStarted', agentId: agentA, requestId: request.id },
      { type: 'seeded', agentId: agentA, requests: [] },
    ])
    expect(state.responding).toEqual([])
  })

  test('allow/deny responses reuse the daemon-suggested action when offered', () => {
    const withActions = toolRequest({
      actions: [
        { id: 'allow-once', label: 'Allow once', behavior: 'allow' },
        { id: 'deny-msg', label: 'Deny', behavior: 'deny' },
      ],
    })
    expect(allowResponse(withActions)).toEqual({ behavior: 'allow', selectedActionId: 'allow-once' })
    expect(denyResponse(withActions)).toEqual({ behavior: 'deny', selectedActionId: 'deny-msg' })

    const bare = toolRequest()
    expect(allowResponse(bare)).toEqual({ behavior: 'allow' })
    expect(denyResponse(bare)).toEqual({ behavior: 'deny' })
  })

  test('permissionKey pairs agent and request', () => {
    expect(permissionKey(agentA, 'r1')).toBe(`${agentA}:r1`)
    expect(permissionKey(agentB, 'r1')).not.toBe(permissionKey(agentA, 'r1'))
  })
})
