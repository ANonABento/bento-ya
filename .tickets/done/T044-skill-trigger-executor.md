# T044: Skill Trigger Executor

## Summary

When a task enters a column with trigger_type="skill", execute the configured skill/command. This enables Claude Code skills to be triggered automatically in the pipeline.

## Current State

From `src-tauri/src/pipeline/mod.rs`:
```rust
"skill" => {
    set_pipeline_state(&conn, task_id, "running", None)?;
    emit_pipeline_event(..., "Skill trigger fired");
    // BUT: No skill is actually executed!
}
```

## Acceptance Criteria

- [ ] When `fire_trigger` is called with type "skill":
  - [ ] Parse skill name from trigger config (e.g., "code-check", "create-pr")
  - [ ] Build skill invocation command for Claude CLI
  - [ ] Execute via agent runner with skill prompt
  - [ ] Capture skill output/result
- [ ] Common skill mappings:
  - [ ] `code-check` → Run type-check + lint + tests
  - [ ] `create-pr` → Create GitHub PR
  - [ ] `quality-check` → Deep code analysis
  - [ ] `custom` → User-defined skill name
- [ ] Task card shows skill name while running
- [ ] On skill completion, evaluate success and call `mark_complete`

## Technical Implementation

```rust
// In pipeline/mod.rs fire_trigger():
"skill" => {
    let skill_name = config.get("skill_name").ok_or("Missing skill name")?;
    let workspace_path = get_workspace_path(&conn, workspace_id)?;

    // Build skill prompt
    let prompt = match skill_name {
        "code-check" => format!("Run /code-check for task: {}", task.title),
        "create-pr" => format!("Run /create-pr for branch: {}", task.branch.unwrap_or_default()),
        "quality-check" => format!("Run /quality-check on recent changes"),
        _ => format!("Run /{} for task: {}", skill_name, task.title),
    };

    // Execute via CLI agent
    let session_id = agent_runner::start_agent(
        app_handle.clone(),
        "claude",  // Use Claude CLI for skills
        &workspace_path,
        Some(task_id),
        Some(prompt),
    ).await?;

    update_task_agent_session(&conn, task_id, session_id)?;
    set_pipeline_state(&conn, task_id, "running", None)?;
}
```

## Alternative: Direct Command Execution

For simple skills that map to shell commands:
```rust
let command = match skill_name {
    "code-check" => "npm run type-check && npm run lint",
    "test" => "npm test",
    _ => return Err("Unknown skill"),
};
// Execute as script trigger
execute_script(command, workspace_path, task_id);
```

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/pipeline/mod.rs` | Skill execution logic |
| `src-tauri/src/pipeline/skills.rs` | (NEW) Skill mapping and execution |
| `src-tauri/src/process/agent_runner.rs` | Support skill prompts |

## Skill Configuration Schema

```json
{
  "trigger_type": "skill",
  "skill_name": "code-check",
  "skill_args": "--fix",
  "on_failure": "stop"  // or "continue"
}
```

## Complexity

**M** - Builds on agent runner, main work is skill mapping

## Test Plan

1. Create column with trigger_type="skill", skill_name="code-check"
2. Move task into column
3. Verify: Type-check and lint run
4. Verify: Task advances on success, errors on failure
5. Test with custom skill name
