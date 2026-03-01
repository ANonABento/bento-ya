-- Add session resume fields to agent_sessions
ALTER TABLE agent_sessions ADD COLUMN agent_type TEXT NOT NULL DEFAULT 'claude';
ALTER TABLE agent_sessions ADD COLUMN working_dir TEXT;
ALTER TABLE agent_sessions ADD COLUMN scrollback TEXT;
ALTER TABLE agent_sessions ADD COLUMN resumable INTEGER NOT NULL DEFAULT 0;

-- Index for finding resumable sessions
CREATE INDEX IF NOT EXISTS idx_agent_sessions_resumable ON agent_sessions(task_id, resumable);
