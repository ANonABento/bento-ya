-- 009_chat_sessions.sql
-- Multi-session chat support

-- Chat sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_workspace ON chat_sessions(workspace_id, updated_at);

-- Add session_id to chat_messages (nullable for migration)
ALTER TABLE chat_messages ADD COLUMN session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE;

-- Create default sessions for existing workspaces with messages
INSERT INTO chat_sessions (id, workspace_id, title, created_at, updated_at)
SELECT
    lower(hex(randomblob(16))),
    workspace_id,
    'Chat History',
    MIN(created_at),
    MAX(created_at)
FROM chat_messages
GROUP BY workspace_id;

-- Update existing messages to belong to default sessions
UPDATE chat_messages
SET session_id = (
    SELECT id FROM chat_sessions
    WHERE chat_sessions.workspace_id = chat_messages.workspace_id
    LIMIT 1
)
WHERE session_id IS NULL;

-- Create index for session lookups
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
