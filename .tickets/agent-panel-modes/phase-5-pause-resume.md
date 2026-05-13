# Phase 5 — Pause / Resume

## Context

The control bar from Phase 2 has Interrupt, Model switch, and Restart but no Pause. Pause is a softer signal than Interrupt — it suspends the agent process via SIGTSTP so the user can resume later without losing conversational state. Useful when a user notices the agent is going in the wrong direction but doesn't want to abort outright.

Phase 4 already added the `tasks.agent_paused_at` DB column. Phase 5 wires it up and exposes the controls.

**Read first:**
1. [`README.md`](README.md) in this folder.
2. Phase 1-4 status sections in [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) § Phasing.
3. The Phase 2 control bar component to see where the Pause button slots in.

## Goal

A user can pause an interactive agent (suspending the process) and resume it later. The UI reflects the paused state clearly. Pause is honest about its limitations: in-flight network calls don't actually pause.

## Scope (do this)

1. **`agent_pause` Tauri command**:
   - Sends `tmux send-keys C-z` to suspend the agent process (SIGTSTP).
   - Sets `tasks.agent_paused_at` to current epoch millis.
   - Emits `tasks:changed` for UI sync.
   - Errors if mode is headless (pausing a `-p` process that's racing to exit is nonsensical).
   - Errors if already paused.

2. **`agent_resume` Tauri command**:
   - Sends `tmux send-keys 'fg' Enter` to foreground the suspended process.
   - Clears `tasks.agent_paused_at` (set to NULL).
   - Emits `tasks:changed`.
   - Errors if not currently paused.

3. **Pause/Resume button** in the control bar (`InteractiveAgentView`):
   - Single button that toggles label based on `task.agent_paused_at`:
     - NULL → "⏸ Pause"
     - non-NULL → "▶ Resume"
   - Tooltip on hover: "Suspends the agent process. Active network requests will continue — use Interrupt for a hard stop."
   - Disabled in headless mode (mode shouldn't matter at all here since headless mode wouldn't even render this control bar — but defensive check anyway).

4. **Paused-state visualization**:
   - Status indicator dot turns yellow when paused.
   - Task card on the kanban board shows a small pause badge.
   - The xterm view shows a subtle banner: "Agent paused" (CSS overlay, doesn't block view of the suspended TUI).

5. **Recovery behavior**:
   - If the app restarts while a task is paused (`tasks.agent_paused_at IS NOT NULL`), the recovery path in `lib.rs` startup should leave the tmux session alone (the suspended process is still there) and surface the paused state in the UI.
   - GC: paused sessions should NOT be reaped by idle-kill — extend the GC's "is active" check to count paused as active. Otherwise a paused agent gets killed at the idle threshold.

## Scope (do NOT do)

- **No "pause headless" support.** It doesn't make sense and we already error in the command.
- **No advanced pause options.** No "pause after current tool call completes" or similar — just bare SIGTSTP. If users need more, file follow-up tickets.
- **No persistence of pause reason.** A user can pause for any reason; we don't track why.

## Definition of done

1. `cargo check && cargo test && npm run lint && npx tsc --noEmit && npm test` all pass.
2. New tests:
   - `agent_pause` / `agent_resume` happy path + error states.
   - GC test: paused session is not reaped at idle threshold.
3. Manual verification:
   - Pause a running agent → status indicator turns yellow → xterm shows agent process frozen (no new output).
   - Resume → agent continues from where it left off.
   - Pause, kill app, restart app → agent still paused, state surfaces correctly.
   - Pause an agent, wait past idle threshold → confirm GC didn't kill it.
4. Plan doc § Phasing updated.

## Known gotchas

- **SIGTSTP doesn't unpause network I/O.** A tool call that issued an HTTP request before pause will complete its request when the response arrives, but the agent won't process it until resumed. This is correct behavior; just don't market pause as "stops everything."
- **`fg` in tmux requires a shell that knows the job.** `tmux send-keys 'fg'` works in a typical bash/zsh shell because the agent was foregrounded when started. If the user has weird shell config that disables job control, `fg` might fail. Detect failure (resume command returns non-zero) and fall back to a clear error message.
- **Paused state in interactive mode only.** Don't accidentally let the headless completion watcher race against a paused agent — pause is a no-op in headless because we already block the command at the Tauri layer.
- **Race between pause and `/exit` or restart.** Restart while paused: must resume first then exit, or the suspended process won't accept the `/exit` keystroke. Handle in the restart command.

## After you're done

Append Phase 5 status to plan doc:
- Pause/resume works for interactive Claude — confirm
- Pause/resume works for interactive Codex — confirm (or note any difference)
- Any state-recovery edge cases discovered

Then stop. One phase remaining (polish + docs).
