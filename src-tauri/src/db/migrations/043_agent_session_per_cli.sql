-- Per-CLI session id map for agent_sessions.
--
-- The legacy `cli_session_id` (single column) holds whichever id was last
-- captured by any CLI on a task. When pipelines mix CLIs (e.g.
-- claude → codex → claude) the column gets overwritten across stages, and
-- worse, a stale claude id from a previous app restart will be re-injected
-- into `claude --resume <id>` only to fail with "No conversation found".
--
-- We bucket session ids by adapter_kind so each CLI keeps its own slot.
-- `cli_session_id` is preserved (dual-written by the helpers) so callers
-- that haven't migrated yet still observe the most recently captured id.
ALTER TABLE agent_sessions ADD COLUMN cli_sessions TEXT;

-- Backfill: build a JSON object {"<adapter_kind>":"<cli_session_id>"} for
-- every existing row that already has a captured id. Use string concat so
-- this works even if SQLite was compiled without the JSON1 extension.
UPDATE agent_sessions
SET cli_sessions = '{"' || COALESCE(adapter_kind, 'claude_cli') || '":"' || cli_session_id || '"}'
WHERE cli_session_id IS NOT NULL
  AND cli_session_id <> ''
  AND cli_sessions IS NULL;
