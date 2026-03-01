# T037: Checklist Persistence

## Summary

Checklists work in the UI but state only lives in client memory. Refresh the page and all progress is lost. Wire up database persistence.

## Current State

- Full checklist UI works (`src/components/checklist/`)
- Can check items, add notes, see progress
- State lives in Zustand store only (`src/stores/checklist-store.ts`)
- Backend has `checklists`, `checklist_categories`, `checklist_items` tables
- **Checklist state never synced to database**
- Page refresh = all checklist progress lost

## Acceptance Criteria

- [ ] Checklist item state (checked, notes) persists to database
- [ ] Load checklist state from database on mount
- [ ] Sync on every toggle/note change (debounced)
- [ ] Handle offline: queue changes, sync when reconnected
- [ ] Conflict resolution: last-write-wins or merge
- [ ] Checklist linked to task: `task.checklist_id`
- [ ] Multiple users: optimistic UI with server reconciliation

## Technical Notes

```typescript
// checklist-store.ts - add persistence layer
// Option 1: Sync each change immediately
// Option 2: Periodic batch sync (every 5s)
// Option 3: Sync on blur/unmount + periodic backup

// Backend commands needed:
// - update_checklist_item(item_id, checked, notes)
// - get_checklist_state(checklist_id) -> full state
```

## Dependencies

- None

## Complexity

**M** — Sync logic, conflict handling, optimistic updates
