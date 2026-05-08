-- Durable per-session input queue for runtimes that cannot accept live input.
--
-- Terminal-backed adapters can still deliver live text to tmux. Managed/API
-- adapters should persist user steering here while a turn is running and drain
-- the queue at the next safe provider turn boundary.
CREATE TABLE IF NOT EXISTS agent_runtime_input_queue (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    session_id TEXT,
    source TEXT NOT NULL,
    content TEXT NOT NULL,
    model TEXT,
    effort_level TEXT,
    delivery TEXT NOT NULL DEFAULT 'queued',
    status TEXT NOT NULL DEFAULT 'pending',
    sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_input_queue_task_status_sequence
    ON agent_runtime_input_queue(task_id, status, sequence);

CREATE INDEX IF NOT EXISTS idx_agent_runtime_input_queue_session_status_sequence
    ON agent_runtime_input_queue(session_id, status, sequence);
