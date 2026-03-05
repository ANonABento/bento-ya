# T058: Reply-to-Agent Routing

## Summary

When a user replies to a message in a task thread, route their reply back to the agent. If the agent session is active, send directly. If completed, use `--resume` to restart with context.

## Acceptance Criteria

- [ ] User replies in task thread → Message routed to agent
- [ ] Active session: Forward to running agent directly
- [ ] Completed session: Spawn new agent with `--resume {cliSessionId}`
- [ ] Agent response streams back to thread
- [ ] Reply chain preserved (multiple back-and-forth)
- [ ] Handle "Reply to continue" detection
- [ ] Typing indicator while agent processing
- [ ] Error handling: agent failed to resume

## Technical Design

### Reply Detection

```typescript
// sidecars/discord-bot/src/handlers/message.ts

import { Message } from 'discord.js';

client.on('messageCreate', async (message: Message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check if in a task thread
  if (!message.channel.isThread()) return;

  const taskMapping = await getThreadMappingByThreadId(message.channelId);
  if (!taskMapping) return; // Not a task thread

  // Get routing info
  const route = await getMessageRoute(taskMapping.taskId);

  // Show typing indicator
  await message.channel.sendTyping();

  if (route?.activeSessionId) {
    // Active session - forward directly
    await forwardToActiveSession(route.activeSessionId, message.content);
  } else if (route?.cliSessionId) {
    // Completed session - resume
    await resumeAgentSession(taskMapping.taskId, route.cliSessionId, message.content);
  } else {
    // No session - start fresh
    await startAgentSession(taskMapping.taskId, message.content);
  }
});
```

### Forward to Active Session

```typescript
// sidecars/discord-bot/src/routing/forward.ts

async function forwardToActiveSession(sessionId: string, content: string) {
  // Call back to Rust to send message to agent session
  await bridge.send({
    type: 'agent:send_message',
    payload: {
      sessionId,
      message: content,
    },
  });
}
```

### Resume Completed Session

```typescript
// sidecars/discord-bot/src/routing/resume.ts

async function resumeAgentSession(
  taskId: string,
  cliSessionId: string,
  userMessage: string
) {
  // Post acknowledgment
  const thread = await getTaskThread(taskId);
  await thread.send({
    embeds: [{
      description: '🔄 Resuming agent session...',
      color: 0x5865F2,
    }],
  });

  // Call back to Rust to spawn agent with --resume
  const result = await bridge.send({
    type: 'agent:resume',
    payload: {
      taskId,
      cliSessionId,
      initialMessage: userMessage,
    },
  });

  if (!result.success) {
    await thread.send({
      embeds: [{
        title: '❌ Failed to Resume',
        description: result.error || 'Could not resume agent session',
        color: 0xED4245,
        footer: { text: 'Try starting a new session instead' },
      }],
    });
  }
}
```

### Rust Resume Handler

```rust
// src-tauri/src/commands/agent.rs

#[tauri::command]
pub async fn resume_agent_session(
    state: State<'_, AppState>,
    agent_state: State<'_, SharedAgentSessionManager>,
    task_id: String,
    cli_session_id: String,
    initial_message: String,
) -> Result<(), AppError> {
    // Get task info
    let task = db::get_task(&state.db.lock().unwrap(), &task_id)?
        .ok_or(AppError::NotFound("Task not found".into()))?;

    // Get workspace for working directory
    let workspace = db::get_workspace(&state.db.lock().unwrap(), &task.workspace_id)?
        .ok_or(AppError::NotFound("Workspace not found".into()))?;

    let working_dir = workspace.path.as_deref().unwrap_or(".");
    let cli_path = detect_cli_path()?;

    // Spawn with --resume
    let mut manager = agent_state.0.lock().await;
    manager.spawn(
        &task_id,
        working_dir,
        &cli_path,
        Some(&cli_session_id), // Resume from this session
    );

    // Send the user's message
    manager.send_message(
        &task_id,
        &initial_message,
        &state.app_handle,
    ).await.map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub async fn send_discord_message_to_agent(
    state: State<'_, AppState>,
    agent_state: State<'_, SharedAgentSessionManager>,
    task_id: String,
    message: String,
) -> Result<(), AppError> {
    let mut manager = agent_state.0.lock().await;

    manager.send_message(
        &task_id,
        &message,
        &state.app_handle,
    ).await.map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(())
}
```

### Route Storage

```typescript
// sidecars/discord-bot/src/routing/storage.ts

interface MessageRoute {
  taskId: string;
  activeSessionId: string | null;  // Set while agent running
  cliSessionId: string | null;     // Set on completion for --resume
  lastMessageId: string;
}

// Stored in SQLite via Rust bridge
async function getMessageRoute(taskId: string): Promise<MessageRoute | null> {
  return bridge.send({
    type: 'db:get_message_route',
    payload: { taskId },
  });
}

async function updateActiveSession(taskId: string, sessionId: string | null) {
  await bridge.send({
    type: 'db:update_active_session',
    payload: { taskId, sessionId },
  });
}
```

### Database Additions

```sql
-- Add to 022_discord_integration.sql

CREATE TABLE discord_agent_routes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  active_session_id TEXT,      -- Currently running agent session
  cli_session_id TEXT,         -- For --resume after completion
  last_interaction_at TEXT,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
```

### Typing Indicator

```typescript
// Keep typing indicator active while agent processing
let typingInterval: NodeJS.Timeout | null = null;

function startTyping(channel: ThreadChannel) {
  channel.sendTyping();
  typingInterval = setInterval(() => channel.sendTyping(), 5000);
}

function stopTyping() {
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
}

// Stop when agent outputs or completes
bridge.on('agent:output', () => stopTyping());
bridge.on('agent:complete', () => stopTyping());
```

## Implementation Steps

1. Add messageCreate handler for thread replies
2. Implement task thread detection
3. Create message routing lookup
4. Implement forwardToActiveSession
5. Implement resumeAgentSession
6. Add Rust commands for resume and forward
7. Add discord_agent_routes table
8. Wire up typing indicator
9. Handle errors gracefully (resume failures)
10. Test full reply chain (multiple exchanges)

## Files

**New:**
- `sidecars/discord-bot/src/handlers/reply.ts`
- `sidecars/discord-bot/src/routing/forward.ts`
- `sidecars/discord-bot/src/routing/resume.ts`
- `sidecars/discord-bot/src/routing/storage.ts`

**Modified:**
- `src-tauri/src/commands/agent.rs` - Add resume command
- `src-tauri/src/db/migrations/022_discord_integration.sql` - Add routes table
- `src-tauri/src/db/mod.rs` - Add route CRUD functions
- `sidecars/discord-bot/src/handlers/agent-complete.ts` - Store cliSessionId

## Dependencies

- T056 (Agent Output Streaming) - Completion event with cliSessionId

## Complexity

**L** - Complex routing logic, session management

## Commit

`feat(discord): implement reply-to-agent routing with session resume`
