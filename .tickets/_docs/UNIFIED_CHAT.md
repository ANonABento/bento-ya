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
trait ChatTransport {
    fn spawn(config: &SpawnConfig) -> Result<Self>;
    fn send(&mut self, message: &str) -> Result<()>;
    fn on_output(&self) -> Receiver<ChatEvent>;
    fn on_exit(&self) -> Receiver<ExitStatus>;
    fn resize(&self, cols: u16, rows: u16) -> Result<()>;  // no-op for pipe
    fn kill(&mut self);
}
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

### Phase 1: Unified Transport Trait
- Create `ChatTransport` trait with `PtyTransport` and `PipeTransport` implementations
- Extract shared logic from current `pty_manager.rs`, `cli_session.rs`, `cli_shared.rs`
- Keep existing managers working, just refactor internals

### Phase 2: UnifiedChatSession
- Create `UnifiedChatSession` struct that wraps a transport
- Implement session lifecycle (spawn, suspend, resume, kill)
- Session registry: `HashMap<String, UnifiedChatSession>` (keyed by task_id or "chef:{workspace_id}")

### Phase 3: Trigger Refactor
- Change `fire_trigger` to route through `UnifiedChatSession`
- Remove `fire_cli_trigger`, `fire_agent_trigger`, `fire_skill_trigger` from pipeline commands
- Triggers become messages, not process spawns
- Frontend `use-pipeline-events.ts` simplified (no more spawn event listeners)

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
- Remove `fire_cli_trigger`, `fire_agent_trigger`, `fire_script_trigger`, `fire_skill_trigger` commands
- Clean up `use-pipeline-events.ts` (triggers no longer emit spawn events)
- Update CLAUDE.md, SESSION.md

## File Changes (estimated)

### New Files
- `src-tauri/src/chat/mod.rs` — module root
- `src-tauri/src/chat/transport.rs` — trait + PtyTransport + PipeTransport
- `src-tauri/src/chat/session.rs` — UnifiedChatSession
- `src-tauri/src/chat/registry.rs` — session registry (managed state)
- `src-tauri/src/chat/chef.rs` — ChefSession layer
- `src-tauri/src/commands/chat.rs` — unified IPC commands
- `src/components/chat/chat-panel.tsx` — unified chat component
- `src/components/chat/bubble-view.tsx` — bubble renderer
- `src/components/chat/terminal-view.tsx` — xterm.js renderer
- `src/hooks/use-chat.ts` — unified chat hook

### Modified Files
- `src-tauri/src/pipeline/triggers.rs` — trigger sends message instead of spawning
- `src-tauri/src/pipeline/mod.rs` — simplified trigger flow
- `src-tauri/src/lib.rs` — register new managed state, remove old managers
- `src/stores/settings-store.ts` — add chat settings
- `src/components/panel/` — use unified ChatPanel

### Removed Files (Phase 6)
- `src-tauri/src/process/cli_session.rs`
- `src-tauri/src/process/agent_cli_session.rs`
- `src-tauri/src/process/agent_runner.rs`
- `src-tauri/src/commands/pipeline.rs` (fire_*_trigger commands)
- `src/hooks/use-pipeline-events.ts` (spawn listeners)

## Open Questions

1. **Script triggers** — `fire_script_trigger` runs arbitrary shell scripts, not claude. Should this stay separate or also go through unified chat? (Probably separate — scripts aren't chat sessions.)

2. **Skill triggers** — `fire_skill_trigger` sends a slash command to claude. In unified chat, this is just `send_message("/skill-name")`. Should work naturally.

3. **Queue system** — current `use_queue` flag on triggers manages concurrent agent count. In unified chat, the session registry's `maxConcurrentSessions` handles this. Need to make sure the queue still works.

4. **PTY terminal in bubble mode** — if user is in bubble view but the agent does something that needs terminal (interactive prompt), should it auto-switch to terminal? Or show a "switch to terminal" button?

5. **Resume across app restarts** — startup cleanup currently resets pipeline states. With suspend/resume, should we auto-resume suspended sessions on app start? Or wait for user to click into the task?
