# T003: Backend CRUD Commands

## Summary

Implement Tauri IPC command handlers for workspace, column, and task CRUD operations. These are the backend API surface that the frontend will call to manage board state.

## Acceptance Criteria

### Workspace Commands
- [ ] `create_workspace(name, repo_path)` → creates workspace, returns UUID
- [ ] `get_workspace(id)` → returns workspace data
- [ ] `list_workspaces()` → returns all workspaces ordered by `tab_order`
- [ ] `update_workspace(id, name?, repo_path?, tab_order?, is_active?)` → partial update
- [ ] `delete_workspace(id)` → removes workspace and all associated columns/tasks
- [ ] Creating a workspace auto-creates default columns (Backlog, Working, Review, Done)

### Column Commands
- [ ] `create_column(workspace_id, name, position)` → creates column
- [ ] `list_columns(workspace_id)` → returns columns ordered by `position`
- [ ] `update_column(id, name?, position?, color?, visible?)` → partial update
- [ ] `reorder_columns(workspace_id, column_ids[])` → bulk position update (for DnD)
- [ ] `delete_column(id)` → removes column (moves tasks to Backlog or errors if tasks exist)

### Task Commands
- [ ] `create_task(workspace_id, column_id, title, description?)` → creates task in given column
- [ ] `get_task(id)` → returns full task data
- [ ] `list_tasks(workspace_id)` → returns all tasks grouped by column
- [ ] `update_task(id, title?, description?, column_id?, position?, agent_mode?, priority?)` → partial update
- [ ] `move_task(id, target_column_id, position)` → move between columns (for DnD)
- [ ] `reorder_tasks(column_id, task_ids[])` → bulk position update within column
- [ ] `delete_task(id)` → removes task

### General
- [ ] All commands registered in Tauri's `invoke_handler`
- [ ] Error types defined with `thiserror` (NotFound, InvalidInput, DatabaseError)
- [ ] Commands return `Result<T, AppError>` with proper Tauri serialization
- [ ] Input validation (non-empty names, valid UUIDs, valid positions)
- [ ] Unit tests for each command handler

## Dependencies

- T002 (database schema)

## Can Parallelize With

- T004, T005, T007, T008, T009, T010

## Key Files

```
src-tauri/src/
  commands/
    workspace.rs    # Workspace CRUD commands
    column.rs       # Column CRUD + reorder commands
    task.rs         # Task CRUD + move/reorder commands
  error.rs          # AppError enum with thiserror
  lib.rs            # Register all command modules
  main.rs           # invoke_handler registration
```

## Complexity

**L** — Many endpoints, input validation, error handling, and proper Tauri command signatures.

## Notes

- Tauri v2 commands use `#[tauri::command]` attribute macro
- Commands receive `State<AppState>` for DB access
- AppState holds the DB connection (wrapped in `Mutex<Connection>` or connection pool)
- Default columns for a new workspace: Backlog (pos 0), Working (pos 1), Review (pos 2), Done (pos 3)
- `move_task` should update both `column_id` and `position` atomically
- `reorder_columns` and `reorder_tasks` take an ordered list of IDs and set positions accordingly
- All mutations should happen in a transaction
- Return serialized structs (not raw SQL rows) — define response types with `serde::Serialize`
