-- Drop deprecated legacy trigger columns.
-- All trigger configuration now lives in the V2 `triggers` JSON column (added in migration 023).

ALTER TABLE columns DROP COLUMN trigger_config;
ALTER TABLE columns DROP COLUMN exit_config;
ALTER TABLE columns DROP COLUMN auto_advance;
