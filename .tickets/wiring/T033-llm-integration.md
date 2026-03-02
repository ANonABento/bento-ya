# T033: LLM Integration (Core Agent Backend)

> **Status**: Plan Ready (see `~/.claude/plans/cached-juggling-rose.md`)
>
> **Priority**: HIGH — Core blocker for orchestrator, metrics, and pipeline features

## Summary

Wire up actual LLM API calls so the orchestrator/chat can process messages. Currently the chat stores messages but never sends them to an LLM. This is the foundation for all AI features.

## Current State

- Chat UI exists (`src/components/chat/chat-input.tsx`)
- Messages stored in database (`chat_messages` table)
- Backend command `send_orchestrator_message` sets status to "processing" but never processes
- Comment in code: `// In a real implementation, this would trigger the LLM call`
- **No OpenAI/Anthropic/OpenRouter integration** (only Whisper for voice)

## Acceptance Criteria

- [ ] LLM provider configuration in settings (API key, model selection)
- [ ] Support multiple providers: OpenAI, Anthropic, OpenRouter
- [ ] `process_orchestrator_message` actually calls LLM API
- [ ] Streaming response support (SSE or chunked)
- [ ] Response stored in `chat_messages` with `role: assistant`
- [ ] Error handling: API failures, rate limits, invalid keys
- [ ] Token counting and cost estimation per message
- [ ] Usage record created for each LLM call (feeds T030 metrics)
- [ ] System prompt configurable per workspace
- [ ] Context window management (truncate/summarize old messages)

## Technical Notes

```rust
// src-tauri/src/commands/orchestrator.rs
// Current: stores message, sets "processing", never processes
// Need: async task that calls LLM API and streams response back

// Options:
// 1. reqwest + async-openai crate for OpenAI
// 2. reqwest direct for OpenRouter (more flexible)
// 3. anthropic-rs for Claude
```

## Dependencies

- None (foundational)

## Enables

- T017 Orchestrator becomes functional
- T030 Metrics Dashboard gets data
- T016 Pipeline agent_complete exit criteria
- Future: task generation from chat

## Complexity

**XL** — Core infrastructure, streaming, multiple providers

---

## Implementation Plan (March 2025)

### Approach: CLI-first, API fallback

1. **CLI Mode** (default): Spawn Claude/Codex CLI via PTY for full agent capabilities
2. **API Mode** (fallback): Direct HTTP to Anthropic API for faster simple chat

### Implementation Steps

#### Step 1: LLM Module (Backend)
Create `src-tauri/src/llm/` module:
- `mod.rs` - module exports
- `types.rs` - Message, LlmRequest, LlmResponse, StreamChunk
- `anthropic.rs` - Anthropic SSE streaming client

#### Step 2: Streaming Client
- Use reqwest with `bytes_stream()` for SSE
- Parse `content_block_delta` events
- Emit chunks via mpsc channel
- Track usage from `message_start`/`message_delta`

#### Step 3: Add Dependencies
```toml
async-trait = "0.1"
futures = "0.3"
```

#### Step 4: New `stream_chat` Command
```rust
#[tauri::command]
pub async fn stream_chat(
    workspace_id: String,
    message: String,
    use_cli: bool,  // true = spawn CLI, false = API
) -> Result<(), AppError>
```

#### Step 5: CLI Integration
For CLI mode, reuse existing PTY infrastructure:
```bash
claude --print "system prompt" --message "user message"
```

#### Step 6: Frontend Chat Display
- Listen to `orchestrator:stream` events
- Accumulate streaming text
- Render user/assistant bubbles
- Auto-scroll

#### Step 7: IPC Types
```typescript
export type StreamChunkEvent = {
  workspaceId: string
  delta: string
  finishReason: string | null
}
```

### Files to Create/Modify

| File | Action |
|------|--------|
| `src-tauri/src/llm/mod.rs` | CREATE |
| `src-tauri/src/llm/types.rs` | CREATE |
| `src-tauri/src/llm/anthropic.rs` | CREATE |
| `src-tauri/src/lib.rs` | Add `mod llm` |
| `src-tauri/src/commands/orchestrator.rs` | Add `stream_chat` |
| `src-tauri/Cargo.toml` | Add deps |
| `src/components/chat/chat-messages.tsx` | CREATE |
| `src/lib/ipc.ts` | Add stream types |

### Events
- `orchestrator:stream` - { workspaceId, delta, finishReason }
- `orchestrator:complete` - { workspaceId, eventType, message }
- `orchestrator:error` - { workspaceId, eventType, message }
