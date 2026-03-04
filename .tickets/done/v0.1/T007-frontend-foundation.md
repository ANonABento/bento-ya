# T007: Frontend Types, Stores & IPC Wrappers

## Summary

Build the frontend data layer: TypeScript types matching the backend data model, Zustand stores for all state management, and IPC wrappers for communicating with the Tauri backend. This is the foundation every frontend component depends on.

## Acceptance Criteria

### TypeScript Types
- [ ] `Workspace` type matching DB schema (id, name, repo_path, tab_order, is_active, etc.)
- [ ] `Column` type (id, workspace_id, name, position, color, visible, etc.)
- [ ] `Task` type (id, workspace_id, column_id, title, description, branch, agent_type, agent_mode, position, etc.)
- [ ] `AgentSession` type (id, task_id, agent_type, pid, status, started_at, ended_at, token_usage)
- [ ] `AgentStatus` union type: `'running' | 'completed' | 'failed' | 'stopped' | 'needs_attention'`
- [ ] `AgentMode` union type: `'code' | 'architect' | 'debug' | 'ask' | 'plan' | 'review'`

### Zustand Stores
- [ ] `workspace-store.ts` — workspaces array, active workspace ID, tab order, CRUD actions
- [ ] `column-store.ts` — columns per workspace, reorder action, add/remove actions
- [ ] `task-store.ts` — tasks per workspace (grouped by column), move/reorder actions
- [ ] `terminal-store.ts` — active terminal task ID, terminal instances map
- [ ] `ui-store.ts` — current view ('board' | 'split'), active task ID, modal states
- [ ] All stores have actions that call IPC invoke wrappers
- [ ] Store actions update local state optimistically, then sync with backend

### IPC Integration
- [ ] Each store action calls the appropriate Tauri command via `ipc.ts`
- [ ] Event listeners set up in stores to receive backend updates
- [ ] Error handling: if backend call fails, revert optimistic update and show error

## Dependencies

- T001 (project scaffolding)

## Can Parallelize With

- T002, T003, T004, T005

## Key Files

```
src/
  types/
    index.ts            # Re-export all types
    workspace.ts        # Workspace type
    column.ts           # Column type
    task.ts             # Task type
    agent.ts            # AgentSession, AgentStatus, AgentMode types
  stores/
    workspace-store.ts  # Workspace state + actions
    column-store.ts     # Column state + actions
    task-store.ts       # Task state + actions
    terminal-store.ts   # Terminal instance state
    ui-store.ts         # View state, modals, active selections
  lib/
    ipc.ts              # Typed Tauri invoke/listen wrappers
```

## Complexity

**M** — Straightforward typing + store setup, but needs careful alignment with backend types.

## Notes

- Zustand stores should be minimal — no derived state in stores, compute in components or hooks
- Use `zustand/middleware` for `devtools` (dev only) and optionally `persist` for some stores
- Optimistic updates pattern:
  ```typescript
  moveTask: async (taskId, targetColumnId, position) => {
    // 1. Update local state immediately
    set(state => { /* move task in state */ })
    // 2. Call backend
    try {
      await invoke('move_task', { id: taskId, targetColumnId, position })
    } catch (e) {
      // 3. Revert on failure
      set(state => { /* revert */ })
      toast.error('Failed to move task')
    }
  }
  ```
- Types should match Rust struct field names exactly (serde defaults to camelCase for JS)
- Configure serde in Rust with `#[serde(rename_all = "camelCase")]` on all response structs
- Don't over-engineer stores — start with simple flat arrays, refactor to maps if performance needs it
- `terminal-store` manages which terminals are "alive" (have active PTY connections) vs which are just showing cached output
