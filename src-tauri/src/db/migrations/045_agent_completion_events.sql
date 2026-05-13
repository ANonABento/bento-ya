-- Phase 4 (AGENT_PANEL_MODES.md) — completion-source telemetry.
--
-- Every time a task's agent completes (or is terminated), we append a row
-- here so we can measure how reliable each completion signal is. Phase 6
-- reads aggregates from this table to decide whether to ship the
-- idle-prompt-detector fallback.
--
-- completion_source values:
--   'sentinel'   — interactive watcher observed <<<BENTOYA_DONE:taskid>>>
--   'exit_code'  — headless `-p`/`exec` process exited (success or not)
--   'manual'     — user clicked Mark Complete / mark_pipeline_complete IPC
--   'timeout'    — 2h hard backstop fired in the watcher
--   'kill'       — user clicked Kill / agent_kill / cancel_task_agent
--
-- duration_ms is the wall-clock time from agent_started to this event.
-- sentinel_seen_at is set only when completion_source = 'sentinel'.

CREATE TABLE IF NOT EXISTS agent_completion_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    cli TEXT NOT NULL,
    mode TEXT NOT NULL,
    completion_source TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    sentinel_seen_at INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_completion_events_workspace
    ON agent_completion_events(workspace_id, created_at DESC);
