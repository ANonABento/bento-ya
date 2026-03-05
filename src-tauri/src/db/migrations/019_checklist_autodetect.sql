-- 019_checklist_autodetect.sql: Add auto-detect fields to checklist items
-- For T028 - Checklist Auto-detect & Fix-This

ALTER TABLE checklist_items ADD COLUMN detect_type TEXT;
ALTER TABLE checklist_items ADD COLUMN detect_config TEXT;
ALTER TABLE checklist_items ADD COLUMN auto_detected INTEGER DEFAULT 0;
ALTER TABLE checklist_items ADD COLUMN linked_task_id TEXT;
