# T023: Production Readiness Checklists

## Summary

Workspace-level checklists that guide projects to production readiness. Built-in templates (Security, Testing, Code Quality, etc.), custom checklists, manual check-off, progress tracking. The "Fix this" agent integration and auto-detect come in T028.

## Acceptance Criteria

- [ ] Clipboard icon in workspace header shows checklist progress (e.g., "72%")
- [ ] Click opens slide-over panel from right with full checklist
- [ ] Checklist organized by categories (collapsible sections with icons)
- [ ] Items checkable with manual toggle
- [ ] Optional notes per item (expandable text field)
- [ ] Overall progress bar at top
- [ ] Per-category progress (e.g., "Security 5/8")
- [ ] Built-in "Production Readiness" template with all categories from PRODUCT.md
- [ ] Additional templates: "Quick Ship", "API Service", "Desktop App", "Open Source"
- [ ] Create custom checklist from scratch
- [ ] Fork and customize built-in templates
- [ ] Export/import checklists as JSON
- [ ] Attach checklist when creating new workspace (template picker)
- [ ] Checklist data persisted in SQLite (Checklist, ChecklistCategory, ChecklistItem tables)

## Dependencies

- T020 (settings panel — for template management UI)

## Complexity

**L**
