# T034: Pipeline Exit Criteria Evaluation

## Summary

The pipeline engine infrastructure exists but exit criteria evaluation always returns `false`. Wire up real checks so tasks can auto-advance between columns based on actual conditions.

## Current State

From `src-tauri/src/pipeline/mod.rs` lines 245-272:
```rust
"agent_complete" => {
    // TODO: Check if agent session completed successfully
    false  // HARDCODED - always fails
}
"script_success" => {
    // TODO: Check last script exit code
    false  // HARDCODED - always fails
}
"pr_approved" => {
    // TODO: Check GitHub PR status
    false  // HARDCODED - always fails
}
```

Only `checklist_done` has partial logic (checks JSON structure).

## Acceptance Criteria

### Exit Types to Implement

| Exit Type | Check Logic | Data Source |
|-----------|-------------|-------------|
| `manual` | Never auto-advance | N/A |
| `agent_complete` | Agent session status = "completed" | `agent_sessions` table |
| `script_success` | Last script exit_code = 0 | `tasks.last_script_exit_code` |
| `checklist_done` | All required items checked | `tasks.checklist` JSON |
| `pr_approved` | PR has approving review | GitHub API |
| `pr_merged` | PR is merged | GitHub API |
| `time_elapsed` | N seconds since trigger | `tasks.pipeline_triggered_at` |

### Implementation Checklist

- [ ] **agent_complete**: Query `agent_sessions` for task's linked session
  ```rust
  let session = get_agent_session_for_task(&conn, task_id)?;
  session.map(|s| s.status == "completed").unwrap_or(false)
  ```

- [ ] **script_success**: Check stored exit code
  ```rust
  task.last_script_exit_code.map(|code| code == 0).unwrap_or(false)
  ```

- [ ] **checklist_done**: Parse and check all items
  ```rust
  let checklist: Vec<ChecklistItem> = serde_json::from_str(&task.checklist)?;
  checklist.iter().filter(|i| i.required).all(|i| i.checked)
  ```

- [ ] **pr_approved**: GitHub API call
  ```rust
  let pr_number = task.pr_number.ok_or("No PR linked")?;
  let reviews = github::get_pr_reviews(repo, pr_number).await?;
  reviews.iter().any(|r| r.state == "APPROVED")
  ```

- [ ] **pr_merged**: GitHub API call
  ```rust
  let pr = github::get_pr(repo, pr_number).await?;
  pr.merged
  ```

- [ ] **time_elapsed**: Check triggered_at timestamp
  ```rust
  let triggered_at = task.pipeline_triggered_at.ok_or("Not triggered")?;
  let elapsed = Utc::now() - triggered_at;
  let timeout_secs = config.get("timeout").parse::<i64>()?;
  elapsed.num_seconds() >= timeout_secs
  ```

### Event-Driven Re-evaluation

Instead of polling, re-evaluate on events:
- [ ] Agent completion event → check agent_complete tasks
- [ ] Script exit event → check script_success tasks
- [ ] GitHub webhook → check pr_approved/pr_merged tasks
- [ ] Timer tick (1s) → check time_elapsed tasks
- [ ] Checklist toggle → check checklist_done tasks

### Debugging Support

- [ ] Add `debug_exit_criteria` command to test evaluation
- [ ] Log why criteria passed/failed
- [ ] Show evaluation result in task detail panel

## Technical Implementation

```rust
// src-tauri/src/pipeline/evaluator.rs (NEW FILE)

pub fn evaluate_exit_criteria(
    conn: &Connection,
    task: &Task,
    config: &ExitConfig,
) -> Result<(bool, String)> {
    let (met, reason) = match config.exit_type.as_str() {
        "manual" => (false, "Manual exit - user must move task".to_string()),

        "agent_complete" => {
            let session = get_agent_session_for_task(conn, task.id)?;
            match session {
                Some(s) if s.status == "completed" => (true, "Agent completed successfully".to_string()),
                Some(s) => (false, format!("Agent status: {}", s.status)),
                None => (false, "No agent session linked".to_string()),
            }
        }

        "script_success" => {
            match task.last_script_exit_code {
                Some(0) => (true, "Script exited with code 0".to_string()),
                Some(code) => (false, format!("Script exited with code {}", code)),
                None => (false, "No script has run".to_string()),
            }
        }

        "checklist_done" => {
            let items = parse_checklist(&task.checklist)?;
            let required = items.iter().filter(|i| i.required).collect::<Vec<_>>();
            let checked = required.iter().filter(|i| i.checked).count();
            if checked == required.len() {
                (true, format!("All {} required items checked", required.len()))
            } else {
                (false, format!("{}/{} required items checked", checked, required.len()))
            }
        }

        "pr_approved" => {
            // Requires GitHub integration
            match &task.pr_number {
                Some(pr) => {
                    let approved = check_pr_approved(pr)?;
                    (approved, if approved { "PR approved" } else { "PR not yet approved" }.to_string())
                }
                None => (false, "No PR linked to task".to_string()),
            }
        }

        "time_elapsed" => {
            let timeout = config.timeout.unwrap_or(300); // 5 min default
            match &task.pipeline_triggered_at {
                Some(triggered) => {
                    let elapsed = (Utc::now() - *triggered).num_seconds();
                    if elapsed >= timeout as i64 {
                        (true, format!("{}s elapsed (timeout: {}s)", elapsed, timeout))
                    } else {
                        (false, format!("{}s elapsed, waiting for {}s", elapsed, timeout))
                    }
                }
                None => (false, "Pipeline not triggered".to_string()),
            }
        }

        _ => (false, format!("Unknown exit type: {}", config.exit_type)),
    };

    log::debug!("Exit criteria '{}' for task {}: {} - {}", config.exit_type, task.id, met, reason);
    Ok((met, reason))
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/pipeline/mod.rs` | Replace stub with evaluator call |
| `src-tauri/src/pipeline/evaluator.rs` | NEW - Exit criteria evaluation logic |
| `src-tauri/src/db/task.rs` | Add last_script_exit_code field |
| `src-tauri/src/db/agent_session.rs` | Add get_session_for_task query |
| `src-tauri/src/commands/github.rs` | PR status checks (if not exists) |

## Database Changes

```sql
-- Migration: Add script tracking
ALTER TABLE tasks ADD COLUMN last_script_exit_code INTEGER;
ALTER TABLE tasks ADD COLUMN last_script_stderr TEXT;
```

## Dependencies

- T042 (Agent Trigger) - For agent_complete to have sessions
- T043 (Script Trigger) - For script_success to have exit codes
- T024 (PR Creation) - For pr_approved to have PR numbers

## Complexity

**L** - Multiple exit types, GitHub API integration

## Test Plan

1. **agent_complete**: Spawn agent, let it finish, verify advance
2. **script_success**: Run script with exit 0, verify advance; exit 1, verify no advance
3. **checklist_done**: Toggle all required items, verify advance
4. **time_elapsed**: Set 5s timeout, wait, verify advance
5. **pr_approved**: Create PR, approve it, verify advance (requires GitHub test account)
