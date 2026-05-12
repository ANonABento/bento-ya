# Accessibility / Keyboard / Error-State Pass — Findings & Fixes

**Date:** 2026-05-12  
**Branch:** overnight-claude-qa-bentoya-accessibility-keyboard-err-6383

---

## What Was Fixed (18 files, 185 insertions)

### Shared Components

| File | Fix |
|------|-----|
| `shared/dialog.tsx` | Added `aria-labelledby` linking `<dialog>` to its `<h2>` via `useId`. Auto-focuses first focusable element on open. |
| `shared/tooltip.tsx` | Added `role="tooltip"`, stable `id` (via `useId`), and `aria-describedby` on the trigger wrapper. |
| `shared/dropdown.tsx` | Added `aria-expanded`, `aria-haspopup="listbox"`, `aria-controls` on trigger; `role="listbox"` on menu; `role="option"` + `aria-selected` on items; full arrow-key + Enter + Escape keyboard navigation. |
| `shared/loading-spinner.tsx` | Added `role="status"` and `aria-label="Loading"` so screen readers announce loading state. |
| `shared/badge.tsx` | Added `aria-hidden="true"` to decorative colored dot so screen readers skip it. |
| `shared/toggle.tsx` | Added `aria-label` / `aria-labelledby` props (the `role="switch"` + `aria-checked` were already correct). |
| `shared/icon-button.tsx` | Added `aria-label` from the `tooltip` prop, so icon-only buttons have accessible names even without the tooltip rendered. |

### Kanban Components

| File | Fix |
|------|-----|
| `kanban/task-quick-actions.tsx` | Replaced all `title=` attributes with `aria-label=`; added `aria-hidden="true"` to all icon SVGs; added `aria-haspopup="menu"` to the more-actions button. |
| `kanban/task-card-status.tsx` | `PipelineErrorBanner`: `role="alert"` (assertive, fires immediately). `AttentionBanner`, `BlockedBanner`, `QualityGateBanner`: `role="status"` (polite). Added `aria-expanded` + `aria-label` to the "Why?" expand button. Added `aria-hidden="true"` to all decorative SVGs. |
| `kanban/task-card.tsx` | Added `role="article"` + `aria-label={task.title}` (includes "(selected)" when selected). Added `aria-hidden="true"` to the checkmark overlay. |
| `kanban/column.tsx` | Empty-state `<p>` wrapped in `role="status"` container with `aria-label`; added `aria-live="polite"`. Add-task input gets `aria-label="New task title"`. Delete-confirmation modal gets `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and Escape key handler. |
| `kanban/column-header.tsx` | Rename input gets `aria-label="Column name"`. Run-All confirmation gets `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape key handler. |

### Command Palette

| File | Fix |
|------|-----|
| `command-palette/command-palette.tsx` | Full ARIA combobox pattern: input gets `role="combobox"`, `aria-label`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`. List container gets `role="listbox"`. Category groups get `role="group"` + `aria-label`. Items get `role="option"` + `aria-selected`. Empty state gets `role="status"`. Keyboard shortcut hints and icons marked `aria-hidden`. |

### Settings Tabs

| File | Fix |
|------|-----|
| `settings/tabs/cards-tab.tsx` | Local `Toggle`: replaced `<label>` wrapper (doesn't associate with buttons) with `<div>` + explicit `aria-label` on the switch; added focus ring. |
| `settings/tabs/git-tab.tsx` | Added `aria-label="Auto-create PR"` to Toggle. |
| `settings/tabs/shortcuts-tab.tsx` | Added `aria-label={`Enable ${shortcut.action}`}` to Toggle. |
| `settings/tabs/workspace-tab.tsx` | Added `aria-label` to both Auto-Advance and Auto-Archive Done toggles. |
| `settings/tabs/voice-tab.tsx` | Added `aria-label` to both voice toggles. |

---

## Keyboard Navigation — What Now Works

- **Dropdown**: Open with Enter/Space/ArrowDown, navigate with Up/Down arrows, select with Enter/Space, dismiss with Escape/Tab.
- **Command palette**: Already had arrow-key navigation; now properly announces active item via `aria-activedescendant`.
- **Task cards**: Already had extensive keyboard shortcuts (Enter, Space, R, →, Delete, D, M, L); now have proper semantic role and accessible name.
- **All icon-only buttons**: Now have `aria-label` so screen readers read their purpose.
- **All confirmation modals**: Now have `role="dialog"` + `aria-labelledby` + Escape key dismissal.

---

## Remaining / Not Fixed (Out of Scope for This Pass)

- **Task context menu** (`task-context-menu.tsx`): right-click only; no keyboard equivalent or focus trap. Would require a significant refactor to add a proper menu widget with arrow-key navigation.
- **Agent transcript** clickable divs: semantic improvements would require converting them to `<button>` elements throughout the transcript rendering.
- **`SettingRow` label association**: The `<label>` in `SettingRow` doesn't have `htmlFor` so isn't programmatically connected to child controls. Fixed for Toggles via `aria-label`; other controls (inputs, selects) inside SettingRow rely on their own `label` props.
- **Decorative SVGs elsewhere**: Only the most impactful locations were addressed. A full pass would require `aria-hidden="true"` on ~100 more SVG icons across the codebase.
- **Touch target sizes**: Some icon buttons are 24×24px (below WCAG 2.5 recommendation of 44×44px). Low priority for desktop app.
