# T050: File Attachment in Terminal

## Summary

File attachment button in terminal input is disabled. Implement ability to attach files/images to agent messages.

## Current State

- `src/components/terminal/terminal-input.tsx` line 118-127: disabled attach button
- "File attachment coming in v0.2" tooltip

## Acceptance Criteria

- [ ] Click attach opens file picker
- [ ] Support images (PNG, JPG, GIF) and text files
- [ ] Show attachment preview/chip in input area
- [ ] Files sent to agent with message
- [ ] For Claude: use vision for images, inline for text
- [ ] Drag-and-drop support
- [ ] Paste image from clipboard
- [ ] Remove attachment before sending

## Technical Notes

Need Tauri file dialog and base64 encoding for images.

## Complexity

**M**
