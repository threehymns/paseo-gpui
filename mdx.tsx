/**
 * Markdown rendering: safe-mdx mapped onto GPUIX primitives, with a parse
 * cache. Public interface is <SafeMdxContent source>, plus optional workspace
 * hooks that turn image sources into framed media and inline-code spans into
 * open-file links.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { SafeMdxRenderer } from 'safe-mdx'
import { mdxParse } from 'safe-mdx/parse'
import type { Root } from 'mdast'
import type { StyleDesc } from '@gpuix/react'
import { classifyImageSource, probeRemoteImage } from './markdown-images'
import { resolveWorkspaceFile } from './open-file'
import { MermaidFence } from './mermaid-viewer'
import { C, CHAT_THEME } from './theme'

type MdxChildren = { children?: React.ReactNode }

/** Workspace hooks a markdown body may render with; absent means plain rendering. */
interface MdxWorkspace {
  /** Root that inline-code spans resolve against. */
  workspaceRoot?: string
  /** Opens one absolute path; supplied whenever `workspaceRoot` is. */
  onOpenFile?: (absolutePath: string) => void
}

function flattenMdxTable(children: React.ReactNode): {
  cols: number
  cells: React.ReactElement[]
} {
  const rows: React.ReactElement[][] = []
  React.Children.forEach(children, (section) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(section)) return
    React.Children.forEach(section.props.children, (row) => {
      if (!React.isValidElement<{ children?: React.ReactNode }>(row)) return
      const cells: React.ReactElement[] = []
      React.Children.forEach(row.props.children, (cell) => {
        if (React.isValidElement(cell)) cells.push(cell)
      })
      if (cells.length > 0) rows.push(cells)
    })
  })
  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const cells: React.ReactElement[] = []
  for (const [rowIndex, row] of rows.entries()) {
    for (let col = 0; col < cols; col++) {
      const cell = row[col]
      cells.push(
        cell
          ? React.cloneElement(cell, { key: `${rowIndex}-${col}` })
          : <div key={`pad-${rowIndex}-${col}`} />,
      )
    }
  }
  return { cols, cells }
}

function MdxCell({ children, header }: MdxChildren & { header?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'nowrap',
        padding: 8,
        minWidth: 96,
        flexShrink: 0,
        whiteSpace: 'nowrap',
        backgroundColor: C.canvas,
        fontSize: 15,
        lineHeight: 26,
        fontWeight: header ? 700 : 400,
        color: C.text,
      }}
    >
      {children}
    </div>
  )
}

function MdxBlock({ children }: MdxChildren) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', minWidth: 0 }}>
      {children}
    </div>
  )
}

const MD_TEXT = {
  fontSize: 15,
  lineHeight: 26,
  color: C.text,
  maxWidth: '100%',
  minWidth: 0,
} as const

function MdxInline({ children, style }: MdxChildren & { style?: StyleDesc }) {
  return <text style={{ ...MD_TEXT, ...style }}>{children}</text>
}

function mdxStringChild(children: React.ReactNode) {
  const items = React.Children.toArray(children)
  if (items.length === 1 && (typeof items[0] === 'string' || typeof items[0] === 'number')) {
    return items[0]
  }
  return null
}

// ---- framed images ----------------------------------------------------------

const IMAGE_FRAME_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  maxWidth: 420,
  height: 220,
  minWidth: 0,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: C.border,
  backgroundColor: C.raised,
  overflow: 'hidden',
} as const

type RemoteImageStatus = 'idle' | 'loading' | 'loaded' | 'error'

/**
 * Proves a remote image loads before its frame commits to it: loading while
 * the probe runs, error on a dead link. Native @gpuix images expose no load
 * events yet; when they do, this is the one hook to swap.
 */
function useRemoteImageStatus(src: string | null): RemoteImageStatus {
  const [status, setStatus] = useState<RemoteImageStatus>(src ? 'loading' : 'idle')
  useEffect(() => {
    if (!src) return
    setStatus('loading')
    let cancelled = false
    void probeRemoteImage(src).then((loaded) => {
      if (!cancelled) setStatus(loaded ? 'loaded' : 'error')
    })
    return () => {
      cancelled = true
    }
  }, [src])
  return status
}

function ImageFrame({ children }: MdxChildren) {
  return <div style={IMAGE_FRAME_STYLE}>{children}</div>
}

/** One markdown image in its frame state: ready, remote-loading, or failed. */
function MdxImage({ src, alt }: { src?: string; alt?: string }) {
  const verdict = classifyImageSource(src)
  const status = useRemoteImageStatus(verdict.kind === 'remote' && src ? src : null)
  if (verdict.kind === 'unsupported') {
    // Not renderable media at all — fall back to the alt text, no dead frame.
    return alt ? <text style={{ ...MD_TEXT, color: C.tertiary }}>{alt}</text> : null
  }
  if (verdict.kind === 'invalid') {
    return (
      <ImageFrame>
        <text style={{ fontSize: 12.5, color: C.danger }}>{alt || 'Invalid image data'}</text>
      </ImageFrame>
    )
  }
  if (verdict.kind === 'remote' && status !== 'loaded') {
    return (
      <ImageFrame>
        {status === 'error' ? (
          <text style={{ fontSize: 12.5, color: C.danger }}>Couldn't load this image</text>
        ) : (
          <text style={{ fontSize: 12.5, color: C.tertiary }}>Loading image…</text>
        )}
      </ImageFrame>
    )
  }
  return (
    <ImageFrame>
      <img src={src} alt={alt} objectFit="contain" style={{ width: '100%', height: '100%' }} />
    </ImageFrame>
  )
}

// ---- inline-code open-file links ---------------------------------------------

/** An inline-code span resolved to a workspace file, rendered as an open-file link. */
function CodeFileLink({
  label,
  absolutePath,
  onOpenFile,
}: {
  label: string
  absolutePath: string
  onOpenFile: (absolutePath: string) => void
}) {
  return (
    <text
      testId="code-file-link"
      onClick={() => onOpenFile(absolutePath)}
      style={{
        fontFamily: 'Menlo',
        fontSize: 13,
        color: C.accent,
        backgroundColor: C.item,
        borderRadius: 5,
        paddingLeft: 5,
        paddingRight: 5,
        cursor: 'pointer',
        hover: { backgroundColor: C.overlayStrong },
      }}
    >
      {label}
    </text>
  )
}

function MdxParagraph({ children }: MdxChildren) {
  const only = mdxStringChild(children)
  if (only != null) {
    return <text style={{ ...MD_TEXT, width: '100%' }}>{only}</text>
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'start',
        width: '100%',
        minWidth: 0,
        fontSize: 15,
        lineHeight: 26,
        color: C.text,
      }}
    >
      {React.Children.map(children, (child) =>
        typeof child === 'string' || typeof child === 'number' ? (
          <text style={MD_TEXT}>{child}</text>
        ) : (
          child
        ),
      )}
    </div>
  )
}

const MDX_CODE_INLINE_STYLE = {
  fontFamily: 'Menlo',
  fontSize: 13,
  backgroundColor: C.raised,
  borderRadius: 5,
  paddingLeft: 5,
  paddingRight: 5,
} as const

/**
 * The component map for one markdown body. Static mappings are shared; the
 * inline-code mapping closes over the workspace hooks so a span that resolves
 * to an existing workspace file renders as an open-file link, and anything
 * else keeps rendering as plain code.
 */
function mdxComponents({ workspaceRoot, onOpenFile }: MdxWorkspace) {
  const code = ({ children }: MdxChildren) => {
    const text = mdxStringChild(children)
    if (workspaceRoot && onOpenFile && typeof text === 'string') {
      const resolved = resolveWorkspaceFile(workspaceRoot, text)
      if (resolved.kind === 'file') {
        return <CodeFileLink label={resolved.label} absolutePath={resolved.absolutePath} onOpenFile={onOpenFile} />
      }
    }
    return <MdxInline style={MDX_CODE_INLINE_STYLE}>{children}</MdxInline>
  }
  return {
    ...SAFE_MDX_COMPONENTS,
    code,
    img: MdxImage,
  }
}

const SAFE_MDX_COMPONENTS = {
  h1: ({ children }: MdxChildren) => (
    <text style={{ fontSize: 22, lineHeight: 30, fontWeight: 700, color: C.text, maxWidth: '100%', minWidth: 0 }}>
      {children}
    </text>
  ),
  h2: ({ children }: MdxChildren) => (
    <text style={{ fontSize: 18, lineHeight: 26, fontWeight: 700, color: C.text, maxWidth: '100%', minWidth: 0 }}>
      {children}
    </text>
  ),
  h3: ({ children }: MdxChildren) => (
    <text style={{ fontSize: 16, lineHeight: 24, fontWeight: 700, color: C.text, maxWidth: '100%', minWidth: 0 }}>
      {children}
    </text>
  ),
  h4: MdxInline,
  h5: MdxInline,
  h6: MdxInline,
  p: MdxParagraph,
  blockquote: ({ children }: MdxChildren) => (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 12, width: '100%', minWidth: 0 }}>
      <div style={{ width: 3, flexShrink: 0, backgroundColor: C.accent }} />
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: 6, color: C.secondary }}>
        {children}
      </div>
    </div>
  ),
  hr: () => <div style={{ height: 1, width: '100%', backgroundColor: C.border }} />,
  ul: MdxBlock,
  ol: MdxBlock,
  li: ({
    children,
    'data-checked': checked,
  }: MdxChildren & { 'data-checked'?: boolean }) => {
    const only = mdxStringChild(children)
    return (
      <div style={{ display: 'flex', flexDirection: 'row', gap: 9, width: '100%', minWidth: 0 }}>
        <text style={{ fontSize: 15, lineHeight: 26, color: C.secondary, flexShrink: 0 }}>
          {checked === undefined ? '•' : checked ? '✓' : '○'}
        </text>
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          {only != null ? <text style={{ ...MD_TEXT, width: '100%' }}>{only}</text> : children}
        </div>
      </div>
    )
  },
  strong: ({ children }: MdxChildren) => <MdxInline style={{ fontWeight: 700 }}>{children}</MdxInline>,
  em: ({ children }: MdxChildren) => <MdxInline style={{ color: C.secondary }}>{children}</MdxInline>,
  del: ({ children }: MdxChildren) => <MdxInline style={{ color: C.ghost }}>{children}</MdxInline>,
  a: ({ children }: MdxChildren & { href?: string }) => (
    <MdxInline style={{ color: C.accent }}>{children}</MdxInline>
  ),
  table: ({ children }: MdxChildren) => {
    const { cols, cells } = flattenMdxTable(children)
    if (cols === 0) return null
    return (
      <div style={{ display: 'flex', width: '100%', minWidth: 0, overflowX: 'scroll' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: cols,
            gridColumnMin: 'max-content',
            flexShrink: 0,
            backgroundColor: C.border,
            rowGap: 1,
            columnGap: 1,
          }}
        >
          {cells}
        </div>
      </div>
    )
  },
  thead: MdxBlock,
  tbody: MdxBlock,
  tr: ({ children }: MdxChildren) => <>{children}</>,
  th: ({ children }: MdxChildren) => <MdxCell header>{children}</MdxCell>,
  td: ({ children }: MdxChildren) => <MdxCell>{children}</MdxCell>,
}

const mdxCache = new Map<string, Root>()

function parseMdx(source: string) {
  const cached = mdxCache.get(source)
  if (cached) return cached
  const tree = mdxParse(source)
  mdxCache.set(source, tree)
  return tree
}

export function SafeMdxContent({
  source,
  workspaceRoot,
  onOpenFile,
}: { source: string } & MdxWorkspace) {
  const mdast = React.useMemo(() => parseMdx(source), [source])
  const components = useMemo(() => mdxComponents({ workspaceRoot, onOpenFile }), [workspaceRoot, onOpenFile])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', minWidth: 0 }}>
      <SafeMdxRenderer
        markdown={source}
        mdast={mdast}
        components={components}
        renderNode={(node) => {
          if (node.type !== 'code') return undefined
          return <MermaidFence value={node.value} lang={node.lang ?? undefined} />
        }}
      />
    </div>
  )
}
