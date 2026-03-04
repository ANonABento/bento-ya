# T009: Kanban Board (Columns + Cards + DnD)

## Summary

Build the main board view: columns rendered horizontally, task cards inside columns, and full drag-and-drop with @dnd-kit. This is the primary UI — what you see when you open the app. Includes Motion animations for card/column movement.

## Acceptance Criteria

### Board Layout
- [ ] Horizontal scrollable board area with columns side by side
- [ ] Each column has a header (name + drag handle) and card list area
- [ ] "+" button at end of column row (placeholder for adding columns — config comes in v0.2)
- [ ] Board fills the main content area of the layout shell
- [ ] Columns have min-width (~280px) and max-width (~360px)
- [ ] Board horizontally scrolls when columns exceed viewport

### Column Component
- [ ] Column header shows name and task count
- [ ] Column body holds task cards in a vertical list
- [ ] Empty column shows placeholder ("No tasks")
- [ ] Column has subtle background tint (using column color from data)
- [ ] Column is a DnD drag source AND drop target (for column reordering)

### Task Card Component
- [ ] Bento tile style: rounded corners (12px), surface background, subtle border
- [ ] Shows: title, agent type, branch name, status indicator (colored dot), duration timer
- [ ] Hover: subtle lift (translateY -2px + shadow) — via Motion
- [ ] Click: triggers split view transition (dispatches to ui-store)
- [ ] Right-click: context menu placeholder (stop, retry, archive — wired in later tickets)
- [ ] Card is a DnD drag source and sortable within its column

### Drag and Drop (@dnd-kit)
- [ ] Cards draggable within columns (reorder) and between columns (move)
- [ ] Columns draggable to reorder the pipeline
- [ ] Drag overlay: ghost card follows cursor during drag
- [ ] Drop zones: visual highlight when hovering over valid targets
- [ ] On drop: update task/column position in store → call backend → handle failure with revert
- [ ] Keyboard DnD support (activate with Space, navigate with arrows, drop with Space)

### Animations (Motion)
- [ ] Card appear: fade in + scale from 0.95, stagger 50ms between cards — `layout` prop
- [ ] Card reorder: smooth slide via `layout` prop with spring physics
- [ ] Card move between columns: spring animation (stiffness: 400, damping: 28)
- [ ] Card hover: `whileHover={{ y: -2, boxShadow: '...' }}`
- [ ] Column reorder: smooth slide via `layout` prop

### Data Integration
- [ ] Board reads from `column-store` and `task-store`
- [ ] On mount: fetch columns and tasks for active workspace via IPC
- [ ] DnD handlers call store actions (which call backend IPC)

## Dependencies

- T008 (dark theme + layout shell)

## Can Parallelize With

- T004, T005, T006

## Key Files

```
src/
  components/
    layout/
      board.tsx                 # Main board container (horizontal column layout)
    kanban/
      column.tsx                # Sortable column container
      column-header.tsx         # Column name, count, drag handle
      task-card.tsx             # Bento tile card (compact view)
      drag-overlay.tsx          # Ghost overlay during drag
  hooks/
    use-dnd.ts                  # DnD event handlers (onDragStart, onDragOver, onDragEnd)
```

## Complexity

**XL** — The most complex frontend ticket. DnD with multi-container sorting + animations + state management.

## Notes

- @dnd-kit architecture:
  ```tsx
  <DndContext onDragEnd={handleDragEnd} collisionDetection={closestCorners}>
    <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
      {columns.map(col => (
        <SortableColumn key={col.id} column={col}>
          <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
            {tasks.map(task => <SortableCard key={task.id} task={task} />)}
          </SortableContext>
        </SortableColumn>
      ))}
    </SortableContext>
    <DragOverlay>{activeItem && <DragOverlayContent item={activeItem} />}</DragOverlay>
  </DndContext>
  ```
- Use `closestCorners` collision detection for multi-container support
- Motion's `layout` prop handles the animation automatically when items reorder
- Wrap each card in `<motion.div layout>` for automatic layout animation
- Keep DnD handlers in a custom hook (`use-dnd.ts`) to keep the board component clean
- The tricky part: detecting whether a card is being moved within a column (reorder) vs between columns (transfer). @dnd-kit's `onDragOver` helps here.
- Performance: use `React.memo` on task cards to prevent unnecessary re-renders during drag
- Pointer sensor + keyboard sensor for accessibility
- Duration timer: show `HH:MM:SS` for running agents, static for completed
