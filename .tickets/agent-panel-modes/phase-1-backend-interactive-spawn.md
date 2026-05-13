# Phase 1 — Backend Interactive Spawn for Claude

## Context

You're implementing Phase 1 of a 6-phase plan to add an **interactive** runtime mode alongside bento-ya's existing **headless** (`claude -p`) mode. Today every trigger spawns `claude -p` regardless of the `runtime_mode` field on the action — both `terminal` and `managed` modes are headless variants. This phase makes a *truly* interactive mode work end-to-end at the backend layer, gated behind a dev flag so it doesn't affect existing users.

**Read first, in order:**
1. [`README.md`](README.md) in this folder — the rollout overview.
2. [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) — the full plan. Source of truth.
3. [`.tickets/_docs/INTERACTIVE_AGENT_TERMINAL.md`](../_docs/INTERACTIVE_AGENT_TERMINAL.md) — the April spec that anticipated this split. Sections 1, 4, 6, 7 most relevant.
4. `CLAUDE.md` § "Agent Execution — One Transport for Everything" and § "Terminal View (tmux-backed)".
5. `src-tauri/src/chat/bridge.rs:425-570` (current `build_trigger_command` + Claude shape) and `src-tauri/src/pipeline/triggers.rs:1212-1500` (current `execute_spawn_cli` dispatch).

## Goal

Spawning a Claude trigger with `runtime_mode = "interactive"` produces a fresh `claude` (no `-p`) process inside the task's tmux session, auto-injects the initial prompt via `tmux send-keys`, watches for a sentinel-based completion signal, and marks the task complete when seen — all without a frontend change.

## Scope (do this)

1. **Type-level mode taxonomy.** Extend `AgentRuntimeMode` in `src/types/column.ts` to include `'interactive'` (keep `'terminal'` and `'managed'` for backward compat — they remain headless variants). Mirror in `TriggerActionV2::SpawnCli.runtime_mode` parsing in `triggers.rs`.

2. **Build interactive spawn helper.** New function in `src-tauri/src/chat/bridge.rs`:
   ```rust
   pub(crate) fn spawn_interactive_claude(
       session_name: &str,
       cli_command: &str,
       args: &[String],
       initial_prompt: &str,
       task_id: &str,
       resume_id: Option<&str>,
   ) -> Result<InteractiveHandle>
   ```
   Steps inside:
   - Start `claude --dangerously-skip-permissions [args]` in the tmux session via `tmux new-session -d` (no `-p`). Use `-c <worktree_path>` so claude starts in the right directory.
   - If `exit_criteria` is `agent_complete` or `manual_approval`, append `--append-system-prompt "When you have finished the user's task, output exactly this line on its own and nothing else: <<<BENTOYA_DONE:{task_id}>>>"`.
   - Poll `tmux capture-pane -p` (up to 5s, ~100ms interval) waiting for Claude Code's input prompt indicator to appear. (Inspect the pane manually to find a stable indicator string — likely `╭` or `>` at the cursor row.)
   - Inject the prompt: `tmux send-keys -t <session> -l -- "<prompt>"` then `tmux send-keys -t <session> Enter`. The `-l` (literal) flag is critical — never construct keystrokes from unescaped content.
   - Return a handle the caller can use to register the completion watcher.

3. **Sentinel-based completion watcher.** New module or extend `src-tauri/src/chat/gc.rs` pattern:
   - Spawn a tokio task per interactive trigger that polls `tmux capture-pane -p -S -50` every 2s.
   - Strip ANSI escape codes before matching. Look for `<<<BENTOYA_DONE:{task_id}>>>` as a standalone line.
   - On match: call the same completion path `bridge::spawn_cli_trigger_task` uses today (`mark_complete` + emit `tasks:changed`).
   - 2-hour hard timeout (matches existing headless timeout).
   - Cancel the watcher if the task is moved out of the trigger column (existing cancel hook in `triggers.rs`).

4. **Dispatch in `execute_spawn_cli`.** In `src-tauri/src/pipeline/triggers.rs` around line 1471, after `normalize_agent_runtime_mode` resolves the mode, branch:
   - `"interactive"` AND `cli == "claude"` AND dev flag enabled → call new `spawn_interactive_trigger_task` (parallel to `spawn_cli_trigger_task`).
   - Anything else → existing path unchanged.

5. **Dev flag.** Add `BENTOYA_INTERACTIVE_MODE_ENABLED` env var check in `src-tauri/src/config/mod.rs`. When unset/false, treat any `runtime_mode = "interactive"` as `"terminal"` and log a one-time warning. Document the flag in the plan doc.

6. **Manual completion fallback.** The existing `mark_complete` Tauri command already exists. Verify it works against interactive-mode tasks (the agent is still running — `mark_complete` should send the kill signal first, then mark). Add a test.

## Scope (do NOT do)

- **No frontend changes.** No new components, no panel routing changes, no settings UI. Phase 2 handles that. The dev flag means no user can hit this path through the UI yet.
- **No Codex support.** Phase 3.
- **No idle-prompt-detector fallback.** Phase 1 is sentinel-only; if the sentinel fails, the 2-hour timeout fires. The fallback ships in Phase 6 once we have telemetry on sentinel reliability.
- **No model-switch / pause / inject-message commands.** Phase 2 and 5.
- **No DB migrations.** Phase 1 doesn't need the `runtime_mode_override` task column or `agent_paused_at` — those land in Phase 4.
- **No mode renaming.** Keep `'terminal' | 'managed' | 'interactive'` in the enum. The full collapse to `'headless' | 'interactive'` is a Phase 6 concern, if at all.

## Definition of done

1. `cargo check` and `cargo test` pass for the bento-ya workspace.
2. New unit tests:
   - `spawn_interactive_claude` builds the right command shape (no `-p`, has `--append-system-prompt` when sentinel needed, doesn't when not).
   - Sentinel regex matches the expected line and ignores false-positive substrings (e.g. agent mentioning the sentinel in passing inside a code block).
3. New integration test (`#[ignore]` if it needs a real `claude` binary): spawn an interactive Claude in a real tmux session, send a trivial prompt ("say done"), append-system-prompt with the sentinel, observe the watcher fire and `mark_complete` get called. Document how to enable.
4. Manual verification:
   - With `BENTOYA_INTERACTIVE_MODE_ENABLED=1`, create a task, set its column's `on_entry` trigger to `{"type":"spawn_cli","cli":"claude","runtime_mode":"interactive","prompt":"say done"}`, move task into the column. Confirm: the tmux session has interactive `claude`, you can attach and see the TUI, the agent receives the prompt, prints the sentinel, task auto-advances.
   - Without the env var, the same trigger config falls back to terminal/headless behavior with a log warning.
5. Plan doc updated with anything you learned (e.g. exact prompt indicator string used for ready-detection).

## Known gotchas

- **`tmux send-keys` quoting.** Use `-l` (literal) flag and a separate `Enter` send. Don't try to build a single send-keys with `\n` — tmux's parsing eats it differently than you'd expect.
- **ANSI in sentinel matching.** `tmux capture-pane -p` returns text with cursor positioning sequences. Strip with a `regex` crate substitution or `tmux capture-pane -p -J` (join wrapped lines) before regex.
- **Race: prompt sent before Claude ready.** If you `send-keys` before Claude finishes its startup banner, the keystrokes go into the void. The ready-poll must succeed before injection. If it times out (5s), fail loudly — don't silently inject anyway.
- **Existing completion path uses `tmux wait-for`.** Don't try to make `tmux wait-for` work for interactive mode — the agent never exits. Your watcher is a separate mechanism; don't conflate them.
- **The session name is `bentoya_<task_id>`.** Don't pick a new naming scheme — the interactive panel + GC + recovery all key on this.
- **Worktree cwd.** `resolve_working_dir()` in `triggers.rs` picks the worktree if present. Interactive spawn must respect this — start the tmux session with `-c <worktree>` so claude starts in the right directory.

## After you're done

Append a Phase 1 status section to [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) § Phasing noting:
- Phase 1 complete
- What the prompt-indicator string ended up being (the exact characters you matched on)
- Any deviations from the spec
- Anything Phase 2 should know

Then stop. Surface to the user for review before Phase 2 begins.
