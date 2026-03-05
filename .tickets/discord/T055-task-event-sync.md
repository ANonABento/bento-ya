# T055: Task Event Sync

## Summary

Listen to task lifecycle events in Bento-ya and sync them to Discord. When tasks are created, moved, updated, or completed, reflect those changes in Discord threads.

## Acceptance Criteria

- [ ] Task created → Thread created in column's channel (if Discord enabled)
- [ ] Task moved → Old thread archived, new thread in new column channel
- [ ] Task updated (title) → Thread name updated
- [ ] Task completed → Summary posted, thread archived
- [ ] Task deleted → Thread deleted or archived with note
- [ ] Events debounced to avoid rate limits
- [ ] Offline queue for when Discord disconnected

## Technical Design

### Event Flow

```
Task Created (Rust)
    │
    ▼
Tauri Event: "task:created"
    │
    ▼
Discord Bridge (listens)
    │
    ├── discord_enabled? ────► (skip if not)
    │
    ▼
Create Thread Command
    │
    ▼
Store Mapping in DB
```

### Rust Event Emission

```rust
// src-tauri/src/db/mod.rs - Modify task CRUD to emit events

pub fn create_task(...) -> Result<Task, Error> {
    // ... existing create logic

    // Emit event for Discord sync
    app_handle.emit("task:created", TaskEvent {
        task_id: task.id.clone(),
        workspace_id: task.workspace_id.clone(),
        column_id: task.column_id.clone(),
        title: task.title.clone(),
    })?;

    Ok(task)
}

pub fn update_task_column(...) -> Result<(), Error> {
    // ... existing move logic

    app_handle.emit("task:moved", TaskMoveEvent {
        task_id,
        old_column_id,
        new_column_id,
    })?;

    Ok(())
}
```

### Discord Bridge Event Handler

```typescript
// sidecars/discord-bot/src/handlers/task-events.ts

import { Bridge } from '../bridge';
import { createThread, archiveThread, updateThreadName } from '../commands/threads';

export function setupTaskEventHandlers(bridge: Bridge) {
  bridge.on('task:created', async (event: TaskCreatedEvent) => {
    const channelId = await bridge.getColumnChannel(event.columnId);
    if (!channelId) return; // Discord not set up for this workspace

    const threadId = await createThread({
      channelId,
      taskId: event.taskId,
      taskTitle: event.title,
    });

    await bridge.storeThreadMapping(event.taskId, threadId, channelId);
  });

  bridge.on('task:moved', async (event: TaskMovedEvent) => {
    const mapping = await bridge.getThreadMapping(event.taskId);
    if (!mapping) return;

    // Archive old thread
    await archiveThread(mapping.threadId, `Moved to ${event.newColumnName}`);

    // Create new thread in new column
    const newChannelId = await bridge.getColumnChannel(event.newColumnId);
    if (!newChannelId) return;

    const task = await bridge.getTask(event.taskId);
    const newThreadId = await createThread({
      channelId: newChannelId,
      taskId: event.taskId,
      taskTitle: task.title,
    });

    // Update mapping
    await bridge.updateThreadMapping(event.taskId, newThreadId, newChannelId);

    // Link threads
    await postToThread(newThreadId, {
      embeds: [{
        description: `📦 Continued from previous column`,
        color: 0x5865F2,
      }],
    });
  });

  bridge.on('task:updated', async (event: TaskUpdatedEvent) => {
    if (!event.changes.title) return;

    const mapping = await bridge.getThreadMapping(event.taskId);
    if (!mapping) return;

    await updateThreadName(mapping.threadId, event.changes.title);
  });

  bridge.on('task:completed', async (event: TaskCompletedEvent) => {
    const mapping = await bridge.getThreadMapping(event.taskId);
    if (!mapping) return;

    await postToThread(mapping.threadId, {
      embeds: [{
        title: '✅ Task Completed',
        description: event.summary || 'Task marked as complete',
        color: 0x57F287,
        timestamp: new Date().toISOString(),
      }],
    });

    // Archive after short delay (let user see completion)
    setTimeout(() => archiveThread(mapping.threadId), 5000);
  });

  bridge.on('task:deleted', async (event: TaskDeletedEvent) => {
    const mapping = await bridge.getThreadMapping(event.taskId);
    if (!mapping) return;

    await postToThread(mapping.threadId, {
      embeds: [{
        description: '🗑️ Task deleted from Bento-ya',
        color: 0xED4245,
      }],
    });

    await archiveThread(mapping.threadId);
    await bridge.deleteThreadMapping(event.taskId);
  });
}
```

### Event Queue (Offline Handling)

```typescript
// sidecars/discord-bot/src/queue.ts

interface QueuedEvent {
  id: string;
  type: string;
  payload: any;
  createdAt: Date;
  retries: number;
}

class EventQueue {
  private queue: QueuedEvent[] = [];
  private processing = false;

  enqueue(type: string, payload: any) {
    this.queue.push({
      id: crypto.randomUUID(),
      type,
      payload,
      createdAt: new Date(),
      retries: 0,
    });
    this.process();
  }

  private async process() {
    if (this.processing || !isConnected()) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const event = this.queue[0];
      try {
        await handleEvent(event.type, event.payload);
        this.queue.shift(); // Remove on success
      } catch (error) {
        if (event.retries >= 3) {
          console.error('Event failed after 3 retries:', event);
          this.queue.shift();
        } else {
          event.retries++;
          await sleep(1000 * event.retries); // Backoff
        }
      }
    }

    this.processing = false;
  }
}
```

## Implementation Steps

1. Add task event emission to Rust CRUD functions
2. Define event types (TaskCreatedEvent, TaskMovedEvent, etc.)
3. Set up event listener in Discord sidecar
4. Implement thread creation on task:created
5. Implement thread archival + recreation on task:moved
6. Implement thread name update on task:updated
7. Implement completion summary + archive on task:completed
8. Implement cleanup on task:deleted
9. Add event queue for offline handling
10. Test full lifecycle: create → move → complete

## Files

**New:**
- `sidecars/discord-bot/src/handlers/task-events.ts`
- `sidecars/discord-bot/src/queue.ts`

**Modified:**
- `src-tauri/src/db/mod.rs` - Add event emissions
- `src-tauri/src/commands/task.rs` - Emit events on CRUD
- `sidecars/discord-bot/src/index.ts` - Register handlers

## Complexity

**M** - Event wiring, state management

## Commit

`feat(discord): sync task lifecycle events to Discord threads`
