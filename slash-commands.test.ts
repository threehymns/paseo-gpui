import { describe, expect, test } from 'bun:test'
import {
  LIST_COMMANDS_ATTEMPTS,
  SESSION_COMMANDS_TTL_MS,
  CommandCatalog,
  applySlashCommandReplacement,
  caretAfterReplacement,
  commandsCacheKey,
  commandsTarget,
  draftCommandsConfig,
  fetchCommands,
  filterAndRankCommands,
  filterInlineSkillCommands,
  findActiveSlashCommand,
  nextCaretAfterEdit,
  nextSelectedIndex,
  slashCommandMenuEntries,
  type DaemonCommandsSeam,
  type SlashCommand,
  type SlashCommandRange,
} from './slash-commands'

function cmd(name: string, description = `Run ${name}`, argumentHint = '', kind?: SlashCommand['kind']): SlashCommand {
  return { name, description, argumentHint, ...(kind ? { kind } : {}) }
}

const CATALOG: readonly SlashCommand[] = [
  cmd('help', 'Show help for the current session'),
  cmd('history', 'Summarize recent session history'),
  cmd('handoff', 'Prepare a handoff note for another agent', '[agent]'),
  cmd('heapdump', 'Dump the JavaScript heap'),
  cmd('health', 'Show runtime health checks'),
  cmd('hello', 'Insert a friendly greeting prompt'),
  cmd('hover', 'Audit hover behavior'),
  cmd('review-notes', 'List review notes'),
  cmd('footnote', 'Add a footnote'),
  cmd('tdd-done', 'Mark a TDD cycle done'),
  cmd('todo-done', 'Close a todo item'),
]

const names = (commands: readonly SlashCommand[]) => commands.map((command) => command.name)
const range = (overrides: Partial<SlashCommandRange>): SlashCommandRange => ({
  start: 0,
  end: 5,
  query: '',
  position: 'start',
  ...overrides,
})

describe('findActiveSlashCommand', () => {
  test('opens at line start and after whitespace mid-line', () => {
    expect(findActiveSlashCommand({ text: '/', cursorIndex: 1 })).toEqual({
      start: 0,
      end: 1,
      query: '',
      position: 'start',
    })
    expect(findActiveSlashCommand({ text: '/tdd', cursorIndex: 4 })).toMatchObject({ position: 'start', query: 'tdd' })
    expect(findActiveSlashCommand({ text: 'hey /tdd', cursorIndex: 8 })).toEqual({
      start: 4,
      end: 8,
      query: 'tdd',
      position: 'inline',
    })
  })

  test('never opens for a slash buried in a word', () => {
    expect(findActiveSlashCommand({ text: 'hey/tdd', cursorIndex: 7 })).toBeNull()
  })

  test('the query ends at whitespace, newline, tab, quote, or another slash', () => {
    expect(findActiveSlashCommand({ text: '/tdd now', cursorIndex: 8 })).toBeNull()
    expect(findActiveSlashCommand({ text: '/run\n/x', cursorIndex: 7 })).toMatchObject({ start: 5, query: 'x' })
    expect(findActiveSlashCommand({ text: '/x\ty', cursorIndex: 4 })).toBeNull()
    expect(findActiveSlashCommand({ text: 'say /x "y', cursorIndex: 9 })).toBeNull()
    expect(findActiveSlashCommand({ text: 'say /cmd', cursorIndex: 8 })).toMatchObject({
      start: 4,
      query: 'cmd',
      position: 'inline',
    })
    expect(findActiveSlashCommand({ text: '/a /b', cursorIndex: 5 })).toMatchObject({
      start: 3,
      query: 'b',
      position: 'inline',
    })
  })

  test('tracks the live caret inside the token', () => {
    expect(findActiveSlashCommand({ text: '/tdd now', cursorIndex: 3 })).toEqual({
      start: 0,
      end: 3,
      query: 'td',
      position: 'start',
    })
  })

  test('clamps an out-of-range caret and ignores plain text', () => {
    expect(findActiveSlashCommand({ text: '/td', cursorIndex: 99 })).toMatchObject({ query: 'td' })
    expect(findActiveSlashCommand({ text: 'no slash here', cursorIndex: 13 })).toBeNull()
  })
})

describe('filterAndRankCommands', () => {
  test('an empty query keeps every command in order', () => {
    expect(filterAndRankCommands(CATALOG, '')).toHaveLength(CATALOG.length)
    expect(names(filterAndRankCommands(CATALOG.slice(0, 3), ''))).toEqual(['help', 'history', 'handoff'])
  })

  test('exact beats prefix', () => {
    expect(names(filterAndRankCommands([cmd('help'), cmd('helper')], 'help'))).toEqual(['help', 'helper'])
  })

  test('whole word beats prefix', () => {
    expect(names(filterAndRankCommands([cmd('handoff'), cmd('fix-hand')], 'hand'))).toEqual(['fix-hand', 'handoff'])
  })

  test('word start beats substring', () => {
    expect(names(filterAndRankCommands([cmd('footnote'), cmd('review-notes')], 'note'))).toEqual([
      'review-notes',
      'footnote',
    ])
  })

  test('subsequence is the last resort; spread breaks ties before alphabet', () => {
    expect(names(filterAndRankCommands([cmd('history'), cmd('hover'), cmd('helper')], 'hr'))).toEqual([
      'hover',
      'helper',
      'history',
    ])
  })

  test('ties within a tier break alphabetically', () => {
    const hCommands = CATALOG.filter((command) => command.name.startsWith('h'))
    expect(names(filterAndRankCommands(hCommands, 'h'))).toEqual([
      'handoff',
      'health',
      'heapdump',
      'hello',
      'help',
      'history',
      'hover',
    ])
  })

  test('every whitespace-separated token must match', () => {
    expect(names(filterAndRankCommands([cmd('tdd-done'), cmd('todo-done')], 'td done'))).toEqual([
      'tdd-done',
      'todo-done',
    ])
    expect(names(filterAndRankCommands([cmd('tdd-done'), cmd('todo-done')], 'done zzz'))).toEqual([])
  })

  test('matching is case-insensitive', () => {
    expect(names(filterAndRankCommands([cmd('tdd-done'), cmd('todo-done')], 'TD Done'))).toEqual([
      'tdd-done',
      'todo-done',
    ])
  })

  test('there is no fuzzy matching', () => {
    expect(filterAndRankCommands(CATALOG, 'hepl')).toEqual([])
  })
})

describe('slashCommandMenuEntries', () => {
  const POOL: readonly SlashCommand[] = [
    cmd('explain'),
    cmd('review', 'Review changes', '', 'skill'),
    cmd('refactor', 'Refactor code', '', 'skill'),
    cmd('plan'),
  ]

  test('token-start menus draw from every command', () => {
    expect(names(slashCommandMenuEntries(POOL, range({ query: '' })))).toEqual(['explain', 'review', 'refactor', 'plan'])
  })

  test('inline menus offer daemon skills only, still ranked', () => {
    const inline = range({ start: 4, position: 'inline', query: 'e' })
    expect(names(slashCommandMenuEntries(POOL, inline))).toEqual(['refactor', 'review'])
  })
})

describe('nextSelectedIndex', () => {
  test('arrows wrap around in both directions', () => {
    expect(nextSelectedIndex(0, 3, 'up')).toBe(2)
    expect(nextSelectedIndex(2, 3, 'down')).toBe(0)
    expect(nextSelectedIndex(1, 3, 'down')).toBe(2)
  })

  test('an unset highlight enters from the edge the arrow points at', () => {
    expect(nextSelectedIndex(-1, 3, 'down')).toBe(0)
    expect(nextSelectedIndex(-1, 3, 'up')).toBe(2)
    expect(nextSelectedIndex(-1, 0, 'up')).toBe(-1)
  })
})

describe('applySlashCommandReplacement', () => {
  test('at end of text the insert gains one trailing space', () => {
    expect(applySlashCommandReplacement({ text: '/td', range: range({ end: 3 }), commandName: 'tdd-done' })).toBe(
      '/tdd-done ',
    )
  })

  test('mid-line replacements keep the surrounding words as they are', () => {
    const mid = range({ start: 3, end: 6, query: 'td', position: 'inline' })
    expect(
      applySlashCommandReplacement({ text: 'go /td now', range: mid, commandName: 'tdd-done' }),
    ).toBe('go /tdd-done now')
  })
})

describe('caretAfterReplacement', () => {
  test('lands after the trailing space at end of text', () => {
    expect(caretAfterReplacement(range({ end: 3 }), 3, 'tdd-done'.length)).toBe('/tdd-done '.length)
  })

  test('lands right after the inserted name mid-line', () => {
    const mid = range({ start: 3, end: 6 })
    expect(caretAfterReplacement(mid, 10, 'tdd-done'.length)).toBe(3 + 1 + 'tdd-done'.length)
  })
})

describe('nextCaretAfterEdit', () => {
  test('edits at the end of the text stay at the end', () => {
    expect(nextCaretAfterEdit('/td', '/tdd', 3)).toBe(4)
    expect(nextCaretAfterEdit('/tdd', '/td', 4)).toBe(3)
  })

  test('mid-text edits hold the caret position, clamped', () => {
    expect(nextCaretAfterEdit('go /td now', 'go /txd now', 6)).toBe(6)
    expect(nextCaretAfterEdit('short', 'r', 5)).toBe(1)
  })

  test('an out-of-range caret clamps to zero for empty text', () => {
    expect(nextCaretAfterEdit('/td', '', -2)).toBe(0)
  })
})

describe('draftCommandsConfig', () => {
  test('splits the chip value into provider and model', () => {
    expect(
      draftCommandsConfig({ modelValue: 'anthropic/claude-x', thinkingId: 'high', modeId: 'plan', cwd: '/repo' }),
    ).toEqual({
      provider: 'anthropic',
      cwd: '/repo',
      modeId: 'plan',
      model: 'claude-x',
      thinkingOptionId: 'high',
    })
  })

  test('omits unset fields', () => {
    expect(draftCommandsConfig({ modelValue: 'anthropic/claude-x', thinkingId: null, modeId: null, cwd: '/repo' })).toEqual({
      provider: 'anthropic',
      cwd: '/repo',
      model: 'claude-x',
    })
  })

  test('is null while there is nothing resolvable to ask about', () => {
    expect(draftCommandsConfig(null)).toBeNull()
    expect(draftCommandsConfig({ modelValue: '', thinkingId: null, modeId: null, cwd: '/repo' })).toBeNull()
    expect(draftCommandsConfig({ modelValue: 'anthropic/x', thinkingId: null, modeId: null, cwd: '   ' })).toBeNull()
  })
})

describe('commandsTarget and cache keys', () => {
  test('an active agent asks by id; a new agent asks with the draft config', () => {
    expect(commandsTarget('agent-1', null)).toEqual({ agentId: 'agent-1' })
    expect(commandsTarget(null, { modelValue: 'p/m', thinkingId: null, modeId: null, cwd: '/r' })).toEqual({
      agentId: '',
      draft: { provider: 'p', cwd: '/r', model: 'm' },
    })
    expect(commandsTarget(null, { modelValue: '', thinkingId: null, modeId: null, cwd: '/r' })).toBeNull()
  })

  test('cache keys separate sessions from drafts and follow draft fields', () => {
    expect(commandsCacheKey({ agentId: 'agent-1' })).toBe('session:agent-1')
    const base = commandsTarget(null, { modelValue: 'p/m', thinkingId: 'hi', modeId: 'plan', cwd: '/r' })!
    expect(commandsCacheKey(base)).toBe('draft:p|/r|plan|m|hi')
    expect(commandsCacheKey(base)).toBe(commandsCacheKey({ agentId: '', draft: base.draft }))
    expect(commandsCacheKey({ ...base, draft: { ...base.draft!, model: 'other' } })).not.toBe(commandsCacheKey(base))
  })
})

function seamOf(handler: () => Promise<{ commands?: SlashCommand[]; error?: string | null }>): DaemonCommandsSeam & { calls: number } {
  const seam = {
    calls: 0,
    async listCommands() {
      seam.calls += 1
      const response = await handler()
      return { commands: response.commands ?? [], ...(response.error ? { error: response.error } : {}) }
    },
  }
  return seam
}

describe('fetchCommands retries', () => {
  test('retries until the daemon answers', async () => {
    let attempts = 0
    const seam = seamOf(() => {
      attempts += 1
      if (attempts < 3) throw new Error('daemon busy')
      return Promise.resolve({ commands: [cmd('ok')] })
    })
    const commands = await fetchCommands(seam, { agentId: 'a' }, { delayMs: () => 0 })
    expect(seam.calls).toBe(3)
    expect(names(commands)).toEqual(['ok'])
  })

  test('gives up after the full attempt budget and rethrows', async () => {
    const seam = seamOf(() => Promise.reject(new Error('daemon down')))
    await expect(fetchCommands(seam, { agentId: 'a' }, { delayMs: () => 0 })).rejects.toThrow('daemon down')
    expect(seam.calls).toBe(LIST_COMMANDS_ATTEMPTS)
  })

  test('a daemon-reported error counts as a failure', async () => {
    const seam = seamOf(() => Promise.resolve({ commands: [], error: 'provider offline' }))
    await expect(fetchCommands(seam, { agentId: 'a' }, { delayMs: () => 0 })).rejects.toThrow('provider offline')
    expect(seam.calls).toBe(LIST_COMMANDS_ATTEMPTS)
  })

  test('normalizes entries and drops unnamed ones', async () => {
    const seam = seamOf(() =>
      Promise.resolve({
        commands: [
          { name: 'keep', description: 'Kept', argumentHint: '[x]' },
          { name: '', description: 'Nameless', argumentHint: '' },
          { name: 'kinded', description: 'K', argumentHint: '', kind: 'skill' as const },
        ],
      }),
    )
    expect(await fetchCommands(seam, { agentId: 'a' }, { delayMs: () => 0 })).toEqual([
      { name: 'keep', description: 'Kept', argumentHint: '[x]', kind: undefined },
      { name: 'kinded', description: 'K', argumentHint: '', kind: 'skill' },
    ])
  })
})

describe('CommandCatalog caching', () => {
  test('session results cache for sixty seconds, then refetch', async () => {
    const seam = seamOf(() => Promise.resolve({ commands: [cmd('fresh')] }))
    const catalog = new CommandCatalog(seam)
    const target = { agentId: 'agent-1' }
    const t0 = 1_000_000

    await catalog.list(target, t0)
    await catalog.list(target, t0 + SESSION_COMMANDS_TTL_MS - 1)
    expect(seam.calls).toBe(1)

    await catalog.list(target, t0 + SESSION_COMMANDS_TTL_MS)
    expect(seam.calls).toBe(2)
  })

  test('draft results never expire but follow their config', async () => {
    const seam = seamOf(() => Promise.resolve({ commands: [cmd('draft-cmd')] }))
    const catalog = new CommandCatalog(seam)
    const draft = { modelValue: 'p/m', thinkingId: null, modeId: null, cwd: '/r' }
    const target = commandsTarget(null, draft)!
    const later = commandsTarget(null, { ...draft, modelValue: 'p/other' })!

    await catalog.list(target, 0)
    await catalog.list(target, 10 * 60_000)
    expect(seam.calls).toBe(1)

    await catalog.list(later, 10 * 60_000)
    expect(seam.calls).toBe(2)
  })

  test('sessions cache independently of each other', async () => {
    const seam = seamOf(() => Promise.resolve({ commands: [] }))
    const catalog = new CommandCatalog(seam)
    const t0 = 0
    await catalog.list({ agentId: 'a' }, t0)
    await catalog.list({ agentId: 'b' }, t0)
    expect(seam.calls).toBe(2)
  })
})
