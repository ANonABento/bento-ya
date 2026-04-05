# Chat System Refactor Plan

> Goal: Unify Chef (Orchestrator) and Agent chat systems for consistent UX and maintainability.

## Current State Analysis

### Differences Between Systems

| Aspect | Chef (Orchestrator) | Agent |
|--------|---------------------|-------|
| **Scope** | Workspace-level | Per-task |
| **Location** | `orchestrator-panel.tsx` | `agent-panel.tsx` |
| **Event Handling** | Direct `listen` from Tauri | `ipc.onAgent*` wrappers |
| **State Management** | Local useState | `useAgentSession` hook |
| **Streaming State** | Separate variables | Single `streaming` object |
| **CLI Path** | From settings | Hardcoded `'claude'` |
| **Connection Mode** | API or CLI | CLI only |
| **Tool Calls** | Map-based tracking | Array-based tracking |
| **Message Queue** | Supported | Not supported |

### Shared Components (Already Unified)

- `ChatHistory` - Renders messages and streaming content
- `ModelSelector` - Model dropdown
- `ThinkingSelector` - Thinking level selector
- `PanelInput` - Input field with voice support (partial)

---

## Refactor Goals

1. **Unified Streaming Hook** - Single hook for both Chef and Agent
2. **Consistent Event Handling** - Use ipc wrappers everywhere
3. **Shared State Shape** - Same streaming state structure
4. **CLI Path from Settings** - Both should use configured CLI
5. **Message Queue Support** - Enable for both systems
6. **PTY Terminal Option** - Add as alternative to CLI streaming

---

## Phase 1: Unified Streaming Hook

Create `useChatSession` hook that handles both orchestrator and agent streaming.

### New Hook Interface

```typescript
type ChatSessionConfig = {
  type: 'orchestrator' | 'agent'
  // Orchestrator-specific
  workspaceId?: string
  sessionId?: string
  // Agent-specific
  taskId?: string
  // Shared
  workingDir?: string
  cliPath?: string
  model?: string
  effortLevel?: string
  connectionMode?: 'api' | 'cli'
}

type ChatSessionState = {
  messages: Message[]
  isLoading: boolean
  streaming: {
    isStreaming: boolean
    content: string
    thinkingContent: string
    toolCalls: ToolCall[]
    startTime: number | null
  }
  error: string | null
}

type ChatSessionActions = {
  sendMessage: (content: string) => Promise<void>
  cancel: () => Promise<void>
  clearMessages: () => Promise<void>
  clearError: () => void
}

function useChatSession(config: ChatSessionConfig): ChatSessionState & ChatSessionActions
```

### Implementation Strategy

1. Extract common state management from both panels
2. Create unified event listener setup
3. Parameterize event names (`orchestrator:*` vs `agent:*`)
4. Consolidate message sending logic

---

## Phase 2: Unified Chat Panel

Create `ChatPanel` component that works for both use cases.

### Component Interface

```typescript
type ChatPanelProps = {
  config: ChatSessionConfig
  header?: React.ReactNode
  emptyState?: React.ReactNode
  onClose?: () => void
}
```

### Features

- Auto-adapts to orchestrator or agent mode
- Consistent styling and layout
- Shared input/output handling
- Model and thinking selectors (configurable)

---

## Phase 3: Settings Integration

### CLI Path Configuration

- Move hardcoded `'claude'` to settings
- Use `useSettingsStore` to get `cliPath`
- Add validation for CLI availability

### Connection Mode Preference

- Allow default connection mode in settings
- Per-workspace override option
- Fallback chain: workspace → global → 'cli'

---

## Phase 4: PTY Terminal Option

### New Feature: Terminal Mode

Alternative to streaming that uses existing PTY infrastructure.

```
┌─────────────────────────────────────────────────┐
│ Agent Chat                            [Terminal]│
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐ │
│ │ $ claude --model opus ...                   │ │
│ │ Thinking about your request...              │ │
│ │                                             │ │
│ │ I'll help you implement that feature.      │ │
│ │ Let me read the existing code first...     │ │
│ │                                             │ │
│ └─────────────────────────────────────────────┘ │
│ ┌───────────────────────────────────────┐[Send]│
│ │ Your message here...                  │      │
│ └───────────────────────────────────────┘      │
└─────────────────────────────────────────────────┘
```

### Implementation

1. Reuse `PtyManager` from existing terminal feature
2. Spawn Claude CLI as PTY process
3. Render output via xterm.js
4. Send messages via stdin
5. Parse stream-json for structured display (optional)

---

## Phase 5: Bug Fixes

### Streaming Bug Fix

Add defensive type checking in Rust CLI parsers:

```rust
// agent_cli_session.rs:331-343
"text_delta" => {
    if let Some(text_value) = delta.get("text") {
        // Ensure it's a string, not an object
        if let Some(text) = text_value.as_str() {
            full_response.push_str(text);
            let _ = app.emit("agent:stream", &AgentStreamPayload {
                task_id: task_id.to_string(),
                content: text.to_string(),
            });
        } else {
            // Log warning for debugging
            eprintln!("Warning: text_delta value is not a string: {:?}", text_value);
        }
    }
}
```

### Infinite Loading Fix

Add timeout/error handling for stream completion:

1. If no events received for 30s, emit error
2. Frontend shows "Connection lost" with retry option
3. Properly clean up listeners on unmount

---

## Migration Path

### Step 1: Create New Hook (Non-breaking)
- Build `useChatSession` alongside existing hooks
- Test with both panels

### Step 2: Migrate Agent Panel
- Replace `useAgentSession` with `useChatSession`
- Verify functionality

### Step 3: Migrate Orchestrator Panel
- Refactor to use `useChatSession`
- Keep message queue support

### Step 4: Extract Shared Panel
- Create `ChatPanel` component
- Keep specialized wrappers (`AgentPanel`, `OrchestratorPanel`)

### Step 5: Add PTY Terminal
- Implement as toggle option
- Available in both panels

---

## Files to Modify

### New Files
- `src/hooks/use-chat-session.ts` - Unified streaming hook
- `src/components/panel/chat-panel.tsx` - Unified panel component

### Modified Files
- `src/components/panel/agent-panel.tsx` - Use new hook
- `src/components/panel/orchestrator-panel.tsx` - Use new hook
- `src/lib/ipc.ts` - Add unified event helpers
- `src-tauri/src/process/cli_session.rs` - Add type validation
- `src-tauri/src/process/agent_cli_session.rs` - Add type validation

### Deprecated (Eventually)
- `src/hooks/use-agent-session.ts` - Replace with `useChatSession`

---

## Timeline Estimate

| Phase | Tasks |
|-------|-------|
| 1 | Create unified hook, test with both panels |
| 2 | Create unified panel, migrate styling |
| 3 | Settings integration, CLI path config |
| 4 | PTY terminal option implementation |
| 5 | Bug fixes, defensive parsing |

---

## Open Questions

1. **Message persistence**: Should PTY mode persist messages to DB?
2. **Tool call display**: Keep current approach or unify display?
3. **Session management**: How to handle model changes mid-conversation?
4. **Error recovery**: Auto-retry on connection loss or require manual action?
