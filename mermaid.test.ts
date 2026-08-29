import { describe, expect, test } from 'bun:test'
import { fitView, isMermaidFence, panView, renderMermaid, VIEWPORT, zoomView } from './mermaid'

describe('fence classification', () => {
  test('mermaid fences route to the viewer, case-insensitively', () => {
    expect(isMermaidFence('mermaid')).toBe(true)
    expect(isMermaidFence('Mermaid')).toBe(true)
    expect(isMermaidFence('mmd')).toBe(true)
  })

  test('other and missing languages stay plain code blocks', () => {
    expect(isMermaidFence('ts')).toBe(false)
    expect(isMermaidFence('mermaid-extra-token')).toBe(false)
    expect(isMermaidFence(undefined)).toBe(false)
  })
})

describe('flowchart rendering', () => {
  test('a two-node flowchart renders both labels joined by an arrow', () => {
    const result = renderMermaid('flowchart LR\n a --> b')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('<svg')
    expect(result.svg).toContain('>a<')
    expect(result.svg).toContain('>b<')
    expect(result.svg).toContain('<path')
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
  })

  test('legacy graph keyword works', () => {
    expect(renderMermaid('graph LR\n a --> b').status).toBe('ok')
  })

  test('an edge chain renders every hop', () => {
    const result = renderMermaid('flowchart LR\n a --> b --> c')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('>a<')
    expect(result.svg).toContain('>b<')
    expect(result.svg).toContain('>c<')
  })

  test('a cyclic graph does not hang and renders deterministically', () => {
    const result = renderMermaid('flowchart LR\n start --> a\n a --> b\n b --> a')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('>start<')
    expect(result.svg).toContain('>a<')
    expect(result.svg).toContain('>b<')
  })

  test('a self-loop does not hang and renders its node once', () => {
    const result = renderMermaid('flowchart LR\n start --> a\n a --> a')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('>start<')
    expect(result.svg).toContain('>a<')
  })
})

describe('node shapes', () => {
  test('rect, rounded, circle, and diamond shapes render their labels', () => {
    const result = renderMermaid('flowchart LR\n a[Square] --> b(Round) --> c((Circle))\n d{Diamond} --> a')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('>Square<')
    expect(result.svg).toContain('>Round<')
    expect(result.svg).toContain('>Circle<')
    expect(result.svg).toContain('>Diamond<')
    expect(result.svg).toContain('<circle')
    expect(result.svg).toContain('<polygon')
  })

  test('a later statement refines an earlier bare node', () => {
    const result = renderMermaid('flowchart LR\n a --> b\n b["label later"]')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('>label later<')
  })

  test('an unclosed shape falls back with the offending line', () => {
    const result = renderMermaid('flowchart LR\n a[nope')
    expect(result.status).toBe('invalid')
    if (result.status !== 'invalid') return
    expect(result.error).toContain('a[nope')
  })

  test('quoted labels survive commas and brackets', () => {
    const result = renderMermaid('flowchart LR\n a["has, comma [bracket]"] --> b')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('>has, comma [bracket]<')
  })
})

describe('edge styles and labels', () => {
  test('dotted edges draw dashed paths with a dotted arrowhead', () => {
    const result = renderMermaid('flowchart LR\n a -.-> b')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('stroke-dasharray="4 3"')
    expect(result.svg).toContain('url(#arrow-dotted)')
  })

  test('thick edges draw heavier strokes with a heavy arrowhead', () => {
    const result = renderMermaid('flowchart LR\n a ==> b')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('stroke-width="2.4"')
    expect(result.svg).toContain('url(#arrow-thick)')
  })

  test('open links connect without an arrowhead', () => {
    const result = renderMermaid('flowchart LR\n a --- b')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).not.toContain('marker-end')
  })

  test('inline edge labels render at the midpoint', () => {
    const result = renderMermaid('flowchart LR\n a --yes--> b\n c -.maybe.-> d\n e ==sure==> f\n g -->|piped| h')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('>yes<')
    expect(result.svg).toContain('>maybe<')
    expect(result.svg).toContain('>sure<')
    expect(result.svg).toContain('>piped<')
  })

  test('an unrecognized link falls back', () => {
    const result = renderMermaid('flowchart LR\n a ~~~> b')
    expect(result.status).toBe('invalid')
    if (result.status !== 'invalid') return
    expect(result.error).toContain('a ~~~> b')
  })
})

describe('direction', () => {
  function labelPos(svg: string, label: string): { x: number; y: number } {
    const match = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*>${label}</text>`).exec(svg)
    expect(match).toBeTruthy()
    return { x: Number(match![1]), y: Number(match![2]) }
  }

  test('LR lays successors to the right', () => {
    const result = renderMermaid('flowchart LR\n a --> b')
    if (result.status !== 'ok') return
    const { x: ax } = labelPos(result.svg, 'a')
    const { x: bx } = labelPos(result.svg, 'b')
    expect(bx).toBeGreaterThan(ax)
  })

  test('TB stacks successors downward', () => {
    const result = renderMermaid('flowchart TB\n a --> b')
    if (result.status !== 'ok') return
    const { y: ay } = labelPos(result.svg, 'a')
    const { y: by } = labelPos(result.svg, 'b')
    expect(by).toBeGreaterThan(ay)
  })

  test('RL and BT run against the reading direction', () => {
    const rl = renderMermaid('flowchart RL\n a --> b')
    if (rl.status === 'ok') {
      expect(labelPos(rl.svg, 'b').x).toBeLessThan(labelPos(rl.svg, 'a').x)
    } else {
      throw new Error(rl.error)
    }
    const bt = renderMermaid('flowchart BT\n a --> b')
    if (bt.status === 'ok') {
      expect(labelPos(bt.svg, 'b').y).toBeLessThan(labelPos(bt.svg, 'a').y)
    } else {
      throw new Error(bt.error)
    }
  })

  test('TD is accepted as a synonym of TB', () => {
    expect(renderMermaid('flowchart TD\n a --> b').status).toBe('ok')
  })
})

describe('graceful fallbacks', () => {
  test('comments and blank lines are tolerated', () => {
    const result = renderMermaid('flowchart LR\n\n %% a comment\n a --> b\n\n %% another\n')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('>a<')
  })

  test('a missing header names the problem', () => {
    const result = renderMermaid('a --> b')
    expect(result.status).toBe('invalid')
    if (result.status !== 'invalid') return
    expect(result.error).toMatch(/flowchart or graph declaration/)
    expect(result.error).toContain('a --> b')
  })

  test('an unknown diagram kind falls back instead of rendering junk', () => {
    const result = renderMermaid('sequenceDiagram\n Alice->>Bob: hi')
    expect(result.status).toBe('invalid')
    if (result.status !== 'invalid') return
    expect(result.error).toContain('sequenceDiagram')
  })

  test('an empty fence has nothing to show', () => {
    const result = renderMermaid('')
    expect(result.status).toBe('invalid')
    if (result.status !== 'invalid') return
    expect(result.error).toContain('no flowchart')
  })

  test('a header-only fence declares no nodes', () => {
    const result = renderMermaid('flowchart LR')
    expect(result.status).toBe('invalid')
    if (result.status !== 'invalid') return
    expect(result.error).toContain('no nodes')
  })

  test('garbage after the header falls back with the line quoted', () => {
    const result = renderMermaid('flowchart LR\n subgraph one\n a --> b')
    expect(result.status).toBe('invalid')
    if (result.status !== 'invalid') return
    expect(result.error).toContain('subgraph one')
  })
})

describe('xml safety', () => {
  test('markup characters in labels are escaped, not injected', () => {
    const result = renderMermaid('flowchart LR\n a["<b>&</b>"] --> c["x\'y \\"z\\""]')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('&lt;b&gt;&amp;&lt;/b&gt;')
    expect(result.svg).not.toContain('<b>&</b>')
    expect(result.svg).not.toContain("<b>&</b>'")
  })

  test('markup in edge labels is escaped too', () => {
    const result = renderMermaid('flowchart LR\n a -- "<img/>" --> b')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.svg).toContain('&lt;img/&gt;')
    expect(result.svg).not.toContain('<img/>')
  })
})

describe('viewer geometry', () => {
  test('fit scales large diagrams down and centers them', () => {
    const view = fitView(VIEWPORT.width * 2, VIEWPORT.height * 2)
    expect(view.scale).toBe(0.5)
    expect(view.x).toBeCloseTo(0)
    expect(view.y).toBeCloseTo(0)
  })

  test('fit never upscales small diagrams, it centers them at full size', () => {
    const view = fitView(100, 50)
    expect(view.scale).toBe(1)
    expect(view.x).toBe((VIEWPORT.width - 100) / 2)
    expect(view.y).toBe((VIEWPORT.height - 50) / 2)
  })

  test('zoom keeps the viewport centre pinned', () => {
    const view = { scale: 1, x: -100, y: -40 }
    const zoomed = zoomView(view, 2)
    expect(zoomed.scale).toBe(2)
    // The diagram point under the centre before is under it after.
    const beforeX = (VIEWPORT.width / 2 - view.x) / view.scale
    const afterX = (VIEWPORT.width / 2 - zoomed.x) / zoomed.scale
    expect(afterX).toBeCloseTo(beforeX)
    const beforeY = (VIEWPORT.height / 2 - view.y) / view.scale
    const afterY = (VIEWPORT.height / 2 - zoomed.y) / zoomed.scale
    expect(afterY).toBeCloseTo(beforeY)
  })

  test('zoom clamps between the limits', () => {
    const maxed = zoomView({ scale: 4, x: 0, y: 0 }, 10)
    expect(maxed.scale).toBe(4)
    const mined = zoomView({ scale: 0.2, x: 0, y: 0 }, 0.01)
    expect(mined.scale).toBe(0.2)
  })

  test('pan translates the diagram', () => {
    const moved = panView({ scale: 1, x: 10, y: -5 }, -30, 7)
    expect(moved).toEqual({ scale: 1, x: -20, y: 2 })
  })
})
