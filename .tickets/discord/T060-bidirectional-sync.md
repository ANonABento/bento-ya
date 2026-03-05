# T060: Bidirectional Sync

## Summary

Ensure Bento-ya remains the source of truth while Discord reflects all changes. Handle edge cases: offline periods, conflicts, reconnection, and workspace changes.

## Acceptance Criteria

- [ ] Bento-ya changes always propagate to Discord (primary direction)
- [ ] Discord #chef commands update Bento-ya (secondary direction)
- [ ] Offline changes queued and synced on reconnect
- [ ] Column renames update Discord channels
- [ ] Column reorder updates Discord channel positions
- [ ] New columns create new Discord channels
- [ ] Deleted columns archive Discord channels
- [ ] Workspace name change updates Discord category
- [ ] Conflict resolution: Bento-ya wins (with notification)

## Technical Design

### Sync Direction Principles

```
┌─────────────────────────────────────────────────────────────┐
│                     SYNC RULES                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  BENTO-YA → DISCORD (Primary, Always Applied)              │
│  ├── Task CRUD → Thread CRUD                               │
│  ├── Column CRUD → Channel CRUD                            │
│  ├── Task move → Thread archive + create                   │
│  └── Workspace rename → Category rename                    │
│                                                             │
│  DISCORD → BENTO-YA (Secondary, Via Chef Only)             │
│  ├── #chef message → Chef orchestrator → Board changes     │
│  └── Thread reply → Agent session → May change files       │
│                                                             │
│  DISCORD → BENTO-YA (Not Supported)                        │
│  ├── Manual thread move ❌                                  │
│  ├── Thread delete ❌ (just archives)                       │
│  └── Channel rename ❌ (will be overwritten)               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Column Sync Events

```rust
// src-tauri/src/commands/column.rs

#[tauri::command]
pub async fn update_column(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    position: Option<i32>,
) -> Result<Column, AppError> {
    let column = db::update_column(&state.db.lock().unwrap(), &id, name.as_deref(), position)?;

    // Emit sync event
    state.app_handle.emit("column:updated", ColumnUpdatedEvent {
        id: column.id.clone(),
        name: column.name.clone(),
        position: column.position,
        workspace_id: column.workspace_id.clone(),
    })?;

    Ok(column)
}

#[tauri::command]
pub async fn delete_column(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), AppError> {
    let column = db::get_column(&state.db.lock().unwrap(), &id)?
        .ok_or(AppError::NotFound("Column not found".into()))?;

    db::delete_column(&state.db.lock().unwrap(), &id)?;

    state.app_handle.emit("column:deleted", ColumnDeletedEvent {
        id,
        workspace_id: column.workspace_id,
    })?;

    Ok(())
}
```

### Discord Column Sync Handler

```typescript
// sidecars/discord-bot/src/sync/columns.ts

bridge.on('column:updated', async (event: ColumnUpdatedEvent) => {
  const channelMapping = await bridge.getColumnChannel(event.id);
  if (!channelMapping) return;

  const channel = await client.channels.fetch(channelMapping.discordChannelId);
  if (!channel?.isTextBased()) return;

  // Update channel name
  const sluggedName = slugify(event.name);
  if (channel.name !== sluggedName) {
    await channel.setName(sluggedName);
  }

  // Update position (Discord uses rawPosition)
  // Note: Position sync is tricky due to Discord's position system
  // We'll reorder all channels in the category
  await reorderChannels(channel.parentId!, event.workspaceId);
});

bridge.on('column:created', async (event: ColumnCreatedEvent) => {
  const workspace = await bridge.getWorkspace(event.workspaceId);
  if (!workspace?.discordCategoryId) return;

  const guild = await client.guilds.fetch(workspace.discordGuildId);
  const category = await guild.channels.fetch(workspace.discordCategoryId);

  const channel = await guild.channels.create({
    name: slugify(event.name),
    type: ChannelType.GuildText,
    parent: category?.id,
  });

  await bridge.storeColumnChannel(event.id, channel.id);
});

bridge.on('column:deleted', async (event: ColumnDeletedEvent) => {
  const mapping = await bridge.getColumnChannel(event.id);
  if (!mapping) return;

  const channel = await client.channels.fetch(mapping.discordChannelId);
  if (channel) {
    // Archive existing threads first
    if (channel.isTextBased()) {
      const threads = await channel.threads.fetchActive();
      for (const [, thread] of threads.threads) {
        await thread.send({
          embeds: [{
            description: '📦 Column deleted - this thread is now archived',
            color: 0xFEE75C,
          }],
        });
        await thread.setArchived(true);
      }
    }
    await channel.delete('Column deleted in Bento-ya');
  }

  await bridge.deleteColumnChannel(event.id);
});

async function reorderChannels(categoryId: string, workspaceId: string) {
  const columns = await bridge.getColumnsInOrder(workspaceId);
  const category = await client.channels.fetch(categoryId);

  if (!category?.isCategory()) return;

  // Get channel IDs in order
  const channelIds: string[] = [];
  for (const col of columns) {
    const mapping = await bridge.getColumnChannel(col.id);
    if (mapping) channelIds.push(mapping.discordChannelId);
  }

  // Add special channels at end
  const workspace = await bridge.getWorkspace(workspaceId);
  if (workspace?.discordChefChannelId) channelIds.push(workspace.discordChefChannelId);
  if (workspace?.discordNotificationsChannelId) channelIds.push(workspace.discordNotificationsChannelId);

  // Reorder
  for (let i = 0; i < channelIds.length; i++) {
    const channel = await client.channels.fetch(channelIds[i]);
    if (channel && 'setPosition' in channel) {
      await channel.setPosition(i);
    }
  }
}
```

### Workspace Sync

```typescript
// sidecars/discord-bot/src/sync/workspace.ts

bridge.on('workspace:updated', async (event: WorkspaceUpdatedEvent) => {
  if (!event.changes.name) return;

  const workspace = await bridge.getWorkspace(event.id);
  if (!workspace?.discordCategoryId) return;

  const guild = await client.guilds.fetch(workspace.discordGuildId);
  const category = await guild.channels.fetch(workspace.discordCategoryId);

  if (category) {
    await category.setName(`🍱 ${event.changes.name}`);
  }
});
```

### Offline Queue

```typescript
// sidecars/discord-bot/src/sync/offline-queue.ts

interface QueuedSyncEvent {
  type: string;
  payload: any;
  timestamp: number;
}

class OfflineQueue {
  private queue: QueuedSyncEvent[] = [];

  enqueue(type: string, payload: any) {
    this.queue.push({ type, payload, timestamp: Date.now() });
  }

  async processOnReconnect() {
    // Sort by timestamp to maintain order
    this.queue.sort((a, b) => a.timestamp - b.timestamp);

    for (const event of this.queue) {
      try {
        await processEvent(event.type, event.payload);
      } catch (error) {
        console.error('Failed to process queued event:', event, error);
      }
    }

    this.queue = [];
  }
}

// On disconnect
client.on('disconnect', () => {
  // Future events will be queued
  isOnline = false;
});

// On reconnect
client.on('ready', async () => {
  isOnline = true;
  await offlineQueue.processOnReconnect();
});
```

### Conflict Handling

```typescript
// sidecars/discord-bot/src/sync/conflicts.ts

// Example: User renamed thread in Discord, but Bento-ya has different name
// Resolution: Bento-ya wins, revert Discord

async function handleConflict(
  type: 'thread_name' | 'channel_position' | 'thread_location',
  discordValue: any,
  bentoValue: any,
  context: any
) {
  // Log the conflict
  console.warn('Sync conflict detected:', { type, discordValue, bentoValue });

  // Notify in #notifications
  const notifChannel = await getNotificationsChannel(context.workspaceId);
  if (notifChannel) {
    await notifChannel.send({
      embeds: [{
        title: '⚠️ Sync Conflict Resolved',
        description: `Discord change was overwritten by Bento-ya.`,
        fields: [
          { name: 'Type', value: type, inline: true },
          { name: 'Discord Value', value: String(discordValue), inline: true },
          { name: 'Bento-ya Value', value: String(bentoValue), inline: true },
        ],
        color: 0xFEE75C,
        footer: { text: 'Bento-ya is the source of truth' },
      }],
    });
  }

  // Revert Discord to match Bento-ya
  await revertToSource(type, context, bentoValue);
}
```

### Full State Sync (On Connect)

```typescript
// sidecars/discord-bot/src/sync/full-sync.ts

async function performFullSync(workspaceId: string) {
  const workspace = await bridge.getWorkspace(workspaceId);
  if (!workspace?.discordGuildId) return;

  // 1. Sync columns → channels
  const columns = await bridge.getColumns(workspaceId);
  for (const col of columns) {
    const mapping = await bridge.getColumnChannel(col.id);
    if (mapping) {
      // Verify channel exists, update name if needed
      try {
        const channel = await client.channels.fetch(mapping.discordChannelId);
        if (!channel) {
          // Channel was deleted, recreate
          await createColumnChannel(col);
        } else if (channel.name !== slugify(col.name)) {
          await channel.setName(slugify(col.name));
        }
      } catch {
        // Channel doesn't exist, create
        await createColumnChannel(col);
      }
    } else {
      // No mapping, create channel
      await createColumnChannel(col);
    }
  }

  // 2. Sync tasks → threads
  const tasks = await bridge.getTasks(workspaceId);
  for (const task of tasks) {
    const mapping = await bridge.getThreadMapping(task.id);
    const expectedChannelId = (await bridge.getColumnChannel(task.columnId))?.discordChannelId;

    if (mapping) {
      // Verify thread in correct channel
      if (mapping.discordChannelId !== expectedChannelId && expectedChannelId) {
        // Thread in wrong channel (task was moved), fix it
        await moveThread(task.id, expectedChannelId);
      }
    } else if (expectedChannelId) {
      // No thread, create
      await createTaskThread(task, expectedChannelId);
    }
  }

  // 3. Clean up orphaned threads (tasks deleted in Bento-ya)
  await cleanupOrphanedThreads(workspaceId);
}
```

## Implementation Steps

1. Add column event emissions in Rust
2. Implement column sync handlers in sidecar
3. Add workspace rename sync
4. Implement channel reordering
5. Add offline queue
6. Implement full state sync on connect
7. Add conflict detection and resolution
8. Create #notifications messages for conflicts
9. Test: rename column in Bento-ya → Discord updates
10. Test: delete column in Bento-ya → threads archived
11. Test: offline changes → synced on reconnect

## Files

**New:**
- `sidecars/discord-bot/src/sync/columns.ts`
- `sidecars/discord-bot/src/sync/workspace.ts`
- `sidecars/discord-bot/src/sync/offline-queue.ts`
- `sidecars/discord-bot/src/sync/conflicts.ts`
- `sidecars/discord-bot/src/sync/full-sync.ts`

**Modified:**
- `src-tauri/src/commands/column.rs` - Add event emissions
- `src-tauri/src/commands/workspace.rs` - Add event emissions
- `sidecars/discord-bot/src/index.ts` - Register sync handlers

## Dependencies

- T054 (Thread/Channel Management) - Channel CRUD
- T055 (Task Event Sync) - Task event patterns

## Complexity

**M** - Event handling, state reconciliation

## Commit

`feat(discord): implement bidirectional sync with conflict resolution`
