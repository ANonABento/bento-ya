# Audit Plan — 2026-05-14

Synthesis of the four Phase-0 research subagents. Phase 1 walks the **Target surfaces** list with both WDIO and Playwright.

## Conventions

- **Severity rubric** (verified verbatim match across `ux-audit-2026-05-12.md` and `UI_AUDIT_2026-05-13.md`):
  - **P0** — destroys data, hides a required action, or makes a feature unusable.
  - **P1** — confusing/broken interaction a real user hits day-one but can work around.
  - **P2** — polish, a11y, discoverability nit.

- **Starting commit**: `54f4a8c` (docs(ui-audit): add 2026-05-13 audit artifacts).

## Target surfaces

Trim list (~40 surfaces). Each gets 3 viewports × 2 tools where possible (mobile 375×667, tablet 1024×768, desktop 1920×1080). `agent-panel-interactive` requires a live CLI and is **skip-list** for WDIO/mock environments.

### Board / kanban

- [ ] `board-default` — board with default seeded columns + tasks
- [ ] `board-empty` — board with all columns empty
- [ ] `board-archived-shown` — archived column visible
- [ ] `column-with-trigger` — column showing on_entry/on_exit trigger indicators
- [ ] `task-card-default` — collapsed task card
- [ ] `task-card-expanded` — expanded card with sub-sections (changes, commits, etc.)
- [ ] `task-card-running` — task card while agent runs (status banner)
- [ ] `task-card-failed` — failed pipeline w/ retry affordance
- [ ] `task-card-blocked` — "blocked by" dependency banner
- [ ] `task-card-quality-gate` — manual_approval gate badge (pending/approved/rejected)
- [ ] `dependency-lines` — SVG bezier dependency rendering between cards

### Modals & dialogs

- [ ] `column-config-dialog` — column triggers/exit editor (3 churned, regression candidate)
- [ ] `task-settings-modal` — triggers + dependencies tabs
- [ ] `task-label-picker`
- [ ] `task-template-picker`
- [ ] `add-workspace-dialog`
- [ ] `onboarding-wizard` — every step (P0-3 watchlist)
- [ ] `about-modal`
- [ ] `command-palette` — open + with results
- [ ] `shortcuts-modal` — keyboard reference

### Panels

- [ ] `agent-panel-headless-transcript` — chat bubble view
- [ ] `agent-panel-headless-terminal` — xterm pane
- [ ] `orchestrator-panel-default` — chat mode (2 churned, regression candidate)
- [ ] `orchestrator-panel-collapsed`
- [ ] `orchestrator-panel-dashboard` — pipeline dashboard sidebar
- [ ] `orchestrator-panel-history` — history sidebar
- [ ] `tab-bar-default` — workspace tabs with cost badge (2 churned)
- [ ] `bulk-task-toolbar`
- [ ] `usage-budget-banner`
- [ ] `diff-viewer`

### Settings tabs (12)

- [ ] `settings-workspace`
- [ ] `settings-appearance`
- [ ] `settings-board`
- [ ] `settings-agent` (Models & Limits)
- [ ] `settings-voice`
- [ ] `settings-github`
- [ ] `settings-mcp`
- [ ] `settings-batches`
- [ ] `settings-advanced`
- [ ] `settings-updates`
- [ ] `settings-shortcuts`
- [ ] `settings-scripts`

### Empty/error states

- [ ] `agent-transcript-empty`

**Total: ~40 surfaces.**

## Regression watchlist (P0s + fragile P1/P2 fixes)

### Open P0s from 2026-05-12 audit — must verify status

| ID | Title | Verify | Action if still broken |
|---|---|---|---|
| P0-1 | Task title/description uneditable after creation | Try editing in expanded card | Carry forward to today's P0 |
| P0-2 | Cmd+W deletes workspace with no confirmation | Press Cmd+W on focused workspace | Carry forward to today's P0 |
| P0-3 | Onboarding drops Template + Agent selections | Pick options, finish wizard, check workspace | Carry forward to today's P0 |
| P0-4 | No global Escape close for Settings/TaskSettings/Checklist/Onboarding | Open each, press Esc | Carry forward (Settings already fixed in 647015d — recheck the other three) |
| P0-5 | Workspace tabs can't be closed from tab bar | Hover tab, look for X | Carry forward to today's P0 |

### Fragile fixes (Phase 2 vision pass should flag REGRESSION:<id> if broken)

- **P1-2** (dedb576) — aria-label coverage on icon-only header buttons (Cost badge, orchestrator chevron, settings button, etc.)
- **P1-3** (871fb15) — column-config color swatch radio-group semantics
- **P1-4** (eaef381) — Toggle component aria-checked
- **P2-2** (154c172) — `now` timestamp styling on task cards
- **P2-3** (5ce2f77) — orchestrator collapse handle chevron affordance
- **P2-6** (8dd014e) — Toggle off-state edge
- **P2-7** (b00e695) — Settings mobile-section-picker breakpoint at `lg`

### Component change hotspots (regression candidates)

| Count | File | Watchpoint |
|---|---|---|
| 3 | `settings-panel.tsx` | Tab switching, sidebar layout on narrow viewports |
| 3 | `kanban/column-config-dialog.tsx` | Trigger/exit form, color picker, tab semantics |
| 2 | `orchestrator-panel.tsx` | Session switching, dashboard tab, chat input row |
| 2 | `layout/tab-bar.tsx` | DnD reordering, cost badge spacing |

## Known a11y gaps to re-verify

From `ACCESSIBILITY_FINDINGS.md`:

- **Task context menu** — right-click only; no keyboard equivalent (still pending).
- **Agent transcript** clickable divs — should be `<button>` elements (still pending).
- **SettingRow** — `<label>` lacks `htmlFor` connection to child controls.
- **Decorative SVGs** — ~100 inline SVGs lack `aria-hidden="true"`.
- **Touch target sizes** — multiple icon buttons render at 24×24px (below WCAG 44×44 — low priority for desktop, noted).

### Icon-only buttons reported as still missing labels (subagent 4)

- `history-panel.tsx` close `<X />`
- `cost-badge.tsx` refresh
- `templates-tab.tsx` star/export/delete (use `title=` instead of `aria-label`)
- `community-gallery.tsx` close `<X />`
- `metrics-dashboard.tsx` export-CSV + close
- `diff-section.tsx` collapse/expand chevron

Phase 1 ARIA scan will produce the authoritative list.

### Keyboard shortcut map (re-verify each fires under Tab/keyboard focus)

`?`, `Cmd+/`, `Cmd+K`, `Cmd+,`, `Cmd+J`, `Cmd+T`, `Cmd+W`, `Cmd+1..9`, `Ctrl+Tab`/`Ctrl+Shift+Tab`, `Enter`/`Space`, `R`, `ArrowRight`, `D`, `M`, `L`, `Del`/`Backspace`, `Esc`.

## Skip list

- `agent-panel-interactive` — needs real Claude/Codex CLI inside tmux; mock IPC + WDIO seed can't drive it. Verify static markup only.
- `terminal-view` — empty xterm pane is renderable, but live PTY output requires a real backend session. Snap the empty-attached state only.
- `workspace-setup` (legacy) — superseded by onboarding-wizard; verify it's still reachable, otherwise dead-code.
- `community-gallery` — server-fetched gallery items will be empty in mock; verify shell only.
- Drag-and-drop interactions (board task move, tab reorder) — WDIO has no reliable HTML5 DnD for `@dnd-kit`. Smoke-test via keyboard if possible; otherwise rely on existing e2e coverage.

## Phase 1 execution notes

- WDIO env: `KAITENCODE_DATA_DIR=/tmp/kaitencode-overnight-2026-05-14` (isolated DB)
- Playwright: browser-mock IPC at `http://localhost:1420`
- Author spec at `tests/webdriver/audit-2026-05-14.spec.mjs` extending the `audit-2026-05-13.spec.mjs` pattern.
- Capture ARIA scan + console dump for each surface.
- Save merged output to `docs/audits/2026-05-14/_findings.json`.
