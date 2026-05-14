# Persistent Per-Task Agent — Convergence Spec

> **Status:** Draft for review (2026-05-06).
> **Builds on:** [`INTERACTIVE_AGENT_TERMINAL.md`](./INTERACTIVE_AGENT_TERMINAL.md), [`UNIFIED_CHAT.md`](./UNIFIED_CHAT.md), [`PRODUCT.md`](../../PRODUCT.md).
> **Replaces:** Nothing — fills the gap between those specs and what actually ships.
> **Author:** Audit + plan after PR #194 (panel-collapse fix). User feedback: *"this output thing still is not working too well, i think itll be better if i could talk to the agent and steer it + see output."*

---

## 1. Why this doc exists

We have two long, careful specs from April that describe a Conductor-style persistent-per-task agent. Pieces of both shipped (tmux per task, PTY transport, terminal panel, jq stream filter). The lifecycle and input-routing pieces did not. Today's implementation:

- Spawns a **fresh tmux session per column trigger** and kills it on completion (`bridge.rs:1247`).
- Routes **chat panel input to a separate `Pipe` Claude subprocess** (`commands/agent.rs:316`), not into the running tmux session.
- **Auto-advances** the task on completion regardless of whether the user is mid-conversation (`pipeline/engine.rs:47`).

Result: clicking a card opens a read-only window onto process A while typing into the input goes to unrelated process B. Steering doesn't work because there's nothing to steer — the trigger process has already exited and been killed.

This doc is the convergence plan: one task → one session → many writers (trigger, user chat, voice) → one PTY → one terminal view.

---

## 2. Reference apps (what "good" looks like)

| App | Model |
|---|---|
| **Conductor** | One agent (Claude Code) per task, persistent, in a real terminal. User can type into it. Tasks have status, but the agent is the thing. |
| **Vibe Kanban** | Kanban over coding agents. Card = agent process. Click to attach, type to steer. |
| **Codex (OpenAI)** | Agent runs in a TUI/IDE shell. Same input lane for prompts, follow-ups, approvals. No "two boxes". |

KaitenCode's pitch (PRODUCT.md:13) is literally *"Conductor's parallel agent muscle + Vibe Kanban's board UI"*. We have the board. We need the agent muscle.

---

## 3. The mental model (canonical)

```
┌─────────────────────────────────────────────────────────┐
│ Task (DB row)                                           │
│   ├── worktree            (git worktree per task)        │
│   ├── tmux session        kaitencode_<task_id>             │
│   │     └── agent CLI     interactive: `claude` / `codex` │
│   │           ↑                                          │
│   │   ┌───────┴────────────────┐                         │
│   │   │  Writers (one PTY):    │                         │
│   │   │   1. Trigger injector  │   send-keys + Enter     │
│   │   │   2. User chat input   │   send-keys + Enter     │
│   │   │   3. Voice STT         │   send-keys + Enter     │
│   │   └────────────────────────┘                         │
│   │                                                      │
│   └── chat history (DB)   read-only mirror of PTY scrollback │
└─────────────────────────────────────────────────────────┘
```

**One session.** All writers send into the same PTY via `tmux send-keys`. The agent CLI doesn't know whether the bytes came from the user, a trigger, or voice. It just sees stdin.

**Persistent across columns.** Moving Working → Review does not kill the agent. The next column's trigger is a *message*, not a *spawn*.

**The chat panel is a window, not a separate process.** When the user types in the panel, those bytes go to `tmux send-keys`. Output flows back via the existing `pty:<task>:output` event stream that PR #192 already wired up.

---

## 4. Current vs target — the four gaps

Each gap has: **today (file:line)** → **target** → **scope of change**.

### Gap 1 — Sessions are per-trigger, not per-task

- **Today:** `bridge.rs:903` calls `tmux_transport::kill_session(task_id)` before each trigger to clean up. `bridge.rs:1247` kills again after completion. Fresh `tmux new-session` per column.
- **Target:** Session created on **task open** (first time user clicks card OR first trigger fires, whichever comes first). Survives column moves. Killed only on task delete or GC TTL.
- **Scope:** Refactor `spawn_cli_trigger_task()` (bridge.rs:753) into two functions:
  - `ensure_task_session(task_id)` — idempotent; creates tmux + starts `claude` interactive if not already running. Used by both card-open and trigger-fire paths.
  - `inject_trigger_message(task_id, prompt)` — `tmux send-keys -l <prompt>` + `Enter`. No session lifecycle.

### Gap 2 — Chat input goes to a separate subprocess

- **Today:** `use-chat-session.ts:312, 379` calls `ipc.streamAgentChat()` → `commands/agent.rs:316` → `UnifiedChatSession::new(TransportType::Pipe)`. A second Claude process. Different conversation. Different `--resume` ID. They never meet.
- **Target:** `streamAgentChat(taskId, message)` becomes a thin wrapper around `ensure_task_session(taskId)` + `tmux send-keys` of the message. Output already streams via `pty:<task>:output` from the panel attach.
- **Scope:** Replace `commands/agent.rs::stream_agent_chat` body. Delete the `Pipe` transport path for task chat (keep it for chef/orchestrator where it makes sense). UI: input bar already exists and posts to `streamAgentChat` — no UI change needed.

### Gap 3 — Auto-advance ignores user activity

- **Today:** `pipeline/engine.rs:47 try_auto_advance()` only checks workspace `autoAdvance` config and column trigger flags. Fires the moment exit criteria are met.
- **Target:** Defer advance when **any** of:
  - User has typed into the task chat in the last `userActivityWindow` (default 30s).
  - Chat panel is currently focused on this task AND has unsent draft text.
  - Task has been explicitly "held" by the user (new flag, set by a "Hold" button on the card).
- **Scope:** Add `last_user_input_at` column to `tasks` (or `agent_sessions`). Stamp on every `tmux send-keys` from the user (NOT from triggers). `try_auto_advance` reads it and short-circuits with a "deferred — user active" log + sets a card indicator (badge: `user steering`). Re-checks via the existing pipeline tick when activity goes stale.

### Gap 4 — Stop semantics are unclear

- **Today:** Stop button kills the tmux session. Same as task delete. Can't recover.
- **Target:** Stop sends `Ctrl+C` to the agent, leaves the shell alive, leaves the session alive. User can immediately type again or hit Retry.
- **Scope:** Replace `kill_session` call in stop handler with `tmux send-keys C-c`. Add a separate "Kill session" affordance behind a confirm for the rare case (panel header overflow menu).

---

## 5. Lifecycle state machine

Adapted from `INTERACTIVE_AGENT_TERMINAL.md §6` with one change: **`active` is entered on first input (trigger or user), not exclusively on column entry.**

```
States:
  none       no tmux session, no worktree (fresh task on Backlog)
  ready      tmux session created, shell at prompt, no agent running
  active     agent CLI running and processing input
  idle       agent CLI running, awaiting input (prompt visible)
  sleeping   tmux session detached from any panel; agent may be alive or exited
  dead       tmux session killed, resources freed

Transitions:
  Task created                          → none
  Card opened OR first trigger fires    → none → ready → active   (creates tmux, starts agent, sends first message)
  Agent finishes a turn, awaits input   → active → idle
  User types or trigger sends message   → idle → active
  Panel closed, no activity 30 min      → idle → sleeping        (detach bridge, agent may continue running)
  Panel reopens / new input arrives     → sleeping → idle/active (reattach bridge)
  User hits Stop                        → active → idle           (Ctrl+C; shell survives)
  User hits "Kill session" (rare)       → any → ready             (kill agent only)
  Task deleted OR Done → archive TTL    → any → dead
  App restart                           → recover ready/idle/active by scanning tmux; sleep panels closed
```

**Key invariant:** a task can be on any column in any state (except `none` requires Backlog/setup). The pipeline does not gate on session state — it gates on user activity (Gap 3) and exit criteria.

---

## 6. Input merging — the contract

All three writers funnel through a single `task_input(task_id, source, payload)` API.

| Source | Trigger condition | Stamps `last_user_input_at`? | Pre-formatting |
|---|---|---|---|
| `user.chat` | User submits chat panel input | **Yes** | Plain text + `Enter` |
| `user.voice` | STT final transcript | **Yes** | Plain text + `Enter` |
| `trigger.column` | Pipeline column on-entry trigger | No | Templated prompt (uses `.task.md` pointer pattern from existing spec §5) |
| `trigger.user.command` | User-invoked button (e.g. "Re-review") | **Yes** (counts as user steering) | Templated |

Implementation:

```rust
// src-tauri/src/chat/bridge.rs (new)
pub async fn task_input(
    task_id: &str,
    source: InputSource,    // User { chat | voice | command } | Trigger { column }
    payload: &str,
) -> Result<(), BridgeError> {
    let session = ensure_task_session(task_id).await?;
    if source.is_user() {
        db::stamp_user_activity(task_id).await?;
    }
    tmux::send_keys_literal(&session, payload).await?;
    tmux::send_keys_enter(&session).await?;
    Ok(())
}
```

Race: two writers send simultaneously. tmux send-keys is atomic per call, so the messages interleave at line boundaries — acceptable. We do not need a queue lock for v1; if it shows up in dogfood, add a per-task tokio Mutex on the session handle.

---

## 7. Stop / interrupt semantics

| User action | Today | Target |
|---|---|---|
| Stop button | `kill_session` | `send-keys C-c` (interrupt agent only) |
| Panel close | nothing | nothing (session keeps running, sleeps after 30 min idle) |
| Move card out of column mid-run | nothing | `send-keys C-c` to interrupt the in-flight trigger turn; session stays alive |
| Delete task | `kill_session` | `kill_session` + worktree remove (unchanged) |
| Restart app | bridge re-attaches | bridge re-attaches; rehydrate state from `tmux ls` + DB |
| Esc with chat focused | closes panel | unchanged |

The agent CLI must handle Ctrl+C gracefully (claude does; codex does; this is the standard interrupt contract).

---

## 8. Crash, resume, recovery

- **Agent crashes (non-zero exit, segfault):** session goes `active → ready` (shell prompt returns). Surface a banner in the panel: *"Agent exited with code N. [Restart] [View log]"*. Don't auto-restart — user steers.
- **App restart:** on boot, list `tmux ls | grep '^kaitencode_'`. For each, look up task in DB. If task exists and is not Done/Archived, mark session `idle`/`sleeping` based on whether a panel is restored. If task is gone, kill the orphan (existing GC logic at bridge.rs:1281).
- **Panel close → reopen:** `pty:<task>:output` events stop being consumed but tmux scrollback persists. On reopen, the bridge does `tmux capture-pane -p -S -10000` to seed the xterm.js scrollback, then resumes live tail. Today's panel already does the live-tail half; the seed-scrollback half is the missing piece.
- **`claude --resume`:** when an agent exits cleanly mid-task and the user types again, we want a new agent process that *continues the conversation*, not starts over. Use `claude --resume <session_id>`. The existing UnifiedChatSession already tracks `session_id` (UNIFIED_CHAT.md §Core); reuse that field.

---

## 9. DB schema deltas

Additions only. No destructive migrations.

```sql
-- migrations/NNNN_persistent_agent.sql
ALTER TABLE tasks ADD COLUMN last_user_input_at INTEGER;       -- unix ms; null until first user input
ALTER TABLE tasks ADD COLUMN held_by_user BOOLEAN DEFAULT 0;    -- explicit "don't advance" flag
ALTER TABLE agent_sessions ADD COLUMN claude_session_id TEXT;   -- for --resume
ALTER TABLE agent_sessions ADD COLUMN state TEXT NOT NULL DEFAULT 'ready';
                                                                -- ready | active | idle | sleeping | dead
ALTER TABLE agent_sessions ADD COLUMN last_state_change_at INTEGER;
```

`agent_sessions` already exists (one row per task). We're just adding state-machine fields.

---

## 10. IPC surface deltas

Add:

```ts
// src/lib/ipc/agent.ts
ensureTaskSession(taskId: string): Promise<{ sessionId: string; state: SessionState }>
sendTaskInput(taskId: string, source: 'chat' | 'voice' | 'command', text: string): Promise<void>
interruptTask(taskId: string): Promise<void>     // Ctrl+C, leaves session alive
killTaskSession(taskId: string): Promise<void>   // true kill, behind confirm
holdTask(taskId: string, held: boolean): Promise<void>
```

Replace:

```ts
streamAgentChat(...)  // becomes a thin wrapper: ensureTaskSession + sendTaskInput('chat', ...)
```

Remove (after Phase 2 stable):

- The `TransportType::Pipe` code path inside `commands/agent.rs::stream_agent_chat` for task chat. Keep `Pipe` transport for chef/orchestrator (separate concern, separate DB scope).

---

## 11. UI contract

Mostly already correct (the panel exists). Required changes:

- **Panel input bar** posts to `sendTaskInput('chat', text)`. Today it posts to `streamAgentChat` which spawns a parallel process. Swap the implementation, keep the UI.
- **Stop button** calls `interruptTask`. Today it calls `kill_session`. Swap the implementation; rename label to "Interrupt" if room.
- **Card badges:**
  - `● running` — session.state = active
  - `◆ idle` — session.state = idle (subtle, only when panel closed)
  - `✋ user steering` — `last_user_input_at` within window AND auto-advance was deferred
  - `⏸ held` — `held_by_user = true`
- **Card overflow menu:** add "Hold task" / "Release hold" / "Kill session…"

Keep: panel layout, scrollback rendering, jq stream filter, voice button, mode/model dropdowns.

---

## 12. Phased execution plan

Each phase ships behind a workspace flag so the old behavior stays available until we're confident.

### Phase A — Session lifecycle decoupling (2 days)

1. Extract `ensure_task_session()` + `inject_trigger_message()` from `spawn_cli_trigger_task()`.
2. Stop killing sessions on trigger completion. GC takes over (existing TTL logic, just stop the per-trigger kill).
3. Restart Claude inside the session via `claude --resume <id>` when re-entering after exit, instead of fresh spawn.
4. Test: move a task across 3 columns, confirm `tmux ls` shows one session the whole time, scrollback continuous.

**Ships behind:** workspace flag `persistentAgentLifecycle: true`. Default off for this phase.

### Phase B — Chat input unification (1 day)

1. Implement `sendTaskInput()` IPC + Rust handler that does `tmux send-keys`.
2. Repoint `streamAgentChat()` in `use-chat-session.ts` (lines 312, 379) and `use-agent-session.ts` (line 156) at the new IPC.
3. Delete the `Pipe` task-chat code path (keep chef path).
4. Test: type in panel while trigger is running — message appears interleaved at next agent turn.

**Ships behind:** same flag. Both Phase A and B must be on together for the model to make sense.

### Phase C — Auto-advance gate + Hold (1 day)

1. Stamp `last_user_input_at` on user inputs only.
2. Update `try_auto_advance` (engine.rs:47) to defer when `last_user_input_at` is fresh OR `held_by_user`.
3. Add Hold/Release UI on card overflow menu and the panel header.
4. Test: send chat message → trigger exit fires → confirm task does not advance until user goes idle for 30s.

### Phase D — Stop semantics + scrollback seeding + recovery polish (1 day)

1. Stop button → `interruptTask` (Ctrl+C). Add "Kill session" behind confirm.
2. Panel reopen seeds scrollback via `tmux capture-pane -p -S -10000`.
3. App-restart recovery: rehydrate `agent_sessions.state` from `tmux ls` + saved state.
4. Card badges (`✋ user steering`, `⏸ held`).

### Phase E — Flag flip + cleanup (0.5 day)

1. Flip `persistentAgentLifecycle` default to `true`.
2. Migrate existing in-flight tasks (best effort: kill running ephemeral sessions, recreate as persistent on next interaction).
3. Remove the legacy spawn-per-trigger code paths. Delete the now-dead `Pipe` task-chat code.
4. Update PRODUCT.md, CLAUDE.md, INTERACTIVE_AGENT_TERMINAL.md to reflect what shipped.

**Total estimate:** ~5 working days, parallelizable to ~3 with two agents.

---

## 13. Migration / dual-run strategy

While `persistentAgentLifecycle = false`:
- All current code paths work unchanged.
- New code paths are dormant behind feature flag.

While `persistentAgentLifecycle = true`:
- New paths are active.
- Old `kill_session` on trigger completion is skipped.
- Old `streamAgentChat → Pipe` is replaced.

There is no "half on" mode — A and B must flip together. C, D can flip independently and degrade gracefully (defaults match old behavior if the new gates are absent).

---

## 14. Out of scope (for this rebuild)

- **Multi-agent-per-task.** One session per task. If the user wants a second agent investigating in parallel, that's a second task, branched.
- **Cross-task agent handoff.** Each task is an island. Orchestrator/chef coordinates by creating new tasks, not by talking to siblings.
- **Worktree-per-task changes.** Already exists. Untouched.
- **Voice routing for trigger turns.** Voice STT goes into the same input lane as chat (`task_input` source = `voice`). Same gating rules.
- **Codex / non-claude CLIs.** The model is CLI-agnostic but Phase A-E ship with claude as the only validated agent. Codex support is one config field once the lifecycle works.
- **Conductor-style git diff in the panel.** Separate concern; the panel today shows the terminal, not a diff. Out of scope for the rebuild.

---

## 15. Decisions (answered 2026-05-07)

1. **Auto-advance gate.** A user message **disables auto-advance for that task entirely** — the toggle flips off automatically when the user sends a chat message (intent: "if I'm typing, I want manual control"). A toggle UI in the panel header lets the user re-enable auto-advance. When re-enabled: agent must finish all queued messages before the task can advance (no advance with pending input). Card-side badge mirrors panel toggle. **No silence-window timer** — toggle state is the single source of truth.

2. **Hold UI synced both places.** Card overflow menu has Hold button. Panel header has the auto-advance toggle (which also acts as Hold when off). Card and panel must read the same store slice — no divergence allowed. Test: flip from card → assert panel reflects, and vice versa.

3. **Stop button on idle.** Greyed out, disabled. No input.

4. **`claude-mock`.** Remove. The special branch in `bridge.rs::build_trigger_command` was a one-time dogfood hook, not load-bearing. Strip it during the rebuild. If we need a mock later, put it behind `KAITENCODE_DEV=1` then.

5. **Mid-trigger Claude failures.** Reuse the existing card-level badge system (research it — don't invent a new one). Wire rate-limit / auth / crash signals into the existing badge rendering. Panel banner stays for detail.

6. **Backlog handling.** Lazy. Plus: this rebuild includes an **optimization audit pass** — see §17.

7. **GC TTL.** Keep the existing idle/sleep/kill ladder (already implemented in `gc.rs`: `idle_sleep_minutes` → detach, `idle_kill_hours` → kill). Resume via saved `claude_session_id`. Folded into the optimization audit.

---

## 17. Optimization audit pass (companion track)

The existing system already has GC infrastructure (`src-tauri/src/chat/gc.rs`, `registry.rs::sweep_idle`, `cleanup_dead_running_agent_sessions`, settings keys `gc_interval_minutes` / `idle_sleep_minutes` / `idle_kill_hours`). The rebuild must **extend** this surface, not duplicate it.

The agent doing this work must, before writing any new GC code:

1. Read `src-tauri/src/chat/gc.rs`, `registry.rs`, `log_retention.rs` end-to-end.
2. Read `src-tauri/src/config/mod.rs` for the existing settings keys.
3. Document (in PR description or a brief audit note) what already exists vs what's missing for the persistent-agent model.
4. Then propose deltas as additions to existing files, not new modules.

What we need on top of what exists:

- **Cleanup on task delete.** Confirm `delete_task` IPC kills tmux + removes worktree + drops `agent_sessions` row. If it doesn't, fix it. (Likely already does — verify.)
- **Cleanup on task move OUT of trigger column while running.** Per April spec §6: send Ctrl+C to interrupt the in-flight turn but keep session alive. Verify behavior.
- **Resume after kill.** When a session is GC-killed (idle > `idle_kill_hours`), the saved `claude_session_id` must be persisted so the next user input can `claude --resume <id>` instead of starting cold.
- **TTL on Done.** Use existing `idle_kill_hours` knob (default proposed: 4h). No new config.
- **No double-spawn.** Concurrent `ensure_task_session()` calls must coalesce — one session per task, ever.

Tests required (TDD, write before code):

- `gc_kills_orphan_sessions` — already exists, confirm still passing.
- `delete_task_removes_session_and_worktree` — add if missing.
- `move_out_of_trigger_column_interrupts_but_preserves_session` — new.
- `gc_killed_session_resumes_with_saved_id` — new.
- `concurrent_ensure_task_session_returns_same_handle` — new.

---

## 18. Task card UI fixes (companion track)

User-flagged screenshot shows the card title row crammed with 5 icons (external-link, play, refresh, trash, kebab) competing with a wrapping multi-line title. Source: `src/components/kanban/task-quick-actions.tsx` rendered inside `task-card.tsx`.

Issues to fix:

1. **Trash icon exposed.** Destructive action one click away from Play and Open. Move Trash into the kebab/overflow menu only.
2. **Icon density.** Too many icons in the title row. Keep at most 2 quick-actions visible (Play, Open) + the kebab. Everything else moves into overflow.
3. **Title overlap.** When the title wraps to two lines, icons should not float beside the first line — they should sit on their own row (title takes full width, actions row beneath) OR the actions should be revealed only on hover.
4. **Workspace embedded in title.** "Migrate Clerk → NextAuth.js — Slothing" has the workspace name baked into the title string. The workspace should be a separate badge or live in the card metadata footer, not in the title.
5. **Hold/auto-advance badge.** The new ✋ / "user steering" / "held" badge from §11 must live in the same row as other status badges, not in the actions row.

This is a small refactor to `task-quick-actions.tsx` + `task-card.tsx`. Add a snapshot/regression test (vitest + RTL) that locks the new layout.

---

## 16. Acceptance criteria (for the rebuild as a whole)

A user can:

- [ ] Open a Backlog card, type "build me a hello-world", hit Enter — agent starts in panel and works.
- [ ] Watch the agent run, then type "actually use rust instead" mid-run — message reaches the same agent.
- [ ] Move the card from Working → Review — the same agent receives the review prompt; no fresh spawn; scrollback continuous.
- [ ] Have a conversation with the agent for 5 minutes while a column trigger fires in the background; the task does not auto-advance until the user is quiet.
- [ ] Hit Stop — agent halts current turn; user types a new message; agent resumes (via `--resume`).
- [ ] Hit "Hold" — task does not advance regardless of completion state; badge shows.
- [ ] Close the app, reopen — session recovered, panel attached, scrollback intact.
- [ ] Delete the task — tmux session and worktree gone, no orphans in `tmux ls`.

---

## Appendix A — File-by-file change list

| File | Change |
|---|---|
| `src-tauri/src/chat/bridge.rs` | Extract `ensure_task_session` + `inject_trigger_message`. Stop calling `kill_session` on trigger exit. Add `task_input()` API. |
| `src-tauri/src/chat/registry.rs` | Add session state field + transitions. |
| `src-tauri/src/chat/tmux_transport.rs` | Add `capture_pane_scrollback(session, n_lines)` for panel reopen seeding. |
| `src-tauri/src/commands/agent.rs` | Replace `stream_agent_chat` body with `ensure_task_session` + `tmux send-keys`. Remove `Pipe` task path. |
| `src-tauri/src/pipeline/engine.rs` | `try_auto_advance` reads `last_user_input_at` + `held_by_user`. |
| `src-tauri/src/pipeline/triggers.rs` | Trigger fire = `task_input(source=Trigger)`. No session lifecycle. |
| `src-tauri/src/db/migrations/` | New migration: schema deltas from §9. |
| `src-tauri/src/api.rs` | New IPC commands per §10. |
| `src/hooks/chat-session/use-chat-session.ts` | Repoint to `sendTaskInput`. |
| `src/hooks/use-agent-session.ts` | Repoint. |
| `src/components/panel/agent-panel.tsx` | Stop button → `interruptTask`. Add "Kill session…" overflow item. |
| `src/components/kanban/task-card.tsx` | Hold badge + button. `user steering` badge. |
| `PRODUCT.md`, `CLAUDE.md`, `INTERACTIVE_AGENT_TERMINAL.md` | Update post-Phase E to reflect shipped state. |

## Appendix B — What we don't touch

- jq stream filter (PR #192) — stays as-is.
- Panel collapse/expand (PR #194) — stays as-is.
- Voice plugin in choomfie — separate repo, separate concern.
- Workspace tabs, drag-and-drop, column config UI — orthogonal.
- Orchestrator (workspace-level chef) — a separate, parallel UnifiedChatSession; this doc is task-scoped only.
