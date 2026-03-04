# T014: Multi-Workspace Tabs

## Summary

Add the centered browser-style tab bar for switching between workspaces. Each tab is a project/repo with its own board. Tabs are draggable to reorder. Two-finger swipe on trackpad switches tabs. Cmd+1-9 for quick switching.

## Acceptance Criteria

- [ ] Centered tab bar at top of app (like Arc browser)
- [ ] Each tab shows workspace name + notification badge (placeholder)
- [ ] "+" tab to add new workspace
- [ ] Click tab → switches board to that workspace's data
- [ ] Drag tabs to reorder (using @dnd-kit)
- [ ] Close tab button (workspace remains in DB, just deactivated)
- [ ] Cmd+1-9 keyboard shortcuts for tab switching
- [ ] Cmd+T to add new tab, Cmd+W to close current tab
- [ ] Two-finger swipe left/right on trackpad to switch tabs
- [ ] Tab switch animation: crossfade board content, active indicator slides
- [ ] Tab add animation: expand from 0 width, slide in from right
- [ ] Tab close animation: collapse, neighbors fill space

## Dependencies

- v0.1 complete

## Key Files

```
src/components/layout/tab-bar.tsx
src/hooks/use-swipe.ts
```

## Complexity

**L**
