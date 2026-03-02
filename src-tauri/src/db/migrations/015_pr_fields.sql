-- Migration 015: Add PR fields to tasks for GitHub PR tracking
-- pr_number: The PR number (e.g., 123)
-- pr_url: The full PR URL (e.g., https://github.com/owner/repo/pull/123)

ALTER TABLE tasks ADD COLUMN pr_number INTEGER DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN pr_url TEXT DEFAULT NULL;
