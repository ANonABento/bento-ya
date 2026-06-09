-- Discord MVP (slice 2): map a task to the Discord thread that mirrors it.
-- One thread per task. KaitenCode is the source of truth; this is just the
-- thread bookkeeping so output/updates know where to post.
CREATE TABLE IF NOT EXISTS discord_task_threads (
    task_id    TEXT PRIMARY KEY,
    thread_id  TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
