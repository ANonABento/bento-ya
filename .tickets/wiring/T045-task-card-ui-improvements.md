# T045: Task Card UI Improvements

## Summary

UI/UX improvements for task cards based on design review.

## Issues Identified

### High Priority
1. **Invisible drag handle** - No visual affordance for drag-and-drop
2. **Error states buried** - Pipeline errors shown as small text at bottom

### Medium Priority
3. **No visual hierarchy** - Title and status badges compete for attention
4. **Cursor classes broken** - CSS cursor classes don't work on macOS Tauri WKWebView
5. **Attention badge clips** - Absolute positioned badge can clip at column edges

### Low Priority
6. **Missing keyboard navigation** - No focus ring or keyboard support
7. **Inconsistent border radius** - Card uses `rounded`, overlay uses `rounded-xl`

## Recommended Changes

### 1. Add Visible Drag Grip
```tsx
<div className="flex h-4 items-center justify-center opacity-0 group-hover:opacity-60">
  {[...Array(6)].map((_, i) => (
    <span key={i} className="h-1 w-1 rounded-full bg-text-secondary" />
  ))}
</div>
```

### 2. Elevate Error States
```tsx
{hasPipelineError && (
  <div className="mt-2 rounded bg-error/10 border border-error/20 px-2 py-1.5">
    <div className="flex items-start gap-1.5 text-xs text-error">
      <ErrorIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="line-clamp-2">{task.pipelineError}</span>
    </div>
  </div>
)}
```

### 3. Inline Attention Badges
Move from absolute positioned to inline with status indicators in header row.

### 4. Use Inline Cursor Styles
```tsx
style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
```

### 5. Add Keyboard Focus Ring
```tsx
className="focus-visible:ring-2 focus-visible:ring-accent"
tabIndex={0}
onKeyDown={(e) => { if (e.key === 'Enter') handleClick() }}
```

## File to Modify

- `src/components/kanban/task-card.tsx`

## Complexity

**M** - Multiple styling changes, no backend work

## Reference

Full design review with code snippets available from UI Review agent session.
