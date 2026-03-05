# Discord Integration Overnight Run

> **Mode**: Ralph Loop (extended autonomous work)
> **Goal**: Implement full Discord integration (Phases 1-3)
> **Epic**: E001-discord-integration.md
> **Branch**: `feature/discord-integration`

---

## Pre-Flight Checklist

Before starting:

- [ ] On branch `feature/discord-integration`
- [ ] Main merged in: `git pull origin main`
- [ ] Dependencies installed: `pnpm install`
- [ ] Rust compiles: `cargo check`
- [ ] TypeScript passes: `npm run type-check`
- [ ] App runs: `pnpm tauri dev`

---

## Execution Order (Dependency-Optimized)

### Phase 1: Bot Foundation (~3 hours)

| # | Ticket | Title | Complexity | Est. Time |
|---|--------|-------|------------|-----------|
| 1 | T052 | Discord Bot Foundation | M | 90min |
| 2 | T053 | Discord Auth & Settings UI | S | 45min |
| 3 | T054 | Thread/Channel Management | M | 60min |

### Phase 2: Workspace Mirroring (~3 hours)

| # | Ticket | Title | Complexity | Est. Time |
|---|--------|-------|------------|-----------|
| 4 | T055 | Task Event Sync | M | 60min |
| 5 | T056 | Agent Output Streaming | L | 90min |
| 6 | T057 | Batch Message Handler | S | 30min |

### Phase 3: Bidirectional Communication (~3 hours)

| # | Ticket | Title | Complexity | Est. Time |
|---|--------|-------|------------|-----------|
| 7 | T058 | Reply-to-Agent Routing | L | 90min |
| 8 | T059 | Chef Channel Integration | M | 60min |
| 9 | T060 | Bidirectional Sync | M | 60min |

**Total Estimated: ~9 hours**

---

## Dependency Graph

```
Phase 1 (Sequential - Each builds on previous)
T052 Bot Foundation
    │
    ├──► T053 Auth & Settings (needs bot to test)
    │
    └──► T054 Thread/Channel Management (needs bot client)

Phase 2 (Sequential - Event pipeline)
T054 ──► T055 Task Event Sync (needs thread management)
              │
              └──► T056 Agent Output Streaming (needs task events)
                        │
                        └──► T057 Batch Handler (needs output streaming)

Phase 3 (Sequential - Builds on Phase 2)
T056 ──► T058 Reply Routing (needs output + cliSessionId)
              │
              └──► T059 Chef Channel (needs routing patterns)
                        │
                        └──► T060 Bidirectional Sync (needs all sync handlers)
```

---

## Task Details

### 1. T052: Discord Bot Foundation (M - 90min)

**Goal**: Sidecar running, IPC working, basic Discord connection

**Steps**:
1. Create `src-tauri/sidecars/discord-bot/` directory structure
2. Initialize Node.js project: `cd sidecars/discord-bot && npm init -y`
3. Install dependencies: `npm install discord.js`
4. Create Bridge class for stdin/stdout IPC
5. Create basic Discord client setup
6. Create Rust `discord` module with process spawn/kill
7. Add Tauri commands: `connect_discord`, `disconnect_discord`
8. Test: spawn sidecar, connect to Discord, log "Ready"

**Files to Create**:
```
src-tauri/sidecars/discord-bot/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── bridge.ts
    └── client.ts

src-tauri/src/discord/
├── mod.rs
└── bridge.rs

src-tauri/src/commands/discord.rs
```

**Files to Modify**:
- `src-tauri/src/lib.rs` - Add discord module, register commands
- `src-tauri/src/commands/mod.rs` - Export discord commands
- `src-tauri/tauri.conf.json` - Sidecar configuration

**Verification**:
```bash
cargo check
# Manual: pnpm tauri dev, check console for "Discord sidecar spawned"
```

**Commit**: `feat(discord): add bot foundation with sidecar architecture`

---

### 2. T053: Discord Auth & Settings UI (S - 45min)

**Goal**: Settings panel for Discord configuration

**Steps**:
1. Add `DiscordSettings` interface to `src/types/settings.ts`
2. Create `integrations-tab.tsx` component
3. Create `discord-section.tsx` with token/server inputs
4. Add Tauri commands: `save_discord_settings`, `test_discord_connection`
5. Wire up settings store
6. Add connection status indicator
7. Test: enter token, click Test, see "Connected"

**Files to Create**:
```
src/components/settings/tabs/integrations-tab.tsx
src/components/settings/discord-section.tsx
```

**Files to Modify**:
- `src/types/settings.ts` - Add DiscordSettings
- `src/stores/settings-store.ts` - Handle discord settings
- `src/components/settings/settings-panel.tsx` - Add Integrations tab
- `src-tauri/src/commands/discord.rs` - Settings commands

**Verification**:
```bash
npm run type-check
npm run lint
# Manual: Open settings, see Integrations tab with Discord section
```

**Commit**: `feat(settings): add Discord integration settings panel`

---

### 3. T054: Thread/Channel Management (M - 60min)

**Goal**: Create Discord server structure, manage threads

**Steps**:
1. Create migration `022_discord_integration.sql`
2. Run migration: add tables and columns
3. Add structure commands to sidecar (`setupWorkspace`, `createThread`)
4. Add Rust commands: `setup_discord_workspace`, `create_task_thread`
5. Add "Setup Discord Server" button to settings
6. Store mappings in database
7. Test: click Setup, see channels/category created in Discord

**Files to Create**:
```
src-tauri/src/db/migrations/022_discord_integration.sql
sidecars/discord-bot/src/commands/structure.ts
sidecars/discord-bot/src/commands/threads.ts
```

**Files to Modify**:
- `src-tauri/src/discord/mod.rs` - Structure commands
- `src-tauri/src/db/mod.rs` - Discord mapping functions
- `src/components/settings/discord-section.tsx` - Setup button

**Verification**:
```bash
cargo check
npm run type-check
# Manual: Click "Setup Discord Server", verify channels created
```

**Commit**: `feat(discord): implement channel/thread structure management`

---

### 4. T055: Task Event Sync (M - 60min)

**Goal**: Task changes reflected in Discord threads

**Steps**:
1. Add task event emissions to Rust CRUD (`task:created`, `task:moved`, etc.)
2. Create `task-events.ts` handler in sidecar
3. Implement thread creation on task:created
4. Implement thread archival on task:moved
5. Implement completion summary on task:completed
6. Add event queue for offline handling
7. Test: create task in Bento-ya → thread appears in Discord

**Files to Create**:
```
sidecars/discord-bot/src/handlers/task-events.ts
sidecars/discord-bot/src/queue.ts
```

**Files to Modify**:
- `src-tauri/src/db/mod.rs` - Event emissions
- `src-tauri/src/commands/task.rs` - Emit events
- `sidecars/discord-bot/src/index.ts` - Register handlers

**Verification**:
```bash
cargo check
npm run type-check
# Manual: Create task, see thread in Discord
```

**Commit**: `feat(discord): sync task lifecycle events to Discord threads`

---

### 5. T056: Agent Output Streaming (L - 90min)

**Goal**: Agent output streams to Discord with batching

**Steps**:
1. Create OutputBuffer class (500ms debounce)
2. Create message splitter (2000 char limit)
3. Add agent output event listener
4. Modify `agent_session.rs` to emit Discord events
5. Implement completion summary embed
6. Store completion message ID for reply routing
7. Test: run agent → output appears in Discord thread

**Files to Create**:
```
sidecars/discord-bot/src/output-buffer.ts
sidecars/discord-bot/src/message-splitter.ts
sidecars/discord-bot/src/handlers/agent-output.ts
sidecars/discord-bot/src/handlers/agent-complete.ts
```

**Files to Modify**:
- `src-tauri/src/process/agent_session.rs` - Emit Discord events
- `sidecars/discord-bot/src/index.ts` - Register handlers

**Verification**:
```bash
cargo check
npm run type-check
# Manual: Start agent, see output stream to Discord
```

**Commit**: `feat(discord): stream agent output to task threads with batching`

---

### 6. T057: Batch Message Handler (S - 30min)

**Goal**: Rate limit handling, persistent queue

**Steps**:
1. Create RateLimiter class with bucket tracking
2. Add priority-based queuing
3. Implement message combining for backlog
4. Create PersistentQueue with lowdb
5. Add queue status command
6. Test: high-volume output → no rate limit errors

**Files to Create**:
```
sidecars/discord-bot/src/rate-limiter.ts
sidecars/discord-bot/src/persistent-queue.ts
```

**Files to Modify**:
- `sidecars/discord-bot/src/handlers/agent-output.ts` - Use rate limiter
- `src/components/settings/discord-section.tsx` - Queue status

**Verification**:
```bash
npm run type-check
# Manual: Verify no 429 errors under load
```

**Commit**: `feat(discord): add rate-limiting and persistent message queue`

---

### 7. T058: Reply-to-Agent Routing (L - 90min)

**Goal**: Discord replies reach agent, with --resume support

**Steps**:
1. Add messageCreate handler for thread replies
2. Implement task thread detection
3. Create message routing lookup
4. Implement `forwardToActiveSession`
5. Implement `resumeAgentSession` with --resume
6. Add Rust commands: `resume_agent_session`, `send_discord_message_to_agent`
7. Add `discord_agent_routes` table
8. Wire up typing indicator
9. Test: reply to completion message → agent resumes

**Files to Create**:
```
sidecars/discord-bot/src/handlers/reply.ts
sidecars/discord-bot/src/routing/forward.ts
sidecars/discord-bot/src/routing/resume.ts
sidecars/discord-bot/src/routing/storage.ts
```

**Files to Modify**:
- `src-tauri/src/commands/agent.rs` - Resume command
- `src-tauri/src/db/migrations/022_discord_integration.sql` - Routes table
- `src-tauri/src/db/mod.rs` - Route CRUD

**Verification**:
```bash
cargo check
npm run type-check
# Manual: Reply to agent summary → agent responds
```

**Commit**: `feat(discord): implement reply-to-agent routing with session resume`

---

### 8. T059: Chef Channel Integration (M - 60min)

**Goal**: #chef channel for board management

**Steps**:
1. Add chef channel detection
2. Create messageCreate handler for #chef
3. Implement message forwarding to orchestrator
4. Create response formatter with embeds
5. Add help command
6. Implement user rate limiting
7. Test: "create a task for X" in #chef → task created

**Files to Create**:
```
sidecars/discord-bot/src/handlers/chef.ts
sidecars/discord-bot/src/handlers/chef-response.ts
sidecars/discord-bot/src/commands/help.ts
src-tauri/src/discord/chef_bridge.rs
```

**Files to Modify**:
- `sidecars/discord-bot/src/index.ts` - Register handlers
- `src-tauri/src/discord/mod.rs` - Chef bridge
- `src-tauri/src/commands/discord.rs` - Chef message command

**Verification**:
```bash
cargo check
npm run type-check
# Manual: Message #chef, see task created + thread
```

**Commit**: `feat(discord): implement #chef channel for board management`

---

### 9. T060: Bidirectional Sync (M - 60min)

**Goal**: Full sync, conflict resolution, offline handling

**Steps**:
1. Add column event emissions in Rust
2. Implement column sync handlers
3. Add workspace rename sync
4. Implement channel reordering
5. Add offline queue
6. Implement full state sync on connect
7. Add conflict detection and notification
8. Test: rename column in Bento-ya → Discord updates

**Files to Create**:
```
sidecars/discord-bot/src/sync/columns.ts
sidecars/discord-bot/src/sync/workspace.ts
sidecars/discord-bot/src/sync/offline-queue.ts
sidecars/discord-bot/src/sync/conflicts.ts
sidecars/discord-bot/src/sync/full-sync.ts
```

**Files to Modify**:
- `src-tauri/src/commands/column.rs` - Event emissions
- `src-tauri/src/commands/workspace.rs` - Event emissions
- `sidecars/discord-bot/src/index.ts` - Register sync handlers

**Verification**:
```bash
cargo check
npm run type-check
# Manual: Column operations in Bento-ya reflect in Discord
```

**Commit**: `feat(discord): implement bidirectional sync with conflict resolution`

---

## Verification Protocol

After each task:
1. `cargo check` - Rust compiles
2. `npm run type-check` - TypeScript passes
3. `npm run lint` - No lint errors (fix if needed)
4. Manual test in `pnpm tauri dev`
5. Commit with conventional message
6. Continue to next task

---

## Recovery Protocol

If stuck on a task for >45min:
1. Document blocker as comment in ticket file
2. If non-critical, mark partial and continue
3. If blocking, try alternative approach
4. If truly stuck, skip to independent task (if any)

---

## Final Verification

After all tasks:

1. **Full flow test**:
   - [ ] Setup Discord server from settings
   - [ ] Create task → thread appears
   - [ ] Start agent → output streams to thread
   - [ ] Agent completes → summary posted
   - [ ] Reply in Discord → agent resumes
   - [ ] Message #chef → task created
   - [ ] Move task → thread moves
   - [ ] Rename column → channel renamed

2. **Code quality**:
   ```bash
   cargo check
   npm run type-check
   npm run lint
   ```

3. **No regressions**:
   - [ ] Existing features still work
   - [ ] App starts without Discord configured
   - [ ] App works offline (Discord disabled)

---

## Completion Criteria

- [ ] Phase 1 complete (T052, T053, T054)
- [ ] Phase 2 complete (T055, T056, T057)
- [ ] Phase 3 complete (T058, T059, T060)
- [ ] All type-check and lint pass
- [ ] App runs without errors
- [ ] Full flow tested manually
- [ ] Ready for PR

---

## Invoke Command

```
/ralph-loop .tickets/discord/RUN-DISCORD.md
```

Or start manually with T052:
```
Read .tickets/discord/T052-discord-bot-foundation.md
Implement changes
Test in dev mode
Commit: feat(discord): add bot foundation with sidecar architecture
Continue to T053...
```

---

## Notes

- **Node.js sidecar**: User must have Node.js 18+ installed
- **Discord bot token**: Create at discord.com/developers/applications
- **Rate limits**: Discord allows 5 messages per 5 seconds per channel
- **Thread archive**: Threads auto-archive after 7 days of inactivity
- **Message limit**: Discord messages max 2000 characters

---

## Resources

- [discord.js Guide](https://discordjs.guide/)
- [Discord API Docs](https://discord.com/developers/docs)
- [Tauri Sidecar](https://v2.tauri.app/develop/sidecar/)
- Existing patterns: `src-tauri/src/process/` for IPC
