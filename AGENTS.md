# Bento-ya Development Notes

## Tauri/macOS Pitfalls

### Cursor Styles on macOS WebView

**Problem:** CSS cursor classes (Tailwind's `cursor-pointer`, `cursor-ns-resize`, etc.) do NOT work reliably on macOS WKWebView used by Tauri.

**Solution:** Use **inline styles** instead of CSS classes:

```tsx
// WRONG - doesn't work on macOS Tauri
<div className="cursor-ns-resize">

// CORRECT - works on macOS Tauri
<div style={{ cursor: 'row-resize' }}>
```

For child elements that should inherit the parent cursor, add `style={{ cursor: 'inherit' }}`.

**Reference:** Commit `3f8b5ce` fixed this issue.

**Related issues:**
- https://github.com/tauri-apps/wry/issues/175
- https://github.com/tauri-apps/tauri/issues/2588
