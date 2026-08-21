-- Persist the interactive "agent signaled done" advisory.
--
-- Interactive completion is advisory, not authoritative: the agent stays alive
-- at its prompt and the user decides when to advance. Until now that signal
-- was event-only (`agent:<task>:interactive_done`), so it existed solely while
-- the agent panel was mounted and listening. Close the panel and a finished
-- agent just looked idle -- the board had no way to know.
--
-- Epoch milliseconds, matching the `agent_paused_at` convention (migration
-- 044). NULL = the agent has not signaled done for the current run. Cleared
-- when the task advances or a new agent starts.

ALTER TABLE tasks ADD COLUMN agent_done_signaled_at INTEGER;
