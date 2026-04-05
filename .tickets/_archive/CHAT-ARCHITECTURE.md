# Chat System Architecture

## Overview

Bento-ya has two chat systems:
1. **Chef (Orchestrator)** - Workspace-level task management chat
2. **Agent** - Per-task implementation chat

Both use Claude CLI in `stream-json` mode for persistent sessions.

---

## Data Flow Diagrams

### Chef (Orchestrator) Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────────────────────┐   │
│  │  OrchestratorPanel   │    │          Event Listeners                 │   │
│  │  ──────────────────  │    │  ─────────────────────────────────────  │   │
│  │  - inputValue        │    │  orchestrator:processing → isProcessing │   │
│  │  - messages[]        │◄───│  orchestrator:stream → streamingContent │   │
│  │  - streamingContent  │    │  orchestrator:thinking → thinkingContent│   │
│  │  - messageQueue[]    │    │  orchestrator:tool_call → toolCalls     │   │
│  │  - failedMessage     │    │  orchestrator:complete → reload msgs    │   │
│  └──────────┬───────────┘    └─────────────────────────────────────────┘   │
│             │                                                               │
│             │ streamOrchestratorChat(workspaceId, sessionId, message)      │
│             ▼                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                              IPC LAYER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     stream_orchestrator_chat                         │   │
│  │  ───────────────────────────────────────────────────────────────────│   │
│  │  1. Save user message to DB                                         │   │
│  │  2. Build context (columns, tasks)                                  │   │
│  │  3. Emit orchestrator:processing                                    │   │
│  │  4. Check connection_mode (api/cli)                                 │   │
│  └─────────────────────┬───────────────────────────────────────────────┘   │
│                        │                                                    │
│         ┌──────────────┴──────────────┐                                    │
│         ▼                              ▼                                    │
│  ┌─────────────────┐          ┌─────────────────────────────────────┐     │
│  │   API MODE      │          │           CLI MODE                   │     │
│  │  ────────────   │          │  ─────────────────────────────────  │     │
│  │  AnthropicClient│          │  CliSessionManager                   │     │
│  │  .stream_chat() │          │  - spawn(cli_path, model, prompt)    │     │
│  │                 │          │  - send_message(msg)                 │     │
│  │  Direct API w/  │          │  - parse stream-json output          │     │
│  │  streaming      │          │  - emit events per line              │     │
│  └────────┬────────┘          └─────────────────┬───────────────────┘     │
│           │                                      │                          │
│           └──────────────┬───────────────────────┘                          │
│                          ▼                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Event Emission                                     │  │
│  │  ──────────────────────────────────────────────────────────────────  │  │
│  │  - orchestrator:stream { delta, finishReason, toolUse }              │  │
│  │  - orchestrator:thinking { content, isComplete }                     │  │
│  │  - orchestrator:tool_call { toolId, toolName, status }               │  │
│  │  - orchestrator:tool_result { result, isError }                      │  │
│  │  - orchestrator:complete { workspaceId }                             │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Agent Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────┐    ┌─────────────────────────────────────────┐   │
│  │     AgentPanel       │    │       useAgentSession Hook              │   │
│  │  ──────────────────  │    │  ─────────────────────────────────────  │   │
│  │  - task context      │    │  - messages[] from DB                   │   │
│  │  - model selector    │◄───│  - streaming.content                    │   │
│  │  - thinking selector │    │  - streaming.thinkingContent            │   │
│  └──────────┬───────────┘    │  - streaming.toolCalls[]                │   │
│             │                 │                                         │   │
│             │                 │  Event listeners:                       │   │
│             │                 │  agent:stream → append content          │   │
│             │                 │  agent:thinking → append thinking       │   │
│             │                 │  agent:tool_call → update tool          │   │
│             │                 │  agent:complete → reload messages       │   │
│             │                 └─────────────────────────────────────────┘   │
│             │                                                               │
│             │ streamAgentChat(taskId, message, workingDir, cliPath)        │
│             ▼                                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                              IPC LAYER                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     stream_agent_chat                                │   │
│  │  ───────────────────────────────────────────────────────────────────│   │
│  │  1. Save user message to DB                                         │   │
│  │  2. Build system prompt from task title/description                 │   │
│  │  3. Get or spawn AgentCliSession for this task                      │   │
│  │  4. Send message and parse stream-json output                       │   │
│  │  5. Emit events, save response to DB                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                  AgentCliSessionManager                              │   │
│  │  ───────────────────────────────────────────────────────────────────│   │
│  │  - Max 5 concurrent sessions                                        │   │
│  │  - Per-task CLI process                                             │   │
│  │  - Model tracking (respawn on model change)                         │   │
│  │  - Session ID for --resume fallback                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Differences

| Aspect | Chef (Orchestrator) | Agent |
|--------|---------------------|-------|
| **Scope** | Workspace-wide | Per-task |
| **Context** | All columns + tasks | Task title + description |
| **Tools** | create_task, move_task, etc. | Standard Claude tools |
| **DB Table** | chat_messages | agent_messages |
| **Sessions** | Multiple per workspace | One per task |
| **CLI Path** | From settings | Hardcoded 'claude' |
| **Connection** | API or CLI mode | CLI only |

---

## CLI Output Format (stream-json)

The Claude CLI with `--output-format stream-json` outputs newline-delimited JSON:

```json
{"type": "system", "session_id": "abc123", ...}
{"type": "content_block_start", "content_block": {"type": "thinking"}}
{"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "Let me..."}}
{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Here's"}}
{"type": "content_block_stop"}
{"type": "result", "result": "full response text"}
```

---

## Event Payloads

### Stream Event
```typescript
type StreamChunkEvent = {
  workspaceId: string
  delta: string           // Incremental text
  finishReason: string | null
  toolUse?: ToolUsePayload
}
```

### Thinking Event
```typescript
type ThinkingEvent = {
  workspaceId: string
  content: string         // Incremental thinking
  isComplete: boolean
}
```

### Tool Call Event
```typescript
type ToolCallEvent = {
  workspaceId: string
  toolId: string
  toolName: string
  status: 'running' | 'complete' | 'error'
  input?: object
  result?: string
}
```

---

## Message Queue (Chef only)

Chef supports queuing messages when one is processing:

```typescript
const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([])
const isProcessingRef = useRef(false)  // Synchronous check

// When sending:
if (isProcessingRef.current) {
  setMessageQueue(prev => [...prev, { id: uuid(), ...params }])
  return
}
```

Queue is processed after `orchestrator:complete` event.

---

## Session Persistence

Both systems use CLI session IDs for resumption:

1. **Capture**: Parse `session_id` from `system` event
2. **Store**: Save to DB (orchestrator_sessions.cli_session_id / agent_sessions.cli_session_id)
3. **Resume**: Pass `--resume <id>` when spawning CLI

If process dies mid-conversation, respawn with `--resume` to continue.
