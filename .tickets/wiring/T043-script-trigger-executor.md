# T043: Script Trigger Executor

## Summary

When a task enters a column with trigger_type="script", execute the configured shell script and track its exit code. Currently config is saved but nothing executes.

## Current State

From `src-tauri/src/pipeline/mod.rs`:
```rust
"script" => {
    set_pipeline_state(&conn, task_id, "running", None)?;
    emit_pipeline_event(..., "Script trigger fired");
    // BUT: No script is actually executed!
}
```

## Acceptance Criteria

- [ ] When `fire_trigger` is called with type "script":
  - [ ] Parse script path from trigger config
  - [ ] Execute script with task context as env vars (TASK_ID, TASK_TITLE, WORKSPACE_PATH)
  - [ ] Stream script output to terminal panel
  - [ ] Capture exit code on completion
  - [ ] Store exit code for exit criteria evaluation
- [ ] Task card shows "Running" with script indicator
- [ ] On script completion:
  - [ ] If exit_type="script_success" and exit_code=0: auto-advance
  - [ ] If non-zero: set pipeline_error with stderr
- [ ] Support timeout configuration (default: 5 minutes)
- [ ] Support script arguments from config

## Technical Implementation

```rust
// In pipeline/mod.rs fire_trigger():
"script" => {
    let script_path = config.get("script_path").ok_or("Missing script path")?;
    let timeout_secs = config.get("timeout").and_then(|t| t.parse().ok()).unwrap_or(300);
    let workspace_path = get_workspace_path(&conn, workspace_id)?;

    // Build environment
    let mut env = HashMap::new();
    env.insert("TASK_ID", task_id.to_string());
    env.insert("TASK_TITLE", task.title.clone());
    env.insert("WORKSPACE_PATH", workspace_path);

    // Spawn script in PTY for output streaming
    let pty_id = pty_manager::spawn_command(
        app_handle.clone(),
        &script_path,
        &workspace_path,
        env,
        Some(task_id),
    ).await?;

    // Track for exit code capture
    track_script_execution(task_id, pty_id, timeout_secs);
}

// Callback when PTY exits:
fn on_script_exit(task_id: i64, exit_code: i32) {
    store_script_result(&conn, task_id, exit_code)?;
    let success = exit_code == 0;
    pipeline::mark_complete(task_id, success);
}
```

## Exit Criteria Update

In `evaluate_exit_criteria`:
```rust
"script_success" => {
    // Check stored exit code
    let result = get_last_script_result(&conn, task_id)?;
    result.map(|r| r.exit_code == 0).unwrap_or(false)
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/pipeline/mod.rs` | Script spawn logic, exit callback |
| `src-tauri/src/process/pty_manager.rs` | Add exit code capture, task_id tracking |
| `src-tauri/src/db/mod.rs` | Add script_results table or field |

## New Database Schema

```sql
-- Option A: Add to tasks table
ALTER TABLE tasks ADD COLUMN last_script_exit_code INTEGER;
ALTER TABLE tasks ADD COLUMN last_script_output TEXT;

-- Option B: Separate table for history
CREATE TABLE script_executions (
    id INTEGER PRIMARY KEY,
    task_id INTEGER NOT NULL,
    script_path TEXT NOT NULL,
    exit_code INTEGER,
    stdout TEXT,
    stderr TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

## Complexity

**M** - PTY manager exists, need to add exit tracking

## Test Plan

1. Create column with trigger_type="script", script_path="/path/to/test.sh"
2. Create test.sh that echoes and exits 0
3. Move task into column
4. Verify: Script output appears in terminal
5. Verify: Task advances when script exits 0
6. Test with exit 1 - verify error state, no advance
