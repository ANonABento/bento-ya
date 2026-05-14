# GPT Agent Handoff — KaitenCode Persistent Agent Rebuild

> Paste the section under `## PROMPT FOR GPT AGENT` into the GPT/codex agent.
> The sections above it are notes for the human running the handoff.

---

## Context (for you, the human)

- Spec lives at `/Users/bentomac/kaitencode/.tickets/_docs/PERSISTENT_AGENT_REBUILD.md`. It's the source of truth. The prompt below tells the agent to read it.
- Decisions on the 7 questions are baked into §15 of that spec.
- Optimization audit pass is §17. Card UI fixes are §18.
- Repo: `/Users/bentomac/kaitencode` — Tauri v2 desktop app, Rust backend + React/TS frontend.
- Existing GC infra is in `src-tauri/src/chat/gc.rs` and `registry.rs`. The agent must reuse, not duplicate.
- Recent merges: PR #192 (jq stream filter) and PR #194 (panel collapse fix). Don't undo either.

## Suggested model

`gpt-5.2-pro` (top reasoning) or `gpt-5.1-codex` (code-gen tuned, 400K ctx). If running via `codex` CLI directly: just paste the prompt — codex picks its model.

---

## PROMPT FOR GPT AGENT

You are an implementation agent working on **kaitencode**, a Tauri desktop app at `/Users/bentomac/kaitencode`. We are rebuilding the per-task agent loop to be Conductor/Vibe-Kanban-style: one persistent agent per task, you steer it via chat, it survives column moves.

### Required reading (read in this order, do not skip)

1. `/Users/bentomac/kaitencode/.tickets/_docs/PERSISTENT_AGENT_REBUILD.md` — **the spec. Source of truth.**
2. `/Users/bentomac/kaitencode/.tickets/_docs/INTERACTIVE_AGENT_TERMINAL.md` — the April 2026 design this rebuild realizes.
3. `/Users/bentomac/kaitencode/.tickets/_docs/UNIFIED_CHAT.md` — the chat transport architecture.
4. `/Users/bentomac/kaitencode/PRODUCT.md` (lines 1-300, 940-1000) — product vision, terminal panel UX.
5. `/Users/bentomac/kaitencode/CLAUDE.md` — repo conventions.

### Code to study before touching anything

Backend (Rust):
- `src-tauri/src/chat/bridge.rs` — current per-trigger spawn lifecycle. Lines you must understand: `spawn_cli_trigger_task` (~753), the `kill_session` calls at 903 and 1247, `tmux_session_name` (650).
- `src-tauri/src/chat/gc.rs` — existing garbage collector. Must reuse this; do not write a parallel one.
- `src-tauri/src/chat/registry.rs` — session registry, LRU eviction, `sweep_idle`, `cleanup_dead_running_agent_sessions`.
- `src-tauri/src/chat/log_retention.rs` — log retention.
- `src-tauri/src/chat/tmux_transport.rs` — tmux primitives (`session_name`, `kill_session`, `send_keys`).
- `src-tauri/src/commands/agent.rs` — `stream_agent_chat` at line 316 spawns the parallel `Pipe` subprocess that needs to be eliminated for task chat.
- `src-tauri/src/pipeline/engine.rs` — `try_auto_advance` at line 47.
- `src-tauri/src/pipeline/triggers.rs` — trigger execution.
- `src-tauri/src/config/mod.rs` — settings: `gc_interval_minutes`, `idle_sleep_minutes`, `idle_kill_hours`.
- `src-tauri/src/db/` — migrations + task / agent_sessions schema.
- `src-tauri/src/api.rs` — IPC surface.

Frontend (TS/React):
- `src/hooks/chat-session/use-chat-session.ts` — chat input flow. Lines 312, 379 call `streamAgentChat` (must redirect).
- `src/hooks/use-agent-session.ts` — line 156 also calls `streamAgentChat`.
- `src/hooks/use-chat-panel.ts` — chat panel state.
- `src/components/panel/agent-panel.tsx` — the terminal panel UI shell.
- `src/components/layout/split-view.tsx` — panel mount/unmount, recently fixed in PR #194.
- `src/components/kanban/task-card.tsx` — task card (573 lines, large file).
- `src/components/kanban/task-quick-actions.tsx` — the icon row at the top of the card. **§18 of spec covers UI fixes here.**
- `src/lib/ipc/agent.ts` — IPC bindings, where new commands go.
- `src/store/` — zustand stores; find the one that holds task state and auto-advance flags.

### Decisions already made (do not relitigate)

See spec §15 for full text. Summary:

1. **User chat message → auto-advance OFF for that task.** Toggle in panel header re-enables it. When re-enabled with queued messages, agent must drain queue before any advance is permitted.
2. **Hold UI in both card overflow menu AND panel header.** Both bind to the same store slice; flipping one must reflect in the other. Test this explicitly.
3. **Stop button greyed out when state = idle.** No-op visual.
4. **Remove the `claude-mock` branch in `bridge.rs::build_trigger_command`.** Delete it cleanly.
5. **Reuse the existing card-level badge system** for rate-limit/auth/crash failures. Do not invent a new one. Find the existing badge component first.
6. **Lazy session creation.** Tmux session created on first input (chat or trigger), not on card click.
7. **Reuse existing `gc_interval_minutes` / `idle_sleep_minutes` / `idle_kill_hours` settings** for TTL ladder. Resume via saved `claude_session_id`.

### What you are building

Five phases (§12 of spec). Ship behind workspace flag `persistentAgentLifecycle` (default off until Phase E).

- **Phase A** — Session lifecycle decoupling. Stop killing sessions per trigger. One tmux per task lifetime. `claude --resume` after exit.
- **Phase B** — Chat input unification. `streamAgentChat` becomes `tmux send-keys`. Kill the `Pipe` task-chat path.
- **Phase C** — Auto-advance gate via toggle (per decision §15.1). Hold UI synced both places (§15.2).
- **Phase D** — Stop = Ctrl+C. Scrollback seed via `tmux capture-pane -p -S -10000`. Recovery on app restart.
- **Phase E** — Flip flag default to true. Delete legacy code paths. Update docs.

Companion tracks (run alongside the phases, don't block them):

- **Optimization audit** (spec §17) — extend existing GC, do not duplicate. Add the 5 listed tests.
- **Task card UI fixes** (spec §18) — refactor `task-quick-actions.tsx` + `task-card.tsx`. Move Trash to overflow. Workspace name out of title. Lock with snapshot test.

### Hard constraints

- **TDD.** For every behavior change in spec §17 acceptance criteria, write the test first; watch it fail; then implement. Backend tests via `cargo test`. Frontend via `npx vitest run`.
- **Reuse before creating.** If a function, settings key, store slice, badge component, or test helper already exists for a concept, use it. The audit pass in §17 is non-negotiable — read the existing GC code before writing new GC code.
- **Feature flag.** All Phase A-D work behind `persistentAgentLifecycle` workspace setting. Old code paths stay until Phase E.
- **One PR per phase.** Do not bundle phases. Each PR has: tests added/updated, the phase's file changes, a `## What this PR does` block referring to the spec section.
- **Don't break PR #192 (jq filter) or PR #194 (panel collapse fix).** They are recent and load-bearing.
- **Don't touch:** voice plugin (separate repo: choomfie), workspace tabs, drag-and-drop, column config UI, orchestrator/chef.
- **No comments explaining what code does.** Only comments for non-obvious why. CLAUDE.md spells this out.

### Deliverables for this handoff session

You decide pace, but at minimum produce:

1. **A short audit note** (markdown, in this conversation or in a new file `.tickets/_docs/AUDIT_NOTES_persistent_agent.md`) summarizing: what GC infra exists, what's missing, which existing functions you'll extend, which new ones you'll add. Read first; don't write yet.
2. **The Phase A migration** as a concrete diff or PR. Backend changes only (lifecycle decoupling). Tests included.
3. **Open questions surfaced back to the user** if any constraint conflicts with what you find in the code.

If the work is bigger than fits this session, stop after the audit note + Phase A and hand back a clear list of what's left in priority order. Better to ship Phase A solidly than half-do everything.

### Output style

- Write code, not essays. Show diffs/edits, not narration.
- When you must explain, ≤ 3 sentences.
- File:line refs for every claim about existing code.
- If a decision doesn't fit reality (e.g. file moved, settings keys renamed, function signatures different), surface that as a flagged question rather than guessing.

### Working directory

`/Users/bentomac/kaitencode`

### Verification commands

- Type check: `npm run type-check`
- Frontend tests: `npx vitest run`
- Lint: `npm run lint`
- Rust check: `cd src-tauri && cargo check`
- Rust tests: `cd src-tauri && cargo test`
- Build for runtime test: `bun tauri build` (NOT `cargo build --release` — Tauri build embeds frontend assets)

### Definition of done (for the rebuild as a whole)

See spec §16. Eight acceptance criteria. The user manually validates against those after Phase E ships.

---

Begin with the audit note. Confirm you've read the spec by quoting one sentence from §3 (the mental model section) before doing anything else.
