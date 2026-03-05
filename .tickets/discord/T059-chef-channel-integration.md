# T059: Chef Channel Integration

## Summary

Implement the #chef channel where users can interact with Chef (the orchestrator) via natural language. Chef can create tasks, move tasks, update the board, and answer questions about the workspace.

## Acceptance Criteria

- [ ] Messages in #chef routed to Chef/orchestrator
- [ ] Chef responds with board actions and explanations
- [ ] Actions execute immediately on board
- [ ] Rich response formatting (embeds for created tasks, etc.)
- [ ] Conversation context maintained per user
- [ ] Help message on bot mention or "help"
- [ ] Rate limit per user (prevent spam)

## Technical Design

### Chef Message Handler

```typescript
// sidecars/discord-bot/src/handlers/chef.ts

import { Message, EmbedBuilder } from 'discord.js';

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;

  // Check if in #chef channel
  const isChefChannel = await bridge.isChefChannel(message.channelId);
  if (!isChefChannel) return;

  // Get workspace for this guild
  const workspace = await bridge.getWorkspaceByGuild(message.guild!.id);
  if (!workspace) {
    await message.reply('⚠️ No workspace connected to this server.');
    return;
  }

  // Show typing while Chef thinks
  await message.channel.sendTyping();
  const typingInterval = setInterval(() => message.channel.sendTyping(), 5000);

  try {
    // Forward to Chef orchestrator
    const result = await bridge.send({
      type: 'chef:message',
      payload: {
        workspaceId: workspace.id,
        userId: message.author.id,
        userName: message.author.displayName,
        message: message.content,
      },
    });

    clearInterval(typingInterval);

    // Format and send response
    await sendChefResponse(message, result);

  } catch (error) {
    clearInterval(typingInterval);
    await message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Chef Error')
        .setDescription(error.message)
        .setColor(0xED4245)],
    });
  }
});
```

### Chef Response Formatting

```typescript
// sidecars/discord-bot/src/handlers/chef-response.ts

interface ChefResult {
  message: string;
  actions: ChefAction[];
  tasksCreated: Task[];
  tasksMoved: TaskMove[];
}

interface ChefAction {
  type: 'create_task' | 'move_task' | 'update_task' | 'delete_task';
  taskId?: string;
  details: any;
}

async function sendChefResponse(message: Message, result: ChefResult) {
  const embeds: EmbedBuilder[] = [];

  // Main response
  const mainEmbed = new EmbedBuilder()
    .setDescription(result.message)
    .setColor(0x5865F2);

  // Add task creation details
  if (result.tasksCreated.length > 0) {
    const taskList = result.tasksCreated.map(t =>
      `• **${t.title}** → ${t.columnName}`
    ).join('\n');

    mainEmbed.addFields({
      name: '📋 Tasks Created',
      value: taskList,
    });
  }

  // Add move details
  if (result.tasksMoved.length > 0) {
    const moveList = result.tasksMoved.map(m =>
      `• **${m.title}**: ${m.fromColumn} → ${m.toColumn}`
    ).join('\n');

    mainEmbed.addFields({
      name: '📦 Tasks Moved',
      value: moveList,
    });
  }

  embeds.push(mainEmbed);

  // Thread links for created tasks
  for (const task of result.tasksCreated) {
    const threadMapping = await bridge.getThreadMapping(task.id);
    if (threadMapping) {
      embeds.push(new EmbedBuilder()
        .setTitle(`📋 ${task.title}`)
        .setDescription(task.description || 'No description')
        .setColor(0x57F287)
        .addFields(
          { name: 'Column', value: task.columnName, inline: true },
          { name: 'Thread', value: `<#${threadMapping.threadId}>`, inline: true },
        )
      );
    }
  }

  await message.reply({ embeds });
}
```

### Rust Chef Bridge

```rust
// src-tauri/src/discord/chef_bridge.rs

use crate::commands::orchestrator::{send_message_to_chef, OrchestratorResponse};

#[derive(Debug, Deserialize)]
pub struct DiscordChefMessage {
    pub workspace_id: String,
    pub user_id: String,
    pub user_name: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
pub struct DiscordChefResponse {
    pub message: String,
    pub actions: Vec<ChefAction>,
    pub tasks_created: Vec<Task>,
    pub tasks_moved: Vec<TaskMove>,
}

pub async fn handle_chef_message(
    state: &AppState,
    cli_manager: &SharedCliSessionManager,
    payload: DiscordChefMessage,
) -> Result<DiscordChefResponse, AppError> {
    // Get or create chat session for this Discord user
    let session_id = format!("discord-{}-{}", payload.workspace_id, payload.user_id);

    // Prepend user context to message
    let contextualized_message = format!(
        "[Discord user: {}]\n\n{}",
        payload.user_name,
        payload.message
    );

    // Send to existing orchestrator
    let result = send_message_to_chef(
        state,
        cli_manager,
        &session_id,
        &payload.workspace_id,
        &contextualized_message,
    ).await?;

    // Convert orchestrator response to Discord format
    Ok(DiscordChefResponse {
        message: result.message,
        actions: result.actions.into_iter().map(|a| ChefAction {
            action_type: a.action_type,
            task_id: a.task_id,
            details: serde_json::json!({
                "title": a.title,
                "description": a.description,
                "column_id": a.column_id,
            }),
        }).collect(),
        tasks_created: result.tasks_created,
        tasks_moved: vec![], // Extract from actions
    })
}
```

### Help Command

```typescript
// sidecars/discord-bot/src/commands/help.ts

const HELP_EMBED = new EmbedBuilder()
  .setTitle('🍱 Bento-ya Chef')
  .setDescription('I can help you manage your Kanban board!')
  .setColor(0x5865F2)
  .addFields(
    {
      name: '📋 Create Tasks',
      value: '`create a task for adding dark mode`\n`add task: fix login bug`',
    },
    {
      name: '📦 Move Tasks',
      value: '`move "Add auth" to In Progress`\n`move task 3 to Review`',
    },
    {
      name: '✏️ Update Tasks',
      value: '`rename "Old title" to "New title"`\n`add description to "Task name": ...`',
    },
    {
      name: '🔍 Query',
      value: '`show my tasks`\n`what\'s in Review?`\n`status of "Auth task"`',
    },
    {
      name: '🤖 Agents',
      value: '`start agent on "Task name"`\n`stop agent on "Task name"`',
    },
  )
  .setFooter({ text: 'Just chat naturally - I understand context!' });

// Respond to "help", bot mention, or first message
async function handleHelp(message: Message) {
  await message.reply({ embeds: [HELP_EMBED] });
}
```

### User Rate Limiting

```typescript
// sidecars/discord-bot/src/rate-limit/user.ts

const userCooldowns = new Map<string, number>();
const COOLDOWN_MS = 2000; // 2 seconds between messages

function isRateLimited(userId: string): boolean {
  const lastMessage = userCooldowns.get(userId);
  if (lastMessage && Date.now() - lastMessage < COOLDOWN_MS) {
    return true;
  }
  userCooldowns.set(userId, Date.now());
  return false;
}
```

## Implementation Steps

1. Add chef channel detection in sidecar
2. Create messageCreate handler for #chef
3. Implement message forwarding to orchestrator
4. Create response formatter with embeds
5. Add help command
6. Implement user rate limiting
7. Wire up task/move actions to Discord thread creation
8. Test conversation flow
9. Test multi-user conversations
10. Add error handling

## Files

**New:**
- `sidecars/discord-bot/src/handlers/chef.ts`
- `sidecars/discord-bot/src/handlers/chef-response.ts`
- `sidecars/discord-bot/src/commands/help.ts`
- `src-tauri/src/discord/chef_bridge.rs`

**Modified:**
- `sidecars/discord-bot/src/index.ts` - Register handlers
- `src-tauri/src/discord/mod.rs` - Add chef bridge
- `src-tauri/src/commands/discord.rs` - Add chef message command

## Dependencies

- T054 (Thread/Channel Management) - Chef channel creation
- T055 (Task Event Sync) - Task creation triggers thread

## Complexity

**M** - Reuses existing orchestrator, mainly formatting

## Commit

`feat(discord): implement #chef channel for board management`
