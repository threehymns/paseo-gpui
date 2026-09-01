import {
  BASE_COLORS,
  C,
  CHAT_THEME,
  DARK_SEMANTIC,
  DARK_SYNTAX,
  DARK_TINT,
  buildDarkSemanticColors,
  type DarkThemeConfig,
} from './theme'

// Golden snapshot: the shipped palette as of before semantic-token expansion.
// These literals are the independent source of truth for the byte-identical
// guarantee; if any value here changes, the visual output has changed.
const LEGACY_GOLDEN = {
  canvas: '#1A1A1A',
  sidebar: '#181818',
  raised: '#232323',
  composer: '#212121',
  overlay: '#E6EAF20D',
  overlayStrong: '#E6EAF217',
  item: '#F0F0F00F',
  border: '#E6EAF212',
  borderStrong: '#E6EAF224',
  sidebarBorder: '#292929',
  text: '#E2E2E2',
  secondary: '#A3A3A3',
  tertiary: '#7D7D7D',
  ghost: '#575757',
  accent: '#E2795B',
  inverse: '#E7E9EC',
  onInverse: '#17181C',
  codeText: '#E0A882',
  ok: '#58B368',
  running: '#4C8DF6',
  warn: '#D9A050',
  danger: '#E5484D',
  dangerWash: '#E5484D14',
  dangerBorder: '#E5484D30',
}

const CHAT_THEME_GOLDEN = {
  text: '#E2E2E2',
  textMuted: '#A3A3A3',
  textFaint: '#7D7D7D',
  textDim: '#A3A3A3',
  border: '#E6EAF212',
  bg: '#1A1A1A',
  accent: '#E2795B',
  caret: '#E2795B',
  fontSans: '.SystemUIFont',
  codeText: '#E0A882',
  codeWash: '#E6EAF214',
  metrics: {
    mdTextSize: 14,
    mdLineHeight: 22,
    mdBlockGap: 14,
    mdHeadingSizes: [20, 16, 14, 14],
    mdHeadingLineHeights: [28, 24, 22, 22],
    codeTextSize: 12.5,
    codeLineHeight: 20,
    codeRadius: 10,
    codeHeaderTextSize: 12,
    diffLineHeight: 20,
    diffFileHeaderHeight: 34,
  },
}

describe('legacy palette', () => {
  test('every color keeps its shipped value', () => {
    expect(C).toEqual(LEGACY_GOLDEN)
  })
})

describe('chat renderer theme', () => {
  test('keeps its shipped colors and metrics', () => {
    expect(CHAT_THEME).toEqual(CHAT_THEME_GOLDEN)
  })
})

// Derivation seam: the builder must compute every token from its tint input.
// Expected values are independent literals, and each test perturbs an input to
// prove the output moves with it — a hand-copied hex between layers would
// freeze the output and fail these.
describe('buildDarkSemanticColors', () => {
  const TINT: DarkThemeConfig = {
    surface0: '#1A1A1A',
    surface1: '#212121',
    surface2: '#232323',
    surface3: '#2C2C2C',
    surface4: '#404040',
    surfaceDiffEmpty: '#232323',
    surfaceSidebar: '#181818',
    foreground: '#E2E2E2',
    foregroundMuted: '#A3A3A3',
    foregroundExtraMuted: '#7D7D7D',
    foregroundFaint: '#575757',
    border: '#E6EAF212',
    borderAccent: '#E6EAF224',
    borderSidebar: '#292929',
    accent: '#E2795B',
    primary: '#E7E9EC',
    primaryForeground: '#17181C',
    destructive: '#E5484D',
    interactionOverlay: '#E6EAF20D',
    interactionOverlayStrong: '#E6EAF217',
    interactionItem: '#F0F0F00F',
    codeText: '#E0A882',
    codeWash: '#E6EAF214',
  }
  const derive = (overrides: Partial<DarkThemeConfig>) =>
    buildDarkSemanticColors({ ...TINT, ...overrides })

  test('base colors are six-digit hex', () => {
    for (const value of Object.values(BASE_COLORS)) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  test('surfaces pass through and sidebar states follow surface1/surface2', () => {
    const s = derive({ surface1: '#010101', surface2: '#020202' })
    expect(s.surface0).toBe(TINT.surface0)
    expect(s.surfaceSidebarHover).toBe('#010101')
    expect(s.surfaceSidebarSelected).toBe('#020202')
    expect(s.background).toBe(s.surface0)
  })

  test('foreground ramp passes through', () => {
    const s = derive({
      foreground: '#111111',
      foregroundMuted: '#222222',
      foregroundExtraMuted: '#333333',
      foregroundFaint: '#444444',
    })
    expect(s.foreground).toBe('#111111')
    expect(s.foregroundMuted).toBe('#222222')
    expect(s.foregroundExtraMuted).toBe('#333333')
    expect(s.foregroundFaint).toBe('#444444')
  })

  test('borders pass through', () => {
    const s = derive({ border: '#AAAAAA01', borderAccent: '#BBBBBB02', borderSidebar: '#CCCCCC' })
    expect(s.border).toBe('#AAAAAA01')
    expect(s.borderAccent).toBe('#BBBBBB02')
    expect(s.borderSidebar).toBe('#CCCCCC')
  })

  test('accent drives ring and bright falls back to accent when untinted', () => {
    expect(derive({}).accentBright).toBe(TINT.accent)
    expect(derive({ accentBright: '#ABCDEF' }).accentBright).toBe('#ABCDEF')
    expect(derive({ accent: '#123456' }).ring).toBe('#123456')
  })

  test('destructive washes compose from destructive instead of copying hex', () => {
    const s = derive({ destructive: '#123456' })
    expect(s.destructiveWash).toBe('#12345614')
    expect(s.destructiveBorder).toBe('#12345630')
  })

  test('primary pair passes through', () => {
    const s = derive({ primary: '#FAFAFA', primaryForeground: '#050505' })
    expect(s.primary).toBe('#FAFAFA')
    expect(s.primaryForeground).toBe('#050505')
  })

  test('interaction washes pass through', () => {
    const s = derive({
      interactionOverlay: '#01020304',
      interactionOverlayStrong: '#05060708',
      interactionItem: '#090A0B0C',
    })
    expect(s.interactionOverlay).toBe('#01020304')
    expect(s.interactionOverlayStrong).toBe('#05060708')
    expect(s.interactionItem).toBe('#090A0B0C')
  })

  test('code tokens pass through', () => {
    const s = derive({ codeText: '#D0B090', codeWash: '#11223344' })
    expect(s.codeText).toBe('#D0B090')
    expect(s.codeWash).toBe('#11223344')
  })

  test('terminal band follows tint surfaces, ramp, and status hues', () => {
    const s = derive({
      surface0: '#0A0A0A',
      surfaceSidebar: '#0B0B0B',
      foreground: '#EEEEEE',
      foregroundFaint: '#666666',
    })
    expect(s.terminal.background).toBe('#0A0A0A')
    expect(s.terminal.foreground).toBe('#EEEEEE')
    expect(s.terminal.cursor).toBe('#EEEEEE')
    expect(s.terminal.cursorAccent).toBe('#0A0A0A')
    expect(s.terminal.selectionForeground).toBe('#EEEEEE')
    expect(s.terminal.black).toBe('#0B0B0B')
    expect(s.terminal.brightBlack).toBe('#666666')
    expect(s.terminal.white).toBe('#EEEEEE')
  })
})

// Production tokens: the real tint must reproduce every shipped color with
// identical values. Expected values are the shipped literals, not recomputed.
describe('dark semantic tokens', () => {
  test('tint assembles from base scales without new hex', () => {
    const bases = new Set(Object.values(BASE_COLORS))
    for (const value of Object.values(DARK_TINT)) {
      if (/^#[0-9A-F]{6}$/.test(value)) expect(bases.has(value as never)).toBe(true)
      else expect(bases.has(value.slice(0, 7) as never)).toBe(true)
    }
  })

  test('surfaces and background match the shipped chrome', () => {
    expect(DARK_SEMANTIC.background).toBe('#1A1A1A')
    expect(DARK_SEMANTIC.surfaceSidebar).toBe('#181818')
    expect(DARK_SEMANTIC.surface1).toBe('#212121')
    expect(DARK_SEMANTIC.surface2).toBe('#232323')
    expect(DARK_SEMANTIC.surfaceSidebarSelected).toBe('#232323')
  })

  test('foreground ramp matches the shipped text tiers', () => {
    expect(DARK_SEMANTIC.foreground).toBe('#E2E2E2')
    expect(DARK_SEMANTIC.foregroundMuted).toBe('#A3A3A3')
    expect(DARK_SEMANTIC.foregroundExtraMuted).toBe('#7D7D7D')
    expect(DARK_SEMANTIC.foregroundFaint).toBe('#575757')
  })

  test('borders and interaction washes compose their alpha channels', () => {
    expect(DARK_SEMANTIC.border).toBe('#E6EAF212')
    expect(DARK_SEMANTIC.borderAccent).toBe('#E6EAF224')
    expect(DARK_SEMANTIC.borderSidebar).toBe('#292929')
    expect(DARK_SEMANTIC.interactionOverlay).toBe('#E6EAF20D')
    expect(DARK_SEMANTIC.interactionOverlayStrong).toBe('#E6EAF217')
    expect(DARK_SEMANTIC.interactionItem).toBe('#F0F0F00F')
    expect(DARK_SEMANTIC.codeWash).toBe('#E6EAF214')
  })

  test('accent, primary pair, code tone, and destructive washes match', () => {
    expect(DARK_SEMANTIC.accent).toBe('#E2795B')
    expect(DARK_SEMANTIC.primary).toBe('#E7E9EC')
    expect(DARK_SEMANTIC.primaryForeground).toBe('#17181C')
    expect(DARK_SEMANTIC.codeText).toBe('#E0A882')
    expect(DARK_SEMANTIC.destructive).toBe('#E5484D')
    expect(DARK_SEMANTIC.destructiveWash).toBe('#E5484D14')
    expect(DARK_SEMANTIC.destructiveBorder).toBe('#E5484D30')
  })

  test('status band carries the four shipped signals', () => {
    expect(DARK_SEMANTIC.statusSuccess).toBe('#58B368')
    expect(DARK_SEMANTIC.statusDanger).toBe('#E5484D')
    expect(DARK_SEMANTIC.statusWarning).toBe('#D9A050')
    expect(DARK_SEMANTIC.statusRunning).toBe('#4C8DF6')
    expect(DARK_SEMANTIC.diffAddition).toBe('#58B368')
    expect(DARK_SEMANTIC.diffDeletion).toBe('#E5484D')
  })

  test('terminal band anchors to status hues and surfaces', () => {
    expect(DARK_SEMANTIC.terminal.red).toBe('#E5484D')
    expect(DARK_SEMANTIC.terminal.green).toBe('#58B368')
    expect(DARK_SEMANTIC.terminal.yellow).toBe('#D9A050')
    expect(DARK_SEMANTIC.terminal.blue).toBe('#4C8DF6')
    expect(DARK_SEMANTIC.terminal.black).toBe('#181818')
    expect(DARK_SEMANTIC.terminal.brightBlack).toBe('#575757')
    expect(DARK_SEMANTIC.terminal.white).toBe('#E2E2E2')
    expect(DARK_SEMANTIC.terminal.brightWhite).toBe('#E7E9EC')
  })

  test('syntax palette placeholders derive from anchored tokens', () => {
    for (const value of Object.values(DARK_SYNTAX)) {
      expect(value).toMatch(/^#[0-9A-F]{6}$/)
      expect(Object.values(BASE_COLORS)).toContain(value)
    }
  })
})

// Adapter seams: the legacy palette must be a thin alias onto the tokens and
// the renderer theme must derive from them — no third source of values.
describe('legacy palette aliasing', () => {
  test('every legacy key reads a semantic token', () => {
    const aliases = {
      canvas: DARK_SEMANTIC.background,
      sidebar: DARK_SEMANTIC.surfaceSidebar,
      raised: DARK_SEMANTIC.surface2,
      composer: DARK_SEMANTIC.surface1,
      overlay: DARK_SEMANTIC.interactionOverlay,
      overlayStrong: DARK_SEMANTIC.interactionOverlayStrong,
      item: DARK_SEMANTIC.interactionItem,
      border: DARK_SEMANTIC.border,
      borderStrong: DARK_SEMANTIC.borderAccent,
      sidebarBorder: DARK_SEMANTIC.borderSidebar,
      text: DARK_SEMANTIC.foreground,
      secondary: DARK_SEMANTIC.foregroundMuted,
      tertiary: DARK_SEMANTIC.foregroundExtraMuted,
      ghost: DARK_SEMANTIC.foregroundFaint,
      accent: DARK_SEMANTIC.accent,
      inverse: DARK_SEMANTIC.primary,
      onInverse: DARK_SEMANTIC.primaryForeground,
      codeText: DARK_SEMANTIC.codeText,
      ok: DARK_SEMANTIC.statusSuccess,
      running: DARK_SEMANTIC.statusRunning,
      warn: DARK_SEMANTIC.statusWarning,
      danger: DARK_SEMANTIC.destructive,
      dangerWash: DARK_SEMANTIC.destructiveWash,
      dangerBorder: DARK_SEMANTIC.destructiveBorder,
    } as const
    expect(Object.keys(C).sort()).toEqual(Object.keys(aliases).sort())
    expect(C).toEqual(aliases)
  })
})

describe('renderer theme derivation', () => {
  test('colors come from the semantic tokens', () => {
    expect(CHAT_THEME.text).toBe(DARK_SEMANTIC.foreground)
    expect(CHAT_THEME.textMuted).toBe(DARK_SEMANTIC.foregroundMuted)
    expect(CHAT_THEME.textDim).toBe(DARK_SEMANTIC.foregroundMuted)
    expect(CHAT_THEME.textFaint).toBe(DARK_SEMANTIC.foregroundExtraMuted)
    expect(CHAT_THEME.border).toBe(DARK_SEMANTIC.border)
    expect(CHAT_THEME.bg).toBe(DARK_SEMANTIC.background)
    expect(CHAT_THEME.accent).toBe(DARK_SEMANTIC.accent)
    expect(CHAT_THEME.caret).toBe(DARK_SEMANTIC.accent)
    expect(CHAT_THEME.codeText).toBe(DARK_SEMANTIC.codeText)
    expect(CHAT_THEME.codeWash).toBe(DARK_SEMANTIC.codeWash)
  })
})
