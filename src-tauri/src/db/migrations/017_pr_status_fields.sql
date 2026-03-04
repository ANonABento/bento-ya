-- Migration: Add PR/CI status fields to tasks
-- These fields are populated by GitHub API polling

ALTER TABLE tasks ADD COLUMN pr_mergeable TEXT;        -- 'mergeable', 'conflicted', 'unknown'
ALTER TABLE tasks ADD COLUMN pr_ci_status TEXT;        -- 'pending', 'success', 'failure', 'error'
ALTER TABLE tasks ADD COLUMN pr_review_decision TEXT;  -- 'approved', 'changes_requested', 'review_required'
ALTER TABLE tasks ADD COLUMN pr_comment_count INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN pr_is_draft INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN pr_labels TEXT DEFAULT '[]';        -- JSON array of label names
ALTER TABLE tasks ADD COLUMN pr_last_fetched TEXT;               -- ISO timestamp of last GitHub fetch
ALTER TABLE tasks ADD COLUMN pr_head_sha TEXT;                   -- Latest commit SHA for cache invalidation
