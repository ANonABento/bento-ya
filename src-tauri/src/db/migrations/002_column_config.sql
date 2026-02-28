-- Add pipeline configuration fields to columns table
ALTER TABLE columns ADD COLUMN icon TEXT DEFAULT 'list';
ALTER TABLE columns ADD COLUMN trigger_config TEXT DEFAULT '{"type":"none","config":{}}';
ALTER TABLE columns ADD COLUMN exit_config TEXT DEFAULT '{"type":"manual","config":{}}';
ALTER TABLE columns ADD COLUMN auto_advance INTEGER DEFAULT 0;
