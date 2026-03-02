# Chat UX Improvements

## Overview
Make the orchestrator chat feel faster, snappier, and more informative by implementing optimistic UI patterns and real-time feedback.

---

## Phase 1: Quick Wins (Implement First)

### 1.1 Optimistic UI for User Messages
**Goal:** User message appears instantly in chat, input clears immediately

**Current behavior:**
- User types message, clicks send
- Input stays filled while processing
- Message only appears after backend confirms

**Target behavior:**
- User clicks send → message appears in chat instantly
- Input clears immediately
- User can start typing next message right away

**Files:**
- `src/components/panel/panel-input.tsx` - Clear input immediately, emit message content
- `src/components/panel/orchestrator-panel.tsx` - Add optimistic message to state before IPC
- `src/components/panel/chat-history.tsx` - Handle optimistic messages (maybe with pending style)

**Implementation:**
```typescript
// orchestrator-panel.tsx
const handleSendMessage = (content: string) => {
  // Add optimistic message immediately
  const optimisticMsg = {
    id: `temp-${Date.now()}`,
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
    pending: true
  }
  setMessages(prev => [...prev, optimisticMsg])

  // Then send to backend (panel-input handles the IPC)
}
```

---

### 1.2 Stream AI Response Into Chat Bubble
**Goal:** Show AI text as it streams in, not after completion

**Current behavior:**
- `streamingContent` state accumulates text
- Displayed somewhere (need to verify where)
- Only final message shown in history after completion

**Target behavior:**
- As `orchestrator:stream` events arrive, show in a "typing" bubble
- Bubble grows as more text arrives
- On completion, replace with final message from history

**Files:**
- `src/components/panel/chat-history.tsx` - Add streaming bubble component
- `src/components/panel/orchestrator-panel.tsx` - Pass streamingContent to ChatHistory

**Implementation:**
```typescript
// chat-history.tsx
{streamingContent && (
  <div className="assistant-message streaming">
    <TypingIndicator />
    <span>{streamingContent}</span>
  </div>
)}
```

---

### 1.3 Elapsed Time Indicator
**Goal:** Show how long the AI has been thinking

**Current behavior:**
- "Thinking..." text shown in header
- No time indication

**Target behavior:**
- "Thinking... 3s" with live counter
- Shows in the streaming bubble or header
- Resets when response completes

**Files:**
- `src/components/panel/chat-history.tsx` - Timer component in streaming bubble
- `src/components/panel/orchestrator-panel.tsx` - Track processing start time

**Implementation:**
```typescript
// Simple elapsed timer hook
const [processingStartTime, setProcessingStartTime] = useState<number | null>(null)
const [elapsed, setElapsed] = useState(0)

useEffect(() => {
  if (!isProcessing) {
    setProcessingStartTime(null)
    setElapsed(0)
    return
  }

  setProcessingStartTime(Date.now())
  const interval = setInterval(() => {
    setElapsed(Math.floor((Date.now() - processingStartTime!) / 1000))
  }, 1000)

  return () => clearInterval(interval)
}, [isProcessing])
```

---

## Phase 2: Enhanced Feedback

### 2.1 Thinking/Tool Calls Display
**Goal:** Show Claude's reasoning process and tool usage

**Current behavior:**
- Only final text response shown
- No visibility into thinking or tool calls

**Target behavior:**
- Parse streaming content for thinking blocks
- Show collapsible "Thinking..." section
- Display tool calls with name and status (running/complete)

**Backend changes needed:**
- CLI mode: Parse `<thinking>` tags and tool call markers from output
- API mode: Handle `thinking` content blocks from Claude API
- Emit structured events: `orchestrator:thinking`, `orchestrator:tool_call`

**Frontend:**
```typescript
type ThinkingEvent = {
  workspaceId: string
  content: string
}

type ToolCallEvent = {
  workspaceId: string
  toolName: string
  status: 'running' | 'complete' | 'error'
  input?: object
  output?: string
}
```

**UI mockup:**
```
┌─────────────────────────────────┐
│ > Thinking... (collapse)        │
│   Analyzing the request...      │
│   I should create tasks for...  │
├─────────────────────────────────┤
│ [x] create_task - completed     │
│ [x] create_task - completed     │
│ [ ] create_task - running...    │
├─────────────────────────────────┤
│ Created 3 tasks for your auth   │
│ system implementation.          │
└─────────────────────────────────┘
```

---

### 2.2 Typing Indicator Animation
**Goal:** Animated indicator while waiting for first token

**Implementation:**
- Three pulsing dots before any streaming content arrives
- Fades out as text starts appearing

```css
.typing-dots span {
  animation: pulse 1.4s infinite;
}
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
```

---

## Phase 3: Advanced Features

### 3.1 Message Queue
**Goal:** Let users send multiple messages while one is processing

**Complexity:** High - needs careful state management

**Considerations:**
- Queue messages locally
- Process sequentially or let backend handle ordering
- Show queued messages with "pending" state
- Handle errors gracefully (retry? skip?)

**Data structure:**
```typescript
type QueuedMessage = {
  id: string
  content: string
  status: 'queued' | 'sending' | 'sent' | 'error'
}

const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([])
```

---

### 3.2 Retry/Cancel
**Goal:** Let users cancel long-running requests or retry failed ones

**Cancel:**
- Add cancel button to streaming bubble
- Backend needs to support cancellation (kill CLI process or abort API request)
- Clean up partial messages

**Retry:**
- Show retry button on failed messages
- Re-send the same message content

---

## Implementation Order

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | Optimistic UI | Low | High |
| 2 | Stream into bubble | Low | High |
| 3 | Elapsed timer | Low | Medium |
| 4 | Typing dots | Low | Low |
| 5 | Thinking display | Medium | Medium |
| 6 | Tool calls display | Medium | Medium |
| 7 | Message queue | High | Medium |
| 8 | Retry/Cancel | Medium | Low |

---

## Files Summary

| File | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| `orchestrator-panel.tsx` | x | x | x |
| `chat-history.tsx` | x | x | |
| `panel-input.tsx` | x | | |
| `orchestrator.rs` | | x | x |

---

## Notes

- Phase 1 is purely frontend changes
- Phase 2 requires backend changes to emit structured events
- Phase 3 needs careful design for edge cases
