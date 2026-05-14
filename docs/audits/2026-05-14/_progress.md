# Phase 4 Progress — 2026-05-14

Starting commit (post-artifact): `4598993`.
Ending commit: `565b411`.

## Processed (19 fixed, 3 deferred)

### Fixed — landed as surgical commits on `main`

| Finding | Commit | Notes |
|---|---|---|
| P1-1 — overlay pointer-events | `08b1ea2` | One-line fix; unblocked WDIO regression coverage |
| P0-1 — task title/description editability | `44c78c8` | Inline click-to-edit with Enter/Esc save+revert |
| P1-6 / P2-3 — orchestrator aria-label + aria-pressed | `aac4bbf` | 4 sidebar-mode toggles labelled + pressed state |
| P1-4 / P1-5 — Settings dialog semantics + focus trap | `3f64cc5` | role/aria-modal + Tab cycling |
| P1-2 — tab-bar mobile collision | `4615827` | 64px tab cap below `sm`, collapse right cluster |
| P1-3 — agent panel header mobile overflow | `6fb3abf` | Two-row header below `lg`, Stop/Kill always reachable |
| P1-8 — column-config Delete tab order | `ad13565` | DOM order Cancel→Save→Delete, visual order preserved |
| P2-1 — card title pr-24 | `1957106` | `pr-2 group-hover:pr-24` saves ~50% horizontal title space |
| P2-2 — workspace tab focus ring | `5e11761` | focus-visible:ring on SortableTab |
| P2-4 / P2-5 — color swatch focus + arrow nav | `1b47038` | Roving tabindex + ArrowKey cycling |
| P2-6 — shortcuts modal duplicate rows | `3e7b738` | `altKeys` field collapses `?` vs `Cmd+/` into one row |
| P2-7 — SettingRow htmlFor | `f93e746` | Optional prop; backwards compatible |
| P2-8 — terminal view landmark | `b117e7e` | role="region" aria-label="Agent terminal" |
| P2-9 — Batches refresh button | `c3f3da9` | Promoted to outlined-button with refresh icon |
| P2-10 — disabled toggle confusing | `11c0b1d` | Neutral grey + collapsed thumb when disabled |
| P2-11 — Upcoming providers contrast | `8102499` | Coming-soon pill instead of opacity-50 |
| P2-12 — quick-action button size | `565b411` | h-6 → h-7 (24px → 28px) for touch targets |

### Deferred — needs product judgment

- **P1-B (expanded card clipped on tablet/mobile by agent panel)** — Fix requires choosing between (a) auto-collapsing the docked agent panel when expanding a card, or (b) re-laying-out the expanded card to overlay the panel. Both are valid UX patterns; bento-ya hasn't established a precedent. Best guess: option (a) — close the agent panel when expanding a task on narrow viewports, since the agent panel is task-specific anyway. 1-line change in `expandTask` action in `ui-store.ts`. Defer until product decides.
- **P1-7 (workspace tab close button)** — Carry-forward from `ux-audit-2026-05-12 P0-5`. Some apps (Linear, Notion) deliberately omit tab-close; bento-ya 2026-05-12 audit flagged the absence as P0. Could land a hover-revealed X + two-step confirm. Best guess: add the close button — `useTabBarNavigation` already handles Cmd+W carefully, so the same path is safe via UI. Defer until product decides if removal is intentional.
- **P2-13 (command palette recents / quick actions)** — Information-architecture choice: do we want recents (showing your last 5 commands), or pinned actions (Create task / Settings / Workspace), or both? Defer the IA call.

### No failed attempts

All 17 commits passed `npx tsc --noEmit` + (where applicable) the relevant Vitest specs + pre-commit lint. Full test suite (`npm test --run`) re-run after every ~5 commits — **366 tests pass at every checkpoint**.

### Out of scope this run

- **Onboarding wizard (carry-forward P0-3)** — requires fresh DB state to verify the "Template + Agent selections dropped" bug. Not re-tested in this audit; carry-forward to next pass.
- **`Cmd+W` actual destructive behavior (carry-forward P0-2)** — visual inspection only (did not press the key to avoid deleting the test workspace). The shortcut still exists in `shortcuts-modal.tsx` without a "destructive" annotation; carry forward.
