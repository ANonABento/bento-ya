# Changelog

## Unreleased

### Fixed

- **Done column triggers silently failed after worktree cleanup.** Tasks that
  completed the pipeline (Plan → Working → Merge main → Done) appeared to
  finish, but the Done agent never ran — Discord notifications, screenshots,
  and any other terminal-stage automation were silently dropped. Logs showed
  zsh's `getcwd: cannot access parent directories` because the persistent
  per-task tmux pane (`bentoya_<task_id>`) was rooted at the worktree that
  `cleanup_task_worktree_if_terminal` had just removed, and
  `ensure_trigger_session` reused that stale pane.

  Fix (option 1 from the RCA): terminal columns now force a fresh tmux
  session via a new `force_fresh` axis on `trigger_session_plan`. The
  decision is computed in `pipeline::triggers::execute_spawn_cli` from
  `pipeline::column_is_terminal` (now public) and plumbed through
  `bridge::spawn_cli_trigger_task` → `run_trigger_in_tmux` →
  `ensure_trigger_session`. Terminal-column triggers also skip worktree
  (re)creation and run in `workspace.repo_path`, with a belt-and-braces
  fallback for any other case where the resolved working dir is missing.

  Existing Plan / Working / Merge main behavior is unchanged — non-terminal
  columns still reuse the persistent session.
