# bento-ya

Tauri desktop app for orchestrating AI coding agents — an automated kanban board where columns are pipeline stages with trigger-driven automation.

## v2.0 Features

- **PR auto-create trigger** — columns can fire a `create_pr` action on exit to open a GitHub pull request when a task completes a stage (requires `gh` CLI installed and authenticated)
- **Per-task git worktree isolation** — each task can run in its own git worktree (`<repo>/.worktrees/bentoya-<taskId>/`), reducing local branch and worktree collisions between agents
- **DAG dependency UI with hover-reveal lines** — tasks define dependency relationships with cycle detection; bezier lines between cards appear on hover to visualize the dependency graph

## v2.1 — Embedded Terminal

- **Per-task embedded terminal** — each task gets a full xterm.js terminal (lazy PTY, bare shell in working dir). Click a task card to open its terminal.
- **xterm.js integration** — WebGL renderer, 10k line scrollback, fit-addon for responsive resizing, theme-reactive (dark/light), Unicode 11 support
- **Lazy PTY sessions** — shell spawned on first panel open via `ensure_pty_session`, killed on panel close. Triggers will inject CLI commands directly into the shell.
- **Unified chat session layer** — `UnifiedChatSession` manages lifecycle (idle/running/suspended), resume ID tracking, transport switching (pipe ↔ PTY)
- **Legacy process layer removed** — deleted `pty_manager.rs`, `agent_runner.rs`. All PTY/agent management through unified `SessionRegistry`
