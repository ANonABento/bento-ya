# T012: Diff Viewer

## Summary

Build a basic inline diff viewer using Shiki for syntax highlighting. Shows file changes for a task's branch vs base — visible in the split view's changes section and as a standalone review view.

## Acceptance Criteria

- [ ] Render unified diff with syntax highlighting (Shiki)
- [ ] Side-by-side or inline view toggle (inline default for v0.1)
- [ ] Line numbers for both old and new versions
- [ ] Added lines highlighted green, removed lines highlighted red, context lines neutral
- [ ] File header shows filename + change stats (+N / -N lines)
- [ ] Multiple file diffs rendered in a scrollable list (one section per file)
- [ ] Diff data fetched from git backend via `get_diff(repo_path, branch, file_path?)` IPC command
- [ ] Expandable/collapsible per file (collapsed by default for large diffs)
- [ ] Language detection from file extension for correct syntax highlighting
- [ ] Dark theme colors for diff highlighting matching bento palette

## Dependencies

- T005 (git branch manager — provides diff data)
- T007 (frontend types & stores)

## Can Parallelize With

- T003, T004, T009, T010

## Key Files

```
src/
  components/
    review/
      diff-viewer.tsx           # Main diff rendering component
      review-actions.tsx        # Approve/reject buttons (placeholder for v0.1)
```

## Complexity

**M** — Shiki setup is straightforward, diff parsing needs care.

## Notes

- Shiki setup:
  ```typescript
  import { codeToHtml } from 'shiki'
  // Or use shiki's diff grammar for native diff highlighting
  ```
- Diff format from backend: standard unified diff format (from `git2`)
- Parse the unified diff to extract hunks, then render each hunk with proper line numbers
- Consider using a lightweight diff rendering library if parsing unified diffs manually is too complex — but Shiki + manual parsing is cleaner and smaller
- Diff colors (dark theme):
  - Added line bg: `rgba(74, 222, 128, 0.1)` (green tint)
  - Removed line bg: `rgba(248, 113, 113, 0.1)` (red tint)
  - Added line gutter: `#4ADE80`
  - Removed line gutter: `#F87171`
- For v0.1, this is a read-only viewer. Review actions (approve/reject that trigger column transitions) come in v0.2 with the pipeline engine.
- Keep it simple: one component, no virtual scrolling needed unless diffs are huge
- Shiki bundles ~2MB of WASM — lazy-load it (dynamic import) so it doesn't affect initial bundle size
