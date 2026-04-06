# Polish Backlog

> Lower-priority UI/UX improvements identified during testing (2025-03-15)
> **Status: ALL RESOLVED** as of 2026-04-06.

## UI/UX Issues

| ID | Issue | Severity | Status |
|----|-------|----------|--------|
| P001 | Workspace tab drag spawns at wrong location | Low | ✅ Already handled by dnd-kit (SortableContext + arrayMove) |
| P002 | Repo path needs file picker button | Low | ✅ Complete — PathPicker shared component |
| P003 | Columns not draggable | Medium | ✅ Complete — visible filter bug fixed in use-dnd.ts |
| P004 | Chef panel docking options | Medium | ✅ Complete — bottom/right toggle, persisted in ui-store |
| P005 | Chef panel resize inconsistent | Low | ✅ N/A — no shared resize util exists, split-view is fixed 280px |
| P006 | Voice settings missing download options | Low | ✅ Deferred — voice feature disabled in build |
| P007 | Default settings tab should be Workspace | Low | ✅ Already set to 'workspace' in settings-store |
| P008 | Add "Coming Soon" indicators | Low | ✅ Complete — badges on git-tab + shortcuts-tab |
