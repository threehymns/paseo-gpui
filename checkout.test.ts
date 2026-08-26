import { describe, expect, test } from 'bun:test'
import {
  branchLabel,
  checkoutEnabled,
  CHECKOUT_FEATURE_FLAG,
  foldCheckoutStatus,
  formatAheadBehind,
  initialCheckout,
  reduceCheckout,
  repoKeyOf,
  type CheckoutEvent,
  type CheckoutState,
  type CheckoutStatusPayload,
} from './checkout'

const cleanBranch = (overrides: Partial<CheckoutStatusPayload> = {}): CheckoutStatusPayload => ({
  cwd: '/repo',
  error: null,
  upstreamRef: 'origin/main',
  isGit: true,
  isPaseoOwnedWorktree: false,
  repoRoot: '/repo',
  currentBranch: 'feature/spine',
  isDirty: false,
  baseRef: 'main',
  aheadBehind: { ahead: 2, behind: 1 },
  hasRemote: true,
  remoteUrl: 'git@github.com:acme/widget.git',
  ...overrides,
})

const nonGit = (overrides: Partial<CheckoutStatusPayload> = {}): CheckoutStatusPayload => ({
  cwd: '/tmp/scratch',
  error: { code: 'NOT_GIT_REPO', message: 'not a git repository' },
  isGit: false,
  isPaseoOwnedWorktree: false,
  repoRoot: null,
  currentBranch: null,
  isDirty: null,
  baseRef: null,
  aheadBehind: null,
  hasRemote: false,
  remoteUrl: null,
  ...overrides,
})

function run(events: CheckoutEvent[], initial: CheckoutState = initialCheckout): CheckoutState {
  return events.reduce(reduceCheckout, initial)
}

describe('status folding', () => {
  test('folds a git payload into the fields the panel shows', () => {
    const status = foldCheckoutStatus(cleanBranch())
    expect(status.cwd).toBe('/repo')
    expect(status.isGit).toBe(true)
    expect(status.branch).toBe('feature/spine')
    expect(status.dirty).toBe(false)
    expect(status.baseRef).toBe('main')
    expect(status.remoteUrl).toBe('git@github.com:acme/widget.git')
    expect(status.hasRemote).toBe(true)
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(1)
    expect(status.upstreamRef).toBe('origin/main')
    expect(status.errorCode).toBeNull()
  })

  test('detached HEAD folds to a null branch — never a wrong name', () => {
    const status = foldCheckoutStatus(cleanBranch({ currentBranch: null }))
    expect(status.branch).toBeNull()
    expect(branchLabel(status)).toBe('unknown')
  })

  test('a named branch labels as itself', () => {
    const status = foldCheckoutStatus(cleanBranch())
    expect(branchLabel(status)).toBe('feature/spine')
  })

  test('non-git workspaces fold to a not-a-repo status with no branch facts', () => {
    const status = foldCheckoutStatus(nonGit())
    expect(status.isGit).toBe(false)
    expect(status.branch).toBeNull()
    expect(status.dirty).toBeNull()
    expect(status.errorCode).toBe('NOT_GIT_REPO')
  })

  test('daemon error payloads surface their code and message', () => {
    const status = foldCheckoutStatus(
      cleanBranch({
        error: { code: 'MERGE_CONFLICT', message: 'merge conflict while rebasing' },
      }),
    )
    expect(status.errorCode).toBe('MERGE_CONFLICT')
    expect(status.errorMessage).toBe('merge conflict while rebasing')
  })

  test('paseo-owned worktrees keep their main repo root and forced base ref', () => {
    const status = foldCheckoutStatus(
      cleanBranch({
        isPaseoOwnedWorktree: true,
        repoRoot: '/main/.worktrees/wt-1',
        mainRepoRoot: '/main',
        baseRef: 'main',
      }),
    )
    expect(status.isPaseoOwnedWorktree).toBe(true)
    expect(status.mainRepoRoot).toBe('/main')
    expect(status.repoRoot).toBe('/main/.worktrees/wt-1')
  })
})

describe('ahead/behind formatting', () => {
  test('shows both directions', () => {
    expect(formatAheadBehind(2, 1)).toBe('↑2 ↓1')
  })

  test('omits zero sides and hides entirely when level', () => {
    expect(formatAheadBehind(3, 0)).toBe('↑3')
    expect(formatAheadBehind(0, 4)).toBe('↓4')
    expect(formatAheadBehind(0, 0)).toBeNull()
    expect(formatAheadBehind(null, null)).toBeNull()
  })
})

describe('status store', () => {
  test('statusArrived files each workspace under its cwd', () => {
    const state = run([
      { type: 'statusArrived', payload: cleanBranch() },
      { type: 'statusArrived', payload: nonGit({ cwd: '/tmp/other' }) },
    ])
    expect(Object.keys(state.entries).sort()).toEqual(['/repo', '/tmp/other'])
    expect(state.entries['/repo']?.phase).toBe('ready')
    expect(state.entries['/repo']?.status?.branch).toBe('feature/spine')
    expect(state.entries['/tmp/other']?.status?.isGit).toBe(false)
  })

  test('pushes replace the entry for the same cwd in place', () => {
    let state = run([{ type: 'statusArrived', payload: cleanBranch() }])
    state = reduceCheckout(state, {
      type: 'statusArrived',
      payload: cleanBranch({ isDirty: true, aheadBehind: { ahead: 5, behind: 0 } }),
    })
    expect(state.entries['/repo']?.status?.dirty).toBe(true)
    expect(state.entries['/repo']?.status?.ahead).toBe(5)
    // No duplicate entries from repeated pushes.
    expect(Object.keys(state.entries)).toEqual(['/repo'])
  })

  test('fetchStarted marks an unknown workspace loading without clobbering known truth', () => {
    let state = run([{ type: 'statusArrived', payload: cleanBranch() }])
    state = reduceCheckout(state, { type: 'fetchStarted', cwd: '/repo' })
    state = reduceCheckout(state, { type: 'fetchStarted', cwd: '/fresh' })
    expect(state.entries['/repo']?.phase).toBe('ready')
    expect(state.entries['/fresh']).toEqual({ phase: 'loading', status: null })
  })

  test('fetchFailed marks the workspace failed but keeps its last-known status', () => {
    let state = run([
      { type: 'statusArrived', payload: cleanBranch() },
      { type: 'fetchStarted', cwd: '/repo' },
    ])
    state = reduceCheckout(state, { type: 'fetchFailed', cwd: '/repo' })
    expect(state.entries['/repo']?.phase).toBe('failed')
    expect(state.entries['/repo']?.status?.branch).toBe('feature/spine')

    // A workspace that never got truth just fails.
    state = reduceCheckout(state, { type: 'fetchStarted', cwd: '/gone' })
    state = reduceCheckout(state, { type: 'fetchFailed', cwd: '/gone' })
    expect(state.entries['/gone']).toEqual({ phase: 'failed', status: null })
  })

  test('reset clears every workspace', () => {
    const state = run([
      { type: 'statusArrived', payload: cleanBranch() },
      { type: 'reset' },
    ])
    expect(state.entries).toEqual({})
  })
})

describe('repository keying', () => {
  test('the repo root keys the action queue once known; cwd stands in before that', () => {
    expect(repoKeyOf(foldCheckoutStatus(cleanBranch()))).toBe('/repo')
    expect(repoKeyOf(foldCheckoutStatus(nonGit()))).toBe('/tmp/scratch')
    expect(repoKeyOf(foldCheckoutStatus(cleanBranch({ repoRoot: null })))).toBe('/repo')
  })
})

describe('capability gate', () => {
  test('the panel only opens when the daemon advertises the checkout flag', () => {
    expect(CHECKOUT_FEATURE_FLAG).toBe('checkoutRefresh')
    expect(checkoutEnabled({ [CHECKOUT_FEATURE_FLAG]: true })).toBe(true)
    expect(checkoutEnabled({ [CHECKOUT_FEATURE_FLAG]: false })).toBe(false)
    // A missing flag hides the panel rather than disabling it.
    expect(checkoutEnabled(undefined)).toBe(false)
    expect(checkoutEnabled({})).toBe(false)
  })
})
