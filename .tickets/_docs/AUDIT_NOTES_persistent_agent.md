# Persistent Agent Audit Notes

Spec confirmation (§3): "The chat panel is a window, not a separate process."

## Existing GC/session infrastructure

- `src-tauri/src/chat/gc.rs:17` runs one GC cycle over `tmux_transport::list_sessions()`, kills orphaned `kaitencode_*` sessions when the task row is gone, and marks `agent_status = failed` when a task is still `running` but its tmux session disappeared (`src-tauri/src/chat/gc.rs:114`).
- `src-tauri/src/chat/gc.rs:152` starts periodic GC using `AppSettings::gc_interval_minutes`; `src-tauri/src/config/mod.rs:37` / `:39` / `:41` already define `gc_interval_minutes`, `idle_sleep_minutes`, and `idle_kill_hours`.
- `src-tauri/src/chat/registry.rs:232` has `suspend_idle()` and `src-tauri/src/chat/registry.rs:316` has `cleanup_dead_running_agent_sessions()`. The registry path currently skips PTY sessions when sweeping idle sessions (`src-tauri/src/chat/registry.rs:239`), so persistent tmux TTL belongs in existing `gc.rs`, not a new module.
- `src-tauri/src/chat/log_retention.rs:25` owns trigger log placement and retention; `run_startup_cleanup()` deletes legacy stubs and old trigger logs (`src-tauri/src/chat/log_retention.rs:125`).
- `src-tauri/src/chat/tmux_transport.rs:113` / `:122` / `:531` provide `has_session`, `kill_session`, and Ctrl+C cancellation primitives.

## Verified behavior and gaps

- Trigger lifecycle was per-trigger: `run_trigger_in_tmux()` killed any existing session before a trigger (`src-tauri/src/chat/bridge.rs:896` before this change) and killed the session again after completion (`src-tauri/src/chat/bridge.rs:1243` before this change).
- Task moves already interrupt running agents with Ctrl+C when moving to a non-trigger column in both Tauri IPC (`src-tauri/src/commands/task.rs:491`) and HTTP API (`src-tauri/src/api.rs:105`).
- Stop from the terminal panel already maps to Ctrl+C via `signal_pty_interrupt()` (`src-tauri/src/commands/terminal.rs:89`).
- Task delete now removes worktrees and explicitly calls `tmux_transport::kill_session()` before deleting the task from both Tauri IPC and HTTP API (`src-tauri/src/commands/task.rs`, `src-tauri/src/api.rs`).
- `agent_sessions.cli_session_id` already exists for resume (`src-tauri/src/db/agent_session.rs:161`), so Phase A reuses it as the saved Claude session id rather than adding `claude_session_id` yet.

## Phase A deltas

- Extend `src-tauri/src/chat/bridge.rs`:
  - `persistent_agent_lifecycle_enabled()` reads workspace flag `persistentAgentLifecycle` / `persistent_agent_lifecycle`, including nested `agent.*`, defaulting on unless explicitly false.
  - `trigger_session_plan()` and `ensure_trigger_session()` coalesce session lifecycle decisions: legacy existing session => kill/create; persistent existing session => reuse; missing session => create.
  - `build_trigger_command()` now accepts an optional resume id and threads `--resume <id>` into both Claude streaming and fallback branches.
  - `run_trigger_in_tmux()` skips `clear` and skips completion-time `kill_session()` when the workspace flag is enabled. Timeout cleanup still kills the session because the process is considered wedged.
  - The `claude-mock` special branch is removed from `build_trigger_command()`.

## Phase B-E deltas

- `src-tauri/src/commands/agent.rs::send_task_input()` is the task-chat IPC path. It saves the user message, stamps task user activity, ensures/reuses a PTY tmux session, writes the text plus Enter into that session, and emits the compatibility `agent:complete` event so existing queues drain.
- Task input uses `tmux send-keys -l` via `tmux_transport::send_text_line()`, matching the single tmux pane contract instead of writing through a separate task-chat Pipe process.
- `stream_agent_chat()` remains only as a thin compatibility wrapper around `send_task_input(..., "chat")`; the task-chat `TransportType::Pipe` request/response path was removed from that command. Orchestrator/chef Pipe usage is untouched.
- `src-tauri/src/db/migrations/038_persistent_agent_lifecycle.sql` adds `tasks.last_user_input_at` and `tasks.held_by_user`. `stamp_task_user_input()` sets both, while `set_task_held_by_user()` is the shared panel/card toggle source.
- `try_auto_advance()` in both `pipeline/engine.rs` and `pipeline/mod.rs` short-circuits when `task.held_by_user` is true and emits a deferred event.
- `AgentPanel` now exposes Hold, disabled-when-idle Stop, and confirmed Kill. Stop still sends Ctrl+C. Kill calls `kill_task_session()`.
- `get_pty_scrollback()` now returns tmux `capture-pane` output instead of an empty string, and `ensure_pty_session()` returns live tmux scrollback when attaching.
- Task cards moved Trash out of hover quick actions, reserve title padding for hover controls, show a held badge, expose hold/release through the overflow menu, and split a trailing workspace suffix out of the rendered title into metadata.

## §17 and §18 test coverage

- Added live tmux coverage for:
  - `tmux_transport::send_text_line_writes_to_existing_tmux_session`
  - `tmux_transport::cancel_agent_interrupts_without_killing_session`
  - `tmux_transport::kill_session_removes_task_tmux_session`
  - `chat::gc::collect_kills_orphaned_tmux_session`
  - `chat::bridge::concurrent_ensure_trigger_session_coalesces_to_one_tmux_session`
- The live tmux tests run under a test-only lock because GC intentionally kills orphaned `kaitencode_*` sessions, and parallel tmux tests otherwise race each other.
- Frontend regression coverage includes card quick-action deletion removal, move/retry action budget, keyboard delete confirmation, workspace suffix rendering, and panel Hold/Stop/Kill controls.
