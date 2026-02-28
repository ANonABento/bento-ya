# T015: Custom Column Configuration

## Summary

Make columns fully configurable: add/remove/rename columns, configure triggers and exit criteria per column, column settings dialog. This transforms the static 4-column board into a user-designed pipeline.

## Acceptance Criteria

- [ ] "+" button at end of column row opens "Add Column" dialog
- [ ] Column name, icon, color editable via column header menu (right-click or kebab menu)
- [ ] Delete column option (with confirmation, moves tasks to Backlog)
- [ ] Column config dialog: trigger type selector, exit criteria selector, auto_advance toggle
- [ ] Trigger types: none, agent, skill, script (webhook in v0.3+)
- [ ] Exit criteria types: manual, agent_complete, script_success
- [ ] Column config persisted to DB
- [ ] Column templates: quick-add from presets (e.g., "Review", "Siege", "RCA")

## Dependencies

- v0.1 complete

## Complexity

**M**
