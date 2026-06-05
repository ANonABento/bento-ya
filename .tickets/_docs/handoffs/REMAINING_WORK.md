# Remaining Work — Handoff Index

Context for everything below: this session ran a "source of truth" refactor and
scoped a terminal-harness roadmap. **Landed & green** (468 Rust lib tests, 17
MCP, 394 frontend, tsc + lint clean):

- **Front 1 — task mutations unified.** `mark_complete`, `add/remove_dependency`,
  `update_task`, `move_task` (Tauri+API), `reject_task`, `delete_task` (chef
  cleanup), `approve_task` now funnel through shared `pipeline::*_service` fns;
  MCP routes through `/api/*` instead of writing the DB directly. New services:
  `create_task_service`, `update_task_service`, `move_task_service`,
  `dependencies::set_task_dependencies`; new routes `/api/mark_complete`,
  `/api/set_dependencies`, `/api/update_task`.
- **Front 2 — entity ops unified.** New routes `/api/create_workspace`
  (shares `commands::workspace::create_workspace_core` with the UI),
  `/api/create_column`, `/api/configure_triggers`, `/api/create_script`; all 5
  MCP entity handlers repointed (app-first + test-only DB fallback). One
  `pipeline::triggers::validate_triggers_json`. New `entities:changed` event +
  `useEntitySync` hook so MCP/chef entity changes refresh the UI live.

What follows is everything **not** done, each with enough to hand off cleanly.
The big one (Front 3 — agent spawn) has its own doc: `FRONT3_AGENT_SPAWN.md`.

> ### ✅ Update 2026-06-05 — most of this shipped
> Since this index was written, the following all landed on `main` and are
> verified (482 Rust lib tests, 18 MCP, real-app WebDriver pass):
> - **Front 3 — agent spawn:** substantially complete. Shared `pipeline::spawn::resolve()`
>   + `ResolvedAgentSpawn`, `model_to_args`, `task_md_default_prompt`,
>   `resolve_working_dir`, `persist_agent_session_started` all exist and are used.
>   The empty-`workspace_id` emit bug (A2(e)) is fixed across all trigger-lifecycle
>   emits. Remaining bits (argv-family collapse (f), full session-helper merge) are
>   by-design splits, not duplication — see `FRONT3_AGENT_SPAWN.md` notes.
> - **A1 — chef move parity:** DONE. `execute_single_tool` returns
>   `ToolOutcome::TaskMoveRequested`; the caller routes through `move_task_service`.
> - **B1–B4** (Phase 2 create UI, Phase 3 interactive opt-in, Phase 4 chef terminal,
>   Phase 5 CLI health check): all DONE.
> - **CLAUDE.md discord drift:** fixed (diagram now lists `config/`).
> - **MCP `create_task` model/trigger_prompt drops:** fixed (see
>   `.tickets/done/mcp-fix-create-task-*.md`).
>
> **Still open:** A2 (the `pty:{taskId}:exit` snake_case casing — the (e) part is
> done, the casing part isn't); the C-section product gaps; MCP bugs #3/#4
> (`mcp-fix-direct-db-no-events.md`, `mcp-add-source-attribution.md`); the
> interactive-mode codex verification (B2 known gaps). Item-level statuses below.

---

## A. Source-of-truth leftovers (small, ride-along cleanups)

### A1. Chef `move_task` transition parity — ✅ DONE (2026-06-05)
Implemented as designed: the move arm returns `ToolOutcome::TaskMoveRequested`
(no DB write) and the caller loop calls `pipeline::move_task_service`. See
`llm/executor.rs`. Original notes kept below for context.

`move_task` is unified for Tauri + HTTP API via `pipeline::move_task_service`,
but the **chef path** (`execute_single_tool` `"move_task"` arm in
`llm/executor.rs`) still does a raw move (`move_task_to_column`) + the caller
loop fires only `on_entry`. It skips `on_exit`, agent-cancel, worktree-terminal
cleanup, and the 2nd `check_dependents` pass.
**Why deferred:** routing it through `move_task_service` needs `&AppHandle`
inside `execute_single_tool`, which is deliberately app-free for its Wry-vs-Mock
unit tests (see the test landmine in `FRONT3_AGENT_SPAWN.md`). Cleanest fix:
have the move arm return a `TaskMoveRequested { task_id, target_column_id, position }`
outcome (no DB write) and let the caller loop — which *has* `app` — call
`move_task_service`. Update the two `test_move_task_*` unit tests to assert on
the new outcome / test `move_task_to_column` directly. Medium effort; **best done
as part of Front 3** since it shares the same `app`-threading constraint.

### A2. Event-payload casing — `pty:{taskId}:exit` (tiny) — 🔲 STILL OPEN
`PtyExitPayload` in `events.rs` has **no `#[serde(rename_all = "camelCase")]`**,
so it emits snake_case `exit_code`. It works today only because the frontend
reads `payload.exit_code` (`terminal-view.tsx`). It's the one event violating the
camelCase rule in CLAUDE.md. Fix: add the rename to the struct, update the
frontend to `exitCode`. While there, the `agent:*` events and
`pipeline:step_progress` use raw `json!` with hand-written camelCase keys — they
work but should become typed structs to be drift-proof (low urgency).

### A3. Chef `create_task` uses `insert_task_full` directly — intentional, noted
The chef `create_task` arm calls `db::insert_task_full` (not
`create_task_service`) because its caller loop already owns trigger-firing +
event emission and `__LAST__` tracking. The DB *row* is identical to all other
paths (the thing that mattered), so this is fine — just don't "fix" it into a
double-fire.

---

## B. Terminal-harness roadmap (the original 5-phase plan)

Full design in `/home/anonabento/.claude/plans/peppy-stargazing-locket.md`.
Phase 1 (task-creation source-of-truth) is **done** (it became Front 1's
foundation). Remaining phases:

### B1. Phase 2 — Expose every agent option in the create UI — ✅ DONE (2026-06-05)
Shipped: shared `TaskOptionFields` widget + `TaskCreateDialog` (model / runtime /
priority / target column / trigger prompt / dependencies), threaded through
`addTask → ipc.createTask(options)`. Original notes below.

Front 1 made `model` / `trigger_prompt` / `dependencies` / `priority` /
`runtime_mode_override` first-class create params (backend `db::NewTask`, the
`create_task` Tauri command, and the `createTask` IPC `CreateTaskOptions` bag all
accept them). **The UI doesn't surface them yet** — the inline add
(`kanban/column.tsx`) and command palette only pass title/description.
**Do:** lift the model + `runtime_mode_override` pickers that already exist in
`task-settings-modal.tsx` into a shared create/edit widget, and let the
new-task surface set model / runtime mode / target column / priority /
trigger prompt / dependencies. Pure frontend; the backend + IPC are ready.

### B2. Phase 3 — Promote interactive mode (opt-in) — ✅ DONE (2026-06-05)
Shipped: `get_app_settings`/`update_app_settings` Tauri commands +
`AppSettings.interactive_mode_enabled`, the Settings "Agent runtime" section
(enable toggle + default runtime dropdown), onboarding step, and the per-chat
`RuntimeModeToggle` in the agent panel header (writes `runtime_mode_override` +
`agent_restart`). **Codex gaps below remain open** (resume + `--append-system-prompt`).
Original notes below.

Interactive mode is fully built but gated behind env var
`KAITENCODE_INTERACTIVE_MODE_ENABLED` (read via `config::interactive_mode_enabled()`,
3 call sites: `triggers.rs` resolver downgrade, the `interactive_dev_flag_required`
field, and the `interactive_mode_dev_flag()` command).
**Do:** (1) replace the raw env gate with a real setting
(`AppSettings.default_runtime_mode` already exists and is read at the global tier
of `resolve_runtime_mode_with_workspace_config`); (2) Settings UI: "Agent
runtime" control (global default + enable-interactive toggle); (3) Onboarding
step in `onboarding/onboarding-wizard.tsx` (note the billing difference:
interactive = subscription limits, headless = API/SDK credit); (4) **per-chat
toggle** in the agent panel header that flips a task interactive↔headless by
writing `tasks.runtime_mode_override` and restarting via the existing
`agent_restart` command (the panel already remounts on mode change via
`useResolvedRuntimeMode` + `key=`). Keep headless the default (user decision:
opt-in). Claude-first; codex stays best-effort.
**Known codex gaps (defer):** interactive resume isn't wired
(`bridge.rs` `spawn_interactive_cli` warns + ignores `resume_id` for codex), and
whether codex honors `--append-system-prompt` for the sentinel is unverified.

### B3. Phase 4 — Chef terminal view (workspace-level terminal wrapper) — ✅ DONE (2026-06-05)
Shipped: `ensure_chef_terminal` (keyed `chef_<workspace_id>`, repo-rooted shell),
the `taskId`-keyed terminal IPC generalized to any session key,
`OrchestratorTerminalView` + chat↔terminal toggle in the orchestrator panel.
Original notes below.

Let the user drive an interactive CLI at the **workspace** level inside
KaitenCode (no external terminal). ChefSession (`chat/chef.rs`) is pipe-only
today; the orchestrator panel renders chat bubbles. Per-task terminals already
work via `TmuxTransport` + `terminal-view.tsx`, keyed by `taskId`.
**Do:** add a tmux session `kaitencode_chef_<workspace_id>`; generalize the
`taskId`-keyed terminal IPC in `commands/terminal.rs`
(`write_to_pty`/`resize_pty`/`get_pty_scrollback`) to accept any session id (or
add `*_orchestrator_pty` variants); add an `OrchestratorTerminalView` + chat↔
terminal toggle in the orchestrator panel; generalize `pty:{taskId}:output` →
`pty:{sessionId}:output`. Est. ~300 Rust + ~150 TSX. Reuse, don't reinvent — the
registry already namespaces chef as `chef:{workspace_id}:{session_id}`.

### B4. Phase 5 — CLI-compatibility verification layer — ✅ DONE (2026-06-05)
Shipped: `cli_detect::CLI_HEALTH_SPECS` + `check_cli_health()` command +
`emit_cli_health` startup check + dismissible `CliHealthBanner`. Verified against
real installed CLIs (claude 2.1.162, codex 0.131.0 — both "ok", no false drift).
The live smoke-test (throwaway tmux round-trip) and the codex
`--append-system-prompt` confirmation remain as follow-ups. Original notes below.

Interactive mode shells directly into `claude`/`codex`; a CLI update can silently
break the product. **Do:** a startup/diagnostic CLI health check (detect binary
via `commands/cli_detect.rs` `find_cli`, run `--version`, parse `--help` to
assert expected flags exist, surface a UI warning on drift/missing); pin
known-good version ranges in settings (warn, don't hard-fail); add a
feature-flagged live smoke test that spawns claude/codex in a throwaway tmux
session and asserts ready-indicator + sentinel round-trip. Fragile assumptions to
guard (all in `bridge.rs`): claude `--dangerously-skip-permissions`,
`--output-format stream-json`, `--include-partial-messages`,
`--append-system-prompt`; codex `exec`, `--json`, `-c sandbox_mode=…`; the
ready-indicators (claude `╭`/`╰`, codex banner+32 bytes); sentinel-on-own-line.
**Verify in particular** whether codex actually accepts `--append-system-prompt`
(it's in the code but unconfirmed).

---

## C. Pre-existing product gaps (found during status audit — not refactor work)

Lower priority, separate from the source-of-truth/harness effort, but worth a
ticket each:
- **Custom keyboard shortcuts** render but are inert — `settings/tabs/shortcuts-tab.tsx`
  says "not yet active"; no store/apply of custom bindings.
- **Providers** OpenRouter / Google AI / Local (Ollama) are "Coming soon" cards
  in `settings/tabs/agent-tab.tsx`.
- **Voice/Whisper** fully implemented but feature-gated out of the default build
  (`voice` Cargo feature; `voice_stubs.rs`).
- **`thinking_level`** is *not* a stored task attribute and `--effort` isn't
  wired into the trigger path. If you want thinking-level as a first-class
  create option (Phase 2), it needs a DB column (migration after 045) + model
  struct field + CLI plumbing — a real slice, not a freebie.
- ~~**CLAUDE.md drift:** the architecture diagram lists a `discord/ ← Discord
  bridge` module that no longer exists.~~ ✅ Fixed 2026-06-05 (diagram now lists
  `config/`).

---

## Suggested order for the next agent(s)
~~Front 3, B1, B2, B3, B4~~ — **all landed (2026-06-05).** What's left, roughly
by leverage:
1. **MCP bug #3** (`mcp-fix-direct-db-no-events.md`) — route
   `mark_complete`/`add_dependency`/`remove_dependency` through the API so they
   emit `tasks:changed`. Small, scoped, removes a stale-UI footgun.
2. **MCP bug #4** (`mcp-add-source-attribution.md`) — source attribution +
   recursion guard on agent-spawned tasks (safety). Needs a migration.
3. **A2** — `pty:{taskId}:exit` snake_case casing (tiny: add the serde rename +
   one frontend read).
4. **B2 codex verification** — confirm codex `--resume` + `--append-system-prompt`
   actually work in interactive mode.
5. **C-section product gaps** — inert keyboard shortcuts, multi-provider stubs,
   `thinking_level` as a first-class attribute, voice un-gating.
