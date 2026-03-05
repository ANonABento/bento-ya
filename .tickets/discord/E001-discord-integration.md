# E001: Discord Integration

> **Epic**: Full bidirectional Discord integration with workspace mirroring
> **Priority**: P1 (v1.1 feature)
> **Estimated Effort**: L (multi-phase)

---

## Vision

Transform Discord into a remote cockpit for Bento-ya. Users can monitor agent progress, receive notifications, reply to agents, and manage the board through natural language - all from Discord (including mobile).

**Key Insight**: Chef already manages the board via natural language. Discord bot is simply a new interface to Chef.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BENTO-YA (Tauri App)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌───────────────┐    ┌──────────────────────┐      │
│  │   Chef      │◄───│  Orchestrator │◄───│  Discord Bridge      │      │
│  │  (LLM)      │    │   Commands    │    │  (discord.js)        │      │
│  └─────────────┘    └───────────────┘    └──────────────────────┘      │
│        │                   │                       ▲                    │
│        ▼                   ▼                       │                    │
│  ┌─────────────┐    ┌───────────────┐             │  WebSocket/        │
│  │   Board     │    │ Agent Sessions │             │  Tauri Events      │
│  │   State     │    │ (--resume)    │             │                    │
│  └─────────────┘    └───────────────┘             │                    │
│                                                    │                    │
└────────────────────────────────────────────────────┼────────────────────┘
                                                     │
                                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         DISCORD SERVER                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  📁 BACKLOG (Category)           📁 IN-PROGRESS (Category)              │
│  ├── 💬 task-auth-system         ├── 💬 task-fix-login ← agent posting  │
│  └── 💬 task-add-tests           └── 💬 task-refactor                   │
│                                                                          │
│  📁 REVIEW (Category)            📁 DONE (Category)                     │
│  └── 💬 task-new-feature         └── (archived threads)                 │
│                                                                          │
│  #chef ← "move task X to review", "create task for..."                  │
│  #notifications ← aggregated alerts, daily summaries                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

Thread-per-task model (inside column channels):
- Each column has a channel: #backlog, #in-progress, #review, #done
- Each task is a thread within its column's channel
- When task moves column → thread moves (close old, open in new channel)
```

---

## Core Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Bot location** | Built into Bento-ya | Tight integration, works offline, no extra hosting |
| **Task representation** | Threads (not channels) | Avoids 500 channel limit, auto-archive, cleaner |
| **Source of truth** | Bento-ya | Discord is a view/interface, not storage |
| **Reply routing** | Active → direct, Done → --resume | Matches existing session management |
| **Chef interface** | Dedicated #chef channel | Clear separation, familiar pattern |

---

## User Stories

### US1: View agent progress from Discord
> As a user, I want to see agent updates in Discord so I can monitor overnight runs from my phone.

### US2: Reply to agent from Discord
> As a user, I want to reply to an agent summary in Discord and have my message sent to the agent for follow-up.

### US3: Manage board from Discord
> As a user, I want to tell Chef "move task X to review" in Discord and have it happen on the board.

### US4: Receive notifications
> As a user, I want to get Discord notifications when tasks complete, fail, or need attention.

### US5: See workspace structure
> As a user, I want Discord channels to mirror my board columns so I can see status at a glance.

---

## Phases

### Phase 1: Bot Foundation (T052-T054)
**Goal**: Discord bot running, basic settings, thread management primitives

| Ticket | Title | Complexity | Dependencies |
|--------|-------|------------|--------------|
| T052 | Discord Bot Foundation | M | None |
| T053 | Discord Auth & Settings UI | S | T052 |
| T054 | Thread/Channel Management | M | T052 |

**Exit Criteria**: Bot connects, creates channels/threads, responds to basic commands

---

### Phase 2: Workspace Mirroring (T055-T057)
**Goal**: Board state reflected in Discord, agent output streams to threads

| Ticket | Title | Complexity | Dependencies |
|--------|-------|------------|--------------|
| T055 | Task Event Sync | M | T054 |
| T056 | Agent Output Streaming | L | T055 |
| T057 | Batch Message Handler | S | T056 |

**Exit Criteria**: Tasks appear as threads, agent output posts to Discord (batched)

---

### Phase 3: Bidirectional Communication (T058-T060)
**Goal**: Reply routing, Chef channel, full two-way sync

| Ticket | Title | Complexity | Dependencies |
|--------|-------|------------|--------------|
| T058 | Reply-to-Agent Routing | L | T056 |
| T059 | Chef Channel Integration | M | T058 |
| T060 | Bidirectional Sync | M | T059 |

**Exit Criteria**: Full bidirectional communication, Chef responds in Discord

---

## Technical Details

### Discord Bot Setup (discord.js)

```typescript
// Embedded in Bento-ya via sidecar or Tauri plugin
import { Client, GatewayIntentBits, ThreadAutoArchiveDuration } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

// Connect to Bento-ya via Tauri event bridge
```

### Database Schema Additions

```sql
-- Migration: 022_discord_integration.sql

-- Discord workspace config
ALTER TABLE workspaces ADD COLUMN discord_guild_id TEXT;
ALTER TABLE workspaces ADD COLUMN discord_chef_channel_id TEXT;
ALTER TABLE workspaces ADD COLUMN discord_notifications_channel_id TEXT;

-- Discord column mapping (column -> channel)
CREATE TABLE discord_column_channels (
  id TEXT PRIMARY KEY,
  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  discord_channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(column_id)
);

-- Discord task mapping (task -> thread)
CREATE TABLE discord_task_threads (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  discord_thread_id TEXT NOT NULL,
  discord_channel_id TEXT NOT NULL,
  last_message_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(task_id)
);

-- Message routing (for reply → agent)
CREATE TABLE discord_message_routes (
  id TEXT PRIMARY KEY,
  discord_message_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_session_id TEXT,
  cli_session_id TEXT, -- for --resume
  created_at TEXT NOT NULL
);
```

### IPC Commands (Rust → JS Bridge)

```rust
// src-tauri/src/commands/discord.rs

#[tauri::command]
pub async fn connect_discord(
    state: State<'_, AppState>,
    bot_token: String,
    guild_id: String,
) -> Result<(), AppError>;

#[tauri::command]
pub async fn disconnect_discord(
    state: State<'_, AppState>,
) -> Result<(), AppError>;

#[tauri::command]
pub async fn setup_discord_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<DiscordSetupResult, AppError>;

#[tauri::command]
pub async fn post_to_task_thread(
    state: State<'_, AppState>,
    task_id: String,
    content: String,
    batch: bool,
) -> Result<(), AppError>;

#[tauri::command]
pub async fn route_discord_reply(
    state: State<'_, AppState>,
    message_id: String,
    content: String,
) -> Result<(), AppError>;
```

### Event Flow: Agent → Discord

```
1. Agent outputs text
   └─► agent_session.rs emits "agent:output" event

2. Discord bridge listens
   └─► Buffers output (500ms debounce for batching)

3. On flush:
   └─► Looks up discord_task_threads for task_id
   └─► Posts to thread (splits if >2000 chars)
   └─► Stores message_id in discord_message_routes

4. On agent complete:
   └─► Posts summary with "Reply to continue" footer
   └─► Stores cli_session_id for --resume
```

### Event Flow: Discord Reply → Agent

```
1. User replies in task thread
   └─► discord.js "messageCreate" event

2. Discord bridge receives
   └─► Looks up discord_message_routes for context
   └─► Determines: active session or needs --resume?

3a. Active session:
    └─► Forward message to agent_session.send_message()

3b. Completed session:
    └─► Spawn new agent with --resume {cli_session_id}
    └─► Send user's reply as first message
```

### Event Flow: Chef Channel

```
1. User messages #chef: "create a task for adding dark mode"
   └─► discord.js "messageCreate" in chef channel

2. Discord bridge receives
   └─► Routes to orchestrator.send_message()
   └─► Includes board context (same as in-app Chef)

3. Chef responds with actions
   └─► Posts response to #chef
   └─► Executes board modifications
   └─► Discord bridge updates threads as needed
```

---

## Settings UI

```
Settings > Integrations > Discord

┌──────────────────────────────────────────────────────┐
│ Discord Integration                          [Toggle]│
├──────────────────────────────────────────────────────┤
│                                                      │
│ Bot Token: [•••••••••••••••••••••••] [Show] [Test]  │
│                                                      │
│ Server ID: [123456789012345678    ] [Detect]        │
│                                                      │
│ ─────────────────────────────────────────────────── │
│                                                      │
│ Workspace: My Project                                │
│ Status: ● Connected                                  │
│                                                      │
│ Channel Mapping:                                     │
│   📁 Backlog    → #backlog                          │
│   📁 In Progress → #in-progress                     │
│   📁 Review     → #review                           │
│   📁 Done       → #done                             │
│                                                      │
│ Special Channels:                                    │
│   #chef          → Chef commands                    │
│   #notifications → Alerts & summaries               │
│                                                      │
│ [Setup Discord Server] [Refresh Mapping]            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Message Format Examples

### Agent Progress Update (in task thread)
```
🤖 **Agent Working** (iteration 2/5)

Reading `src/auth/login.ts`...
Found issue: missing null check on line 47

```diff
- const user = await getUser(id);
+ const user = await getUser(id);
+ if (!user) throw new AuthError('User not found');
```

Running type-check... ✅ Pass
```

### Agent Complete Summary
```
✅ **Task Complete**: Add null safety to auth module

**Changes Made:**
- `src/auth/login.ts` - Added null checks (3 locations)
- `src/auth/session.ts` - Added optional chaining
- `tests/auth.test.ts` - Added null case tests

**Metrics:** 847 tokens, $0.02, 45s

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 Reply to this message to continue working with the agent
```

### Chef Response (in #chef)
```
✅ Created task "Add dark mode toggle"

📋 **Task Details:**
- Column: Backlog
- Description: Implement dark mode toggle in settings panel

Thread created: #task-add-dark-mode

Would you like me to:
1. Add acceptance criteria?
2. Move it to In Progress and start an agent?
3. Split it into subtasks?
```

### Notification (#notifications)
```
🎉 **Task Completed**

**Add user authentication** finished successfully!

PR #142 created: https://github.com/user/repo/pull/142
Agent used 2,341 tokens ($0.07)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
View in Bento-ya | View PR | Thread: #task-add-auth
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Discord rate limits | Batch messages, respect 5 msg/5s limit |
| Bot token security | Store encrypted, never log |
| Message size limits | Split at 2000 chars, use embeds for structure |
| Thread archive (7 days) | Re-activate on activity, or use forums |
| Offline sync | Queue messages when disconnected, sync on reconnect |
| Duplicate events | Idempotency keys, dedup by message ID |

---

## Out of Scope (v1.1)

- Multi-server support (one Discord server per Bento-ya instance)
- Slash commands (natural language via #chef is sufficient)
- Voice channels
- Role-based permissions
- Reactions as actions

---

## Success Metrics

1. **Reliability**: >99% message delivery rate
2. **Latency**: Agent output appears in Discord <2s after emission
3. **Adoption**: Users interact via Discord at least 1x per session
4. **Coverage**: All task state changes reflected in Discord

---

## Dependencies

- discord.js v14+ (ESM)
- Tauri sidecar or plugin for Node.js runtime
- Existing: Agent session management, Chef orchestrator, Tauri events

---

## Open Questions

1. **Sidecar vs Plugin**: Run discord.js as Tauri sidecar (separate process) or embed via wasm/napi?
   - **Recommendation**: Sidecar - simpler, discord.js is battle-tested Node.js

2. **Forum channels vs threads**: Discord forums have better persistence but different UX
   - **Recommendation**: Start with threads, evaluate forums for v1.2

3. **Workspace isolation**: If user has multiple workspaces, how to handle Discord?
   - **Recommendation**: v1.1 = one workspace per Discord server, v1.2 = categories per workspace

---

## Related Tickets

- T027 (Notification Column) - Existing notification infrastructure
- T025 (Siege Loop) - Agent completion events to leverage
- T017 (Orchestrator Agent) - Chef integration point
