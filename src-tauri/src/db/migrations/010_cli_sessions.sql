-- 010_cli_sessions.sql
-- Add CLI session tracking for persistent Claude CLI conversations

-- Add cli_session_id to chat_sessions for resume fallback
ALTER TABLE chat_sessions ADD COLUMN cli_session_id TEXT;

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_chat_sessions_cli ON chat_sessions(cli_session_id);
