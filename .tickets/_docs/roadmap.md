# Bento-ya Roadmap

> **Status:** See [STATUS.md](./STATUS.md) for detailed implementation status.
>
> | Version | Status |
> |---------|--------|
> | v0.1 | **COMPLETE** |
> | v0.2 | **COMPLETE** |
> | v0.3 | **COMPLETE** |
> | v0.4 | TODO |
> | v1.0 | **COMPLETE** |

## Implementation Order & Parallelization

### v0.1 — "It Works" (Foundation) — COMPLETE

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

### v0.2 — "Pipeline" — COMPLETE

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

### v0.3 — "Voice & Config" — COMPLETE

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

### v0.4 — "Siege" — TODO

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

### v1.0 — "Bento-ya" — COMPLETE

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

### v0.1 — "It Works" — COMPLETE
| ID | Title | Status |
|----|-------|--------|
| T001 | Project Scaffolding | ✅ |
| T002 | Database Schema & Migrations | ✅ |
| T003 | Backend CRUD Commands | ✅ |
| T004 | PTY Manager & Agent Runner | ✅ |
| T005 | Git Branch Manager & Change Tracker | ✅ |
| T006 | Tauri IPC Event System | ✅ |
| T007 | Frontend Types, Stores & IPC Wrappers | ✅ |
| T008 | Dark Theme & Layout Shell | ✅ |
| T009 | Kanban Board (Columns + Cards + DnD) | ✅ |
| T010 | Terminal View (xterm.js + WebGL) | ✅ |
| T011 | Split View Transition | ✅ |
| T012 | Diff Viewer | ✅ |
| T013 | E2E Integration & Smoke Test | ✅ |

### v0.2 — "Pipeline" — COMPLETE
| ID | Title | Status |
|----|-------|--------|
| T014 | Multi-Workspace Tabs | ✅ |
| T015 | Custom Column Configuration | ✅ |
| T016 | Pipeline Engine (Triggers & Auto-advance) | ✅ |
| T017 | Orchestrator Agent | ✅ |
| T018 | Attention System | ✅ |

### v0.3 — "Voice & Config" — COMPLETE
| ID | Title | Status |
|----|-------|--------|
| T019 | Whisper Voice Input | ✅ |
| T020 | Settings Panel | ✅ |
| T021 | Light Theme | ✅ |
| T022 | Pipeline & Column Templates | ✅ |
| T023 | Production Readiness Checklists | ✅ |

### v0.4 — "Siege" — TODO
| ID | Title | Status | Complexity |
|----|-------|--------|------------|
| T024 | PR Creation from Review Column | ❌ | M |
| T025 | Siege Loop (Comment-Watch) | ❌ | L |
| T026 | Manual Test Checklist Generation | ❌ | M |
| T027 | Notification Column | ❌ | S |
| T028 | Checklist Auto-Detect & Fix-This | ❌ | M |

### v1.0 — "Bento-ya" — COMPLETE
| ID | Title | Status |
|----|-------|--------|
| T029 | History & Replay | ✅ |
| T030 | Metrics Dashboard | ✅ |
| T031 | Community Templates | ✅ |
| T032 | Polish & Ship | ✅ |

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
