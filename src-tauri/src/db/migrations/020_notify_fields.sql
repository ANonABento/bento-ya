-- Add notification/stakeholder fields to tasks
ALTER TABLE tasks ADD COLUMN notify_stakeholders TEXT;
ALTER TABLE tasks ADD COLUMN notification_sent_at TEXT;
