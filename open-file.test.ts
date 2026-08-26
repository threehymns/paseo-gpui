import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'bun:test'
import { nativeOpenFileBridge, requestOpenFile, resolveWorkspaceFile, type OpenFileBridge } from './open-file'

const ROOT = '/repo'

/** Fake filesystem: only these paths are existing regular files. */
const filesOf = (...paths: string[]) => (path: string) => paths.includes(path)

describe('the open-file seam', () => {
  test('no native bridge exists today, and the stub says so', () => {
    expect(nativeOpenFileBridge()).toBeNull()
  })

  test('a request without a bridge degrades to a visible unavailable notice', async () => {
    const outcome = await requestOpenFile(null, '/repo/src/app.ts')
    expect(outcome.status).toBe('unavailable')
    if (outcome.status === 'unavailable') {
      expect(outcome.notice).toContain('native')
      expect(outcome.notice.length).toBeGreaterThan(0)
    }
  })

  test('a request through a bridge opens and reports success', async () => {
    const opened: string[] = []
    const bridge: OpenFileBridge = { open: async (p) => void opened.push(p) }
    const outcome = await requestOpenFile(bridge, '/repo/src/app.ts')
    expect(opened).toEqual(['/repo/src/app.ts'])
    expect(outcome.status).toBe('opened')
  })

  test('a rejecting bridge reports failure with the error message, never throws', async () => {
    const bridge: OpenFileBridge = {
      open: async () => {
        throw new Error('no handler for .zzz')
      },
    }
    const outcome = await requestOpenFile(bridge, '/repo/x.zzz')
    expect(outcome).toEqual({ status: 'failed', message: 'no handler for .zzz' })
  })
})

describe('workspace file resolution', () => {
  test('a workspace-relative path resolving to an existing file resolves', () => {
    const exists = filesOf('/repo/src/app.ts')
    expect(resolveWorkspaceFile(ROOT, 'src/app.ts', exists)).toEqual({
      kind: 'file',
      label: 'src/app.ts',
      absolutePath: '/repo/src/app.ts',
    })
  })

  test('an absolute path inside the workspace resolving to an existing file resolves', () => {
    const exists = filesOf('/repo/src/app.ts')
    expect(resolveWorkspaceFile(ROOT, '/repo/src/app.ts', exists)).toEqual({
      kind: 'file',
      label: '/repo/src/app.ts',
      absolutePath: '/repo/src/app.ts',
    })
  })

  test('a root with a trailing slash still contains its files', () => {
    const exists = filesOf('/repo/README.md')
    expect(resolveWorkspaceFile('/repo/', 'README.md', exists)).toMatchObject({ kind: 'file' })
  })

  test('an explicit ./ prefix resolves like its bare form', () => {
    const exists = filesOf('/repo/README.md')
    expect(resolveWorkspaceFile(ROOT, './README.md', exists)).toMatchObject({ kind: 'file' })
  })

  test('inner traversal that stays inside the workspace still resolves', () => {
    const exists = filesOf('/repo/package.json')
    expect(resolveWorkspaceFile(ROOT, 'src/../package.json', exists)).toEqual({
      kind: 'file',
      label: 'src/../package.json',
      absolutePath: '/repo/package.json',
    })
  })

  test('traversal escaping the workspace never resolves', () => {
    const exists = filesOf('/etc/passwd')
    expect(resolveWorkspaceFile(ROOT, '../../etc/passwd', exists)).toEqual({ kind: 'plain' })
    expect(resolveWorkspaceFile(ROOT, '../outside.ts', filesOf('/outside.ts'))).toEqual({ kind: 'plain' })
  })

  test('an absolute path outside the workspace never resolves even when it exists', () => {
    const exists = filesOf('/etc/passwd')
    expect(resolveWorkspaceFile(ROOT, '/etc/passwd', exists)).toEqual({ kind: 'plain' })
  })

  test('a path that does not exist renders plain', () => {
    expect(resolveWorkspaceFile(ROOT, 'src/missing.ts', filesOf())).toEqual({ kind: 'plain' })
  })

  test('a path the existence check rejects renders plain', () => {
    expect(resolveWorkspaceFile(ROOT, 'src', () => false)).toEqual({ kind: 'plain' })
  })

  test('the default existence check treats directories as non-files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'gpuix-open-file-'))
    mkdirSync(path.join(root, 'sub'))
    expect(resolveWorkspaceFile(root, 'sub')).toEqual({ kind: 'plain' })
    expect(resolveWorkspaceFile(root, '.')).toEqual({ kind: 'plain' })
  })

  test('URLs and tilde paths are not workspace paths and render plain', () => {
    const exists = filesOf('/repo/http:', '/repo/~x.ts')
    expect(resolveWorkspaceFile(ROOT, 'https://example.com/x.ts', exists)).toEqual({ kind: 'plain' })
    expect(resolveWorkspaceFile(ROOT, 'http://example.com', exists)).toEqual({ kind: 'plain' })
    expect(resolveWorkspaceFile(ROOT, 'file:///etc/passwd', exists)).toEqual({ kind: 'plain' })
    expect(resolveWorkspaceFile(ROOT, '~/notes.md', exists)).toEqual({ kind: 'plain' })
  })

  test('blank code spans render plain', () => {
    expect(resolveWorkspaceFile(ROOT, '', filesOf('/repo/x'))).toEqual({ kind: 'plain' })
    expect(resolveWorkspaceFile(ROOT, '   ', filesOf('/repo/x'))).toEqual({ kind: 'plain' })
  })

  test('the default existence check probes the real filesystem', () => {
    // A file that certainly exists next to this test, resolved against this
    // repo root; and one that certainly does not.
    expect(resolveWorkspaceFile(import.meta.dir, 'package.json')).toMatchObject({
      kind: 'file',
      absolutePath: `${import.meta.dir}/package.json`,
    })
    expect(resolveWorkspaceFile(import.meta.dir, 'no/such/file.zzz')).toEqual({ kind: 'plain' })
  })
})
