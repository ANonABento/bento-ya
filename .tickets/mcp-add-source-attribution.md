# MCP-created tasks have no source attribution / recursion guard

Found during MCP dogfood audit, 2026-05-12. See `.tickets/_docs/MCP_DOGFOOD_REPORT.md` and `.tickets/_docs/MCP_SELF_TASK_WORKFLOW.md`.

## Problem

The MCP `create_task` tool gives any CLI agent (Claude Code, Cursor, choomfie) the ability to enqueue more tasks on the same board. There is no record on the resulting task of:

- Which agent / task / session created it.
- How deep into a recursive chain it is.
- Whether it was created by a human via UI vs by an agent via MCP.

Today's only ceiling is `DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS = 5` per workspace (`src-tauri/src/config/mod.rs:13`), which just queues tasks past the limit — it does not stop the chain.

A bad prompt or a confused agent can grow the board indefinitely. The user's safety net is currently the column-structure pattern in `MCP_SELF_TASK_WORKFLOW.md` ("outbox column with no triggers + manual approval before Done"). That's effective but advisory — a server-side stop would be better.

## Proposed: two-part fix

### Part 1 — attribution

Add a column on `tasks`:

```sql
-- new migration, e.g. 030_task_source_attribution.sql
ALTER TABLE tasks ADD COLUMN created_by_task_id TEXT;
ALTER TABLE tasks ADD COLUMN created_by_agent_session_id TEXT;
ALTER TABLE tasks ADD COLUMN recursion_depth INTEGER DEFAULT 0;
```

MCP `create_task` payload picks these up from a new env var the running agent sets at spawn time, e.g.:

```
BENTOYA_PARENT_TASK_ID=<task_id>
BENTOYA_PARENT_AGENT_SESSION_ID=<session_id>
BENTOYA_RECURSION_DEPTH=<n>
```

When `bridge::spawn_cli_trigger_task` spawns the agent, it sets these in the tmux session env. The MCP binary reads them at startup and includes them in every `create_task` payload. The API endpoint copies them onto the new task row and increments depth.

### Part 2 — depth limit

Add a setting in `~/.bentoya/settings.json`:

```json
{
  "mcp_max_recursion_depth": 3
}
```

Default 3 (user-created → agent → agent-spawned → child agent, then refuse). When MCP `create_task` is called with `BENTOYA_RECURSION_DEPTH >= max`, the API returns 429-ish error and the MCP returns `{"error": "Recursion depth exceeded (...)"}` instead of creating the task. The agent gets the error in its tool response and can decide what to do.

### Part 3 — UI affordances

- Task card shows a small "spawned by <parent title>" badge when `created_by_task_id` is set.
- Filter / search by "human-created" vs "agent-created."

## Acceptance

- New tasks created via MCP have `created_by_task_id` / `created_by_agent_session_id` populated when the calling agent was itself spawned by a trigger.
- `recursion_depth` correctly reflects chain depth.
- Exceeding `mcp_max_recursion_depth` returns an error from MCP `create_task` instead of creating the task.
- Existing user-created tasks (via UI) still work fine (all three new fields null/zero).
- Test in `mcp-server` that simulates the recursion limit and asserts the error path.

## Out of scope

Cycle detection across columns (column A spawns into column B which spawns back into A). That's a separate, harder problem — addressing it requires tracking the column lineage of a task. The depth limit above is a coarser but sufficient stop for the immediate runaway-recursion concern.
