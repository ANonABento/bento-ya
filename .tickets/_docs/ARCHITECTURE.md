# Bento-ya Architecture Overview

> Last updated: 2025-03-05

## Overview

Bento-ya is a Tauri-based kanban board for AI-assisted software development. It combines a Rust backend with a React frontend to provide:

- **Kanban Board**: Visual task management with columns and cards
- **AI Agent Integration**: CLI-based agents (Claude, Codex) for automated coding
- **Terminal Emulation**: PTY-based terminal for agent output
- **Pipeline Engine**: Automated task progression through columns
- **Voice Input**: Whisper-powered speech-to-text

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Zustand, TailwindCSS |
| Backend | Rust, Tauri 2.0, SQLite (rusqlite) |
| Terminal | xterm.js + WebGL addon, portable-pty |
| Voice | OpenAI Whisper API |
| Build | Vite, pnpm |

---

## Directory Structure

```
bento-ya/
├── src/                          # Frontend (React)
│   ├── components/
│   │   ├── chat/                 # Chat input, voice button
│   │   ├── checklist/            # Production checklists
│   │   ├── git/                  # Conflict heatmap, diff viewer
│   │   ├── history/              # Session replay
│   │   ├── kanban/               # Board, columns, cards
│   │   ├── layout/               # Board, tab bar, app shell
│   │   ├── review/               # Diff viewer
│   │   ├── settings/             # Settings modal (6 tabs)
│   │   ├── shared/               # Button, tooltip, icons
│   │   ├── templates/            # Community gallery
│   │   ├── terminal/             # xterm.js terminal view
│   │   └── usage/                # Metrics dashboard
│   ├── hooks/                    # useAgentSession, usePipelineEvents, useSwipe, etc.
│   ├── lib/                      # IPC wrappers, theme, utils
│   ├── stores/                   # Zustand stores
│   └── types/                    # TypeScript types
│
├── src-tauri/                    # Backend (Rust)
│   └── src/
│       ├── commands/             # Tauri command handlers
│       │   ├── agent.rs          # start_agent, stop_agent, get_status
│       │   ├── cli_detect.rs     # detect_clis, detect_single_cli
│       │   ├── column.rs         # CRUD for columns
│       │   ├── git.rs            # Branch manager, conflict detector
│       │   ├── history.rs        # Session snapshots
│       │   ├── orchestrator.rs   # Chat messages, sessions
│       │   ├── task.rs           # CRUD for tasks
│       │   ├── terminal.rs       # PTY write/resize/scrollback
│       │   ├── voice.rs          # Whisper transcription
│       │   └── workspace.rs      # CRUD for workspaces
│       ├── db/                   # SQLite database
│       │   └── migrations/       # 22 migration files
│       ├── git/                  # Git operations
│       │   ├── branch_manager.rs
│       │   ├── change_tracker.rs
│       │   └── conflict_detector.rs
│       ├── pipeline/             # Pipeline engine
│       │   ├── engine.rs         # State machine logic
│       │   └── triggers.rs       # Exit criteria evaluation
│       └── process/              # Process management
│           ├── agent_runner.rs   # Agent session lifecycle
│           ├── agent_cli_session.rs # Per-task CLI sessions with streaming
│           ├── cli_session.rs    # CLI session management
│           └── pty_manager.rs    # PTY spawning and I/O
```

---

## Key Subsystems

### 1. Terminal/Agent System

**Flow**: Frontend → IPC → AgentRunner → PTYManager → CLI Process

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Terminal View  │────▶│   use-agent.ts  │────▶│  startAgent()   │
│  (xterm.js)     │     │    (hook)       │     │   (IPC call)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                        ┌───────────────────────────────┘
                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  agent.rs       │────▶│  AgentRunner    │────▶│   PtyManager    │
│  (command)      │     │  (session mgmt) │     │   (spawn PTY)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
                        ┌───────────────────────────────┘
                        ▼
┌─────────────────┐     ┌─────────────────┐
│  CLI Process    │────▶│   Tauri Events  │────▶ Terminal View
│  (claude/codex) │     │   pty:*:output  │
└─────────────────┘     └─────────────────┘
```

**Key Files**:
- `src/hooks/use-agent.ts` - Agent lifecycle hook
- `src-tauri/src/commands/agent.rs` - Tauri commands (camelCase params)
- `src-tauri/src/process/agent_runner.rs` - Session management
- `src-tauri/src/process/pty_manager.rs` - PTY spawning with Tokio

**Events**:
- `pty:{taskId}:output` - Terminal output chunks
- `pty:{taskId}:exit` - Process exit with code

### 2. CLI Detection

Detects installed AI CLI tools (claude, codex) on-demand when user selects CLI mode.

**Key Files**:
- `src-tauri/src/commands/cli_detect.rs` - Detection logic
- `src/components/settings/tabs/agent-tab.tsx` - Auto-applies detected path

**Detection Strategy**:
1. Try `which <cli>` command
2. Check common paths: `~/.local/bin`, `/usr/local/bin`, Homebrew
3. Verify with `<cli> --version`

### 3. Pipeline Engine

Automated task progression through kanban columns based on triggers.

**Key Files**:
- `src-tauri/src/pipeline/engine.rs` - State machine
- `src-tauri/src/pipeline/triggers.rs` - Exit criteria evaluation
- `src/stores/column-store.ts` - Column configuration

**Triggers**: git_commit, tests_pass, pr_merged, agent_complete, manual

### 4. Orchestrator/Chat

Chat system with LLM integration via Claude CLI subprocess.

**Key Files**:
- `src-tauri/src/commands/orchestrator.rs` - Chat message storage, CLI streaming
- `src-tauri/src/process/cli_session.rs` - Persistent CLI sessions per workspace
- `src/components/panel/chat-panel.tsx` - Chat UI with streaming
- `src/stores/chat-store.ts` - Message state

**Features**:
- Streaming responses via `--output-format stream-json`
- Persistent CLI sessions with `--resume` support
- Tool use: create_task, update_task, move_task, delete_task
- Thinking display in collapsible blocks

### 5. Agent Chat (Per-Task)

Per-task AI chat for focused work on individual tasks.

**Key Files**:
- `src-tauri/src/process/agent_cli_session.rs` - Task-scoped CLI sessions
- `src-tauri/src/commands/agent.rs` - stream_agent_chat, cancel_agent_chat
- `src/hooks/use-agent-session.ts` - Streaming state management
- `src/components/panel/agent-panel.tsx` - Task chat UI

**Features**:
- Max 5 concurrent agent sessions
- Task context in system prompt
- Streaming with tool call tracking

### 6. Settings System

Six-tab settings modal with Zustand persistence to localStorage.

**Tabs**:
1. Appearance (theme, font size)
2. Agent (providers: Claude, Codex, Aider with CLI/API modes)
3. Git (auto-commit, branch prefix)
4. Voice (Whisper config)
5. Shortcuts (keyboard bindings)
6. Templates (pipeline templates)

**Key Files**:
- `src/components/settings/` - UI components
- `src/stores/settings-store.ts` - Persisted state
- `src/types/settings.ts` - Type definitions

---

## IPC Conventions

### Parameter Naming
- **Frontend (TypeScript)**: camelCase (`taskId`, `workingDir`)
- **Backend (Rust)**: snake_case with `#[tauri::command(rename_all = "camelCase")]`
- Tauri automatically converts between them

### Async Commands
Commands that spawn async tasks (Tokio) must be declared `async`:
```rust
#[tauri::command(rename_all = "camelCase")]
pub async fn start_agent(...) -> Result<AgentInfo, String>
```

### Events
Use Tauri's event system for streaming data:
```rust
app_handle.emit(&format!("pty:{}:output", task_id), payload)?;
```

---

## Database Schema

22 migrations create these tables:

| Table | Purpose |
|-------|---------|
| workspaces | Workspace metadata + config JSON |
| columns | Kanban columns with trigger/exit config |
| tasks | Task cards with pipeline state, agent_status, queued_at |
| agent_sessions | Agent session metadata + resumable flag |
| agent_messages | Per-task chat history |
| chat_messages | Orchestrator conversation history |
| orchestrator_sessions | Chat session metadata |
| cli_sessions | CLI session persistence |
| usage_records | LLM cost tracking per task/workspace |
| session_snapshots | History replay data |
| discord_guild_configs | Discord integration config |
| discord_task_threads | Discord thread mapping |

---

## Wiring Status

| Component | Status | Notes |
|-----------|--------|-------|
| **LLM Integration (T033)** | ✅ COMPLETE | Claude CLI streaming, tool use, thinking display |
| **Pipeline Exit Criteria (T034)** | ✅ COMPLETE | All 7 exit types implemented |
| **Pipeline Triggers (T042-T044)** | ✅ COMPLETE | Agent/Script/Skill triggers with frontend event handling |
| **Settings Backend (T038)** | ✅ COMPLETE | Workspace config synced to DB |
| **Checklist Persistence (T037)** | ✅ COMPLETE | Task checklist JSON field |
| **Metrics Collection (T036)** | ✅ COMPLETE | Usage records inserted |
| **Agent Queue System** | ✅ COMPLETE | Queue with max 5 concurrent |
| **History Replay (T035)** | ❌ TODO | Missing `restore_snapshot` command |
| **Discord Integration** | ⚠️ STUBBED | Handler stubs exist, need implementation |
| **Webhook Trigger** | ⚠️ STUBBED | Defined but no-op |

---

## Recent Work (March 2025)

### Agent Queue System & Pipeline Wiring (2025-03-05)
- Agent queue system with `idle`, `queued`, `running`, `completed`, `failed` statuses
- Max 5 concurrent agents with FIFO queue ordering
- `use-pipeline-events.ts` hook for frontend event handling
- Pipeline triggers now work end-to-end

### Orchestrator Intelligence (2025-03-02)
- LLM streaming via Claude CLI subprocess
- Tool use: create_task, update_task, move_task, delete_task
- Persistent CLI sessions with `--resume` support
- Thinking display in collapsible blocks

### CLI Auto-Detection (2025-03-01)
- On-demand detection of claude/codex CLI paths
- Auto-applies detected path in settings

### Terminal/Agent IPC Fix (2025-03-01)
- Fixed parameter naming mismatch (JS camelCase vs Rust snake_case)
- Made `start_agent` async to fix Tokio runtime panic

---

## Next Priorities

1. **History Replay (T035)** - Add `restore_snapshot` command
2. **Discord Integration** - Implement handler stubs
3. **v0.4 Siege completion** - T026 (test checklists), T027 (notifications), T028 (auto-detect)
