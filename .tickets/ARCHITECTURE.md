# Bento-ya Architecture Overview

> Last updated: 2025-03-01

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
│   ├── hooks/                    # useAgent, useWorkspace, useSwipe, etc.
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
│       │   └── migrations/       # 8 migration files
│       ├── git/                  # Git operations
│       │   ├── branch_manager.rs
│       │   ├── change_tracker.rs
│       │   └── conflict_detector.rs
│       ├── pipeline/             # Pipeline engine
│       │   ├── engine.rs         # State machine logic
│       │   └── triggers.rs       # Exit criteria evaluation
│       └── process/              # Process management
│           ├── agent_runner.rs   # Agent session lifecycle
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

Message persistence for future LLM integration.

**Key Files**:
- `src-tauri/src/commands/orchestrator.rs` - Message storage
- `src/components/chat/chat-input.tsx` - Input UI
- `src/stores/chat-store.ts` - Local state

**Current State**: Messages stored but **no LLM calls** (see T033)

### 5. Settings System

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

8 migrations create these tables:

| Table | Purpose |
|-------|---------|
| workspaces | Workspace metadata + config JSON |
| columns | Kanban columns with trigger/exit config |
| tasks | Task cards with pipeline state |
| agent_sessions | Agent session metadata + resumable flag |
| chat_messages | Orchestrator conversation history |
| orchestrator_sessions | Chat session metadata |
| checklists, checklist_categories, checklist_items | Production checklists |
| usage_records | LLM cost tracking per task/workspace |
| session_snapshots | History replay data |

---

## Wiring Status (What's Not Connected)

See `.tickets/wiring/` for detailed tickets.

| Component | Current State | Needed |
|-----------|---------------|--------|
| **LLM Integration (T033)** | Chat stores messages, never calls LLM | Anthropic/OpenAI API calls with streaming |
| **Pipeline Exit Criteria (T034)** | Triggers defined but not evaluated | Wire trigger → evaluation → auto-advance |
| **Settings Backend (T038)** | localStorage only | Sync to workspace.config for per-workspace settings |
| **Checklist Persistence (T037)** | UI works, no backend | Save to checklists tables |
| **Metrics Collection (T036)** | Table exists, no data | Insert usage_records on LLM calls |

---

## Recent Work (March 2025)

### CLI Auto-Detection
- Added `detect_clis()` and `detect_single_cli()` commands
- On-demand detection when selecting CLI mode in settings
- Auto-applies detected path without manual "Use" button

### Terminal/Agent IPC Fix
- Fixed parameter mismatch: JS camelCase vs Rust snake_case
- Added `#[tauri::command(rename_all = "camelCase")]` to all commands
- Made `start_agent` async to fix Tokio runtime panic
- Terminal now working end-to-end

### Settings UI/UX
- Toggle switches instead of checkboxes for provider enable/disable
- Removed per-provider default model (orchestrator handles it)
- Removed unused instructions file field
- Default max concurrent agents: 10
- "Coming Soon" section collapsed by default

---

## Next Priorities

1. **T033: LLM Integration** - Core blocker for all AI features
   - Anthropic streaming API
   - CLI fallback for complex agents
   - Token/cost tracking

2. **v0.4: Siege Loop** - PR workflow automation
   - T024: PR creation from Review column
   - T025: Comment-watch loop
   - T028: Checklist auto-detect

3. **Wiring Tickets** - Connect existing UI to backend
   - T038: Settings backend sync
   - T034: Pipeline exit criteria evaluation
