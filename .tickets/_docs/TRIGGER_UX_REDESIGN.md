# Trigger Config UX Redesign

> **Status:** Planned (2026-06-08) · **Type:** presentation-layer redesign (no backend change)
> **Decision:** "When → run → advance" sentence builder + recipe gallery, inside the existing modal.
> Supersedes the 3-tab form in `column-config-dialog.tsx`. Backend model
> (`ColumnTriggers`/`TriggerAction`/`ExitCriteria` in `src/types/column.ts`) is unchanged.

## Why

Column automation is KaitenCode's deepest feature and its hardest UI. Today the
config is ~2,000 LOC across 13 files and 3 tabs (General · Triggers · Exit). The
single most common column — "run Claude, advance when done" — requires opening a
modal, the Triggers tab, expanding a hidden *advanced editor*, picking Spawn CLI,
switching to the Exit tab, picking Agent Complete, and toggling Auto Advance. The
**action and the exit criterion that form one rule live on different tabs with no
visible link.** A user must hold ~10 concepts at once (triggers, actions, exit
criteria, entry/exit, retries, runtime modes, models, prompts, resource profiles,
dependencies).

Worst offenders (from the UX + code audit):
- **Jargon / impl leaks:** "Runtime: Terminal (tmux) / Managed (events)",
  "Resource profile: Heavy/Exclusive", `{dep.<id>.last_output}`, "re-fires the
  on_entry trigger".
- **Duplicated, inconsistent controls:** model is `claude-opus-4-5` (column) vs
  `opus` (task); concurrency shows "max 3" in one panel, free-form max in another,
  backend default 5 — three sources of truth.
- **Implicit coupling:** `script_success` exit only works with a Run Script
  action; `pr_approved` with Create PR — never linked or hinted.
- **Dead / confusing surface:** `trigger_task` action defined but unreachable;
  `default_runtime_mode` can't be set from the UI; an "Effective: trigger > task >
  column > workspace > global > default" line exposes the 6-tier resolver because
  the layering itself confuses people.

## The model the best tools use

Trello Butler, Asana, Notion, Jira all converge on a **natural-language sentence**
where the grammar *is* the UI, front-loaded by **recipes**, with the long tail
**progressively disclosed**. Avoid node-canvas (n8n) / YAML (GitHub Actions) — they
push time-to-first-success from minutes to weeks. Our per-column automation is
short and linear (When → Do → Advance) — the exact shape the sentence model fits.

## The redesign

One panel inside the existing modal:

```
┌ Automate "In Progress" ──────────────────────────────────────┐
│ Start from a recipe:                                          │
│  [⚡ Code it]  [👀 Review + approve]  [🧪 Run tests]  [🔀 Open PR]  │
│ ───────────────────────────────────────────────────────────── │
│ When a task enters this column,                               │
│   run  [Claude ▾ · opus ▾]  with  [the default prompt ▾]       │
│   then move it on when  [the agent finishes ▾].               │
│                                                               │
│   ▸ Advanced — runs on, retries, timeout, runtime, queue,     │
│                on-exit action, prompt variables               │
└───────────────────────────────────────────────────────────────┘
   collapsed column header shows:  ▸ Runs Claude · advances when done
```

### The sentence
- **"When a task enters this column"** — the on_entry trigger (fixed lead-in;
  on_exit moves to Advanced since few columns need it).
- **"run [action]"** — the action picker. The bracket is a dropdown; choosing it
  swaps the inline sub-controls:
  - *run Claude · opus* — spawn_cli (model inline) `with [prompt ▾]`
  - *run the script [name ▾]* — run_script
  - *open a PR (base [main])* — create_pr
  - *set up a branch + worktree* — auto_setup
  - *do nothing* — none
- **"then move it on when [criterion]"** — the exit criteria, as the second clause
  (this is what makes "exit criteria" finally legible). Options in plain language:
  *the agent finishes · a script passes · I approve it · a checklist is done ·
  N seconds pass · a PR is approved · manually*. Auto-advance is implied by the
  phrasing ("move it on when…"); a "but wait for me to confirm" sub-toggle covers
  the manual_approval gate.

The sentence **is** the plain-language summary — so the separate "Generate
Triggers" LLM box is dropped.

### Recipes (one click → a complete, runnable rule)
| Recipe | Wires |
|---|---|
| ⚡ Code it | spawn_cli claude (default cmd/prompt) · exit agent_complete · auto-advance |
| 👀 Review + approve | exit manual_approval (review gate) · auto-advance off |
| 🧪 Run tests | run_script (pick script) · exit script_success · auto-advance |
| 🔀 Open a PR | create_pr (base from git settings) · exit agent_complete |
| ▫ Manual column | none · exit manual (a plain board column, no automation) |

Recipes extend the existing pipeline-template system conceptually but are
per-column and inline.

### Advanced (progressive disclosure, same panel — not a separate mode)
Runs on (entry/exit) · runtime mode · max retries · timeout · agent queue /
column concurrency (ONE source of truth) · on-exit action (move / trigger
another task) · prompt-variable reference. Most columns never open it.

### Zero-config default
A freshly added automation is already a legal, runnable rule using the global
`default_agent_cli` / `default_model` from settings — never a half-filled form
demanding 8 selections before it can save.

## Cleanups folded in
- **Unify model vocabulary:** show `opus/sonnet/haiku` everywhere; map to dated
  CLI ids at the backend boundary only.
- **De-jargon:** "Terminal (tmux) / Managed (events)" → plain "Headless / …";
  drop "Resource profile" buttons (fold into Advanced as plain concurrency).
- **One concurrency source** (kill the hardcoded "max 3" pill).
- **Remove dead surface** (`trigger_task` either exposed properly under Advanced
  or removed; wire or drop `default_runtime_mode`).
- **Column summary chip** doubles as at-a-glance state + pre-save confirmation.
- Keep the per-task override modal, but make its controls *match* the column ones
  (same vocab) and lean on the live "Effective:" line less.

## Phases
1. **Recipe gallery + sentence for the common path** (spawn_cli + exit criteria)
   inside the modal; keep existing per-action editors mounted under Advanced
   (reuse, don't rewrite yet). Ship the 80% win.
2. **Cleanups** — unified model vocab, de-jargon, one concurrency source, drop
   dead/duplicate surface, drop the LLM-generate box.
3. **Column summary chip** + zero-config legal defaults.
4. *(optional)* "describe it in words" that fills the sentence; Butler-style
   "automate this?" suggestions from repeated manual drags.

## Files
- Replace the inside of `src/components/kanban/column-config-dialog.tsx` and its
  tab/editor children with the sentence panel + recipe gallery + an Advanced
  section that reuses the existing per-action editors initially.
- `src/components/kanban/column-config-constants.ts` — recipe definitions, plain
  labels.
- No change to `src/types/column.ts` or the Rust pipeline — the sentence reads/
  writes the same `ColumnTriggers` JSON.
