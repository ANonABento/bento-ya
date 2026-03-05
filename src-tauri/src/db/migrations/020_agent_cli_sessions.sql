-- 020_agent_cli_sessions.sql
-- Update agent_sessions for CLI-based agents (replacing PTY-based)
-- Add agent_messages for persistent chat history

-- Add cli_session_id for --resume support
ALTER TABLE agent_sessions ADD COLUMN cli_session_id TEXT;

-- Add model and effort_level tracking
ALTER TABLE agent_sessions ADD COLUMN model TEXT DEFAULT 'sonnet';
ALTER TABLE agent_sessions ADD COLUMN effort_level TEXT DEFAULT 'default';

-- Create agent_messages table for persistent chat history per task
CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    model TEXT,
    effort_level TEXT,
    tool_calls TEXT, -- JSON array of tool calls made in this message
    thinking_content TEXT, -- Thinking block content if any
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_task ON agent_messages(task_id, created_at);

-- Update status check constraint to include new states
-- SQLite doesn't support ALTER CONSTRAINT, so we work with what we have
-- Status values: 'idle', 'running', 'complete', 'error'
