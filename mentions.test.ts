import { describe, expect, test } from 'bun:test'
import {
  findMentionToken,
  insertMention,
  mentionTargetPath,
  rankMentions,
  toMentionEntries,
} from './mentions'

describe('insertMention', () => {
  test('file mention replaces the token and leaves a space to keep typing', () => {
    const token = findMentionToken('look at @src')!
    expect(insertMention('look at @src', token, { path: 'src/app.ts', kind: 'file' })).toBe(
      'look at @src/app.ts ',
    )
  })

  test('directory mention keeps its trailing slash', () => {
    const token = findMentionToken('@comp')!
    expect(insertMention('@comp', token, { path: 'src/components', kind: 'directory' })).toBe(
      '@src/components/ ',
    )
  })

  test('text before the token survives byte-for-byte so pending echoes stay exact', () => {
    const draft = 'refactor @ut'
    const token = findMentionToken(draft)!
    expect(insertMention(draft, token, { path: 'tests/utils.ts', kind: 'file' }).startsWith('refactor ')).toBe(true)
  })
})

describe('mentionTargetPath', () => {
  test('paths under the workspace become relative', () => {
    expect(mentionTargetPath('/repo/src/app.ts', '/repo')).toBe('src/app.ts')
  })

  test('paths elsewhere lose their leading slash and resolve against the cwd', () => {
    expect(mentionTargetPath('/etc/hosts', '/repo')).toBe('etc/hosts')
  })

  test('already-relative paths pass through', () => {
    expect(mentionTargetPath('src/app.ts', '/repo')).toBe('src/app.ts')
  })
})

describe('rankMentions', () => {
  const files = (paths: string[]) => paths.map((path) => ({ path, kind: 'file' as const }))
  const dirs = (paths: string[]) => paths.map((path) => ({ path, kind: 'directory' as const }))

  test('empty query keeps everything: directories first, then files, alphabetical', () => {
    const ranked = rankMentions([...files(['b.ts', 'a.ts']), ...dirs(['zeta', 'alpha'])], '')
    expect(ranked.map((entry) => entry.path)).toEqual(['alpha', 'zeta', 'a.ts', 'b.ts'])
  })

  test('no matches yields an empty list', () => {
    expect(rankMentions(files(['src/app.ts', 'readme.md']), 'zzz-nothing')).toEqual([])
  })

  test('a directory and file matching equally rank directory first', () => {
    const ranked = rankMentions([files(['src']), ...dirs(['src'])].flat(), 'src')
    expect(ranked[0]).toEqual({ path: 'src', kind: 'directory' })
    expect(ranked[1]).toEqual({ path: 'src', kind: 'file' })
  })

  test('basename matches outrank deeper path matches', () => {
    const ranked = rankMentions(files(['pkg/src-utils/map.ts', 'src.ts']), 'src')
    expect(ranked.map((entry) => entry.path)).toEqual(['src.ts', 'pkg/src-utils/map.ts'])
  })

  test('prefix beats substring, substring beats fuzzy subsequence', () => {
    const ranked = rankMentions(files(['s-r-c.txt', 'asrcb.md', 'src.md']), 'src')
    expect(ranked.map((entry) => entry.path)).toEqual(['src.md', 'asrcb.md', 's-r-c.txt'])
  })

  test('matching is case-insensitive', () => {
    expect(rankMentions(files(['README.md']), 'read')).toHaveLength(1)
  })

  test('segment starts beat plain inclusion', () => {
    const ranked = rankMentions(files(['x/src/y.ts', 'asrc.md']), 'src')
    expect(ranked[0]?.path).toBe('x/src/y.ts')
    expect(ranked[1]?.path).toBe('asrc.md')
  })
})

describe('toMentionEntries', () => {
  const payload = (entries: unknown, directories: string[] = [], error: string | null = null) => ({
    entries,
    directories,
    error,
    requestId: 'r1',
  })

  test('typed entries win and become workspace-relative', () => {
    expect(
      toMentionEntries(
        payload(
          [
            { path: '/repo/src/app.ts', kind: 'file' },
            { path: '/repo/src/lib', kind: 'directory' },
          ],
          ['ignored-because-entries-present'],
        ),
        '/repo',
      ),
    ).toEqual([
      { path: 'src/app.ts', kind: 'file' },
      { path: 'src/lib', kind: 'directory' },
    ])
  })

  test('without typed entries the directory strings stand in', () => {
    expect(toMentionEntries(payload([], ['/repo/a', '/repo/b/c']), '/repo')).toEqual([
      { path: 'a', kind: 'directory' },
      { path: 'b/c', kind: 'directory' },
    ])
  })

  test('a daemon error degrades to no suggestions', () => {
    expect(toMentionEntries(payload(null, [], 'permission denied'), '/repo')).toEqual([])
  })
})

describe('findMentionToken', () => {
  test('bare @ at start opens with an empty query', () => {
    expect(findMentionToken('@')).toEqual({ query: '', start: 0 })
  })

  test('@ after whitespace triggers; text before it stays untouched', () => {
    expect(findMentionToken('fix the @src')).toEqual({ query: 'src', start: 8 })
  })

  test('typing narrows the live query', () => {
    expect(findMentionToken('@compo')).toEqual({ query: 'compo', start: 0 })
  })

  test('no @ means no token', () => {
    expect(findMentionToken('')).toBeNull()
    expect(findMentionToken('just text')).toBeNull()
  })

  test('@ mid-word does not trigger', () => {
    expect(findMentionToken('mail me user@example.com')).toBeNull()
  })

  test('@ followed by whitespace is inert', () => {
    expect(findMentionToken('@ done')).toBeNull()
  })

  test('only the last word can be an active token', () => {
    expect(findMentionToken('@old @new')).toEqual({ query: 'new', start: 5 })
  })

  test('query may contain path slashes and dots', () => {
    expect(findMentionToken('@src/comp.tsx')).toEqual({ query: 'src/comp.tsx', start: 0 })
  })
})
