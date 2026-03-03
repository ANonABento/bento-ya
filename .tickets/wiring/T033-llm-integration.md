# T033: LLM Integration (Streaming Infrastructure)

> **Status**: Ready for Implementation
>
> **Priority**: HIGH — Core blocker for orchestrator and all AI features

## Summary

Wire up LLM streaming with two modes:
1. **API mode**: Direct HTTP to Anthropic API (fast, lightweight)
2. **CLI mode**: Spawn Claude CLI subprocess (uses user's config, MCP servers)

Mode determined by `settings.model.providers[anthropic].connectionMode`

## Current State

- ✅ Chat UI: `src/components/panel/orchestrator-panel.tsx`
- ✅ Messages stored: `chat_messages` table
- ✅ Events defined: `orchestrator:processing/complete/error`
- ✅ Settings: `connectionMode: 'api' | 'cli'`, API keys in `agent.envVars`
- ❌ **No LLM call** — messages stored but never sent to LLM
- ❌ **No streaming** — no `orchestrator:stream` event

## Acceptance Criteria

- [ ] API mode: Direct Anthropic Messages API with SSE streaming
- [ ] CLI mode: Subprocess with piped stdin/stdout (NOT full PTY)
- [ ] Streaming events: `orchestrator:stream` with delta chunks
- [ ] Response stored in `chat_messages` with `role: assistant`
- [ ] Usage tracking: tokens + cost in `usage_records` table
- [ ] Error handling: API failures, rate limits, CLI errors
- [ ] Frontend: Stream text into chat bubbles in real-time

## Out of Scope (see T039)

- System prompt configuration
- Tool use / structured output
- Task creation from chat
- Context window management

---

## Technical Design

### Architecture

```
User message
     │
     ▼
stream_orchestrator_chat(workspaceId, message, mode)
     │
     ├─── API mode ──────────────────┐
     │    reqwest + SSE streaming    │
     │    Parse content_block_delta  │
     │                               │
     ├─── CLI mode ──────────────────┤
     │    Command::new("claude")     │
     │    Piped stdout streaming     │
     │    Parse JSON lines           │
     │                               ▼
     │              ┌────────────────────────┐
     └─────────────►│ orchestrator:stream    │
                    │ { workspaceId, delta } │
                    └────────────────────────┘
                               │
                               ▼
                    Store response + usage
                               │
                               ▼
                    orchestrator:complete
```

### CLI Mode: Lightweight Subprocess (NOT PTY)

```rust
// Simple piped subprocess - no terminal emulation needed
use std::process::{Command, Stdio};

let mut child = Command::new(&cli_path)
    .args(["chat", "--print", "--output-format", "stream-json"])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .current_dir(&working_dir)
    .envs(&env_vars)
    .spawn()?;

// Write message to stdin
child.stdin.take().unwrap().write_all(message.as_bytes())?;

// Stream stdout line by line
let stdout = BufReader::new(child.stdout.take().unwrap());
for line in stdout.lines() {
    let chunk: StreamChunk = serde_json::from_str(&line?)?;
    app.emit("orchestrator:stream", &chunk)?;
}
```

### API Mode: Anthropic SSE

```rust
// Direct API - faster cold start, cleaner responses
let response = client
    .post("https://api.anthropic.com/v1/messages")
    .header("x-api-key", &api_key)
    .header("anthropic-version", "2023-06-01")
    .json(&request)
    .send()
    .await?;

let mut stream = response.bytes_stream();
while let Some(chunk) = stream.next().await {
    // Parse SSE: data: {"type": "content_block_delta", ...}
    // Emit orchestrator:stream event
}
```

---

## Implementation Steps

### Step 1: Add Cargo Dependencies

```toml
# src-tauri/Cargo.toml
futures = "0.3"
async-stream = "0.3"
```

### Step 2: Create LLM Module

```
src-tauri/src/llm/
├── mod.rs          # exports
├── types.rs        # ChatMessage, StreamChunk, UsageStats
└── anthropic.rs    # Anthropic SSE streaming client (~150 lines)
```

### Step 3: New Command

```rust
// src-tauri/src/commands/orchestrator.rs

#[tauri::command]
pub async fn stream_orchestrator_chat(
    workspace_id: String,
    message: String,
    connection_mode: String,  // "cli" | "api"
    cli_path: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError>
```

### Step 4: Streaming Event

```rust
#[derive(Serialize, Clone)]
pub struct StreamChunkPayload {
    pub workspace_id: String,
    pub delta: String,
    pub finish_reason: Option<String>,
}

// Emit per chunk
app.emit("orchestrator:stream", &payload)?;
```

### Step 5: Frontend IPC

```typescript
// src/lib/ipc.ts

export type StreamChunkEvent = {
  workspaceId: string
  delta: string
  finishReason: string | null
}

export const onOrchestratorStream = (cb: EventCallback<StreamChunkEvent>) =>
  listen<StreamChunkEvent>('orchestrator:stream', cb)

export async function streamOrchestratorChat(
  workspaceId: string,
  message: string,
  connectionMode: 'cli' | 'api',
  cliPath?: string,
  apiKey?: string,
  model?: string
): Promise<void> {
  return invoke('stream_orchestrator_chat', {
    workspaceId, message, connectionMode, cliPath, apiKey, model
  })
}
```

### Step 6: Update Panel Input

```typescript
// src/components/panel/panel-input.tsx
// Read settings, call streamOrchestratorChat with correct mode
```

### Step 7: Streaming Display

```typescript
// src/components/panel/orchestrator-panel.tsx

const [streamingContent, setStreamingContent] = useState('')

useEffect(() => {
  const unsub = onOrchestratorStream((event) => {
    if (event.workspaceId === workspaceId) {
      setStreamingContent(prev => prev + event.delta)
    }
  })
  return () => { unsub.then(fn => fn()) }
}, [workspaceId])

// Pass streamingContent to ChatHistory for rendering
```

---

## Files to Modify/Create

| File | Action | Lines |
|------|--------|-------|
| `src-tauri/Cargo.toml` | Add futures, async-stream | ~5 |
| `src-tauri/src/llm/mod.rs` | CREATE | ~15 |
| `src-tauri/src/llm/types.rs` | CREATE | ~50 |
| `src-tauri/src/llm/anthropic.rs` | CREATE | ~150 |
| `src-tauri/src/lib.rs` | Add mod llm, register cmd | ~5 |
| `src-tauri/src/commands/orchestrator.rs` | Add stream command | ~120 |
| `src/lib/ipc.ts` | Add stream types/functions | ~25 |
| `src/components/panel/panel-input.tsx` | Use new IPC | ~30 |
| `src/components/panel/orchestrator-panel.tsx` | Stream listener | ~40 |
| `src/components/panel/chat-history.tsx` | Render streaming bubble | ~20 |

**Total: ~460 lines**

---

## Events

| Event | Payload | When |
|-------|---------|------|
| `orchestrator:processing` | `{ workspaceId }` | User message stored |
| `orchestrator:stream` | `{ workspaceId, delta, finishReason }` | Each chunk |
| `orchestrator:complete` | `{ workspaceId, messageId }` | Response stored |
| `orchestrator:error` | `{ workspaceId, error }` | API/CLI failure |

---

## Testing

```bash
# Set API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Run app
pnpm tauri dev

# Test:
1. Open orchestrator panel
2. Type "Hello, what can you help with?"
3. Verify streaming text appears
4. Check DB: SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 2
5. Check usage: SELECT * FROM usage_records ORDER BY created_at DESC LIMIT 1
```

---

## Dependencies

- None (foundational)

## Enables

- **T039**: Orchestrator Intelligence (tool_use, task creation)
- T030: Metrics Dashboard gets usage data
- T016: Pipeline agent_complete exit criteria

## Complexity

**L** — Focused scope, clear implementation path
