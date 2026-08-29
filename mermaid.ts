/**
 * Mermaid fences: classification, a DOM-free flowchart renderer producing SVG
 * for the native rasterizer, and viewer geometry. The component half lives in
 * mermaid-viewer.tsx; this module stays pure so it tests in bun.
 */

import { C } from './theme'

export function isMermaidFence(lang: string | undefined | null): boolean {
  if (!lang) return false
  const name = lang.trim().toLowerCase()
  return name === 'mermaid' || name === 'mmd'
}

// ── Diagram model ────────────────────────────────────────────────────────────

export type DiagramParse =
  | { status: 'ok'; svg: string; width: number; height: number }
  | { status: 'invalid'; error: string }

type Direction = 'TB' | 'BT' | 'LR' | 'RL'

type NodeShape = 'rect' | 'rounded' | 'circle' | 'diamond'

interface FlowNode {
  id: string
  label: string
  shape: NodeShape
}

interface FlowEdge {
  from: string
  to: string
  label?: string
  style: EdgeStyle
}

type EdgeStyle = 'normal' | 'open' | 'thick' | 'dotted'

// ── Statement scanning ───────────────────────────────────────────────────────

interface ScannedNode {
  kind: 'node'
  id: string
  label?: string
  shape?: NodeShape
}

interface ScannedLink {
  kind: 'link'
  label?: string
  style: EdgeStyle
}

/** Splits one statement into alternating node refs and links. */
function scanStatement(text: string): (ScannedNode | ScannedLink)[] | null {
  const items: (ScannedNode | ScannedLink)[] = []
  let rest = text.trim()
  while (rest.length > 0) {
    const idMatch = /^[A-Za-z0-9_]+/.exec(rest)
    if (!idMatch) return null
    rest = rest.slice(idMatch[0].length)
    const node: ScannedNode = { kind: 'node', id: idMatch[0] }
    const shaped = matchShape(rest)
    if (typeof shaped === 'string') return null
    if (shaped) {
      node.shape = shaped.shape
      node.label = shaped.label
      rest = shaped.rest
    }
    items.push(node)
    rest = rest.trim()
    if (rest.length === 0) break
    const link = matchLink(rest)
    if (!link) return null
    items.push({ kind: 'link', ...link })
    rest = link.rest.trim()
  }
  // A statement must start with a node and alternate strictly.
  if (items.length === 0 || items[0].kind !== 'node') return null
  for (let i = 1; i < items.length; i++) {
    if (items[i].kind === items[i - 1].kind) return null
  }
  return items
}

/** Matches a trailing shape wrapper, returning its shape, label, and the rest. */
function matchShape(
  rest: string,
): { shape: NodeShape; label: string; rest: string } | string | null {
  if (rest.startsWith('((')) {
    const end = rest.indexOf('))')
    if (end < 0) return 'unclosed shape'
    return { shape: 'circle', label: unquote(rest.slice(2, end)), rest: rest.slice(end + 2) }
  }
  const closers: Record<string, { close: string; shape: NodeShape }> = {
    '[': { close: ']', shape: 'rect' },
    '(': { close: ')', shape: 'rounded' },
    '{': { close: '}', shape: 'diamond' },
  }
  const closer = closers[rest[0]]
  if (!closer) return null
  const end = indexOfUnquoted(rest.slice(1), closer.close)
  if (end < 0) return 'unclosed shape'
  return {
    shape: closer.shape,
    label: unquote(rest.slice(1, end + 1)),
    rest: rest.slice(end + 2),
  }
}

function indexOfUnquoted(text: string, needle: string): number {
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (text.startsWith(needle, i)) {
      return i
    }
  }
  return -1
}

function unquote(text: string): string {
  const trimmed = text.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const BARE_LINKS: Array<[string, EdgeStyle]> = [
  ['-.->', 'dotted'],
  ['-.-', 'dotted'],
  ['-->', 'normal'],
  ['==>', 'thick'],
  ['===', 'thick'],
  ['---', 'open'],
]

const LABELED_LINKS: Array<[RegExp, EdgeStyle]> = [
  [/^--(.+?)-->/s, 'normal'],
  [/^--(.+?)---/s, 'open'],
  [/^-\.(.+?)\.->/s, 'dotted'],
  [/^==(.+?)==>/s, 'thick'],
]

function matchLink(
  rest: string,
): { label?: string; style: EdgeStyle; rest: string } | null {
  const piped = /^(-\.->|-->|===>|===|---)\|([^|]*)\|/.exec(rest)
  if (piped) {
    const style = BARE_LINKS.find(([text]) => text === piped[1])![1]
    const label = unquote(piped[2])
    return { style, label: label || undefined, rest: rest.slice(piped[0].length) }
  }
  for (const [marker, style] of BARE_LINKS) {
    if (rest.startsWith(marker)) {
      return { style, rest: rest.slice(marker.length) }
    }
  }
  for (const [pattern, style] of LABELED_LINKS) {
    const match = pattern.exec(rest)
    if (match) {
      return { style, label: unquote(match[1]), rest: rest.slice(match[0].length) }
    }
  }
  return null
}

// ── Parsing ──────────────────────────────────────────────────────────────────

const HEADER = /^(flowchart|graph)\s+(TB|TD|BT|LR|RL)$/

export function renderMermaid(source: string): DiagramParse {
  let direction: Direction | null = null
  const nodes = new Map<string, FlowNode>()
  const edges: FlowEdge[] = []

  const ensureNode = (scanned: ScannedNode) => {
    const existing = nodes.get(scanned.id)
    if (!existing) {
      nodes.set(scanned.id, {
        id: scanned.id,
        label: scanned.label ?? scanned.id,
        shape: scanned.shape ?? 'rect',
      })
    } else {
      existing.label = scanned.label ?? existing.label
      existing.shape = scanned.shape ?? existing.shape
    }
  }

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('%%')) continue
    if (direction === null) {
      const header = HEADER.exec(line)
      if (!header) {
        return invalid(`expected a flowchart or graph declaration, found "${truncate(line)}"`)
      }
      direction = header[2] === 'TD' ? 'TB' : (header[2] as Direction)
      continue
    }
    const scanned = scanStatement(line)
    if (!scanned || scanned.length === 0) return invalid(`cannot parse "${truncate(line)}"`)
    for (let i = 0; i < scanned.length; i += 2) {
      const node = scanned[i] as ScannedNode
      ensureNode(node)
      const link = scanned[i + 1] as ScannedLink | undefined
      const target = scanned[i + 2] as ScannedNode | undefined
      if (link && target) {
        edges.push({ from: node.id, to: target.id, label: link.label, style: link.style })
      }
    }
  }

  if (direction === null) return invalid('diagram has no flowchart or graph declaration')
  if (nodes.size === 0) return invalid('diagram declares no nodes')

  return layoutAndDraw(direction, [...nodes.values()], edges)
}

function invalid(error: string): DiagramParse {
  return { status: 'invalid', error }
}

function truncate(text: string, limit = 60): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

// ── Layout ───────────────────────────────────────────────────────────────────

const NODE_HEIGHT = 40
const LABEL_CHAR_WIDTH = 7.5
const NODE_MIN_WIDTH = 40
const NODE_PAD_X = 14
const GAP_MAIN = 84
const GAP_CROSS = 26
const MARGIN = 20

interface Size {
  w: number
  h: number
}

function nodeSize(node: FlowNode): Size {
  const textW = Math.max(NODE_MIN_WIDTH, node.label.length * LABEL_CHAR_WIDTH)
  switch (node.shape) {
    case 'circle': {
      const side = Math.max(textW + NODE_PAD_X * 2, NODE_HEIGHT)
      return { w: side, h: side }
    }
    case 'diamond':
      return { w: textW * 1.5 + NODE_PAD_X * 2, h: NODE_HEIGHT * 1.5 }
    case 'rounded':
    case 'rect':
      return { w: textW + NODE_PAD_X * 2, h: NODE_HEIGHT }
  }
}

interface Point {
  x: number
  y: number
}

interface PlacedNode extends FlowNode {
  x: number
  y: number
  size: Size
}

/**
 * Longest-path layering over a breadth-first order; each node is processed
 * exactly once so cycles and self-loops settle deterministically instead of
 * growing depth without bound.
 */
function layerDepths(nodes: FlowNode[], edges: FlowEdge[]): Map<string, number> {
  const depth = new Map<string, number>(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, FlowEdge[]>()
  const incoming = new Map<string, FlowEdge[]>()
  for (const edge of edges) {
    pushTo(outgoing, edge.from, edge)
    pushTo(incoming, edge.to, edge)
  }
  const queue = nodes.filter((node) => !incoming.has(node.id)).map((node) => node.id)
  const processed = new Set(queue)
  while (queue.length > 0) {
    const id = queue.shift()!
    const nextDepth = depth.get(id)! + 1
    for (const edge of outgoing.get(id) ?? []) {
      if ((depth.get(edge.to) ?? 0) < nextDepth) depth.set(edge.to, nextDepth)
      if (!processed.has(edge.to)) {
        processed.add(edge.to)
        queue.push(edge.to)
      }
    }
  }
  return depth
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function layout(direction: Direction, nodes: FlowNode[], edges: FlowEdge[]): {
  placed: PlacedNode[]
  width: number
  height: number
} {
  const depths = layerDepths(nodes, edges)
  const byLayer = new Map<number, FlowNode[]>()
  for (const node of nodes) {
    pushTo(byLayer, depths.get(node.id)!, node)
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b)

  const mainAxisOf = (layer: number) => layer * GAP_MAIN
  const slot = Math.max(...nodes.map((node) => nodeSize(node).h)) + GAP_CROSS
  const placed: PlacedNode[] = []
  for (const layer of layers) {
    const members = byLayer.get(layer)!
    members.forEach((node, index) => {
      const size = nodeSize(node)
      const cross = (index - (members.length - 1) / 2) * slot
      const forward = direction === 'LR' || direction === 'TB'
      const alongMain = mainAxisOf(layer) * (forward ? 1 : -1)
      placed.push({
        ...node,
        size,
        x: direction === 'LR' || direction === 'RL' ? alongMain : cross,
        y: direction === 'LR' || direction === 'RL' ? cross : alongMain,
      })
    })
  }

  const minX = Math.min(...placed.map((node) => node.x - node.size.w / 2))
  const minY = Math.min(...placed.map((node) => node.y - node.size.h / 2))
  const maxX = Math.max(...placed.map((node) => node.x + node.size.w / 2))
  const maxY = Math.max(...placed.map((node) => node.y + node.size.h / 2))
  for (const node of placed) {
    node.x += MARGIN - minX
    node.y += MARGIN - minY
  }
  return {
    placed,
    width: maxX - minX + MARGIN * 2,
    height: maxY - minY + MARGIN * 2,
  }
}

/** Point where the centre-to-centre segment leaves the node's silhouette. */
function anchor(node: PlacedNode, toward: Point): Point {
  const dx = toward.x - node.x
  const dy = toward.y - node.y
  const scale =
    node.shape === 'circle'
      ? node.size.w / 2 / Math.hypot(dx, dy)
      : Math.min(
          Math.abs((node.size.w / 2) / (dx || 1e-9)),
          Math.abs((node.size.h / 2) / (dy || 1e-9)),
        )
  return { x: node.x + dx * scale, y: node.y + dy * scale }
}

// ── Drawing ──────────────────────────────────────────────────────────────────

const EDGE_COLORS: Record<EdgeStyle, string> = {
  normal: C.secondary,
  open: C.tertiary,
  thick: C.text,
  dotted: C.tertiary,
}
const ARROW_STYLES: Partial<Record<EdgeStyle, string>> = { normal: 'arrow', thick: 'arrow-thick', dotted: 'arrow-dotted' }

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function layoutAndDraw(
  direction: Direction,
  nodes: FlowNode[],
  edges: FlowEdge[],
): DiagramParse & { status: 'ok' } {
  const { placed, width, height } = layout(direction, nodes, edges)
  const byId = new Map(placed.map((node) => [node.id, node]))
  const parts: string[] = []

  parts.push(
    `<defs>` +
      `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${EDGE_COLORS.normal}"/></marker>` +
      `<marker id="arrow-thick" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${EDGE_COLORS.thick}"/></marker>` +
      `<marker id="arrow-dotted" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${EDGE_COLORS.dotted}"/></marker>` +
      `</defs>`,
  )

  for (const edge of edges) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) continue
    const start = anchor(from, { x: to.x, y: to.y })
    const end = anchor(to, { x: from.x, y: from.y })
    const color = EDGE_COLORS[edge.style]
    const dash = edge.style === 'dotted' ? ' stroke-dasharray="4 3"' : ''
    const strokeWidth = edge.style === 'thick' ? 2.4 : 1.4
    const marker = ARROW_STYLES[edge.style]
      ? ` marker-end="url(#${ARROW_STYLES[edge.style]})"`
      : ''
    parts.push(
      `<path d="M${round(start.x)},${round(start.y)} L${round(end.x)},${round(end.y)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}"${dash}${marker}/>`,
    )
    if (edge.label) {
      const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
      const labelWidth = edge.label.length * 6.4 + 10
      parts.push(
        `<rect x="${round(mid.x - labelWidth / 2)}" y="${round(mid.y - 9)}" width="${round(labelWidth)}" height="18" rx="4" fill="${C.canvas}"/>`,
      )
      parts.push(
        `<text x="${round(mid.x)}" y="${round(mid.y + 4)}" font-size="11.5" fill="${C.secondary}" text-anchor="middle">${escapeXml(edge.label)}</text>`,
      )
    }
  }

  for (const node of placed) {
    const { w, h } = node.size
    const left = round(node.x - w / 2)
    const top = round(node.y - h / 2)
    const body =
      node.shape === 'circle'
        ? `<circle cx="${round(node.x)}" cy="${round(node.y)}" r="${round(w / 2)}" fill="${C.raised}" stroke="${C.borderStrong}" stroke-width="1.2"/>`
        : node.shape === 'diamond'
          ? `<polygon points="${round(node.x)},${top} ${left + w},${round(node.y)} ${round(node.x)},${top + h} ${left},${round(node.y)}" fill="${C.raised}" stroke="${C.borderStrong}" stroke-width="1.2"/>`
          : `<rect x="${left}" y="${top}" width="${round(w)}" height="${round(h)}" rx="${node.shape === 'rounded' ? h / 2 : 8}" fill="${C.raised}" stroke="${C.borderStrong}" stroke-width="1.2"/>`
    parts.push(body)
    parts.push(
      `<text x="${round(node.x)}" y="${round(node.y + 4.5)}" font-size="12.5" fill="${C.text}" text-anchor="middle">${escapeXml(node.label)}</text>`,
    )
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" font-family="sans-serif">` +
    parts.join('') +
    `</svg>`
  return { status: 'ok', svg, width: Math.ceil(width), height: Math.ceil(height) }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

// ── Viewer geometry ──────────────────────────────────────────────────────────

/** Nominal transcript viewport the viewer fits into; the box is fixed height. */
export const VIEWPORT = { width: 656, height: 244 } as const

const MIN_SCALE = 0.2
const MAX_SCALE = 4

export interface ViewState {
  scale: number
  x: number
  y: number
}

/** Initial view: whole diagram visible, never upscaled, centred. */
export function fitView(width: number, height: number): ViewState {
  const scale = Math.min(1, VIEWPORT.width / width, VIEWPORT.height / height)
  return {
    scale,
    x: (VIEWPORT.width - width * scale) / 2,
    y: (VIEWPORT.height - height * scale) / 2,
  }
}

/** Zooms by a factor around the viewport centre, clamped to the limits. */
export function zoomView(state: ViewState, factor: number): ViewState {
  const scale = clamp(state.scale * factor, MIN_SCALE, MAX_SCALE)
  const ratio = scale / state.scale
  const cx = VIEWPORT.width / 2
  const cy = VIEWPORT.height / 2
  return { scale, x: cx - (cx - state.x) * ratio, y: cy - (cy - state.y) * ratio }
}

/** Pans by pixel deltas from a drag gesture. */
export function panView(state: ViewState, dx: number, dy: number): ViewState {
  return { ...state, x: state.x + dx, y: state.y + dy }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
