/**
 * Shared palette, layout metrics, and renderer theme for the GPUIX chat UI.
 *
 * Chrome and layout follow https://github.com/egoist/waku: graphite surfaces,
 * transparent titlebar clearance for macOS traffic lights, composer chips.
 *
 * Color flows one way: BASE_COLORS (the only place raw hex lives) → a tint →
 * buildDarkSemanticColors (semantic tokens shaped like upstream paseo's
 * styles/theme.ts) → adapters. The legacy flat palette `C` aliases onto the
 * tokens until consumers migrate; CHAT_THEME derives from them.
 */

// ---------------------------------------------------------------------------
// Base scales — every raw color value appears here and nowhere else.
// ---------------------------------------------------------------------------

export const BASE_COLORS = {
  // Graphite ramp, darkest first (waku chrome surfaces through text).
  graphite950: '#181818',
  graphite900: '#1A1A1A',
  graphite850: '#212121',
  graphite800: '#232323',
  graphite750: '#292929',
  graphite700: '#2C2C2C',
  graphite600: '#404040',
  graphite500: '#575757',
  graphite400: '#7D7D7D',
  graphite300: '#A3A3A3',
  graphite100: '#E2E2E2',

  // Wash bases: cool white tints borders/hover overlays, soft white the item wash.
  coolWhite: '#E6EAF2',
  softWhite: '#F0F0F0',

  // Inverse pair (primary badges).
  inverse: '#E7E9EC',
  onInverse: '#17181C',

  // Accent and inline-code warm tone.
  accent: '#E2795B',
  codeText: '#E0A882',

  // Status anchors: success / working / caution / failure.
  success: '#58B368',
  running: '#4C8DF6',
  warning: '#D9A050',
  danger: '#E5484D',
} as const

/** Append an alpha byte to `#RRGGBB`, producing the renderer's `#RRGGBBAA`. */
function withAlpha(hex: string, alpha: number): string {
  return hex + alpha.toString(16).padStart(2, '0').toUpperCase()
}

// ---------------------------------------------------------------------------
// Semantic tokens — same shape as upstream paseo packages/app styles/theme.ts,
// dark scheme: surfaces 0–4, foreground ramp, border/accent/primary/
// destructive, status band, diff colors, terminal ANSI.
// ---------------------------------------------------------------------------

export interface DarkThemeConfig {
  surface0: string
  surface1: string
  surface2: string
  surface3: string
  surface4: string
  surfaceDiffEmpty: string
  surfaceSidebar: string
  foreground: string
  foregroundMuted: string
  foregroundExtraMuted: string
  foregroundFaint: string
  border: string
  borderAccent: string
  borderSidebar: string
  accent: string
  accentBright?: string
  ring?: string
  primary: string
  primaryForeground: string
  destructive: string
  interactionOverlay: string
  interactionOverlayStrong: string
  interactionItem: string
  codeText: string
  codeWash: string
}

export function buildDarkSemanticColors(tint: DarkThemeConfig) {
  const status = {
    statusSuccess: BASE_COLORS.success,
    statusDanger: BASE_COLORS.danger,
    statusWarning: BASE_COLORS.warning,
    statusRunning: BASE_COLORS.running,
    // Placeholder until a merged hue is anchored; nothing consumes it yet.
    statusMerged: BASE_COLORS.accent,
    // One loudness level today: dots carry the same values as their band.
    statusDotSuccess: BASE_COLORS.success,
    statusDotDanger: BASE_COLORS.danger,
    statusDotWarning: BASE_COLORS.warning,
    statusDotRunning: BASE_COLORS.running,
  }
  const ansi = {
    red: BASE_COLORS.danger,
    green: BASE_COLORS.success,
    yellow: BASE_COLORS.warning,
    blue: BASE_COLORS.running,
    magenta: BASE_COLORS.accent,
    cyan: BASE_COLORS.running,
  }
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surface1,
    surfaceSidebarSelected: tint.surface2,
    background: tint.surface0,

    interactionOverlay: tint.interactionOverlay,
    interactionOverlayStrong: tint.interactionOverlayStrong,
    interactionItem: tint.interactionItem,

    foreground: tint.foreground,
    foregroundMuted: tint.foregroundMuted,
    foregroundExtraMuted: tint.foregroundExtraMuted,
    foregroundFaint: tint.foregroundFaint,

    border: tint.border,
    borderAccent: tint.borderAccent,
    borderSidebar: tint.borderSidebar,

    accent: tint.accent,
    accentBright: tint.accentBright ?? tint.accent,
    accentForeground: tint.primaryForeground,

    primary: tint.primary,
    primaryForeground: tint.primaryForeground,
    destructive: tint.destructive,
    destructiveForeground: tint.primary,
    destructiveWash: withAlpha(tint.destructive, 0x14),
    destructiveBorder: withAlpha(tint.destructive, 0x30),

    secondary: tint.surface2,
    secondaryForeground: tint.foreground,
    muted: tint.surface2,
    mutedForeground: tint.foregroundMuted,
    input: tint.surface2,
    ring: tint.ring ?? tint.accent,

    codeText: tint.codeText,
    codeWash: tint.codeWash,

    ...status,

    diffAddition: status.statusSuccess,
    diffDeletion: status.statusDanger,

    terminal: {
      background: tint.surface0,
      foreground: tint.foreground,
      cursor: tint.foreground,
      cursorAccent: tint.surface0,
      selectionBackground: tint.interactionOverlayStrong,
      selectionForeground: tint.foreground,
      black: tint.surfaceSidebar,
      brightBlack: tint.foregroundFaint,
      ...ansi,
      white: tint.foreground,
      brightRed: ansi.red,
      brightGreen: ansi.green,
      brightYellow: ansi.yellow,
      brightBlue: ansi.blue,
      brightMagenta: ansi.magenta,
      brightCyan: ansi.cyan,
      brightWhite: tint.primary,
    },
  }
}

// ---------------------------------------------------------------------------
// Production dark tint — assembled from the base scales, including the alpha
// washes; no hex originates here.
// ---------------------------------------------------------------------------

export const DARK_TINT: DarkThemeConfig = {
  surface0: BASE_COLORS.graphite900,
  surface1: BASE_COLORS.graphite850,
  surface2: BASE_COLORS.graphite800,
  surface3: BASE_COLORS.graphite700,
  surface4: BASE_COLORS.graphite600,
  surfaceDiffEmpty: BASE_COLORS.graphite800,
  surfaceSidebar: BASE_COLORS.graphite950,
  foreground: BASE_COLORS.graphite100,
  foregroundMuted: BASE_COLORS.graphite300,
  foregroundExtraMuted: BASE_COLORS.graphite400,
  foregroundFaint: BASE_COLORS.graphite500,
  border: withAlpha(BASE_COLORS.coolWhite, 0x12),
  borderAccent: withAlpha(BASE_COLORS.coolWhite, 0x24),
  borderSidebar: BASE_COLORS.graphite750,
  accent: BASE_COLORS.accent,
  primary: BASE_COLORS.inverse,
  primaryForeground: BASE_COLORS.onInverse,
  destructive: BASE_COLORS.danger,
  interactionOverlay: withAlpha(BASE_COLORS.coolWhite, 0x0d),
  interactionOverlayStrong: withAlpha(BASE_COLORS.coolWhite, 0x17),
  interactionItem: withAlpha(BASE_COLORS.softWhite, 0x0f),
  codeText: BASE_COLORS.codeText,
  codeWash: withAlpha(BASE_COLORS.coolWhite, 0x14),
}

export const DARK_SEMANTIC = buildDarkSemanticColors(DARK_TINT)

// ---------------------------------------------------------------------------
// Syntax palettes — placeholder captures anchored to base colors, shaped like
// @gpuix/react's SyntaxTheme. Inert until theme registration wires them in.
// ---------------------------------------------------------------------------

export interface SyntaxPalette {
  comment?: string
  keyword?: string
  string?: string
  escape?: string
  number?: string
  boolean?: string
  function?: string
  typeName?: string
  variable?: string
  property?: string
  constant?: string
  operator?: string
  punctuation?: string
  tag?: string
  invalid?: string
}

export const DARK_SYNTAX: SyntaxPalette = {
  comment: BASE_COLORS.graphite400,
  keyword: BASE_COLORS.accent,
  string: BASE_COLORS.success,
  escape: BASE_COLORS.warning,
  number: BASE_COLORS.running,
  boolean: BASE_COLORS.running,
  function: BASE_COLORS.codeText,
  typeName: BASE_COLORS.codeText,
  variable: BASE_COLORS.graphite100,
  property: BASE_COLORS.graphite300,
  constant: BASE_COLORS.warning,
  operator: BASE_COLORS.graphite400,
  punctuation: BASE_COLORS.graphite500,
  tag: BASE_COLORS.accent,
  invalid: BASE_COLORS.danger,
}

// ---------------------------------------------------------------------------
// Legacy palette — thin alias onto the semantic tokens. Consumers still read
// these names; migrate them to DARK_SEMANTIC (or registered themes) before
// deleting this band.
// ---------------------------------------------------------------------------

export const C = {
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
}

export const SIDEBAR_WIDTH = 252
export const TRAFFIC_LIGHT_CLEARANCE = process.platform === 'darwin' ? 86 : 8
export const CONTENT_MAX_WIDTH = 720
export const TITLEBAR_HEIGHT = 48

// ---------------------------------------------------------------------------
// Chat renderer theme — derives from the semantic tokens.
// ---------------------------------------------------------------------------

export const CHAT_THEME = {
  text: DARK_SEMANTIC.foreground,
  textMuted: DARK_SEMANTIC.foregroundMuted,
  textFaint: DARK_SEMANTIC.foregroundExtraMuted,
  textDim: DARK_SEMANTIC.foregroundMuted,
  border: DARK_SEMANTIC.border,
  bg: DARK_SEMANTIC.background,
  accent: DARK_SEMANTIC.accent,
  caret: DARK_SEMANTIC.accent,
  fontSans: '.SystemUIFont',
  codeText: DARK_SEMANTIC.codeText,
  codeWash: DARK_SEMANTIC.codeWash,
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
