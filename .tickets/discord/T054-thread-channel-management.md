# T054: Thread & Channel Management

## Summary

Implement Discord server structure management. Bot creates category per column, channel per column for threads, and manages thread lifecycle for tasks.

## Acceptance Criteria

- [ ] "Setup Discord Server" button in settings creates structure
- [ ] Creates category for workspace (e.g., "🍱 My Project")
- [ ] Creates channel per column inside category (#backlog, #in-progress, etc.)
- [ ] Creates #chef and #notifications special channels
- [ ] Thread created when task needs Discord presence
- [ ] Thread name = task title (truncated to 100 chars)
- [ ] Thread archived when task moves to Done (configurable)
- [ ] Thread unarchived when task moves out of Done
- [ ] Mapping stored in database for sync

## Technical Design

### Database Schema

```sql
-- Migration: 022_discord_integration.sql

-- Discord workspace mapping
ALTER TABLE workspaces ADD COLUMN discord_guild_id TEXT;
ALTER TABLE workspaces ADD COLUMN discord_category_id TEXT;
ALTER TABLE workspaces ADD COLUMN discord_chef_channel_id TEXT;
ALTER TABLE workspaces ADD COLUMN discord_notifications_channel_id TEXT;
ALTER TABLE workspaces ADD COLUMN discord_enabled INTEGER DEFAULT 0;

-- Column → Channel mapping
CREATE TABLE discord_column_channels (
  id TEXT PRIMARY KEY,
  column_id TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE,
  UNIQUE(column_id)
);

-- Task → Thread mapping
CREATE TABLE discord_task_threads (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  discord_thread_id TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL, -- Parent channel
  is_archived INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(task_id)
);
```

### Discord Structure

```
Server
└── 📁 🍱 My Project (Category)
    ├── #backlog
    │   ├── 💬 Add authentication (thread)
    │   └── 💬 Fix login bug (thread)
    ├── #in-progress
    │   └── 💬 Refactor API (thread)
    ├── #review
    ├── #done
    ├── #chef
    └── #notifications
```

### Sidecar Commands

```typescript
// discord-bot/src/commands/structure.ts

interface SetupWorkspacePayload {
  guildId: string;
  workspaceName: string;
  columns: Array<{ id: string; name: string; position: number }>;
}

interface SetupResult {
  categoryId: string;
  channelMap: Record<string, string>; // columnId → channelId
  chefChannelId: string;
  notificationsChannelId: string;
}

async function setupWorkspace(payload: SetupWorkspacePayload): Promise<SetupResult> {
  const guild = await client.guilds.fetch(payload.guildId);

  // Create category
  const category = await guild.channels.create({
    name: `🍱 ${payload.workspaceName}`,
    type: ChannelType.GuildCategory,
  });

  // Create column channels
  const channelMap: Record<string, string> = {};
  for (const col of payload.columns.sort((a, b) => a.position - b.position)) {
    const channel = await guild.channels.create({
      name: slugify(col.name),
      type: ChannelType.GuildText,
      parent: category.id,
    });
    channelMap[col.id] = channel.id;
  }

  // Create special channels
  const chefChannel = await guild.channels.create({
    name: 'chef',
    type: ChannelType.GuildText,
    parent: category.id,
    topic: 'Talk to Chef to manage your board. Try: "create a task for adding dark mode"',
  });

  const notifChannel = await guild.channels.create({
    name: 'notifications',
    type: ChannelType.GuildText,
    parent: category.id,
    topic: 'Task completions, alerts, and daily summaries',
  });

  return {
    categoryId: category.id,
    channelMap,
    chefChannelId: chefChannel.id,
    notificationsChannelId: notifChannel.id,
  };
}
```

### Thread Management

```typescript
// discord-bot/src/commands/threads.ts

interface CreateThreadPayload {
  channelId: string;
  taskId: string;
  taskTitle: string;
}

async function createTaskThread(payload: CreateThreadPayload): Promise<string> {
  const channel = await client.channels.fetch(payload.channelId);
  if (!channel?.isTextBased()) throw new Error('Invalid channel');

  // Create starter message
  const starterMessage = await channel.send({
    embeds: [{
      title: `📋 ${payload.taskTitle}`,
      description: 'Task thread created. Agent updates will appear here.',
      color: 0x5865F2,
    }],
  });

  // Create thread from message
  const thread = await starterMessage.startThread({
    name: payload.taskTitle.slice(0, 100),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
  });

  return thread.id;
}

async function moveThread(threadId: string, newChannelId: string): Promise<string> {
  // Discord doesn't support moving threads between channels
  // So we: archive old thread, create new thread in new channel, link them
  const oldThread = await client.channels.fetch(threadId);
  if (oldThread?.isThread()) {
    await oldThread.send({
      embeds: [{
        description: `📦 Task moved. Continuing in <#${newChannelId}>`,
        color: 0xFEE75C,
      }],
    });
    await oldThread.setArchived(true);
  }

  // Return new thread ID (caller will create it)
  return 'new-thread-needed';
}
```

### Rust Commands

```rust
#[tauri::command]
pub async fn setup_discord_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<DiscordSetupResult, AppError> {
    // Get workspace and columns
    // Call sidecar to create Discord structure
    // Store mappings in database
}

#[tauri::command]
pub async fn create_task_thread(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<String, AppError> {
    // Get task and its column
    // Look up column's Discord channel
    // Call sidecar to create thread
    // Store mapping in database
}

#[tauri::command]
pub async fn sync_task_thread_column(
    state: State<'_, AppState>,
    task_id: String,
    new_column_id: String,
) -> Result<(), AppError> {
    // Called when task moves columns
    // Handle thread archival/creation in new channel
}
```

## Implementation Steps

1. Create migration 022_discord_integration.sql
2. Add structure commands to discord sidecar
3. Implement `setupWorkspace` in sidecar
4. Implement `createTaskThread` in sidecar
5. Add Rust commands for setup and thread management
6. Add "Setup Discord Server" button to settings
7. Store mappings in database
8. Wire up thread creation on first task activity
9. Handle column moves (archive old, create new)
10. Add cleanup on workspace delete

## Files

**New:**
- `src-tauri/src/db/migrations/022_discord_integration.sql`
- `sidecars/discord-bot/src/commands/structure.ts`
- `sidecars/discord-bot/src/commands/threads.ts`

**Modified:**
- `src-tauri/src/discord/mod.rs` - Add structure commands
- `src-tauri/src/commands/discord.rs` - Add setup commands
- `src-tauri/src/db/mod.rs` - Add discord mapping functions
- `src/components/settings/discord-section.tsx` - Add setup button

## Complexity

**M** - Discord API work, database schema additions

## Commit

`feat(discord): implement channel/thread structure management`
