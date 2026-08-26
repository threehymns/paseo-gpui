# 10: Mermaid fence viewer

**Parent:** paseo-gpui#34 (§2 Transcript polish)

**What to build:** Fenced mermaid code blocks in assistant messages render as diagrams in an interactive viewer (pan and basic zoom) instead of raw text. Parse failures fall back to the fenced block with a small error note rather than blank space. The renderer is fed the same sanitized markdown pipeline as other fences; diagram source remains copyable from the fallback view.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Valid mermaid fences render as a diagram viewer supporting pan and zoom
- [ ] Invalid mermaid falls back to the code block plus an error note
- [ ] Viewer renders inside transcript turns without breaking virtualized list measurement (fixed or measured height)
- [ ] Non-mermaid fences are unaffected
