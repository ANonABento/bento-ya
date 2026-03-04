# T035: History Replay Restoration

## Summary

The history panel shows past session snapshots but the "Replay" button does nothing. Wire up actual state restoration.

## Current State

- `src/components/history/history-panel.tsx` renders history UI
- "Replay" button exists (line 166) but `onReplay` callback is optional and never provided
- `session_snapshots` table stores snapshots with full state JSON
- No component passes `onReplay` prop to `HistoryPanel`
- Clicking "Replay" does nothing

## Acceptance Criteria

- [ ] "Replay" button triggers state restoration
- [ ] Confirmation dialog: "This will restore workspace to [timestamp]. Continue?"
- [ ] Restore workspace columns from snapshot
- [ ] Restore tasks (positions, states, content) from snapshot
- [ ] Option: "Restore as new workspace" vs "Overwrite current"
- [ ] Handle conflicts: tasks modified since snapshot
- [ ] Restore agent session states (if resumable)
- [ ] Success toast: "Restored to [snapshot name]"
- [ ] Undo: create pre-restore snapshot automatically

## Technical Notes

```typescript
// src/components/history/history-panel.tsx
// Need to:
// 1. Add onReplay handler to parent component
// 2. Call backend command to restore snapshot
// 3. Refresh stores with restored data

// Backend: add restore_snapshot command
// - Parse snapshot JSON
// - Update/replace columns and tasks
// - Emit refresh events
```

## Dependencies

- None

## Complexity

**M** — State restoration logic, conflict handling
