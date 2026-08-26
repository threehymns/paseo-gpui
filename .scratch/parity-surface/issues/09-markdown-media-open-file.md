# 09: Markdown images, inline-code open-file links, tool-row open buttons

**Parent:** paseo-gpui#34 (§2 Transcript polish)

**What to build:** Assistant markdown gains media and file affordances. Image syntax renders for `data:` and `http(s):` sources inside a frame with a loading state and a distinct error state on failure. Inline code spans that resolve to workspace-relative paths render as open-file links, and file-bearing tool rows get an open-file button — both routing through one shared open-file seam (today the native bridge is a stub, so the seam degrades to a visible no-op notice rather than dying silently). Rendering components stay declarative; path-resolution logic is pure and tested.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `data:` and `http(s):` markdown images render with loading and error frames
- [ ] Workspace-relative inline code that resolves to an existing file renders as an open-file link
- [ ] File-bearing tool rows expose an open-file button using the same seam
- [ ] Unresolvable paths render as plain code/labels, not dead links
- [ ] Path resolution pure function unit-tested (absolute, relative, traversal, non-files)
