# T021: Light Theme

## Summary

Add the light theme palette and theme toggle. System preference detection. xterm.js light theme variant.

## Acceptance Criteria

- [ ] Light palette CSS variables (from PRODUCT.md: Background #FAFAF9, Surface #FFFFFF, etc.)
- [ ] Theme toggle in settings (dark / light / system)
- [ ] System preference detection via `prefers-color-scheme` media query
- [ ] xterm.js light theme colors
- [ ] Diff viewer light theme colors
- [ ] All shared components render correctly in light mode
- [ ] Smooth transition between themes (no flash of wrong theme)

## Dependencies

- T008 (theme system foundation)

## Complexity

**S** — Architecture already supports it. Just add the CSS variables + xterm theme.
