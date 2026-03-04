# T011: Split View Transition

## Summary

Build the split view: clicking a task card transitions the board into a two-panel layout — collapsed kanban on the left with expanded task details, terminal on the right. This is the core UX for "click a card, drop into the agent's terminal." Includes Motion shared element transitions.

## Acceptance Criteria

### Split View Layout
- [ ] Clicking a task card transitions from board view to split view
- [ ] Left panel (~240px): collapsed kanban showing only the active column
- [ ] Right panel (remaining width): terminal view for the selected task
- [ ] Esc key returns to full board view
- [ ] Back button in left panel header also returns to board view

### Left Panel — Task Detail
- [ ] Column header at top (column name)
- [ ] Active task card expanded vertically:
  - Title (editable inline)
  - Description / notes
  - Branch name (`bentoya/fix-auth`)
  - Status indicator (Running / Done / Failed)
- [ ] Changes section:
  - File count with aggregate +/- line counts
  - Expandable file list (click to see individual file stats)
- [ ] Commits section:
  - Commit count
  - Expandable list showing short hash + message
- [ ] Usage section (separate tile at bottom):
  - Agent type + model name
  - Token usage placeholder (input/output — actual tracking comes later)
  - Session duration (live timer for running agents)

### Animations (Motion)
- [ ] **Shared element**: Task card uses `layoutId={task-${task.id}}` — morphs from compact (board) to expanded (split view)
- [ ] **Board collapse**: Columns animate from full width to hidden, active column narrows to 240px — via `layout` prop + `animate={{ width }}`
- [ ] **Terminal slide-in**: Right panel slides in from right via `AnimatePresence` + `initial/animate/exit`
- [ ] **Close transition**: Reverse of open — terminal slides out, columns expand back
- [ ] All transitions use spring physics (stiffness: 300, damping: 28)
- [ ] Transitions are interruptible (clicking another card mid-transition works)

### Data Integration
- [ ] Left panel reads from `task-store` for task details
- [ ] Changes section calls git backend (`get_changes`) for file list
- [ ] Commits section calls git backend for commit list on task branch
- [ ] Usage section reads from `agent_sessions` data
- [ ] Terminal panel connects to PTY for the selected task (via T010)

## Dependencies

- T009 (kanban board — need the board to transition FROM)
- T010 (terminal view — need the terminal to transition TO)

## Can Parallelize With

- Nothing — this is the integration of board + terminal

## Key Files

```
src/
  components/
    layout/
      split-view.tsx                # Two-panel split layout container
    task-detail/
      task-detail-panel.tsx         # Left panel in split view
      changes-section.tsx           # Changed files list
      commits-section.tsx           # Commit list
      usage-section.tsx             # Token usage, cost, duration
  hooks/
    use-split-view.ts               # Split view state transitions
    use-git.ts                      # Git data fetching (changes, commits)
```

## Complexity

**L** — Animation choreography is complex. Shared element transitions + layout animations + coordinated timing.

## Notes

- Key Motion pattern for the shared element card:
  ```tsx
  // In board view AND split view, the same layoutId:
  <motion.div layoutId={`task-${task.id}`} layout>
    {isSplit ? <TaskCardExpanded /> : <TaskCardCompact />}
  </motion.div>
  ```
  Motion automatically animates between the two positions/sizes.

- Board collapse animation:
  ```tsx
  // Each column wrapper:
  <motion.div
    layout
    animate={{
      width: isSplit ? (isActiveColumn ? 240 : 0) : 'auto',
      opacity: isSplit ? (isActiveColumn ? 1 : 0) : 1,
    }}
    transition={{ type: 'spring', stiffness: 300, damping: 28 }}
  >
  ```

- The left panel in split view is NOT the same component as a column in board view — it's a dedicated `TaskDetailPanel` that renders inside the collapsed column area

- Changes and commits data should be fetched when entering split view (not preloaded for all tasks)

- Use `use-split-view.ts` hook to manage:
  - `isSplitView: boolean`
  - `activeTaskId: string | null`
  - `openSplitView(taskId)` — sets state, triggers animations
  - `closeSplitView()` — reverses

- xterm.js terminal needs to call `fitAddon.fit()` when the split view animation completes (container size changes during animation)

- Consider: when in split view, other cards in the active column should still be visible (scrollable list below the expanded card) but can be simplified for v0.1
