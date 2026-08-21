# Agent Panel Modes — Headless + Interactive Runtime

> **Status: Shipped (phases 1–6) — 2026-05-13.** All six phases executed
> in a single push per the goal directive. See § Phasing for per-phase
> status and the § Phase 6 status / Retrospective at the bottom for the
> final decisions and known follow-up work.

> Original status: Planning. 2026-05-13.
> Builds on: [`INTERACTIVE_AGENT_TERMINAL.md`](INTERACTIVE_AGENT_TERMINAL.md) (2026-04-10) and [`UNIVERSAL_AGENT_RUNTIME.md`](UNIVERSAL_AGENT_RUNTIME.md) (2026-05-08).
> Scope: extend trigger runtime so each spawn can choose **headless** (`claude -p` / `codex exec`) or **interactive** (full TUI with prompt injection + live controls), surface the choice in UI + settings, and add interactive-mode runtime controls (stop, pause, model switch).

## Motivation

Two simultaneous drivers:

1. **Billing.** Starting 2026-06-15, paid Claude plans get a fixed monthly Agent SDK credit (Pro $20, Max 5x $100, Max 20x $200, [details](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)) that covers `claude -p` and Agent SDK invocations. Overage bills at standard API rates. Interactive `claude` sessions draw from the regular subscription interactive limits, not the Agent SDK credit. Users running heavy pipelines benefit from being able to opt into interactive mode for the workloads they want to supervise.
2. **UX.** Headless `-p` gives a clean event stream but the user is a passenger — they can't redirect mid-task, switch models, or chat with the running agent. Interactive mode lets the user actually intervene, which matches how a developer would use Claude Code locally.

The April spec (`INTERACTIVE_AGENT_TERMINAL.md`) anticipated this split with an `agent_mode: "interactive" | "headless"` field. Only the headless half shipped. This doc finishes the design and adds the runtime controls + settings UI that weren't scoped before.

## Status Quo (What Actually Ships Today)

Despite the type system having `AgentRuntimeMode = 'terminal' | 'managed'` (`src/types/column.ts:6`), **both modes spawn `claude -p`**:

| Existing mode | Spawn | Render |
|---------------|-------|--------|
| `terminal` (default) | `bridge::spawn_cli_trigger_task` → `claude -p --output-format stream-json` piped through jq into a tmux pane | xterm.js attached to `kaitencode_<task_id>` tmux session — user sees pretty-printed streaming |
| `managed` | `spawn_managed_trigger_task` → same `-p` flag, but events routed through `ManagedBridge` semantic stream | Chat-bubble UI in `agent-panel.tsx`, parses `agent:*` events |

Neither mode is *truly* interactive — both run `-p` and the user is read-only. Stop works (Ctrl+C via `tmux send-keys`), but model switch, pause, mid-task redirection don't exist for the running agent.

## Proposed Mode Taxonomy

Collapse the existing two modes into one **`headless`** family (with a UI-rendering sub-toggle: bubbles vs terminal) and add **`interactive`** as a peer.

```
RuntimeMode = 'headless' | 'interactive'

HeadlessRender = 'bubbles' | 'terminal'   // only meaningful when mode = headless
```

| Mode | CLI invocation | Frontend | Billing bucket (Claude) | User can intervene |
|------|---------------|----------|-------------------------|---------------------|
| `headless` (`bubbles`) | `claude -p --output-format stream-json` | Agent panel chat bubbles | Agent SDK credit → API rates | No (Stop only) |
| `headless` (`terminal`) | `claude -p` piped through jq | xterm.js, pretty terminal | Agent SDK credit → API rates | No (Stop only) |
| `interactive` | `claude` (no `-p`), prompt sent via `tmux send-keys` | xterm.js, real Claude Code TUI | Subscription interactive limits | Yes — type, /model, /clear, /exit |

Codex mirrors this exactly:

| Mode | CLI invocation |
|------|----------------|
| `headless` | `codex exec --json '<prompt>'` |
| `interactive` | `codex` (no exec), prompt sent via `tmux send-keys` |

### Why not a separate `chat-bubble-interactive` mode

Tempting (parse Claude Code's TUI output back into structured events) but a trap: Claude Code's terminal UI changes between releases, ANSI handling is fragile, and tool calls don't have a stable serialization. Not worth it. Interactive mode is xterm.js or nothing.

## Configuration Hierarchy

Mode resolution, narrowest wins:

```
trigger.runtime_mode              (highest priority — set on the action JSON)
  ↓ falls back to
task.runtime_mode_override        (NEW DB column, defaults NULL)
  ↓ falls back to
column.default_runtime_mode       (NEW — column-level default)
  ↓ falls back to
workspace.default_runtime_mode    (NEW — workspace config)
  ↓ falls back to
global settings.default_runtime_mode  (NEW — ~/.kaitencode/settings.json)
  ↓ falls back to
'headless'                        (preserves current behavior)
```

Same hierarchy applies to `headless_render` (bubbles vs terminal) when mode = headless.

### Settings storage

- Global: `~/.kaitencode/settings.json` — add `default_runtime_mode`, `default_headless_render`
- Workspace: `workspace_config` JSON — add `default_runtime_mode`, `default_headless_render`
- Column: existing `columns.triggers` JSON — add top-level `default_runtime_mode` (not nested under on_entry)
- Task: new migration adding `runtime_mode_override TEXT` column
- Trigger: existing `runtime_mode` field on `SpawnCliAction` — already wired

## Backend Changes

### `src-tauri/src/chat/bridge.rs`

`build_trigger_command` (line 425) currently always emits the `-p` shape. Split:

```rust
pub fn build_trigger_command(
    cli_command: &str,
    args: &[String],
    initial_prompt: &str,
    resume_id: Option<&str>,
    mode: RuntimeMode,
) -> TriggerCommand {
    match mode {
        RuntimeMode::Headless => TriggerCommand::Headless(
            build_headless_command(cli_command, args, initial_prompt, resume_id)
        ),
        RuntimeMode::Interactive => TriggerCommand::Interactive(
            build_interactive_spawn(cli_command, args, initial_prompt, resume_id)
        ),
    }
}
```

`Interactive` returns a struct, not a single shell string, because the spawn is multi-step:
1. Start CLI in tmux session (no prompt).
2. Wait for CLI ready state (prompt indicator visible in pane).
3. Inject prompt via `tmux send-keys -l -- "<prompt>"` followed by `tmux send-keys Enter`.
4. Register completion watcher (see below).

### `src-tauri/src/pipeline/triggers.rs`

`execute_spawn_cli` (line 1212): branch on resolved mode. Today it branches on `"managed"` vs default — change to branch on `Headless { render }` vs `Interactive`, both routed through tmux. Managed bridge stream is now just a *renderer choice* on top of headless spawn, not a separate spawn path.

`spawn_managed_trigger_task` (line 1509) stays but is only called when `mode = Headless && render = Bubbles`. The streaming JSON it parses is the same `--output-format stream-json` output.

### Completion detection for interactive mode

This is the hardest design choice. `tmux wait-for {channel}` doesn't work because interactive `claude` never exits. Three layered strategies, applied in order:

1. **System-prompt sentinel** (primary, conditional):
   Only appended when `mode = interactive AND exit_criteria.type in {agent_complete, manual_approval}`.
   ```
   claude --append-system-prompt "When you have finished the user's task, output exactly this line on its own and nothing else: <<<KAITENCODE_DONE:{task_id}>>>"
   ```
   Pane scraper polls `tmux capture-pane -p -S -50` every 2s for the sentinel. Robust against UI redraws because the sentinel is unique and includes the task id. For exit criteria like `manual`, `script_success`, etc., skip the append entirely.

2. **Idle prompt detector** (fallback): if the input prompt re-appears (parse the cursor row for the `>` indicator that Claude Code shows when awaiting input) and no output has changed for N seconds (configurable, default 60), assume done. Lower confidence — flag the task as "ready for review" instead of auto-advancing.

3. **Manual completion** (always available): user clicks "Mark Complete" or drags to next column. For columns with `exit_criteria: manual`, this is the only signal.

The exit criteria field on the column drives which signals are accepted:
- `agent_complete` — sentinel OR idle prompt detector
- `manual` — only user action
- `manual_approval` — sentinel + reviewer step
- `script_success`, others — unchanged

### Runtime controls (new commands)

New Tauri commands, all routed through the existing per-task tmux session:

```rust
#[tauri::command]
async fn agent_interrupt(task_id: String) -> Result<()>
//   sends Ctrl+C via `tmux send-keys -t kaitencode_<id> C-c`
//   in interactive mode: aborts current generation, agent returns to prompt (alive)
//   in headless mode: kills the -p process (terminates task)

#[tauri::command]
async fn agent_kill(task_id: String) -> Result<()>
//   kills the agent and ends the task. Used by the "End Task" affordance.
//   For interactive: `/exit` (or `/quit` for codex) + Enter, then tmux kill-session if needed
//   For headless: same as interrupt (the -p process dies anyway)

#[tauri::command]
async fn agent_pause(task_id: String) -> Result<()>
//   sends Ctrl+Z via `tmux send-keys` — SIGTSTP, agent suspends
//   tracked state: `tasks.agent_paused_at` (new column)
//   interactive only — headless agents shouldn't be paused (they're trying to exit)

#[tauri::command]
async fn agent_resume(task_id: String) -> Result<()>
//   sends `fg` + Enter to bring back the suspended process

#[tauri::command]
async fn agent_switch_model(task_id: String, model: String) -> Result<()>
//   sends `/model <model>` + Enter — Claude Code CLI slash command (works mid-conversation)
//   for codex: verify slash command works on current release; fall back to "restart with --model"
//   pre-validates: model is supported by current CLI, agent is at input prompt
//   interactive only

#[tauri::command]
async fn agent_inject_message(task_id: String, message: String) -> Result<()>
//   user types into the agent panel input box → routed here
//   `tmux send-keys -l -- "<message>"` + Enter
//   only valid in interactive mode
//   IMPORTANT: this MUST replace the chat-input routing for interactive-mode tasks in
//   `agent-panel.tsx` — otherwise the input box silently spawns a separate `-p` call
//   (the existing chat session path) instead of feeding the live TUI.
```

Pause has a caveat: SIGTSTP doesn't release network connections — long-running tool calls may not actually pause. Document this; suggest using Interrupt instead for hard interruption.

### DB migrations

Migration 030: add columns
```sql
ALTER TABLE tasks ADD COLUMN runtime_mode_override TEXT;
ALTER TABLE tasks ADD COLUMN agent_paused_at INTEGER;
-- workspace_config and global settings are JSON blobs, no schema change
```

No backfill — `NULL` means "inherit from column/workspace/global default."

## Frontend Changes

### Mode resolver hook

```ts
// src/hooks/use-resolved-runtime-mode.ts
function useResolvedRuntimeMode(taskId: string): {
  mode: 'headless' | 'interactive'
  render: 'bubbles' | 'terminal'  // only when mode = headless
  source: 'trigger' | 'task' | 'column' | 'workspace' | 'global' | 'default'
}
```

The `source` field powers the UI hint ("Inherits from Column default").

### Panel routing

`agent-panel.tsx` currently always renders chat bubbles. Becomes a dispatcher:

```tsx
const { mode, render } = useResolvedRuntimeMode(taskId)

if (mode === 'interactive') return <InteractiveAgentView taskId={taskId} />
if (mode === 'headless' && render === 'bubbles') return <ChatBubblesView taskId={taskId} />
if (mode === 'headless' && render === 'terminal') return <TerminalView taskId={taskId} />
```

`TerminalView` is the existing `terminal-view.tsx`. `InteractiveAgentView` is a new component (mostly a thin wrapper around `terminal-view.tsx` that adds the runtime control bar — see next section).

### Interactive control bar

Above the xterm canvas in `InteractiveAgentView`:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ● Running  │  Model: Opus ▾  │  ⏸ Pause   ⊘ Interrupt   ↺ Restart  │
└──────────────────────────────────────────────────────────────────────┘
```

- **Status indicator** — green dot (running), yellow (paused), red (failed), gray (idle/awaiting input).
- **Model dropdown** — calls `agent_switch_model`. Only enabled when status = idle/awaiting input (agent at prompt). Disabled with tooltip when mid-response. Claude `/model` works mid-conversation; Codex compatibility is verified per-release.
- **Pause / Resume toggle** — calls `agent_pause` / `agent_resume`. Tooltip warns network calls may not pause.
- **Interrupt** — calls `agent_interrupt` (sends Ctrl+C). In interactive mode the agent stays alive at its prompt — this is "stop the current generation," not "end the task." Confirmation modal if a tool call is in flight.
- **Restart** — kills agent, respawns with fresh session in same tmux pane. Useful after a hung tool call.
- **End Task** (in card menu, not control bar) — calls `agent_kill`. Closes the session entirely.

The agent panel's existing text input box becomes a live message injector in interactive mode — typed text routes to `agent_inject_message`, not to the chat session hook. This is a routing change in `agent-panel.tsx` / `use-chat-session.ts`, not a new component.

### Headless control bar (smaller, existing surface)

Already mostly there. Add only:
- Mode badge ("headless · bubbles" / "headless · terminal") showing resolved mode + source
- Quick "Switch to interactive" button → updates `task.runtime_mode_override` and respawns

### Mode picker UI

Three new surfaces:

1. **Task settings modal** (`src/components/kanban/task-settings-modal.tsx`):
   - Section "Runtime" with radio buttons: Headless (bubbles) / Headless (terminal) / Interactive / Inherit from column
   - Shows resolved mode preview ("Effective: Interactive (from task override)")

2. **Column config dialog** (`src/components/kanban/column-config-dialog.tsx`):
   - In the trigger config form, add "Default runtime mode" picker
   - Per-trigger override stays available under "Advanced"

3. **Settings panel** (`src/components/settings/`):
   - New tab or section in existing Agents tab: "Default runtime mode"
   - Same picker, applies to workspace default
   - Global default exposed in `~/.kaitencode/settings.json` editor

### Cross-mode column transitions

The April spec introduced `session_strategy: 'reuse' | 'fresh'` for keeping an agent alive across column transitions vs respawning. Mode taxonomy interacts with this:

- **Same mode on both columns + `reuse`** — keep the agent alive, inject the new column's prompt via `tmux send-keys` (interactive) or pipe a new `-p` invocation reusing `--resume <session_id>` (headless).
- **Different mode on the two columns** — `reuse` is invalid; force `fresh` (kill agent, respawn with the new column's mode). Document this in the column config UI: "Reuse only available when both columns use the same runtime mode."
- **`fresh` always** — works regardless of mode change. Kill, respawn with target column's resolved mode.

The resolver runs at column-entry time and reads the *new* column's mode, not the originating column's.

### Live attach to running agents

Already works for headless (`kaitencode_<task_id>` session persists, user can attach via terminal panel). For interactive, the attach point is the same — `terminal-view.tsx` attaches xterm.js to the tmux session whether it was spawned headless or interactive. The agent panel renders interactive view when mode = interactive, terminal view (raw) when mode = headless+terminal.

## Codex Parity

Codex has the same CLI shape: `codex exec '<prompt>'` (headless) vs `codex` (interactive REPL).

| Concern | Claude | Codex |
|---------|--------|-------|
| Headless spawn | `claude -p '<prompt>'` | `codex exec --json '<prompt>'` |
| Interactive spawn | `claude` then `tmux send-keys` | `codex` then `tmux send-keys` |
| Slash commands | `/model`, `/clear`, `/exit` | `/model`, `/clear`, `/quit` |
| System prompt append | `--append-system-prompt` | **none — codex has no such flag** (verified against codex-cli 0.145.0). Sentinel is folded into the injected prompt instead (`append_sentinel_to_prompt`). |
| Sentinel pattern | `<<<KAITENCODE_DONE:{id}>>>` | same |
| Resume | `--resume <session_id>` | `--resume <session_id>` |
| Billing model | Subscription plans, [Agent SDK credit](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) for headless | OpenAI API (no equivalent split — interactive vs headless billing is identical for Codex) |

Codex doesn't have the same billing motivation since its split isn't priced differently — but interactive mode is still useful for the UX (user can intervene). Codex parity is a "free" follow-on once Claude interactive ships.

## Migration

Existing columns, tasks, and triggers have no `runtime_mode` set → fall through to global default → defaults to `'headless'` → behavior unchanged.

First-launch / upgrade flow:
1. Run migration 030.
2. Global default stays `headless` for upgrades. **New installs** get prompted in onboarding: "Default to interactive mode? (Recommended if you're on a paid Claude plan and want to supervise your agents)."
3. No data migration required — the existing `runtime_mode: 'terminal' | 'managed'` field maps to `headless` (with render = terminal or bubbles). Add a one-time normalizer.

## Phasing

Roughly 5 phases. Each ships independently; no big-bang.

### Phase 1: Backend interactive spawn for Claude (1-2 days)

- `build_interactive_spawn` helper.
- `execute_spawn_cli` branch on `RuntimeMode::Interactive`.
- Sentinel-based completion detection.
- Manual completion fallback (user clicks done).
- Tests: spawn interactive claude, inject prompt, observe sentinel, mark complete.
- **No UI changes yet** — feature gated behind a flag in dev settings.

#### Phase 1 status — 2026-05-13

**Shipped.**

What landed:
- `src-tauri/src/config/mod.rs`: `KAITENCODE_INTERACTIVE_MODE_ENABLED` env-var dev
  flag + `interactive_mode_enabled()` reader.
- `src-tauri/src/chat/bridge.rs`:
  - `build_interactive_claude_argv()` — pure argv builder. No `-p`,
    optional `--resume`, optional `--append-system-prompt <sentinel>`.
  - `interactive_sentinel_system_prompt(task_id)` — produces the system
    prompt the agent must echo verbatim. Marker shape:
    `<<<KAITENCODE_DONE:{task_id}>>>` on its own line.
  - `strip_ansi()` — VT/CSI/OSC scrubber used by the sentinel matcher.
  - `pane_contains_sentinel()` — line-anchored match (after ANSI strip).
    Inline mentions ("I'll print …") and other-task ids are rejected.
    Sentinel inside a code block currently *does* match (documented
    false-positive direction; tightening it later means requiring the
    sentinel to be the trailing non-empty line — punted for Phase 6).
  - `pane_has_claude_prompt()` — readiness detector. Matches the
    box-drawing chars `╭` or `╰` from Claude Code's prompt-box border.
    These have shipped for many releases; tightening to a more specific
    indicator is cheap if it drifts.
  - `spawn_interactive_claude()` — runs `tmux new-session -d -s
    kaitencode_<id> -c <worktree> -- claude --dangerously-skip-permissions
    [args] [--append-system-prompt …]`, waits for the pane to be usable
    (prompt-box glyph as a fast path, else quiescence; 60s budget @ 100ms
    cadence; exhausting it injects anyway rather than killing), then
    injects the initial prompt
    via `tmux send-keys -t … -l <prompt>` + `Enter`. `tmux send-keys
    -l` (literal) is non-negotiable per the cross-cutting watch-out.
  - `spawn_interactive_trigger_task()` — public dispatcher analogue to
    `spawn_cli_trigger_task`. Creates the agent_session row, emits the
    `session_started` / `agent_started` transcript events, launches
    `spawn_interactive_claude`, then hands the lifecycle to
    `watch_interactive_sentinel`.
  - `watch_interactive_sentinel()` — 2s poll loop. Exits on: sentinel
    seen (success), tmux session gone (failed, exit_code synthetic
    137), task moved columns (cancel — no mark_complete), 2h timeout
    (failed, exit_code synthetic 124). On success, runs `mark_complete`
    and best-effort sends `/exit` to the TUI so it shuts down cleanly.
    On column-move, marks the agent_session `cancelled` and yields the
    task to whatever the new column's trigger decides.
  - `exit_criteria_needs_sentinel()` — gates sentinel inclusion. Only
    `agent_complete` and `manual_approval` get the sentinel; other
    criteria skip it to keep the system prompt minimal. The *mechanism*
    is per-CLI: claude uses `--append-system-prompt`, codex has no such
    flag and gets it folded into the prompt (`append_sentinel_to_prompt`).
- `src-tauri/src/pipeline/triggers.rs`:
  - `normalize_agent_runtime_mode` now takes the CLI name. Returns
    `"interactive"` only when the env flag is set AND CLI is `claude`.
    Otherwise downgrades to `"terminal"` with a one-time warning.
  - `execute_spawn_cli` branches: `managed` → existing managed path,
    `interactive` → `bridge::spawn_interactive_trigger_task` (reading
    column exit criteria to decide sentinel inclusion), else → existing
    `spawn_cli_trigger_task` path. **Backward-compatible by default.**
- `src/types/column.ts`: `AgentRuntimeMode` extended with
  `'interactive'` (kept `'terminal'`/`'managed'` for backward compat).
- `src/types/agent.ts`: `AgentMode` extended with `'interactive'` so the
  `task.agentMode` DB column round-trips. The `isRuntimeMode` predicate
  in `task-settings-modal.tsx` was widened to match.

Tests added:
- `bridge::tests::test_interactive_sentinel_prompt_embeds_task_id`
- `bridge::tests::test_build_interactive_claude_argv_*` (no `-p`,
  appends sentinel only on demand, threads `--resume`, ignores blank
  resume id)
- `bridge::tests::test_strip_ansi_*` (CSI/OSC/unicode)
- `bridge::tests::test_pane_contains_sentinel_*` (standalone line,
  after ANSI strip, rejects inline mention, rejects wrong task id, and
  documents the code-block false positive)
- `bridge::tests::test_pane_has_claude_prompt_detects_box_drawing`
- `bridge::tests::test_exit_criteria_needs_sentinel`
- `pipeline::triggers::tests::test_normalize_interactive_mode_requires_dev_flag`
- `config::tests::test_interactive_mode_enabled_reads_env_var`

`cargo check` + `cargo test --lib` clean (398 lib tests pass).
`npx tsc --noEmit` clean.

What was deferred (and why):
- No live integration test that drives a real `claude` binary. The
  watcher's mark_complete path requires an `AppHandle` which isn't
  cheap to mock, and gating a real `claude` invocation behind
  `#[ignore]` would be brittle until Phase 2 wires a panel that the
  user can attach to. Manual verification (per the prompt) is the
  acceptance bar for Phase 1.
- No DB migration. The plan's `runtime_mode_override` task column +
  `agent_paused_at` are explicitly Phase 4 work — Phase 1 piggybacks
  on the existing `tasks.agent_mode TEXT` column with `"interactive"`
  as a new value.
- No idle-prompt-detector fallback. Sentinel-only as specified.
- The `cancel_trigger_watcher` cancellation hook in `triggers.rs`
  mentioned in the spec doesn't actually exist as a general primitive
  today — column-move cancellation flows through
  `tmux_transport::cancel_task_agent` (which sends Ctrl+C) and the
  watcher self-cancels on its column guard within ≤2s. That's the
  behavior shipped here; if Phase 2 needs synchronous cancellation
  for the control bar's Stop button, we'll add an explicit
  `CancellationToken`-style handle then.

Spec deviations:
- Prompt indicator match: the spec said "likely `╭` or `>`". The
  shipped detector uses `╭` OR `╰` (top OR bottom border of the
  prompt box). A bare `>` is too permissive — both zsh prompts and
  agent output frequently contain `>`. The double-corner check is
  robust because at least one corner is on screen whenever the
  prompt box is rendered (and the corners are also present in the
  initial banner once Claude has fully loaded).
- The Phase doc sketched `spawn_interactive_claude` returning an
  `InteractiveHandle`. The shipped version returns `Result<(),
  String>` and the watcher state lives entirely inside the spawned
  tokio task — there's nothing else holding the handle today, and
  introducing a typed handle felt premature without a Phase 2 caller
  to constrain its shape.

Notes for Phase 2:
- The task's `agent_mode` DB column is set to `"interactive"` when
  the trigger fires in this mode. Phase 2's mode-resolver hook can
  read it directly via `useTaskStore`.
- `kaitencode_<task_id>` is still the only tmux session name; the existing
  `TerminalView`'s `ensure_pty_session` path already finds it. Phase 2's
  `InteractiveAgentView` should be a thin wrapper around `terminal-view.tsx`
  plus a control bar.
- The watcher sends `/exit` after success but does NOT kill the session
  proactively. If Phase 2 wants the post-completion TUI to stay visible
  while the user reviews, that's already the behavior — until the next
  column's trigger spawns a fresh session.
- The watcher's column guard is best-effort (DB poll every 2s). Phase 5's
  pause/resume + Phase 2's Stop button will probably want a direct
  cancellation channel for the watcher. Keep the door open for an
  explicit handle in `SpawnInteractiveResult`.
- `KAITENCODE_INTERACTIVE_MODE_ENABLED=1` is required end-to-end. Phase 2's
  task settings UI should grey out "Interactive" with a tooltip when
  the env var isn't set — otherwise users save the override and silently
  fall through to terminal mode at runtime.

### Phase 2: Frontend interactive view + control bar + live input (2-3 days)

- `InteractiveAgentView` component wrapping `terminal-view.tsx`.
- Control bar with interrupt / model switch / restart.
- Mode resolver hook.
- Per-task runtime mode override field in task settings modal.
- **`agent_inject_message` command + chat-input routing change** — the agent panel's text input box sends to the live tmux session when mode = interactive. Without this, the input box silently spawns a parallel `-p` call and the user thinks they're talking to the live agent but aren't. This is *required* for Phase 2 to be a coherent shippable unit.
- E2E test: create task, set to interactive, fire trigger, verify TUI renders, type a follow-up message, verify it reaches the agent.

#### Phase 2 status — 2026-05-13

**Shipped.**

What landed:
- `src-tauri/src/commands/agent_interactive.rs` (new file):
  - `resolve_runtime_mode(task_id)` — looks up task → column, calls into
    `pipeline::triggers::resolve_runtime_mode_for_task`. Returns a
    camelCase JSON shape: `{ mode, render, source,
    interactiveDevFlagRequired }`.
  - `agent_inject_message(task_id, message)` — guards on resolved mode
    (must be `interactive`), sends the message via `tmux send-keys -l`
    + `Enter`. Empty messages are no-ops.
  - `agent_interrupt(task_id)` — works in any mode. Sends `C-c` via
    `tmux send-keys`. No mode guard — matches existing
    `cancel_agent_chat` semantics.
  - `agent_switch_model(task_id, model)` — interactive only. Sends
    `/model <name>` + Enter. No model validation here; the CLI prints
    its own error in-pane if the name is unsupported.
  - `agent_restart(task_id)` — interactive only. Kills the session and
    respawns via `bridge::spawn_interactive_trigger_task` using the
    same trigger config (model, cli, prompt) cached on the task.
  - `interactive_mode_dev_flag()` — boolean introspection of
    `KAITENCODE_INTERACTIVE_MODE_ENABLED`. The settings modal greys out
    the Interactive picker option when this returns false.
- `src-tauri/src/pipeline/triggers.rs`:
  - `ColumnTriggersV2` gains an optional `default_runtime_mode` field
    (serde default None, skipped when None on serialize). Column
    config UI doesn't write it yet — Phase 4 owns that.
  - `ResolvedRuntimeMode` struct + `resolve_runtime_mode_for_task`
    function. Walks the spec's resolution hierarchy. **Phase 2 only
    implements the trigger and column tiers + default fallback.**
    Task/workspace/global tiers will be added by Phase 4 inside this
    same function — the API shape is stable.
- `src-tauri/src/lib.rs`: six new commands registered.
- `src/lib/ipc/agent-interactive.ts` (new file): IPC wrappers + types.
- `src/hooks/use-resolved-runtime-mode.ts` (new): hook that calls
  `resolve_runtime_mode`, falls back to `headless·bubbles` on error
  (so the existing UI keeps working if the backend isn't reachable),
  and re-fetches on `tasks:changed` events.
- `src/components/panel/interactive-agent-view.tsx` (new): control bar
  with status pill (running/idle/stopped), model dropdown,
  Interrupt + Restart buttons. The status flips between running/idle
  based on a pty-output silence heuristic (1200ms — explicitly chosen
  over TUI parsing to survive Claude Code release drift, as the spec
  warned). Restart confirms via `window.confirm`. Errors from any
  control surface in a thin red banner above the xterm.
- `src/components/panel/agent-panel.tsx`: split into a `AgentPanel`
  dispatcher + `HeadlessPanel` and `InteractivePanel` sub-components.
  The mode-aware split is what guarantees `useChatSession` never
  instantiates when mode is interactive — a side-effect-laden hook
  that would otherwise spawn a parallel `-p` stream. The `key={...}`
  on the dispatcher's children forces full unmount on mode change.
- `src/components/kanban/task-settings-modal.tsx`: runtime picker
  now exposes Headless·terminal / Headless·bubbles / Interactive /
  Inherit. Interactive disabled with a tooltip when the dev flag is
  off. "Effective: X (from Y)" hint populated from the resolver hook.

Tests added:
- 7 backend tests for `resolve_runtime_mode_for_task` covering: no
  triggers → default; trigger.terminal; trigger.managed;
  trigger.interactive with dev-flag on/off; column-default fallback;
  trigger overrides column-default; bogus token ignored.
- 4 hook tests for `useResolvedRuntimeMode` (happy path, dev flag,
  error fallback, null task id).
- 6 component tests for `InteractiveAgentView` (control bar rendering,
  interrupt, restart-with-confirm, error surface, stopped pill, model
  dropdown forwarding).
- 4 dispatcher tests in `agent-panel.test.tsx` (loading skeleton,
  interactive render, input routes to inject_message, headless
  fallback).
- WebDriver E2E spec `tests/webdriver/interactive-mode.spec.mjs` that
  verifies `resolve_runtime_mode` + `interactive_mode_dev_flag`
  return sensible shapes through the real IPC layer, and that
  `agent_interrupt` errors gracefully when no tmux session exists.

`cargo check` + `cargo test --lib` clean (405 lib tests pass). `tsc
--noEmit` clean. `vitest` clean (364 tests pass). `npm run lint`
reports only pre-existing errors in
`column-exit-editor.tsx`/`scripts-tab.tsx` that this phase didn't
touch.

What was deferred (and why):
- **Task tier of the resolver is still a no-op.** The task settings
  modal accepts and persists the Interactive override into
  `tasks.agent_mode`, but the resolver doesn't read that column yet.
  Phase 4 owns the schema work (`runtime_mode_override TEXT`) and
  will plumb it through. Until then, only the column trigger's
  explicit `runtime_mode` field actually drives the resolution — the
  task-level picker is set-only. Documented in the picker's helper
  text.
- **No DB migration.** Reusing existing JSON columns where possible.
  The Phase 4 migration will add the proper task/workspace/global
  storage.
- **Status detection.** As the spec recommended, we use a
  bytes-of-silence heuristic (1200ms) instead of parsing the TUI for
  the prompt indicator. Robust to Claude Code release drift but it
  does mean the status pill briefly says "idle" between an agent's
  tool calls. Acceptable for Phase 2 — controls remain enabled
  during that window so users can intervene if needed.
- **Model dropdown behavior.** The dropdown sends `/model <name>` and
  trusts the CLI to validate. If `/model` doesn't actually work
  mid-conversation on the user's Claude Code release (the spec's
  open question 3), the user sees the CLI's error in-pane and can
  fall back to Restart. Phase 3's Codex work is the right moment to
  revisit this — if `/model` proves unreliable, swap to a
  Restart-with-new-model flow then.
- **Headless chat-bubbles view in interactive mode.** Not built.
  Interactive mode is xterm-only by design (the spec rejected
  parsing the TUI back into bubbles).

Spec deviations:
- The spec drafted a single `AgentPanel` that conditionally renders
  different children. We instead split into `HeadlessPanel` and
  `InteractivePanel` because conditionally instantiating
  `useChatSession` (it's called from `useAgentPanelSession`) violates
  React hook rules. The dispatcher uses `key=` to force unmount on
  mode change, which addresses the spec's "Component remount on mode
  change" gotcha.
- The chat-input in interactive mode hides the model selector,
  thinking selector, voice input, and attachments. Those features
  only make sense for the headless chat-session path; routing them
  to `agent_inject_message` would silently drop them. Spec didn't
  explicitly call for this hide, but it's the only sensible option.
- Interrupt button does not show a confirmation modal (spec
  optionally suggested one "if a tool call is in flight"). Reasoning:
  in interactive mode, the agent stays alive at its prompt after
  interrupt — so the cost of an accidental click is much lower than
  the headless case where it terminates the run. Restart still has
  a confirm because that's the destructive one.

Notes for Phase 3 (Codex parity):
- `/model` slash command: not yet confirmed to work mid-conversation
  on the current Claude Code release. Manual verification of Phase 2
  will tell us. If it doesn't, Phase 3 should swap the model
  dropdown to a "Restart with model" affordance on both CLIs.
- The interactive-mode picker option in the task settings modal is
  currently gated on `interactiveModeDevFlag()` AND the cli being
  claude (enforced at backend dispatch time in Phase 1's
  `normalize_agent_runtime_mode`). Phase 3 should remove the
  claude-only check from the normalizer for codex.
- `bridge::spawn_interactive_claude` is claude-specific — Phase 3
  should either generalize it (rename to `spawn_interactive_cli`
  with cli-shape switches) or add a `spawn_interactive_codex` peer.
  The ready-prompt detector `pane_has_claude_prompt` will need a
  codex variant — codex's REPL has a different prompt glyph.
- `interactive_sentinel_system_prompt` is generic and works on codex
  unchanged. **Resolved:** codex has no `--append-system-prompt` at all
  (codex-cli 0.145.0), so the *carrier* differs — codex folds the same
  text into the injected prompt via `append_sentinel_to_prompt`.

### Phase 3: Codex parity (1 day)

- Same `build_interactive_spawn` path, codex-specific arg shape.
- ~~Validate `--append-system-prompt` works on current codex release~~ **DONE — it does not exist on codex.** The inline-prompt fallback is what ships.

#### Phase 3 status — 2026-05-13

**Shipped.**

What landed:
- `src-tauri/src/chat/bridge.rs`:
  - `InteractiveCli` enum (`Claude` / `Codex`) with `from_cli_name`
    + `exit_command` methods.
  - `build_interactive_codex_argv` — parallel to the claude builder.
    No `exec`, no `--json`, no headless sandbox flags (those mutate
    the non-interactive `codex exec` pipeline). **No `--append-system-prompt`
    either — codex has no such flag**; the sentinel is folded into the
    injected prompt instead. Handles resume via the `resume` *subcommand*
    (`resume --last` / `resume <id>`), which must precede any user args.
  - `pane_has_codex_prompt` — readiness detector. Matches lowercase
    `codex` substring AND requires >32 bytes of pane scrollback to
    avoid tripping on transient captures. Documented as the most
    cross-release-stable signal we have without a confirmed codex
    prompt-glyph.
  - `spawn_interactive_cli(cli, ...)` — replaces
    `spawn_interactive_claude`. Dispatches on `InteractiveCli` for
    argv builder + prompt detector; everything else (tmux session
    management, ready-polling loop, key-injection) is shared. Codex
    spawn adds a 300ms post-readiness settle before injection — the
    REPL needs an extra beat after the banner.
  - `spawn_interactive_trigger_task` now picks the right
    `InteractiveCli` from the cli name; unknown CLIs surface a clear
    error through `handle_interactive_spawn_failure` (a factored-out
    failure path that replaces the inline failure block from Phase 1).
  - `watch_interactive_sentinel` takes the `InteractiveCli` enum and
    sends the right exit slash command on success (`/exit` for
    claude, `/quit` for codex).
- `src-tauri/src/pipeline/triggers.rs`:
  - `normalize_agent_runtime_mode` no longer rejects codex.
    `interactive` is allowed for both claude and codex; any other
    cli name still downgrades to terminal with a one-time warning.

Tests added:
- `test_build_interactive_codex_argv_no_exec` — argv shape (no
  `exec`, no `--json`).
- `test_build_interactive_codex_argv_appends_sentinel_when_requested`
- `test_interactive_cli_from_cli_name` — including absolute paths.
- `test_interactive_cli_exit_command_is_cli_specific`
- `test_pane_has_codex_prompt_matches_banner`
- `test_normalize_interactive_mode_requires_dev_flag` updated to
  assert codex passes (was previously asserting codex got
  downgraded; the new assertion is the inverse).

`cargo check` + `cargo test --lib` clean (410 lib tests pass). No
new frontend changes required — the Phase 2 panel + control bar
already dispatch through the same `agent_inject_message`,
`agent_interrupt`, `agent_switch_model`, `agent_restart` commands.

Verification of codex CLI behavior (the spec's required checks):

> **No live codex binary was available in the dev env to verify**.
> The implementation ships against documented assumptions, with
> graceful failure modes when the assumptions don't hold.

| Question | Assumption | Failure mode if wrong |
|---|---|---|
| Does `codex --append-system-prompt` work? | **NO — resolved, the assumption was wrong.** codex-cli 0.145.0 has no such flag, so every sentinel-carrying column died at startup. The mitigation column below never helped either: the readiness miss *killed* the session, destroying the in-pane error. Both are fixed — sentinel rides the prompt, readiness never hard-kills. | n/a (resolved) |
| Does `/model <name>` work mid-conversation? | Unverified — sent unchanged. | Codex prints its own error in-pane; user can use Restart with the model preselected (Phase 2 control bar already exposes Restart). The dropdown does NOT show a CLI-specific label difference (spec optionally suggested "Switch & Restart" for codex). |
| Codex prompt indicator? | Banner contains `codex` (case-insensitive) plus >32 bytes. | If banner format changes, `spawn_interactive_cli` times out at 5s and returns "did not reach a ready prompt". Visible failure, not silent. |
| Exit command? | `/quit` (per spec table). | If codex doesn't accept `/quit` on a release, the post-success exit-send is best-effort — the next trigger spawn kills the session anyway. No correctness impact. |
| `--resume <id>` for REPL? | Skipped — we log a warning when a resume_id is passed for codex. | Phase 4 may revisit once we have a confirmed release matrix. Headless codex resume (via the existing `codex exec resume` subcommand) is untouched. |

What was deferred (and why):
- **Model dropdown CLI-specific labels.** Spec suggested "Switch &
  Restart" labeling when `/model` isn't verified for codex. The
  Phase 2 dropdown still sends `/model <name>` unchanged for both
  CLIs. Rationale: the failure mode is benign (CLI prints an
  in-pane error, user can fall back to Restart), and we don't have
  verified evidence either way. Easy to add a label-swap once
  manual verification gives us a definitive answer.
- **Integration test with real codex binary.** Same reasoning as
  Phase 1 — needs a live binary + an `AppHandle`. Unit tests cover
  the argv shape and ready-prompt detector; manual verification per
  the README's "do not run unattended" guidance is the acceptance
  bar.
- **Codex sandbox/approval flags in REPL mode.** The headless
  `codex exec` path passes `-c sandbox_mode="danger-full-access"`
  and `-c approval_policy="never"`. We did NOT propagate these to
  the REPL spawn. Reasoning: those override codex's *non-
  interactive* policies. The REPL has its own (user-supervised)
  approval flow, and silently disabling that is the wrong default
  for a supervised tool. If a user wants no-approval in the REPL,
  they can add the flags explicitly via `flags:` on the trigger
  action.

Spec deviations:
- No conditional "Switch & Restart" label on the model dropdown for
  codex (see deferred above).
- The Phase 1 `spawn_interactive_claude` symbol no longer exists —
  it was removed (not aliased) once `spawn_interactive_cli` replaced
  it. The dead-stub was dead code; the warning in `cargo check`
  confirmed nothing depended on it. If a future agent needs the
  Phase 1 entry point, route through `spawn_interactive_cli` with
  `InteractiveCli::Claude` instead.

Notes for Phase 4 (settings surfaces):
- The `default_runtime_mode` field on `ColumnTriggersV2` was added
  in Phase 2 and is wired through the resolver. Phase 4's column
  config dialog just needs a picker that writes this field.
- Workspace + global defaults need new storage. Per the plan:
  workspace_config JSON for the workspace tier (no schema change),
  `~/.kaitencode/settings.json` for the global tier (extend
  `AppSettings`). The resolver's hierarchy is structurally ready —
  add the new tiers between `column` and `default` in
  `resolve_runtime_mode_for_task`.
- DB migration 030 needs to land: `runtime_mode_override TEXT` on
  `tasks` and `agent_paused_at INTEGER` on `tasks` (Phase 5 uses
  the latter).
- The task settings modal currently saves the task's runtime mode
  to `tasks.agent_mode` (set-only). Phase 4 should pivot that to
  the new `runtime_mode_override` column so the resolver can
  actually consult it.

### Phase 4: Settings surfaces (1-2 days)

- Column config dialog: default runtime mode picker.
- Settings panel: workspace and global defaults.
- Resolution-hint UI ("Effective mode: X (from Y)").

#### Phase 4 status — 2026-05-13

**Shipped (durable storage + resolver + telemetry).** UI pickers
deferred to the existing JSON-edit + Tauri command surface — see
"Deferred" below.

What landed:
- **Migrations 044 + 045** (the spec called for 030+031; those numbers
  were taken).
  - `044_runtime_mode_override.sql`: adds `tasks.runtime_mode_override
    TEXT` (NULL = inherit) and `tasks.agent_paused_at INTEGER` (NULL
    = not paused; Phase 5 will write to this).
  - `045_agent_completion_events.sql`: new table + index.
- **`db::completion_events` module** with `CompletionSource` enum
  (`Sentinel|ExitCode|Manual|Timeout|Kill`), synchronous `record`,
  fire-and-forget `record_async`, and `list_recent`. All paths use
  `record_async` so completion handling is never blocked on the
  insert.
- **Resolver completion** in `pipeline::triggers`:
  - Renamed primary entry: `resolve_runtime_mode_with_workspace_config(
    task, column, workspace_config_json: Option<&str>)`. Pure — tests
    pass JSON directly without touching the on-disk DB.
  - Thin wrapper `resolve_runtime_mode_for_task(task, column)` opens
    a read-only connection to fetch the workspace config when the
    caller doesn't have it (used by the `resolve_runtime_mode` Tauri
    command).
  - Tier order now actually walks: trigger > task > column >
    workspace > global > default. Both `default_runtime_mode` and
    `default_headless_render` are folded into the same token
    (`terminal` / `managed` / `interactive`) since the resolver
    returns `{mode, render}` as a pair.
- **Telemetry write hooks** from all four completion paths:
  - Headless trigger completion (`bridge::run_trigger_in_tmux`):
    emits `exit_code` (or `timeout`/`kill` for the synthetic 124/137
    cases).
  - Interactive sentinel watcher (`bridge::watch_interactive_sentinel`):
    emits `sentinel` / `timeout` / `kill` based on the same truth
    table the column guard reads from.
  - Manual completion (`commands::pipeline::mark_pipeline_complete`):
    samples task state then emits `manual`.
  - Session kill (`commands::agent::kill_task_session`): samples task
    state BEFORE clearing agent_status then emits `kill`.
- **`AppSettings.default_runtime_mode`** field with `merge_update`
  support. The existing HTTP `/api/settings` endpoint round-trips
  the new field automatically.
- **Frontend:**
  - `src/types/column.ts` ColumnTriggers gets `default_runtime_mode?:
    AgentRuntimeMode`.
  - `src/types/task.ts` Task gets `runtimeModeOverride: string | null`
    and `agentPausedAt: number | null`.
  - Test mocks (`src/test/mocks/tauri.ts`, ad-hoc fixtures in
    `task-store.test.ts`, `split-view.test.tsx`,
    `pipeline-dashboard.test.ts`, `browser-mock.ts`) updated to
    include the new fields.
- **Tauri command:**
  - `list_completion_events(workspaceId, limit)` returns the
    workspace's most recent events newest-first, capped at 200.
    IPC wrapper in `src/lib/ipc/agent-interactive.ts`. Powers the
    eventual telemetry view; for now, advanced users can call it
    from the dev console.

Tests added:
- Backend resolver matrix:
  - `test_resolve_runtime_mode_task_tier` — task override fires.
  - `test_resolve_runtime_mode_trigger_beats_task` — narrowest wins.
  - `test_resolve_runtime_mode_task_beats_column` — task beats column
    default.
  - `test_resolve_runtime_mode_workspace_tier` — flat
    `default_runtime_mode`.
  - `test_resolve_runtime_mode_workspace_tier_nested` —
    `agent.defaultRuntimeMode`.
  - `test_resolve_runtime_mode_workspace_tier_ignores_invalid_token`.
- `db::completion_events::tests::record_and_list_round_trip` — both
  the writer and the reader, including workspace filtering and
  newest-first ordering (with `created_at DESC, id DESC` tiebreaker).
- Migration count assertion updated (45 → 47).

`cargo check` + `cargo test --lib` clean (417 lib tests). `tsc
--noEmit` clean. `vitest` clean (364 tests).

**Deferred (with rationale):**
- **Column config dialog picker for `default_runtime_mode`.** The
  type system supports it (Phase 2 already added the field on
  `ColumnTriggers`); the resolver consults it. The dialog form
  control is not yet wired. Users today set per-trigger
  `runtime_mode` via the existing spawn-cli action editor — that's
  the more specific tier and overrides the column default anyway,
  so the impact of missing the column-level picker is small. Add a
  picker in a future polish pass.
- **Settings panel workspace + global pickers.** The global tier is
  reachable via the existing `/api/settings` PATCH endpoint (set
  `default_runtime_mode`); the workspace tier is reachable via the
  existing workspace-update flow (write `default_runtime_mode` into
  `workspace_config`). The plan doc had pickers as nice-to-have for
  discoverability; deferring to Phase 6 polish where we'd also wire
  the telemetry view.
- **Telemetry view UI.** Backend command + IPC are shipped;
  rendering the table + aggregates is a Phase 6 follow-on. The
  data the view would read is now flowing.
- **Onboarding wizard step.** Punted to Phase 6.

Spec deviations:
- Migration numbers (044/045 instead of 030/031) — the spec's
  numbers are already in use.
- Resolver split into the pure `…with_workspace_config` function +
  the convenience wrapper. The spec sketched a single function;
  splitting kept the tests trivial and lets Tauri commands that
  already have a Connection avoid the second DB hop.

Notes for Phase 5 (pause/resume):
- `tasks.agent_paused_at INTEGER` already exists (migration 044).
  Phase 5 wires the `agent_pause` / `agent_resume` Tauri commands
  that read/write it.
- Telemetry has no dedicated `paused`/`resumed` events. If Phase 5
  wants to track pause duration, extend the table — but the bar to
  add columns is "is this load-bearing for a Phase 6 decision?"
  Probably no.

First-day telemetry: **no data yet** — manual verification of Phase
1+2+3 hasn't been run by the user. Once a few interactive tasks
complete in real use, query the `agent_completion_events` table to
get the sentinel-hit-rate baseline. The Phase 6 recommendation is
gated on that number (target ≥80% per the plan).

### Phase 5: Pause/resume (1 day)

- `agent_pause` / `agent_resume` commands.
- Pause button in control bar with tooltip caveat about network calls.
- (`agent_inject_message` was promoted to Phase 2.)

#### Phase 5 status — 2026-05-13

**Shipped.**

What landed:
- `db::update_task_agent_paused_at(conn, id, paused_at)` — writes the
  Phase 4 `agent_paused_at` column. `Some(epoch_ms)` to pause, `None`
  to clear.
- `commands::agent_interactive::agent_pause` — interactive-only
  Tauri command. Sends `tmux send-keys C-z` to suspend the agent
  process (SIGTSTP), then stamps `agent_paused_at`. Rejects when
  the resolved mode is headless OR the task is already paused.
- `commands::agent_interactive::agent_resume` — same shape but
  `send-keys -l fg` + Enter, and clears the timestamp. Rejects when
  the task isn't currently paused.
- `chat::gc::collect` updated:
  - Tasks with `agent_paused_at IS NOT NULL` are excluded from the
    idle-kill candidacy check.
  - The "running but session gone" sweep skips paused tasks via a
    `agent_paused_at IS NULL` SQL clause — a suspended agent still
    owns the tmux session, so the absence-of-session check would
    otherwise mark it failed.
- IPC: `agentPause` / `agentResume` wrappers in
  `src/lib/ipc/agent-interactive.ts`.
- UI: `InteractiveAgentView` takes a new `agentPausedAt` prop. The
  control bar grew a Pause/Resume toggle button (label flips based
  on state). Status pill picks up a 4th value `'paused'` with a
  yellow warning color. Model dropdown is locked while paused so we
  never send `/model` into a suspended shell.
- `AgentPanel` (interactive variant) threads `task.agentPausedAt`
  through to the view.

Tests added:
- `renders Pause label and calls agentPause when not paused`.
- `renders Resume label and shows paused status when agentPausedAt is set`.
- `locks the model dropdown when paused`.
- Existing tests stay green (the `beforeEach` mock-clear now also
  resets the new agentPause/agentResume mocks).

`cargo check` + `cargo test --lib` clean (417 lib tests). `tsc
--noEmit` clean. `vitest` clean (367 tests).

What was deferred (and why):
- **Subtle xterm "Agent paused" CSS overlay** — the status pill +
  Pause/Resume button + button label flip already communicate the
  state clearly. A full overlay would add visual chrome the user
  has to dismiss. Skipped; revisit in Phase 6 polish if usability
  testing flags it.
- **Task card pause badge on the kanban board.** Same reasoning —
  the agent panel surfaces the state. The kanban card already shows
  agent status; a paused badge can be a small follow-on if needed.
- **Recovery-on-restart surface.** A paused task is preserved on
  restart because (1) the tmux session is left alone (Phase 1
  recovery already handles this), and (2) the `agent_paused_at`
  timestamp persists in SQLite. The GC guard added here ensures
  it's not reaped. The UI will reflect the paused state on next
  panel open because `task.agentPausedAt` flows through the task
  store. No additional startup code needed.
- **Restart-while-paused unwind.** The Phase 5 spec called out
  needing to resume-then-exit. Today, `agent_restart` kills the
  tmux session and respawns — that's idempotent regardless of
  pause state because killing the session drops the suspended
  process. No special handling required; the new agent starts
  cleanly. Documented behavior, not a deviation.

Spec deviations:
- The spec sketched separate "paused" tracking. We reused the
  existing `task.agentPausedAt` column (Phase 4 already added it)
  rather than introducing parallel state.
- Pause button is in the control bar between the Model dropdown
  and the Interrupt button (spec sketched it as the first action
  on the right). Cosmetic placement choice.

Notes for Phase 6:
- The dev flag `KAITENCODE_INTERACTIVE_MODE_ENABLED` still gates the
  whole interactive path. Phase 6 should decide whether to promote
  it to a real persisted setting (perhaps in onboarding) or keep
  it as a dev-only flag indefinitely.
- The mode-rename collapse (`'terminal' | 'managed' | 'interactive'`
  → `'headless' | 'interactive'`) is the largest open question.
  Pros: cleaner mental model. Cons: large diff touching saved
  column configs, task overrides, settings JSON. Recommendation:
  defer past Phase 6 unless there's a forcing function.
- Phase 4's deferred UI surfaces (column-config picker, settings
  panel pickers, telemetry view) are the natural Phase 6 work
  alongside the docs + onboarding flow.

### Phase 6: Polish + docs (1 day)

- Onboarding prompt for new installs.
- Update `INTERACTIVE_AGENT_TERMINAL.md` and `UNIVERSAL_AGENT_RUNTIME.md` to reflect shipped state.
- User-facing docs / tooltip copy.

#### Phase 6 status — 2026-05-13

**Shipped (documentation + judgment-call decisions).** Polish work
that needed live telemetry or real dogfooding data was explicitly
deferred and documented — see "Open follow-ups" below.

Decisions (with reasoning given the lack of dogfooding data):

**Decision 1 — idle-prompt-detector fallback: NOT shipped.**
- Spec's rule: ship the fallback when sentinel hit rate <90%, ship as
  opt-in when 80–90%, skip when ≥90%.
- We have zero telemetry data because the feature hasn't been
  manually verified yet. Adding a fallback "just in case" would
  ship dead code that complicates the watcher's control flow, which
  is exactly what the spec's "Known gotcha" warned against ("Don't
  ship the fallback 'because it's defensive.'").
- **Recommendation:** revisit after the user runs 10–20 interactive
  tasks. Query `SELECT completion_source, COUNT(*) FROM
  agent_completion_events WHERE mode='interactive' GROUP BY 1` to
  get the baseline. If sentinel rate is below 90%, file a follow-up
  ticket to implement the fallback as a separate piece of work.

**Decision 2 — dev flag promotion: KEEP the flag.**
- Spec's rule: remove after 2+ weeks of stable dogfooding.
- We've had zero days of dogfooding. Removing the flag now would
  ship interactive mode default-on to every user without anyone
  having ever verified that the spawn helper actually works against
  a real `claude` binary.
- The flag stays as `KAITENCODE_INTERACTIVE_MODE_ENABLED=1`. Phase 6
  did NOT replace it with a settings-panel toggle — that would
  give users a footgun (they could turn it on, hit an edge case
  with their CLI version, and not know how to recover). Keeping
  it as an env var means only users who know to set it can opt in.
- **Recommendation:** after manual verification confirms the happy
  path works on the user's `claude` and `codex` binaries, promote
  this to a settings toggle (still opt-in, but discoverable via
  the UI). Default-on for new installs is a Phase 7-equivalent
  decision.

**Decision 3 — mode naming collapse: NOT done.**
- Spec sketched collapsing `'terminal' | 'managed' | 'interactive'`
  into `'headless' | 'interactive'` with a render sub-toggle.
- The current taxonomy works. The resolver returns `{mode, render}`
  which is already the collapsed shape — the storage representation
  just uses different tokens (`terminal` ≈ headless·terminal,
  `managed` ≈ headless·bubbles).
- A rename has surprising blast radius: search-and-replace would hit
  ~50 sites in the Rust + TS code, all the saved column configs, and
  all the saved task agent_mode values across user DBs. Migration
  shims would be needed, which add code rather than remove it.
- **Recommendation:** keep the current naming indefinitely. UI labels
  already say "Headless · terminal" / "Headless · bubbles" /
  "Interactive" (task settings modal). The storage token is an
  implementation detail.

**Documentation work shipped:**
- `CLAUDE.md` § "Agent Execution — One Transport for Everything"
  rewritten with the runtime-modes table, resolver hierarchy
  pointer, and the full list of per-task control surfaces. New
  readers can navigate the entire interactive subsystem from this
  section alone.
- `.tickets/_docs/INTERACTIVE_AGENT_TERMINAL.md` gets a
  "**Status: Superseded as the active execution plan**" header
  pointing here. Original April spec preserved for context.
- `.tickets/_docs/UNIVERSAL_AGENT_RUNTIME.md` gets a header noting
  the mode-taxonomy portion has been executed by this plan.
- This file's title-line status updated to "Shipped (phases 1–6)".

Polish work NOT shipped (and why):
- **User-facing copy review.** Tooltips and placeholders are
  already honest about pause limitations (e.g. interactive view's
  Pause button tooltip explicitly calls out network-call behavior).
  No remaining copy was found that needed sharpening. Tooltip pass
  during manual verification will surface anything missed.
- **Telemetry view UI.** Phase 4 deferred this; Phase 6 leaves it
  deferred. The data is flowing into `agent_completion_events`;
  the IPC command exists. A simple table component is straightforward
  to add when the user wants to see numbers — but without any data
  yet, building the UI first is premature.
- **Onboarding wizard touch-up.** Phase 4 explicitly deferred the
  initial wizard step. Phase 6 didn't add one because the dev flag
  remains the entry point and the wizard would be confusing (it'd
  show an option that requires an env var to actually use).
- **Performance check / Activity Monitor sweep.** Cannot run
  unattended. The watcher tasks are 2s-cadence and trivially cheap;
  flagging this as a manual-verification item rather than fabricating
  numbers.
- **Final WebDriver regression.** The wider WebDriver suite needs
  a running tauri-driver + dev server + isolated data dir. Vitest +
  cargo test ran clean (417 + 367 tests). The webdriver suite is
  expected to also pass given that no shipped Vitest tests broke.

### Final retrospective

**Total elapsed time:** all 6 phases executed in a single session
(2026-05-13). The plan estimated 7–10 focused days; we collapsed
that into one push at the cost of skipping the per-phase manual
verification the README explicitly required.

**What worked:**
- Splitting the work into Phase 1 (backend) + Phase 2 (frontend)
  was the right structural choice. Phase 1's pure helpers
  (`build_interactive_claude_argv`, `pane_contains_sentinel`,
  `strip_ansi`) were trivially testable in isolation, and Phase 2's
  panel dispatcher inherited a working backend.
- The resolver hierarchy from Phase 2 (`trigger > task > column >
  default`) being structurally extensible meant Phase 4 didn't
  have to refactor — just add new tiers underneath.
- Reusing `tasks.agent_mode` from the existing schema for the
  Phase 1 `'interactive'` token avoided a Phase 1 migration. Phase 4
  then added the dedicated `runtime_mode_override` column for the
  resolver's task tier, decoupling "what mode ran last" from "what
  mode should run next."
- Refactoring `spawn_interactive_claude` into the generic
  `spawn_interactive_cli` during Phase 3 was cheap because Phase 1's
  surface area was small. Codex parity ended up as ~80 lines of
  Rust + 4 unit tests.

**What didn't:**
- The README's "Do not run unattended" rule was explicitly violated
  by the goal directive. Every phase shipped without the user
  manually exercising the previous one against a real CLI. The
  status sections call out which assumptions remain unverified
  (codex `/model` mid-conversation behavior, the actual prompt
  glyphs, etc.).
- Phase 4's UI polish (column-config picker, settings panel
  pickers, telemetry view) was deferred and the deferral cascaded
  into Phase 6. The current state is "the storage and resolver
  work, but the GUI for editing them is sparse." Power users edit
  JSON; everyone else uses the per-task picker. Acceptable trade
  for unattended execution; should be revisited.
- Component dispatcher remount via `key={...}` works but the test
  fixtures had to be updated in many places when Task gained new
  fields in Phase 4. Adding new schema fields with `?: T | null`
  TypeScript types would have prevented the test-fixture churn —
  filing a small follow-up to think about whether fields should be
  optional in mocks.

**What we'd do differently:**
- Push the Phase 4 UI work earlier so each tier has a discoverable
  control surface before the resolver depends on it. The current
  state where the resolver consults a workspace_config field that
  no UI writes is a strange shape.
- Get the `/model` mid-conversation question answered before Phase 3
  rather than shipping with an assumption. If `/model` requires a
  restart, the dropdown UX should reflect that from day one.
- Telemetry events have no per-task timestamps for state transitions
  (spawn → first output → first sentinel-mention → completion).
  Adding those during Phase 4 would have given the Phase 6 fallback
  decision a richer data set than just "completion source." File
  as a follow-up.

**Open follow-up tickets to file:**
1. Run 10–20 interactive tasks; query telemetry; decide on the
   idle-prompt-detector fallback.
2. ~~Verify codex `--append-system-prompt`~~ **DONE — no such flag exists;
   sentinel moved into the prompt.** Still open: `/model` behavior on the
   user's release. If `/model` requires restart, swap the dropdown to
   "Restart with model".
3. Build the column-config picker for `default_runtime_mode`.
4. Build the settings-panel pickers (workspace + global defaults).
5. Build the telemetry view (table + sentinel-hit-rate header).
6. Add onboarding wizard step once the dev flag is promoted to a
   settings toggle.
7. Consider adding state-transition timestamps to
   `agent_completion_events` for richer Phase-6-redo telemetry.
8. Manual verification end-to-end: real claude, real codex, with
   `KAITENCODE_INTERACTIVE_MODE_ENABLED=1`, exercising trigger spawn,
   panel switch, message inject, interrupt, pause/resume, model
   switch, restart, sentinel completion. The first dogfood pass
   will surface the assumptions worth turning into hard checks.

**Final test sweep (2026-05-13):**
- `cargo check` clean (only pre-existing dead-code warnings).
- `cargo test --lib` clean — 417 tests, 0 failed.
- `npx tsc --noEmit` clean.
- `npx vitest run` clean — 367 tests across 40 files, 0 failed.
- ESLint surfaces only pre-existing errors in
  `column-exit-editor.tsx` and `scripts-tab.tsx` that this plan
  didn't touch.

The feature is mergeable. Manual verification by the user is the
remaining gate before any of the dev-flag-promotion decisions can
move forward.

**Total:** ~7-10 focused days.

## Telemetry

To know if completion detection is working in the wild, log to a new `agent_completion_events` table (or the existing usage log):

- `task_id`, `mode`, `cli`, `completion_source` (`sentinel | idle_detector | manual | exit_code | kill`), `duration_ms`, `sentinel_seen_at`, `idle_detected_at`
- Surface a settings-panel debug view: "Last 50 completions by source" so users can spot when sentinel reliability drops.
- Aggregate metric: % of interactive-mode tasks completed via sentinel vs fallback. Target >80% for the design to be considered working.

## Open Questions / Risks

1. **TOS / detection.** Interactive `claude` driven entirely by `tmux send-keys` with no real human interaction is gray-zone. Defensible because kaitencode is a single-user supervised tool with manual approval gates, but worth being honest in user-facing copy: interactive mode is for *supervised* agents. Don't market as "unlimited free Claude Code automation."

2. **Sentinel reliability.** Models occasionally ignore system-prompt instructions, especially Haiku. Mitigations: keep the idle-prompt-detector as fallback, expose "Mark Complete" prominently, telemetry on sentinel hit rate.

3. **Slash command compatibility.** `/model` mid-conversation: Claude Code historically required a restart to switch models. Need to verify current behavior — the model switch button may have to do a `restart` (kill + respawn with new `--model` flag + replay context) rather than a true mid-stream swap. If so, expose as "Restart with Sonnet" not "Switch to Sonnet."

4. **Prompt injection from task content.** Headless mode escapes the prompt into a single CLI arg. Interactive mode injects via `tmux send-keys` — newlines and special chars need careful handling. Use `tmux send-keys -l` (literal) and explicit `Enter` press; never construct keystrokes from unescaped user content.

5. **Concurrent interactive sessions.** `DEFAULT_PIPELINE_MAX_CONCURRENT_AGENTS = 5` applies regardless of mode. Interactive sessions are cheaper per-token (no `-p` overhead) but heavier on the user's attention. Consider a separate concurrency cap for interactive mode (default 3?) to keep the UI navigable.

6. **Caching.** Interactive Claude Code maintains its own prompt cache across messages in a session. Headless `-p` re-establishes the cache each call. Interactive mode is naturally cache-friendlier for multi-turn work. Worth surfacing in UI copy as a perf benefit.

7. **Recovery on restart.** App restart with interactive agents running: existing `recover_tmux_sessions()` logic preserves the tmux pane, but the sentinel watcher needs to re-register. Add to startup recovery.

## Out of Scope

- Replacing the chat-bubble UI with a TUI parser (explicitly rejected above).
- Multi-agent collaboration in a single task (one agent per task remains the model).
- Remote / cloud agent execution (universal-runtime concern, separate doc).
- API-mode (direct Anthropic API without CLI) — possible future fourth mode but not addressed here.
- choomfie daemon. The daemon's Agent SDK usage is structurally bound to programmatic credit; a tmux-spawn rewrite there is a much bigger undertaking and is not part of this scope.

## File Touch List

Backend:
- `src-tauri/src/chat/bridge.rs` — split `build_trigger_command`, add `build_interactive_spawn`
- `src-tauri/src/chat/tmux_transport.rs` — verify interactive spawn path, sentinel watcher
- `src-tauri/src/pipeline/triggers.rs` — branch dispatch, sentinel-based completion, mode resolver
- `src-tauri/src/db/migrations.rs` — migration 030 (new task columns)
- `src-tauri/src/commands/` — new commands: `agent_stop`, `agent_pause`, `agent_resume`, `agent_switch_model`, `agent_inject_message`
- `src-tauri/src/config/mod.rs` — global default settings fields

Frontend:
- `src/types/column.ts` — extend `AgentRuntimeMode` taxonomy, add `HeadlessRender`
- `src/types/task.ts` — add `runtime_mode_override` field
- `src/hooks/use-resolved-runtime-mode.ts` — new
- `src/components/panel/agent-panel.tsx` — dispatcher logic
- `src/components/panel/interactive-agent-view.tsx` — new (wraps terminal-view + control bar)
- `src/components/panel/control-bar.tsx` — new
- `src/components/kanban/task-settings-modal.tsx` — runtime mode picker
- `src/components/kanban/column-config-dialog.tsx` — default mode picker
- `src/components/settings/tabs/agents-tab.tsx` — workspace/global defaults
- `src/lib/ipc/agent.ts` — new IPC wrappers for control commands

Docs:
- This file.
- Update `INTERACTIVE_AGENT_TERMINAL.md` header to point here as the active execution plan.
- Update `CLAUDE.md` "Agent Execution" section after Phase 2 ships.
