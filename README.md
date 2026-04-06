# bento-ya

Tauri desktop app for orchestrating AI coding agents — an automated kanban board where columns are pipeline stages with trigger-driven automation.

## v2.0 Features

- **PR auto-create trigger** — columns can fire a `create_pr` action on exit to open a GitHub pull request when a task completes a stage (requires `gh` CLI installed and authenticated)
- **Per-task git worktree isolation** — each task can run in its own git worktree (`<repo>/.worktrees/bentoya-<taskId>/`), keeping agents on separate branches without conflicts
- **DAG dependency UI with hover-reveal lines** — tasks define dependency relationships with cycle detection; bezier lines between cards appear on hover to visualize the dependency graph
