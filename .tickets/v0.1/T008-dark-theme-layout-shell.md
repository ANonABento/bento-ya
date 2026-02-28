# T008: Dark Theme & Layout Shell

## Summary

Build the app's visual foundation: the dark theme color system, typography, global layout shell (tab bar area + board area + bottom input area), and shared UI components. This gives every other frontend ticket a styled canvas to build on.

## Acceptance Criteria

### Dark Theme
- [ ] CSS variables defined for the full dark palette (from PRODUCT.md):
  - Background: `#0D0D0D`, Surface: `#1A1A1A`, Surface Hover: `#242424`
  - Border: `#2A2A2A`, Text Primary: `#E5E5E5`, Text Secondary: `#888888`
  - Accent: `#E8A87C`, Success: `#4ADE80`, Warning: `#FBBF24`, Error: `#F87171`
  - Running: `#60A5FA`, Attention: `#F59E0B`
- [ ] Tailwind configured to use CSS variables for all colors
- [ ] Theme variables scoped under `[data-theme="dark"]` on root element (ready for light theme later)
- [ ] JetBrains Mono loaded from `public/fonts/` as `@font-face`

### Typography
- [ ] System font stack for UI text (Inter or `-apple-system, ...`)
- [ ] JetBrains Mono for code/terminal contexts
- [ ] Base size: 14px, secondary: 12px, headings: 16px
- [ ] Font weights: 400 normal, 500 medium, 600 semi-bold

### Layout Shell
- [ ] Full-height app layout: `flex flex-col h-screen`
- [ ] Top bar area (for tab bar — placeholder content for now, T009 fills it)
- [ ] Main content area (flex-1, for board — placeholder for now)
- [ ] Bottom bar area (for chat input — placeholder for now)
- [ ] 8px grid system respected in all spacing

### Shared Components
- [ ] `<Button>` — variants: primary, secondary, ghost, danger. Sizes: sm, md
- [ ] `<Input>` — text input with focus ring (accent color border)
- [ ] `<Badge>` — small status indicator (colored dot + optional text)
- [ ] `<Tooltip>` — hover tooltip using CSS or lightweight lib
- [ ] `<Dropdown>` — basic select dropdown (for mode/model selectors later)
- [ ] `<Dialog>` — modal dialog with overlay (for confirmations, forms)
- [ ] All components use CSS variables for theming
- [ ] All components have focus rings for keyboard navigation

## Dependencies

- T007 (types & stores — needs ui-store for theme state)

## Can Parallelize With

- T002, T003, T004, T005, T006

## Key Files

```
src/
  app.tsx                       # Root layout shell
  components/
    shared/
      button.tsx
      input.tsx
      badge.tsx
      tooltip.tsx
      dropdown.tsx
      dialog.tsx
  lib/
    theme.ts                    # Theme definitions, CSS variable names
  index.css                     # Global styles, @font-face, CSS variables
tailwind.config.ts              # Extend with CSS variable colors
public/
  fonts/
    JetBrainsMono.woff2
    JetBrainsMono-Bold.woff2
```

## Complexity

**M** — Design system work, needs attention to detail for consistent styling.

## Notes

- Tailwind v4 approach for CSS variables:
  ```css
  @theme {
    --color-bg: var(--bg);
    --color-surface: var(--surface);
    /* etc */
  }
  ```
  Then use `bg-bg`, `bg-surface`, `text-primary`, etc. in components
- Shared components should be unstyled primitives + Tailwind classes (not a component library)
- Keep components minimal — no over-engineering. A Button is just a styled `<button>` with variants
- Dialog can use HTML `<dialog>` element for native accessibility
- Dropdown can be a simple `<select>` or custom with Radix/headless UI — keep it simple for now
- The layout shell should be the only thing visible after this ticket — "Bento-ya" text in the middle, dark background, tab bar placeholder at top
- Don't add animations yet — T009 and T011 handle Motion integration
