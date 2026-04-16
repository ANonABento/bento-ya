# Handoff — Terminal Bridge Rewrite

## Context

Session dates: 2026-04-07 through 2026-04-09. Implemented terminal-first agent panel with lazy PTY sessions as part of Unified Chat Phase 6. The foundational pieces are solid but the bridge/reconnect layer has accumulated bugs from incremental design.

## What Works (Keep These)

### Solid Foundations
- **xterm.js component** (`terminal-view.tsx`) — WebGL renderer, base64 decode, theme-reactive, resize observer, fit addon. Tested and working.
- **Unified Chat Session** (`session.rs`) — lifecycle management, resume ID tracking, transport switching, scrollback buffer. 163 tests pass.
- **Session Registry** (`registry.rs`) — LRU eviction (max 20), idle sweep (60s interval, skips PTY), scrollback cache, `take()` for mutex-free message sending.
- **PtyTransport** (`pty_transport.rs`) — PTY spawn, reader thread, exit watcher, broadcast channel support, `resubscribe()`, SIGTERM on kill.
- **Sentinel detection** (`bridge.rs`) — per-trigger nonce, `___BENTOYA_{nonce}_{exit}___` pattern, extract from base64-decoded PTY output.
- **`__LAST__` placeholder** (`executor.rs`) — Chef can create + move in one action block.
- **`ensure_pty_session` command** — bare shell ($SHELL) in task working dir, worktree-aware.
- **E2E tests** — 17 webdriver tests pass, self-seeding.
- **Bug fixes** — resize handle z-index, duplicate task card status, exit code in payload, Chef system prompt.

### Frontend (Working)
- `agent-panel.tsx` — terminal-only, 52 lines, clean
- `terminal-view.tsx` — base64 decode, listener-before-spawn ordering, rAF fit delay, 0x0 resize guard
- `ipc/terminal.ts` — `ensurePtySession`, `writeToPty`, `resizePty`, `switchAgentTransport`

### Backend (Working)
- All 163 cargo tests pass
- Session persistence works (same PID across reconnect, verified in webdriver test)
- Trigger prompt resolution + worktree creation works
- Chef `__LAST__` placeholder works

## What's Broken (Fix in Rewrite)

### 1. Bridge Duplication (CRITICAL)
**Problem:** Multiple bridges can forward the same PTY output simultaneously.
- `spawn_cli_trigger_task` starts an mpsc bridge
- `ensure_pty_session` (panel open) tried to start a broadcast bridge
- Result: every character appears 2-3x

**Current workaround:** Reconnect path doesn't start a bridge (commit `b05c73f`). But this means if the original bridge dies (e.g. mpsc channel fills up), reconnect has no way to get events.

**Root cause:** No single owner of the "bridge this PTY to Tauri events" responsibility. Two codepaths create bridges independently.

### 2. Trigger Execution Failure
**Problem:** `codex` trigger fails with "Execution failed" — likely PATH issue.
- Tauri app's process environment may not include `~/.local/bin`
- The PTY shell sources `.zshrc` but the 200ms delay might be too short
- No error detail propagated to the user (just generic "Execution failed")

**Needs:** Full PATH resolution, longer/smarter shell init detection, detailed error messages.

### 3. No Bridge Cancellation
**Problem:** No way to stop an old bridge when starting a new one.
- If the mpsc bridge is running and the session is reconnected, you can't tell the old bridge to stop
- Orphaned bridge tasks accumulate (harmless but wastes resources)

### 4. Shell Init Race
**Problem:** 200ms fixed delay before writing trigger command to fresh PTY.
- Too short for heavy `.zshrc` files (oh-my-zsh, nvm, etc.)
- Too long for fast shells (feels sluggish)
- No detection of when the shell is actually ready

## Architecture for Rewrite

### Single Bridge Per Task

```
SessionRegistry
  └─ task_id → ManagedSession {
       session: UnifiedChatSession,
       bridge_handle: Option<JoinHandle>,  // ONE bridge, cancellable
       sentinel_nonce: Option<String>,
     }

ensure_pty_session(task_id):
  if session alive AND bridge alive → return scrollback (no new bridge)
  if session alive AND bridge dead → start new bridge, return scrollback
  if session dead → spawn fresh, start bridge

spawn_cli_trigger_task(task_id):
  ensure session exists (via ensure_pty_session logic)
  write command into PTY
  bridge already running from ensure or previous trigger
```

Key principle: **one bridge per task, managed lifecycle.** The bridge is started when the session is created and restarted only if it dies.

### Bridge as a Managed Resource

```rust
struct ManagedBridge {
    handle: JoinHandle<()>,
    cancel: CancellationToken,  // tokio_util::sync::CancellationToken
}

impl ManagedBridge {
    fn start(app: AppHandle, task_id: String, event_rx: mpsc::Receiver<TransportEvent>) -> Self;
    fn cancel(&self);
    fn is_alive(&self) -> bool;
}
```

### Shell Ready Detection

Instead of a fixed 200ms delay:

```
spawn PTY → watch output for shell prompt pattern
         → regex: /[$%#>]\s*$/ or /\w+@\w+.*[$%#]/
         → once matched: shell is ready, write command
         → timeout: 5s fallback
```

### Event Flow (Simplified)

```
PtyTransport (read thread)
  → mpsc → async buffer task → broadcast sender
                                    ↓
                              ManagedBridge subscribes
                                    ↓
                              app.emit("pty:{id}:output")
                                    ↓
                              Frontend listen() → xterm.write()
```

Only broadcast, no mpsc-to-frontend path. The mpsc is internal (read thread → buffer task). Broadcast is the only external interface.

## Files to Change

| File | Change |
|------|--------|
| `chat/bridge.rs` | Rewrite: `ManagedBridge` struct, single bridge per task, cancel support |
| `chat/registry.rs` | Add `bridge_handle` + `sentinel_nonce` to session tracking |
| `chat/pty_transport.rs` | Remove mpsc event_rx from `spawn()` return, broadcast-only |
| `chat/transport.rs` | Update trait: `spawn()` returns broadcast::Receiver |
| `chat/pipe_transport.rs` | Update to use broadcast (or keep mpsc internally + broadcast adapter) |
| `chat/session.rs` | Remove mpsc plumbing, `start_pty()` returns broadcast::Receiver |
| `commands/agent.rs` | Simplify `ensure_pty_session` — single codepath, no Action enum |
| `commands/terminal.rs` | No change needed |

## Commits from This Session

```
b05c73f Fix triple character output: don't start duplicate bridge on reconnect
21bd1c1 Fix Chef duplicate task: support __LAST__ task ID reference in actions
4cb2ec0 Fix resubscribe: override trait method, not just inherent impl
398d9e7 Fix 7 terminal audit issues: session persistence, idle sweep, exit code, more
74246a2 Fix idle sweep panic: use tauri::async_runtime::spawn
712b5e6 Fix duplicate shell prompts on panel close/reopen
010b1ab Fix registry mutex held across long await + remove dead chatViewMode code
f8efb07 Fix review bugs: sentinel injection, LRU eviction leak, shell init delay
b36fab4 Harden sentinel with per-trigger nonce + cap scrollback cache
e0e8b30 Add scrollback persistence across PTY session restarts
4d732ea Add LRU eviction + periodic idle timeout for PTY sessions
a2afb19 Triggers inject CLI commands into task PTY with sentinel exit detection
457cd92 Add terminal-first agent panel with lazy PTY sessions
```

## Test Status

- 163 backend tests passing
- 17 e2e webdriver tests passing
- Manual: terminal renders, typing works (1:1 after bridge fix), session persists across panel close/open, worktree creation works
- Manual: codex trigger execution fails (PATH issue, not terminal bug)
