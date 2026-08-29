/**
 * Mermaid fence component: every fenced block in markdown passes through
 * <MermaidFence>. Plain fences render as the standard code view; mermaid
 * fences render as a pan/zoom diagram viewer, or fall back to the code view
 * plus an error note when the source does not parse.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import React, { useMemo, useRef, useState } from 'react'
import {
  fitView,
  isMermaidFence,
  panView,
  renderMermaid,
  VIEWPORT,
  zoomView,
  type DiagramParse,
  type ViewState,
} from './mermaid'
import { C, CHAT_THEME } from './theme'

export function MermaidFence({ value, lang }: { value: string; lang?: string }) {
  if (!isMermaidFence(lang)) return <CodeFence value={value} lang={lang} />
  return <MermaidOrFallback source={value} />
}

function CodeFence({ value, lang }: { value: string; lang?: string }) {
  return (
    <div style={{ width: '100%', minWidth: 0 }}>
      <code code={value} language={lang} showLineNumbers theme={CHAT_THEME} />
    </div>
  )
}

// Only successful parses are cached: while a message streams in, each prefix of
// the fence is invalid until the closing fence arrives, and recomputing those
// is cheaper than holding every prefix forever (cf. mdxCache).
const parseCache = new Map<string, Extract<DiagramParse, { status: 'ok' }>>()

function MermaidOrFallback({ source }: { source: string }) {
  const parsed = useMemo<DiagramParse>(() => {
    const cached = parseCache.get(source)
    if (cached) return cached
    const fresh = renderMermaid(source)
    if (fresh.status === 'ok') parseCache.set(source, fresh)
    return fresh
  }, [source])

  if (parsed.status === 'ok') {
    return (
      <DiagramViewer svg={parsed.svg} width={parsed.width} height={parsed.height} />
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', minWidth: 0 }}>
      <CodeFence value={source} lang="mermaid" />
      <text style={{ fontSize: 12, lineHeight: 17, color: C.warn }}>
        {`Mermaid diagram not shown: ${parsed.error}`}
      </text>
    </div>
  )
}

const TOOLBAR_HEIGHT = 34

const MERMAID_ROOT = path.join(tmpdir(), 'gpuix-chat-assets')

function mermaidAsset(svg: string): string {
  const hash = createHash('sha1').update(svg).digest('hex').slice(0, 12)
  const dest = path.join(MERMAID_ROOT, `mermaid-${hash}.svg`)
  mkdirSync(MERMAID_ROOT, { recursive: true })
  writeFileSync(dest, svg)
  return dest
}

function DiagramViewer({ svg, width, height }: { svg: string; width: number; height: number }) {
  const [view, setView] = useState<ViewState>(() => fitView(width, height))
  const dragOrigin = useRef<{ x: number; y: number } | null>(null)

  const src = useMemo(() => mermaidAsset(svg), [svg])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        minWidth: 0,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: C.border,
        overflow: 'hidden',
        backgroundColor: C.canvas,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: TOOLBAR_HEIGHT,
          paddingLeft: 12,
          paddingRight: 8,
          backgroundColor: C.raised,
        }}
      >
        <text style={{ fontSize: 11.5, fontWeight: 500, color: C.tertiary, flexGrow: 1 }}>
          mermaid
        </text>
        <ViewerButton label="−" onPress={() => setView((v) => zoomView(v, 0.8))} />
        <ViewerButton label="+" onPress={() => setView((v) => zoomView(v, 1.25))} />
        <ViewerButton label="reset" onPress={() => setView(fitView(width, height))} />
      </div>
      <div style={{ height: 1, width: '100%', backgroundColor: C.border }} />
      <div
        style={{
          position: 'relative',
          height: VIEWPORT.height,
          overflow: 'hidden',
          backgroundColor: C.canvas,
          cursor: 'grab',
        }}
        onMouseDown={(event) => {
          if (event.x == null || event.y == null) return
          dragOrigin.current = { x: event.x, y: event.y }
        }}
        onMouseMove={(event) => {
          const origin = dragOrigin.current
          if (!origin || event.x == null || event.y == null) return
          const dx = event.x - origin.x
          const dy = event.y - origin.y
          dragOrigin.current = { x: event.x, y: event.y }
          setView((v) => panView(v, dx, dy))
        }}
        onMouseUp={() => {
          dragOrigin.current = null
        }}
        onMouseLeave={() => {
          dragOrigin.current = null
        }}
      >
        <svg
          src={src}
          style={{
            position: 'absolute',
            left: Math.round(view.x),
            top: Math.round(view.y),
            width: Math.round(width * view.scale),
            height: Math.round(height * view.scale),
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  )
}

function ViewerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <div
      onClick={onPress}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 24,
        height: 22,
        paddingLeft: 7,
        paddingRight: 7,
        borderRadius: 6,
        backgroundColor: C.overlayStrong,
        cursor: 'pointer',
        hover: { backgroundColor: C.item },
      }}
    >
      <text style={{ fontSize: 12, fontWeight: 500, color: C.secondary }}>{label}</text>
    </div>
  )
}
