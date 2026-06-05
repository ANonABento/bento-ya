# MCP-created tasks have no source attribution / recursion guard

> ✅ **RESOLVED 2026-06-05 (Parts 1 + 2).** Implemented:
> - **Migration 046** adds `created_by_task_id`, `created_by_agent_session_id`,
>   `recursion_depth` to `tasks` (in `TASK_COLUMNS` / `map_task_row` / `NewTask` /
>   `insert_task_full`; mirrored on the frontend `Task` type).
> - **Env threading:** `pipeline::execute_spawn_cli` sets `KAITENCODE_PARENT_TASK_ID`
>   + `KAITENCODE_RECURSION_DEPTH`; the bridge adds `KAITENCODE_PARENT_AGENT_SESSION_ID`
>   once the session exists; `run_trigger_in_tmux` exports them inline on the CLI
>   command (`attribution_env_prefix`, same idiom as the JSON-log vars) so the
>   agent's `kaitencode-mcp` child inherits them.
> - **MCP:** `recursion_attribution()` reads those env vars and threads them into
>   the `create_task` payload; `api_call` no longer swallows non-2xx bodies, so the
>   guard's rejection message reaches the agent.
> - **Recursion guard:** `AppSettings.mcp_max_recursion_depth` (default 3); the
>   `/api/create_task` handler calls `next_recursion_depth(parent_depth, max)` —
>   refuses with HTTP 429 when the spawning task is already at the limit, else
>   persists the child at `parent_depth + 1`. Human/UI creates are roots (depth 0,
>   never refused).
> - **Tests:** `next_recursion_depth` (api.rs), `attribution_env_prefix` (bridge.rs),
>   `insert_task_full` attribution round-trip (db), `recursion_attribution` env read
>   (mcp-server).
>
> **Deferred (Part 3 + follow-ups):** the task-card "spawned by …" badge and the
> human-vs-agent filter; a Settings UI control for `mcp_max_recursion_depth` (it's
> settable today via the settings API / `settings.json`); and env threading for the
> **interactive** and **managed** spawn paths (only the headless `terminal` path —
> the dominant case — exports the attribution env so far). Original ticket below.

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
KAITENCODE_PARENT_TASK_ID=<task_id>
KAITENCODE_PARENT_AGENT_SESSION_ID=<session_id>
KAITENCODE_RECURSION_DEPTH=<n>
```

When `bridge::spawn_cli_trigger_task` spawns the agent, it sets these in the tmux session env. The MCP binary reads them at startup and includes them in every `create_task` payload. The API endpoint copies them onto the new task row and increments depth.

### Part 2 — depth limit

Add a setting in `~/.kaitencode/settings.json`:

```json
{
  "mcp_max_recursion_depth": 3
}
```

Default 3 (user-created → agent → agent-spawned → child agent, then refuse). When MCP `create_task` is called with `KAITENCODE_RECURSION_DEPTH >= max`, the API returns 429-ish error and the MCP returns `{"error": "Recursion depth exceeded (...)"}` instead of creating the task. The agent gets the error in its tool response and can decide what to do.

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
