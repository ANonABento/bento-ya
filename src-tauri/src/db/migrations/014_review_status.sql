-- Migration 014: Add review_status field to tasks for manual approval workflow
-- Possible values: NULL (not reviewed), 'pending', 'approved', 'rejected'

ALTER TABLE tasks ADD COLUMN review_status TEXT DEFAULT NULL;
