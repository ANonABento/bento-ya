# UI Restructure: Expanded Cards + Chat Panel

> Spec: 2026-04-06. Status: **Done** (implemented 2026-04-06).

## Current State

Click a task card → split view opens:
- Left panel: task detail (title, description, approve/reject, checklist, changes, commits, usage, notify)
- Right panel: agent chat (empty until interactive session started)

**Problems:**
- Split view is heavy — two panels for one task
- Detail panel duplicates info already on the card
- Agent chat is disconnected from the task (empty for trigger-spawned agents)
- Too much going on when you just want to see a task or chat with the agent

## Proposed Design

### 1. Card Expansion (inline detail)

**Click a task card** → card expands vertically in-place within the column, showing:

```
┌─────────────────────────────┐
│ Task Title                  │  ← existing card header
│ Description preview...      │  ← existing
├─────────────────────────────┤
│ ▼ EXPANDED DETAIL           │  ← new: slides open below
│                             │
│ Full description            │
│ Branch: bentoya/feature-x   │
│ Status: Agent working       │
│ Model: sonnet               │
│                             │
│ ┌─ Checklist ─────────────┐ │
│ │ ☑ Item 1                │ │
│ │ ☐ Item 2                │ │
│ └─────────────────────────┘ │
│                             │
│ Changes: 3 files            │
│ Commits: 2                  │
│                             │
│ [Open Agent Chat]  [Edit]   │
│ [Approve] [Reject]          │
└─────────────────────────────┘
```

**Behavior:**
- Click card → expand. Click again → collapse.
- Only one card expanded at a time (clicking another collapses the current).
- Expanded card scrolls within the column if content is tall.
- All current detail panel content moves here: description, branch, status, checklist, changes, commits, usage, approve/reject, notify.

### 2. Agent Chat Panel (right slide-in)

**Click "Open Agent Chat"** button in expanded card → chat panel slides in from the right.

```
┌──────────────────────┬──────────────────────────┐
│                      │  Agent Chat               │
│  Kanban Board        │  ─────────────────────── │
│  (columns + cards)   │  Claude: I'll update the │
│                      │  README with v2.0...     │
│                      │                          │
│                      │  [tool: Edit README.md]  │
│                      │                          │
│                      │  Done. Changes committed.│
│                      │                          │
│                      │  ┌──────────────────────┐│
│                      │  │ Ask the agent...     ││
│                      │  └──────────────────────┘│
└──────────────────────┴──────────────────────────┘
```

**Behavior:**
- Panel is ONLY the agent chat — no task detail (that's in the expanded card now).
- Shows streaming output for trigger-spawned agents.
- Chat history persists (from agent_messages table).
- Panel closes with X or Escape.
- Board shrinks to accommodate panel (existing split-view behavior).

### 3. Remove Split View Detail Panel

The `TaskSidePanel` / `task-detail-panel.tsx` component is removed. Its content is absorbed into:
- **Expanded card** → description, branch, status, checklist, changes, commits, usage, approve/reject
- **Agent chat panel** → the chat portion

## Files to Change

| File | Change |
|------|--------|
| `src/components/kanban/task-card.tsx` | Add expanded state, render detail content inline |
| `src/components/layout/board.tsx` | Remove TaskSidePanel import, keep chat panel |
| `src/components/layout/split-view.tsx` | Simplify to chat-only panel |
| `src/components/task-detail/task-detail-panel.tsx` | Extract content into reusable sections, or inline into task-card |
| `src/components/panel/agent-panel.tsx` | May need props adjustment |
| `src/hooks/use-split-view.ts` | Simplify — only tracks chat panel open/close |

## Effort Estimate

~4-6 hours. The main work is moving detail panel content into the card expansion component and testing the layout at various card counts / column widths.

## Open Questions

1. **Mobile / narrow columns:** Expanded card content in a 280px column — will it feel cramped? May need min-width or a different expansion direction.
2. **Multiple expanded cards:** Allow multiple, or collapse-on-expand? Single expansion is simpler.
3. **Auto-open chat:** When a trigger spawns an agent, should the chat panel auto-open? Or just show the "Agent working" badge and let the user open manually?
4. **Keyboard shortcut:** Current `L` key opens dependencies tab in the detail panel. Remap to expand card + open deps section?
