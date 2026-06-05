-- Source attribution + recursion guard for MCP-created tasks.
-- When a CLI agent (spawned by a column trigger) calls the MCP `create_task`
-- tool, the resulting task records who spawned it and how deep into a recursive
-- chain it is. Human/UI-created tasks leave these NULL / 0.
--   created_by_task_id            — the task whose agent created this one
--   created_by_agent_session_id   — that agent's session (best-effort)
--   recursion_depth               — 0 for human-created; parent_depth + 1 otherwise
ALTER TABLE tasks ADD COLUMN created_by_task_id TEXT;
ALTER TABLE tasks ADD COLUMN created_by_agent_session_id TEXT;
ALTER TABLE tasks ADD COLUMN recursion_depth INTEGER DEFAULT 0;
