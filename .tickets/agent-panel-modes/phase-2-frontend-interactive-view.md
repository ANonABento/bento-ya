# Phase 2 — Frontend Interactive View + Live Input

## Context

Phase 1 shipped: with `BENTOYA_INTERACTIVE_MODE_ENABLED=1`, a trigger with `runtime_mode: "interactive"` spawns a real `claude` (no `-p`) in the task's tmux session, injects the prompt via `tmux send-keys`, watches for `<<<BENTOYA_DONE:{task_id}>>>` as the completion signal, and marks the task complete.

But there's no way for a user to *opt into* interactive mode through the UI yet, and the existing chat input box would silently spawn a parallel `claude -p` session if a user typed into it — bypassing the live agent entirely. Phase 2 fixes both: surface the mode toggle on tasks, route the agent panel correctly per mode, add a control bar, and make the input box feed the live TUI.

**Read first, in order:**
1. [`README.md`](README.md) in this folder.
2. [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) — full plan, Phase 2 section is your scope.
3. [`.tickets/_docs/INTERACTIVE_AGENT_TERMINAL.md`](../_docs/INTERACTIVE_AGENT_TERMINAL.md) — § 7 (Data Flow) is essential.
4. `CLAUDE.md` § "Frontend Components" and § "Chat System".
5. `src/components/panel/agent-panel.tsx`, `src/components/panel/terminal-view.tsx`, `src/hooks/chat-session/use-chat-session.ts`. Understand how the input box currently routes.
6. The Phase 1 status section in `AGENT_PANEL_MODES.md` § Phasing — note the exact prompt-indicator string that landed, and any deviations from the spec.

## Goal

A user can:
1. Open a task's settings modal and pick a runtime mode (Headless bubbles / Headless terminal / Interactive / Inherit from column).
2. When the task is in interactive mode and a trigger fires, the agent panel shows the real Claude Code TUI (xterm.js attached to the tmux session) with a control bar above it.
3. Type into the agent panel's input box and have those keystrokes injected into the live agent — not spawn a parallel `-p` call.
4. Interrupt the agent (Ctrl+C), switch its model mid-conversation (`/model <name>`), or restart the agent fresh, all from the control bar.

Settings-panel surfaces (workspace/global defaults) and pause/resume are out of scope — Phases 4 and 5.

## Scope (do this)

### Backend (small)

1. **`agent_inject_message` Tauri command** in `src-tauri/src/commands/` (likely `agent.rs`):
   ```rust
   #[tauri::command(rename_all = "camelCase")]
   async fn agent_inject_message(task_id: String, message: String) -> Result<(), AppError>
   ```
   - Looks up the tmux session `bentoya_<task_id>`. Errors clearly if not found.
   - Calls `tmux send-keys -t <session> -l -- "<message>"` then `tmux send-keys -t <session> Enter`.
   - Refuses to inject if the task's resolved runtime mode is `headless` (returns a typed error the frontend can surface as a UI hint).

2. **`agent_interrupt` Tauri command** — sends Ctrl+C via `tmux send-keys C-c`. Works in any mode. In interactive mode the agent stays alive at its prompt; in headless mode the `-p` process dies (matches today's "Stop" behavior).

3. **`agent_switch_model` Tauri command** — sends `/model <model>` + Enter via send-keys. Interactive mode only. Returns an error if the resolved mode is headless.

4. **`agent_restart` Tauri command** — sends `/exit`, waits for the shell prompt, then re-spawns the agent with the same trigger config but fresh session id. Reuse Phase 1's `spawn_interactive_claude` helper.

5. **Mode resolver helper** in `src-tauri/src/pipeline/triggers.rs` exposed as a Tauri command `resolve_runtime_mode(task_id)`:
   - Resolution order: trigger > task > column > workspace > global > default headless (matches plan § Configuration Hierarchy).
   - Returns `{ mode: "headless" | "interactive", render: "bubbles" | "terminal" | null, source: "trigger" | "task" | "column" | "workspace" | "global" | "default" }`.
   - **Phase 2 only implements** the trigger / column / default tiers — task/workspace/global storage backends are stubbed (always None until Phase 4). Hardcoded for now: trigger.runtime_mode (from action JSON) > column.triggers.default_runtime_mode (new optional field) > "headless"/"bubbles".
   - Don't add DB migrations — keep storage stubbed.

### Frontend

6. **Mode resolver hook** `src/hooks/use-resolved-runtime-mode.ts`:
   ```ts
   function useResolvedRuntimeMode(taskId: string): {
     mode: 'headless' | 'interactive'
     render: 'bubbles' | 'terminal' | null
     source: 'trigger' | 'task' | 'column' | 'workspace' | 'global' | 'default'
     isLoading: boolean
   }
   ```
   Calls `resolve_runtime_mode` invoke, re-fetches on `tasks:changed`.

7. **`InteractiveAgentView` component** `src/components/panel/interactive-agent-view.tsx`:
   - Thin wrapper around the existing `terminal-view.tsx` (don't duplicate xterm setup).
   - Control bar above the xterm canvas:
     ```
     ● Status  │  Model: <dropdown>  │  ⊘ Interrupt   ↺ Restart
     ```
   - Status indicator pulls from a new lightweight `agent_status(task_id)` query or piggybacks on the existing tasks-changed broadcast. Map: agent process alive + last output recent = running; alive + input prompt visible = idle; dead = stopped.
   - Model dropdown: lists `opus`, `sonnet`, `haiku` (read from settings store if there's already a model list). Disabled when status ≠ idle. On select → `agent_switch_model`.
   - Interrupt and Restart buttons wire to their respective commands. Confirmation modal on Restart.

8. **Agent panel dispatcher** — update `src/components/panel/agent-panel.tsx`:
   ```tsx
   const { mode, render, isLoading } = useResolvedRuntimeMode(taskId)
   if (isLoading) return <Skeleton />
   if (mode === 'interactive') return <InteractiveAgentView taskId={taskId} key={`int-${taskId}`} />
   if (mode === 'headless' && render === 'terminal') return <TerminalView taskId={taskId} key={`term-${taskId}`} />
   // default: existing chat-bubbles view
   ```
   The `key` prop forces full unmount on mode change. Keep the existing bubbles-rendering code path intact — it's still used for `headless + bubbles`.

9. **Chat input routing — the critical part.** In `agent-panel.tsx` (or wherever `<panel-input>` is wired):
   - When `mode === 'interactive'`, the submit handler calls `agent_inject_message` instead of `session.chat.send` / the chat-session hook's send path.
   - The existing `useChatSession` hook should not be instantiated at all when mode is interactive — it would establish a parallel `-p` stream that competes for billing and breaks the "you're talking to the live agent" mental model.
   - Visually: the input box looks the same, but the placeholder reads "Message Claude…" instead of "Send a prompt…" so users know it's live.
   - Queue / streaming state from `useChatSession` is hidden in interactive mode (no bubbles to queue against).

10. **Per-task runtime mode picker** in `src/components/kanban/task-settings-modal.tsx`:
    - New "Runtime" section.
    - Radio group: `Inherit from column (recommended)` / `Headless · bubbles` / `Headless · terminal` / `Interactive`.
    - "Effective: X (from Y)" hint below, populated from the resolver hook.
    - On change: PATCH the task with `runtime_mode_override` stored in `tasks.metadata` JSON (or whichever existing JSON column the task already has — don't add a new column yet). **Until Phase 4's resolver reads the task tier, this is a no-op pass-through** — document with a code comment ("Phase 4 wires the task tier into resolution; until then this field is set-only").

### Tests

11. **Vitest** for the resolver hook (mock the invoke) and for `InteractiveAgentView` rendering with various status states.
12. **Vitest** verifying the agent panel dispatcher renders the right child component for each mode/render combo.
13. **WebDriver E2E** (`tests/webdriver/`): create a task, open settings, set to interactive, observe the agent panel switches to the terminal-style view with the control bar. (Don't try to E2E the actual agent spawn — that's covered by Phase 1's tests.)

## Scope (do NOT do)

- **No settings-panel surfaces.** Workspace and global runtime-mode defaults are Phase 4.
- **No pause/resume.** Phase 5.
- **No Codex.** Phase 3.
- **No DB migration for `runtime_mode_override`.** Store in existing JSON metadata blob; full schema lands in Phase 4 with the settings work.
- **No idle-prompt-detector** as completion fallback. Phase 6.
- **No telemetry tables.** Phase 4.

## Definition of done

1. `cargo check && cargo test` and `npm run lint && npx tsc --noEmit && npm test` all pass.
2. New Tauri commands tested in `cargo test` (mock tmux interactions via the existing test helpers).
3. New Vitest tests pass.
4. New WebDriver test passes.
5. **Manual verification** with `BENTOYA_INTERACTIVE_MODE_ENABLED=1`:
   - Create a task, open settings, switch to Interactive.
   - Configure column with interactive trigger.
   - Move task in → agent panel shows Claude Code TUI + control bar.
   - Type "what is 2+2" in input box → message lands in the live agent → response streams in the terminal view.
   - Click Interrupt mid-response → Ctrl+C arrives, generation aborts, agent at prompt.
   - Click model dropdown → select sonnet → `/model sonnet` sent → confirm in pane.
   - Click Restart → fresh agent, same session, prompt reinjected.
6. **Negative test:** without the env var, the runtime-mode picker still shows but the resolver always returns headless. Confirm no interactive paths are reachable when the flag is off.
7. Update plan doc § Phasing with Phase 2 status.

## Known gotchas

- **`useChatSession` side effects.** That hook does a lot (registers event listeners, manages streaming state, owns the resume-id lifecycle). When you skip instantiating it in interactive mode, double-check no other component depends on the listeners it registers. Search for everywhere it's consumed.
- **Component remount on mode change.** If a user toggles a task from headless to interactive while the agent panel is open, the dispatcher must fully unmount the old view (closing event listeners) before mounting the new one. The `key` prop handles this — don't skip it.
- **Status detection.** "Agent at input prompt" vs "agent mid-response" is heuristic. The cheapest reliable signal is "no pane bytes received in the last N ms" (where N ~ 800-1500ms). Don't try to parse the TUI for definitive state — it'll break next Claude Code release.
- **Control bar disabled states.** Model dropdown disabled mid-response is critical UX — clicking `/model` while Claude is generating will inject a slash command into Claude's input, not switch the model. Don't ship without this guard.
- **The input box has IME/composition handlers** in current `panel-input.tsx`. Preserve them when routing to `agent_inject_message` — non-Latin input must still work.
- **xterm.js focus behavior.** When the user clicks in the xterm pane and types directly, those keystrokes go straight to tmux via the existing PTY bridge — bypassing your input box entirely. That's fine and intended; just make sure both paths can coexist without fighting for focus.
- **Restart timing.** `/exit` exits the agent process but leaves the tmux session's shell at a prompt. Wait for the shell prompt to be visible before respawning, or you'll send the new claude invocation into a half-dead state.

## After you're done

Append a Phase 2 status section to [`.tickets/_docs/AGENT_PANEL_MODES.md`](../_docs/AGENT_PANEL_MODES.md) § Phasing: what shipped, what was deferred, any UX choices that diverged from the spec. Note for Phase 3 (Codex): document whether `/model` slash command works on the Claude release you tested against, so Phase 3 knows what to verify on Codex.

Then stop. Surface to the user for review.
