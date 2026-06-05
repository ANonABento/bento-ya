# MCP `mark_complete` / `add_dependency` / `remove_dependency` bypass the API → stale UI

> ✅ **RESOLVED (verified 2026-06-05).** Fixed via option A. The routes
> `/api/mark_complete` and `/api/set_dependencies` exist (the latter serves both
> add/remove). `handle_mark_complete`, `handle_add_dependency`, and
> `handle_remove_dependency` all `api_call(...)` first and fall back to direct DB
> only under `allow_db_fallback()`. The API handlers emit `tasks:changed`
> (`mark_complete_with_error`; `dependencies::set_task_dependencies`), so the UI
> refreshes live. The `require_app()` check on `mark_complete` is now accurate.
> Original ticket kept below for history.

Found during MCP dogfood audit, 2026-05-12. See `.tickets/_docs/MCP_DOGFOOD_REPORT.md`.

## Symptom

Three MCP mutation tools write the SQLite DB directly without going through the Tauri HTTP API, so no `tasks:changed` event fires. The KaitenCode UI doesn't refresh in real time after these calls; it relies on whatever periodic / explicit re-fetch happens to come next.

Affected:

- `handle_mark_complete` (`mcp-server/src/main.rs:1230`) — calls `require_app()` (line 1231) but then runs `conn.execute("UPDATE tasks SET pipeline_state = ...")` directly (line 1247-1250). The `require_app()` check is misleading — it implies API routing.
- `handle_add_dependency` (`mcp-server/src/main.rs:1107`) — no `require_app()`, direct DB write at line 1154-1157.
- `handle_remove_dependency` (`mcp-server/src/main.rs:1175`) — no `require_app()`, direct DB write at line 1211-1214.

## Repro

1. App running. Watch the kanban board for a task.
2. From MCP, call `mark_complete(task: "<id>")`.
3. The MCP returns success; DB has `pipeline_state = 'completed'`.
4. The UI does not show the change immediately. Eventually a manual refresh / unrelated event will catch it.

(Same for `add_dependency` / `remove_dependency` — the new dep doesn't show on the card until the next refresh.)

## Why this matters

It's not a correctness bug — the data is consistent on disk. But it makes the MCP feel "broken" from a user perspective ("I told it to mark this done, why is the card still showing as running?"). And it sets a bad precedent: most MCP mutations now go through the API; these three are exceptions.

## Fix (option A — preferred)

Add three Axum routes mirroring the existing pattern:

`src-tauri/src/api.rs`:

```rust
.route("/api/mark_complete", post(mark_complete_api))
.route("/api/add_dependency", post(add_dependency_api))
.route("/api/remove_dependency", post(remove_dependency_api))
```

Each handler does the equivalent of the current MCP direct-DB write, then calls `pipeline::emit_tasks_changed(...)`. Then update the MCP handlers to use `api_call(...)` first and fall back to direct DB only under `cfg!(test)`.

## Fix (option B — quick)

If route-adding is unwanted, have the three MCP handlers emit a `tasks:changed`-equivalent through some lighter mechanism. There isn't a great option here today — the events come from the AppHandle, which the MCP binary doesn't have. So option A is cleaner.

## Fix (option C — workaround in MCP only)

After the direct-DB write succeeds, POST to a new `/api/notify_tasks_changed` endpoint that just emits the event. Single endpoint, no per-mutation handlers. Slightly hacky but minimal.

## Validation

- `cargo test -p kaitencode` — existing tests pass.
- `cargo test -p kaitencode-mcp` — existing direct-DB tests pass.
- Manual: `mark_complete` from MCP → UI updates within ~100 ms.

## Acceptance

- All three mutations route through the app API when the app is running.
- `tasks:changed` event fires for each.
- The `require_app()` check on `mark_complete` is no longer misleading.
