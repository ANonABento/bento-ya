-- 003_pipeline_state.sql
-- Add pipeline execution state tracking to tasks

-- Pipeline state: idle, triggered, running, evaluating, advancing
ALTER TABLE tasks ADD COLUMN pipeline_state TEXT DEFAULT 'idle';

-- When the pipeline trigger was fired (for timeout tracking)
ALTER TABLE tasks ADD COLUMN pipeline_triggered_at TEXT;

-- Last pipeline error message (for debugging/attention)
ALTER TABLE tasks ADD COLUMN pipeline_error TEXT;
