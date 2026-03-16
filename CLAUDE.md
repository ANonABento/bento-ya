# Bento-ya Development Notes

## Column Triggers System

Unified automation layer for task lifecycle. Columns define `on_entry`/`on_exit` triggers, tasks can override. See `.tickets/_docs/TRIGGERS.md` for full spec.

**Key files:**
- `src-tauri/src/pipeline/triggers.rs` — V2 trigger types + execution
- `src-tauri/src/pipeline/template.rs` — Prompt variable interpolation
- `src-tauri/src/pipeline/dependencies.rs` — Task dependency resolution
- `src/components/kanban/column-config-dialog.tsx` — Column trigger config UI
- `src/components/kanban/task-settings-modal.tsx` — Task-level overrides

**How triggers route:** `fire_trigger()` in `pipeline/mod.rs` checks `column.triggers` JSON first (V2). If empty, falls back to legacy `trigger_config` (V1). Both coexist.

**Action types:** `spawn_cli` (spawn agent with resolved prompt), `move_column` (move task), `trigger_task` (poke another task), `none`.

**Dependencies:** Tasks can depend on other tasks. When a task completes (`mark_complete`), the dependency engine finds dependents, checks conditions, and executes `on_met` actions (usually moving blocked tasks to a ready column).

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
