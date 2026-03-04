-- 018_notify_fields.sql: Add notification/stakeholder fields to tasks
-- For T027 - Notification Column Template

ALTER TABLE tasks ADD COLUMN notify_stakeholders TEXT;
ALTER TABLE tasks ADD COLUMN notification_sent_at TEXT;
