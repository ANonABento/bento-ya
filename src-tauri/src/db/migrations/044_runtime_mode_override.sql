-- Phase 4 (AGENT_PANEL_MODES.md) — task-level runtime mode override.
--
-- Spec used migration number 030; we use 044 because 030 is already taken
-- by an earlier feature. Same semantics: NULL means "inherit from
-- column/workspace/global default", any of the runtime-mode tokens
-- ('terminal' | 'managed' | 'interactive') wins over column defaults at
-- resolution time.
--
-- `agent_paused_at` is the timestamp (epoch seconds) the user paused the
-- interactive agent via the Phase 5 pause control. NULL = not paused.

ALTER TABLE tasks ADD COLUMN runtime_mode_override TEXT;
ALTER TABLE tasks ADD COLUMN agent_paused_at INTEGER;
