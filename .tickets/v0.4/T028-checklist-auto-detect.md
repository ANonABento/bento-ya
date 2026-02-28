# T028: Checklist Auto-Detect & Fix-This

## Summary

Enhance production checklists with two power features: auto-detection (scan repo to check items automatically) and "Fix this" (click to create a task that an agent implements, auto-checks the item on completion).

## Acceptance Criteria

### Auto-Detect
- [ ] File-exists detection: scan for file patterns (e.g., `.github/workflows/*.yml` → CI configured)
- [ ] File-contains detection: check for content in files (e.g., `"strict": true` in tsconfig.json)
- [ ] Command-succeeds detection: run a command and check exit code (e.g., `npm test`)
- [ ] File-absent detection: verify sensitive files aren't committed (e.g., `.env`)
- [ ] Auto-detect runs on checklist open and periodically (configurable)
- [ ] Items auto-checked show "Auto-detected" badge instead of manual checkmark

### Fix This
- [ ] "Fix this" button on unchecked items
- [ ] Clicking creates a task on the board with generated title + description
- [ ] Task enters pipeline (Backlog → Combobulating → ...)
- [ ] Checklist item links to the created task (shows task status)
- [ ] When linked task completes successfully, checklist item auto-checks
- [ ] Item shows "Fixed by agent" badge with link to task

## Dependencies

- T023 (production checklists)

## Complexity

**M**
