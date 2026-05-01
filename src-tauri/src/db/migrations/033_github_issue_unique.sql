CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_github_issue
    ON tasks(workspace_id, github_issue_number)
    WHERE github_issue_number IS NOT NULL;
