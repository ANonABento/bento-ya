# Unified Chat System — Architecture Plan

## Problem

Three separate chat/process systems exist with duplicated logic:
1. **CliSessionManager** (chef) — `--print` stream-json, chat bubbles, DB persistence
2. **AgentCliSessionManager** (task agent chat) — `--print` stream-json, chat bubbles, no persistence
3. **AgentRunner + PtyManager** (trigger agents) — full PTY terminal, xterm.js, no chat

This causes: code duplication, inconsistent behavior, triggers can't reuse existing sessions, no way to toggle between terminal/bubble views, and exit detection complexity.

## Goal

One unified chat system with:
- Swappable transport (PTY terminal vs pipe streaming)
- Togglable UI (xterm.js terminal vs chat bubbles) — user setting
- Triggers send messages into existing task sessions (not spawn new processes)
- Chef is a layer on top of base chat (action blocks, board context, tool execution)
- Idle timeout with resume support for resource management

## Architecture

### Core: UnifiedChatSession

```
UnifiedChatSession
├── transport: PtyTransport | PipeTransport
├── session_id: String (claude --resume ID)
├── task_id: Option<String> (None for chef)
├── workspace_id: String
├── state: Idle | Running | Suspended
├── last_activity: Timestamp
└── methods:
    ├── send_message(text) → streams events
    ├── suspend() → saves resume ID, kills process
    ├── resume() → respawns with --resume
    └── kill()
```

### Transport Layer

```rust
// Actual implementation (src-tauri/src/chat/transport.rs):
trait ChatTransport: Send {
    fn spawn(&mut self, config: SpawnConfig) -> Result<Receiver<TransportEvent>, String>;
    fn write(&mut self, data: &[u8]) -> Result<(), String>;
    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String>;  // no-op for pipe
    fn kill(&mut self) -> Result<(), String>;
    fn is_alive(&self) -> bool;
    fn pid(&self) -> Option<u32>;
}
// TransportEvent = Chat(ChatEvent) | Exited(Option<i32>)
// ChatEvent = SessionId | TextContent | ThinkingContent | ToolUse | Complete | RawOutput | Unknown
```

**PtyTransport** (terminal mode):
- Uses `pty-process` crate (current pty_manager internals)
- Spawns `claude` in full PTY
- Output: raw bytes → base64 → `pty:{id}:output` events
- Interactive: user can type, answer prompts
- Resize: supported
- Exit detection: `libc::waitpid(WNOHANG)` polling
- Claude features: voice STT, permission prompts, tool approval UI all work

**PipeTransport** (bubble mode):
- Uses `std::process::Command` with piped stdio
- Spawns `claude --print --output-format stream-json --verbose`
- Output: parsed JSON events → `ChatEvent::Text`, `ChatEvent::Thinking`, `ChatEvent::ToolUse`
- Non-interactive: fire message, receive structured response
- Resize: no-op
- Exit detection: `child.wait()` (reliable with pipes, no macOS PTY issue)
- Structured data: thinking blocks, tool calls rendered as UI cards

### Event System

Both transports emit unified events to the frontend:

```typescript
type ChatEvent =
  | { type: 'text', content: string }
  | { type: 'thinking', content: string, isComplete: boolean }
  | { type: 'tool_call', toolId: string, toolName: string, status: string, input?: object, result?: string }
  | { type: 'complete', finishReason: string }
  | { type: 'error', message: string }
  | { type: 'raw_output', data: string }  // base64, terminal mode only
```

Frontend renders based on user setting:
- **Bubble view**: renders `text`, `thinking`, `tool_call` as chat components
- **Terminal view**: renders `raw_output` in xterm.js (falls back to `text` for pipe transport)

### Session Lifecycle

```
Task created
  └→ NO process spawned yet (lazy)

User clicks into task card OR trigger fires
  └→ Check: session exists for this task?
     ├→ Yes + Running: send message directly
     ├→ Yes + Suspended: resume (--resume ID), then send
     └→ No: spawn new session, then send

Idle timeout (configurable, e.g. 5 min no activity)
  └→ Suspend: save resume ID to DB, kill process
     (process respawns on next interaction)

App close
  └→ Suspend all: save resume IDs, kill all processes
     (resume on next app launch when user interacts)
```

### Trigger Integration

Instead of spawning a new process, triggers send a message:

```
fire_trigger(task, column)
  └→ resolve prompt template
  └→ get_or_create_session(task_id)
     ├→ session exists + running → send_message(prompt)
     ├→ session exists + suspended → resume, send_message(prompt)
     └→ no session → spawn(task), send_message(prompt)
  └→ listen for completion → mark_pipeline_complete → auto-advance
```

This means:
- No more `fire_cli_trigger` / `fire_agent_trigger` / `fire_skill_trigger` split
- One `fire_trigger` that routes through unified chat
- Trigger prompt appears as a message in the task's chat history
- User can see what the trigger asked and what the agent did

### Chef Layer

Chef (orchestrator) adds on top of base chat:

```
ChefSession extends UnifiedChatSession
  ├── system_prompt: build_system_prompt(workspace, columns)
  ├── board_context: injected into each message
  ├── action_parsing: parse_cli_action_blocks() (pipe mode only)
  ├── tool_execution: execute_tools() after response
  ├── DB persistence: messages saved to chat_messages table
  └── session management: multiple named sessions, switchable
```

For pipe mode: chef parses action blocks from response and executes tools.
For terminal mode: chef's system prompt includes action block instructions, but execution happens through Claude's own tool use (no parsing needed — Claude calls tools natively in terminal mode).

### Settings

```json
{
  "chat": {
    "defaultTransport": "pipe",     // "pipe" | "pty"
    "defaultView": "bubble",        // "bubble" | "terminal"
    "idleTimeoutMs": 300000,        // 5 min
    "maxConcurrentSessions": 5
  }
}
```

User can override per-task from the task card UI (toggle button).

## Migration Path

### Phase 1: Unified Transport Trait -- DONE
- Created `src-tauri/src/chat/` module with 5 files
- `ChatTransport` trait with `PtyTransport` and `PipeTransport` implementations
- Shared utilities in `events.rs`: `parse_json_event`, `base64_encode`, `spawn_stderr_reader`
- Legacy `cli_shared.rs` delegates parsing to `chat::events` via `From<ChatEvent> for CliEvent`
- Legacy `pty_manager.rs` imports `base64_encode` from `chat::events`
- Existing managers unchanged — additive only, no breaking changes
- 57 tests passing (eliminated 13 duplicated parsing tests)

### Phase 2: UnifiedChatSession -- DONE
- `session.rs`: `UnifiedChatSession` wraps transport with lifecycle (idle/running/suspended)
- Pipe mode: `send_message()` spawns fresh CLI per message, returns (response, session_id)
- PTY mode: `start_pty()` spawns once, `write_pty()`/`resize_pty()` for interaction
- Resume ID tracking: captured from SessionId events, cleared on model change
- `registry.rs`: `SessionRegistry` with max concurrent sessions, get-or-create, suspend-idle
- `SharedSessionRegistry` (Arc<Mutex>) for Tauri managed state
- Existing managers unchanged — additive only
- 67 tests passing (10 new session/registry tests)

### Phase 3: Trigger Refactor — IN PROGRESS
**Phase 3a: V2 SpawnCli triggers — DONE**
- `bridge.rs`: `bridge_pty_to_tauri()` forwards transport events to Tauri events
- `bridge.rs`: `spawn_cli_trigger_task()` runs CLI trigger as background tokio task
  - Spawns PtyTransport directly, writes initial prompt, bridges events to frontend
  - Opens fresh DB connection on exit to call `mark_complete` (safe with WAL mode)
  - Error path sets pipeline error state via `handle_trigger_failure`
- `triggers.rs`: SpawnCli branch now spawns background task instead of emitting
  `pipeline:spawn_cli` event — no frontend round-trip needed
- `lib.rs`: `SharedSessionRegistry` registered as Tauri managed state + shutdown cleanup
- Legacy triggers (agent/skill/script from V1) still use frontend round-trip
- 67 tests passing

**Phase 3b: Legacy V1 triggers — DONE**
- Agent triggers: spawn CLI PTY directly with agent_type as command, no initial prompt
- Skill triggers: spawn CLI PTY with "claude" + `/{skill_name}` as initial prompt
- Script triggers: parse script_path into command + args, spawn PTY with env vars
- All three bypass frontend round-trip, use `spawn_cli_trigger_task` from bridge.rs
- State goes Triggered → Running within same function call (no frontend delay)

**Phase 3c: Dead code cleanup — DONE**
- Removed `fire_agent_trigger`, `fire_cli_trigger`, `fire_script_trigger`, `fire_skill_trigger` IPC commands from `commands/pipeline.rs`
- Removed from `lib.rs` invoke_handler registration
- Removed `SpawnAgentEvent`, `SpawnScriptEvent`, `SpawnSkillEvent` from `pipeline/mod.rs`
- Removed `SpawnCliEvent` from `pipeline/triggers.rs`
- Deleted `src/hooks/use-pipeline-events.ts` (entire file — all it did was relay spawn events)
- Removed `usePipelineEvents` hook usage from `app.tsx`
- Removed dead IPC functions + spawn event types from `ipc.ts`

### Phase 4: Chef Layer
- Create `ChefSession` that wraps `UnifiedChatSession`
- Move board context injection, action parsing, tool execution from `orchestrator.rs`
- Chef uses same transport as task agents (user's setting)

### Phase 5: Frontend Unification
- Single chat component that renders bubble or terminal based on setting
- Remove separate `AgentPanel`, `OrchestratorPanel` chat implementations
- One `ChatPanel` component used everywhere
- Toggle button in task card header: bubble/terminal

### Phase 6: Cleanup
- Remove `CliSessionManager`, `AgentCliSessionManager`, `AgentRunner` (replaced by unified system)
- Remove `PtyManager` (replaced by `PtyTransport`)
- Remove `cli_shared.rs` (replaced by `chat::events`)
- Track trigger sessions in `SessionRegistry` (currently created directly in bridge.rs)
- Add `agent_session` DB records for unified trigger sessions
- Update CLAUDE.md, SESSION.md

*Note: `fire_*_trigger` IPC commands and `use-pipeline-events.ts` already removed in Phase 3c.*

## File Changes (estimated)

### New Files
- `src-tauri/src/chat/mod.rs` — module root + re-exports (DONE)
- `src-tauri/src/chat/events.rs` — ChatEvent, ToolStatus, JSON parsing, base64, stderr reader (DONE)
- `src-tauri/src/chat/transport.rs` — ChatTransport trait, SpawnConfig, TransportEvent (DONE)
- `src-tauri/src/chat/pty_transport.rs` — PtyTransport (DONE)
- `src-tauri/src/chat/pipe_transport.rs` — PipeTransport (DONE)
- `src-tauri/src/chat/session.rs` — UnifiedChatSession (DONE)
- `src-tauri/src/chat/registry.rs` — session registry (DONE)
- `src-tauri/src/chat/bridge.rs` — Tauri event bridge + trigger runner (DONE)
- `src-tauri/src/chat/chef.rs` — ChefSession layer (Phase 4)
- `src-tauri/src/commands/chat.rs` — unified IPC commands (Phase 2)
- `src/components/chat/chat-panel.tsx` — unified chat component (Phase 5)
- `src/components/chat/bubble-view.tsx` — bubble renderer (Phase 5)
- `src/components/chat/terminal-view.tsx` — xterm.js renderer (Phase 5)
- `src/hooks/use-chat.ts` — unified chat hook (Phase 5)

### Modified Files
- `src-tauri/src/pipeline/triggers.rs` — trigger sends message instead of spawning
- `src-tauri/src/pipeline/mod.rs` — simplified trigger flow
- `src-tauri/src/lib.rs` — register new managed state, remove old managers
- `src/stores/settings-store.ts` — add chat settings
- `src/components/panel/` — use unified ChatPanel

### Already Removed (Phase 3c)
- `src-tauri/src/commands/pipeline.rs` — fire_*_trigger commands removed (mark_pipeline_complete etc. remain)
- `src/hooks/use-pipeline-events.ts` — deleted entirely
- `SpawnAgentEvent`, `SpawnScriptEvent`, `SpawnSkillEvent`, `SpawnCliEvent` structs

### To Remove (Phase 6)
- `src-tauri/src/process/cli_session.rs`
- `src-tauri/src/process/agent_cli_session.rs`
- `src-tauri/src/process/agent_runner.rs`
- `src-tauri/src/process/pty_manager.rs`
- `src-tauri/src/process/cli_shared.rs`

## Decisions (Resolved)

1. **Script triggers** — Unify. Scripts go through unified chat as a different command type.
2. **Skill triggers** — Natural fit: `send_message("/skill-name")`.
3. **Auto-switch view** — No. Build on existing chat controls. Transport dictates view: PTY → terminal, pipe → bubble. No mismatch possible.
4. **Resume on startup** — Lazy. Don't auto-resume. Wait for user click or trigger fire.
5. **Fallback** — If somehow PTY transport is active but bubble view requested, render raw output as code block. Shouldn't happen in practice since transport = view, but add fallback defensively.
6. **Queue system** — Session registry's `maxConcurrentSessions` replaces `use_queue` flag.
