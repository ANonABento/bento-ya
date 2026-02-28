# Bento-ya Roadmap

## Implementation Order & Parallelization

### v0.1 — "It Works" (Foundation)

The critical path is scaffolding → then 4 parallel streams → then integration.

```
T001 Project Scaffolding
  |
  +------ AFTER T001, SPLIT INTO 4 PARALLEL WORKTREES ------+
  |                    |                  |                   |
  | WORKTREE 1         | WORKTREE 2      | WORKTREE 3        | WORKTREE 4
  | Backend Core       | Frontend Core   | Terminal System   | Git System
  |                    |                 |                   |
  | T002 DB Schema     | T007 Types &    | T004 PTY Manager  | T005 Git Branch
  |   |                |   Stores        |   + Agent Runner  |   Manager +
  |   v                |   |             |   |               |   Change Tracker
  | T003 Backend       |   v             |   v               |   |
  |   CRUD Commands    | T008 Theme &    | T010 xterm.js     |   v
  |   |                |   Layout Shell  |   Terminal View   | T012 Diff Viewer
  |   v                |   |             |   |               |
  | T006 IPC Events    |   v             |   v               |
  |                    | T009 Kanban     | T016 Terminal     |
  |                    |   Board + DnD   |   Input Bar       |
  |                    |                 |                   |
  +--------------------+-----------------+-------------------+
                       |
                  MERGE ALL WORKTREES
                       |
                       v
                T011 Split View Transition
                       |
                       v
                T013 E2E Integration & Smoke Test
```

**Estimated v0.1 timeline**: 4 worktrees in parallel, each ~3-5 sessions. Then 2 more sessions for merge + integration.

---

### v0.2 — "Pipeline"

After v0.1 ships, these build on the foundation:

```
T014 Multi-Workspace Tabs ─────┐
T015 Custom Column Config ─────┤── can parallelize (independent features)
T018 Attention System ─────────┘
        |
        v
T016 Pipeline Engine (needs columns + tasks working)
        |
        v
T017 Orchestrator Agent (needs pipeline)
```

---

### v0.3 — "Voice & Config"

```
T019 Whisper Voice Input ──────┐
T020 Settings Panel ───────────┤── can parallelize
T021 Light Theme ──────────────┤
T022 Pipeline Templates ──────┘
        |
        v
T023 Production Checklists (needs settings panel for template management)
```

---

### v0.4 — "Siege"

```
T024 PR Creation ──────────────┐
T027 Notification Column ──────┤── can parallelize
T028 Checklist Auto-detect ────┘
        |
        v
T025 Siege Loop (needs PR creation)
        |
        v
T026 Manual Test Checklists (needs siege loop output)
```

---

### v1.0 — "Bento-ya"

```
T029 History & Replay ─────────┐
T030 Metrics Dashboard ────────┤── can parallelize
T031 Community Templates ──────┘
        |
        v
T032 Polish & Ship
```

---

## Ticket Index

### v0.1 — "It Works"
| ID | Title | Complexity | Dependencies | Parallelizable With |
|----|-------|------------|--------------|---------------------|
| T001 | Project Scaffolding | L | none | — |
| T002 | Database Schema & Migrations | M | T001 | T007, T004, T005 |
| T003 | Backend CRUD Commands | L | T002 | T007-T010, T004, T005 |
| T004 | PTY Manager & Agent Runner | L | T001 | T002, T003, T005, T007-T009 |
| T005 | Git Branch Manager & Change Tracker | M | T001 | T002, T003, T004, T007-T009 |
| T006 | Tauri IPC Event System | M | T003 | T009, T010 |
| T007 | Frontend Types, Stores & IPC Wrappers | M | T001 | T002-T005 |
| T008 | Dark Theme & Layout Shell | M | T007 | T002-T006 |
| T009 | Kanban Board (Columns + Cards + DnD) | XL | T008 | T004, T005, T006 |
| T010 | Terminal View (xterm.js + WebGL) | L | T007 | T002, T003, T005, T009 |
| T011 | Split View Transition | L | T009, T010 | — |
| T012 | Diff Viewer | M | T005, T007 | T003, T004, T009, T010 |
| T013 | E2E Integration & Smoke Test | L | ALL above | — |

### v0.2 — "Pipeline"
| ID | Title | Complexity | Dependencies |
|----|-------|------------|--------------|
| T014 | Multi-Workspace Tabs | L | v0.1 |
| T015 | Custom Column Configuration | M | v0.1 |
| T016 | Pipeline Engine (Triggers & Auto-advance) | XL | T015 |
| T017 | Orchestrator Agent | L | T016 |
| T018 | Attention System | M | v0.1 |

### v0.3 — "Voice & Config"
| ID | Title | Complexity | Dependencies |
|----|-------|------------|--------------|
| T019 | Whisper Voice Input | L | v0.2 |
| T020 | Settings Panel | XL | v0.2 |
| T021 | Light Theme | S | T008 |
| T022 | Pipeline & Column Templates | M | T015, T020 |
| T023 | Production Readiness Checklists | L | T020 |

### v0.4 — "Siege"
| ID | Title | Complexity | Dependencies |
|----|-------|------------|--------------|
| T024 | PR Creation from Review Column | M | v0.3 |
| T025 | Siege Loop (Comment-Watch) | L | T024 |
| T026 | Manual Test Checklist Generation | M | T025 |
| T027 | Notification Column | S | T016 |
| T028 | Checklist Auto-Detect & Fix-This | M | T023 |

### v1.0 — "Bento-ya"
| ID | Title | Complexity | Dependencies |
|----|-------|------------|--------------|
| T029 | History & Replay | L | v0.4 |
| T030 | Metrics Dashboard | M | v0.4 |
| T031 | Community Templates | M | T022 |
| T032 | Polish & Ship | L | ALL |

---

## Complexity Scale

| Size | Meaning | Rough Scope |
|------|---------|-------------|
| **S** | Small | 1-2 files, straightforward, <1 session |
| **M** | Medium | 3-6 files, some design decisions, 1-2 sessions |
| **L** | Large | 7-15 files, cross-cutting concerns, 2-4 sessions |
| **XL** | Extra Large | 15+ files, complex interactions, 4+ sessions or split further |

---

## Quick Start

1. Start with **T001** (scaffolding) — this is the single blocker for everything
2. After T001, open **4 worktrees** and run streams in parallel:
   - `worktree/backend-core` → T002 → T003 → T006
   - `worktree/frontend-core` → T007 → T008 → T009
   - `worktree/terminal` → T004 → T010
   - `worktree/git` → T005 → T012
3. Merge all worktrees into main
4. Build **T011** (split view) on main — needs both board and terminal
5. Wire everything together in **T013**
6. Ship v0.1
