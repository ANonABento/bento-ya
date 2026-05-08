-- Durable semantic transcript events for the agent panel.
--
-- This intentionally lives beside, not inside, agent_sessions.scrollback.
-- scrollback remains the raw terminal/tmux persistence layer; these events
-- are the replayable transcript model used by the primary Transcript view.
CREATE TABLE IF NOT EXISTS agent_transcript_events (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    session_id TEXT,
    event_type TEXT NOT NULL,
    content TEXT,
    metadata_json TEXT,
    sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_transcript_events_task_sequence
    ON agent_transcript_events(task_id, sequence);

CREATE INDEX IF NOT EXISTS idx_agent_transcript_events_session
    ON agent_transcript_events(session_id);
