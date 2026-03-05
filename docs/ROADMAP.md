# Bento-ya Roadmap

## v1.0 - Foundation ✅ COMPLETE
**Status**: In testing (`testing/v1-sprint-integration` branch)
**Focus**: Full-featured AI kanban with working orchestrator

### Core Features ✅
- Workspace/Column/Task CRUD with drag-and-drop
- Git integration (branches, diffs, commits)
- Agent chat with `--print` streaming (same as orchestrator)
- Pipeline system (triggers, exit criteria)
- Voice transcription (Whisper)
- Usage tracking & session history
- Theme system with accent colors
- Sharp, minimalistic UI (Linear-inspired)
- E2E + Unit test infrastructure

### Orchestrator Integration ✅
- Anthropic API client with SSE streaming
- Claude CLI integration with `--print` mode
- System prompts with board context injection
- Tool definitions (create/update/move/delete task)
- Tool execution with real-time events
- Streaming UI with thinking blocks & tool calls
- Multi-turn conversation via `--resume`

### Advanced Features ✅
- **GitHub Integration**: PR creation from tasks, PR status tracking
- **Siege Loop**: Autonomous PR review/fix cycles
- **Model Selector**: Sonnet/Opus/Haiku selection per-message
- **Thinking Levels**: Extended thinking configuration
- **History Replay**: Snapshot restore with backups
- **Checklist Auto-detect**: AI-powered checklist extraction
- **Notification Column**: Template-based notification workflows
- **File Attachment**: Drag files into terminal
- **Exit Criteria**: Configurable column advancement rules

### Marketing Site ✅
- Bento-box themed landing page
- SEO, Open Graph, accessibility
- Changelog and wiki sections

---

## v1.1 - Polish & Validation (Current)
**Status**: In progress
**Theme**: "Validate everything works end-to-end"

### Completed
- [x] Fix CLI mode "thinking forever" - switch to `--print` mode
- [x] Unify agent and orchestrator streaming (both use `--print`)
- [x] Remove PTY-based agent in favor of chat UI
- [x] Add shared CLI chat components

### Immediate Tasks
- [ ] Test orchestrator API mode end-to-end
- [ ] Test orchestrator CLI mode end-to-end
- [ ] Test agent chat end-to-end
- [ ] Fix any broken paths discovered

### Known Issues to Fix
- [ ] Settings stored but some not enforced
- [ ] Keyboard shortcuts not registered
- [ ] Checklist backend incomplete
- [ ] Cancel doesn't kill running CLI process (needs process handle)

---

## v2.0 - Orchestrator Intelligence
**Theme**: "Make the AI actually smart"

### Multi-Turn Tool Loops
LLM sees tool results and can refine its approach.

- [ ] Send tool results back to LLM after execution
- [ ] Allow LLM to ask follow-up questions
- [ ] Cap iterations to prevent runaway (5 max)
- [ ] Show iteration progress in UI

### Smarter System Prompts
Better task decomposition and board awareness.

- [ ] Task decomposition instructions
- [ ] Column semantic understanding
- [ ] Duplicate detection
- [ ] Acceptance criteria generation

### Expanded Tool Set
More capabilities for the orchestrator.

- [ ] `list_tasks` - Query current board state
- [ ] `get_task` - Full task details
- [ ] `search_tasks` - Find by query
- [ ] `bulk_move` - Move multiple tasks
- [ ] `add_checklist` - Add items to task

### Provider Abstraction
Support multiple LLM providers.

- [ ] Provider trait interface
- [ ] OpenAI implementation
- [ ] OpenRouter implementation
- [ ] Local model support (Ollama)

---

## v2.1 - Power Features
**Theme**: "Advanced workflows"

### Deep E2E Testing
- [ ] Task creation/editing workflows
- [ ] Drag-and-drop operations
- [ ] Settings persistence
- [ ] Git operations
- [ ] Split view interactions

### Template System
- [ ] Backend template storage
- [ ] Community gallery import
- [ ] Custom template creation
- [ ] Template versioning

### Multi-Agent Orchestration
- [ ] Agent handoff between columns
- [ ] Agent collaboration mode
- [ ] Cost estimation before execution
- [ ] Agent replay/rollback

---

## v3.0 - Scale & Collaborate (Future)
**Theme**: "Team features"

- Multi-user workspaces
- Real-time collaboration
- Cloud sync
- Team templates
- Audit logging
- SSO/OAuth

---

## Feature Status by PR

### Merged to Main
| PR | Feature | Status |
|----|---------|--------|
| #30 | History Replay Restore (T035) | ✅ Merged |
| #29 | Model Selector (T049) | ✅ Merged |
| #28 | Thinking Level Selector (T048) | ✅ Merged |
| #27 | Terminal Voice (T047) | ✅ Merged |
| #26 | Marketing Website | ✅ Merged |
| #25 | Task Card UI (T045) | ✅ Merged |
| #24 | GitHub PR & Siege (T024, T025) | ✅ Merged |
| #23 | Exit Criteria & Review (T034, T041) | ✅ Merged |
| #22 | Pipeline Triggers (T042-T044) | ✅ Merged |

### In Testing (v1-sprint-integration)
| PR | Feature | Status |
|----|---------|--------|
| #39 | V1 Sprint Integration | 🔄 Open |
| #38 | Checklist Auto-detect (T028) | 🔄 Open |
| #37 | Notification Column (T027) | 🔄 Open |
| #36 | File Attachment (T050) | 🔄 Open |
| #35 | Test Checklist (T026) | 🔄 Open |
| #34 | Site Accessibility | 🔄 Open |
| #32 | Siege Loop UI v2 (T051) | 🔄 Open |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
├─────────────────────────────────────────────────────────────┤
│  Orchestrator Panel  │  Kanban Board  │  Terminal/Agent     │
│  - Chat history      │  - Columns     │  - PTY management   │
│  - Streaming UI      │  - Task cards  │  - Voice input      │
│  - Tool call display │  - Drag-drop   │  - File attachment  │
└─────────────────────────────────────────────────────────────┘
                              │ IPC
┌─────────────────────────────────────────────────────────────┐
│                     Backend (Rust/Tauri)                     │
├─────────────────────────────────────────────────────────────┤
│  Commands           │  LLM Module      │  Process Manager   │
│  - orchestrator.rs  │  - anthropic.rs  │  - cli_session.rs  │
│  - task.rs          │  - tools.rs      │  - agent_runner.rs │
│  - git.rs           │  - executor.rs   │  - pty.rs          │
└─────────────────────────────────────────────────────────────┘
                              │ DB
┌─────────────────────────────────────────────────────────────┐
│                      SQLite Database                         │
│  workspaces │ columns │ tasks │ chat_messages │ usage       │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

### Orchestrator Flow
```
User message → CLI/API → LLM response → Tool execution → Board update
     │            │           │              │              │
     └── Chat ────┴── Stream ─┴── Events ────┴── Refresh ───┘
```

### Key Files
| Area | Files |
|------|-------|
| Orchestrator | `src-tauri/src/commands/orchestrator.rs`, `src-tauri/src/llm/*` |
| Frontend | `src/components/panel/orchestrator-panel.tsx` |
| CLI Session | `src-tauri/src/process/cli_session.rs` |
| Tools | `src-tauri/src/llm/tools.rs`, `executor.rs` |
| Settings | `src/stores/settings-store.ts` |
