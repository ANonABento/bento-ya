-- Track how long each task spends in each column for bottleneck analysis
CREATE TABLE IF NOT EXISTS pipeline_timing (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    column_id TEXT NOT NULL,
    column_name TEXT NOT NULL,
    entered_at TEXT NOT NULL,
    exited_at TEXT,
    duration_seconds INTEGER,
    success INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pipeline_timing_task ON pipeline_timing(task_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_timing_column ON pipeline_timing(column_id);
