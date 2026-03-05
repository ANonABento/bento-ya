# T056: Agent Output Streaming

## Summary

Stream agent output to Discord task threads. Buffer output to avoid rate limits, handle long messages by splitting, and post rich completion summaries.

## Acceptance Criteria

- [ ] Agent terminal output streams to task's Discord thread
- [ ] Output buffered (500ms debounce) to reduce message count
- [ ] Long output split at 2000 char limit (Discord max)
- [ ] Code blocks preserved when splitting
- [ ] Agent completion posts rich summary embed
- [ ] Summary includes: changes made, files modified, metrics
- [ ] "Reply to continue" footer on completion
- [ ] Error states posted with alert styling

## Technical Design

### Output Pipeline

```
Agent Session (Rust)
    │
    ▼
Tauri Event: "agent:output"
{taskId, delta, isComplete, sessionId}
    │
    ▼
Discord Bridge
    │
    ├── Buffer (500ms)
    │   └── Accumulate deltas
    │
    ▼
Format & Split
    │
    ├── Detect code blocks
    ├── Split at 2000 chars
    └── Preserve formatting
    │
    ▼
Post to Thread
    │
    └── Store message IDs for reply routing
```

### Output Buffer

```typescript
// sidecars/discord-bot/src/output-buffer.ts

interface BufferedOutput {
  taskId: string;
  content: string;
  lastUpdate: number;
  timeout: NodeJS.Timeout | null;
}

class OutputBuffer {
  private buffers = new Map<string, BufferedOutput>();
  private readonly DEBOUNCE_MS = 500;
  private readonly MAX_BUFFER = 4000; // Flush if getting too large

  append(taskId: string, delta: string) {
    let buffer = this.buffers.get(taskId);

    if (!buffer) {
      buffer = { taskId, content: '', lastUpdate: Date.now(), timeout: null };
      this.buffers.set(taskId, buffer);
    }

    buffer.content += delta;
    buffer.lastUpdate = Date.now();

    // Clear existing timeout
    if (buffer.timeout) clearTimeout(buffer.timeout);

    // Force flush if buffer too large
    if (buffer.content.length >= this.MAX_BUFFER) {
      this.flush(taskId);
      return;
    }

    // Set new timeout
    buffer.timeout = setTimeout(() => this.flush(taskId), this.DEBOUNCE_MS);
  }

  private async flush(taskId: string) {
    const buffer = this.buffers.get(taskId);
    if (!buffer || buffer.content.length === 0) return;

    const content = buffer.content;
    buffer.content = '';

    await postOutputToThread(taskId, content);
  }

  // Force flush all (on agent complete)
  async flushAll(taskId: string) {
    if (this.buffers.get(taskId)?.timeout) {
      clearTimeout(this.buffers.get(taskId)!.timeout!);
    }
    await this.flush(taskId);
    this.buffers.delete(taskId);
  }
}
```

### Message Splitting

```typescript
// sidecars/discord-bot/src/message-splitter.ts

const DISCORD_MAX = 2000;
const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;

interface MessageChunk {
  content: string;
  hasCodeBlock: boolean;
}

function splitMessage(content: string): MessageChunk[] {
  if (content.length <= DISCORD_MAX) {
    return [{ content, hasCodeBlock: content.includes('```') }];
  }

  const chunks: MessageChunk[] = [];
  let remaining = content;
  let inCodeBlock = false;
  let codeBlockLang = '';

  while (remaining.length > 0) {
    let chunkEnd = Math.min(remaining.length, DISCORD_MAX);

    // Don't split in middle of code block
    const codeBlockStart = remaining.lastIndexOf('```', chunkEnd);
    const codeBlockEnd = remaining.indexOf('```', codeBlockStart + 3);

    if (codeBlockStart !== -1 && codeBlockStart < chunkEnd &&
        (codeBlockEnd === -1 || codeBlockEnd > chunkEnd)) {
      // We're in an unclosed code block, split before it
      chunkEnd = codeBlockStart;
      inCodeBlock = true;
      // Extract language
      const langMatch = remaining.slice(codeBlockStart).match(/```(\w+)?/);
      codeBlockLang = langMatch?.[1] || '';
    }

    // Try to split at newline
    const lastNewline = remaining.lastIndexOf('\n', chunkEnd);
    if (lastNewline > chunkEnd - 200) {
      chunkEnd = lastNewline + 1;
    }

    let chunk = remaining.slice(0, chunkEnd);
    remaining = remaining.slice(chunkEnd);

    // Handle code block continuation
    if (inCodeBlock && !chunk.endsWith('```')) {
      chunk += '\n```';
      remaining = '```' + codeBlockLang + '\n' + remaining;
      inCodeBlock = false;
    }

    chunks.push({
      content: chunk.trim(),
      hasCodeBlock: chunk.includes('```'),
    });
  }

  return chunks;
}
```

### Completion Summary

```typescript
// sidecars/discord-bot/src/handlers/agent-complete.ts

interface AgentCompletionEvent {
  taskId: string;
  sessionId: string;
  cliSessionId: string; // For --resume
  summary: string;
  filesModified: string[];
  tokenUsage: { prompt: number; completion: number; cost: number };
  duration: number;
  success: boolean;
}

async function handleAgentComplete(event: AgentCompletionEvent) {
  // Flush any remaining buffered output
  await outputBuffer.flushAll(event.taskId);

  const mapping = await getThreadMapping(event.taskId);
  if (!mapping) return;

  const embed = {
    title: event.success ? '✅ Agent Complete' : '❌ Agent Failed',
    description: event.summary,
    color: event.success ? 0x57F287 : 0xED4245,
    fields: [
      {
        name: '📁 Files Modified',
        value: event.filesModified.length > 0
          ? event.filesModified.map(f => `\`${f}\``).join('\n')
          : 'None',
        inline: true,
      },
      {
        name: '📊 Metrics',
        value: `${event.tokenUsage.prompt + event.tokenUsage.completion} tokens\n$${event.tokenUsage.cost.toFixed(4)}\n${formatDuration(event.duration)}`,
        inline: true,
      },
    ],
    footer: {
      text: '💬 Reply to this message to continue working with the agent',
    },
    timestamp: new Date().toISOString(),
  };

  const message = await postToThread(mapping.threadId, { embeds: [embed] });

  // Store message ID + CLI session ID for reply routing
  await storeMessageRoute({
    discordMessageId: message.id,
    taskId: event.taskId,
    cliSessionId: event.cliSessionId,
  });
}
```

### Rust Event Emission

```rust
// src-tauri/src/process/agent_session.rs

// In the output parsing loop:
if let Some(text) = event.get("text").and_then(|t| t.as_str()) {
    // Emit to frontend (existing)
    app_handle.emit("agent:chunk", AgentChunk { task_id, delta: text })?;

    // Emit to Discord bridge
    app_handle.emit("discord:agent_output", DiscordAgentOutput {
        task_id: task_id.clone(),
        delta: text.to_string(),
        is_complete: false,
    })?;
}

// On agent completion:
app_handle.emit("discord:agent_complete", DiscordAgentComplete {
    task_id,
    session_id,
    cli_session_id,
    summary,
    files_modified,
    token_usage,
    duration,
    success: exit_code == 0,
})?;
```

## Implementation Steps

1. Create OutputBuffer class in sidecar
2. Implement message splitting with code block handling
3. Add agent output event listener in sidecar
4. Wire up buffered posting to threads
5. Modify agent_session.rs to emit Discord events
6. Implement completion summary embed
7. Store completion message ID for reply routing
8. Add error state handling (agent crash, timeout)
9. Test with long output (>2000 chars)
10. Test code block preservation

## Files

**New:**
- `sidecars/discord-bot/src/output-buffer.ts`
- `sidecars/discord-bot/src/message-splitter.ts`
- `sidecars/discord-bot/src/handlers/agent-output.ts`
- `sidecars/discord-bot/src/handlers/agent-complete.ts`

**Modified:**
- `src-tauri/src/process/agent_session.rs` - Emit Discord events
- `sidecars/discord-bot/src/index.ts` - Register handlers

## Dependencies

- T055 (Task Event Sync) - Thread mappings

## Complexity

**L** - Buffering logic, message splitting, rich embeds

## Commit

`feat(discord): stream agent output to task threads with batching`
