# T034: Pipeline Exit Criteria (Wire Up Auto-Advance)

## Summary

The pipeline engine infrastructure exists but exit criteria evaluation always returns `false`. Wire up real checks so tasks can auto-advance between columns.

## Current State

From `src-tauri/src/pipeline/mod.rs` lines 245-272:
```rust
ExitCriteriaType::AgentComplete => {
    // TODO: Check if agent session completed successfully
    false  // HARDCODED
}
ExitCriteriaType::ScriptSuccess => {
    // TODO: Check last script exit code
    false  // HARDCODED
}
ExitCriteriaType::PrApproved => {
    // TODO: Check GitHub PR status
    false  // HARDCODED
}
```

Only `ChecklistDone` has basic (but incomplete) logic.

## Acceptance Criteria

- [ ] `agent_complete`: Check `agent_sessions` table for task's session status
- [ ] `script_success`: Track script exit codes, check last result
- [ ] `pr_approved`: Query GitHub API for PR review status
- [ ] `pr_merged`: Query GitHub API for PR merge status
- [ ] `checklist_done`: Check all required items marked complete
- [ ] `manual_approval`: Require explicit user action (button click)
- [ ] `time_elapsed`: Auto-advance after N seconds (for delays/cooldowns)
- [ ] Exit criteria re-evaluated on relevant events (agent finish, PR webhook, etc.)
- [ ] Logging/debugging: show why criteria passed/failed

## Technical Notes

```rust
// Need to add:
// 1. Agent session status tracking (success/failure/running)
// 2. Script execution result storage
// 3. GitHub API client for PR status
// 4. Event-driven re-evaluation (not polling)
```

## Dependencies

- T033 (LLM Integration) — for agent_complete to have real agent sessions

## Complexity

**L** — Logic is straightforward, mostly wiring existing data
