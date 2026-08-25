/**
 * Shared palette, layout metrics, and renderer theme for the GPUIX chat UI.
 *
 * Chrome and layout follow https://github.com/egoist/waku: graphite surfaces,
 * transparent titlebar clearance for macOS traffic lights, composer chips.
 */

export const C = {
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

export const SIDEBAR_WIDTH = 252
export const TRAFFIC_LIGHT_CLEARANCE = process.platform === 'darwin' ? 86 : 8
export const CONTENT_MAX_WIDTH = 720
export const TITLEBAR_HEIGHT = 48

export const CHAT_THEME = {
  text: C.text,
  textMuted: C.secondary,
  textFaint: C.tertiary,
  textDim: C.secondary,
  border: C.border,
  bg: C.canvas,
  accent: C.accent,
  caret: C.accent,
  fontSans: '.SystemUIFont',
  codeText: C.codeText,
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
