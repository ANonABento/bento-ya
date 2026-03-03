# T042: Agent Trigger Execution

## Summary

When a task enters a column with trigger_type="agent", actually spawn an agent process and associate it with the task. Currently the trigger config is saved but nothing executes.

## Current State

From `src-tauri/src/pipeline/mod.rs`:
```rust
"agent" => {
    // Update state to running
    set_pipeline_state(&conn, task_id, "running", None)?;
    emit_pipeline_event(app_handle, task_id, column_id, "running", "running", "Agent trigger fired");
    // BUT: No actual agent is spawned!
}
```

The agent runner exists (`src-tauri/src/process/agent_runner.rs`) but isn't called from the pipeline.

## Acceptance Criteria

- [ ] When `fire_trigger` is called with type "agent":
  - [ ] Parse agent type from trigger config (e.g., "claude", "codex")
  - [ ] Call `start_agent` with task context (task title, description, workspace path)
  - [ ] Store agent session ID on task record
  - [ ] Link agent output to task (events, terminal output)
- [ ] Agent session appears in terminal panel for the task
- [ ] Task card shows "Running" state with agent type badge
- [ ] On agent completion, call `mark_complete(task_id, success)`
- [ ] Handle agent failures gracefully (set pipeline_error, emit error event)

## Technical Implementation

```rust
// In pipeline/mod.rs fire_trigger():
"agent" => {
    let agent_type = config.get("agent_type").unwrap_or("claude");
    let workspace_path = get_workspace_path(&conn, workspace_id)?;

    // Spawn agent
    let session_id = agent_runner::start_agent(
        app_handle.clone(),
        agent_type,
        &workspace_path,
        Some(task_id),
        Some(format!("Implement: {}", task.title)),
    ).await?;

    // Link session to task
    update_task_agent_session(&conn, task_id, session_id)?;

    set_pipeline_state(&conn, task_id, "running", None)?;
    emit_pipeline_event(...);
}

// Need to add completion callback in agent_runner
pub fn on_agent_complete(task_id: i64, success: bool) {
    pipeline::mark_complete(task_id, success);
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/pipeline/mod.rs` | Add agent spawn logic in fire_trigger |
| `src-tauri/src/process/agent_runner.rs` | Add task_id param, completion callback |
| `src-tauri/src/db/task.rs` | Add agent_session_id field if needed |
| `src/stores/task-store.ts` | Handle agent session link |

## Dependencies

- T033 LLM Integration (COMPLETE) - Agent runner works
- T017 Orchestrator Agent (COMPLETE) - Chat system works

## Complexity

**M** - Wiring existing components, main work is the callback hookup

## Test Plan

1. Create column with trigger_type="agent", agent_type="claude"
2. Move task into column
3. Verify: Agent spawns in terminal panel
4. Verify: Task card shows "Running" with spinner
5. Let agent complete (or manually stop)
6. Verify: Task auto-advances to next column (if exit criteria = agent_complete)
