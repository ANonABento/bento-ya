# Polish Backlog

> Lower-priority UI/UX improvements identified during testing (2025-03-15)

## UI/UX Issues

| ID | Issue | Severity | Notes |
|----|-------|----------|-------|
| P001 | Workspace tab drag spawns at wrong location | Low | Should spawn where cursor is |
| P002 | Repo path needs file picker button | Low | ✅ Complete |
| P003 | Columns not draggable | Medium | ✅ Complete (visible filter bug fixed) |
| P004 | Chef panel docking options | Medium | Allow side/top/bottom docking |
| P005 | Chef panel resize inconsistent | Low | Should use same resize util as sidebar |
| P006 | Voice settings missing download options | Low | Deferred (voice feature disabled) |
| P007 | Default settings tab should be Workspace | Low | Currently defaults to Appearance |
| P008 | Add "Coming Soon" indicators | Low | Mark unfinished features clearly |

## Implementation Notes

### P001 - Tab Spawn Location
- File: `src/components/layout/tab-bar.tsx`
- Track cursor position during drag, use for insert index

### P002 - Repo Path File Picker
- File: `src/components/settings/tabs/workspace-tab.tsx`
- Use `@tauri-apps/plugin-dialog` open() with directory:true

### P003 - Column Dragging
- File: `src/components/kanban/board.tsx`
- Add DndContext for columns (separate from tasks)

### P004/P005 - Chef Panel Docking
- Create shared `<DockablePanel>` component
- Support positions: left, right, top, bottom, floating
- Persist preference in settings

### P006 - Voice Download Options
- Only shows when voice feature enabled
- For now, mark as "Coming Soon" in UI

### P007 - Default Settings Tab
- File: `src/components/settings/settings-dialog.tsx`
- Change default tab index

### P008 - Coming Soon Indicators
- Add `comingSoon?: boolean` prop to settings sections
- Render badge/overlay on disabled features
