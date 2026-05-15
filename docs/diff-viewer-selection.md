# Diff Viewer Line Selection

The review diff viewer uses an app-level selection model instead of browser text selection. This keeps line actions predictable in narrow agent panels and avoids partial gutter/code selections.

## Interaction Contract

- Plain click an unselected code line: clear the previous selection and select only that line.
- Plain click the only selected code line: unselect it.
- Plain click one line inside a multi-line selection: clear the rest of the selection and keep only the clicked line selected.
- Shift-click a code line: replace the selection with the contiguous range from the current anchor to the clicked line.
- Shift-click with no anchor: behave like a plain click.
- Drag from a code line across other code lines: replace the selection with the dragged contiguous range.
- Click outside code lines and diff action buttons: clear all selected lines and clear the anchor.
- File headers and hunk headers count as outside the code area; clicking them clears all selected lines.
- Programmatically collapsing a file clears selected lines inside that file.
- Load a new diff: clear all selected lines and clear the anchor.

## Anchor Rules

- A plain click sets the anchor to the clicked line, even when that click unselects the only selected line.
- Shift-click uses the current anchor and does not move it.
- Drag start sets the anchor to the starting line.
- Outside clicks and new diffs clear the anchor.

## Actions

- `Copy selected` and `Send to agent` are disabled when no lines are selected.
- Selected text is emitted as unified diff context, grouped by file and hunk.
- `Copy hunk`, `Send`, and `Copy path` do not clear line selection.

## Implementation Notes

- Code rows are marked with `data-diff-code-area="true"`.
- Diff actions are marked with `data-diff-action="true"`.
- Outside-click clearing ignores both markers.
- Clickable controls use inline cursor styles for macOS Tauri WebView compatibility.
