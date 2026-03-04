# Task Card Enhancements

## Overview
Improve task card UX with better interactions, quick actions, and information display while maintaining the clean, uncluttered design.

---

## Phase 1: Core Interactions (Recommended) ✅

### 1.1 Right-click Context Menu ✅
- [x] Move to column (submenu with column list)
- [x] Open in split view
- [x] Run agent / Stop agent
- [x] Duplicate task
- [ ] Copy task link (TODO)
- [x] Archive task
- [x] Delete task

### 1.2 Quick Actions on Hover ✅
- [x] Show 2-3 icon buttons on card hover (top-right corner)
- [x] Icons: Open (expand), Run/Stop agent, More (opens context menu)
- [x] Fade in/out smoothly
- [x] Don't interfere with drag handle

### 1.3 Keyboard Shortcuts (when card focused) ✅
- [x] `Enter` - Open task in panel/split view
- [x] `Space` - Toggle agent status (run/stop)
- [x] `Delete/Backspace` - Show context menu for confirmation
- [x] `D` - Duplicate task
- [x] `M` - Move to column (shows context menu)
- [ ] `E` - Edit title inline (TODO)

### 1.4 Inline Status Toggle ✅
- [x] Click status dot to cycle: stopped → running → completed
- [x] Visual feedback on click (scale animation)
- [x] Keyboard accessible

### 1.5 Agent Activity Preview ✅
- [x] Show activity status based on agent/pipeline state
- [x] "Waiting for input..." when attention needed
- [x] "Agent idle" when stopped (within last hour)
- [x] Timestamp of last activity

---

## Phase 2: Visual Enhancements (Future)

### 2.1 Progress Indicator
- [ ] Subtle progress bar for tasks with subtasks/checklist
- [ ] "3/5 done" chip format
- [ ] Optional in card settings

### 2.2 Priority Indicator
- [ ] Colored dot or flag icon
- [ ] Levels: urgent (red), high (orange), medium (yellow), low (gray)
- [ ] Sortable by priority within column

### 2.3 Stale Task Indicator
- [ ] Subtle visual for tasks untouched for X days
- [ ] Configurable threshold in settings
- [ ] Muted card appearance or badge

### 2.4 Card Color/Tint
- [ ] User-selectable background tint per task
- [ ] Preset colors or custom
- [ ] Useful for visual categorization

---

## Phase 3: Information Display (Future)

### 3.1 Subtask Count
- [ ] "3/5" chip showing completion
- [ ] Click to expand subtask list inline
- [ ] Sync with checklist panel

### 3.2 Linked Issues
- [ ] Show Linear/GitHub issue badge
- [ ] Click to open in browser
- [ ] Sync status bidirectionally

### 3.3 Dependencies
- [ ] "Blocked by X" indicator
- [ ] "Blocking Y" indicator
- [ ] Visual connection lines (optional)

### 3.4 File Attachments
- [ ] Paperclip icon with count
- [ ] Hover to preview filenames
- [ ] Click to open attachment panel

---

## Phase 4: Performance & Polish (Future)

### 4.1 Skeleton Loading
- [ ] Animated placeholder while tasks load
- [ ] Match card dimensions

### 4.2 Virtualization
- [ ] For columns with 50+ tasks
- [ ] Use react-window or similar
- [ ] Maintain drag-drop compatibility

### 4.3 Collapse/Expand Description
- [ ] Click to show full description inline
- [ ] Smooth animation
- [ ] Remember state per task

### 4.4 Optimistic Updates
- [ ] Instant feedback on all actions
- [ ] Rollback on error with toast notification

---

## Implementation Notes

### Design Principles
- Keep cards clean - don't add visible clutter
- Progressive disclosure - show more on interaction
- Keyboard-first - all actions accessible via keyboard
- Consistent with existing UI patterns

### Files to Modify
- `src/components/kanban/task-card.tsx` - Main card component
- `src/components/kanban/task-context-menu.tsx` - New context menu
- `src/components/kanban/task-quick-actions.tsx` - New hover actions
- `src/hooks/use-task-shortcuts.ts` - New keyboard hook
- `src/stores/task-store.ts` - Add duplicate, archive actions

### Dependencies
- Context menu: Use Radix UI `@radix-ui/react-context-menu` or custom
- Keyboard: Use existing hotkey system or add new hook
