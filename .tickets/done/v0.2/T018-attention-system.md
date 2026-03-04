# T018: Attention System

## Summary

Build the attention indicator system: when an agent needs user input, hits a blocker, or errors out, the task card pulses with a glow and the workspace tab shows a badge count. Desktop notifications optional.

## Acceptance Criteria

- [ ] Pulsing amber border glow on task cards needing attention (Motion animation)
- [ ] Badge icon on card showing attention reason
- [ ] Tab badge count increments for unviewed attention events
- [ ] Attention triggered by: agent asking a question, agent error, agent idle timeout
- [ ] Clicking the card and viewing the terminal clears the attention state
- [ ] Desktop notification (optional, via Tauri notification plugin)
- [ ] Sound toggle for attention events

## Dependencies

- v0.1 complete

## Complexity

**M**
