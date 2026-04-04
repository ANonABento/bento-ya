# DAG Dependencies — Full Implementation Plan

## Current State

Backend dependency system is ~80% complete. Missing: cycle detection, visual rendering, manual creation UI.

### What Exists

```
Task.dependencies: JSON string → Vec<TaskDependency>
Task.blocked: bool

TaskDependency {
  task_id: String          // blocker task
  condition: String        // "completed" | "moved_to_column" | "agent_complete"
  target_column: Option    // for moved_to_column
  on_met: TriggerActionV2  // action when condition met
}

check_dependents() → find_dependents() → check_condition() → execute_on_met()
```

**Files:**
- `src-tauri/src/pipeline/dependencies.rs` — resolution engine (216 lines)
- `src-tauri/src/pipeline/triggers.rs` — TriggerTaskAction execution
- `src/components/kanban/task-settings-modal.tsx` — read-only dep display
- `src/components/kanban/task-card.tsx` — "Blocked by dependencies" badge

---

## Phase 1: Safety — Cycle Detection (Rust)

### Files to modify
- `src-tauri/src/pipeline/dependencies.rs`
- `src-tauri/src/commands/task.rs` (validate on update_task_triggers)

### Implementation

Add `validate_dependencies()` function:

```rust
/// Check if adding these dependencies would create a cycle.
/// Uses DFS to detect cycles in the dependency graph.
pub fn validate_dependencies(
    conn: &Connection,
    task_id: &str,
    new_deps: &[TaskDependency],
) -> Result<(), AppError> {
    // 1. Build adjacency list: task_id → Vec<depends_on_task_id>
    //    Include ALL existing deps from all tasks in workspace
    // 2. Add proposed new deps to the graph
    // 3. DFS from each new dep target back to task_id
    //    If we can reach task_id → cycle detected
    // 4. Also validate: no self-loops (dep.task_id != task_id)
    // 5. Also validate: referenced task_ids exist in DB
}
```

Edge cases:
- Self-loop: A depends on A
- Direct cycle: A→B→A
- Transitive cycle: A→B→C→A
- Deleted task referenced: validate existence
- Cross-workspace deps: reject (same workspace only)

### Tests
- `test_validate_no_cycle` — valid deps pass
- `test_validate_self_loop` — A→A rejected
- `test_validate_direct_cycle` — A→B, then B→A rejected
- `test_validate_transitive_cycle` — A→B→C, then C→A rejected
- `test_validate_nonexistent_task` — dep on deleted task rejected

---

## Phase 2: Dependency Creation UI (React)

### Files to modify
- `src/components/kanban/task-settings-modal.tsx` — replace read-only DependenciesTab

### DependenciesTab Redesign

```
┌─────────────────────────────────────────────┐
│ ⚠ Task is blocked (if blocked)              │
│   Waiting for: "Implement search API"       │  ← show actual task title
├─────────────────────────────────────────────┤
│ Depends On                          [+ Add] │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ 🔗 Implement search API        ✕ Remove │ │
│ │    Condition: completed                 │ │
│ │    On met: move to next column          │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ 🔗 Setup CI pipeline           ✕ Remove │ │
│ │    Condition: agent_complete            │ │
│ │    On met: none                         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ Add Dependency:                             │
│ Task: [dropdown of workspace tasks ▾]       │
│ When: [completed ▾]                         │
│ Then: [move to next ▾]                      │
│                        [Add Dependency]      │
└─────────────────────────────────────────────┘
```

Key behaviors:
- Dropdown shows all tasks in workspace EXCEPT current task and tasks that would create a cycle
- "When" options: completed, moved_to_column (shows column picker), agent_complete
- "Then" options: move to next, move to [column], trigger task, none
- Remove button deletes individual dep
- On save: calls `updateTaskTriggers` with new deps JSON + validates via backend
- Error displayed inline if cycle detected
- Show task titles instead of truncated IDs (fetch from task store)

### New IPC needed
- `validate_dependencies` command (calls `dependencies::validate_dependencies`)
- Returns `Ok(())` or `Err("Cycle detected: A → B → C → A")`

---

## Phase 3: Visual DAG Lines (React)

### Files to create
- `src/components/kanban/dependency-lines.tsx` — SVG overlay component
- `src/hooks/use-card-positions.ts` — track card DOM positions

### Architecture

```
Board
├── DndContext
│   ├── Column (sorted)
│   │   └── TaskCard (ref forwarded for position tracking)
│   └── ...
├── DependencyLines (SVG overlay, absolute positioned)
│   ├── <line> for each dependency
│   └── Hover highlights
└── OrchestratorPanel
```

### use-card-positions hook

```typescript
type CardPosition = {
  taskId: string
  rect: DOMRect  // bounding box
  columnId: string
}

function useCardPositions(tasks: Task[]): Map<string, CardPosition> {
  // 1. Create a Map<taskId, HTMLElement ref>
  // 2. Expose a register(taskId, element) function
  // 3. Use ResizeObserver + scroll listener to update positions
  // 4. Debounce updates (16ms = 60fps)
  // Return: Map<taskId, CardPosition>
}
```

### DependencyLines component

```typescript
function DependencyLines({ tasks, positions }: Props) {
  // 1. For each task with dependencies:
  //    - Get source position (blocker card)
  //    - Get target position (dependent card)
  //    - Draw curved bezier SVG path between them

  // 2. Line styling:
  //    - blocked (condition not met): amber dashed
  //    - met (condition satisfied): green solid
  //    - hover: thicker + glow

  // 3. Bezier curve calculation:
  //    - Cards in same column: curve left or right
  //    - Cards in different columns: horizontal bezier
  //    - Start: right edge center of blocker
  //    - End: left edge center of dependent

  // 4. Interaction:
  //    - Hover line → highlight both cards
  //    - Click line → open dependency details
}
```

### SVG Path Calculation

```
Same column (vertical):
  Start: card right edge, center Y
  End: card right edge, center Y
  Control points: offset right by 40px

Different columns (horizontal):
  Start: blocker card right edge, center Y
  End: dependent card left edge, center Y
  Control points: midpoint X, same Y as start/end

  Path: M startX,startY C cp1X,cp1Y cp2X,cp2Y endX,endY
```

### Performance
- Only render lines for visible cards (intersection observer)
- Debounce position updates during drag
- Hide lines during active drag (DndContext onDragStart/onDragEnd)
- Max ~50 lines before we switch to canvas

---

## Phase 4: Quick-Link Gesture (React)

### Files to modify
- `src/components/kanban/task-card.tsx` — add Cmd+drag handler
- `src/hooks/use-dnd.ts` — detect modifier key during drag

### Behavior
- Hold Cmd while dragging: switch from "move task" to "create dependency" mode
- Visual: dashed line follows cursor from source card
- Drop on another card: create dependency (source = blocker, target = where you started)
- Drop on empty space: cancel
- If would create cycle: show error toast, cancel

### Implementation
```typescript
// In useDnd hook:
onDragStart: (event) => {
  if (event.activatorEvent?.metaKey) {
    setDragMode('link')  // vs 'move'
  }
}

onDragEnd: (event) => {
  if (dragMode === 'link' && event.over?.data.current?.type === 'task') {
    createDependency(event.active.id, event.over.id)
  }
}
```

---

## Phase 5: Better Blocked UX (React)

### Files to modify
- `src/components/kanban/task-card.tsx` — enhance blocked badge

### Changes

1. **Show blocker task titles** instead of generic "Blocked by dependencies":
```tsx
// Parse dependencies, look up task titles from task store
const blockerNames = deps
  .filter(d => !isConditionMet(d))
  .map(d => tasks.find(t => t.id === d.task_id)?.title ?? 'Unknown')
  .join(', ')

<span>Waiting for: {blockerNames}</span>
```

2. **Click to jump**: click blocked badge → scroll to and highlight blocker task

3. **Unblock toast**: listen for `pipeline:unblocked` event → show toast with task name

---

## Implementation Order

```
Phase 1 (30 min)  → Safety: cycle detection + validation
Phase 2 (2-3 hrs) → UI: dependency creation in task settings
Phase 3 (2-3 hrs) → Visual: SVG lines on board
Phase 4 (1 hr)    → Gesture: Cmd+drag to link
Phase 5 (30 min)  → UX: better blocked badges + toasts
```

Total: ~7 hours

Phases 1-3 = MVP (shippable)
Phases 4-5 = Polish

---

## Data Flow (Complete)

```
User adds dependency (Phase 2 UI)
  ↓
validate_dependencies() — cycle check (Phase 1)
  ↓
updateTaskTriggers IPC → save to Task.dependencies JSON
  ↓
Task.blocked set to true if any dep not met
  ↓
Board renders → DependencyLines SVG overlay (Phase 3)
  ↓
Blocker task completes/moves
  ↓
fire_on_exit() → check_dependents()
  ↓
All deps met? → execute_on_met() + set blocked=false
  ↓
pipeline:unblocked event → toast + update lines
```

---

## Edge Cases to Handle

| Case | Handling |
|------|----------|
| Self-loop (A→A) | Reject in validate |
| Cycle (A→B→C→A) | DFS cycle detection |
| Deleted blocker | Treat as "not met", show warning |
| Deleted column (moved_to_column) | Treat as "not met" |
| Cross-workspace dep | Reject (same workspace only) |
| Task moved to different workspace | Orphan deps, auto-clean on next check |
| 50+ dependency lines | Switch to simplified rendering |
| Drag while lines visible | Hide lines during drag |
| Dependency on self column | Allow (valid for time-based conditions) |
