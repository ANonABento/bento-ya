-- Extend agent_sessions with CLI session tracking
ALTER TABLE agent_sessions ADD COLUMN cli_session_id TEXT;
ALTER TABLE agent_sessions ADD COLUMN model TEXT;
ALTER TABLE agent_sessions ADD COLUMN effort_level TEXT;

-- Agent messages table for persisting chat history per task
CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    effort_level TEXT,
    tool_calls TEXT,
    thinking_content TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_task ON agent_messages(task_id, created_at);
