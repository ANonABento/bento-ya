# MCP `create_task` doesn't expose `trigger_prompt`

> ✅ **RESOLVED 2026-06-05.** The `create_task` inputSchema now advertises
> `trigger_prompt` (plus `model`/`priority`/`dependencies`/`runtime_mode`), and
> `handle_create_task` forwards it in the `api_call` body. `/api/create_task`
> already persisted it via `create_task_service` before the on_entry trigger
> fires, so no backend change was needed. Covered by
> `test_create_task_persists_options`. Original ticket kept below for history.

Found during MCP dogfood audit, 2026-05-12. See `.tickets/_docs/MCP_DOGFOOD_REPORT.md`.

## Symptom

The Tauri `/api/create_task` endpoint accepts a `trigger_prompt: Option<String>` field that overrides the column-level trigger prompt for a specific task (`src-tauri/src/api.rs:178`). The MCP `create_task` tool does not expose this — a client has to call `create_task` then immediately `update_task` to set the prompt, which is awkward and racy with the on_entry trigger (the trigger fires inside `create_task` before the second call lands).

## Repro

1. Have a column `Working` with a generic `on_entry: spawn_cli` prompt like "Work on {task.title}".
2. From MCP, you want to create a task whose agent gets a more specific prompt for this one task (e.g. "Apply the patch in <gist URL> and run tests").
3. There's no way to do this in a single MCP call. The on_entry trigger fires with the generic prompt the moment `create_task` returns.

## Fix

`mcp-server/src/main.rs`:

1. Add to the `create_task` inputSchema (around line 213-225):
   ```rust
   "trigger_prompt": { "type": "string", "description": "Override the column's on_entry trigger prompt for this task only" }
   ```

2. In `handle_create_task` (line 818+), read it:
   ```rust
   let trigger_prompt = args.get("trigger_prompt").and_then(|v| v.as_str());
   ```

3. Include it in the api_call body:
   ```rust
   if let Some(resp) = api_call("/api/create_task", &json!({
       "workspace_id": ws_id,
       "column_id": col_id,
       "title": title,
       "description": description,
       "trigger_prompt": trigger_prompt,
   })) {
   ```

No backend changes needed — `CreateTaskReq` already has the field and the api handler already writes it before `fire_trigger`.

## Validation

- `cargo test -p kaitencode-mcp` still passes.
- Manual: MCP `create_task` with `trigger_prompt` → query DB → `trigger_prompt` is set. Spawn_cli trigger uses the task-level override.

## Acceptance

- `trigger_prompt` is a valid argument on the MCP `create_task` tool.
- When present, it is persisted on the task row before the on_entry trigger fires.
- Documented in `.tickets/_docs/MCP_SELF_TASK_WORKFLOW.md` as the right way to spec a one-off agent prompt without polluting the column config.
