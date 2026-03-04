# T016: Pipeline Engine (Triggers & Auto-advance)

## Summary

Build the pipeline engine: when a task enters a column, the column's trigger fires automatically. When exit criteria are met, the task auto-advances to the next column. This is what makes columns "do things" instead of being passive labels.

## Acceptance Criteria

- [ ] Column trigger fires when task enters (via drag, auto-advance, or API)
- [ ] Trigger types implemented: agent spawn, skill/script execution
- [ ] Exit criteria evaluation runs on events (agent complete, script exit, etc.)
- [ ] Auto-advance: when exit criteria met + `auto_advance` is true, task moves to next column
- [ ] Pipeline respects column order (next column = position + 1)
- [ ] Trigger failure handling: task stays in column, attention indicator set
- [ ] Trigger timeout: configurable max duration, flag if exceeded
- [ ] Pipeline state machine per task: idle → triggered → running → evaluating exit → advancing

## Dependencies

- T015 (custom column config — need trigger/exit config to execute)

## Complexity

**XL**
