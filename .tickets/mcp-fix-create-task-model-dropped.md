# MCP `create_task` silently drops `model` parameter

Found during MCP dogfood audit, 2026-05-12. See `.tickets/_docs/MCP_DOGFOOD_REPORT.md`.

## Symptom

A client calls the kaitencode MCP `create_task` tool with `model: "sonnet"`. The tool advertises the parameter in its inputSchema (`mcp-server/src/main.rs:222`) and reads it into a local variable (`mcp-server/src/main.rs:852`). But when the app is running (production path), the value is silently dropped — the resulting task is created with `model = NULL` and the column's default model is used.

## Repro

1. Have the KaitenCode app running.
2. From any MCP client with kaitencode attached, call:
   ```json
   { "name": "create_task", "arguments": {
       "workspace": "<ws>",
       "column": "<col>",
       "title": "Test model",
       "model": "sonnet"
   }}
   ```
3. Observe the response: `"Created task 'Test model' in column ..."` — no error.
4. Query the task: `model` field is `null`.

## Root cause

`mcp-server/src/main.rs:855-865` (in `handle_create_task`):

```rust
if let Some(resp) = api_call("/api/create_task", &json!({
    "workspace_id": ws_id,
    "column_id": col_id,
    "title": title,
    "description": description,
})) {
    // ...
}
```

`model` is never included in the payload. The `CreateTaskReq` struct in `src-tauri/src/api.rs:173-179` also doesn't have a `model` field, so even if the MCP sent it, the API would ignore it.

The test-only `cfg!(test)` direct-DB fallback (line 879-882) does set `model`, which is why the unit tests pass.

## Fix

Two-file change:

1. **`src-tauri/src/api.rs`:** add `model: Option<String>` to `CreateTaskReq` and after `db::insert_task` (line 187-198) update the task model before firing the trigger:
   ```rust
   if let Some(ref model) = req.model {
       let ts = db::now();
       let _ = conn.execute(
           "UPDATE tasks SET model = ?1, updated_at = ?2 WHERE id = ?3",
           rusqlite::params![model, ts, task.id],
       );
   }
   ```
   Important: set before `pipeline::fire_trigger(...)` so the spawn_cli action sees the right model.

2. **`mcp-server/src/main.rs:855`:** include `model` in the `api_call` body:
   ```rust
   if let Some(resp) = api_call("/api/create_task", &json!({
       "workspace_id": ws_id,
       "column_id": col_id,
       "title": title,
       "description": description,
       "model": model,
   })) {
   ```

## Validation

- `cargo test -p kaitencode` — the existing `create_task` API tests should still pass.
- `cargo test -p kaitencode-mcp` — existing direct-DB tests still pass.
- Manual: with app running, MCP `create_task` with `model: "sonnet"` → query DB → `model = 'sonnet'`; spawn_cli trigger uses `--model sonnet`.

## Acceptance

- `model` field round-trips MCP → API → DB → task row.
- spawn_cli trigger uses the MCP-supplied model (visible in tmux session command line).
- Test added in `mcp-server/src/main.rs` that asserts the model is included in the api_call body (or, in the cfg!(test) path, that the column's spawn_cli sees the model).
