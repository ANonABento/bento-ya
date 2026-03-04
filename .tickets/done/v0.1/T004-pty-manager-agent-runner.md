# T004: PTY Manager & Agent Runner

## Summary

Build the Rust-side PTY management system that spawns agent CLI processes (starting with Claude Code), manages their lifecycle, and streams terminal I/O. This is the core of "agents working in terminals."

## Acceptance Criteria

### PTY Manager
- [ ] Spawn a new PTY process with configurable command (default: `claude`)
- [ ] Each PTY gets a unique ID tied to a task
- [ ] PTY output streamed via Tauri events (`pty:{task_id}:output`)
- [ ] PTY input accepted via Tauri command (`write_to_pty(task_id, input)`)
- [ ] PTY resize supported (`resize_pty(task_id, cols, rows)`)
- [ ] PTY exit detected and reported via Tauri event (`pty:{task_id}:exit`)
- [ ] Scrollback buffer maintained per PTY (configurable limit, default 5000 lines)
- [ ] Multiple PTYs can run concurrently (up to configurable max, default 5)
- [ ] Clean shutdown: kill all PTYs on app exit

### Agent Runner
- [ ] `start_agent(task_id, agent_type, working_dir, branch?)` → spawns PTY with agent CLI
- [ ] `stop_agent(task_id)` → sends SIGINT, then SIGTERM after timeout, then SIGKILL
- [ ] `get_agent_status(task_id)` → returns running/stopped/failed + PID
- [ ] `list_active_agents()` → returns all running agent sessions
- [ ] Agent session recorded in `agent_sessions` table (start time, PID, status)
- [ ] Working directory set to the workspace's repo path
- [ ] Environment variables injectable per agent (for API keys, config)

### Tauri Integration
- [ ] All commands registered in invoke_handler
- [ ] Events emitted on the correct Tauri event channels
- [ ] PTY manager wrapped in `Arc<Mutex<PtyManager>>` for thread-safe access
- [ ] Async I/O via tokio (PTY reads happen on background tasks)

## Dependencies

- T001 (project scaffolding — needs Cargo.toml with dependencies)

## Can Parallelize With

- T002, T003, T005, T007, T008, T009

## Key Files

```
src-tauri/src/
  process/
    pty_manager.rs      # PTY spawning, I/O streaming, lifecycle
    agent_runner.rs     # Agent-specific logic (CLI selection, env vars, session tracking)
  commands/
    agent.rs            # Tauri IPC commands for agent control
    terminal.rs         # Tauri IPC commands for PTY I/O
```

## Complexity

**L** — Cross-platform PTY management, async I/O streaming, process lifecycle.

## Notes

- Use `portable-pty` crate for cross-platform PTY spawning
- `portable-pty::CommandBuilder::new("claude")` for Claude Code
- PTY output arrives as raw bytes — pass through as-is to xterm.js (it handles ANSI escape sequences)
- Use `tokio::spawn` for background PTY read loops
- Scrollback buffer: store recent output so when the frontend reconnects to a PTY (split view open/close), it can replay recent output
- For v0.1, only support `claude` (Claude Code CLI). Agent type is a string for extensibility.
- The `stop_agent` flow: SIGINT → wait 3s → SIGTERM → wait 5s → SIGKILL
- Consider `portable-pty::PtyPair` which gives you both master and slave
- PTY output streaming should be chunked (not byte-by-byte) for performance — buffer with small timeout (e.g., 16ms / 60fps)
- Test with a simple command first (like `bash`) before integrating with claude-code
