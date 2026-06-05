# KaitenCode MCP — Dogfood Report (2026-05-12)

Audit of the `kaitencode-mcp` stdio server (`mcp-server/src/main.rs`, ~2.4k LOC, 25 tools). Goal: can an agent inspect the board, mutate it, and avoid runaway recursion?

## TL;DR

- **Setup works.** Binary lives at `~/.cargo/bin/kaitencode-mcp` (or build with `cargo build -p kaitencode-mcp`). Auto-detects DB at `~/.kaitencode/data.db` with platform-specific fallbacks. Read tools work without the app; mutations require the app running (HTTP API on a port written to `~/.kaitencode/api.port`).
- ~~**No agent-level recursion guard.**~~ ✅ Fixed 2026-06-05: `mcp_max_recursion_depth` (default 3) is enforced in `/api/create_task` — a trigger-spawned agent whose task is already at the limit is refused. Attribution (`created_by_task_id` / `recursion_depth`) is threaded via `KAITENCODE_PARENT_*` env. The concurrency cap (`DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS = 5`) still applies on top. See `.tickets/done/mcp-add-source-attribution.md`.
- **Three concrete MCP bugs / inconsistencies found** (none catastrophic, all worth fixing). Each filed as a follow-up ticket under `.tickets/`.
- **CLAUDE.md drift fixed** in this branch: tool list, LOC count, and concurrency default now match the code.

## Setup status

### Binary

| Where | What |
|---|---|
| `mcp-server/Cargo.toml` | Cargo workspace member; depends on `rusqlite`, `ureq`, `chrono`, `uuid`, `dirs`, `clap`. |
| `mcp-server/src/main.rs` | Single-file impl. JSON-RPC over stdio. |
| `~/.cargo/bin/kaitencode-mcp` | Installed binary (verified present on dev box). |
| `~/.kaitencode/data.db` | Default DB path (primary). Fallback: `<data_dir>/com.kaitencode.desktop/kaitencode.db`, then `<data_dir>/com.kaitencode.app/kaitencode.db` for legacy installs. |
| `~/.kaitencode/api.port` | Port file the MCP uses to find the running app for mutations. |

Verified by reading `default_db_path()` (`mcp-server/src/main.rs:22-40`) and `read_api_port()` (`mcp-server/src/main.rs:76-80`).

### Client config

For Claude Code (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "kaitencode": { "command": "kaitencode-mcp" }
  }
}
```

For Cursor / Continue / choomfie: same `command` shape, no args needed unless you want to point at a different DB (`--db /path/to/data.db`).

### Health-check semantics

`is_app_running()` (`mcp-server/src/main.rs:86-102`) calls `GET http://127.0.0.1:<port>/api/health` and verifies the JSON body is `{ "data": { "status": "ok" } }`. This guards against stale `api.port` files where some other process now owns that port — a real fix for the false-positive case the comment calls out.

## Tool inventory (25)

Counted from `get_tools()` in `mcp-server/src/main.rs:194-481`.

- **Read-only (6):** `get_workspaces`, `get_board`, `get_task`, `list_scripts`, `list_pipeline_templates`, `get_pipeline_template`.
- **Task mutations (11):** `create_task`, `update_task`, `move_task`, `delete_task`, `approve_task`, `reject_task`, `mark_complete`, `retry_task`, `retry_from_start`, `add_dependency`, `remove_dependency`.
- **Workspace/column/script (5):** `create_workspace`, `create_column`, `configure_triggers`, `create_script`, `run_script`.
- **Pipeline templates (3):** `save_pipeline_template`, `apply_pipeline_template`, `delete_pipeline_template`.

## Tests

`mcp-server/src/main.rs` has `#[cfg(test)]` coverage for `get_workspaces`, `create_workspace`, `get_board`, `create_task`, `move_task`, `update_task`, `delete_task`, `approve_task`, `reject_task`, `create_column`, `list_scripts`, `create_script`, fuzzy workspace resolution, and unknown-tool error path (lines 2101-2461). Tests run in-memory and use the `cfg!(test)` direct-DB fallback — they do **not** exercise the API bridge.

I was unable to run `cargo test -p kaitencode-mcp` in this sandbox (no execute permission for cargo). The test code looks correct on inspection.

## End-to-end dogfooding

I was unable to invoke the live `mcp__kaitencode__*` tools in this session (permission gate). The walk-through below traces the call paths from the source.

### Read flow (no app required)

`get_workspaces`, `get_board`, `get_task` etc. open the SQLite DB directly. WAL mode is enabled (`PRAGMA journal_mode=WAL` at `mcp-server/src/main.rs:2048`) and the workspace shares the same `rusqlite` build as the Tauri app, so reads are safe even while the app is writing.

### Write flow (app required)

Most mutations call `api_call(endpoint, body)` which POSTs JSON to `http://127.0.0.1:<port>/api/<endpoint>`. Example: `handle_create_task` → `/api/create_task` → `api::create_task` → `db::insert_task` → `pipeline::fire_trigger` → `pipeline::emit_tasks_changed("api_task_created")`.

This is the correct path: it ensures the on-entry trigger of the destination column fires (so a task dropped into a `spawn_cli` column runs an agent immediately) **and** the UI gets a `tasks:changed` event.

### Inconsistencies

- `mark_complete` (line 1230), `add_dependency` (line 1107), `remove_dependency` (line 1175) **do not** call `api_call`; they `UPDATE tasks` directly. The app is still running (`mark_complete` even calls `require_app()` first), but no `tasks:changed` event is emitted from the MCP side. The UI relies on the periodic refresh / explicit re-fetch to catch up.

## Recursion / safety analysis

### Surface

Loop shape: `agent in column with spawn_cli` → `agent has kaitencode MCP configured` → `agent calls create_task` → `target column has spawn_cli` → another agent spawns → repeats.

### Existing safeguards

| Safeguard | Where | Effective scope |
|---|---|---|
| `DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS = 5` | `src-tauri/src/config/mod.rs:13` | Stops a 6th concurrent agent from spawning; queues it instead. Does NOT cap how many tasks get created. |
| `max_retries` on exit criteria | `src-tauri/src/pipeline/triggers.rs:202` | Limits same-task retries, not cross-task spawning. |
| Agent GC (idle-kill, 4 h default) | `src-tauri/src/chat/gc.rs` | Kills idle tmux sessions, not active spawning. |
| Per-task `retry_count` reset on success | `triggers.rs` | Doesn't apply to cross-task spawning. |
| `require_app()` on mutations | `mcp-server/src/main.rs:106-116` | Refuses MCP writes when app is down. Doesn't gate recursive writes. |

### Gaps

1. **No source attribution.** Once a task lands in the DB, there's nothing on the row that says "an agent created this" vs "a human created this." If you wanted a depth counter or per-agent quota you'd need a new column (e.g. `created_by_task_id` + `created_by_agent_session_id`).
2. **No MCP-side rate limit or quota.** A misbehaving agent calling `create_task` in a tight loop is bounded only by the HTTP API server's concurrency.
3. **No cycle detection on column-driven task chains.** If column A's `on_entry` agent creates a task in column B and column B's `on_entry` agent creates a task in column A, you have an infinite chain (concurrency cap will throttle but not stop it — the task in front of the cap just keeps creating tasks behind the cap).

### Pragmatic mitigation today

The current design intentionally pushes the responsibility to the **agent prompt**. A user can author trigger prompts that explicitly forbid calling `create_task` recursively, or that only allow creating tasks under a specific "outbox" column the user reviews manually. See `MCP_SELF_TASK_WORKFLOW.md` for the recommended pattern.

## Bugs / inconsistencies (filed as follow-ups)

| # | What | Severity | File | Status |
|---|---|---|---|---|
| 1 | `create_task` accepts `model` but the `/api/create_task` payload drops it | medium (silent no-op) | `.tickets/done/mcp-fix-create-task-model-dropped.md` | ✅ fixed — `handle_create_task` forwards `model`; regression test `test_create_task_persists_options` |
| 2 | `create_task` doesn't expose `trigger_prompt` (API supports it) | medium (feature gap) | `.tickets/done/mcp-fix-create-task-trigger-prompt.md` | ✅ fixed — schema + handler forward `trigger_prompt` (and `priority`/`dependencies`/`runtime_mode`) |
| 3 | `mark_complete` / `add_dependency` / `remove_dependency` bypass the API → no `tasks:changed` | low (stale UI) | `.tickets/done/mcp-fix-direct-db-no-events.md` | ✅ fixed — all three route through `/api/mark_complete` + `/api/set_dependencies`, which emit `tasks:changed`; direct DB only under `allow_db_fallback()` |
| 4 | No source attribution / recursion guard | medium (safety) | `.tickets/done/mcp-add-source-attribution.md` | ✅ fixed (Parts 1+2) — migration 046 attribution columns + `KAITENCODE_PARENT_*` env threading + `mcp_max_recursion_depth` guard (default 3) enforced in `/api/create_task`. Badge/filter UI + interactive-path env deferred |

## Recommendations

1. **Short-term:** ship the four follow-up tickets above. Each is a small, scoped change.
2. **Medium-term:** add a `MCP_RECURSION_LIMIT` env var on the binary (default 0 = off) that tracks tasks-per-minute per app-process and refuses further `create_task` calls past the limit. This is server-side, can't be bypassed by a poorly-written prompt.
3. **Doc:** keep `CLAUDE.md` MCP section diffed against the actual tool list — easy to drift again.

## Files touched in this branch

- `CLAUDE.md` — fix MCP tool count (19 → 25), LOC count, concurrency default (3 → 5), tool list, and note known gaps.
- `.tickets/_docs/MCP_DOGFOOD_REPORT.md` — this file.
- `.tickets/_docs/MCP_SELF_TASK_WORKFLOW.md` — safe self-task pattern.
- `.tickets/mcp-fix-create-task-model-dropped.md` — follow-up.
- `.tickets/mcp-fix-create-task-trigger-prompt.md` — follow-up.
- `.tickets/mcp-fix-direct-db-no-events.md` — follow-up.
- `.tickets/mcp-add-source-attribution.md` — follow-up.

## Checks run

- Read 2461 lines of `mcp-server/src/main.rs` end-to-end.
- Cross-referenced the tools against `src-tauri/src/api.rs` (route table at line 622-634).
- Cross-referenced the recursion claim against `DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS` (`src-tauri/src/config/mod.rs:13`).
- `cargo test -p kaitencode-mcp` — **blocked** (no permission in this sandbox). Recommend running it before merging the follow-up fixes.

## Blockers / next steps

- I could not run `cargo test`, `cargo check`, or invoke the live MCP tools from this session — the sandbox blocks both the binary and `cargo` commands. The findings here are source-only.
- All proposed fixes need verification with `cargo test -p kaitencode-mcp` + manual MCP test with the app running before merge.
