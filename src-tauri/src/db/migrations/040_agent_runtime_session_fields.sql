-- Universal agent runtime/session metadata.
--
-- `agent_type` and `cli_session_id` remain for compatibility with the
-- existing terminal-native Claude/Codex paths. These fields make the session's
-- runtime contract explicit for future managed/API adapters.
ALTER TABLE agent_sessions ADD COLUMN adapter_kind TEXT;
ALTER TABLE agent_sessions ADD COLUMN runtime_mode TEXT NOT NULL DEFAULT 'terminal';
ALTER TABLE agent_sessions ADD COLUMN provider_session_id TEXT;
ALTER TABLE agent_sessions ADD COLUMN tmux_session_name TEXT;

UPDATE agent_sessions
SET
    adapter_kind = COALESCE(adapter_kind, agent_type, 'claude'),
    provider_session_id = COALESCE(provider_session_id, cli_session_id)
WHERE adapter_kind IS NULL OR provider_session_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_runtime
    ON agent_sessions(task_id, runtime_mode, adapter_kind);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_provider
    ON agent_sessions(provider_session_id);
