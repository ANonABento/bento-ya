# Bento-ya v1.0 Sprint Roadmap

> Final sprint to production-ready v1.0
> Generated: 2025-03-04

## Overview

| Priority | Tickets | Est. Effort |
|----------|---------|-------------|
| P0 Critical | 3 | 2-3 days |
| P1 Important | 4 | 3-4 days |
| P2 Nice-to-have | 4 | 2-3 days |
| **Total** | **11** | **~8 days** |

---

## P0: Critical Path (Must Have)

These block v1 release.

### T035: History Replay Restoration
**Status:** Backend missing `restore_snapshot`
**Effort:** M (1 day)
**Why:** Core feature advertised but non-functional

- Add `restore_snapshot` Tauri command
- Wire HistoryPanel onReplay callback
- Confirmation dialog before restore
- Create pre-restore backup snapshot

### T047: Terminal Voice Integration
**Status:** Stub (voice works in Chef panel)
**Effort:** S (0.5 day)
**Why:** Inconsistent UX, button says "coming soon" but feature exists

- Wire existing useVoiceInput hook to terminal
- Enable mic button, remove stale tooltip

### T051: Siege Loop UI Integration
**Status:** Backend complete, no UI
**Effort:** M (1 day)
**Why:** Key automation feature with no way to use it

- Start/stop siege buttons
- Iteration counter on task card
- Event listeners for real-time updates

---

## P1: Important (Should Have)

Significantly improve UX but not blockers.

### T048: Thinking Level Selector
**Status:** Disabled stub
**Effort:** S (0.5 day)

- Dropdown with None/Low/Medium/High
- Pass to agent spawn config

### T049: Functional Model Selector
**Status:** Display-only
**Effort:** M (1 day)

- Dropdown with configured models
- Selection affects agent spawn

### T026: Manual Test Checklist Generation
**Status:** Not started
**Effort:** M (1 day)

- Agent generates checklist from PR diff
- Interactive checklist in task detail
- Auto-advance when all checked

### T050: File Attachment
**Status:** Disabled stub
**Effort:** M (1 day)

- Attach files/images to messages
- File picker + drag-drop + paste

---

## P2: Nice-to-Have (Could Have)

Polish and extras.

### T027: Notification Column
**Status:** Not started
**Effort:** S (0.5 day)

- "Notify" column template
- Shows what changed, who to notify

### T028: Checklist Auto-Detect
**Status:** Not started
**Effort:** M (1 day)

- Detect checkboxes in PR/commit messages
- Auto-populate task checklist

### T046: Chef Settings API
**Status:** New
**Effort:** L (2 days)

- Settings manifest JSON
- Tauri IPC for Chef to read/write settings
- Natural language → settings mapping

---

## Execution Order

### Week 1: Core
1. **T035** History Replay (day 1)
2. **T047** Terminal Voice (day 1)
3. **T051** Siege UI (day 2)
4. **T048** Thinking Selector (day 2)

### Week 2: Features
5. **T049** Model Selector (day 3)
6. **T026** Test Checklist Gen (day 4)
7. **T050** File Attachment (day 5)

### Week 3: Polish
8. **T027** Notification Column (day 6)
9. **T028** Checklist Auto-Detect (day 6-7)
10. **T046** Chef Settings API (day 7-8)

---

## Definition of Done

- [ ] All P0 tickets complete
- [ ] All P1 tickets complete
- [ ] No "coming in vX.X" tooltips remain
- [ ] All terminal input buttons functional
- [ ] Siege loop usable end-to-end
- [ ] History replay works
- [ ] npm run type-check passes
- [ ] npm run lint passes
- [ ] Manual smoke test of core flows

---

## Out of Scope for v1

- Multi-user / collaboration
- Cloud sync
- Mobile app
- Plugin system
- Self-hosted backend option

These are v2.0 considerations.
