# Terminal View V2 — Terminal-First with Lazy PTY

## Problem

The terminal view renders a blank xterm.js because:
1. Trigger-spawned agents use PipeTransport (structured JSON) — no `pty:output` events emitted
2. No PTY session exists until explicitly created — blank screen on toggle
3. Terminal view has no content for completed sessions

## Goal

Terminal is the **primary and only** view for task agent output. Every task gets a real embedded terminal (like VS Code's integrated terminal). Bubble view is disabled/disconnected — can be re-added later as an optional overlay.

## Decisions (Resolved)

| Question | Answer | Why |
|----------|--------|-----|
| PTY shell or claude? | **Bare shell (zsh)** | Model-agnostic — triggers inject `claude`, `codex`, `gpt-engineer`, whatever. Chef picks model, trigger builds command. |
| Bubble view? | **Disabled for now** | Terminal-first. No dual rendering, no ANSI adapter, no complexity. Bubble can be addon later. |
| Max concurrent PTYs? | **20 default, configurable** | ~60MB at max. LRU eviction suspends idle sessions with `--resume` on respawn. Setting in config. |

## Architecture

```
TASK PANEL OPENED (first time for this task)
  └→ Lazy spawn PTY: zsh in task's working dir
     └→ SessionRegistry[task_id]
     └→ bridge_pty_to_tauri() forwards raw bytes

TRIGGER FIRES (task moves to Working column)
  └→ SessionRegistry has PTY for task?
     ├→ Yes (running) → write command into PTY stdin
     └→ No → spawn PTY, then write command
  └→ Command: "claude --model sonnet -p '{prompt}'\n"

USER OPENS PANEL LATER
  └→ SessionRegistry has PTY?
     ├→ Yes (running) → reconnect xterm to event stream
     ├→ Yes (suspended) → resume PTY with --resume, reconnect
     └→ No → spawn fresh PTY

PTY IDLE > threshold (e.g. 5 min)
  └→ suspend(): save resume ID to DB, kill process
  └→ Next interaction: respawn with --resume

AT CAPACITY (20 PTYs)
  └→ LRU eviction: suspend oldest idle session
  └→ Make room for new session
```

### Data Flow

```
┌──────────────────────┐
│   PTY (zsh shell)    │
│                      │
│ $ claude -p "..."    │  ← trigger writes command
│ > thinking...        │
│ > editing file.ts    │
│ > done               │
│ $                    │  ← shell prompt returns
└──────────┬───────────┘
           │
     raw PTY bytes (every 16ms)
           │
┌──────────┴───────────┐
│     bridge.rs        │
│                      │
│ emit pty:{id}:output │──→ Tauri event
│ detect exit          │──→ pty:{id}:exit
│ mark_complete()      │──→ pipeline auto-advance
└──────────────────────┘
           │
           ▼
┌──────────────────────┐
│  TerminalView        │
│  (xterm.js)          │
│                      │
│  Renders raw bytes   │
│  User can type       │
│  Full scrollback     │
│  WebGL renderer      │
│  Theme-reactive      │
└──────────────────────┘
```

### Trigger Command Injection

When a column trigger fires for a task:

```rust
// bridge.rs — revised spawn_cli_trigger_task()

fn fire_trigger_into_pty(registry, task_id, command, prompt) {
    let session = registry.get_or_create(task_id, pty_config);

    if session.state() == Suspended {
        session.resume()?;  // respawn shell with --resume
    }

    if session.state() != Running {
        session.start_pty(cols, rows)?;
        bridge_pty_to_tauri(app, task_id, event_rx);
    }

    // Inject the CLI command into the shell
    let cmd = format!("{} -p '{}'\n", command, escape(prompt));
    session.write_pty(cmd.as_bytes())?;
}
```

The terminal shows:
```
bentomac@Mac ~/bento-ya % claude --model sonnet -p "Add v2.1 section to README..."
╭──────────────────────────────────────╮
│ Reading README.md...                 │
│ Editing README.md...                 │
│ Done.                                │
╰──────────────────────────────────────╯
bentomac@Mac ~/bento-ya %
```

User sees the full agent run live. After it exits, the shell prompt returns and the user can run `git diff`, `npm test`, whatever.

### Exit Detection

The trigger needs to know when the agent is done (for auto-advance). Two approaches:

**Option A: PTY exit monitoring (current)**
`bridge_pty_to_tauri` already watches for `TransportEvent::Exited`. But with a bare shell, the PTY exits when the *shell* exits, not when *claude* exits. We need to detect the inner process exiting.

**Option B: Poll for shell prompt return**
After injecting the command, watch the PTY output for the shell prompt to return. When we see the prompt pattern again, the command finished. This is how Warp detects command completion.

**Option C: Wrapper script**
Inject a wrapper: `claude -p "..." ; echo "___BENTOYA_EXIT_$?___"` — then watch for the sentinel in the PTY output stream. Simple and reliable.

**Recommendation: Option C.** Sentinel-based. Easy to implement, no false positives, works with any CLI. bridge.rs watches for the sentinel, extracts exit code, calls `mark_complete()`.

### Session Lifecycle

```
States: Idle → Running → Suspended
                ↑           │
                └───────────┘  (resume on next interaction)

Idle:       PTY not spawned yet (lazy)
Running:    Shell process alive, events flowing
Suspended:  Process killed, resume_id saved in DB
            Respawns with --resume on next interaction
```

### LRU Eviction

```rust
// registry.rs — enhanced get_or_create

fn get_or_create(&mut self, key, config, transport_type) {
    if !self.sessions.contains_key(key) {
        // At capacity? Evict oldest idle session
        if self.sessions.len() >= self.max_sessions {
            let oldest_idle = self.find_oldest_idle();
            if let Some(evict_key) = oldest_idle {
                self.sessions.get_mut(&evict_key).unwrap().suspend();
                self.sessions.remove(&evict_key);
            } else {
                return Err("All sessions active, cannot evict");
            }
        }
        self.sessions.insert(key, UnifiedChatSession::new(config, transport_type));
    }
    Ok(self.sessions.get_mut(key).unwrap())
}
```

Config:
```json
{
  "chat": {
    "maxPtySessions": 20,
    "idleTimeoutMs": 300000
  }
}
```

## Implementation Plan

### Task 1: Disable bubble view, terminal-only panel
- `agent-panel.tsx`: remove ChatHistory/ChatInput conditional, always render TerminalView
- Remove the toggle button (no dual mode for now)
- Remove `chatViewMode` from ui-store (or just ignore it)
- Keep the header with task title + close button

### Task 2: Lazy PTY spawn on panel open
- New Tauri command: `ensure_pty_session(taskId, workingDir, cols, rows)`
  - If session exists + running → return session info
  - If session exists + suspended → resume, return
  - If no session → spawn PTY (bare zsh), bridge events, return
- `terminal-view.tsx` calls `ensure_pty_session` on mount
- Frontend gets `pty:output` events immediately after spawn

### Task 3: Triggers inject commands into PTY
- `bridge.rs`: `spawn_cli_trigger_task()` rewritten:
  - Check registry for existing PTY session for this task
  - If exists → write CLI command into PTY stdin
  - If not → spawn PTY first, then write command
  - Use sentinel wrapper for exit detection
- Sentinel: `{command} ; echo "___BENTOYA_DONE_$?___"`
- bridge.rs watches for sentinel → extracts exit code → `mark_complete()`

### Task 4: LRU eviction + idle timeout
- `registry.rs`: `get_or_create` evicts oldest idle when at capacity
- Add `find_oldest_idle()` method
- Periodic timer (tokio interval, every 60s) calls `suspend_idle(threshold)`
- Config: `maxPtySessions` (default 20), `idleTimeoutMs` (default 300000)
- Settings UI: slider or input for max sessions

### Task 5: Scrollback persistence (optional, nice-to-have)
- On suspend: serialize xterm scrollback buffer to DB
- On resume + panel reopen: write saved scrollback into xterm before live data
- Prevents blank terminal after LRU eviction + reopen

## What Changes From Today's Code

| File | Change |
|------|--------|
| `agent-panel.tsx` | Remove bubble mode, always render TerminalView |
| `terminal-view.tsx` | Call `ensure_pty_session` on mount |
| `commands/agent.rs` | New `ensure_pty_session` command |
| `bridge.rs` | Rewrite trigger runner to inject into PTY + sentinel detection |
| `registry.rs` | LRU eviction in `get_or_create`, `find_oldest_idle()` |
| `ui-store.ts` | Remove or deprecate `chatViewMode` |
| `ipc/terminal.ts` | Add `ensurePtySession()` |
| Config | Add `maxPtySessions`, `idleTimeoutMs` |

## Not In Scope (Future)

- Bubble view as optional overlay (re-add later with JSON-to-ANSI adapter)
- Parsing structured events from PTY output for rich UI (shell integration / stream-json parsing)
- Multiple terminals per task
- Terminal tabs / split panes within a task
